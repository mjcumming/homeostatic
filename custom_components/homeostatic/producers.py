"""Own Home Assistant producers without engine, timer or storage coordination."""

from collections.abc import Iterable
from dataclasses import replace
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
from .monitoring import TEMPERATURE_CHECKS
from .repairs import Repairs
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


class Producers:
    """Manage detector state on the runtime's ordered Home Assistant worker."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Prepare producers without observing evidence or reading the clock."""
        self.hass = hass
        self.repairs = Repairs()
        self.broken = BrokenAutomations()
        self.temperature_monitors: dict[str, TemperatureMonitor] = {}
        self.ups_monitors: dict[str, UpsMonitor] = {}
        self._ups_saved: dict[str, Any] = {}
        self._temperature_saved: dict[str, Any] = {}
        self._temperature_deadlines: dict[str, datetime] = {}
        self._restarts: set[str] = set()
        self.retry_since: dict[str, datetime] = {}

    def restore(self, snapshot: dict[str, Any]) -> None:
        """Validate producer sections, deferring per-source restore until enrollment."""
        for key in ("temperature_monitors", "ups_monitors"):
            monitors = snapshot.get(key, {})
            if not isinstance(monitors, dict) or any(
                not isinstance(identity, str) or not isinstance(value, dict)
                for identity, value in monitors.items()
            ):
                raise ValueError(f"Invalid stored {key}")
        self._temperature_saved = dict(snapshot.get("temperature_monitors", {}))
        self._ups_saved = dict(snapshot.get("ups_monitors", {}))
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
                in {"situation", "battery", "vacuum", "ups", *TEMPERATURE_CHECKS}
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
        return tuple(dict.fromkeys(entities))

    def capture_entity(
        self,
        sources: Iterable[Source],
        entity_id: str,
        state: State | None,
        settings: Settings,
        now: datetime,
    ) -> tuple[list[Observation], tuple[tuple[str, State | None], ...]]:
        """Capture event evidence; defer temperature advancement to the worker."""
        observations = []
        captured = []
        for source in sources:
            if source.kind in TEMPERATURE_CHECKS:
                captured.append((source.node_id, state))
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
                else not_provided_observation(
                    self.hass,
                    source,
                    now,
                    changed_entity_id=entity_id,
                    changed_state=state,
                )
                if source.kind == "entity_not_provided"
                else self._observe_ups(source, settings, now, entity_id, state)
                if source.kind == "ups"
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
        self, source: Source, state: State | None, settings: Settings, now: datetime
    ) -> Observation | None:
        """Advance the captured state under the same lock as engine ingestion."""
        return self._observe_temperature(source, state, settings, now)

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
        deadlines = [*self._temperature_deadlines.values()]
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
        return monitor.evaluate(states, now)

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
