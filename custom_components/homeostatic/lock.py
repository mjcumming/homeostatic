"""Reported lock jams from Home Assistant's standard lock state."""

from dataclasses import replace
from datetime import datetime

from health_tree.types import Observation, Status
from homeassistant.components.lock.const import LockState
from homeassistant.core import HomeAssistant, State

from .catalog import Source, live_state

_CLEAR = frozenset(state.value for state in LockState if state != LockState.JAMMED)


def candidates(entities: dict[str, Source]) -> dict[str, Source]:
    """Offer each lock independently of availability or jam-reporting support."""
    return {
        f"lock:{source.attributes['entity'][0]}": replace(
            source,
            node_id=f"lock:{source.attributes['entity'][0]}",
            kind="lock",
            check_id="lock_jam",
            requirements=(),
            attributes={**source.attributes, "kind": ("lock",)},
            watched=False,
        )
        for source in entities.values()
        if source.kind == "entity" and source.attributes.get("domain") == ("lock",)
    }


def observe(
    hass: HomeAssistant,
    source: Source,
    now: datetime,
    *,
    changed_entity_id: str | None = None,
    changed_state: State | None = None,
) -> Observation:
    """Capture a reported jam without inferring command completion or freshness."""
    state = (
        changed_state
        if source.entity_id is not None and source.entity_id == changed_entity_id
        else hass.states.get(source.entity_id)
        if source.entity_id is not None
        else None
    )
    value = live_state(state)
    if source.disabled:
        status, reason, message = (
            Status.UNKNOWN,
            "disabled",
            f"{source.name} is disabled in Home Assistant.",
        )
    elif value == LockState.JAMMED:
        status, reason, message = (
            Status.FAIL,
            "lock_jammed",
            f"Home Assistant reports {source.name} is jammed.",
        )
    elif value in _CLEAR:
        status, reason, message = (
            Status.PASS,
            "lock_not_jammed",
            f"Home Assistant reports {source.name} is {value}; no jam is reported.",
        )
    else:
        status = Status.UNKNOWN
        reason = (
            "lock_missing"
            if state is None
            else "lock_restored"
            if state.attributes.get("restored")
            else "lock_unknown"
        )
        message = f"Waiting for a current recognized lock state for {source.name}."
    return Observation(
        node_id=source.node_id,
        check_id="lock_jam",
        status=status,
        reason=reason,
        observed_at=now,
        message=message,
        evidence={
            "state": value,
            "entity_id": source.entity_id,
            "physical_freshness_verified": False,
        },
    )
