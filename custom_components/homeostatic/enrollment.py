"""Passive HA inventory and rule enrollment, independent of engine decisions."""

from dataclasses import replace
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, EntityCategory
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
            ("entry:", "entity:registry:", "entity:entity_id:", "device:")
        ):
            raise ValueError("Invalid enrolled identity")
        result[node_id] = attributes(metadata)
    return result


def device_members(hass: HomeAssistant) -> dict[str, tuple[str, ...]]:
    """Select candidate evidence without assuming it must always be available."""
    ordinary: dict[str, list[str]] = {}
    diagnostic: dict[str, list[str]] = {}
    devices = dr.async_get(hass)
    for entry in er.async_get(hass).entities.values():
        if (
            entry.device_id is None
            or entry.platform == DOMAIN
            or entry.disabled_by is not None
            or (device := devices.async_get(entry.device_id)) is None
            or device.disabled_by is not None
        ):
            continue
        if entry.entity_category is None:
            ordinary.setdefault(entry.device_id, []).append(entry.entity_id)
        elif entry.entity_category is EntityCategory.DIAGNOSTIC:
            diagnostic.setdefault(entry.device_id, []).append(entry.entity_id)
    return {
        device_id: tuple(sorted(ordinary.get(device_id) or diagnostic[device_id]))
        for device_id in ordinary.keys() | diagnostic.keys()
    }


def inventory(
    hass: HomeAssistant, settings: Settings, known: dict[str, Attributes]
) -> dict[str, Source]:
    """Read current registries, retaining explicit requirements and state-only ids."""
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
    references.update(
        node_id[7:] for node_id in known if node_id.startswith("entity:entity_id:")
    )
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
        owner_entry = (
            hass.config_entries.async_get_entry(owner_id) if owner_id else None
        )
        if (
            owner_id is not None
            and owner_entry is not None
            and owner_entry.domain != "switch_as_x"
        ):
            entry_ids.add(owner_id)
            metadata["integration_domain"] = (owner_entry.domain,)
        else:
            if owner_entry is not None and owner_entry.domain == "switch_as_x":
                metadata.pop("integration", None)
                metadata.pop("integration_domain", None)
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
    members = device_members(hass)
    device_ids = set(members)
    device_ids.update(
        device_id
        for rule in rules
        if rule.enabled
        and rule.action == "attach"
        and "device" in rule.match.get("kind", ())
        for device_id in rule.match.get("device", ())
    )
    for device_id in sorted(device_ids):
        device = devices.async_get(device_id)
        node_id = f"device:{device_id}"
        area = (
            areas.async_get_area(device.area_id) if device and device.area_id else None
        )
        owner_ids = {
            registered.config_entry_id
            for entity_id in members.get(device_id, ())
            if (registered := registry.async_get(entity_id)) is not None
            and registered.config_entry_id is not None
        }
        if not owner_ids and device is not None:
            # Loss of selected evidence must not silently unmatch an owner rule.
            owner_ids = set(device.config_entries)
        device_raw: Attributes = {
            "kind": ("device",),
            "device": (device_id,),
            "integration": tuple(sorted(owner_ids)),
            "integration_domain": tuple(
                sorted(
                    {
                        entry.domain
                        for owner_id in owner_ids
                        if (entry := hass.config_entries.async_get_entry(owner_id))
                        is not None
                        and entry.domain not in {DOMAIN, "switch_as_x"}
                    }
                )
            ),
            "area": (device.area_id,) if device and device.area_id else (),
            "floor": (area.floor_id,) if area and area.floor_id else (),
            "label": tuple(
                sorted(
                    (device.labels if device else set())
                    | (area.labels if area else set())
                )
            ),
        }
        metadata = {key: value for key, value in device_raw.items() if value}
        if device is None:
            metadata = known.get(node_id, metadata)
        sources[node_id] = Source(
            node_id=node_id,
            kind="device",
            availability_entities=members.get(device_id, ()),
            name=(device.name_by_user or device.name or device_id)
            if device
            else device_id,
            disabled=device is not None and device.disabled_by is not None,
            attributes=metadata,
        )
    for entry_id in sorted(entry_ids):
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is not None and entry.domain == "switch_as_x":
            continue
        if entry is not None and entry.domain == DOMAIN:
            if entry_id in settings.config_entries:
                raise ValueError("Homeostatic cannot monitor itself")
            continue
        node_id = f"entry:{entry_id}"
        metadata = {"kind": ("integration",), "integration": (entry_id,)}
        if entry is not None:
            metadata["domain"] = (entry.domain,)
            metadata["integration_domain"] = (entry.domain,)
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
            watched=decision.watched
            and not (source.kind == "device" and source.disabled),
            attached_by=decision.attached_by,
            excluded_by=decision.excluded_by,
        )
    ignored = {
        source.entity_id: source
        for source in result.values()
        if source.kind == "entity" and source.excluded_by and source.entity_id
    }
    for node_id, source in tuple(result.items()):
        if source.kind != "device":
            continue
        excluded = [
            ignored[entity_id]
            for entity_id in source.availability_entities
            if entity_id in ignored
        ]
        selected = tuple(
            entity_id
            for entity_id in source.availability_entities
            if entity_id not in ignored
        )
        empty_by_choice = bool(excluded) and not selected
        result[node_id] = replace(
            source,
            availability_entities=selected,
            ignored_availability=tuple(sorted(member.node_id for member in excluded)),
            watched=source.watched and not empty_by_choice,
            excluded_by=tuple(
                sorted(
                    set(source.excluded_by)
                    | {rule_id for member in excluded for rule_id in member.excluded_by}
                )
            )
            if empty_by_choice
            else source.excluded_by,
        )
    return result


def restore_device_exclusions(value: Any) -> dict[str, tuple[str, ...]]:
    """Validate adapter-owned scope history without interpreting engine state."""
    if not isinstance(value, dict) or any(
        not isinstance(key, str)
        or not key.startswith("device:")
        or not isinstance(members, list)
        or any(not isinstance(member, str) for member in members)
        for key, members in value.items()
    ):
        raise ValueError("Invalid stored device exclusions")
    return {key: tuple(members) for key, members in value.items()}


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
