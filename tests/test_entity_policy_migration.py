"""Published device-policy conversion and independent entity coverage scenarios."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.policy_migration import migrate_device_policies
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("enabled", [True, False])
async def test_device_policy_migrates_without_losing_saved_choices(
    hass: HomeAssistant, config_data: dict[str, Any], enabled: bool
) -> None:
    """Device and member exclusions, missing devices and delivery rows survive reload."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "equipment")}
    )
    registry = er.async_get(hass)
    members = [
        registry.async_get_or_create(
            "sensor", "test", name, config_entry=owner, device_id=device.id
        )
        for name in ("one", "two", "ignored")
    ]
    for member in members:
        hass.states.async_set(member.entity_id, "unavailable")
    original = {
        **monitoring_policy(
            "equipment",
            {"kind": ["device"], "device": [device.id, "missing"]},
            enabled=enabled,
            notifications=[{"id": "morning", "profile": "morning"}],
        ),
        "excluded_sources": [f"entity:registry:{members[2].id}", "device:excluded"],
    }
    data = {**config_data, "notifications": False, "monitoring_policies": [original]}
    before = deepcopy(data)
    converted = migrate_device_policies(hass, data)
    assert data == before
    assert converted["monitoring_policies"] == [
        {**original, "match": {"kind": ["entity"], "device": [device.id, "missing"]}}
    ]
    assert migrate_device_policies(hass, converted) == converted
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    assert entry.data == converted
    checks = [source for source in runtime.sources.values() if source.watched]
    assert {source.entity_id for source in checks} == (
        {member.entity_id for member in members[:2]} if enabled else set()
    )
    assert all(source.kind == "entity" for source in checks)
    assert len(runtime.episodes) == (2 if enabled else 0)
    assert not runtime.delivery.outbox
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.data == converted
    assert len(entry.runtime_data.episodes) == (2 if enabled else 0)
    hass.states.async_set(members[0].entity_id, "1")
    await hass.async_block_till_done()
    assert len(entry.runtime_data.episodes) == (1 if enabled else 0)


def test_migration_uses_device_area_instead_of_entity_override(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An entity's own area cannot drop members of a previously watched device."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    areas = ar.async_get(hass)
    kitchen, office = areas.async_create("Kitchen"), areas.async_create("Office")
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "room")}
    )
    dr.async_get(hass).async_update_device(device.id, area_id=kitchen.id)
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "member", config_entry=owner, device_id=device.id
    )
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=office.id)
    data = {
        **config_data,
        "monitoring_policies": [
            monitoring_policy("room", {"kind": ["device"], "area": [kitchen.id]})
        ],
    }
    converted = migrate_device_policies(hass, data)
    [policy] = Settings.from_data(converted).monitoring_policies
    assert policy.match == {"kind": ("entity",), "device": (device.id,)}
    assert policy.matches(
        {"kind": ("entity",), "device": (device.id,), "area": (office.id,)}
    )


def test_empty_migrated_scope_and_invalid_settings_are_not_reset(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An empty location stays empty; corruption raises before modifying saved data."""
    data = {
        **config_data,
        "monitoring_policies": [
            monitoring_policy("empty", {"kind": ["device"], "area": ["missing"]})
        ],
    }
    converted = migrate_device_policies(hass, data)
    [policy] = Settings.from_data(converted).monitoring_policies
    assert policy.match == {"kind": ("entity",), "device": ()}
    assert not policy.matches({"kind": ("entity",), "device": ("new",)})
    data["notifications"] = "invalid"
    before = deepcopy(data)
    with pytest.raises(ValueError, match="notifications must be boolean"):
        migrate_device_policies(hass, data)
    assert data == before


def test_entity_overrides_preserve_future_types_and_whole_device_exclusions() -> None:
    """One entity can override a saved scope without enabling its siblings."""
    [policy] = parse_policies(
        [
            {
                **monitoring_policy("important", {"kind": ["entity"]}),
                "match_any": [{"domain": ["lock"]}],
                "included_sources": ["entity:registry:chosen"],
                "excluded_sources": ["device:ignored", "entity:registry:blocked"],
            }
        ]
    )
    metadata = {"kind": ("entity",), "domain": ("sensor",), "device": ("ignored",)}
    assert policy.matches(metadata, source_id="entity:registry:chosen")
    assert not policy.matches(metadata, source_id="entity:registry:sibling")
    assert not policy.matches(
        {**metadata, "domain": ("lock",)}, source_id="entity:registry:blocked"
    )
    assert policy.matches(
        {"kind": ("entity",), "domain": ("lock",)}, source_id="entity:registry:future"
    )
    assert parse_policies([policy.data()]) == (policy,)


def test_new_device_availability_policy_is_rejected() -> None:
    """The retired monitoring type cannot re-enter through an API save."""
    with pytest.raises(ValueError, match="integrations or entities"):
        parse_policies([monitoring_policy("old", {"kind": ["device"]})])


def test_broad_device_conversion_does_not_add_standalone_entities(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Migration retains existing devices and future members without new source kinds."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "existing")}
    )
    data = {
        **config_data,
        "monitoring_policies": [monitoring_policy("all_devices", {"kind": ["device"]})],
    }
    converted = migrate_device_policies(hass, data)
    [policy] = Settings.from_data(converted).monitoring_policies
    assert policy.match == {"kind": ("entity",), "device": (device.id,)}
    assert policy.matches({"kind": ("entity",), "device": (device.id,)})
    assert not policy.matches({"kind": ("entity",)})
    assert not policy.matches({"kind": ("entity",), "device": ("new",)})
