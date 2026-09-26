"""Home Assistant lifecycle, observation, persistence, and delivery adapter."""

import asyncio
import logging
from collections import deque
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timedelta
from functools import partial
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
from homeassistant.core import Event, HomeAssistant, callback
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

from .attention import explanations
from .catalog import (
    Source,
    entity_observation,
    entity_state_signature,
    entry_observation,
)
from .config import Settings, normalize_definitions, normalize_rules, rule_data
from .const import DOMAIN, EVENT_NOTIFICATION, NAME, RECONCILE_INTERVAL, STORE_VERSION
from .controls import OperatorControl, expiry, presentation, restore_controls
from .delivery import DeliveryState
from .enrollment import evaluate, inventory, report, restore_enrollment
from .evidence import IntegrationEvidence, ReportedCondition
from .function_model import compose, describe, preview
from .history import ResolvedHistory
from .rules import Attributes, parse_rules
from .serialization import json_object

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
        self._legacy_notifications: set[str] = set()
        self._activating = False
        self._pending: deque[tuple[datetime, list[Observation]]] = deque()
        self.retry_since: dict[str, datetime] = {}
        self.saved: dict[str, Any] | None = None
        self.running = False
        self._stopped = False
        self.error: str | None = None
        self.updated_at: datetime | None = None
        self._entity_sources: dict[str, list[Source]] = {}
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
        if "resolved_history" in self.saved:
            self.history.restore(self.saved["resolved_history"])
        self.integration_evidence.restore(self.saved.get("integration_evidence", {}))
        self.controls = restore_controls(self.saved.get("operator_controls", []))
        self.enrolled = restore_enrollment(self.saved.get("enrollment", {}))
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
            self._pending.append(
                (
                    now,
                    [
                        entity_observation(source, event.data["new_state"], now)
                        for source in sources
                    ],
                )
            )
            self._request_refresh()
        elif metadata_changed or entity_id == self.settings.consumer:
            self._request_refresh()

    @callback
    def _entry_changed(self, entry: ConfigEntry) -> None:
        if self.running:
            source = self.sources[f"entry:{entry.entry_id}"]
            now = dt_util.utcnow()
            self._pending.append((now, [self._observe_entry(source, now)]))
            self._request_refresh()

    def _drain_pending(self) -> None:
        assert self.engine is not None
        assert self.policy is not None
        while self._pending:
            now, observations = self._pending.popleft()
            self._record_observations(observations)
            self._handle(self.engine.ingest_many(observations, now), now)
            self._deliveries(self.policy.advance(now, PolicyContext()))

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
        candidates = evaluate(inventory(self.hass, self.settings, self.enrolled), rules)
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
                        "reason": "match_attributes_changed"
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
        sources, self.targets = compose(self.hass, self.settings, candidates)
        self.enrolled = {
            node_id: source.attributes
            for node_id, source in sources.items()
            if source.kind in {"entity", "integration"}
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
                    self._drain_pending()
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
        if not self.settings.notifications:
            self.delivery.deactivate()
        await self._save()
        if self.running:
            await self._flush_events()
        self.error = None
        self.updated_at = now
        persistent_notification.async_dismiss(
            self.hass, f"{DOMAIN}_{self.entry.entry_id}_error"
        )
        if self.running:
            self._schedule(now)

    def _prune_controls(self, now: datetime) -> None:
        self.controls = [
            control
            for control in self.controls
            if control.until > now
            and control.target
            in (self.episodes if control.action == "shelve" else self.sources)
        ]

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
        self, action: str, data: dict[str, Any], user_id: str | None, now: datetime
    ) -> dict[str, JSONValue]:
        assert self.engine is not None
        assert self.policy is not None
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
        return {**response, "control": json_object(control)}

    async def async_control(
        self, action: str, data: dict[str, Any], user_id: str | None
    ) -> dict[str, JSONValue]:
        """Serialize an authorized operator action and confirm durable storage."""
        async with self._lock:
            if not self.available:
                raise HomeAssistantError("Homeostatic is not ready")
            now = dt_util.utcnow()
            invalid: ValueError | KeyError | None = None
            response: dict[str, JSONValue] = {}
            try:
                self._drain_pending()
                self._handle(self._evaluate(now), now)
                self._prune_controls(now)
                try:
                    response = self._apply_control(action, data, user_id, now)
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
                    "Could not confirm operator control; inspect controls after recovery"
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
            self.policy = Policy(self.settings.policy_config())
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
            self._entity_sources = {}
            for source in sources.values():
                if source.entity_id and source.watched:
                    self._entity_sources.setdefault(source.entity_id, []).append(source)
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
            events = self.engine.restore(self.saved["engine"], now)
            self.saved = None
        observations = []
        for source in sources.values():
            if not source.watched:
                continue
            if source.kind in {"entity", "situation"} and discover:
                state = (
                    self.hass.states.get(source.entity_id) if source.entity_id else None
                )
                observations.append(entity_observation(source, state, now))
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
            elif source.kind == "entity":
                self.entity_evidence[source.node_id] = ReportedCondition(
                    reason=observation.reason,
                    message=observation.message or "",
                    observed_at=observation.observed_at,
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

    def _handle(self, events: list[HealthEvent], now: datetime) -> None:
        assert self.policy is not None
        for event in events:
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

    def _deliveries(self, deliveries: list[Delivery]) -> None:
        if not self.settings.notifications or self._activating:
            return
        for delivery in deliveries:
            content = (
                self._content(delivery.episode_id)
                if isinstance(delivery, Notification)
                else {}
            )
            self.delivery.record(delivery, content)

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
        candidate = Policy(settings.policy_config())
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
                        for name, recipient in self.settings.policy_config().recipients.items()
                    },
                    "notifications_enabled": self.settings.notifications,
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
                if self.sources[str(episode["anchor"])].kind == "entity"
            },
            "resolved_history": self.history.view(dt_util.utcnow()),
            "operator_controls": [json_object(control) for control in self.controls],
            "physical_freshness_supported": False,
            "notification_consumer_missing": self.consumer_missing,
            "situation_availability_verified": False,
            "notification_requests": list(self.delivery.messages.values()),
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
                    self._drain_pending()
                    await self._save()
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
