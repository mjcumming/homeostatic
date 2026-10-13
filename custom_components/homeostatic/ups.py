"""Shared UPS conditions supplied by verified Home Assistant entity mappings."""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from health_tree.types import JSONValue, Observation, Status
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .catalog import Source
from .rules import attributes
from .serialization import json_object, to_json
from .ups_parameters import UPS_CHECKS, ReserveParameters

MAPPINGS: dict[str, dict[str, str]] = {
    "nut": {
        "status": "ups.status",
        "charge": "battery.charge",
        "runtime": "battery.runtime",
        "charge_low": "battery.charge.low",
        "runtime_low": "battery.runtime.low",
        "charging": "battery.charger.status",
        "input_voltage": "input.voltage",
        "output_voltage": "output.voltage",
        "load": "ups.load",
    },
    "apcupsd": {
        "status": "status",
        "charge": "bcharge",
        "runtime": "timeleft",
        "charge_low": "mbattchg",
        "runtime_low": "mintimel",
        "input_voltage": "linev",
        "output_voltage": "outputv",
        "load": "loadpct",
    },
}
CONDITIONS = {
    "ups_power": "Backup power",
    "ups_reserve": "Low reserve",
    "ups_battery_replacement": "Battery replacement",
    "ups_fault": "UPS fault",
}
_FAULTS = {
    "nut": {
        "OVER": "UPS reports an overload",
        "OFF": "UPS reports its output is off",
        "FSD": "UPS reports forced shutdown",
        "ALARM": "UPS reports an alarm",
    },
    "apcupsd": {
        "OVERLOAD": "UPS reports an overload",
        "NOBATT": "UPS reports no battery",
    },
}
_FLAGS = {
    "nut": {"mains": "OL", "backup": "OB", "low": "LB", "replace": "RB"},
    "apcupsd": {
        "mains": "ONLINE",
        "backup": "ONBATT",
        "low": "LOWBATT",
        "replace": "REPLACEBATT",
    },
}


def platform_identities(
    identifiers: Iterable[Sequence[str]], platform: str | None
) -> list[str]:
    """Return device ids for one integration.

    Core types an identifier as a pair and accepts a longer tuple. Reading
    every identifier as two fields stops refresh for the whole installation.
    """
    return [
        identifier[1]
        for identifier in identifiers
        if len(identifier) >= 2 and identifier[0] == platform
    ]


def candidates(hass: HomeAssistant, entities: dict[str, Source]) -> dict[str, Source]:
    """Discover supported roles by full registry identity within each UPS."""
    registry, devices = er.async_get(hass), dr.async_get(hass)
    result = {}
    for device in devices.devices:
        for platform, mapping in MAPPINGS.items():
            identities = platform_identities(device.identifiers, platform)
            if len(identities) != 1:
                continue
            identity = identities[0]
            roles: dict[str, Source] = {}
            ambiguous: set[str] = set()
            for source in entities.values():
                if source.kind != "entity" or source.entity_id is None:
                    continue
                registered = registry.async_get(source.entity_id)
                if (
                    registered is None
                    or registered.device_id != device.id
                    or registered.platform != platform
                ):
                    continue
                for role, key in mapping.items():
                    if registered.unique_id == f"{identity}_{key}":
                        if role in roles or role in ambiguous:
                            ambiguous.add(role)
                            roles.pop(role, None)
                        else:
                            roles[role] = source
            if "status" not in roles or not ({"charge", "runtime"} & roles.keys()):
                continue
            primary = roles["status"]
            if primary.owner_id is None:
                continue
            name = device.name_by_user or device.name or primary.name
            bindings = tuple(
                sorted(
                    (role, source.entity_id)
                    for role, source in roles.items()
                    if source.entity_id
                )
            )
            for check in sorted(UPS_CHECKS):
                node_id = f"ups:{device.id}:{check}"
                result[node_id] = Source(
                    node_id=node_id,
                    name=f"{name} · {CONDITIONS[check]}",
                    kind="ups",
                    entity_id=primary.entity_id,
                    owner_id=primary.owner_id,
                    disabled=primary.disabled,
                    watched=False,
                    check_id=check,
                    attributes={**primary.attributes, "kind": ("ups",)},
                    ups_entities=bindings,
                    ups_platform=platform,
                    ups_disabled_entities=tuple(
                        item.entity_id
                        for item in roles.values()
                        if item.disabled and item.entity_id
                    ),
                    ups_name=name,
                )
    return result


def current(state: State | None) -> str | None:
    """Accept current readable reports while retaining unknown as uncertainty."""
    if (
        state is None
        or state.state in {"unknown", "unavailable"}
        or state.attributes.get("restored")
    ):
        return None
    return state.state


