"""Bounded two-device availability pilot, entirely inside the HA test instance."""

from typing import Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


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
    assert runtime.readiness == "blocked"
    hass.states.async_set(primary[0].entity_id, "off")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    episode_id = next(iter(runtime.episodes))
    hass.states.async_set(primary[1].entity_id, "unknown")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert list(entry.runtime_data.episodes) == [episode_id]
    hass.states.async_set(primary[1].entity_id, "off")
    await hass.async_block_till_done()
    assert not entry.runtime_data.episodes
    assert entry.runtime_data.readiness == "ready"
    assert await hass.config_entries.async_unload(entry.entry_id)
