"""Bounded two-device availability pilot, entirely inside the HA test instance."""

from typing import Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


async def test_integration_outage_groups_watched_devices(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Shared entry failure absorbs devices; an isolated device stays separate."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    devices = []
    entities = []
    for index in range(2):
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("test", f"device_{index}")},
        )
        entity = er.async_get(hass).async_get_or_create(
            "sensor", "test", f"signal_{index}", config_entry=owner, device_id=device.id
        )
        devices.append(device)
        entities.append(entity)
        hass.states.async_set(entity.entity_id, "42")
    config_data.update(
        entities=[],
        notifications=False,
        rules=[
            {"id": "entry", "action": "attach", "match": {"kind": "integration"}},
            {"id": "devices", "action": "attach", "match": {"kind": "device"}},
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    for device in devices:
        assert runtime.sources[f"device:{device.id}"].requirements == (
            f"entry:{owner.entry_id}",
        )
    assert not runtime.episodes

    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "connection lost")
    for entity in entities:
        hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert next(iter(runtime.episodes.values()))["anchor"] == f"entry:{owner.entry_id}"

    owner._async_set_state(hass, ConfigEntryState.LOADED, "recovered")
    hass.states.async_set(entities[0].entity_id, "42")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert next(iter(runtime.episodes.values()))["anchor"] == f"device:{devices[1].id}"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_two_already_offline_devices_with_selected_capabilities(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Detect an existing outage without enrolling every device entity."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    primary = []
    for index, (domain, sibling_count) in enumerate(
        (("light", 11), ("binary_sensor", 14))
    ):
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("test", str(index))},
        )
        entity = registry.async_get_or_create(
            domain,
            "test",
            f"primary_{index}",
            config_entry=owner,
            device_id=device.id,
        )
        primary.append(entity)
        hass.states.async_set(entity.entity_id, "unavailable")
        for sibling in range(sibling_count):
            other = registry.async_get_or_create(
                "sensor",
                "test",
                f"other_{index}_{sibling}",
                config_entry=owner,
                device_id=device.id,
            )
            hass.states.async_set(other.entity_id, "unavailable")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[
            {"id": "controller", "action": "attach", "match": {"kind": "integration"}},
            {
                "id": "selected",
                "action": "attach",
                "match": {
                    "entity": [f"registry:{entity.id}" for entity in primary],
                },
            },
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert sum(source.watched for source in runtime.sources.values()) == 3
    assert len(runtime.episodes) == 2
    assert runtime.readiness == "degraded"
    hass.states.async_set(primary[0].entity_id, "off")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    hass.states.async_set(primary[1].entity_id, "unknown")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert not entry.runtime_data.episodes
    hass.states.async_set(primary[1].entity_id, "off")
    await hass.async_block_till_done()
    assert not entry.runtime_data.episodes
    assert entry.runtime_data.readiness == "ready"
    assert await hass.config_entries.async_unload(entry.entry_id)
