"""Read device availability separately from selected-entity monitoring."""

from collections.abc import Mapping

from health_tree.types import JSONValue
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er


def summarize_device_availability(
    states: Mapping[str, State | None],
    *,
    disabled: bool = False,
    reports: Mapping[str, str] | None = None,
    attached_entries: frozenset[str] = frozenset(),
    loaded_entries: frozenset[str] = frozenset(),
    connectivity_entities: frozenset[str] = frozenset(),
) -> dict[str, JSONValue]:
    """Apply discussion 1400 to a current snapshot, without retaining reports.

    The caller supplies current reports and attachment/load membership together.
    The supported HA version has no report API, so live reads use entity fallback.
    Restored states and missing states cannot establish current availability.
    """
    current_reports = {
        entry_id: status
        for entry_id, status in (reports or {}).items()
        if entry_id in attached_entries and entry_id in loaded_entries
    }
    if any(
        status not in {"available", "unavailable"}
        for status in current_reports.values()
    ):
        raise ValueError("Invalid integration availability report")
    available = unavailable = missing = restored = 0
    for state in states.values():
        if state is None:
            missing += 1
        elif state.attributes.get("restored"):
            restored += 1
        elif state.state == STATE_UNAVAILABLE:
            unavailable += 1
        else:
            available += 1
    disconnected = sorted(
        entity_id
        for entity_id in connectivity_entities & states.keys()
        if (state := states[entity_id]) is not None
        and not state.attributes.get("restored")
        and state.state == "off"
    )
    connectivity_values: list[JSONValue] = [
        entity_id for entity_id in sorted(connectivity_entities & states.keys())
    ]
    disconnected_values: list[JSONValue] = [entity_id for entity_id in disconnected]
    available -= len(disconnected)
    basis = "integration_reports" if current_reports else "entities"
    if disabled:
        status, reason, basis = "disabled", "disabled", "device_registry"
    elif current_reports:
        values = set(current_reports.values())
        status = "partially_available" if len(values) > 1 else next(iter(values))
        reason = "integration_reports"
    elif disconnected:
        status, reason = "unavailable", "connectivity_disconnected"
    elif available:
        status, reason = "available", "entity_available"
    elif states and unavailable == len(states):
        status, reason = "unavailable", "all_entities_unavailable"
    else:
        status = "unknown"
        reason = (
            "incomplete_evidence"
            if unavailable
            else "no_current_states"
            if states
            else "no_entities"
        )
    return {
        "status": status,
        "basis": basis,
        "reason": reason,
        "integration_statuses": dict(current_reports),
        "entity_ids": [entity_id for entity_id in sorted(states)],
        "connectivity_entity_ids": connectivity_values,
        "disconnected_entity_ids": disconnected_values,
        "entity_count": len(states),
        "available_count": available,
        "disconnected_count": len(disconnected),
        "unavailable_count": unavailable,
        "missing_count": missing,
        "restored_count": restored,
    }


def device_availability(hass: HomeAssistant, device_id: str) -> dict[str, JSONValue]:
    """Read all enabled device entities, independently of monitoring exclusions."""
    device = dr.async_get(hass).async_get(device_id)
    if device is None:
        return {**summarize_device_availability({}), "reason": "device_missing"}
    entities = er.async_entries_for_device(
        er.async_get(hass), device_id, include_disabled_entities=False
    )
    states = {
        entity.entity_id: hass.states.get(entity.entity_id) for entity in entities
    }
    connectivity_entities: set[str] = set()
    for entity in entities:
        state = states[entity.entity_id]
        device_class = entity.device_class or entity.original_device_class
        if device_class is None and state is not None:
            device_class = state.attributes.get("device_class")
        if entity.domain == "binary_sensor" and device_class == "connectivity":
            connectivity_entities.add(entity.entity_id)
    return summarize_device_availability(
        states,
        disabled=device.disabled_by is not None,
        connectivity_entities=frozenset(connectivity_entities),
    )
