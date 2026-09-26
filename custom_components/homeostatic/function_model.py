"""Function graph composition and read-only configuration explanations."""

from typing import Any

from health_tree.engine import Engine
from homeassistant.components import automation
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .catalog import Source, entity_observation, entry_observation
from .config import Settings, entity_reference, resolve_entity, rule_data
from .const import DOMAIN
from .definitions import Function
from .enrollment import evaluate, inventory
from .rules import Attributes, parse_rules
from .serialization import json_object


def compose(
    hass: HomeAssistant, settings: Settings, candidates: dict[str, Source]
) -> tuple[dict[str, Source], list[str]]:
    """Build explicit requirements without inferring edges from suggestions."""
    required = {
        node_id for function in settings.functions for node_id in function.requirements
    }
    selected = {node_id for node_id, source in candidates.items() if source.watched}
    selected.update(
        node_id for node_id in required if node_id.startswith(("entity:", "entry:"))
    )
    if selected - candidates.keys():
        raise ValueError("Homeostatic cannot be a function requirement")
    selected.update(
        f"entry:{candidates[node_id].owner_id}"
        for node_id in tuple(selected)
        if candidates[node_id].owner_id
    )
    sources = {node_id: candidates[node_id] for node_id in sorted(selected)}
    targets = [node_id for node_id, source in sources.items() if source.watched]
    for capability in settings.external_capabilities:
        node_id = f"external:{capability.id}"
        sources[node_id] = Source(
            node_id=node_id,
            name=capability.name,
            kind="external",
            importance=capability.importance,
            watched=False,
        )
    for function in settings.functions:
        node_id = f"function:{function.id}"
        sources[node_id] = Source(
            node_id=node_id,
            name=function.name,
            kind="function",
            importance=function.importance,
            requirements=function.requirements,
            watched=False,
        )
        targets.append(node_id)
    for node_id in sorted(required - sources.keys()):
        sources[node_id] = Source(
            node_id=node_id, name=node_id, kind=node_id.partition(":")[0], watched=False
        )
    registry = er.async_get(hass)
    for situation in settings.situations:
        entity_id = resolve_entity(hass, situation.entity)
        registered = registry.async_get(entity_id) if entity_id else None
        if registered is not None and registered.platform == DOMAIN:
            raise ValueError("Homeostatic cannot use its own entities")
        node_id = f"situation:{situation.id}"
        sources[node_id] = Source(
            node_id=node_id,
            name=situation.name,
            kind="situation",
            entity_id=entity_id,
            importance=situation.importance,
            disabled=registered is not None and registered.disabled_by is not None,
        )
    return dict(
        sorted(sources.items(), key=lambda item: item[1].kind != "integration")
    ), targets


def suggestions(
    hass: HomeAssistant, function: Function, candidates: dict[str, Source]
) -> list[dict[str, Any]]:
    """Read static automation references without activating dependency edges."""
    provenance: dict[str, list[dict[str, str]]] = {}
    for reference in function.automations:
        entity_id = resolve_entity(hass, reference)
        if entity_id is None:
            continue
        targets = {
            f"entity:{entity_reference(hass, target)}": "entity_reference"
            for target in automation.entities_in_automation(hass, entity_id)
        }
        for field, lookup in (
            ("device", automation.devices_in_automation),
            ("area", automation.areas_in_automation),
            ("floor", automation.floors_in_automation),
            ("label", automation.labels_in_automation),
        ):
            identities = set(lookup(hass, entity_id))
            targets.update(
                {
                    node_id: f"{field}_target"
                    for node_id, source in candidates.items()
                    if source.kind == "entity"
                    and identities.intersection(source.attributes.get(field, ()))
                }
            )
        for node_id, reason in targets.items():
            current_id = resolve_entity(hass, node_id[7:])
            registered = (
                er.async_get(hass).async_get(current_id) if current_id else None
            )
            if registered is not None and registered.platform == DOMAIN:
                continue
            provenance.setdefault(node_id, []).append(
                {"automation": reference, "reason": reason}
            )
    reviewed = set(function.accept) | set(function.reject)
    return [
        {
            "node_id": node_id,
            "decision": "accepted"
            if node_id in function.accept
            else "rejected"
            if node_id in function.reject
            else "required"
            if node_id in function.requirements
            else "suggested",
            "active": node_id in function.requirements,
            "currently_suggested": node_id in provenance,
            "provenance": provenance.get(node_id, []),
        }
        for node_id in sorted(provenance.keys() | reviewed)
    ]


