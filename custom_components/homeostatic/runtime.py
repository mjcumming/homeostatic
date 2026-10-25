"""Home Assistant lifecycle, observation, persistence, and delivery adapter."""

import asyncio
import gc
import hashlib
import logging
from collections import Counter, deque
from collections.abc import Callable
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta
from functools import partial
from operator import ne
from time import perf_counter
from typing import Any, cast
from uuid import uuid4

from health_tree.engine import Engine
from health_tree.policy import Policy
from health_tree.types import (
    Delivery,
    EpisodeOpened,
    EpisodeResolved,
    EpisodeUpdated,
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
from homeassistant.components.automation import EVENT_AUTOMATION_RELOADED
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    SOURCE_IGNORE,
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
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers import label_registry as lr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.event import (
    async_call_later,
    async_track_point_in_utc_time,
    async_track_time_interval,
)
from homeassistant.helpers.json import prepare_save_json
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import notification_definitions
from .attention import build_policy, explanations
from .automation_alerts import MAX_ALERTS, AutomationAlerts, automation_owner, identity
from .catalog import Source
from .config import Settings, normalize_definitions
from .const import (
    DOMAIN,
    EVENT_CONTROL,
    EVENT_EPISODE,
    NAME,
    SAVE_COALESCE_SECONDS,
    STORE_VERSION,
    SWEEP_INTERVAL,
)
from .controls import OperatorControl, expiry, presentation, restore_controls
from .enrollment import (
    evaluate,
    inventory,
    report,
    restore_enrollment,
)
from .entity_not_provided import sources as not_provided_sources
from .evidence import ReportedEvidence
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
from .monitoring import TEMPERATURE_CHECKS
from .monitoring_runtime import (
    assignments,
    enrollment_rules,
    left_open_sources,
    ordinary_sources,
    original_identity,
    restore_entity_identities,
    temperature_sources,
    thermostat_enrolled,
    ups_sources,
)
from .notification_routes import unavailable_destinations
from .notifications import NotificationContext, Notifications
from .producers import CapturedInput, Producers
from .reported_conditions import CONDITIONS
from .rules import Attributes
from .serialization import json_digest, json_object, to_json
from .situation_reports import report_observation

_LOGGER = logging.getLogger(__name__)
_SAVE_TIMING_LOGGER = logging.getLogger(f"{__package__}.save_timing")


def _event_summary(counts: Counter[str]) -> str:
    """Render engine event type counts for the refresh trace."""
    return (
        ",".join(f"{name}:{count}" for name, count in sorted(counts.items())) or "none"
    )


def _new_window() -> dict[str, Any]:
    """Start a fresh counter window for the periodic timing summary."""
    return {
        "started": perf_counter(),
        "refreshes": Counter[str](),
        "discoveries": 0,
        "saves": 0,
        "deferred": 0,
        "skipped": 0,
        "evaluation_seconds": 0.0,
        "snapshot_seconds": 0.0,
        "gc_long": 0,
        "gc_seconds": 0.0,
    }


class Runtime:
    """Serialize engine calls and publish durable adapter state on the HA loop."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        settings: Settings,
        *,
        settings_conversion: dict[str, Any] | None = None,
    ) -> None:
        """Prepare storage and listeners without starting the engine clock."""
        self.hass = hass
        self.entry = entry
        self.settings = settings
        self._settings_conversion = settings_conversion
        self.store: Store[dict[str, Any]] = Store(
            hass,
            STORE_VERSION,
            f"{DOMAIN}.{entry.entry_id}",
            atomic_writes=True,
            serialize_in_event_loop=False,
        )
        self.signal = f"{DOMAIN}_{entry.entry_id}_updated"
        self.fact_signal = f"{DOMAIN}_{entry.entry_id}_fact"
        self._facts: list[Fact] = []
        self.engine: Engine | None = None
        self.policy: Policy | None = None
        self._compiled_policy: PolicyConfig | None = None
        self._compiled_settings: Settings | None = None
        self.sources: dict[str, Source] = {}
        self.targets: list[str] = []
        self.enrolled: dict[str, Attributes] = {}
        self.candidates: dict[str, Source] = {}
        self._monitoring_identities: dict[str, str] = {}
        self.enrollment_changes: deque[dict[str, JSONValue]] = deque(maxlen=50)
        self._discovered = False
        self.episodes: dict[str, dict[str, JSONValue]] = {}
        self.history = ResolvedHistory()
        self._resolved_sources: dict[str, Source] = {}
        # One map holds the latest observation of every source (audit step 2).
        self.evidence = ReportedEvidence()
        self.controls: list[OperatorControl] = []
        self.notifications = Notifications(hass, entry.entry_id)
        self.producers = Producers(hass)
        self.automation_alerts = AutomationAlerts()
        self._repairs_dirty = True
        self._broken_full = True
        self._broken_named: set[str] = set()
        self._broken_created: set[str] = set()
        self._activating = False
        self._activating_routes: set[str] | None = None
        self.fresh_start = False
        self._quiet_since: datetime | None = None
        self._pending: deque[
            tuple[
                datetime,
                list[Observation],
                Context | None,
                tuple[CapturedInput, ...],
            ]
        ] = deque()
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
        self._refresh_causes: set[str] = set()
        self._save_required = False
        self._save_pending = False
        self._pending_save_cancel: Callable[[], None] | None = None
        self._stored_digest: str | None = None
        self._refresh_events: Counter[str] = Counter()
        self._scan: tuple[Any, dict[str, Source]] | None = None
        self._lock_holder: str | None = None
        self._gc_started: float | None = None
        self._window = _new_window()
        self._refresh_requested = False
        self._reconcile_requested = False
        self._lock = asyncio.Lock()
        self._subscriptions: list[Callable[[], None]] = []
        self._entries: dict[str, tuple[ConfigEntry, Callable[[], None]]] = {}
        self._deadline_cancel: Callable[[], None] | None = None

    @property
    def desired_notifications(self) -> set[str]:
        """Episode ids represented in the last requested notification information."""
        return self.notifications.delivery.episode_ids

    @property
    def consumer_missing(self) -> bool:
        """An enabled notification route needs an enabled consumer automation."""
        if any(
            channel.startswith(("phone:", "notify:", "method:"))
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
        """Count missing evidence for monitored checks and incomplete functions."""
        if self.engine is None:
            return 0
        return self.evidence_gaps_from_coverage(self.query("coverage", {}))

    def evidence_gaps_from_coverage(self, coverage: dict[str, JSONValue]) -> int:
        """Count gaps from one current public coverage result without requerying."""
        required = {
            requirement
            for source in self.sources.values()
            if source.kind == "function"
            for requirement in source.requirements
        }
        return (
            int(bool(coverage["notification_consumer_missing"]))
            + sum(
                (
                    (
                        self.sources[node_id].watched
                        or node_id in required
                        or self.sources[node_id].kind in {"function", "external"}
                    )
                    and (
                        self.sources[node_id].kind != "function"
                        or not self.sources[node_id].requirements
                    )
                )
                for node_id in cast(list[str], coverage["no_checks"])
            )
            + len(
                {
                    (reference["node_id"], reference["check_id"])
                    for field in ("never_observed", "stale")
                    for reference in cast(list[dict[str, str]], coverage[field])
                }
            )
        )

    async def async_load(self) -> None:
        """Read and validate the envelope before Home Assistant starts."""
        self.saved = await self.store.async_load()
        if self.saved is None:
            return
        if not isinstance(self.saved, dict):
            raise ValueError("Invalid Homeostatic snapshot envelope")
        version = self.saved.get("schema_version")
        if type(version) is not int or version not in {2, 3}:
            raise ValueError("Unsupported Homeostatic snapshot version")
        for key in ("engine", "policy", "episodes", "retry_since"):
            if not isinstance(self.saved.get(key), dict):
                raise ValueError(f"Invalid stored {key}")
        identities = self.saved.get(
            "monitoring_identities", {} if version == 2 else None
        )
        if not isinstance(identities, dict) or any(
            not isinstance(identity, str)
            or not isinstance(bound, str)
            or not identity.startswith("monitoring:")
            or not bound.startswith("monitoring:")
            or len(identity.split(":", 3)) != 4
            or len(bound.split(":", 3)) != 4
            or identity.split(":", 2)[1] != bound.split(":", 2)[1]
            or original_identity(identity) != original_identity(bound)
            for identity, bound in identities.items()
        ):
            raise ValueError("Invalid stored monitoring identities")
        self._monitoring_identities = dict(identities)
        self.notifications.restore(self.saved)
        if type(self.saved.get("notifications_enabled")) is not bool:
            raise ValueError("Invalid notification activation state")
        self.automation_alerts.restore(self.saved.get("automation_alerts", {}))
        self.producers.restore(self.saved)
        if "resolved_history" in self.saved:
            self.history.restore(self.saved["resolved_history"])
        stored_evidence = self.saved.get("evidence")
        if stored_evidence is None:
            # Snapshots before audit step 2 kept two sections.
            integration = self.saved.get("integration_evidence", {})
            checks = self.saved.get("check_evidence", {})
            stored_evidence = (
                {**integration, **checks}
                if isinstance(integration, dict) and isinstance(checks, dict)
                else integration
                if not isinstance(integration, dict)
                else checks
            )
        self.evidence.restore(
            stored_evidence,
            history_complete="evidence" in self.saved or "check_evidence" in self.saved,
        )
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
                hass.bus.async_listen(
                    EVENT_AUTOMATION_RELOADED, self._automations_reloaded
                ),
                hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, self._stop_event),
                hass.bus.async_listen(
                    er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed
                ),
                async_dispatcher_connect(
                    hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._config_entry_changed
                ),
                async_track_time_interval(hass, self._sweep_timer, SWEEP_INTERVAL),
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
        self._subscriptions.append(
            hass.bus.async_listen(
                ir.EVENT_REPAIRS_ISSUE_REGISTRY_UPDATED, self._repairs_changed
            )
        )
        if self.fresh_start:
            self._quiet_since = dt_util.utcnow()
        if self._on_gc not in gc.callbacks:
            gc.callbacks.append(self._on_gc)
        # The first refresh after startup persists at once (ADR 0096).
        self._save_required = True
        await self.async_refresh(cause="start")

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
            or old.attributes.get("unit_of_measurement")
            != new.attributes.get("unit_of_measurement")
        )
        if metadata_changed:
            self._inventory_dirty = True
        if (
            entity_id.startswith("climate.")
            and thermostat_enrolled(old) != thermostat_enrolled(new)
            and any(
                not candidate.disabled
                and item.enabled
                and item.check == "thermostat"
                and item.matches(candidate.attributes, source_id=candidate.node_id)
                for identity in (
                    f"entity:entity_id:{entity_id}",
                    f"entity:registry:{registered.id}" if registered else "",
                )
                if (candidate := self.candidates.get(identity)) is not None
                for item in self.settings.monitoring_policies
            )
        ):
            self._inventory_dirty = True
            self._request_refresh()
        observed_sources = self.producers.changed_sources(sources, old, new)
        if observed_sources:
            now = dt_util.utcnow()
            observations, producer_states = self.producers.capture_entity(
                observed_sources, entity_id, new, self.settings, now
            )
            if observations or producer_states:
                self._pending.append(
                    (now, observations, event.context, producer_states)
                )
                self._request_refresh()
            elif metadata_changed:
                self._request_refresh()
        elif metadata_changed or entity_id == self.settings.consumer:
            self._request_refresh()

    @callback
    def _entry_changed(self, entry: ConfigEntry) -> None:
        if self.running:
            now = dt_util.utcnow()
            observations = self.producers.capture_entry(
                self.sources.values(), entry.entry_id, self.settings, now
            )
            self._pending.append((now, observations, None, ()))
            self._request_refresh(cause="config_entry")

    async def _drain_pending(self) -> None:
        assert self.engine is not None
        assert self.policy is not None
        processed = 0
        slice_started = perf_counter()
        while self._pending:
            now, observations, cause, producer_states = self._pending.popleft()
            for captured in producer_states:
                node_id = captured.node_id
                source = self.sources.get(node_id)
                if source is None:
                    continue
                observation = self.producers.observe_captured(
                    source, captured, self.settings, now
                )
                if observation is not None:
                    observations.append(observation)
                if self.producers.take_restarts(node_id):
                    self._handle(self.engine.remove(node_id, now), now, cause)
                    self._handle(
                        self.engine.register_many([source.node(self.settings)], now),
                        now,
                        cause,
                    )
            observations = [
                item for item in observations if item.node_id in self.sources
            ]
            if observations:
                self._record_observations(observations)
                self._handle(self.engine.ingest_many(observations, now), now, cause)
            self._deliveries(self.policy.advance(now, PolicyContext()), now)
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
        if event.event_type == er.EVENT_ENTITY_REGISTRY_UPDATED:
            action = event.data["action"]
            if action == "remove":
                self._broken_named.add(event.data["entity_id"])
            elif action == "create":
                self._broken_created.add(event.data["entity_id"])
            elif action == "update" and "old_entity_id" in event.data:
                self._broken_named.add(event.data["old_entity_id"])
        self._request_refresh(cause="registry")

    @callback
    def _automations_reloaded(self, event: Event[Any]) -> None:
        self._broken_full = True
        self._request_refresh(cause="automations")

    @callback
    def _repairs_changed(self, event: Event[ir.EventIssueRegistryUpdatedData]) -> None:
        if event.data["domain"] != DOMAIN:
            self._repairs_dirty = True
            self._inventory_dirty = True
            self._request_refresh(cause="repairs")

    @callback
    def _config_entry_changed(
        self, change: ConfigEntryChange, entry: ConfigEntry
    ) -> None:
        if not self.running or entry.domain == DOMAIN:
            return
        candidate = self.candidates.get(f"entry:{entry.entry_id}")
        if (
            change is ConfigEntryChange.UPDATED
            and entry.source != SOURCE_IGNORE
            and candidate is not None
            and candidate.name == entry.title
            and candidate.disabled == (entry.disabled_by is not None)
            and candidate.attributes.get("domain") == (entry.domain,)
        ):
            # Entry lifecycle evidence is captured by the dedicated state listener;
            # nothing the catalog shows changed (ADR 0098).
            return
        self._inventory_dirty = True
        self._request_refresh(reconcile=True, cause="config_entry")

    @callback
    def _request_refresh(
        self, *, reconcile: bool = False, cause: str = "state"
    ) -> None:
        if self.running:
            self._refresh_requested = True
            self._reconcile_requested |= reconcile
            self._refresh_causes.add(cause)
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
                cause = ",".join(sorted(self._refresh_causes)) or "unknown"
                self._refresh_causes.clear()
                await self.async_refresh(reconcile=reconcile, cause=cause)
        finally:
            self._refresh_task = None

    async def _timer(self, now: datetime) -> None:
        self._request_refresh(cause="deadline")

    async def _sweep_timer(self, now: datetime) -> None:
        self._log_window()
        self._request_refresh(reconcile=True, cause="sweep")

    async def _stop_event(self, event: Event[Any]) -> None:
        await self.async_stop()

    def _scan_key(self) -> Any:
        """Identify the settings the registry scan reads: selections, never exclusions."""
        return (
            self.settings.functions,
            tuple(
                (policy.match, policy.enabled)
                for policy in self.settings.monitoring_policies
            ),
        )

    def _discover(self, *, rescan: bool = True) -> dict[str, Source]:
        rules = (*enrollment_rules(self.settings.monitoring_policies),)
        key = self._scan_key()
        cached = self._scan
        if not rescan and cached is not None and cached[0] == key:
            # A rule or exclusion edit changes no registry: re-evaluate the last
            # scan. Metadata retained for vanished sources refreshes at the next
            # reconciliation, which always scans.
            discovered = cached[1]
        else:
            discovered = inventory(self.hass, self.settings, self.enrolled)
            cached = (key, discovered)
        discovered = self.producers.retained_candidates(discovered, self.candidates)
        candidates = evaluate(
            discovered,
            rules,
            previous=self.candidates,
            previous_rules=(
                (*enrollment_rules(self._compiled_settings.monitoring_policies),)
                if self._compiled_settings is not None
                else None
            ),
        )
        selected_ups = ups_sources(self.settings.monitoring_policies, candidates)
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
        changes: deque[dict[str, object]] = deque(maxlen=self.enrollment_changes.maxlen)
        for node_id, source in candidates.items():
            previous = self.candidates.get(node_id)
            if not self._discovered:
                continue
            if previous is not None and (
                previous.watched,
                previous.attached_by,
            ) != (source.watched, source.attached_by):
                changes.append(
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
                        "before": previous,
                        "after": source,
                    }
                )
            elif previous is None and source.watched:
                changes.append(
                    {
                        "node_id": node_id,
                        "at": at,
                        "batch": batch,
                        "reason": "source_enrolled",
                        "after": source,
                    }
                )
        for node_id in self.candidates.keys() - candidates.keys():
            previous = self.candidates[node_id]
            if previous.watched:
                changes.append(
                    {
                        "node_id": node_id,
                        "at": at,
                        "batch": batch,
                        "reason": "source_removed",
                        "before": previous,
                    }
                )
        self.enrollment_changes.extend(json_object(change) for change in changes)
        self._discovered = True
        self.candidates = candidates
        sources, self.targets = compose(
            self.hass, self.automation_alerts.compose(self.settings), candidates
        )
        sources.update(self.automation_alerts.sources(self.settings))
        sources.update(selected_ups)
        open_episodes = (
            self.saved["episodes"] if self.saved is not None else self.episodes
        )
        open_anchors = {
            original_identity(str(episode["anchor"]))
            for episode in open_episodes.values()
        }
        self.producers.repairs.prune(open_anchors)
        self.producers.broken.prune(open_anchors)
        sources.update(self.producers.repairs.sources())
        sources.update(self.producers.broken.sources())
        sources.update(
            temperature_sources(
                self.hass, self.settings.monitoring_policies, candidates
            )
        )
        sources.update(
            left_open_sources(self.hass, self.settings.monitoring_policies, candidates)
        )
        sources.update(
            not_provided_sources(self.settings.monitoring_policies, candidates)
        )
        sources = ordinary_sources(
            self.settings.monitoring_policies, sources, candidates=candidates
        )
        sources, self._monitoring_identities = restore_entity_identities(
            sources,
            self._monitoring_identities,
            self.settings.monitoring_policies
            if self.saved is not None and self.saved["schema_version"] == 2
            else (),
        )
        targets = set(self.targets)
        self.targets = [
            identity
            for identity, source in sources.items()
            if (source.watched or source.kind == "function")
            and (identity in targets or source.monitoring_source in targets)
        ]
        self.enrolled = {
            source.monitoring_source or node_id: source.attributes
            for node_id, source in sources.items()
            if source.kind
            in {
                "entity",
                "integration",
                "device",
                "battery",
                "vacuum",
                "lock",
                *CONDITIONS,
            }
            or (source.kind == "ups" and source.monitoring_policy is None)
        }
        self._scan = cached
        return sources

    def _listen_entries(self) -> None:
        selected = {
            source.entry_id
            for source in self.sources.values()
            if source.entry_id and source.watched
        } | {
            source.owner_id
            for source in self.sources.values()
            if source.kind == "entity_not_provided"
            and source.owner_id
            and source.watched
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

    def _monitoring_routes(self) -> dict[str, dict[str, Any]]:
        # Source edits can remove another route's record-only fallback rules.
        # Those compiled differences do not change this route's reporting clock.
        return {
            f"policy_{item.id}_{row['id']}": row
            for item in self.settings.monitoring_policies
            if item.enabled
            for row in notification_definitions.resolve_rows(
                self.settings.notification_definitions, item.notifications
            )
        }

    def can_apply_settings(self, settings: Settings) -> bool:
        """Keep monitoring and reusable notification edits in the running instance."""
        definitions = {
            **self.settings.notification_definitions,
            "profiles": settings.notification_definitions["profiles"],
            "methods": settings.notification_definitions["methods"],
        }
        if definitions != settings.notification_definitions:
            return False
        if definitions != self.settings.notification_definitions and tuple(
            replace(item, notifications=())
            for item in self.settings.monitoring_policies
        ) != tuple(
            replace(item, notifications=()) for item in settings.monitoring_policies
        ):
            return False
        return (
            replace(
                self.settings,
                monitoring_policies=settings.monitoring_policies,
                notification_definitions=definitions,
                policy=notification_definitions.generate(definitions),
            )
            == settings
        )

    async def async_apply_settings(self, settings: Settings) -> None:
        """Reconcile a monitoring draft and verify storage before publishing it."""
        phase_started = perf_counter()
        holder = self._lock_holder
        async with self._lock:
            _SAVE_TIMING_LOGGER.debug(
                "phase=runtime_lock seconds=%.6f holder=%s",
                perf_counter() - phase_started,
                holder or "none",
            )
            self._lock_holder = "save"
            if not self.running or not self.available:
                raise HomeAssistantError("Homeostatic is unavailable")
            if not self.can_apply_settings(settings):
                raise ValueError("These settings require an integration reload")
            phase_started = perf_counter()
            await self._drain_pending()
            _SAVE_TIMING_LOGGER.debug(
                "phase=pending_observations seconds=%.6f",
                perf_counter() - phase_started,
            )
            phase_started = perf_counter()
            assert self.engine is not None
            assert self.policy is not None
            now = dt_util.utcnow()
            phase_started = perf_counter()
            definitions_changed = (
                self.settings.notification_definitions
                != settings.notification_definitions
            )
            # Registry changes during a definition save do not change its instructions.
            route_sources = dict(self.sources)
            routes = (
                self._route_signatures(sources=route_sources)
                if definitions_changed
                else self._monitoring_routes()
            )
            _SAVE_TIMING_LOGGER.debug(
                "phase=routes_before seconds=%.6f", perf_counter() - phase_started
            )
            reconcile = tuple(
                replace(item, name="", notifications=())
                for item in self.settings.monitoring_policies
            ) != tuple(
                replace(item, name="", notifications=())
                for item in settings.monitoring_policies
            )
            previous_names = {
                item.id: item.name for item in self.settings.monitoring_policies
            }
            names_only = (
                self.settings != settings
                and replace(
                    settings,
                    monitoring_policies=tuple(
                        replace(item, name=previous_names.get(item.id, item.name))
                        for item in settings.monitoring_policies
                    ),
                )
                == self.settings
            )
            applied_from = self.settings
            try:
                phase_started = perf_counter()
                self.settings = settings
                events = self._evaluate(
                    now, reconcile=reconcile, rescan=self._inventory_dirty
                )
                self._handle(
                    events,
                    now,
                    renamed_sources={
                        node_id: (route_sources[node_id].name, source.name)
                        for node_id, source in self.sources.items()
                        if names_only
                        and node_id in route_sources
                        and source.name != route_sources[node_id].name
                    },
                )
                _SAVE_TIMING_LOGGER.debug(
                    "phase=evaluation seconds=%.6f", perf_counter() - phase_started
                )
                phase_started = perf_counter()
                current_routes = (
                    self._route_signatures(sources=route_sources)
                    if definitions_changed
                    else self._monitoring_routes()
                )
                changed_routes = {
                    route
                    for route in routes.keys() | current_routes.keys()
                    if routes.get(route) != current_routes.get(route)
                }
                if self.settings.notifications and changed_routes:
                    self._activating = True
                    self._activating_routes = changed_routes
                _SAVE_TIMING_LOGGER.debug(
                    "phase=routes_after seconds=%.6f", perf_counter() - phase_started
                )
                phase_started = perf_counter()
                await self._complete(now, durable=True)
                _SAVE_TIMING_LOGGER.debug(
                    "phase=complete seconds=%.6f", perf_counter() - phase_started
                )
                if not self.running:
                    raise HomeAssistantError(
                        "Homeostatic stopped while applying settings"
                    )
            except (
                OSError,
                HomeAssistantError,
                ValueError,
                KeyError,
                TypeError,
            ) as err:
                # The store holds the last verified state and the config entry
                # keeps its previous options: report, go unavailable and reload
                # from them instead of rolling back in process (ADR 0100).
                # Reads until the reload completes must show the saved settings.
                self.settings = applied_from
                self._failed(err)
                if self.running:
                    self.hass.config_entries.async_schedule_reload(self.entry.entry_id)
                raise
            finally:
                self._lock_holder = None
                async_dispatcher_send(self.hass, self.signal)

    async def async_refresh(
        self, *, reconcile: bool = True, cause: str = "direct"
    ) -> None:
        """Process captured evidence, optionally reconcile, then persist deliveries."""
        waited = perf_counter()
        async with self._lock:
            lock_wait = perf_counter() - waited
            if not self.running:
                return
            self._lock_holder = f"refresh:{cause}"
            now = dt_util.utcnow()
            discover = False
            evaluation = 0.0
            try:
                if self.engine is not None:
                    await self._drain_pending()
                    now = dt_util.utcnow()
                    if self.automation_alerts.prune_removed_owners(self.hass):
                        self._inventory_dirty = True
                if reconcile or self._repairs_dirty:
                    self._repairs_dirty = False
                    if await self.producers.repairs.async_read(self.hass):
                        self._inventory_dirty = True
                    now = dt_util.utcnow()
                if self._broken_full or self._broken_named or self._broken_created:
                    full = self._broken_full
                    named = set(self._broken_named)
                    created = set(self._broken_created)
                    self._broken_full = False
                    self._broken_named.clear()
                    self._broken_created.clear()
                    if self.producers.broken.scan(
                        self.hass, full=full, named=named, created=created
                    ):
                        self._inventory_dirty = True
                discover = reconcile or self._inventory_dirty or self.engine is None
                phase_started = perf_counter()
                events = self._evaluate(now, reconcile=reconcile)
                self._handle(events, now)
                evaluation = perf_counter() - phase_started
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
                self._lock_holder = None
                self._note_refresh(
                    cause,
                    reconcile,
                    discover,
                    lock_wait,
                    evaluation,
                    perf_counter() - waited,
                )
                async_dispatcher_send(self.hass, self.signal)

    def _note_refresh(
        self,
        cause: str,
        reconcile: bool,
        discover: bool,
        lock_wait: float,
        evaluation: float,
        total: float,
    ) -> None:
        """Record one refresh for the periodic summary and the debug trace."""
        window = self._window
        window["refreshes"][cause] += 1
        window["discoveries"] += int(discover)
        window["evaluation_seconds"] += evaluation
        _SAVE_TIMING_LOGGER.debug(
            "phase=refresh cause=%s reconcile=%s discover=%s lock_wait=%.6f"
            " evaluation=%.6f total=%.6f events=%s",
            cause,
            reconcile,
            discover,
            lock_wait,
            evaluation,
            total,
            _event_summary(self._refresh_events),
        )
        self._refresh_events.clear()

    def _log_window(self) -> None:
        """Emit one summary line per reconcile interval and start a new window."""
        window = self._window
        refreshes = cast(Counter[str], window["refreshes"])
        _SAVE_TIMING_LOGGER.debug(
            "phase=summary seconds=%.1f refreshes=%d causes=%s discoveries=%d"
            " saves=%d deferred=%d skipped=%d evaluation_seconds=%.3f snapshot_seconds=%.3f"
            " gc_long=%d gc_seconds=%.3f",
            perf_counter() - window["started"],
            sum(refreshes.values()),
            ",".join(f"{key}:{count}" for key, count in sorted(refreshes.items()))
            or "none",
            window["discoveries"],
            window["saves"],
            window["deferred"],
            window["skipped"],
            window["evaluation_seconds"],
            window["snapshot_seconds"],
            window["gc_long"],
            window["gc_seconds"],
        )
        self._window = _new_window()

    def _on_gc(self, phase: str, info: dict[str, int]) -> None:
        """Time garbage collections so long pauses can be matched to phases."""
        if phase == "start":
            self._gc_started = perf_counter()
            return
        started = self._gc_started
        self._gc_started = None
        if started is None:
            return
        elapsed = perf_counter() - started
        self._window["gc_seconds"] += elapsed
        if elapsed >= 0.1 or info.get("generation") == 2:
            self._window["gc_long"] += 1
            _SAVE_TIMING_LOGGER.debug(
                "phase=gc generation=%d collected=%d seconds=%.6f",
                info.get("generation", -1),
                info.get("collected", 0),
                elapsed,
            )

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

    async def _complete(self, now: datetime, *, durable: bool = False) -> None:
        assert self.policy is not None
        if self._activating:
            self._save_required = True
            self.notifications.delivery.deactivate(
                routes=self._activating_routes, preserve_pending=True
            )
            self._activating = False
            activated = (
                self.policy.activate(now, PolicyContext())
                if self._activating_routes is None
                else self.policy.activate(
                    now, PolicyContext(), routes=self._activating_routes
                )
            )
            self._deliveries(activated, now)
            self._activating_routes = None
        self._deliveries(self.policy.advance(now, PolicyContext()), now)
        self._prune_controls(now)
        self.history.advance(now)
        self._end_quiet(now)
        if self.notifications.advance(
            self.policy,
            now,
            enabled=self.settings.notifications,
            held=self.startup_quiet,
        ):
            self._save_required = True
        # A source can reject its stored state after engine/policy restoration.
        # Keep the original snapshot until the entire first pass has succeeded,
        # so failed retries and unload cannot save partially restored state.
        if self._settings_conversion is not None:
            # Only the actual startup restore/evaluation can accept saved state.
            # Persist conversion before state or requests, never on a failed pass.
            self.hass.config_entries.async_update_entry(
                self.entry, data=self._settings_conversion, options={}
            )
            self._settings_conversion = None
        self.saved = None
        # Facts and error recovery describe saved state, so they save at once.
        if (
            durable
            or self._save_required
            or self.notifications.delivery.outbox
            or self._facts
            or self.error is not None
            or not self.running
        ):
            await self._save()
        else:
            self._defer_save()
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
        if len(kept) != len(self.controls):
            self._save_required = True
        self.controls = kept

    def _maintenance_roots(self, node_id: str) -> list[str]:
        """Bind equipment maintenance to every policy monitoring that capability."""
        source = self.sources[node_id]
        if source.kind not in {"entity", "integration", "external"}:
            raise ValueError("Maintenance must start at an equipment capability")
        original = source.monitoring_source or node_id
        return list(
            dict.fromkeys(
                [
                    original,
                    *(
                        identity
                        for identity, candidate in self.sources.items()
                        if candidate.monitoring_source == original
                    ),
                ]
            )
        )

    def _maintenance_scope(self, node_id: str, include_dependents: bool) -> list[str]:
        assert self.engine is not None
        roots = self._maintenance_roots(node_id)
        scope = list(roots)
        if include_dependents:
            scope.extend(
                item.node_id
                for root in roots
                for item in self.engine.impact(root).nodes
            )
        if any(self.sources[item].kind == "situation" for item in scope):
            raise ValueError("Equipment maintenance cannot cover a situation")
        return list(dict.fromkeys(scope))

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
            if action == "acknowledge":
                target = data["episode_id"]
                if target not in self.episodes:
                    raise ValueError("Acknowledgment requires a current episode id")
                first = self.policy.acknowledgment(target) is None
                self._deliveries(
                    self.policy.acknowledge(target, now, actor_id=user_id), now
                )
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
            self._deliveries(self.policy.shelve(target, until, now), now)
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
            target = self.sources[target].monitoring_source or target
            for root in self._maintenance_roots(target):
                self._handle(
                    self.engine.quiet(
                        QuietWindow(
                            scope="node_and_dependents"
                            if data.get("include_dependents", False)
                            else "node",
                            node_id=root,
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
            monitoring_roots=tuple(self._maintenance_roots(target))
            if action != "shelve"
            else (),
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
            self._deliveries(
                self.policy.unshelve(control.target, now, PolicyContext()), now
            )
        else:
            for root in self._maintenance_roots(control.target):
                self._handle(
                    self.engine.cancel_quiet(
                        QuietWindow(
                            scope="node_and_dependents"
                            if control.include_dependents
                            else "node",
                            node_id=root,
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
        if action == "report_alert":
            key, row = self.automation_alerts.prepare(self.hass, self.settings, data)
        else:
            key = identity(
                automation_owner(self.hass, data["automation"]),
                data.get("alert_key", "default"),
            )
            if key not in self.automation_alerts.records:
                raise ValueError("Choose an existing automation alert")
            previous = self.automation_alerts.records[key]
            if (
                data["operation"] == "resume"
                and previous["retired"]
                and sum(
                    not item["retired"]
                    for item in self.automation_alerts.records.values()
                )
                >= MAX_ALERTS
            ):
                raise ValueError("Automation alert capacity reached")
            row = {
                **previous,
                "retired": data["operation"] == "retire",
            }
        changed = self.automation_alerts.records.get(key) != row
        self.automation_alerts.records[key] = row
        if self.automation_alerts.prune_removed_owners(self.hass):
            changed = True
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

    def _policy_config(
        self,
        settings: Settings | None = None,
        *,
        sources: dict[str, Source] | None = None,
    ) -> PolicyConfig:
        if (
            settings is None
            and sources is None
            and self.settings is self._compiled_settings
            and self._compiled_policy is not None
        ):
            return self._compiled_policy
        settings = settings or self.settings
        sources = self.sources if sources is None else sources
        definitions = deepcopy(settings.notification_definitions)
        situation_assignments = {
            identity: {"default": definitions["default"]}
            for identity, source in sources.items()
            if source.kind == "situation"
        }
        situation_assignments.update(
            {
                identity: {"default": definitions["default"], **choice}
                for identity, choice in definitions["assignments"].items()
                if identity.startswith("situation:")
            }
        )
        definitions.update(
            default=[],
            repairs=[],
            broken_automations=[],
            assignments={
                **situation_assignments,
                **assignments(settings.monitoring_policies, sources),
            },
        )
        config = build_policy(
            notification_definitions.generate(definitions), settings.duration("batch")
        )
        delayed_policies = {
            item.id
            for item in settings.monitoring_policies
            if item.check == "availability"
            and item.match.get("kind") == ("entity",)
            and item.parameters.get("duration_seconds", 0) > 0
        }
        delayed_nodes = frozenset(
            identity
            for identity, source in sources.items()
            if source.monitoring_policy in delayed_policies
        )
        # A failed integration's impact can include equipment still qualifying.
        return replace(
            config,
            rules=tuple(
                replace(
                    rule,
                    match=replace(rule.match, qualified_nodes=rule.match.nodes),
                )
                if rule.match.nodes and rule.match.nodes <= delayed_nodes
                else rule
                for rule in config.rules
            ),
        )

    async def async_phone_action(self, event: Event[Any]) -> None:
        """Apply an authenticated recipient response through existing operator controls."""
        row = await self.notifications.phone_actions.authorize(
            self.hass, event, dt_util.utcnow()
        )
        if row is None or not self.settings.notifications:
            return
        # Delivered actions must recheck current destination permissions.
        recipient = self._policy_config(self.settings).recipients.get(row["recipient"])
        permitted = (
            [
                target
                for channel in recipient.channels
                for target in (
                    notification_definitions.method_channels(
                        self.settings.notification_definitions["methods"][channel[7:]]
                    )
                    if channel.startswith("method:")
                    else [channel]
                )
            ]
            if recipient is not None
            else []
        )
        if recipient is None or row["channel"] not in permitted:
            return
        for episode_id in row.get("episodes", [row["episode_id"]]):
            if episode_id not in self.episodes:
                continue
            try:
                await self.async_control(
                    "acknowledge",
                    {"episode_id": episode_id},
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
                self._handle(self._evaluate(now, reconcile=False), now)
                self._prune_controls(now)
                try:
                    response = self._apply_control(action, data, user_id, now, context)
                except (ValueError, KeyError) as err:
                    invalid = err
                # Reconciliation can resolve the requested episode. Its events
                # still need a durable save even when the action is rejected.
                await self._complete(now, durable=True)
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

    def _renamed_sources(self) -> dict[str, Source]:
        """Refresh policy-owned names without rediscovering unchanged equipment."""
        if self._compiled_settings is None:
            return self.sources
        previous = {
            item.id: item.name for item in self._compiled_settings.monitoring_policies
        }
        renamed = {
            item.id: (previous[item.id], item.name)
            for item in self.settings.monitoring_policies
            if item.id in previous and item.name != previous[item.id]
        }
        if not renamed:
            return self.sources
        sources = dict(self.sources)
        for node_id, source in self.sources.items():
            if source.kind == "ups" or source.monitoring_policy not in renamed:
                continue
            old, new = renamed[source.monitoring_policy]
            suffix = f" · {old}"
            if source.name.endswith(suffix):
                sources[node_id] = replace(
                    source, name=f"{source.name.removesuffix(suffix)} · {new}"
                )
        return sources

    def _candidate_rows(self) -> dict[str, Any]:
        """Index the published candidate rows by node id for reuse."""
        catalog = cast(dict[str, Any], self.inventory_static.get("catalog", {}))
        return {
            str(row["node_id"]): row
            for row in cast(list[dict[str, Any]], catalog.get("candidates", []))
        }

    def _evaluate(
        self, now: datetime, *, reconcile: bool = True, rescan: bool = True
    ) -> list[HealthEvent]:
        started = perf_counter()
        first = self.engine is None
        discover = reconcile or self._inventory_dirty or first
        previous_candidates = self.candidates
        previous_targets = self.targets
        previous_changes = tuple(self.enrollment_changes)
        sources = (
            self._discover(rescan=rescan or first or self._inventory_dirty)
            if discover
            else self._renamed_sources()
        )
        after_discovery = perf_counter()
        policy_changed = (
            first
            or self.settings is not self._compiled_settings
            or sources != self.sources
        )
        events: list[HealthEvent] = []
        self.sources = sources if first else self.sources
        if first:
            engine_settings = self.settings.engine_settings()
            if not self.fresh_start:
                engine_settings = replace(engine_settings, startup_grace=timedelta(0))
            self.engine = Engine(engine_settings)
        assert self.engine is not None
        for node_id in self.producers.take_restarts():
            if node_id in self.sources and node_id in sources:
                events.extend(self.engine.remove(node_id, now))
                events.extend(
                    self.engine.register_many(
                        [sources[node_id].node(self.settings)], now
                    )
                )
        changed = [
            source.node(self.settings)
            for node_id, source in sources.items()
            if first or source != self.sources.get(node_id)
        ]
        removed = self.sources.keys() - sources.keys()
        if len(removed) > 1:
            # Each individual removal evaluates the entire graph. Restore the
            # final topology once, retaining checks, holds and episode identities.
            engine_state = self.engine.snapshot()
            self.engine = Engine(
                replace(self.settings.engine_settings(), startup_grace=timedelta(0))
            )
            if sources:
                self.engine.register_many(
                    [source.node(self.settings) for source in sources.values()], now
                )
            events.extend(self.engine.restore(engine_state, now))
        else:
            if changed:
                events.extend(self.engine.register_many(changed, now))
            for node_id in removed:
                events.extend(self.engine.remove(node_id, now))
        after_engine = perf_counter()
        if discover or sources != self.sources:
            rules = enrollment_rules(self.settings.monitoring_policies)
            rules_changed = (
                self._compiled_settings is None
                or rules
                != enrollment_rules(self._compiled_settings.monitoring_policies)
            )
            if (
                first
                or sources != self.sources
                or self.candidates != previous_candidates
                or self.targets != previous_targets
                or tuple(self.enrollment_changes) != previous_changes
                or rules_changed
            ):
                self.inventory_revision += 1
                previous_nodes = {
                    cast(str, row["node_id"]): row
                    for row in cast(
                        list[dict[str, JSONValue]],
                        self.inventory_static.get("nodes", []),
                    )
                }
                # Small policy edits leave most public source records unchanged.
                # Reusing those rows also leaves the rollback view untouched.
                self.inventory_static = {
                    "nodes": [
                        previous_nodes[identity]
                        if identity in previous_nodes
                        and source == self.sources.get(identity)
                        else json_object(source)
                        for identity, source in sources.items()
                    ],
                    "catalog": report(
                        self.candidates,
                        rules,
                        evaluated=True,
                        previous=previous_candidates,
                        previous_rows=self._candidate_rows(),
                    )
                    if first or rules_changed or self.candidates != previous_candidates
                    else self.inventory_static["catalog"],
                    "enrollment_changes": list(self.enrollment_changes),
                    "targets": list(self.targets),
                }
            self._inventory_dirty = False
            self._entity_sources = {}
            for source in sources.values():
                for entity_id in self.producers.entity_inputs(source):
                    self._entity_sources.setdefault(entity_id, []).append(source)
        after_catalog = perf_counter()
        # Retain the observed source until resolution handling, even when this
        # reconciliation removes it from the current catalog.
        self._resolved_sources = {
            event.episode.episode_id: resolved_source
            for event in events
            if isinstance(event, EpisodeResolved)
            and (
                resolved_source := self.sources.get(event.episode.anchor)
                or sources.get(event.episode.anchor)
            )
            is not None
        }
        self.sources = sources
        self.producers.retain(sources)
        compiled = (
            self._policy_config(sources=sources)
            if policy_changed
            else self._policy_config()
        )
        if first:
            self.policy = Policy(compiled)
        elif compiled != self._compiled_policy:
            assert self.policy is not None
            previous_policy = self.policy.snapshot()
            self.policy = Policy(compiled)
            self.policy.restore(previous_policy, now)
        self._compiled_policy = compiled
        self._compiled_settings = self.settings
        after_policy = perf_counter()
        assert self.policy is not None
        self.evidence.retain({key for key, source in sources.items() if source.watched})
        self._listen_entries()
        if first and self.saved is not None:
            self.episodes = self.saved["episodes"].copy()
            self._activating = self.settings.notifications and (
                not self.saved.get("notifications_enabled", False)
                or self.saved.get(
                    "policy_settings",
                    {
                        "policy": self.settings.policy,
                        "batch": self.settings.timings["batch"],
                    },
                )
                != self._policy_settings()
            )
            if (
                self._activating
                and self.saved.get("notifications_enabled")
                and "attention_routes" in self.saved
            ):
                stored_routes = self.saved["attention_routes"]
                previous_routes = {
                    route: value if isinstance(value, str) else json_digest(value)
                    for route, value in (
                        stored_routes.items() if isinstance(stored_routes, dict) else ()
                    )
                }
                current_routes = self._route_digests()
                self._activating_routes = {
                    route
                    for route in previous_routes.keys() | current_routes.keys()
                    if previous_routes.get(route) != current_routes.get(route)
                }
            self.producers.restore_retries(self.saved)
            self.policy.restore(self.saved["policy"], now)
            events.extend(self.engine.restore(self.saved["engine"], now))
        events.extend(self._bind_maintenance(now))
        observations = self.producers.current(
            sources.values(),
            self.settings,
            now,
            discover=discover,
            first=first,
            holding=self.startup_quiet,
        )
        for node_id in self.producers.take_restarts():
            if node_id in sources:
                events.extend(self.engine.remove(node_id, now))
                events.extend(
                    self.engine.register_many(
                        [sources[node_id].node(self.settings)], now
                    )
                )
        if observations:
            self._record_observations(observations)
            events.extend(self.engine.ingest_many(observations, now))
        else:
            events.extend(self.engine.advance(now))
        _SAVE_TIMING_LOGGER.debug(
            "phase=evaluate discover=%s discovery=%.6f engine=%.6f catalog=%.6f"
            " policy=%.6f rest=%.6f total=%.6f",
            discover,
            after_discovery - started,
            after_engine - after_discovery,
            after_catalog - after_engine,
            after_policy - after_catalog,
            perf_counter() - after_policy,
            perf_counter() - started,
        )
        return events

    def _record_observations(self, observations: list[Observation]) -> None:
        self.producers.record(observations)
        for observation in observations:
            source = self.sources[observation.node_id]
            if source.kind in {
                "integration",
                "entity",
                "device",
                "battery",
                "vacuum",
                "lock",
                *CONDITIONS,
                "entity_not_provided",
                "ups",
                *TEMPERATURE_CHECKS,
            }:
                self.evidence.observe(observation, source.name)

    def _handle(
        self,
        events: list[HealthEvent],
        now: datetime,
        cause: Context | None = None,
        *,
        renamed_sources: dict[str, tuple[str, str]] | None = None,
    ) -> None:
        assert self.policy is not None
        if events:
            self._save_required = True
            self._refresh_events.update(type(event).__name__ for event in events)
        for event in events:
            presentation_only = (
                bool(renamed_sources)
                and isinstance(event, EpisodeUpdated)
                and self._renamed_episode(event, renamed_sources or {})
            )
            split_deliveries = None
            if isinstance(event, EpisodeOpened) and event.split_from is not None:
                for control in tuple(self.controls):
                    if (
                        control.action == "shelve"
                        and control.target == event.split_from
                        and control.until > now
                    ):
                        successor = replace(
                            control,
                            control_id=uuid4().hex,
                            target=event.episode.episode_id,
                        )
                        self.controls.append(successor)
                        self._control_fact("started", successor, context=cause)
                split_deliveries = self.policy.handle(event, now, PolicyContext())
            rearm = False
            if isinstance(event, EpisodeUpdated):
                source = self.sources.get(event.episode.anchor)
                latest = self.producers.ups_latest(event.episode.anchor)
                previous = self.episodes.get(event.episode.episode_id, {})
                old_reasons = previous.get("reasons", [])
                already_critical = (
                    any(
                        isinstance(item, dict)
                        and item.get("reason") == "ups_reserve_critical"
                        for item in old_reasons
                    )
                    if isinstance(old_reasons, list)
                    else False
                )
                rearm = (
                    source is not None
                    and source.check_id == "ups_reserve"
                    and not already_critical
                    and any(
                        item.reason == "ups_reserve_critical"
                        and latest is not None
                        and latest.evidence.get("mode_changed_to_backup") is True
                        for item in event.episode.reasons
                    )
                )
            if isinstance(event, EpisodeOpened | EpisodeUpdated | EpisodeResolved):
                self._episode_fact(event, cause)
            if isinstance(event, EpisodeOpened | EpisodeUpdated):
                self.episodes[event.episode.episode_id] = json_object(event.episode)
            elif isinstance(event, EpisodeResolved):
                self.history.record(
                    event,
                    self._resolved_sources.pop(
                        event.episode.episode_id,
                        self.sources.get(event.episode.anchor),
                    ),
                    now,
                    ended_reason="monitoring_window_ended"
                    if event.resolution == "removed"
                    and event.episode.anchor in self.producers.window_ends
                    else None,
                )
                self.episodes.pop(event.episode.episode_id, None)
                if event.resolution == "split":
                    for control in tuple(self.controls):
                        if (
                            control.action == "shelve"
                            and control.target == event.episode.episode_id
                        ):
                            self.controls.remove(control)
                            self._control_fact(
                                "ended", control, ended_reason="split", context=cause
                            )
            elif isinstance(event, ProbeRequested):
                # Reconciliation has already read the available HA evidence. A
                # cached entity update cannot establish physical freshness.
                continue
            deliveries = (
                split_deliveries
                if split_deliveries is not None
                else self.policy.handle(event, now, PolicyContext())
            )
            if presentation_only:
                deliveries = [
                    delivery
                    for delivery in deliveries
                    if not (
                        isinstance(delivery, Notification)
                        and delivery.silent
                        and delivery.cause == "update"
                    )
                ]
            self._deliveries(deliveries, now)
            if rearm:
                self._deliveries(
                    self.policy.rearm(event.episode.episode_id, now, PolicyContext()),
                    now,
                )

    def _renamed_episode(
        self, event: EpisodeUpdated, renamed: dict[str, tuple[str, str]]
    ) -> bool:
        """Recognize only exact policy-name substitutions in adapter presentation."""
        previous = deepcopy(self.episodes.get(event.episode.episode_id))
        if previous is None:
            return False
        current = json_object(event.episode)
        current["updated_at"] = previous["updated_at"]
        for episode in (current, previous):
            labels = cast(dict[str, JSONValue], episode["labels"])
            if event.episode.anchor in renamed:
                old, new = renamed[event.episode.anchor]
                if labels.get("name") == new:
                    labels["name"] = old
            for finding in cast(list[dict[str, JSONValue]], episode["reasons"]):
                node_id = str(finding["node_id"])
                message = finding.get("message")
                if node_id in renamed and isinstance(message, str):
                    old, new = renamed[node_id]
                    prefix = f"{new}: "
                    if message.startswith(prefix):
                        finding["message"] = f"{old}: {message.removeprefix(prefix)}"
        return current == previous

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

    def _bind_maintenance(self, now: datetime) -> list[HealthEvent]:
        """Keep equipment controls attached when policy edits replace condition ids."""
        assert self.engine is not None
        events: list[HealthEvent] = []
        for index, control in enumerate(self.controls):
            if (
                control.action != "maintenance"
                or control.until <= now
                or control.target not in self.sources
            ):
                continue
            roots = tuple(self._maintenance_roots(control.target))
            previous = control.monitoring_roots or (control.target,)
            for root in roots:
                if root not in previous:
                    events.extend(
                        self.engine.quiet(
                            QuietWindow(
                                scope="node_and_dependents"
                                if control.include_dependents
                                else "node",
                                node_id=root,
                                until=control.until,
                            ),
                            now,
                        )
                    )
            self.controls[index] = replace(control, monitoring_roots=roots)
        return events

    def _maintained(self) -> set[str]:
        assert self.engine is not None
        scope: set[str] = set()
        for control in self.controls:
            if control.action != "maintenance":
                continue
            if control.target in self.sources:
                scope.update(
                    self._maintenance_scope(control.target, control.include_dependents)
                )
        return scope

    def _acknowledged(self, episode_id: str) -> bool:
        assert self.policy is not None
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
            data["split_into"] = list(event.split_into)
        elif isinstance(event, EpisodeOpened) and event.split_from is not None:
            data["split_from"] = event.split_from
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

    def _deliveries(self, deliveries: list[Delivery], now: datetime) -> None:
        if not deliveries or not self.settings.notifications or self._activating:
            return
        if self.notifications.record(
            deliveries,
            self._notification_context(),
            now,
            startup=self._quiet_since is not None,
            held=self.startup_quiet,
        ):
            self._save_required = True

    def _notification_context(self) -> NotificationContext:
        """Capture the explicit read inputs for one notification operation."""
        assert self.engine is not None
        assert self.policy is not None
        return NotificationContext(
            settings=self.settings,
            sources=self.sources,
            candidates=self.candidates,
            episodes=self.episodes,
            engine=self.engine,
            policy=self.policy,
            at=dt_util.utcnow(),
        )

    async def _flush_events(self) -> None:
        if not self.notifications.delivery.outbox:
            return
        batch = self.notifications.prepare_publication(dt_util.utcnow())
        try:
            if batch.scopes_changed:
                await self._save()
        except OSError, HomeAssistantError, ValueError, TypeError:
            self.notifications.rollback_publication(batch)
            raise
        self.notifications.publish(batch)
        try:
            await self._save()
        except OSError, HomeAssistantError, ValueError, TypeError:
            self.notifications.requeue(batch)
            raise

    async def async_send_notification(self, payload: dict[str, Any]) -> None:
        """Save each authorized transport attempt before releasing it for I/O."""
        request = self.notifications.authorize(
            payload, self.settings, self._policy_config()
        )
        if request is None:
            return
        for channel in request.channels:
            async with self._lock:
                if self._opening_request_expired(payload, dt_util.utcnow()):
                    continue
                attempt = self.notifications.prepare_attempt(
                    request, channel, self._notification_context()
                )
                if attempt is None:
                    continue
                try:
                    await self._save()
                except OSError, HomeAssistantError, ValueError, TypeError:
                    self.notifications.rollback_attempt(attempt)
                    raise
            await self.notifications.async_send(attempt)

    def _opening_request_expired(self, payload: dict[str, Any], now: datetime) -> bool:
        """Stop an earlier queued transport request at an opening's actual cutoff."""
        if payload.get("silent") is True or payload.get("action") == "resolve":
            return False
        shown = payload.get("episodes", [payload.get("episode_id")])
        if not isinstance(shown, list):
            return False
        for episode_id in shown:
            if not isinstance(episode_id, str):
                continue
            if self.history.window_ended(episode_id):
                return True
            episode = self.episodes.get(episode_id)
            monitor = (
                self.producers.left_open_monitors.get(str(episode.get("anchor")))
                if episode
                else None
            )
            if (
                monitor is not None
                and monitor.window_end is not None
                and now >= monitor.window_end
            ):
                return True
        return False

    def _schedule(self, now: datetime) -> None:
        if self._deadline_cancel is not None:
            self._deadline_cancel()
            self._deadline_cancel = None
        assert self.engine is not None
        assert self.policy is not None
        deadlines = [
            self.engine.next_deadline(),
            self.policy.next_deadline(),
            self.notifications.delivery.collections.next_deadline(),
            self.producers.next_deadline(self.settings, now),
        ]
        deadlines.extend(
            control.until for control in self.controls if control.until > now
        )
        if self._quiet_since is not None:
            deadlines.extend(
                self._quiet_since + self.settings.duration(key)
                for key in ("startup_grace", "startup_quiet_max")
                if self._quiet_since + self.settings.duration(key) > now
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
            "schema_version": 3,
            "monitoring_identities": self._monitoring_identities.copy(),
            **self.producers.snapshot(),
            "automation_alerts": deepcopy(self.automation_alerts.records),
            **self.notifications.snapshot(),
            "enrollment": {
                node_id: {key: list(values) for key, values in metadata.items()}
                for node_id, metadata in self.enrolled.items()
            },
            "resolved_history": self.history.snapshot(),
            "evidence": self.evidence.snapshot(),
            "operator_controls": presentation(self.controls),
            "engine": self.engine.snapshot(),
            "policy": self.policy.snapshot(),
            "policy_settings": self._policy_settings(),
            "attention_routes": self._route_digests(),
            "episodes": self.episodes.copy(),
            "notifications": sorted(self.desired_notifications),
            "notifications_enabled": self.settings.notifications,
        }

    @callback
    def _defer_save(self) -> None:
        """Persist evidence-only state once the coalescing window closes."""
        self._save_pending = True
        self._window["deferred"] += 1
        if self._pending_save_cancel is None:
            self._pending_save_cancel = async_call_later(
                self.hass, SAVE_COALESCE_SECONDS, self._pending_save_timer
            )
        _SAVE_TIMING_LOGGER.debug(
            "phase=save_deferred seconds=%.6f", float(SAVE_COALESCE_SECONDS)
        )

    async def _pending_save_timer(self, now: datetime) -> None:
        self._pending_save_cancel = None
        async with self._lock:
            if not self.running or not self._save_pending:
                return
            try:
                await self._save()
            except (
                OSError,
                HomeAssistantError,
                ValueError,
                KeyError,
                TypeError,
            ) as err:
                self._failed(err)
                async_dispatcher_send(self.hass, self.signal)

    def _serialize(self, snapshot: dict[str, Any]) -> bytes:
        """Produce the bytes the Store serializer writes for this snapshot."""
        envelope = {
            "version": self.store.version,
            "minor_version": self.store.minor_version,
            "key": self.store.key,
            "data": snapshot,
        }
        _, expected = prepare_save_json(envelope)
        return expected.encode("utf-8") if isinstance(expected, str) else expected

    def _stored_bytes_match(self, expected: bytes) -> bool:
        """Compare the stored file with the serialized snapshot."""
        try:
            with open(self.store.path, "rb") as handle:
                return handle.read() == expected
        except OSError:
            return False

    async def _save(self) -> None:
        if self._pending_save_cancel is not None:
            self._pending_save_cancel()
            self._pending_save_cancel = None
        self._save_pending = False
        self._save_required = False
        phase_started = perf_counter()
        snapshot = self.snapshot()
        elapsed = perf_counter() - phase_started
        self._window["saves"] += 1
        self._window["snapshot_seconds"] += elapsed
        _SAVE_TIMING_LOGGER.debug("phase=snapshot seconds=%.6f", elapsed)
        # Serialize once: the digest skips a write whose content equals the
        # last verified write, and the same bytes verify the write (ADR 0097).
        phase_started = perf_counter()
        serialized: bytes | None
        try:
            serialized = await self.hass.async_add_executor_job(
                self._serialize, snapshot
            )
        except ValueError, TypeError, HomeAssistantError:
            serialized = None
        digest = hashlib.sha256(serialized).hexdigest() if serialized else None
        _SAVE_TIMING_LOGGER.debug(
            "phase=storage_serialize seconds=%.6f", perf_counter() - phase_started
        )
        if digest is not None and digest == self._stored_digest:
            self._window["skipped"] += 1
            _SAVE_TIMING_LOGGER.debug("phase=storage_skip seconds=%.6f", 0.0)
            return
        self._stored_digest = None
        phase_started = perf_counter()
        await self.store.async_save(snapshot)
        _SAVE_TIMING_LOGGER.debug(
            "phase=storage_write seconds=%.6f", perf_counter() - phase_started
        )
        # Store logs some write failures without raising. Read-back prevents
        # delivering a problem whose new persistence state was not accepted.
        # Equal bytes verify without a second object tree; a difference falls
        # back to the parsed comparison so serializer changes stay harmless.
        phase_started = perf_counter()
        verified = serialized is not None and await self.hass.async_add_executor_job(
            self._stored_bytes_match, serialized
        )
        _SAVE_TIMING_LOGGER.debug(
            "phase=storage_verify seconds=%.6f", perf_counter() - phase_started
        )
        if verified:
            self._stored_digest = digest
            return
        phase_started = perf_counter()
        stored = await self.store.async_load()
        _SAVE_TIMING_LOGGER.debug(
            "phase=storage_read seconds=%.6f", perf_counter() - phase_started
        )
        phase_started = perf_counter()
        different = await self.hass.async_add_executor_job(ne, stored, snapshot)
        _SAVE_TIMING_LOGGER.debug(
            "phase=storage_compare seconds=%.6f", perf_counter() - phase_started
        )
        if different:
            raise HomeAssistantError("Homeostatic snapshot could not be saved")
        self._stored_digest = digest

    def _route_digests(
        self,
        settings: Settings | None = None,
        *,
        sources: dict[str, Source] | None = None,
    ) -> dict[str, str]:
        """Digest each route signature; equality is the only use of the stored value."""
        return {
            route: json_digest(signature)
            for route, signature in self._route_signatures(
                settings, sources=sources
            ).items()
        }

    def _route_signatures(
        self,
        settings: Settings | None = None,
        *,
        sources: dict[str, Source] | None = None,
    ) -> dict[str, Any]:
        config = self._policy_config(settings, sources=sources)
        settings = settings or self.settings
        result: dict[str, Any] = {}
        for rule in config.rules:
            route = rule.route
            item = result.setdefault(
                route,
                {
                    "rules": [],
                    "digests": {},
                    "methods": {},
                    "timezone": str(config.timezone),
                    "batch": settings.timings["batch"],
                },
            )
            encoded_rule = json_object(rule)
            if rule.match.qualified_nodes is None:
                # Preserve published route digests for unchanged legacy rules.
                encoded_rule["match"] = {
                    key: value
                    for key, value in json_object(rule.match).items()
                    if key != "qualified_nodes"
                }
            item["rules"].append(encoded_rule)
            recipients = rule.to
            if rule.digest is not None:
                item["digests"][rule.digest] = json_object(config.digests[rule.digest])
                recipients = (*recipients, config.digests[rule.digest].to)
            for recipient in recipients:
                target = config.recipients[recipient]
                if target.quiet_hours is not None:
                    item.setdefault("quiet_hours", {})[recipient] = json_object(
                        target.quiet_hours
                    )
                for channel in target.channels:
                    method = (
                        settings.notification_definitions["methods"].get(
                            channel.removeprefix("method:")
                        )
                        if channel.startswith("method:")
                        else None
                    )
                    if method is not None:
                        item["methods"][channel] = {
                            key: value for key, value in method.items() if key != "name"
                        }
        return result

    def _policy_settings(self) -> dict[str, Any]:
        definitions = deepcopy(self.settings.notification_definitions)
        for collection in ("methods", "profiles"):
            for row in definitions.get(collection, {}).values():
                row.pop("name", None)
        return {
            "definitions": definitions,
            "assignments": {
                item.id: list(item.notifications)
                for item in self.settings.monitoring_policies
            },
            "batch": self.settings.timings["batch"],
        }

    def preview_sources(self, settings: Settings) -> dict[str, Source]:
        """Compose draft policy findings without changing monitoring or sending."""
        rules = (*enrollment_rules(settings.monitoring_policies),)
        candidates = evaluate(inventory(self.hass, settings, self.enrolled), rules)
        candidates = evaluate(
            self.producers.retained_candidates(candidates, self.candidates),
            rules,
        )
        selected_ups = ups_sources(settings.monitoring_policies, candidates)
        sources, _ = compose(
            self.hass, self.automation_alerts.compose(settings), candidates
        )
        sources.update(self.automation_alerts.sources(settings))
        sources.update(selected_ups)
        sources.update(self.producers.repairs.sources())
        sources.update(self.producers.broken.sources())
        sources.update(
            temperature_sources(self.hass, settings.monitoring_policies, candidates)
        )
        sources.update(
            left_open_sources(self.hass, settings.monitoring_policies, candidates)
        )
        sources.update(not_provided_sources(settings.monitoring_policies, candidates))
        sources = ordinary_sources(
            settings.monitoring_policies, sources, candidates=candidates
        )
        retained, _ = restore_entity_identities(sources, self._monitoring_identities)
        return retained

    def preview_policy(
        self,
        data: dict[str, Any],
        *,
        settings: Settings | None = None,
        sources: dict[str, Source] | None = None,
    ) -> dict[str, JSONValue]:
        """Simulate activation in an isolated policy using its opaque public snapshot."""
        assert self.policy is not None
        explicit_policy = settings is None
        settings = settings or self.settings
        sources = self.preview_sources(settings) if sources is None else sources
        candidate = Policy(
            build_policy(data, settings.duration("batch"))
            if explicit_policy
            else self._policy_config(settings, sources=sources)
        )
        now = dt_util.utcnow()
        candidate.restore(self.policy.snapshot(), now)
        assert self.engine is not None
        proposed_engine = Engine(settings.engine_settings())
        if sources:
            proposed_engine.register_many(
                [source.node(settings) for source in sources.values()], now
            )
        active_ids = set(self.episodes)
        for event in proposed_engine.restore(self.engine.snapshot(), now):
            candidate.handle(event, now, PolicyContext())
            if isinstance(event, EpisodeResolved):
                active_ids.discard(event.episode.episode_id)
        if self.settings.notifications and not explicit_policy:
            before_routes = self._route_signatures()
            after_routes = self._route_signatures(settings, sources=sources)
            changed_routes = {
                route
                for route in before_routes.keys() | after_routes.keys()
                if before_routes.get(route) != after_routes.get(route)
            }
            deliveries = candidate.activate(now, PolicyContext(), routes=changed_routes)
        else:
            deliveries = candidate.activate(now, PolicyContext())
        deliveries.extend(candidate.advance(now, PolicyContext()))
        return json_object(
            {
                "at": now,
                "episodes": explanations(candidate, sorted(active_ids)),
                "deliveries": deliveries,
                "reports": candidate.reports(now),
                "next_deadline": candidate.next_deadline(),
            }
        )

    def query(self, action: str, data: dict[str, Any]) -> dict[str, JSONValue]:
        """Read the public model for response-only HA actions."""
        if not self.available or self.engine is None:
            raise HomeAssistantError("Homeostatic is not ready")
        if action == "resolved_history":
            return self.history.view(dt_util.utcnow())
        if action == "notification_report":
            return self.notifications.reports.view(
                data["reference"],
                dt_util.utcnow(),
                offset=data.get("offset", 0),
                limit=data.get("limit", 200),
            )
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
                    "unavailable_destinations": unavailable_destinations(
                        self.hass, self.settings.policy
                    ),
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
            settings = Settings.from_data(proposed)
            return preview(self.hass, settings, self.enrolled, self.settings.functions)
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

    def temperature_status(self, node_id: str) -> dict[str, JSONValue]:
        """Present captured temperature evidence without advancing qualification."""
        current = self.evidence.latest(node_id)
        return {
            "observation": json_object(current) if current is not None else None,
            **self.producers.temperature_status(node_id),
        }

    def entity_status(self, node_id: str) -> dict[str, JSONValue] | None:
        """Present captured HA state alongside current public library answers."""
        evidence = self.evidence.view(node_id)
        if evidence is None or evidence["current"] is None:
            return None
        return {
            "current": evidence["current"],
            **(
                {"last_failure": evidence["last_failure"]}
                if evidence and evidence["history_complete"]
                else {}
            ),
            "ups": json_object(latest)
            if (latest := self.producers.ups_latest(node_id)) is not None
            else None,
            "explanation": self.query("explain", {"node_id": node_id}),
            "readiness": self.query("readiness", {"node_ids": [node_id]}),
        }

    def inventory_updates(self) -> dict[str, JSONValue]:
        """Read dynamic inventory evidence without rebuilding catalog metadata."""
        issue_sources = {str(episode["anchor"]) for episode in self.episodes.values()}
        for episode in self.episodes.values():
            recorded = episode.get("recorded")
            if isinstance(recorded, list):
                issue_sources.update(str(node_id) for node_id in recorded)
            findings = episode.get("reasons")
            if isinstance(findings, list):
                issue_sources.update(
                    str(finding["node_id"])
                    for finding in findings
                    if isinstance(finding, dict)
                    and isinstance(finding.get("node_id"), str)
                )
        return {
            "episodes": list(self.episodes.values()),
            "ups_status": self.producers.ups_status(),
            "integration_evidence": {
                str(episode["anchor"]): self.evidence.view(str(episode["anchor"]))
                for episode in self.episodes.values()
                if self.sources[str(episode["anchor"])].kind == "integration"
            },
            "entity_status": {
                node_id: self.entity_status(node_id)
                for node_id in sorted(issue_sources)
                if (source := self.sources.get(node_id)) is not None
                and source.kind
                in {
                    "entity",
                    "device",
                    "battery",
                    "vacuum",
                    "lock",
                    *CONDITIONS,
                    "ups",
                    "entity_not_provided",
                    *TEMPERATURE_CHECKS,
                }
            },
            "resolved_history": self.history.view(dt_util.utcnow()),
            "operator_controls": [json_object(control) for control in self.controls],
            "attention_controls_supported": True,
            "physical_freshness_supported": False,
            "notification_consumer_missing": self.consumer_missing,
            "situation_availability_verified": False,
            "notification_requests": list(
                self.notifications.delivery.messages.values()
            ),
            "delivery_failures": to_json(list(self.notifications.failures)),
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    async def async_stop(self) -> None:
        """Cancel future work and save the final state before unloading."""
        self.running = False
        self._stopped = True
        if self._on_gc in gc.callbacks:
            gc.callbacks.remove(self._on_gc)
        for cancel in self._subscriptions:
            cancel()
        self._subscriptions.clear()
        for _, cancel in self._entries.values():
            cancel()
        self._entries.clear()
        if self._deadline_cancel is not None:
            self._deadline_cancel()
            self._deadline_cancel = None
        if self._pending_save_cancel is not None:
            self._pending_save_cancel()
            self._pending_save_cancel = None
        async with self._lock:
            if (
                self.engine is not None
                and self.policy is not None
                and self.saved is None
                and self._settings_conversion is None
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
