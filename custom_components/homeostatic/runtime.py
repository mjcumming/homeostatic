"""Home Assistant lifecycle, observation, persistence, and delivery adapter."""

import asyncio
import logging
from collections import deque
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timedelta
from functools import partial
from time import perf_counter
from typing import Any
from uuid import uuid4

from health_tree.engine import Engine
from health_tree.policy import Policy
from health_tree.types import (
    Delivery,
    EpisodeOpened,
    EpisodeResolved,
    EpisodeUpdated,
    Importance,
    JSONValue,
    Notification,
    Observation,
    PolicyConfig,
    PolicyContext,
    ProbeRequested,
    QuietWindow,
    View,
)
from health_tree.types import (
    Event as HealthEvent,
)
from homeassistant.components import persistent_notification
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    ConfigEntry,
    ConfigEntryChange,
    ConfigEntryState,
)
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import Context, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers import label_registry as lr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import reporting
from .attention import build_policy, explanations, supports_attention_controls
from .automation_alerts import AutomationAlerts, automation_owner, identity
from .catalog import (
    Source,
    device_observation,
    entity_observation,
    entity_state_signature,
    entry_observation,
)
from .config import Settings, normalize_definitions, normalize_rules, rule_data
from .const import (
    DOMAIN,
    EVENT_CONTROL,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
    NAME,
    RECONCILE_INTERVAL,
    STORE_VERSION,
)
from .controls import OperatorControl, expiry, presentation, restore_controls
from .delivery import DeliveryState
from .enrollment import (
    evaluate,
    inventory,
    report,
    restore_device_exclusions,
    restore_enrollment,
)
from .evidence import IntegrationEvidence, ReportedCondition
from .facts import (
    FACT_SCHEMA_VERSION,
    Fact,
    anchor_identity,
    child_context,
    reasons,
    signature,
)
from .function_model import compose, describe, preview
from .history import ResolvedHistory
from .notification_routes import async_send, notification_url
from .phone_actions import PhoneActions
from .rules import Attributes, parse_rules
from .serialization import json_object, to_json
from .situation_reports import report_observation

_LOGGER = logging.getLogger(__name__)


