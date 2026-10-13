"""Bind named expectations to discovered sources without private engine state."""

from dataclasses import replace
from typing import Any

from homeassistant.core import HomeAssistant

from .catalog import Source
from .monitoring import TEMPERATURE_CHECKS, MonitoringPolicy
from .rules import CatalogRule
from .ups_parameters import UPS_CHECKS, ReserveParameters


def enrollment_rules(policies: tuple[MonitoringPolicy, ...]) -> tuple[CatalogRule, ...]:
    """Reuse catalog enrollment for checks that already share one expectation."""
    return tuple(
        CatalogRule(
            id=f"policy_{policy.id}",
            action="attach",
            match=policy.match,
            checks=(policy.check,),
            enabled=policy.enabled,
        )
        for policy in policies
        if policy.check not in TEMPERATURE_CHECKS | UPS_CHECKS
    )


def ordinary_sources(
    policies: tuple[MonitoringPolicy, ...], sources: dict[str, Source]
) -> dict[str, Source]:
    """Give each policy its own findings and retain explicit upstream dependencies."""
    ordinary = {"availability", "battery", "vacuum", "repair", "broken_automation"}
    originals = {
        identity: source
        for identity, source in sources.items()
        if source.check_id in ordinary
        and source.kind
        in {
            "integration",
            "device",
            "entity",
            "battery",
            "vacuum",
            "repair",
            "broken_automation",
        }
        and source.monitoring_policy is None
    }
    result = {
        identity: source
        for identity, source in sources.items()
        if identity not in originals
    }
    bindings: dict[str, list[str]] = {}
    for policy in policies:
        if not policy.enabled or policy.check not in ordinary:
            continue
        for source in originals.values():
            if (
                source.excluded_by
                or policy.check != source.check_id
                or not policy.matches(source.attributes)
            ):
                continue
            identity = (
                f"monitoring:{policy.id}:{policy.detection_key()}:{source.node_id}"
            )
            bindings.setdefault(source.node_id, []).append(identity)
            result[identity] = replace(
                source,
                node_id=identity,
                name=f"{source.name} · {policy.name}",
                watched=True,
                attached_by=(policy.id,),
                monitoring_policy=policy.id,
                monitoring_source=source.node_id,
                alert_profile=None,
            )
    for identity, source in originals.items():
        if source.kind in {"integration", "device", "entity"}:
            result[identity] = replace(source, watched=False, attached_by=())
    for identity, source in tuple(result.items()):
        if source.monitoring_source is not None and source.check_id == "availability":
            upstream = (
                source.requirements
                if source.kind == "device"
                else (f"entry:{source.owner_id}",)
                if source.owner_id
                else ()
            )
            result[identity] = replace(
                source,
                requirements=tuple(
                    bound for base in upstream for bound in bindings.get(base, ())
                ),
            )
        elif source.kind == "function":
            result[identity] = replace(
                source,
                requirements=tuple(
                    bound
                    for base in source.requirements
                    for bound in bindings.get(base, [base])
                ),
            )
    return result


def original_identity(identity: str) -> str:
    """Resolve the registry record behind an independent policy condition."""
    return identity.split(":", 3)[3] if identity.startswith("monitoring:") else identity


def temperature_sources(
    hass: HomeAssistant,
    policies: tuple[MonitoringPolicy, ...],
    candidates: dict[str, Source],
) -> dict[str, Source]:
    """Create an independent condition per temperature policy and stable sensor."""
    result = {}
    for policy in policies:
        if policy.check not in TEMPERATURE_CHECKS or not policy.enabled:
            continue
        for source in candidates.values():
            if (
                source.kind != "entity"
                or source.disabled
                or source.excluded_by
                or not policy.matches(source.attributes)
            ):
                continue
            domain = source.attributes.get("domain", ())
            if policy.check == "thermostat" and domain != ("climate",):
                continue
            if policy.check == "temperature_limit" and (
                domain != ("sensor",)
                or source.attributes.get("device_class") != ("temperature",)
            ):
                continue
            state = hass.states.get(source.entity_id) if source.entity_id else None
            if (
                policy.check == "thermostat"
                and state is not None
                and not state.attributes.get("restored")
                and state.state
                not in {"heat", "cool", "heat_cool", "unknown", "unavailable"}
            ):
                continue
            identity = f"monitoring:{policy.id}:{policy.detection_key()}:{source.attributes['entity'][0]}"
            result[identity] = replace(
                source,
                node_id=identity,
                name=f"{source.name} · {policy.name}",
                kind=policy.check,
                check_id=policy.check,
                watched=True,
                requirements=(),
                attached_by=(policy.id,),
                excluded_by=(),
                monitoring_policy=policy.id,
            )
    return result