def retained_candidates(
    hass: HomeAssistant,
    discovered: dict[str, Source],
    known: dict[str, Source],
    saved: Mapping[str, Any],
) -> dict[str, Source]:
    """Keep enrolled signal loss unknown until the owning device is removed."""
    remembered = [source for source in known.values() if source.kind == "ups"]
    for state in saved.values():
        data = state.get("source") if isinstance(state, dict) else None
        if not isinstance(data, dict):
            continue
        metadata = attributes(data.get("attributes", {}))
        device_id = next(iter(metadata.get("device", ())), None)
        platform, check, entities = (
            data.get("ups_platform"),
            data.get("check_id"),
            data.get("ups_entities"),
        )
        if (
            platform not in MAPPINGS
            or check not in UPS_CHECKS
            or not device_id
            or not isinstance(entities, list)
            or not all(
                isinstance(pair, list)
                and len(pair) == 2
                and all(isinstance(value, str) for value in pair)
                for pair in entities
            )
        ):
            raise ValueError("Invalid persisted UPS signal bindings")
        remembered.append(
            Source(
                node_id=f"ups:{device_id}:{check}",
                name=str(data["name"]),
                kind="ups",
                entity_id=data.get("entity_id"),
                owner_id=data.get("owner_id"),
                check_id=check,
                attributes=metadata,
                ups_platform=platform,
                ups_name=data.get("ups_name"),
                ups_entities=tuple((pair[0], pair[1]) for pair in entities),
                watched=False,
            )
        )
    devices = dr.async_get(hass)
    result = dict(discovered)
    for source in remembered:
        device_id = next(iter(source.attributes.get("device", ())), None)
        device = devices.async_get(device_id) if device_id else None
        identity = f"ups:{device_id}:{source.check_id}"
        if (
            identity in result
            or device is None
            or not source.owner_id
            or hass.config_entries.async_get_entry(source.owner_id) is None
        ):
            continue
        result[identity] = Source(
            node_id=identity,
            name=source.name,
            kind="ups",
            entity_id=source.entity_id,
            owner_id=source.owner_id,
            check_id=source.check_id,
            attributes=source.attributes,
            ups_entities=source.ups_entities,
            ups_platform=source.ups_platform,
            ups_name=device.name_by_user or device.name or source.ups_name,
            disabled=bool(device.disabled_by),
            watched=False,
        )
    return result


def measurement(state: State | None, role: str) -> float | None:
    """Normalize a mapped percentage or remaining-runtime estimate."""
    value = current(state)
    if value is None or state is None:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if not math.isfinite(number) or number < 0:
        return None
    unit = state.attributes.get("unit_of_measurement")
    if role == "load":
        return number if unit in {None, "%"} else None
    if role in {"charge", "charge_low"}:
        return number if unit in {None, "%"} and number <= 100 else None
    if role in {"runtime", "runtime_low"}:
        scale = (
            {"s": 1 / 60, "min": 1, "h": 60}.get(unit)
            if isinstance(unit, str)
            else None
        )
        return number * scale if scale is not None else None
    return number


