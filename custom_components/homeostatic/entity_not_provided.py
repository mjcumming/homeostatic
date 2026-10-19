"""Observe missing live entities without diagnosing obsolete registrations."""

from dataclasses import replace
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from health_tree.types import Check, Node, Observation, Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

if TYPE_CHECKING:
    from .catalog import Source
    from .config import Settings
    from .monitoring import MonitoringPolicy

CHECK = "entity_not_provided"
DEFAULT_DURATION_SECONDS = 86400
MAX_DURATION_SECONDS = 31536000


def parameters(value: dict[str, Any]) -> dict[str, int]:
    """Validate the one configurable qualification duration."""
    duration = value.get("duration_seconds", DEFAULT_DURATION_SECONDS)
    if (
        value.keys() - {"duration_seconds"}
        or type(duration) is not int
        or not 0 <= duration <= MAX_DURATION_SECONDS
    ):
        raise ValueError("Choose a whole-number duration from 0 to 365 days")
    return {"duration_seconds": duration}


def sources(
    policies: tuple[MonitoringPolicy, ...], candidates: dict[str, Source]
) -> dict[str, Source]:
    """Bind this independent condition to selected canonical entity sources."""
    result = {}
    for policy in policies:
        if policy.check != CHECK or not policy.enabled:
            continue
        for source in candidates.values():
            if (
                source.kind != "entity"
                or source.disabled
                or source.owner_id is None
                or not policy.matches(source.attributes, source_id=source.node_id)
            ):
                continue
            identity = (
                f"monitoring:{policy.id}:{policy.detection_key()}:{source.node_id}"
            )
            result[identity] = replace(
                source,
                node_id=identity,
                kind=CHECK,
                check_id=CHECK,
                watched=True,
                monitoring_source=source.node_id,
                monitoring_policy=policy.id,
                attached_by=(policy.id,),
                requirements=(),
            )
    return result


def node(source: Source, settings: Settings) -> Node:
    """Delegate continuous qualification and lifecycle to the public engine API."""
    duration = next(
        (
            policy.parameters["duration_seconds"]
            for policy in settings.monitoring_policies
            if policy.id == source.monitoring_policy
        ),
        DEFAULT_DURATION_SECONDS,
    )
    return Node(
        node_id=source.node_id,
        kind=CHECK,
        importance=source.importance,
        labels={"name": source.name, "homeostatic_source": CHECK},
        checks=(
            Check(
                check_id=CHECK,
                raise_hold=timedelta(seconds=duration),
                clear_hold=timedelta(0),
                ttl=None,
                unknown_hold=settings.duration("unknown_hold"),
                labels={"category": "maintenance"},
            ),
        ),
    )


def state_provided(state: State | None) -> bool:
    """Return whether HA has a live state, regardless of its reported value."""
    return state is not None and not state.attributes.get("restored")


def observe(
    hass: HomeAssistant,
    source: Source,
    now: datetime,
    *,
    changed_entity_id: str | None = None,
    changed_state: State | None = None,
) -> Observation:
    """Report whether a loaded integration supplies its enabled registration.

    The engine qualifies the warning using the policy's raise hold. Unknown
    evidence never establishes either a missing provider or a return to service.
    """
    entity_id = source.entity_id
    registered = er.async_get(hass).async_get(entity_id) if entity_id else None
    device = (
        dr.async_get(hass).async_get(registered.device_id)
        if registered and registered.device_id
        else None
    )
    owner = (
        hass.config_entries.async_get_entry(source.owner_id)
        if source.owner_id
        else None
    )
    state = (
        changed_state
        if entity_id is not None and changed_entity_id == entity_id
        else hass.states.get(entity_id)
        if entity_id is not None
        else None
    )
    if (
        source.disabled
        or (registered and registered.disabled_by)
        or (device and device.disabled_by)
        or (owner and owner.disabled_by)
    ):
        status, reason, message = (
            Status.UNKNOWN,
            "disabled",
            "This entity or its owning device or integration is disabled.",
        )
    elif not registered or not owner or registered.config_entry_id != source.owner_id:
        status, reason, message = (
            Status.UNKNOWN,
            "provider_not_confirmed",
            "The registered entity's owning integration cannot be confirmed.",
        )
    elif not hass.is_running or owner.state is not ConfigEntryState.LOADED:
        status, reason, message = (
            Status.UNKNOWN,
            "provider_not_loaded",
            "Waiting for Home Assistant and the owning integration to finish loading.",
        )
    elif not state_provided(state):
        status, reason, message = (
            Status.WARN,
            CHECK,
            f"{owner.title} is loaded but is not providing {source.name}.",
        )
    else:
        status, reason, message = (
            Status.PASS,
            "entity_provided",
            f"{owner.title} is providing {source.name}.",
        )
    return Observation(
        node_id=source.node_id,
        check_id=CHECK,
        status=status,
        reason=reason,
        observed_at=now,
        message=message,
        evidence={
            "entity_id": entity_id,
            "owner_id": source.owner_id,
            "integration": owner.title if owner else None,
            "integration_state": owner.state.value if owner else None,
            "state": state.state if state else None,
            "restored": bool(state and state.attributes.get("restored")),
        },
    )