def ups_sources(
    policies: tuple[MonitoringPolicy, ...], candidates: dict[str, Source]
) -> dict[str, Source]:
    """Bind independently configured UPS conditions to a verified device."""
    result: dict[str, Source] = {}
    for policy in policies:
        if policy.check not in UPS_CHECKS or not policy.enabled:
            continue
        for source in candidates.values():
            if (
                source.kind != "ups"
                or source.check_id != policy.check
                or source.excluded_by
                or not policy.matches(source.attributes)
            ):
                continue
            identity = (
                f"monitoring:{policy.id}:{policy.detection_key()}:{source.node_id}"
            )
            result[identity] = replace(
                source,
                node_id=identity,
                watched=True,
                monitoring_policy=policy.id,
                attached_by=(policy.id,),
            )
    return result


def transfer_batteries(
    policies: tuple[MonitoringPolicy, ...],
    candidates: dict[str, Source],
    ups: dict[str, Source],
) -> dict[str, Source]:
    """Suppress reviewed overlapping generic checks without rewriting rules."""
    result = dict(candidates)
    owners: dict[str, list[str]] = {}
    for policy in policies:
        if (
            policy.check != "ups_reserve"
            or not ReserveParameters.from_data(policy.parameters).replace_battery_check
        ):
            continue
        selector = CatalogRule(id=policy.id, action="attach", match=policy.match)
        for candidate in candidates.values():
            charge = dict(candidate.ups_entities).get("charge")
            if (
                candidate.kind == "ups"
                and candidate.check_id == "ups_reserve"
                and charge
                and selector.matches(candidate.attributes)
            ):
                owners.setdefault(charge, []).append(policy.id)
    for battery in candidates.values():
        charge = battery.battery_level_entity
        if (
            battery.kind == "battery"
            and battery.watched
            and charge is not None
            and charge in owners
        ):
            result[battery.node_id] = replace(
                battery,
                watched=False,
                excluded_by=(
                    *battery.excluded_by,
                    *(f"ups_policy_{identity}" for identity in owners[charge]),
                ),
            )
    for source in ups.values():
        if source.check_id != "ups_reserve":
            continue
        charge = dict(source.ups_entities).get("charge")
        for battery in result.values():
            if (
                battery.kind != "battery"
                or not battery.watched
                or battery.battery_level_entity != charge
            ):
                continue
            raise ValueError(
                f"{source.ups_name}: review the transfer from existing battery monitoring before enabling low reserve"
            )
    return result


def assignments(
    policies: tuple[MonitoringPolicy, ...], sources: dict[str, Source]
) -> dict[str, Any]:
    """Pair contributing definitions with existing or independent conditions."""
    result: dict[str, Any] = {}
    for source in sources.values():
        if not source.watched:
            continue
        rows: list[dict[str, Any]] = []
        matched = False
        for policy in policies:
            applies = (
                source.monitoring_policy == policy.id
                if source.monitoring_policy is not None
                else policy.enabled
                and policy.check == source.check_id
                and policy.matches(source.attributes)
            )
            if not applies:
                continue
            matched = True
            rows.extend(
                {**row, "id": f"policy_{policy.id}_{row['id']}"}
                for row in policy.notifications
            )
        if matched:
            result[source.node_id] = {"default": rows, "checks": {}}
    return result


def contributing_policies(
    policies: tuple[MonitoringPolicy, ...],
    source: Source,
    sources: dict[str, Source],
) -> tuple[MonitoringPolicy, ...]:
    """Link a source to definitions that contribute an actual monitored check."""
    related = (
        [source]
        if source.monitoring_policy is not None
        else [
            candidate
            for candidate in sources.values()
            if candidate.node_id == source.node_id
            or candidate.monitoring_source == source.node_id
            or (
                source.entity_id is not None and candidate.entity_id == source.entity_id
            )
        ]
    )
    return tuple(
        policy
        for policy in policies
        if policy.enabled
        and any(
            candidate.watched
            and not candidate.disabled
            and (
                candidate.monitoring_policy == policy.id
                if candidate.monitoring_policy is not None
                else candidate.check_id == policy.check
                and policy.matches(candidate.attributes)
            )
            for candidate in related
        )
    )