@dataclass(slots=True, kw_only=True)
class UpsMonitor:
    """Retain confirmed mode and reserve hysteresis without claiming freshness."""

    source: Source
    parameters: ReserveParameters
    mode: str | None = None
    low_charge: bool = False
    low_runtime: bool = False
    device_charge_low: float | None = None
    device_runtime_low: float | None = None
    latest: Observation | None = None

    def snapshot(self) -> dict[str, Any]:
        """Persist only adapter-owned mode and numeric qualification state."""
        return {
            "source": json_object(self.source),
            "mode": self.mode,
            "low_charge": self.low_charge,
            "low_runtime": self.low_runtime,
            "device_charge_low": self.device_charge_low,
            "device_runtime_low": self.device_runtime_low,
        }

    def restore(self, data: Mapping[str, Any]) -> None:
        """Restore context; fresh readings still determine condition recovery."""
        self.mode = (
            data.get("mode") if data.get("mode") in {"mains", "backup"} else None
        )
        self.low_charge = data.get("low_charge") is True
        self.low_runtime = data.get("low_runtime") is True
        for key in ("device_charge_low", "device_runtime_low"):
            value = data.get(key)
            if (
                isinstance(value, int | float)
                and not isinstance(value, bool)
                and math.isfinite(value)
                and value >= 0
            ):
                setattr(self, key, float(value))

    def evaluate(
        self, states: Mapping[str, State | None], now: datetime
    ) -> Observation:
        """Evaluate one independent condition from its mapped current reports."""
        source, flags = self.source, _FLAGS[self.source.ups_platform or "nut"]
        states = {
            role: None
            if entity in source.ups_disabled_entities or source.disabled
            else states.get(role)
            for role, entity in source.ups_entities
        }
        raw = current(states.get("status")) if not source.disabled else None
        tokens = set(raw.split()) if raw else set()
        valid = bool(tokens & set(flags.values())) and "COMMLOST" not in tokens
        mains, backup = flags["mains"] in tokens, flags["backup"] in tokens
        confirmed = (
            "mains"
            if mains and not backup
            else "backup"
            if backup and not mains
            else None
        )
        previous_mode = self.mode
        if confirmed is not None and valid:
            self.mode = confirmed
        readings = {
            role: measurement(state, role)
            for role, state in states.items()
            if role not in {"status", "charging"}
        }
        evidence: dict[str, JSONValue] = {
            "platform": source.ups_platform,
            "status": raw,
            "flags": to_json(sorted(tokens)),
            "power_mode": confirmed if valid else None,
            "reporting_mode": self.mode,
            "entities": dict(source.ups_entities),
            "disabled_entities": to_json(source.ups_disabled_entities),
            "readings": to_json(readings),
            "charging": current(states.get("charging")),
            "conflict": mains and backup,
            "mode_changed_to_backup": confirmed == "backup"
            and previous_mode != "backup"
            and valid,
        }
        if "COMMLOST" in tokens:
            tokens = set()
            evidence["last_reported_readings"] = evidence["readings"]
            readings = {role: None for role in readings}
            evidence["readings"] = to_json(readings)
        status, reason, message = (
            Status.UNKNOWN,
            "ups_evidence_missing",
            "UPS status cannot currently be established",
        )
        if source.check_id == "ups_power":
            if valid and confirmed == "backup":
                status, reason, message = (
                    Status.WARN,
                    "ups_on_battery",
                    "Running on backup power",
                )
            elif valid and confirmed == "mains":
                status, reason, message = (
                    Status.PASS,
                    "ups_on_mains",
                    "Mains power reported",
                )
        elif source.check_id == "ups_battery_replacement":
            if flags["replace"] in tokens:
                status, reason, message = (
                    Status.WARN,
                    "ups_battery_replace",
                    "UPS reports its battery needs replacement",
                )
            elif valid and confirmed:
                status, reason, message = (
                    Status.PASS,
                    "ups_battery_normal",
                    "UPS reports no battery replacement warning",
                )
        elif source.check_id == "ups_fault":
            faults = [
                message
                for token, message in _FAULTS[source.ups_platform or "nut"].items()
                if token in tokens
            ]
            if faults:
                status, reason, message = Status.FAIL, "ups_fault", "; ".join(faults)
            elif "BYPASS" in tokens:
                status, reason, message = (
                    Status.WARN,
                    "ups_protection_lost",
                    "UPS reports bypass; battery protection is unavailable",
                )
            elif valid and confirmed:
                status, reason, message = (
                    Status.PASS,
                    "ups_fault_clear",
                    "UPS reports no mapped fault",
                )
        elif source.check_id == "ups_reserve":
            numeric_low, missing = self._reserve(readings)
            low = flags["low"] in tokens or numeric_low
            evidence["thresholds"] = to_json(self.parameters.data())
            evidence["reserve_low"] = low
            if low:
                status = Status.WARN
                reason = (
                    "ups_reserve_critical"
                    if self.mode == "backup"
                    else "ups_reserve_low"
                    if self.mode == "mains"
                    else "ups_reserve_mode_unknown"
                )
                message = (
                    "Low reserve on backup power"
                    if valid and confirmed == "backup"
                    else "Mains restored; reserve still low"
                    if valid and confirmed == "mains" and previous_mode == "backup"
                    else "Low reserve on mains power"
                    if valid and confirmed == "mains"
                    else "Low reserve; last confirmed on backup power"
                    if self.mode == "backup"
                    else "Low reserve; last confirmed on mains power"
                    if self.mode == "mains"
                    else "Low reserve; power mode unknown"
                )
            elif valid and confirmed and not missing:
                status, reason, message = (
                    Status.PASS,
                    "ups_reserve_normal",
                    "Monitored UPS reserve readings have recovered",
                )
        if "CAL" in tokens or "TEST" in tokens:
            evidence["test_or_calibration"] = True
            if source.check_id == "ups_power" and status is Status.WARN:
                message += " during a reported test or calibration"
        self.latest = Observation(
            node_id=source.node_id,
            check_id=source.check_id,
            status=status,
            reason=reason,
            observed_at=now,
            message=message,
            evidence=evidence,
        )
        return self.latest

    def _reserve(self, readings: Mapping[str, float | None]) -> tuple[bool, bool]:
        missing = False
        low_values = []
        for role, configured_low, configured_clear, remembered in (
            (
                "charge",
                self.parameters.charge_low,
                self.parameters.charge_clear,
                "low_charge",
            ),
            (
                "runtime",
                self.parameters.runtime_low_minutes,
                self.parameters.runtime_clear_minutes,
                "low_runtime",
            ),
        ):
            hardware_low = readings.get(f"{role}_low")
            if hardware_low is not None:
                setattr(self, f"device_{role}_low", hardware_low)
            low = (
                configured_low
                if configured_low is not None
                else getattr(self, f"device_{role}_low")
            )
            if low is None:
                continue
            value = readings.get(role)
            if value is None or (configured_low is None and hardware_low is None):
                missing = True
                continue
            clear = configured_clear if configured_clear is not None else low
            active = value <= low or (getattr(self, remembered) and value < clear)
            setattr(self, remembered, active)
            low_values.append(active)
        return any(low_values), missing