def requirement(
    hass: HomeAssistant,
    settings: Settings,
    function: Function,
    source: Source,
    engine: Engine,
) -> dict[str, Any]:
    """Explain monitoring and consequences separately from the library answer."""
    if source.kind == "entity":
        present = (
            source.entity_id is not None
            and hass.states.get(source.entity_id) is not None
        )
    elif source.kind == "integration":
        present = (
            source.entry_id is not None
            and hass.config_entries.async_get_entry(source.entry_id) is not None
        )
    elif source.kind == "function":
        present = any(
            source.node_id == f"function:{item.id}" for item in settings.functions
        )
    else:
        present = any(
            source.node_id == f"external:{item.id}"
            for item in settings.external_capabilities
        )
    impact = engine.impact(source.node_id)
    return {
        "node_id": source.node_id,
        "name": source.name,
        "present": present,
        "provenance": "owner_confirmed_candidate"
        if source.node_id in function.accept
        else "owner_declared",
        "monitoring": "excluded"
        if source.excluded_by
        else "watched"
        if source.watched
        else "composite"
        if source.requirements
        else "unwatched",
        "attached_by": list(source.attached_by),
        "excluded_by": list(source.excluded_by),
        "readiness": json_object(engine.readiness([source.node_id])),
        "explanation": json_object(engine.explain(source.node_id)),
        "effective_importance": impact.importance.value,
        "affected_functions": [
            node.node_id
            for node in impact.nodes
            if node.node_id.startswith("function:")
        ],
    }


def describe(
    hass: HomeAssistant,
    settings: Settings,
    sources: dict[str, Source],
    candidates: dict[str, Source],
    engine: Engine,
) -> list[dict[str, Any]]:
    """Explain each function, its current requirements and unreviewed candidates."""
    return [
        {
            "node_id": f"function:{function.id}",
            "name": function.name,
            "importance": function.importance.value,
            "readiness": json_object(engine.readiness([f"function:{function.id}"])),
            "requirements": [
                requirement(hass, settings, function, sources[node_id], engine)
                for node_id in function.requirements
            ],
            "candidates": suggestions(hass, function, candidates),
            "automation_sources": [
                {
                    "reference": reference,
                    "present": (entity_id := resolve_entity(hass, reference))
                    is not None
                    and hass.states.get(entity_id) is not None,
                }
                for reference in function.automations
            ],
            "candidate_discovery_complete": False,
        }
        for function in settings.functions
    ]


def preview(
    hass: HomeAssistant,
    settings: Settings,
    known: dict[str, Attributes],
    previous: tuple[Function, ...] = (),
) -> dict[str, Any]:
    """Evaluate current evidence in an isolated model, without history or delivery."""
    before = {
        (f"function:{function.id}", target)
        for function in previous
        for target in function.requirements
    }
    after = {
        (f"function:{function.id}", target)
        for function in settings.functions
        for target in function.requirements
    }
    result: dict[str, Any] = {
        "preview_kind": "current_evidence_without_history",
        "functions": [],
        "edges_added": [
            {"from": source, "to": target} for source, target in sorted(after - before)
        ],
        "edges_removed": [
            {"from": source, "to": target} for source, target in sorted(before - after)
        ],
    }
    if not settings.functions:
        return result
    candidates = evaluate(
        inventory(hass, settings, known), parse_rules(rule_data(hass, settings))
    )
    sources, _ = compose(hass, settings, candidates)
    engine = Engine(settings.engine_settings())
    now = dt_util.utcnow()
    engine.register_many([source.node(settings) for source in sources.values()], now)
    observations = []
    for source in sources.values():
        if not source.watched:
            continue
        if source.kind in {"entity", "situation"}:
            state = hass.states.get(source.entity_id) if source.entity_id else None
            observations.append(entity_observation(source, state, now))
        elif source.kind == "integration":
            assert source.entry_id is not None
            entry = hass.config_entries.async_get_entry(source.entry_id)
            reauth = any(
                flow["context"].get("source") == "reauth"
                and flow["context"].get("entry_id") == source.entry_id
                for flow in hass.config_entries.flow.async_progress()
            )
            observations.append(
                entry_observation(source, entry, now, None, settings, reauth)
            )
    if observations:
        engine.ingest_many(observations, now)
    result["functions"] = describe(hass, settings, sources, candidates, engine)
    return result