class Runtime:
    """Serialize engine calls and publish durable adapter state on the HA loop."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, settings: Settings
    ) -> None:
        """Prepare storage and listeners without starting the engine clock."""
        self.hass = hass
        self.entry = entry
        self.settings = settings
        self.store: Store[dict[str, Any]] = Store(
            hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}", atomic_writes=True
        )
        self.signal = f"{DOMAIN}_{entry.entry_id}_updated"
        self.fact_signal = f"{DOMAIN}_{entry.entry_id}_fact"
        self._facts: list[Fact] = []
        self.engine: Engine | None = None
        self.policy: Policy | None = None
        self.sources: dict[str, Source] = {}
        self.targets: list[str] = []
        self.enrolled: dict[str, Attributes] = {}
        self.candidates: dict[str, Source] = {}
        self.enrollment_changes: deque[dict[str, JSONValue]] = deque(maxlen=50)
        self._discovered = False
        self.episodes: dict[str, dict[str, JSONValue]] = {}
        self.history = ResolvedHistory()
        self.integration_evidence = IntegrationEvidence()
        self.entity_evidence: dict[str, ReportedCondition] = {}
        self.controls: list[OperatorControl] = []
        self.delivery = DeliveryState(entry.entry_id)
        self.automation_alerts = AutomationAlerts()
        self.phone_actions = PhoneActions()
        self.delivery_failures: deque[dict[str, str]] = deque(maxlen=50)
        self._legacy_notifications: set[str] = set()
        self._activating = False
        self.fresh_start = False
        self._quiet_since: datetime | None = None
        self._pending: deque[tuple[datetime, list[Observation], Context | None]] = (
            deque()
        )
        self.retry_since: dict[str, datetime] = {}
        self.saved: dict[str, Any] | None = None
        self.running = False
        self._stopped = False
        self.error: str | None = None
        self.updated_at: datetime | None = None
        self._entity_sources: dict[str, list[Source]] = {}
        self._device_members: dict[str, tuple[str, ...]] = {}
        self.device_exclusions: dict[str, tuple[str, ...]] = {}
        self._device_signatures: dict[str, tuple[str, str]] = {}
        self._inventory_dirty = True
        self.inventory_revision = 0
        self.inventory_static: dict[str, JSONValue] = {}
        self._refresh_task: asyncio.Task[None] | None = None
        self._refresh_requested = False
        self._reconcile_requested = False
        self._lock = asyncio.Lock()
        self._subscriptions: list[Callable[[], None]] = []
        self._entries: dict[str, tuple[ConfigEntry, Callable[[], None]]] = {}
        self._deadline_cancel: Callable[[], None] | None = None

    @property
    def desired_notifications(self) -> set[str]:
        """Episode ids represented in the last requested notification information."""
        return self.delivery.episode_ids

    @property
    def consumer_missing(self) -> bool:
        """An enabled notification route needs an enabled consumer automation."""
        if any(
            channel.startswith(("phone:", "notify:"))
            for recipient in self._policy_config().recipients.values()
            for channel in recipient.channels
        ):
            return False
        state = (
            self.hass.states.get(self.settings.consumer)
            if self.settings.consumer
            else None
        )
        return self.settings.notifications and (state is None or state.state != "on")

    @property
    def available(self) -> bool:
        """Whether presentation is a current answer from a running adapter."""
        return self.running and self.engine is not None and self.error is None

    @property
    def readiness(self) -> str:
        """Read overall readiness without conflating no enrollment with ready."""
        if self.engine is None or not self.targets:
            return "unknown"
        return self.engine.readiness(self.targets).answer

    @property
    def evidence_gaps(self) -> int:
        """Count distinct unwatched nodes and unknown/stale check references."""
        if self.engine is None:
            return 0
        coverage = self.engine.coverage()
        return (
            int(self.consumer_missing)
            + sum(
                (
                    self.sources[node_id].kind != "function"
                    or not self.sources[node_id].requirements
                )
                for node_id in coverage.no_checks
            )
            + len(set(coverage.never_observed) | set(coverage.stale))
        )

    async def async_load(self) -> None:
        """Read and validate the envelope before Home Assistant starts."""
        self.saved = await self.store.async_load()
        if self.saved is None:
            return
        if not isinstance(self.saved, dict):
            raise ValueError("Invalid Homeostatic snapshot envelope")
        if self.saved.get("schema_version") not in (1, 2):
            raise ValueError("Unsupported Homeostatic snapshot version")
        for key in ("engine", "policy", "episodes", "retry_since"):
            if not isinstance(self.saved.get(key), dict):
                raise ValueError(f"Invalid stored {key}")
        if self.saved["schema_version"] == 2:
            self.delivery.restore(self.saved["delivery"])
            if type(self.saved.get("notifications_enabled")) is not bool:
                raise ValueError("Invalid notification activation state")
        self.automation_alerts.restore(self.saved.get("automation_alerts", {}))
        self.phone_actions.restore(self.saved.get("phone_actions", {}))
        if "resolved_history" in self.saved:
            self.history.restore(self.saved["resolved_history"])
        self.integration_evidence.restore(self.saved.get("integration_evidence", {}))
        self.controls = restore_controls(self.saved.get("operator_controls", []))
        self.enrolled = restore_enrollment(self.saved.get("enrollment", {}))
        self.device_exclusions = restore_device_exclusions(
            self.saved.get("device_exclusions", {})
        )
        notifications = self.saved.get("notifications")
        if not isinstance(notifications, list) or not all(
            isinstance(item, str) for item in notifications
        ):
            raise ValueError("Invalid stored notifications")
        for episode_id, episode in self.saved["episodes"].items():
            if not isinstance(episode, dict) or episode.get("episode_id") != episode_id:
                raise ValueError("Invalid stored episode")
            if not isinstance(episode.get("anchor"), str) or not isinstance(
                episode.get("reasons"), list
            ):
                raise ValueError("Invalid stored episode presentation")
            for finding in episode["reasons"]:
                if not isinstance(finding, dict) or not isinstance(
                    finding.get("reason"), str
                ):
                    raise ValueError("Invalid stored episode reason")

    async def async_start(self, hass: HomeAssistant) -> None:
        """Begin startup grace only once HA has completed startup."""
        if self._stopped or self.running:
            return
        self.running = True
        self._subscriptions.extend(
            (
                hass.bus.async_listen(EVENT_STATE_CHANGED, self._state_changed),
                hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, self._stop_event),
                hass.bus.async_listen(
                    er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed
                ),
                async_dispatcher_connect(
                    hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._config_entry_changed
                ),
                async_track_time_interval(
                    hass, self._reconcile_timer, RECONCILE_INTERVAL
                ),
            )
        )
        self._subscriptions.extend(
            hass.bus.async_listen(event_type, self._registry_changed)
            for event_type in (
                dr.EVENT_DEVICE_REGISTRY_UPDATED,
                ar.EVENT_AREA_REGISTRY_UPDATED,
                fr.EVENT_FLOOR_REGISTRY_UPDATED,
                lr.EVENT_LABEL_REGISTRY_UPDATED,
            )
        )
        if self.fresh_start:
            self._quiet_since = dt_util.utcnow()
        await self.async_refresh()

    @callback
    def _state_changed(self, event: Event[Any]) -> None:
        if not self.running:
            return
        entity_id = event.data["entity_id"]
        registered = er.async_get(self.hass).async_get(entity_id)
        if registered is not None and registered.platform == DOMAIN:
            return
        sources = self._entity_sources.get(entity_id, [])
        old, new = event.data["old_state"], event.data["new_state"]
        metadata_changed = (
            old is None
            or new is None
            or old.name != new.name
            or old.attributes.get("device_class") != new.attributes.get("device_class")
        )
        if metadata_changed:
            self._inventory_dirty = True
        if sources and (
            any(source.kind == "situation" for source in sources)
            or entity_state_signature(event.data["old_state"])
            != entity_state_signature(event.data["new_state"])
        ):
            now = dt_util.utcnow()
            observations = []
            for source in sources:
                observation = (
                    self._observe_device(source, now)
                    if source.kind == "device"
                    else entity_observation(source, event.data["new_state"], now)
                )
                if source.kind == "device":
                    signature = (observation.status.value, observation.reason)
                    if self._device_signatures.get(source.node_id) == signature:
                        continue
                    self._device_signatures[source.node_id] = signature
                observations.append(observation)
            if observations:
                self._pending.append((now, observations, event.context))
                self._request_refresh()
            elif metadata_changed:
                self._request_refresh()
        elif metadata_changed or entity_id == self.settings.consumer:
            self._request_refresh()

    @callback
    def _entry_changed(self, entry: ConfigEntry) -> None:
        if self.running:
            source = self.sources[f"entry:{entry.entry_id}"]
            now = dt_util.utcnow()
            self._pending.append((now, [self._observe_entry(source, now)], None))
            self._request_refresh()

    async def _drain_pending(self) -> None:
        assert self.engine is not None
        assert self.policy is not None
        processed = 0
        slice_started = perf_counter()
        while self._pending:
            now, observations, cause = self._pending.popleft()
            self._record_observations(observations)
            self._handle(self.engine.ingest_many(observations, now), now, cause)
            self._deliveries(self.policy.advance(now, PolicyContext()))
            processed += 1
            if self._pending and (
                processed >= 8 or perf_counter() - slice_started >= 0.020
            ):
                await self._yield_observations()
                processed = 0
                slice_started = perf_counter()

    async def _yield_observations(self) -> None:
        """Let HA service other callbacks without releasing ordered state ownership."""
        await asyncio.sleep(0)

    @callback
    def _registry_changed(self, event: Event[Any]) -> None:
        self._inventory_dirty = True
        self._request_refresh()

    @callback
    def _config_entry_changed(
        self, _change: ConfigEntryChange, entry: ConfigEntry
    ) -> None:
        if self.running and entry.domain != DOMAIN:
            self._inventory_dirty = True
            self._request_refresh(reconcile=True)

    @callback
    def _request_refresh(self, *, reconcile: bool = False) -> None:
        if self.running:
            self._refresh_requested = True
            self._reconcile_requested |= reconcile
            if self._refresh_task is None:
                self._refresh_task = self.hass.async_create_task(
                    self._queued_refresh(), eager_start=False
                )

    async def _queued_refresh(self) -> None:
        try:
            while self.running and self._refresh_requested:
                self._refresh_requested = False
                reconcile = self._reconcile_requested
                self._reconcile_requested = False
                await self.async_refresh(reconcile=reconcile)
        finally:
            self._refresh_task = None

    async def _timer(self, now: datetime) -> None:
        self._request_refresh()

    async def _reconcile_timer(self, now: datetime) -> None:
        self._request_refresh(reconcile=True)

    async def _stop_event(self, event: Event[Any]) -> None:
        await self.async_stop()

    def _discover(self) -> dict[str, Source]:
        rules = parse_rules(rule_data(self.hass, self.settings))
        discovered = inventory(self.hass, self.settings, self.enrolled)
        candidates = evaluate(discovered, rules)
        at = dt_util.utcnow().isoformat()
        batch = uuid4().hex
        if not self._discovered:
            watched = sorted(
                (source for source in candidates.values() if source.watched),
                key=lambda source: (source.name, source.node_id),
            )
            self.enrollment_changes.append(
                {
                    "at": at,
                    "reason": "initial_scope",
                    "total": len(watched),
                    "sources": [
                        {
                            "node_id": source.node_id,
                            "name": source.name,
                            "kind": source.kind,
                            "entry_id": source.entry_id,
                            "owner_id": source.owner_id,
                            "device_id": next(
                                iter(source.attributes.get("device", ())), None
                            ),
                            "attached_by": list(source.attached_by),
                        }
                        for source in watched[:50]
                    ],
                }
            )
        for node_id, source in candidates.items():
            previous = self.candidates.get(node_id)
            if not self._discovered:
                continue
            if previous is not None and (
                previous.watched,
                previous.attached_by,
                previous.excluded_by,
            ) != (source.watched, source.attached_by, source.excluded_by):
                self.enrollment_changes.append(
                    {
                        "node_id": node_id,
                        "at": at,
                        "batch": batch,
                        "reason": "source_removed"
                        if source.kind == "device"
                        and previous.availability_entities
                        and not discovered[node_id].availability_entities
                        and not source.disabled
                        else "match_attributes_changed"
                        if previous.attributes != source.attributes
                        else "rules_changed",
                        "before": json_object(previous),
                        "after": json_object(source),
                    }
                )
            elif previous is None and source.watched:
                self.enrollment_changes.append(
                    {
                        "node_id": node_id,
                        "at": at,
                        "batch": batch,
                        "reason": "source_enrolled",
                        "after": json_object(source),
                    }
                )
        for node_id in self.candidates.keys() - candidates.keys():
            previous = self.candidates[node_id]
            if previous.watched:
                self.enrollment_changes.append(
                    {
                        "node_id": node_id,
                        "at": at,
                        "batch": batch,
                        "reason": "source_removed",
                        "before": json_object(previous),
                    }
                )
        self._discovered = True
        self.candidates = candidates
        sources, self.targets = compose(
            self.hass, self.automation_alerts.compose(self.settings), candidates
        )
        sources.update(self.automation_alerts.sources(self.settings))
        self.enrolled = {
            node_id: source.attributes
            for node_id, source in sources.items()
            if source.kind in {"entity", "integration", "device"}
        }
        return sources

    def _listen_entries(self) -> None:
        selected = {
            source.entry_id
            for source in self.sources.values()
            if source.entry_id and source.watched
        }
        for entry_id, (previous, cancel) in list(self._entries.items()):
            current = self.hass.config_entries.async_get_entry(entry_id)
            if entry_id not in selected or current is not previous:
                cancel()
                del self._entries[entry_id]
        for entry_id in selected - self._entries.keys():
            entry = self.hass.config_entries.async_get_entry(entry_id)
            if entry is not None:
                self._entries[entry_id] = (
                    entry,
                    entry.async_on_state_change(partial(self._entry_changed, entry)),
                )

    async def async_refresh(self, *, reconcile: bool = True) -> None:
        """Process captured evidence, optionally reconcile, then persist deliveries."""
        async with self._lock:
            if not self.running:
                return
            now = dt_util.utcnow()
            try:
                if self.engine is not None:
                    await self._drain_pending()
                    now = dt_util.utcnow()
                events = self._evaluate(now, reconcile=reconcile)
                self._handle(events, now)
                await self._complete(now)
            except (
                OSError,
                HomeAssistantError,
                ValueError,
                KeyError,
                TypeError,
            ) as err:
                if self.saved is not None:
                    self.engine = None
                    self.policy = None
                self._failed(err)
            finally:
                async_dispatcher_send(self.hass, self.signal)

    def _failed(self, err: Exception) -> None:
        # Facts describe saved state; an unsaved change is never published.
        self._facts.clear()
        if self.error != str(err):
            _LOGGER.error("Homeostatic refresh failed: %s", err)
        self.error = str(err)
        persistent_notification.async_create(
            self.hass,
            "Homeostatic cannot provide current health. Check its configuration, storage, and logs.",
            NAME,
            f"{DOMAIN}_{self.entry.entry_id}_error",
        )

    async def _complete(self, now: datetime) -> None:
        assert self.policy is not None
        if self._activating:
            self.delivery.deactivate()
            self._activating = False
            self._deliveries(self.policy.activate(now, PolicyContext()))
        self._deliveries(self.policy.advance(now, PolicyContext()))
        self._prune_controls(now)
        self.history.advance(now)
        self.phone_actions.prune(now)
        if not self.settings.notifications:
            self.delivery.deactivate()
        self._end_quiet(now)
        await self._save()
        if self.running:
            # The startup hold applies to attention, not to detected facts.
            self._publish_facts()
        if self.running and self._quiet_since is None:
            await self._flush_events()
        self.error = None
        self.updated_at = now
        persistent_notification.async_dismiss(
            self.hass, f"{DOMAIN}_{self.entry.entry_id}_error"
        )
        if self.running:
            self._schedule(now)

    @property
    def startup_quiet(self) -> bool:
        """Whether requests are held while Home Assistant finishes starting."""
        return self._quiet_since is not None

    def _end_quiet(self, now: datetime) -> None:
        """End the startup hold once watched integrations have finished loading.

        Setup retry and errors count as finished, so a failing integration
        cannot hold every other notification. The cap ends the hold regardless.
        """
        if self._quiet_since is None:
            return
        elapsed = now - self._quiet_since
        if elapsed < self.settings.duration("startup_grace"):
            return
        if elapsed < self.settings.duration("startup_quiet_max") and any(
            self._loading(entry_id) for entry_id in self._watched_entries()
        ):
            return
        _LOGGER.debug("Homeostatic startup hold ended after %s", elapsed)
        self._quiet_since = None

    def _watched_entries(self) -> set[str]:
        return {
            str(entry_id)
            for source in self.sources.values()
            if source.watched
            for entry_id in source.attributes.get("integration", ())
        }

    def _loading(self, entry_id: str) -> bool:
        entry = self.hass.config_entries.async_get_entry(entry_id)
        return (
            entry is not None
            and entry.disabled_by is None
            and entry.state
            in (ConfigEntryState.NOT_LOADED, ConfigEntryState.SETUP_IN_PROGRESS)
        )

    def _prune_controls(self, now: datetime) -> None:
        kept = []
        for control in self.controls:
            if control.until <= now:
                self._control_fact("ended", control, ended_reason="expired")
            elif control.target not in (
                self.episodes if control.action == "shelve" else self.sources
            ):
                self._control_fact("ended", control, ended_reason="target_removed")
            else:
                kept.append(control)
        self.controls = kept

    def _maintenance_scope(self, node_id: str, include_dependents: bool) -> list[str]:
        assert self.engine is not None
        if self.sources[node_id].kind not in {"entity", "integration", "external"}:
            raise ValueError("Maintenance must start at an equipment capability")
        scope = [node_id]
        if include_dependents:
            scope.extend(item.node_id for item in self.engine.impact(node_id).nodes)
        if any(self.sources[item].kind == "situation" for item in scope):
            raise ValueError("Equipment maintenance cannot cover a situation")
        return scope

    def _preview_maintenance(
        self, data: dict[str, Any], now: datetime
    ) -> dict[str, JSONValue]:
        until = expiry(data["until"], now)
        scope = self._maintenance_scope(
            data["node_id"], data.get("include_dependents", False)
        )
        return {
            "node_ids": list(scope),
            "functions": [
                node_id for node_id in scope if self.sources[node_id].kind == "function"
            ],
            "existing_episode_ids": [
                episode_id
                for episode_id, episode in self.episodes.items()
                if episode["anchor"] in scope
            ],
            "until": until.isoformat(),
            "existing_alerts_continue": True,
        }

    def _apply_control(
        self,
        action: str,
        data: dict[str, Any],
        user_id: str | None,
        now: datetime,
        context: Context | None = None,
    ) -> dict[str, JSONValue]:
        assert self.engine is not None
        assert self.policy is not None
        if action in {"report_alert", "manage_alert"}:
            return self._apply_alert(action, data, now, context)
        if action == "report_situation":
            if any(
                row["node_id"] == f"situation:{data['situation_id']}"
                for row in self.automation_alerts.records.values()
            ):
                raise ValueError(
                    "This situation is now owned by its reporting automation"
                )
            source = self.sources.get(f"situation:{data['situation_id']}")
            if source is None or source.report_timeout is None:
                raise ValueError(
                    "Choose a configured automation situation with report_timeout"
                )
            observation = report_observation(source, data["state"], now)
            self._handle(self.engine.ingest_many([observation], now), now, context)
            return {
                "node_id": source.node_id,
                "state": data["state"],
                "accepted_at": now.isoformat(),
                "expires_at": (
                    now + timedelta(seconds=source.report_timeout)
                ).isoformat(),
            }
        if action in {"acknowledge", "cancel_control"}:
            if not supports_attention_controls():
                raise ValueError("This action requires HealthTree 0.4.0 or newer")
            if action == "acknowledge":
                target = data["episode_id"]
                if target not in self.episodes:
                    raise ValueError("Acknowledgment requires a current episode id")
                first = self.policy.acknowledgment(target) is None
                self._deliveries(self.policy.acknowledge(target, now, actor_id=user_id))
                if first:
                    self._facts.append(
                        Fact(
                            event_type=EVENT_CONTROL,
                            data=self._control_data(
                                "started",
                                kind="acknowledge",
                                episode_id=target,
                            ),
                            context=context or Context(),
                        )
                    )
                return {
                    "acknowledgment": json_object(self.policy.acknowledgment(target))
                }
            return self._cancel_control(data["control_id"], now, context)
        until = expiry(data["until"], now)
        if action == "shelve":
            target = data["episode_id"]
            if target not in self.episodes:
                raise ValueError("Shelving requires a current episode id")
            if any(
                control.action == "shelve"
                and control.target == target
                and control.until > until
                for control in self.controls
            ):
                raise ValueError("An existing shelf can only be extended")
            response: dict[str, JSONValue] = {}
            self._deliveries(self.policy.shelve(target, until, now))
            for control in self.controls:
                if control.action == "shelve" and control.target == target:
                    self._control_fact(
                        "ended", control, ended_reason="replaced", context=context
                    )
            self.controls = [
                control
                for control in self.controls
                if not (control.action == "shelve" and control.target == target)
            ]
        else:
            target = data["node_id"]
            response = self._preview_maintenance(data, now)
            self._handle(
                self.engine.quiet(
                    QuietWindow(
                        scope="node_and_dependents"
                        if data.get("include_dependents", False)
                        else "node",
                        node_id=target,
                        until=until,
                    ),
                    now,
                ),
                now,
                context,
            )
        control = OperatorControl(
            control_id=uuid4().hex,
            action="shelve" if action == "shelve" else "maintenance",
            target=target,
            started_at=now,
            until=until,
            user_id=user_id,
            reason=data.get("reason", ""),
            include_dependents=data.get("include_dependents", False),
        )
        self.controls.append(control)
        self._control_fact("started", control, context=context)
        return {**response, "control": json_object(control)}

    def _cancel_control(
        self, control_id: str, now: datetime, context: Context | None = None
    ) -> dict[str, JSONValue]:
        assert self.engine is not None
        assert self.policy is not None
        control = next(
            (item for item in self.controls if item.control_id == control_id), None
        )
        if control is None:
            raise ValueError("This control has already ended or no longer exists")
        if control.action == "shelve":
            self._deliveries(self.policy.unshelve(control.target, now, PolicyContext()))
        else:
            self._handle(
                self.engine.cancel_quiet(
                    QuietWindow(
                        scope="node_and_dependents"
                        if control.include_dependents
                        else "node",
                        node_id=control.target,
                        until=control.until,
                    ),
                    now,
                ),
                now,
                context,
            )
        self.controls.remove(control)
        self._control_fact("ended", control, ended_reason="cancelled", context=context)
        return {"cancelled_control_id": control_id}

    def _apply_alert(
        self, action: str, data: dict[str, Any], now: datetime, context: Context | None
    ) -> dict[str, JSONValue]:
        assert self.engine is not None
        assert self.policy is not None
        first = not self.automation_alerts.records
        if action == "report_alert":
            key, row = self.automation_alerts.prepare(self.hass, self.settings, data)
        else:
            key = identity(
                automation_owner(self.hass, data["automation"]),
                data.get("alert_key", "default"),
            )
            if key not in self.automation_alerts.records:
                raise ValueError("Choose an existing automation alert")
            row = {
                **self.automation_alerts.records[key],
                "retired": data["operation"] == "retire",
            }
        changed = self.automation_alerts.records.get(key) != row
        self.automation_alerts.records[key] = row
        if first:
            previous = self.policy.snapshot()
            self.policy = Policy(self._policy_config())
            self.policy.restore(previous, now)
        if changed:
            self._inventory_dirty = True
            self._handle(self._evaluate(now), now, context)
        if action == "report_alert":
            source = self.sources[row["node_id"]]
            observation = report_observation(source, data["state"], now)
            if data["state"] == "active":
                from dataclasses import replace

                observation = replace(observation, message=data["message"])
            self._handle(self.engine.ingest_many([observation], now), now, context)
        return {
            "node_id": row["node_id"],
            "retired": row["retired"],
            "reporting_status": self.automation_alerts.status(self.settings, row),
        }

    def _policy_config(self) -> PolicyConfig:
        return build_policy(
            self.automation_alerts.policy(self.settings),
            self.settings.duration("batch"),
        )

    async def async_phone_action(self, event: Event[Any]) -> None:
        """Apply an authenticated recipient response through existing operator controls."""
        row = await self.phone_actions.authorize(self.hass, event, dt_util.utcnow())
        if row is None or not self.settings.notifications:
            return
        recipient = self._policy_config().recipients.get(row["recipient"])
        if (
            recipient is None
            or row["channel"] not in recipient.channels
            or row["episode_id"] not in self.episodes
        ):
            return
        try:
            await self.async_control(
                "acknowledge",
                {"episode_id": row["episode_id"]},
                row["user_id"],
                event.context,
            )
        except HomeAssistantError, ValueError:
            _LOGGER.debug("Phone acknowledgment was not applied")

    async def async_control(
        self,
        action: str,
        data: dict[str, Any],
        user_id: str | None,
        context: Context | None = None,
    ) -> dict[str, JSONValue]:
        """Serialize an authorized operator action and confirm durable storage."""
        async with self._lock:
            if not self.available:
                raise HomeAssistantError("Homeostatic is not ready")
            now = dt_util.utcnow()
            invalid: ValueError | KeyError | None = None
            response: dict[str, JSONValue] = {}
            try:
                await self._drain_pending()
                now = dt_util.utcnow()
                self._handle(self._evaluate(now), now)
                self._prune_controls(now)
                try:
                    response = self._apply_control(action, data, user_id, now, context)
                except (ValueError, KeyError) as err:
                    invalid = err
                # Reconciliation can resolve the requested episode. Its events
                # still need a durable save even when the action is rejected.
                await self._complete(now)
            except (
                OSError,
                HomeAssistantError,
                ValueError,
                KeyError,
                TypeError,
            ) as err:
                self._failed(err)
                raise HomeAssistantError(
                    "Could not confirm situation report; inspect current state after recovery"
                    if action == "report_situation"
                    else "Could not confirm operator control; inspect controls after recovery"
                ) from err
            finally:
                async_dispatcher_send(self.hass, self.signal)
            if invalid is not None:
                raise invalid
            return response

    def _evaluate(self, now: datetime, *, reconcile: bool = True) -> list[HealthEvent]:
        first = self.engine is None
        discover = reconcile or self._inventory_dirty or first
        previous_candidates = self.candidates
        sources = self._discover() if discover else self.sources
        events: list[HealthEvent] = []
        if first:
            self.engine = Engine(self.settings.engine_settings())
            self.policy = Policy(self._policy_config())
        assert self.engine is not None
        assert self.policy is not None
        changed = [
            source.node(self.settings)
            for node_id, source in sources.items()
            if first or source != self.sources.get(node_id)
        ]
        if changed:
            events.extend(self.engine.register_many(changed, now))
        for node_id in self.sources.keys() - sources.keys():
            events.extend(self.engine.remove(node_id, now))
        if discover:
            if (
                self._inventory_dirty
                or first
                or sources != self.sources
                or self.candidates != previous_candidates
            ):
                self.inventory_revision += 1
                self.inventory_static = {
                    "nodes": [json_object(source) for source in sources.values()],
                    "catalog": report(
                        self.candidates,
                        parse_rules(rule_data(self.hass, self.settings)),
                    ),
                    "enrollment_changes": list(self.enrollment_changes),
                    "targets": list(self.targets),
                }
            self._inventory_dirty = False
            self._device_members = {
                source.node_id[7:]: source.availability_entities
                for source in sources.values()
                if source.kind == "device"
            }
            self._device_signatures = {
                node_id: signature
                for node_id, signature in self._device_signatures.items()
                if node_id in sources and sources[node_id].watched
            }
            self._entity_sources = {}
            for source in sources.values():
                if source.entity_id and source.watched:
                    self._entity_sources.setdefault(source.entity_id, []).append(source)
                elif source.kind == "device" and source.watched:
                    for entity_id in self._device_members.get(source.node_id[7:], ()):
                        self._entity_sources.setdefault(entity_id, []).append(source)
        self.sources = sources
        self.entity_evidence = {
            key: value
            for key, value in self.entity_evidence.items()
            if key in sources and sources[key].watched
        }
        self.integration_evidence.retain(
            {
                source.node_id
                for source in sources.values()
                if source.kind == "integration" and source.watched
            }
        )
        self._listen_entries()
        if first and self.saved is not None:
            self.episodes = self.saved["episodes"].copy()
            self._legacy_notifications = (
                set(self.saved["notifications"])
                if self.saved["schema_version"] == 1
                else set()
            )
            self._activating = self.settings.notifications and (
                not self.saved.get("notifications_enabled", False)
                or self.saved.get(
                    "policy_settings",
                    {
                        "policy": Settings.from_data({}).policy,
                        "batch": self.settings.timings["batch"],
                    },
                )
                != self._policy_settings()
            )
            self.retry_since = {
                entry_id: datetime.fromisoformat(value)
                for entry_id, value in self.saved["retry_since"].items()
            }
            self.policy.restore(self.saved["policy"], now)
            events.extend(self.engine.restore(self.saved["engine"], now))
            self.saved = None
        for node_id, source in sources.items():
            if source.kind != "device":
                continue
            previous_scope = self.device_exclusions.get(node_id)
            scope_changed = (
                previous_scope != source.ignored_availability
                if previous_scope is not None
                else bool(source.ignored_availability)
            )
            if (
                scope_changed
                and source.availability_entities
                and any(
                    episode["anchor"] == node_id for episode in self.episodes.values()
                )
            ):
                # A different monitoring expectation cannot prove recovery.
                events.extend(self.engine.remove(node_id, now))
                events.extend(
                    self.engine.register_many([source.node(self.settings)], now)
                )
        self.device_exclusions = {
            node_id: source.ignored_availability
            for node_id, source in sources.items()
            if source.kind == "device"
        }
        observations = []
        for source in sources.values():
            if not source.watched:
                continue
            if source.report_timeout is not None:
                if first:
                    observations.append(report_observation(source, "unknown", now))
                continue
            if source.kind in {"entity", "situation"} and discover:
                state = (
                    self.hass.states.get(source.entity_id) if source.entity_id else None
                )
                observations.append(entity_observation(source, state, now))
            elif source.kind == "device" and discover:
                observations.append(self._observe_device(source, now))
            elif source.kind == "integration":
                observations.append(self._observe_entry(source, now))
        if observations:
            self._record_observations(observations)
            events.extend(self.engine.ingest_many(observations, now))
        else:
            events.extend(self.engine.advance(now))
        return events

    def _record_observations(self, observations: list[Observation]) -> None:
        for observation in observations:
            source = self.sources[observation.node_id]
            if source.kind == "integration":
                self.integration_evidence.observe(observation, source.name)
            elif source.kind in {"entity", "device"}:
                self.entity_evidence[source.node_id] = ReportedCondition(
                    reason=observation.reason,
                    message=observation.message or "",
                    observed_at=observation.observed_at,
                )
                if source.kind == "device":
                    self._device_signatures[source.node_id] = (
                        observation.status.value,
                        observation.reason,
                    )

    def _observe_entry(self, source: Source, now: datetime) -> Observation:
        assert source.entry_id is not None
        entry = self.hass.config_entries.async_get_entry(source.entry_id)
        if entry is not None and entry.state is ConfigEntryState.SETUP_RETRY:
            self.retry_since.setdefault(source.entry_id, now)
        elif entry is None or entry.state is not ConfigEntryState.SETUP_IN_PROGRESS:
            self.retry_since.pop(source.entry_id, None)
        reauth = any(
            flow["context"].get("source") == "reauth"
            and flow["context"].get("entry_id") == source.entry_id
            for flow in self.hass.config_entries.flow.async_progress()
        )
        return entry_observation(
            source,
            entry,
            now,
            self.retry_since.get(source.entry_id),
            self.settings,
            reauth,
        )

    def _observe_device(self, source: Source, now: datetime) -> Observation:
        members = self._device_members.get(source.node_id[7:], ())
        states = tuple(self.hass.states.get(entity_id) for entity_id in members)
        return device_observation(source, states, now)

    def _handle(
        self, events: list[HealthEvent], now: datetime, cause: Context | None = None
    ) -> None:
        assert self.policy is not None
        for event in events:
            if isinstance(event, EpisodeOpened | EpisodeUpdated | EpisodeResolved):
                self._episode_fact(event, cause)
            if isinstance(event, EpisodeOpened | EpisodeUpdated):
                self.episodes[event.episode.episode_id] = json_object(event.episode)
            elif isinstance(event, EpisodeResolved):
                self.history.record(event, self.sources.get(event.episode.anchor), now)
                self.episodes.pop(event.episode.episode_id, None)
            elif isinstance(event, ProbeRequested):
                # Reconciliation has already read the available HA evidence. A
                # cached entity update cannot establish physical freshness.
                continue
            self._deliveries(self.policy.handle(event, now, PolicyContext()))

    def _functions(self, episode: dict[str, JSONValue] | None) -> frozenset[str]:
        if episode is None:
            return frozenset()
        impact = episode["impact"]
        assert isinstance(impact, list)
        return frozenset(
            node_id
            for node_id in impact
            if isinstance(node_id, str)
            and node_id in self.sources
            and self.sources[node_id].kind == "function"
        )

    def _maintained(self) -> set[str]:
        assert self.engine is not None
        scope: set[str] = set()
        for control in self.controls:
            if control.action != "maintenance":
                continue
            scope.add(control.target)
            if control.include_dependents and control.target in self.sources:
                scope.update(
                    item.node_id for item in self.engine.impact(control.target).nodes
                )
        return scope

    def _acknowledged(self, episode_id: str) -> bool:
        assert self.policy is not None
        if not supports_attention_controls():
            return False
        try:
            return self.policy.acknowledgment(episode_id) is not None
        except KeyError:
            return False

    def _episode_fact(
        self,
        event: EpisodeOpened | EpisodeUpdated | EpisodeResolved,
        cause: Context | None,
    ) -> None:
        episode_id = event.episode.episode_id
        previous = self.episodes.get(episode_id)
        current = json_object(event.episode)
        before = self._functions(previous)
        after = (
            frozenset()
            if isinstance(event, EpisodeResolved)
            else self._functions(current)
        )
        if isinstance(event, EpisodeOpened):
            change = "opened"
        elif isinstance(event, EpisodeResolved):
            change = "resolved"
        elif previous is not None and signature(previous, before) == signature(
            current, after
        ):
            return
        else:
            change = "updated"
        anchor = event.episode.anchor
        data: dict[str, JSONValue] = {
            "schema_version": FACT_SCHEMA_VERSION,
            "entry_id": self.entry.entry_id,
            "change": change,
            "episode_id": episode_id,
            "form": event.episode.form,
            **anchor_identity(anchor, self.sources.get(anchor)),
            "status": current["status"],
            "importance": current["importance"],
            "reasons": reasons(current),
            "function_ids": [node_id for node_id in sorted(after or before)],
            "functions": [
                self.sources[node_id].name for node_id in sorted(after or before)
            ],
            "opened_at": current["opened_at"],
            "shelved": any(
                control.action == "shelve" and control.target == episode_id
                for control in self.controls
            ),
            "maintenance": anchor in self._maintained(),
            "acknowledged": self._acknowledged(episode_id),
        }
        if isinstance(event, EpisodeResolved):
            data["resolution"] = event.resolution
            data["absorbed_into"] = event.absorbed_into
        self._facts.append(
            Fact(
                event_type=EVENT_EPISODE,
                data=data,
                context=child_context(cause),
                functions_before=before,
                functions_after=after,
            )
        )

    def _control_data(
        self,
        change: str,
        *,
        kind: str,
        episode_id: str | None = None,
        control: OperatorControl | None = None,
        ended_reason: str | None = None,
    ) -> dict[str, JSONValue]:
        data: dict[str, JSONValue] = {
            "schema_version": FACT_SCHEMA_VERSION,
            "entry_id": self.entry.entry_id,
            "change": change,
            "kind": kind,
            "control_id": None,
            "episode_id": episode_id,
            "node_id": None,
            "include_dependents": False,
            "until": None,
            "reason": "",
        }
        if control is not None:
            data |= {
                "control_id": control.control_id,
                "episode_id": control.target if control.action == "shelve" else None,
                "node_id": control.target if control.action == "maintenance" else None,
                "include_dependents": control.include_dependents,
                "until": control.until.isoformat(),
                "reason": control.reason,
            }
        if change == "ended":
            data["ended_reason"] = ended_reason
        return data

    def _control_fact(
        self,
        change: str,
        control: OperatorControl,
        *,
        ended_reason: str | None = None,
        context: Context | None = None,
    ) -> None:
        self._facts.append(
            Fact(
                event_type=EVENT_CONTROL,
                data=self._control_data(
                    change,
                    kind=control.action,
                    control=control,
                    ended_reason=ended_reason,
                ),
                # An action reuses its call's context so HA attributes the
                # user; an expiry has no cause but time.
                context=context or Context(),
            )
        )

    def _publish_facts(self) -> None:
        facts, self._facts = self._facts, []
        for fact in facts:
            self.hass.bus.async_fire(fact.event_type, fact.data, context=fact.context)
            if fact.event_type == EVENT_EPISODE:
                async_dispatcher_send(self.hass, self.fact_signal, fact)

    def _deliveries(self, deliveries: list[Delivery]) -> None:
        if not self.settings.notifications or self._activating:
            return
        self.delivery.prepare_reports(deliveries)
        for delivery in deliveries:
            content = (
                self._content(delivery.episode_id)
                if isinstance(delivery, Notification)
                else {}
            )
            self.delivery.record(
                delivery, content, startup=self._quiet_since is not None
            )

    def _content(self, episode_id: str) -> dict[str, JSONValue]:
        assert self.engine is not None
        episode = self.episodes[episode_id]
        anchor = str(episode["anchor"])
        source = self.sources[anchor]
        functions = [
            self.sources[item.node_id]
            for item in self.engine.impact(anchor).nodes
            if self.sources[item.node_id].kind == "function"
        ]
        names: list[JSONValue] = [item.name for item in functions]
        title = source.name
        if functions:
            title = f"{', '.join(item.name for item in functions)}: {self.engine.readiness([item.node_id for item in functions]).answer}"
        findings = episode["reasons"]
        assert isinstance(findings, list)
        message = (
            "\n".join(
                str(finding.get("message") or finding["reason"])
                for finding in findings
                if isinstance(finding, dict)
            )
            or "Current evidence is unknown."
        )
        return {
            "schema_version": 1,
            "entry_id": self.entry.entry_id,
            "episode_id": episode_id,
            "tag": self.notification_id(episode_id),
            "title": title,
            "age": f"{max(0, int((dt_util.utcnow() - datetime.fromisoformat(str(episode['opened_at']))).total_seconds()) // 3600)}h",
            "message": message,
            "functions": names,
            "cause": anchor,
            "loudness": "urgent"
            if episode["importance"] == Importance.CRITICAL.value
            else "notify",
        }

    async def _flush_events(self) -> None:
        for episode_id in self._legacy_notifications:
            persistent_notification.async_dismiss(
                self.hass, self.notification_id(episode_id)
            )
        self._legacy_notifications.clear()
        if not self.delivery.outbox:
            return
        pending = list(self.delivery.outbox)
        for payload in pending:
            self.hass.bus.async_fire(
                EVENT_NOTIFICATION,
                {key: value for key, value in payload.items() if key != "_alerting"},
            )
        self.delivery.outbox.clear()
        try:
            await self._save()
        except OSError, HomeAssistantError, ValueError, TypeError:
            self.delivery.outbox[:0] = pending
            raise

    async def async_send_notification(self, payload: dict[str, Any]) -> None:
        """Attempt selected built-in routes once per durable delivery id."""
        if not self.settings.notifications:
            return
        delivery_id = payload.get("delivery_id")
        channels = payload.get("channels")
        if (
            not isinstance(delivery_id, str)
            or not delivery_id.startswith(f"{self.entry.entry_id}:")
            or not isinstance(channels, list)
        ):
            return
        recipient_id = payload.get("recipient")
        if not isinstance(recipient_id, str):
            return
        recipient = self._policy_config().recipients.get(recipient_id)
        if recipient is None:
            return
        permitted = set(recipient.channels)
        for channel in channels:
            if not isinstance(channel, str) or channel not in permitted:
                continue
            if not channel.startswith(("phone:", "notify:")):
                continue
            attempt = f"{delivery_id}:{channel}"
            async with self._lock:
                if attempt in self.delivery.attempted:
                    continue
                self.delivery.attempted.add(attempt)
                previous_actions = deepcopy(self.phone_actions.records)
                sent_to = (
                    self.policy.explain(str(payload["episode_id"]))["sent_to"]
                    if self.policy is not None
                    and payload.get("episode_id") in self.episodes
                    else []
                )
                acknowledgment = (
                    self.phone_actions.prepare(
                        self.hass, payload, channel, dt_util.utcnow()
                    )
                    if payload.get("episode_id") in self.episodes
                    and self.policy is not None
                    and not self._acknowledged(str(payload["episode_id"]))
                    and isinstance(sent_to, list)
                    and recipient_id in sent_to
                    else None
                )
                try:
                    await self._save()
                except OSError, HomeAssistantError, ValueError, TypeError:
                    self.delivery.attempted.remove(attempt)
                    self.phone_actions.records = previous_actions
                    raise
            try:
                await async_send(
                    self.hass,
                    channel,
                    title=str(payload.get("title", "Homeostatic")),
                    message=str(payload.get("message", "")),
                    tag=str(payload.get("tag", "")),
                    url=notification_url(payload),
                    **({"acknowledgment": acknowledgment} if acknowledgment else {}),
                    urgent=payload.get("loudness") == "urgent"
                    and payload.get("silent") is not True
                    and payload.get("action") != "resolve",
                    silent=payload.get("silent") is True,
                    clear=payload.get("action") == "resolve"
                    and payload.get("loudness") != "urgent",
                )
            except HomeAssistantError as err:
                self.delivery_failures.append(
                    {"delivery_id": delivery_id, "channel": channel, "error": str(err)}
                )

    def notification_id(self, episode_id: str) -> str:
        """Stable id for replacement and dismissal, scoped to this installation."""
        return f"{DOMAIN}_{self.entry.entry_id}_{episode_id}"

    def _schedule(self, now: datetime) -> None:
        if self._deadline_cancel is not None:
            self._deadline_cancel()
            self._deadline_cancel = None
        assert self.engine is not None
        assert self.policy is not None
        deadlines = [self.engine.next_deadline(), self.policy.next_deadline()]
        deadlines.extend(
            control.until for control in self.controls if control.until > now
        )
        if self._quiet_since is not None:
            deadlines.extend(
                self._quiet_since + self.settings.duration(key)
                for key in ("startup_grace", "startup_quiet_max")
                if self._quiet_since + self.settings.duration(key) > now
            )
        deadlines.extend(
            since + self.settings.duration("retry_hold")
            for since in self.retry_since.values()
            if since + self.settings.duration("retry_hold") > now
        )
        deadline = min((time for time in deadlines if time is not None), default=None)
        if deadline is not None:
            self._deadline_cancel = async_track_point_in_utc_time(
                self.hass, self._timer, max(deadline, now + timedelta(milliseconds=1))
            )

    def snapshot(self) -> dict[str, Any]:
        """Envelope holding opaque library state and adapter-owned presentation."""
        assert self.engine is not None
        assert self.policy is not None
        return {
            "schema_version": 2,
            "automation_alerts": deepcopy(self.automation_alerts.records),
            "phone_actions": deepcopy(self.phone_actions.records),
            "device_exclusions": {
                key: list(members) for key, members in self.device_exclusions.items()
            },
            "enrollment": {
                node_id: {key: list(values) for key, values in metadata.items()}
                for node_id, metadata in self.enrolled.items()
            },
            "resolved_history": self.history.snapshot(),
            "integration_evidence": self.integration_evidence.snapshot(),
            "operator_controls": presentation(self.controls),
            "engine": self.engine.snapshot(),
            "policy": self.policy.snapshot(),
            "policy_settings": self._policy_settings(),
            "episodes": self.episodes.copy(),
            "notifications": sorted(self.desired_notifications),
            "notifications_enabled": self.settings.notifications,
            "delivery": self.delivery.snapshot(),
            "retry_since": {
                key: value.isoformat() for key, value in self.retry_since.items()
            },
        }

    async def _save(self) -> None:
        snapshot = self.snapshot()
        await self.store.async_save(snapshot)
        # Store logs some write failures without raising. Read-back prevents
        # delivering a problem whose new persistence state was not accepted.
        if await self.store.async_load() != snapshot:
            raise HomeAssistantError("Homeostatic snapshot could not be saved")

    def _policy_settings(self) -> dict[str, Any]:
        return {"policy": self.settings.policy, "batch": self.settings.timings["batch"]}

    def preview_policy(self, data: dict[str, Any]) -> dict[str, JSONValue]:
        """Simulate activation in an isolated policy using its opaque public snapshot."""
        assert self.policy is not None
        settings = Settings.from_data(
            {**(self.entry.options or self.entry.data), "policy": data}
        )
        candidate = Policy(
            build_policy(
                self.automation_alerts.policy(settings), settings.duration("batch")
            )
        )
        now = dt_util.utcnow()
        candidate.restore(self.policy.snapshot(), now)
        deliveries = candidate.activate(now, PolicyContext())
        deliveries.extend(candidate.advance(now, PolicyContext()))
        return json_object(
            {
                "at": now,
                "episodes": explanations(candidate, list(self.episodes)),
                "deliveries": deliveries,
                "next_deadline": candidate.next_deadline(),
            }
        )

    def query(self, action: str, data: dict[str, Any]) -> dict[str, JSONValue]:
        """Read the public model for response-only HA actions."""
        if not self.available or self.engine is None:
            raise HomeAssistantError("Homeostatic is not ready")
        if action == "resolved_history":
            return self.history.view(dt_util.utcnow())
        if action == "preview_maintenance":
            return self._preview_maintenance(data, dt_util.utcnow())
        if action == "operator_controls":
            return {"controls": [json_object(control) for control in self.controls]}
        if action == "preview_policy":
            return self.preview_policy(data["policy"])
        if action == "policy":
            assert self.policy is not None
            return json_object(
                {
                    "episodes": explanations(self.policy, list(self.episodes)),
                    "next_deadline": self.policy.next_deadline(),
                    "routes": {
                        name: list(recipient.channels)
                        for name, recipient in self._policy_config().recipients.items()
                    },
                    "notifications_enabled": self.settings.notifications,
                    "reports": self.policy.reports(dt_util.utcnow()),
                    "unavailable_destinations": reporting.unavailable_destinations(
                        self.hass, self.settings.policy
                    ),
                    "reporting_missing": reporting.missing_profiles(choices)
                    if (choices := reporting.choices(self.settings.policy))
                    else [],
                }
            )
        if action == "functions":
            return json_object(
                {
                    "functions": describe(
                        self.hass,
                        self.settings,
                        self.sources,
                        self.candidates,
                        self.engine,
                    )
                }
            )
        if action == "preview_functions":
            proposed = {**(self.entry.options or self.entry.data), **data}
            proposed.update(normalize_definitions(self.hass, proposed))
            if "rules" in data:
                proposed["rules"] = normalize_rules(self.hass, data["rules"])
            settings = Settings.from_data(proposed)
            return preview(self.hass, settings, self.enrolled, self.settings.functions)
        if action == "preview_rules":
            candidate_data = normalize_rules(self.hass, data["rules"])
            settings = Settings.from_data(
                {"rules": candidate_data, "functions": [], "situations": []}
            )
            return report(
                inventory(self.hass, settings, self.enrolled),
                parse_rules(candidate_data),
            )
        if action == "inventory":
            return {**deepcopy(self.inventory_static), **self.inventory_updates()}
        if action == "coverage":
            return {
                **json_object(self.engine.coverage()),
                "notification_consumer_missing": self.consumer_missing,
            }
        if action == "readiness":
            nodes = data.get("node_ids", self.targets)
            if not nodes:
                return {"answer": "unknown", "nodes": [], "blocked_by": None}
            return json_object(self.engine.readiness(nodes))
        if action == "rollup":
            nodes = frozenset(data.get("node_ids", self.targets))
            return json_object(
                self.engine.rollup(
                    View(view_id="selection", groups={"selected": nodes}), "selected"
                )
            )
        if action == "impact":
            return json_object(self.engine.impact(data["node_id"]))
        return json_object(self.engine.explain(data["node_id"]))

    def device_evidence(self, node_id: str) -> dict[str, JSONValue] | None:
        """List current expected entity states for an on-demand detail view."""
        source = self.sources[node_id]
        if source.kind != "device":
            return None
        candidates = {
            item.entity_id: item for item in self.candidates.values() if item.entity_id
        }
        members: list[dict[str, JSONValue]] = []
        for entity_id in source.availability_entities:
            member = candidates[entity_id]
            state = self.hass.states.get(entity_id)
            members.append(
                {
                    "node_id": member.node_id,
                    "entity_id": entity_id,
                    "name": member.name,
                    "state": state.state if state is not None else "missing",
                    "restored": bool(state and state.attributes.get("restored")),
                }
            )
        members.sort(
            key=lambda item: (item["state"] != "unavailable", str(item["name"]))
        )
        return json_object(
            {
                "members": members[:50],
                "total": len(members),
                "reporting_count": sum(
                    item["state"] not in {"unknown", "missing", "unavailable"}
                    and not item["restored"]
                    for item in members
                ),
                "unavailable_count": sum(
                    item["state"] == "unavailable" for item in members
                ),
                "unknown_count": sum(
                    item["state"] in {"unknown", "missing"} or bool(item["restored"])
                    for item in members
                ),
            }
        )

    def entity_status(self, node_id: str) -> dict[str, JSONValue] | None:
        """Present captured HA state alongside current public library answers."""
        current = self.entity_evidence.get(node_id)
        if current is None:
            return None
        return {
            "current": json_object(current),
            "explanation": self.query("explain", {"node_id": node_id}),
            "readiness": self.query("readiness", {"node_ids": [node_id]}),
        }

    def inventory_updates(self) -> dict[str, JSONValue]:
        """Read dynamic inventory evidence without rebuilding catalog metadata."""
        return {
            "episodes": list(self.episodes.values()),
            "integration_evidence": {
                str(episode["anchor"]): self.integration_evidence.view(
                    str(episode["anchor"])
                )
                for episode in self.episodes.values()
                if self.sources[str(episode["anchor"])].kind == "integration"
            },
            "entity_status": {
                str(episode["anchor"]): self.entity_status(str(episode["anchor"]))
                for episode in self.episodes.values()
                if self.sources[str(episode["anchor"])].kind in {"entity", "device"}
            },
            "resolved_history": self.history.view(dt_util.utcnow()),
            "operator_controls": [json_object(control) for control in self.controls],
            "attention_controls_supported": supports_attention_controls(),
            "physical_freshness_supported": False,
            "notification_consumer_missing": self.consumer_missing,
            "situation_availability_verified": False,
            "notification_requests": list(self.delivery.messages.values()),
            "delivery_failures": to_json(list(self.delivery_failures)),
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    async def async_stop(self) -> None:
        """Cancel future work and save the final state before unloading."""
        self.running = False
        self._stopped = True
        for cancel in self._subscriptions:
            cancel()
        self._subscriptions.clear()
        for _, cancel in self._entries.values():
            cancel()
        self._entries.clear()
        if self._deadline_cancel is not None:
            self._deadline_cancel()
            self._deadline_cancel = None
        async with self._lock:
            if (
                self.engine is not None
                and self.policy is not None
                and self.saved is None
            ):
                try:
                    await self._drain_pending()
                    await self._save()
                    self._publish_facts()
                except (
                    OSError,
                    HomeAssistantError,
                    ValueError,
                    KeyError,
                    TypeError,
                ) as err:
                    self.error = str(err)
                    _LOGGER.error("Homeostatic final save failed: %s", err)
                    persistent_notification.async_create(
                        self.hass,
                        "Homeostatic stopped, but its latest state could not be saved. Check storage before restarting monitoring.",
                        NAME,
                        f"{DOMAIN}_{self.entry.entry_id}_error",
                    )
