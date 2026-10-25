"""Own Home Assistant producers without engine, timer or storage coordination."""

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from health_tree.types import JSONValue, Observation
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .battery import observe as battery_observation
from .broken_automations import BrokenAutomations
from .catalog import (
    Source,
    entity_observation,
    entity_state_signature,
    entry_observation,
)
from .config import Settings
from .entity_not_provided import observe as not_provided_observation
from .entity_not_provided import state_provided
from .left_open import LeftOpenMonitor, LeftOpenParameters
from .lock import observe as lock_observation
from .monitoring import TEMPERATURE_CHECKS
from .repairs import Repairs
from .reported_conditions import CONDITIONS
from .reported_conditions import observe as condition_observation
from .serialization import json_object
from .situation_reports import report_observation
from .temperature import (
    TemperatureLimitParameters,
    TemperatureMonitor,
    ThermostatParameters,
)
from .ups import MAPPINGS, UpsMonitor, platform_identities, retained_candidates
from .ups_parameters import ReserveParameters
from .vacuum import observe as vacuum_observation


@dataclass(frozen=True, slots=True, kw_only=True)
class CapturedTemperature:
    """Temperature evidence waiting for the ordered worker."""

    node_id: str
    state: State | None


@dataclass(frozen=True, slots=True, kw_only=True)
class CapturedUps:
    """A complete UPS input reading without advancing retained detector state."""

    node_id: str
    states: tuple[tuple[str, State | None], ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class CapturedOpening:
    """A contact and temperature reading captured at the same HA event boundary."""

    node_id: str
    contact: State | None
    temperature: State | None


type CapturedInput = CapturedTemperature | CapturedUps | CapturedOpening


class Producers:
    """Manage detector state on the runtime's ordered Home Assistant worker."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare producers without observing evidence or reading the clock."""
        self.hass = hass
        self.repairs = Repairs()
        self.broken = BrokenAutomations()
        self.temperature_monitors: dict[str, TemperatureMonitor] = {}
        self.ups_monitors: dict[str, UpsMonitor] = {}
        self.left_open_monitors: dict[str, LeftOpenMonitor] = {}
        self.window_ends: set[str] = set()
        self._left_open_saved: dict[str, Any] = {}
        self._left_open_deadlines: dict[str, datetime] = {}
        self._ups_saved: dict[str, Any] = {}
        self._temperature_saved: dict[str, Any] = {}
        self._temperature_deadlines: dict[str, datetime] = {}
        self._restarts: set[str] = set()
        self.retry_since: dict[str, datetime] = {}

    def restore(self, snapshot: dict[str, Any]) -> None:
        """Validate producer sections, deferring per-source restore until enrollment."""
        for key in ("temperature_monitors", "ups_monitors", "left_open_monitors"):
            monitors = snapshot.get(key, {})
            if not isinstance(monitors, dict) or any(
                not isinstance(identity, str) or not isinstance(value, dict)
                for identity, value in monitors.items()
            ):
                raise ValueError(f"Invalid stored {key}")
        self._temperature_saved = dict(snapshot.get("temperature_monitors", {}))
        self._ups_saved = dict(snapshot.get("ups_monitors", {}))
        self._left_open_saved = dict(snapshot.get("left_open_monitors", {}))
        for identity, state in self._left_open_saved.items():
            monitor = LeftOpenMonitor(
                node_id=identity, name="", parameters=LeftOpenParameters()
            )
            monitor.restore(state)
        self.repairs.restore(snapshot.get("repairs", {}))
        self.broken.restore(snapshot.get("broken_automations", {}))

    def restore_retries(self, snapshot: dict[str, Any]) -> None:
        """Restore integration holds with the engine's first evaluation."""
        self.retry_since = {
            entry_id: datetime.fromisoformat(value)
            for entry_id, value in snapshot["retry_since"].items()
        }

    def snapshot(self) -> dict[str, Any]:
        """Return the existing flat persistence sections for the shared save."""
        return {
            "left_open_monitors": {
                key: monitor.snapshot()
                for key, monitor in self.left_open_monitors.items()
            },
            "temperature_monitors": {
                key: monitor.snapshot()
                for key, monitor in self.temperature_monitors.items()
            },
            "ups_monitors": {
                key: monitor.snapshot() for key, monitor in self.ups_monitors.items()
            },
            "repairs": self.repairs.snapshot(),
            "broken_automations": self.broken.snapshot(),
            "retry_since": {
                key: value.isoformat() for key, value in self.retry_since.items()
            },
        }

    def retain(self, sources: dict[str, Source]) -> None:
        """Discard detector state only when its monitoring expectation is removed."""
        self.ups_monitors = {
            key: value for key, value in self.ups_monitors.items() if key in sources
        }
        self.temperature_monitors = {
            key: value
            for key, value in self.temperature_monitors.items()
            if key in sources
        }
        self._ups_saved = {
            key: value for key, value in self._ups_saved.items() if key in sources
        }
        self._temperature_saved = {
            key: value
            for key, value in self._temperature_saved.items()
            if key in sources
        }
        self._temperature_deadlines = {
            key: value
            for key, value in self._temperature_deadlines.items()
            if key in sources
        }
        self.left_open_monitors = {
            key: value
            for key, value in self.left_open_monitors.items()
            if key in sources
        }
        self._left_open_saved = {
            key: value for key, value in self._left_open_saved.items() if key in sources
        }
        self._left_open_deadlines = {
            key: value
            for key, value in self._left_open_deadlines.items()
            if key in sources
        }
        self.window_ends.intersection_update(sources)

    def retained_candidates(
        self, discovered: dict[str, Source], previous: dict[str, Source]
    ) -> dict[str, Source]:
        """Retain enrolled UPS bindings without changing discovery or preview state."""
        return retained_candidates(self.hass, discovered, previous, self._ups_saved)

    @staticmethod
    def changed_sources(
        sources: Iterable[Source], old: State | None, new: State | None
    ) -> list[Source]:
        """Select checks using the existing presence, availability or value boundary."""
        availability_changed = entity_state_signature(old) != entity_state_signature(
            new
        )
        provided_changed = state_provided(old) != state_provided(new)
        return [
            source
            for source in sources
            if (
                provided_changed
                if source.kind == "entity_not_provided"
                else source.kind
                in {
                    "situation",
                    "battery",
                    "vacuum",
                    "lock",
                    *CONDITIONS,
                    "left_open",
                    "ups",
                    *TEMPERATURE_CHECKS,
                }
                or availability_changed
            )
        ]

    @staticmethod
    def entity_inputs(source: Source) -> tuple[str, ...]:
        """Identify entity events consumed by this watched producer."""
        if not source.watched:
            return ()
        entities = [source.entity_id] if source.entity_id else []
        if source.kind == "ups":
            entities.extend(entity for _, entity in source.ups_entities)
        if source.kind == "battery":
            entities.extend(
                entity
                for entity in (
                    source.battery_level_entity,
                    source.battery_warning_entity,
                    source.battery_charging_entity,
                )
                if entity
            )
        if source.kind == "left_open" and source.left_open_temperature_entity:
            entities.append(source.left_open_temperature_entity)
        return tuple(dict.fromkeys(entities))

    def capture_entity(
        self,
        sources: Iterable[Source],
        entity_id: str,
        state: State | None,
        settings: Settings,
        now: datetime,
    ) -> tuple[list[Observation], tuple[CapturedInput, ...]]:
        """Capture inputs without advancing stateful producers before the worker."""
        observations = []
        captured: list[CapturedInput] = []
        for source in sources:
            if source.kind == "left_open":
                captured.append(
                    CapturedOpening(
                        node_id=source.node_id,
                        contact=state
                        if source.entity_id == entity_id
                        else self.hass.states.get(source.entity_id)
                        if source.entity_id
                        else None,
                        temperature=state
                        if source.left_open_temperature_entity == entity_id
                        else self.hass.states.get(source.left_open_temperature_entity)
                        if source.left_open_temperature_entity
                        else None,
                    )
                )
                continue
            if source.kind in TEMPERATURE_CHECKS:
                captured.append(
                    CapturedTemperature(node_id=source.node_id, state=state)
                )
                continue
            if source.kind == "ups":
                captured.append(
                    CapturedUps(
                        node_id=source.node_id,
                        states=tuple(
                            self._ups_states(source, entity_id, state).items()
                        ),
                    )
                )
                continue
            observation = (
                battery_observation(
                    self.hass,
                    source,
                    now,
                    threshold=self._battery_threshold(source, settings),
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind == "battery"
                else vacuum_observation(
                    self.hass,
                    source,
                    now,
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind == "vacuum"
                else lock_observation(
                    self.hass,
                    source,
                    now,
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind == "lock"
                else condition_observation(
                    self.hass,
                    source,
                    now,
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind in CONDITIONS
                else not_provided_observation(
                    self.hass,
                    source,
                    now,
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind == "entity_not_provided"
                else entity_observation(source, state, now)
            )
            observations.append(observation)
        return observations, tuple(captured)

    def capture_entry(
        self,
        sources: Iterable[Source],
        entry_id: str,
        settings: Settings,
        now: datetime,
    ) -> list[Observation]:
        """Observe the changed entry and checks that depend on its lifecycle."""
        sources = tuple(sources)
        observations = [
            self.observe_entry(source, settings, now)
            for source in sources
            if source.entry_id == entry_id and source.watched
        ]
        observations.extend(
            not_provided_observation(self.hass, source, now)
            for source in sources
            if source.kind == "entity_not_provided"
            and source.owner_id == entry_id
            and source.watched
        )
        return observations

    def observe_captured(
        self, source: Source, captured: CapturedInput, settings: Settings, now: datetime
    ) -> Observation | None:
        """Advance the captured state under the same lock as engine ingestion."""
        if isinstance(captured, CapturedUps):
            return self._ups_monitor(source, settings).evaluate(
                dict(captured.states), now
            )
        if isinstance(captured, CapturedOpening):
            return self._observe_left_open(
                source, captured.contact, captured.temperature, settings, now
            )
        return self._observe_temperature(source, captured.state, settings, now)

    def take_restarts(self, node_id: str | None = None) -> set[str]:
        """Consume expectation resets for runtime to apply through public engine APIs."""
        selected = (
            self._restarts.copy() if node_id is None else self._restarts & {node_id}
        )
        self._restarts.difference_update(selected)
        return selected

    def current(
        self,
        sources: Iterable[Source],
        settings: Settings,
        now: datetime,
        *,
        discover: bool,
        first: bool,
        holding: bool,
    ) -> list[Observation]:
        """Read only the producers required by this refresh or deadline."""
        observations = []
        for source in sources:
            if not source.watched:
                continue
            if source.kind == "left_open":
                observations.append(
                    self._observe_left_open(
                        source,
                        self.hass.states.get(source.entity_id)
                        if source.entity_id
                        else None,
                        self.hass.states.get(source.left_open_temperature_entity)
                        if source.left_open_temperature_entity
                        else None,
                        settings,
                        now,
                    )
                )
                continue
            if source.kind in TEMPERATURE_CHECKS:
                state = (
                    self.hass.states.get(source.entity_id) if source.entity_id else None
                )
                if (
                    observation := self._observe_temperature(
                        source, state, settings, now
                    )
                ) is not None:
                    observations.append(observation)
                continue
            if source.kind == "repair":
                if discover and (
                    observation := self.repairs.observation(
                        source.monitoring_source or source.node_id,
                        now,
                        holding=holding,
                    )
                ):
                    observations.append(replace(observation, node_id=source.node_id))
                continue
            if source.kind == "broken_automation":
                if discover:
                    observations.append(
                        replace(
                            self.broken.observation(
                                source.monitoring_source or source.node_id, now
                            ),
                            node_id=source.node_id,
                        )
                    )
                continue
            if source.report_timeout is not None:
                if first:
                    observations.append(report_observation(source, "unknown", now))
                continue
            if source.kind == "battery" and discover:
                observations.append(
                    battery_observation(
                        self.hass,
                        source,
                        now,
                        threshold=self._battery_threshold(source, settings),
                    )
                )
            elif source.kind == "ups" and discover:
                observations.append(self._observe_ups(source, settings, now))
            elif source.kind == "vacuum" and discover:
                observations.append(vacuum_observation(self.hass, source, now))
            elif source.kind == "lock" and discover:
                observations.append(lock_observation(self.hass, source, now))
            elif source.kind in CONDITIONS and discover:
                observations.append(condition_observation(self.hass, source, now))
            elif source.kind == "entity_not_provided" and discover:
                observations.append(not_provided_observation(self.hass, source, now))
            elif source.kind in {"entity", "situation"} and discover:
                state = (
                    self.hass.states.get(source.entity_id) if source.entity_id else None
                )
                observations.append(entity_observation(source, state, now))
            elif source.kind == "integration" and (
                discover or self._retry_due(source, settings, now)
            ):
                observations.append(self.observe_entry(source, settings, now))
        return observations

    def record(self, observations: Iterable[Observation]) -> None:
        """Attach the observation actually ingested, rather than a later queued UPS report."""
        for observation in observations:
            if monitor := self.ups_monitors.get(observation.node_id):
                monitor.latest = observation

    def next_deadline(self, settings: Settings, now: datetime) -> datetime | None:
        """Return producer work for runtime's single Home Assistant timer."""
        deadlines = [
            *self._temperature_deadlines.values(),
            *self._left_open_deadlines.values(),
        ]
        deadlines.extend(
            since + settings.duration("retry_hold")
            for since in self.retry_since.values()
            if since + settings.duration("retry_hold") > now
        )
        return min(deadlines, default=None)

    def temperature_status(self, node_id: str) -> dict[str, JSONValue]:
        """Read qualification timing without advancing a monitor."""
        monitor = self.temperature_monitors.get(node_id)
        deadline = self._temperature_deadlines.get(node_id)
        return {
            "qualifying_since": monitor.since.isoformat()
            if monitor is not None
            and monitor.since is not None
            and deadline is not None
            else None,
            "next_deadline": deadline.isoformat() if deadline is not None else None,
        }

    def ups_latest(self, node_id: str) -> Observation | None:
        """Read the last ingested UPS observation for presentation and transition facts."""
        monitor = self.ups_monitors.get(node_id)
        return monitor.latest if monitor else None

    def ups_status(self) -> dict[str, JSONValue]:
        """Return detached UPS presentation without reading new Home Assistant state."""
        return {
            key: json_object(monitor.latest)
            for key, monitor in self.ups_monitors.items()
            if monitor.latest is not None
        }

    def _observe_ups(
        self,
        source: Source,
        settings: Settings,
        now: datetime,
        changed_entity: str | None = None,
        changed_state: State | None = None,
    ) -> Observation:
        """Interpret mapped UPS evidence with its retained mode and thresholds."""
        return self._ups_monitor(source, settings).evaluate(
            self._ups_states(source, changed_entity, changed_state), now
        )

    def _ups_monitor(self, source: Source, settings: Settings) -> UpsMonitor:
        """Construct or restore the monitor only on the ordered worker."""
        monitor = self.ups_monitors.get(source.node_id)
        if monitor is None:
            policy = next(
                (
                    item
                    for item in settings.monitoring_policies
                    if item.id == source.monitoring_policy
                ),
                None,
            )
            parameters = (
                ReserveParameters.from_data(policy.parameters)
                if policy and policy.check == "ups_reserve"
                else ReserveParameters()
            )
            monitor = UpsMonitor(source=source, parameters=parameters)
            if source.node_id in self._ups_saved:
                monitor.restore(self._ups_saved[source.node_id])
                del self._ups_saved[source.node_id]
            self.ups_monitors[source.node_id] = monitor
        monitor.source = source
        return monitor

    def _ups_states(
        self,
        source: Source,
        changed_entity: str | None = None,
        changed_state: State | None = None,
    ) -> dict[str, State | None]:
        """Capture every verified role at the event boundary, including missing inputs."""
        states: dict[str, State | None] = {}
        registry, devices = er.async_get(self.hass), dr.async_get(self.hass)
        device_id = next(iter(source.attributes.get("device", ())), None)
        device = devices.async_get(device_id) if device_id else None
        identities = (
            set(platform_identities(device.identifiers, source.ups_platform))
            if device
            else set()
        )
        for role, entity in source.ups_entities:
            registered = registry.async_get(entity)
            key = MAPPINGS[source.ups_platform or "nut"].get(role)
            valid = (
                registered is not None
                and registered.device_id == device_id
                and registered.platform == source.ups_platform
                and registered.disabled_by is None
                and key is not None
                and registered.unique_id
                in {f"{identity}_{key}" for identity in identities}
            )
            states[role] = (
                (
                    changed_state
                    if entity == changed_entity
                    else self.hass.states.get(entity)
                )
                if valid
                else None
            )
        return states

    def _observe_left_open(
        self,
        source: Source,
        contact: State | None,
        temperature: State | None,
        settings: Settings,
        now: datetime,
    ) -> Observation:
        """Advance the opening detector together with its ordered engine observation."""
        monitor = self.left_open_monitors.get(source.node_id)
        if monitor is None:
            policy = next(
                item
                for item in settings.monitoring_policies
                if item.id == source.monitoring_policy
            )
            monitor = LeftOpenMonitor(
                node_id=source.node_id,
                name=source.name,
                parameters=LeftOpenParameters.from_data(policy.parameters),
            )
            if source.node_id in self._left_open_saved:
                monitor.restore(self._left_open_saved.pop(source.node_id))
            self.left_open_monitors[source.node_id] = monitor
        monitor.name = source.name
        row = (
            er.async_get(self.hass).async_get(source.left_open_temperature_entity)
            if source.left_open_temperature_entity
            else None
        )
        if row is not None and row.disabled:
            temperature = None
        result = monitor.evaluate(
            contact, temperature, now, timezone=self.hass.config.time_zone
        )
        self._left_open_deadlines.pop(source.node_id, None)
        if result.next_deadline is not None:
            self._left_open_deadlines[source.node_id] = result.next_deadline
        if result.removed:
            self._restarts.add(source.node_id)
            self.window_ends.add(source.node_id)
        elif result.observation.evidence.get("monitoring_active"):
            self.window_ends.discard(source.node_id)
        return result.observation

    def _observe_temperature(
        self, source: Source, state: State | None, settings: Settings, now: datetime
    ) -> Observation | None:
        """Advance one configured temperature expectation using captured evidence."""
        policy = next(
            item
            for item in settings.monitoring_policies
            if item.id == source.monitoring_policy
        )
        monitor = self.temperature_monitors.get(source.node_id)
        if monitor is None:
            parameters = (
                TemperatureLimitParameters.from_data(policy.parameters)
                if policy.check == "temperature_limit"
                else ThermostatParameters.from_data(policy.parameters)
            )
            monitor = TemperatureMonitor(
                node_id=source.node_id,
                check_id=source.check_id,
                name=source.name,
                parameters=parameters,
            )
            if source.node_id in self._temperature_saved:
                monitor.restore(self._temperature_saved[source.node_id])
                del self._temperature_saved[source.node_id]
            self.temperature_monitors[source.node_id] = monitor
        monitor.name = source.name
        result = monitor.evaluate(
            state, now, climate_unit=self.hass.config.units.temperature_unit
        )
        self._temperature_deadlines.pop(source.node_id, None)
        if result.next_deadline is not None:
            self._temperature_deadlines[source.node_id] = result.next_deadline
        if result.removed:
            self._restarts.add(source.node_id)
        return result.observation

    def _retry_due(self, source: Source, settings: Settings, now: datetime) -> bool:
        """Whether a setup retry has run past its hold and needs a fresh observation."""
        since = self.retry_since.get(source.entry_id or "")
        return since is not None and now >= since + settings.duration("retry_hold")

    def observe_entry(
        self, source: Source, settings: Settings, now: datetime
    ) -> Observation:
        """Interpret config-entry state and retain its setup-retry start."""
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
            settings,
            reauth,
        )

    def _battery_threshold(self, source: Source, settings: Settings) -> float:
        """Read the threshold of this independent battery expectation."""
        policy = next(
            (
                item
                for item in settings.monitoring_policies
                if item.id == source.monitoring_policy
            ),
            None,
        )
        return float(policy.parameters["threshold"]) if policy is not None else 20.0
