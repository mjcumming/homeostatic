"""Read standard Home Assistant condition reports without inferring device faults."""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING

from health_tree.types import Observation, Status
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import area_registry as ar

if TYPE_CHECKING:
    from .catalog import Source


@dataclass(frozen=True, slots=True, kw_only=True)
class ReportedCondition:
    """The exact source contract and initial choices for one reported condition."""

    name: str
    domain: str = "binary_sensor"
    device_class: str | None = None
    active: str = "on"
    clear: frozenset[str] = frozenset({"off"})
    message: str
    profile: str = "immediate"
    all_sources: bool = False


CONDITIONS = {
    "problem": ReportedCondition(
        name="Problem sensors",
        device_class="problem",
        message="a problem",
        profile="morning",
        all_sources=True,
    ),
    "lawn_mower": ReportedCondition(
        name="Lawn mower errors",
        domain="lawn_mower",
        active="error",
        clear=frozenset({"mowing", "docked", "paused", "returning", "idle"}),
        message="the mower is in error",
        all_sources=True,
    ),
    "tamper": ReportedCondition(
        name="Tamper",
        device_class="tamper",
        message="tampering",
    ),
    "safety": ReportedCondition(
        name="Unsafe condition",
        device_class="safety",
        message="an unsafe condition",
    ),
    "moisture": ReportedCondition(
        name="Water leak",
        device_class="moisture",
        message="moisture detected",
    ),
    "smoke": ReportedCondition(
        name="Smoke detected",
        device_class="smoke",
        message="smoke detected",
    ),
    "gas": ReportedCondition(
        name="Gas detected",
        device_class="gas",
        message="gas detected",
    ),
    "carbon_monoxide": ReportedCondition(
        name="Carbon monoxide detected",
        device_class="carbon_monoxide",
        message="carbon monoxide detected",
    ),
    "alarm_triggered": ReportedCondition(
        name="Triggered alarm",
        domain="alarm_control_panel",
        active="triggered",
        clear=frozenset(
            {
                "disarmed",
                "armed_home",
                "armed_away",
                "armed_night",
                "armed_vacation",
                "armed_custom_bypass",
                "pending",
                "arming",
                "disarming",
            }
        ),
        message="the alarm is triggered",
    ),
}


def candidates(hass: HomeAssistant, entities: dict[str, Source]) -> dict[str, Source]:
    """Offer exact domain/class matches, including enabled diagnostic sensors."""
    result = {}
    for source in tuple(entities.values()):
        if source.kind != "entity":
            continue
        for check, condition in CONDITIONS.items():
            if source.attributes.get("domain") != (condition.domain,) or (
                condition.device_class is not None
                and source.attributes.get("device_class") != (condition.device_class,)
            ):
                continue
            identity = f"{check}:{source.attributes['entity'][0]}"
            owner = (
                hass.config_entries.async_get_entry(source.owner_id)
                if source.owner_id
                else None
            )
            result[identity] = replace(
                source,
                node_id=identity,
                kind=check,
                check_id=check,
                requirements=(),
                disabled=source.disabled or bool(owner and owner.disabled_by),
                attributes={**source.attributes, "kind": (check,)},
                watched=False,
            )
    return result


def observe(
    hass: HomeAssistant,
    source: Source,
    now: datetime,
    *,
    changed_entity_id: str | None = None,
    changed_state: State | None = None,
) -> Observation:
    """Use a captured report; gaps cannot establish a condition or its recovery."""
    condition = CONDITIONS[source.check_id]
    area_id = next(iter(source.attributes.get("area", ())), None)
    area = ar.async_get(hass).async_get_area(area_id) if area_id else None
    place = f" in {area.name}" if area else ""
    state = (
        changed_state
        if source.entity_id is not None and source.entity_id == changed_entity_id
        else hass.states.get(source.entity_id)
        if source.entity_id
        else None
    )
    value = (
        state.state
        if state is not None and not state.attributes.get("restored")
        else None
    )
    status = Status.UNKNOWN
    reason = f"{source.check_id}_unknown"
    message = f"Waiting for a current recognized report for {source.name}."
    if source.disabled:
        reason, message = "disabled", f"{source.name} is disabled in Home Assistant."
    elif value == condition.active:
        status, reason = Status.FAIL, f"{source.check_id}_reported"
        message = (
            f"Home Assistant reports {condition.message} for {source.name}{place}."
        )
    elif value in condition.clear:
        status, reason = Status.PASS, f"{source.check_id}_clear"
        message = f"Home Assistant reports {source.name} is {value}; this condition is not reported."
    return Observation(
        node_id=source.node_id,
        check_id=source.check_id,
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
