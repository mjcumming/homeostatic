"""Exercise selective enrollment against an anonymized large registry shape."""

import json
from pathlib import Path

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.enrollment import evaluate, inventory
from custom_components.homeostatic.rules import parse_rules


def test_selective_enrollment_preserves_large_inventory(hass: HomeAssistant) -> None:
    """Three selected capabilities do not enroll sibling settings or diagnostics."""
    shape = json.loads(
        (Path(__file__).parent / "fixtures/large_registry_shape.json").read_text()
    )
    owners = [
        MockConfigEntry(
            domain="test", title=f"Controller {index}", state=ConfigEntryState.LOADED
        )
        for index in range(10)
    ]
    for owner in owners:
        owner.add_to_hass(hass)
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    categories = {
        "none": None,
        "config": EntityCategory.CONFIG,
        "diagnostic": EntityCategory.DIAGNOSTIC,
    }
    disabled = {False: None, True: er.RegistryEntryDisabler.INTEGRATION}
    device_disabled = {False: None, True: dr.DeviceEntryDisabler.CONFIG_ENTRY}
    candidates = []
    device_index = 0
    entity_index = 0
    for group in shape["devices"]:
        for _ in range(group["count"]):
            owner = owners[device_index % len(owners)]
            device = devices.async_get_or_create(
                config_entry_id=owner.entry_id,
                identifiers={("test", str(device_index))},
                name=f"Device {device_index}",
                disabled_by=device_disabled[group["disabled"]],
            )
            device_index += 1
            for domain, category, is_disabled, count in group["entities"]:
                for _ in range(count):
                    entity = registry.async_get_or_create(
                        domain,
                        "test",
                        str(entity_index),
                        config_entry=owner,
                        device_id=device.id,
                        entity_category=categories[category],
                        disabled_by=disabled[is_disabled],
                    )
                    entity_index += 1
                    candidates.append(entity)
    for domain, category, is_disabled, count in shape["without_device"]:
        for _ in range(count):
            entity = registry.async_get_or_create(
                domain,
                "test",
                str(entity_index),
                config_entry=owners[0],
                entity_category=categories[category],
                disabled_by=disabled[is_disabled],
            )
            entity_index += 1
            candidates.append(entity)
    selected = [
        entity
        for entity in candidates
        if entity.device_id
        and not entity.disabled_by
        and not devices.async_get(entity.device_id).disabled_by
        and entity.entity_category is None
    ][:3]
    references = [f"registry:{entity.id}" for entity in selected]
    rules = [
        {"id": "controllers", "action": "attach", "match": {"kind": "integration"}},
        {"id": "selected", "action": "attach", "match": {"entity": references}},
    ]
    sources = inventory(hass, Settings.from_data({"rules": rules}), {})
    evaluated = evaluate(sources, parse_rules(rules))
    watched = [source for source in evaluated.values() if source.watched]
    assert len(devices.devices) == 695
    assert len(registry.entities) == 6651
    assert sum(entity.device_id is None for entity in candidates) == 1184
    assert sum(source.disabled for source in sources.values()) == 1192
    assert len(sources) == 6662
    assert len(watched) == 13
    assert {source.node_id for source in watched if source.kind == "entity"} == {
        f"entity:{reference}" for reference in references
    }
    assert len(evaluated) == len(sources)
