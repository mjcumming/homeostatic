"""Check System Monitor source metadata against the installed Home Assistant."""

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.host_health import (
    SYSTEM_MONITOR_KEYS,
    supports_source,
)


async def test_system_monitor_registers_distinct_pressure_sources(
    hass: HomeAssistant,
) -> None:
    """Use HA's own integration to identify diagnostic pressure sources."""
    entry = MockConfigEntry(domain="systemmonitor", version=1, minor_version=3)
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, "systemmonitor", {})
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    rows = er.async_entries_for_config_entry(registry, entry.entry_id)
    keys = {
        row.translation_key: row
        for row in rows
        if row.platform == "systemmonitor" and row.domain == "sensor"
    }
    for condition in ("memory", "io", "cpu"):
        key = SYSTEM_MONITOR_KEYS[condition]
        row = keys[key]
        assert row.unique_id == key
        assert row.disabled
        assert row.entity_category.value == "diagnostic"
        assert not supports_source(row, condition)
        row = registry.async_update_entity(row.entity_id, disabled_by=None)
        assert supports_source(row, condition)
