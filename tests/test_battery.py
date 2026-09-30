"""Battery maintenance scenarios over real HA registries and runtime events."""

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.battery import observe
from custom_components.homeostatic.config import Settings, data_from_input, rule_data
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import evaluate, inventory
from custom_components.homeostatic.rules import DEFAULT_RULES, parse_rules
from tests.test_lifecycle import start_monitor


def battery_rules() -> list[dict[str, Any]]:
    """Select discovered battery conditions independently of availability."""
    return [
        *DEFAULT_RULES,
        {
            "id": "battery_maintenance",
            "action": "attach",
            "match": {"kind": "battery"},
            "checks": ["battery"],
        },
    ]


async def test_battery_rule_round_trip(hass: HomeAssistant) -> None:
    """A reviewed battery selection preserves its check across saved options."""
    saved = data_from_input(hass, {"rules": battery_rules()})
    assert rule_data(hass, Settings.from_data(saved))[1]["checks"] == ["battery"]


async def battery_device(hass: HomeAssistant) -> tuple[str, str, str, str]:
    """Create one registry device with percentage, low, and charging signals."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "battery_device")}
    )
    registry = er.async_get(hass)
    level = registry.async_get_or_create(
        "sensor",
        "test",
        "battery_level",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
    )
    warning = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "battery_low",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
    )
    charging = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "battery_charging",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery_charging",
    )
    return level.entity_id, warning.entity_id, charging.entity_id, level.id


@pytest.mark.parametrize(
    ("percent", "warning", "charging", "expected"),
    [
        pytest.param("20", "off", "off", "battery_low", id="threshold"),
        pytest.param("20.1", "off", "off", "battery_ok", id="above-threshold"),
        pytest.param("85", "on", "off", "battery_low", id="explicit-warning"),
        pytest.param("20", "on", "on", "charging", id="charging-overrides-both"),
        pytest.param("unknown", "off", "off", "battery_evidence_missing", id="unknown"),
        pytest.param("20", "off", "unknown", "battery_low", id="low-without-charge"),
    ],
)
async def test_battery_signal_scenarios(
    hass: HomeAssistant,
    percent: str,
    warning: str,
    charging: str,
    expected: str,
) -> None:
    """Twenty percent is low and confirmed charging clears the low condition."""
    level_id, warning_id, charging_id, registry_id = await battery_device(hass)
    hass.states.async_set(level_id, percent, {"unit_of_measurement": "%"})
    hass.states.async_set(warning_id, warning)
    hass.states.async_set(charging_id, charging)
    settings = Settings.from_data({"rules": DEFAULT_RULES})
    discovered = inventory(hass, settings, {})
    battery = discovered[f"battery:registry:{registry_id}"]
    assert battery.battery_level_entity == level_id
    assert battery.battery_warning_entity == warning_id
    assert battery.battery_charging_entity == charging_id
    assert not evaluate(discovered, parse_rules(DEFAULT_RULES))[battery.node_id].watched
    observation = observe(hass, battery, dt_util.utcnow())
    assert observation.reason == expected
    assert observation.evidence["physical_freshness_verified"] is False


async def test_battery_episode_clears_on_charging_and_reopens(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A charging report clears an episode; persistent low evidence can reopen it."""
    level_id, warning_id, charging_id, registry_id = await battery_device(hass)
    hass.states.async_set(level_id, "20", {"unit_of_measurement": "%"})
    hass.states.async_set(warning_id, "on")
    hass.states.async_set(charging_id, "off")
    config_data.update(entities=[], notifications=False, rules=battery_rules())
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    battery_id = f"battery:registry:{registry_id}"
    assert runtime.sources[battery_id].watched
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {battery_id}
    hass.states.async_set(charging_id, "on")
    await hass.async_block_till_done()
    assert not runtime.episodes
    hass.states.async_set(charging_id, "off")
    await hass.async_block_till_done()
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {battery_id}
    hass.states.async_set(level_id, "unavailable", {"unit_of_measurement": "%"})
    hass.states.async_set(warning_id, "unknown")
    await hass.async_block_till_done()
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {battery_id}
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {battery_id}
    hass.states.async_set(level_id, "21", {"unit_of_measurement": "%"})
    hass.states.async_set(warning_id, "off")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_multiple_battery_signals_stay_separate(
    hass: HomeAssistant,
) -> None:
    """Ambiguous batteries on one HA device do not share charging evidence."""
    level_id, warning_id, charging_id, _ = await battery_device(hass)
    registry = er.async_get(hass)
    level = registry.async_get(level_id)
    assert level is not None
    second = registry.async_get_or_create(
        "sensor",
        "test",
        "second_battery",
        device_id=level.device_id,
        original_device_class="battery",
    )
    hass.states.async_set(level_id, "20", {"unit_of_measurement": "%"})
    hass.states.async_set(second.entity_id, "90", {"unit_of_measurement": "%"})
    hass.states.async_set(warning_id, "off")
    hass.states.async_set(charging_id, "on")
    discovered = inventory(hass, Settings.from_data({"rules": DEFAULT_RULES}), {})
    batteries = [source for source in discovered.values() if source.kind == "battery"]
    assert len(batteries) == 3
    assert {source.battery_level_entity for source in batteries} == {
        level_id,
        second.entity_id,
        None,
    }
    assert all(source.battery_charging_entity is None for source in batteries)
