"""Vacuum activity observations from the Home Assistant vacuum entity."""

from datetime import datetime

from health_tree.types import Observation, Status
from homeassistant.components.vacuum.const import VacuumActivity
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import area_registry as ar

from .catalog import Source

_WORKING = frozenset(
    {
        VacuumActivity.CLEANING.value,
        VacuumActivity.DOCKED.value,
        VacuumActivity.IDLE.value,
        VacuumActivity.PAUSED.value,
        VacuumActivity.RETURNING.value,
    }
)


def candidates(entities: dict[str, Source]) -> dict[str, Source]:
    """Offer each vacuum entity as its own activity source."""
    result: dict[str, Source] = {}
    for source in entities.values():
        if source.kind != "entity" or source.attributes.get("domain") != ("vacuum",):
            continue
        reference = source.attributes["entity"][0]
        node_id = f"vacuum:{reference}"
        result[node_id] = Source(
            node_id=node_id,
            name=source.name,
            kind="vacuum",
            entity_id=source.entity_id,
            owner_id=source.owner_id,
            disabled=source.disabled,
            attributes={**source.attributes, "kind": ("vacuum",)},
            check_id="vacuum",
            watched=False,
        )
    return result


def _area_name(hass: HomeAssistant, source: Source) -> str | None:
    area_id = next(iter(source.attributes.get("area", ())), None)
    if area_id is None:
        return None
    area = ar.async_get(hass).async_get_area(area_id)
    return area.name if area is not None else None


def _current(state: State | None) -> str | None:
    if (
        state is None
        or state.state in {STATE_UNKNOWN, STATE_UNAVAILABLE}
        or state.attributes.get("restored")
    ):
        return None
    return state.state


def observe(
    hass: HomeAssistant,
    source: Source,
    now: datetime,
    *,
    changed_entity_id: str | None = None,
    changed_state: State | None = None,
) -> Observation:
    """Read one vacuum's current activity without sending it a command."""
    entity_id = source.entity_id
    state = (
        changed_state
        if entity_id is not None and entity_id == changed_entity_id
        else hass.states.get(entity_id)
        if entity_id is not None
        else None
    )
    activity = _current(state)
    area = _area_name(hass, source)
    place = f" in {area}" if area else ""
    if source.disabled:
        status, reason, message = (
            Status.UNKNOWN,
            "disabled",
            f"{source.name} is disabled in Home Assistant.",
        )
    elif activity == VacuumActivity.ERROR.value:
        status, reason, message = (
            Status.FAIL,
            "vacuum_error",
            f"Home Assistant reports {source.name} in error{place}.",
        )
    elif activity in _WORKING:
        status, reason, message = (
            Status.PASS,
            activity,
            f"{source.name} is {activity}.",
        )
    else:
        status, reason, message = (
            Status.UNKNOWN,
            "vacuum_unknown",
            f"Home Assistant has no current activity for {source.name}.",
        )
    return Observation(
        node_id=source.node_id,
        check_id="vacuum",
        status=status,
        reason=reason,
        observed_at=now,
        message=message,
        evidence={
            "activity": activity,
            "area": area,
            "entity_id": entity_id,
            "physical_freshness_verified": False,
        },
    )
