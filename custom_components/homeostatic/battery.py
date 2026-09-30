"""HA battery metadata and current-state observations for maintenance findings."""

import math
from datetime import datetime

from health_tree.types import Observation, Status
from homeassistant.const import STATE_OFF, STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr

from .catalog import Source

LOW_PERCENT = 20.0


def candidates(hass: HomeAssistant, entities: dict[str, Source]) -> dict[str, Source]:
    """Offer battery signals as separate maintenance capabilities."""
    devices = dr.async_get(hass)
    groups: dict[str, dict[str, list[Source]]] = {}
    for source in entities.values():
        if source.kind != "entity" or source.entity_id is None:
            continue
        domain = source.attributes.get("domain", ())
        device_class = source.attributes.get("device_class", ())
        signal: str | None = None
        if domain[0:1] in {("sensor",), ("number",)} and device_class == ("battery",):
            signal = "level"
        elif domain == ("binary_sensor",):
            if device_class == ("battery",):
                signal = "warning"
            elif device_class == ("battery_charging",):
                signal = "charging"
        if signal is None:
            continue
        device_id = next(iter(source.attributes.get("device", ())), None)
        key = f"device:{device_id}" if device_id else source.node_id
        groups.setdefault(key, {"level": [], "warning": [], "charging": []})[
            signal
        ].append(source)

    result: dict[str, Source] = {}
    for group in groups.values():
        levels, warnings, charging = (
            group["level"],
            group["warning"],
            group["charging"],
        )
        if not levels and not warnings:
            continue
        paired = len(levels) <= 1 and len(warnings) <= 1
        primaries = levels + warnings
        if paired:
            primaries = primaries[:1]
        for primary in primaries:
            level = primary if primary in levels else None
            warning = primary if primary in warnings else None
            if paired:
                level = levels[0] if levels else None
                warning = warnings[0] if warnings else None
            charge = charging[0] if paired and len(charging) == 1 else None
            device_id = next(iter(primary.attributes.get("device", ())), None)
            device = devices.async_get(device_id) if device_id else None
            name = (
                f"{device.name_by_user or device.name} battery"
                if device and (device.name_by_user or device.name)
                else primary.name
            )
            reference = primary.attributes["entity"][0]
            metadata = {
                **primary.attributes,
                "kind": ("battery",),
                "entity": (reference,),
            }
            node_id = f"battery:{reference}"
            result[node_id] = Source(
                node_id=node_id,
                name=name,
                kind="battery",
                entity_id=primary.entity_id,
                owner_id=primary.owner_id,
                disabled=primary.disabled,
                attributes=metadata,
                check_id="battery",
                battery_level_entity=level.entity_id if level else None,
                battery_warning_entity=warning.entity_id if warning else None,
                battery_charging_entity=charge.entity_id if charge else None,
            )
    return result


def _current(state: State | None) -> str | None:
    if (
        state is None
        or state.state in {STATE_UNKNOWN, STATE_UNAVAILABLE}
        or state.attributes.get("restored")
    ):
        return None
    return state.state


def _percent(state: State | None) -> float | None:
    value = _current(state)
    if value is None or (
        state is not None
        and state.attributes.get("unit_of_measurement") not in (None, "%")
    ):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) and 0 <= number <= 100 else None


def observe(
    hass: HomeAssistant,
    source: Source,
    now: datetime,
    *,
    changed_entity_id: str | None = None,
    changed_state: State | None = None,
) -> Observation:
    """Resolve one selected battery's low condition from current HA states."""

    def state_for(entity_id: str | None) -> State | None:
        if entity_id is None:
            return None
        return (
            changed_state
            if entity_id == changed_entity_id
            else hass.states.get(entity_id)
        )

    level_state = (
        state_for(source.battery_level_entity) if source.battery_level_entity else None
    )
    warning_state = (
        state_for(source.battery_warning_entity)
        if source.battery_warning_entity
        else None
    )
    charging_state = (
        state_for(source.battery_charging_entity)
        if source.battery_charging_entity
        else None
    )
    percent = _percent(level_state) if source.battery_level_entity else None
    warning = _current(warning_state) if source.battery_warning_entity else None
    charging = _current(charging_state) if source.battery_charging_entity else None
    warning_valid = warning in {STATE_ON, STATE_OFF}
    low = (percent is not None and percent <= LOW_PERCENT) or warning == STATE_ON
    missing = (source.battery_level_entity is not None and percent is None) or (
        source.battery_warning_entity is not None and not warning_valid
    )
    conflict = (
        percent is not None
        and warning_valid
        and (percent <= LOW_PERCENT) != (warning == STATE_ON)
    )
    if source.disabled:
        status, reason, detail = (
            Status.UNKNOWN,
            "disabled",
            "is disabled in Home Assistant",
        )
    elif charging == STATE_ON:
        status, reason, detail = Status.PASS, "charging", "is charging"
    elif low:
        status, reason = Status.WARN, "battery_low"
        detail = "has conflicting low-battery reports" if conflict else "is low"
    elif missing:
        status, reason, detail = (
            Status.UNKNOWN,
            "battery_evidence_missing",
            "has incomplete battery evidence",
        )
    else:
        status, reason, detail = (
            Status.PASS,
            "battery_ok",
            "is above 20% or reports normal",
        )
    return Observation(
        node_id=source.node_id,
        check_id="battery",
        status=status,
        reason=reason,
        observed_at=now,
        message=f"{source.name} {detail}.",
        evidence={
            "battery_pct": percent,
            "low_warning": warning if warning_valid else None,
            "charging": charging if charging in {STATE_ON, STATE_OFF} else None,
            "conflicting_reports": conflict,
            "level_entity_id": source.battery_level_entity,
            "warning_entity_id": source.battery_warning_entity,
            "charging_entity_id": source.battery_charging_entity,
            "physical_freshness_verified": False,
        },
    )
