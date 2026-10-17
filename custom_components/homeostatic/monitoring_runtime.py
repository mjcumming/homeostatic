"""Bind named expectations to discovered sources without private engine state."""

import hashlib
from dataclasses import replace
from typing import Any

from homeassistant.core import HomeAssistant, State

from .catalog import Source
from .monitoring import TEMPERATURE_CHECKS, MonitoringPolicy
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
        )
        for policy in policies
        if policy.check not in TEMPERATURE_CHECKS | UPS_CHECKS
    )


def ordinary_sources(
    policies: tuple[MonitoringPolicy, ...],
    sources: dict[str, Source],
    *,
    candidates: dict[str, Source] | None = None,
) -> dict[str, Source]:
    """Give each policy its own findings and retain explicit upstream dependencies."""
    candidates = sources if candidates is None else candidates
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
        excluded_entities = {
            identity: candidate.entity_id
            for identity in policy.excluded_sources
            if (candidate := candidates.get(identity)) is not None
            and candidate.kind == "entity"
        }
        for source in originals.values():
            if (
                source.disabled
                or policy.check != source.check_id
                or not policy.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
            ):
                continue
            member_exclusions: tuple[str, ...] = ()
            if source.kind == "device":
                member_exclusions = tuple(
                    identity
                    for identity, entity_id in excluded_entities.items()
                    if entity_id in source.availability_entities
                )
                members = tuple(
                    entity_id
                    for entity_id in source.availability_entities
                    if entity_id not in excluded_entities.values()
                )
                if not members:
                    continue
                source = replace(source, availability_entities=members)
            detection_key = policy.detection_key(member_exclusions=member_exclusions)
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


def retain_source_identities(
    sources: dict[str, Source],
    bindings: dict[str, str],
    *,
    policies: tuple[MonitoringPolicy, ...],
    previous_scopes: dict[str, tuple[str, ...]],
    candidates: dict[str, Source],
    legacy_policies: tuple[MonitoringPolicy, ...] = (),
) -> tuple[dict[str, Source], dict[str, str]]:
    """Preserve device checks through catalog churn and replace edited scopes."""
    base_keys = {policy.id: policy.detection_key() for policy in policies}
    scope_changes = {
        policy.id: set(previous_scopes.get(policy.id, policy.excluded_sources))
        ^ set(policy.excluded_sources)
        for policy in policies
    }
    canonical_entities = {
        source.entity_id: identity
        for identity, source in candidates.items()
        if source.kind == "entity" and source.entity_id is not None
    }
    legacy_keys = {
        policy.id: policy.detection_key(member_exclusions=policy.excluded_sources)
        for policy in legacy_policies
    }
    retained: dict[str, str] = {}
    translated: dict[str, str] = {}
    for identity, source in sources.items():
        key = identity
        policy_id = source.monitoring_policy
        device_id = source.monitoring_source if source.kind == "device" else None
        if device_id is not None and policy_id is not None:
            key = f"monitoring:{policy_id}:{base_keys[policy_id]}:{device_id}"
        bound = bindings.get(key, identity)
        if policy_id is not None and policy_id in legacy_keys:
            bound = f"monitoring:{policy_id}:{legacy_keys[policy_id]}:{original_identity(identity)}"
        elif device_id is not None and policy_id is not None and key in bindings:
            eligible = {
                canonical_entities[entity_id]
                for entity_id in sources[device_id].availability_entities
                if entity_id in canonical_entities
            }
            if eligible & scope_changes[policy_id]:
                bound = identity
                if bound == bindings[key]:
                    # Registry churn may have retained this hash from an earlier scope.
                    digest = hashlib.sha256(
                        f"{bound}:scope-change".encode()
                    ).hexdigest()[:16]
                    bound = f"monitoring:{policy_id}:{digest}:{device_id}"
        translated[identity] = bound
        if (device_id is not None and policy_id is not None) or bound != identity:
            retained[key] = bound
    return {
        translated[identity]: replace(
            source,
            node_id=translated[identity],
            requirements=tuple(
                translated.get(item, item) for item in source.requirements
            ),
        )
        for identity, source in sources.items()
    }, retained


def original_identity(identity: str) -> str:
    """Resolve the registry record behind an independent policy condition."""
    return identity.split(":", 3)[3] if identity.startswith("monitoring:") else identity


def thermostat_enrolled(state: State | None) -> bool:
    """Keep missing evidence enrolled and retire only a reported unsupported mode."""
    return (
        state is None
        or bool(state.attributes.get("restored"))
        or state.state in {"heat", "cool", "heat_cool", "unknown", "unavailable"}
    )


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
                and policy.matches(
                    candidate.attributes,
                    source_id=candidate.monitoring_source or candidate.node_id,
                )
            )
            for candidate in related
        )
    )
