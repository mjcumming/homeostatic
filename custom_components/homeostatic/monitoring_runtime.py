"""Bind named expectations to discovered sources without private engine state."""

import hashlib
import json
from dataclasses import replace
from typing import Any

from homeassistant.core import HomeAssistant, State

from .catalog import Source
from .config import resolve_entity
from .left_open import CONTACT_CLASSES
from .monitoring import TEMPERATURE_CHECKS, MonitoringPolicy
from .reported_conditions import CONDITIONS
from .rules import CatalogRule
from .ups_parameters import UPS_CHECKS


def enrollment_rules(policies: tuple[MonitoringPolicy, ...]) -> tuple[CatalogRule, ...]:
    """Reuse catalog enrollment for checks that already share one expectation."""
    return tuple(
        CatalogRule(
            id=f"policy_{policy.id}",
            match=policy.match,
            checks=(policy.check,),
            enabled=policy.enabled,
            excluded_sources=policy.excluded_sources,
            included_sources=policy.included_sources,
            match_any=policy.match_any,
            match_none=policy.match_none,
        )
        for policy in policies
        if policy.check
        not in TEMPERATURE_CHECKS | UPS_CHECKS | {"entity_not_provided", "left_open"}
    )


def ordinary_sources(
    policies: tuple[MonitoringPolicy, ...],
    sources: dict[str, Source],
    *,
    candidates: dict[str, Source] | None = None,
) -> dict[str, Source]:
    """Give each policy its own findings and retain explicit upstream dependencies."""
    candidates = sources if candidates is None else candidates
    ordinary = {
        "availability",
        "battery",
        "vacuum",
        "lock_jam",
        "repair",
        "broken_automation",
        *CONDITIONS,
    }
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
            "lock",
            "repair",
            "broken_automation",
            *CONDITIONS,
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
                source.disabled
                or source.kind == "device"
                or policy.check != source.check_id
                or not policy.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
            ):
                continue
            detection_key = policy.detection_key()
            identity = f"monitoring:{policy.id}:{detection_key}:{source.node_id}"
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
            upstream = (f"entry:{source.owner_id}",) if source.owner_id else ()
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


def restore_entity_identities(
    sources: dict[str, Source],
    bindings: dict[str, str],
    legacy_policies: tuple[MonitoringPolicy, ...] = (),
) -> tuple[dict[str, Source], dict[str, str]]:
    """Keep published entity issues stable across the schema-two exclusion upgrade."""
    legacy_keys = {}
    for policy in legacy_policies:
        payload: dict[str, Any] = {
            "check": policy.check,
            "match": dict(policy.match),
            "parameters": dict(policy.parameters),
        }
        if policy.excluded_sources:
            payload["excluded_sources"] = policy.excluded_sources
        if policy.match_any:
            payload["match_any"] = policy.match_any
        if policy.match_none:
            payload["match_none"] = policy.match_none
        legacy_keys[policy.id] = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()[:16]
    translated = {
        identity: (
            f"monitoring:{source.monitoring_policy}:{legacy_keys[source.monitoring_policy]}:{original_identity(identity)}"
            if source.monitoring_policy in legacy_keys
            else bindings.get(identity, identity)
        )
        for identity, source in sources.items()
    }
    return {
        translated[identity]: replace(
            source,
            node_id=translated[identity],
            requirements=tuple(
                translated.get(item, item) for item in source.requirements
            ),
        )
        for identity, source in sources.items()
    }, {identity: bound for identity, bound in translated.items() if identity != bound}


def thermostat_enrolled(state: State | None) -> bool:
    """Keep missing evidence enrolled and retire only a reported unsupported mode."""
    return (
        state is None
        or bool(state.attributes.get("restored"))
        or state.state in {"heat", "cool", "heat_cool", "unknown", "unavailable"}
    )


def left_open_sources(
    hass: HomeAssistant,
    policies: tuple[MonitoringPolicy, ...],
    candidates: dict[str, Source],
) -> dict[str, Source]:
    """Bind independent opening checks without creating duplicate equipment sources."""
    result = {}
    for policy in policies:
        if policy.check != "left_open" or not policy.enabled:
            continue
        for source in candidates.values():
            if (
                source.kind != "entity"
                or source.disabled
                or source.attributes.get("domain") != ("binary_sensor",)
                or not CONTACT_CLASSES.intersection(
                    source.attributes.get("device_class", ())
                )
                or not policy.matches(source.attributes, source_id=source.node_id)
            ):
                continue
            identity = f"monitoring:{policy.id}:{policy.detection_key()}:{source.attributes['entity'][0]}"
            reference = policy.parameters.get("temperature_source")
            result[identity] = replace(
                source,
                node_id=identity,
                kind="left_open",
                check_id="left_open",
                watched=True,
                requirements=(),
                attached_by=(policy.id,),
                monitoring_policy=policy.id,
                monitoring_source=source.node_id,
                left_open_temperature_entity=resolve_entity(hass, reference)
                if reference
                else None,
            )
    return result


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
                or not policy.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
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
            if policy.check == "thermostat" and not thermostat_enrolled(state):
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
                or not policy.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
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
                and policy.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
            )
            if not applies:
                continue
            matched = True
            rows.extend(
                {**row, "id": f"policy_{policy.id}_{row['id']}"}
                for row in policy.notifications
            )
        if matched:
            result[source.node_id] = {
                "default": [],
                "checks": {source.check_id: rows},
            }
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
                and policy.matches(
                    candidate.attributes,
                    source_id=candidate.monitoring_source or candidate.node_id,
                )
            )
            for candidate in related
        )
    )
