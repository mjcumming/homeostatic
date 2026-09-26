"""Passive HA inventory and rule enrollment, independent of engine decisions."""

from dataclasses import replace
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .catalog import Source
from .config import Settings, resolve_entity, rule_data
from .const import DOMAIN
from .rules import Attributes, CatalogRule, attributes, decide, parse_rules
from .serialization import json_object


def restore_enrollment(value: Any) -> dict[str, Attributes]:
    """Validate persisted identities without inspecting the library snapshot."""
    if not isinstance(value, dict):
        raise ValueError("Invalid enrollment snapshot")
    result = {}
    for node_id, metadata in value.items():
        if not isinstance(node_id, str) or not node_id.startswith(
            ("entry:", "entity:registry:", "entity:entity_id:")
        ):
            raise ValueError("Invalid enrolled identity")
        result[node_id] = attributes(metadata)
    return result


def inventory(
    hass: HomeAssistant, settings: Settings, known: dict[str, Attributes]
) -> dict[str, Source]:
    """Read current registries, retaining missing requirements and enrolled ids."""
    registry, devices, areas = (
        er.async_get(hass),
        dr.async_get(hass),
        ar.async_get(hass),
    )
    rules = parse_rules(rule_data(hass, settings))
    references = set(settings.entities) | {
        reference
        for function in settings.functions
        for reference in function.entity_references
    }
    references.update(node_id[7:] for node_id in known if node_id.startswith("entity:"))
    references.update(value for rule in rules for value in rule.match.get("entity", ()))
    references.update(
        f"registry:{entry.id}"
        for entry in registry.entities.values()
        if entry.platform != DOMAIN
    )
    references.update(
        f"entity_id:{state.entity_id}"
        for state in hass.states.async_all()
        if registry.async_get(state.entity_id) is None
    )
    sources: dict[str, Source] = {}
    entry_ids = set(settings.config_entries)
    entry_ids.update(
        node_id[6:]
        for function in settings.functions
        for node_id in function.requirements
        if node_id.startswith("entry:")
    )
    entry_ids.update(
        value for rule in rules for value in rule.match.get("integration", ())
    )
    entry_ids.update(
        entry.entry_id
        for entry in hass.config_entries.async_entries(include_ignore=False)
    )
    for reference in sorted(references):
        entity_id = resolve_entity(hass, reference)
        registered = registry.async_get(entity_id) if entity_id else None
        if registered is not None and registered.platform == DOMAIN:
            if reference in settings.entities:
                raise ValueError("Homeostatic cannot monitor its own entities")
            continue
        node_id = f"entity:{reference}"
        state = hass.states.get(entity_id) if entity_id else None
        device = (
            devices.async_get(registered.device_id)
            if registered and registered.device_id
            else None
        )
        area_id = (registered.area_id if registered else None) or (
            device.area_id if device else None
        )
        area = areas.async_get_area(area_id) if area_id else None
        owner_id = registered.config_entry_id if registered else None
        device_class = (
            (registered.device_class or registered.original_device_class)
            if registered
            else None
        )
        if state is not None:
            device_class = device_class or state.attributes.get("device_class")
        if device_class is None and (
            state is None
            or state.state in {STATE_UNKNOWN, STATE_UNAVAILABLE}
            or state.attributes.get("restored")
        ):
            device_class = next(
                iter(known.get(node_id, {}).get("device_class", ())), None
            )
        labels = (
            (registered.labels if registered else set())
            | (device.labels if device else set())
            | (area.labels if area else set())
        )
        raw = {
            "kind": "entity",
            "entity": reference,
            "domain": entity_id.split(".", 1)[0] if entity_id else None,
            "device_class": device_class,
            "integration": owner_id,
            "device": registered.device_id if registered else None,
            "area": area_id,
            "floor": area.floor_id if area else None,
        }
        metadata: Attributes = {key: (value,) for key, value in raw.items() if value}
        if labels:
            metadata["label"] = tuple(sorted(labels))
        if registered is None and state is None:
            metadata = known.get(node_id, metadata)
            owner_id = next(iter(metadata.get("integration", ())), None)
        if owner_id and hass.config_entries.async_get_entry(owner_id) is not None:
            entry_ids.add(owner_id)
        else:
            owner_id = None
        sources[node_id] = Source(
            node_id=node_id,
            kind="entity",
            name=state.name if state else entity_id or node_id,
            entity_id=entity_id,
            owner_id=owner_id,
            disabled=bool(
                (registered and registered.disabled_by)
                or (device and device.disabled_by)
            ),
            attributes=metadata,
        )
    for entry_id in sorted(entry_ids):
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is not None and entry.domain == DOMAIN:
            if entry_id in settings.config_entries:
                raise ValueError("Homeostatic cannot monitor itself")
            continue
        node_id = f"entry:{entry_id}"
        metadata = {"kind": ("integration",), "integration": (entry_id,)}
        if entry is not None:
            metadata["domain"] = (entry.domain,)
        else:
            metadata = known.get(node_id, metadata)
        sources[node_id] = Source(
            node_id=node_id,
            kind="integration",
            name=entry.title if entry else entry_id,
            entry_id=entry_id,
            attributes=metadata,
        )
    return sources


def evaluate(
    sources: dict[str, Source], rules: tuple[CatalogRule, ...]
) -> dict[str, Source]:
    """Attach provenance and effective checks without mutating inventory."""
    result = {}
    for node_id, source in sources.items():
        decision = decide(rules, source.attributes)
        result[node_id] = replace(
            source,
            watched=decision.watched,
            attached_by=decision.attached_by,
            excluded_by=decision.excluded_by,
        )
    return result


def report(
    sources: dict[str, Source], rules: tuple[CatalogRule, ...]
) -> dict[str, Any]:
    """Return match counts and per-node explanations for an unsaved rule set."""
    evaluated = evaluate(sources, rules)
    return {
        "rules": [
            {
                "id": rule.id,
                "matches": sum(
                    rule.matches(source.attributes) for source in sources.values()
                ),
            }
            for rule in rules
        ],
        "watched": sum(source.watched for source in evaluated.values()),
        "candidates": [json_object(source) for source in evaluated.values()],
    }
