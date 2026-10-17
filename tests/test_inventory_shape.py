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
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import (
    device_members,
    evaluate,
    inventory,
)
from custom_components.homeostatic.monitoring_runtime import enrollment_rules
from tests.policy_helpers import current_config, monitoring_policy
from tests.registry_helpers import forbid_deprecated_device_properties


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
    settings = Settings.from_data(
        current_config(
            [
                monitoring_policy("controllers", {"kind": ["integration"]}),
                monitoring_policy("selected", {"entity": references}),
            ]
        )
    )
    sources = inventory(hass, settings, {})
    evaluated = evaluate(sources, enrollment_rules(settings.monitoring_policies))
    watched = [source for source in evaluated.values() if source.watched]
    assert len(devices.devices) == 695
    assert len(registry.entities) == 6651
    assert sum(entity.device_id is None for entity in candidates) == 1184
    assert sum(source.disabled for source in sources.values()) == 1192
    device_sources = [source for source in sources.values() if source.kind == "device"]
    assert {source.node_id for source in device_sources} == {
        f"device:{device.id}" for device in devices.devices
    }
    assert sum(bool(source.availability_entities) for source in device_sources) == 195
    assert all(
        registry.async_get(entity_id).entity_category is None
        for source in device_sources
        for entity_id in source.availability_entities
    )
    assert sum(source.kind == "vacuum" for source in sources.values()) == 4
    assert len(sources) == 7361
    assert len(watched) == 13
    assert {source.node_id for source in watched if source.kind == "entity"} == {
        f"entity:{reference}" for reference in references
    }
    assert len(evaluated) == len(sources)


def test_device_ownership_uses_the_single_owning_entry(hass: HomeAssistant) -> None:
    """Discovery reads each device's owning entry without the deprecated set."""
    owner = MockConfigEntry(domain="test", title="Controller")
    helper = MockConfigEntry(domain="switch_as_x", title="Converted switch")
    own = MockConfigEntry(domain=DOMAIN, title="Homeostatic")
    for entry in (owner, helper, own):
        entry.add_to_hass(hass)
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    sensor_device = devices.async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "sensor")}, name="Sensor"
    )
    reading = registry.async_get_or_create(
        "sensor", "test", "reading", config_entry=owner, device_id=sensor_device.id
    )
    quiet_device = devices.async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "quiet")}, name="Quiet"
    )
    registry.async_get_or_create(
        "sensor",
        "test",
        "diagnostic",
        config_entry=owner,
        device_id=quiet_device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    helper_device = devices.async_get_or_create(
        config_entry_id=helper.entry_id, identifiers={("switch_as_x", "fan")}
    )
    own_device = devices.async_get_or_create(
        config_entry_id=own.entry_id, identifiers={(DOMAIN, "self")}
    )
    settings = Settings.from_data(
        current_config([monitoring_policy("controllers", {"kind": ["integration"]})])
    )
    with forbid_deprecated_device_properties():
        members = device_members(hass)
        sources = inventory(hass, settings, {})
    assert members == {sensor_device.id: (reading.entity_id,)}
    assert f"device:{helper_device.id}" not in sources
    assert f"device:{own_device.id}" not in sources
    assert sources[f"device:{sensor_device.id}"].attributes["integration"] == (
        owner.entry_id,
    )
    quiet = sources[f"device:{quiet_device.id}"]
    assert quiet.availability_entities == ()
    assert quiet.attributes["integration"] == (owner.entry_id,)
    assert quiet.attributes["integration_domain"] == ("test",)
