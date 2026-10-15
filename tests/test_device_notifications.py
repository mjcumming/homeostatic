"""Device delivery scenarios preserve independent failures and partial recovery."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.policy_helpers import immediate_notification, monitoring_policy
from tests.test_lifecycle import start_monitor


def device_sources(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> tuple[dr.DeviceEntry, er.RegistryEntry, er.RegistryEntry]:
    """Create two operational capabilities and independent availability policies."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "hall")},
        name="Hall controller",
    )
    registry = er.async_get(hass)
    temperature = registry.async_get_or_create(
        "sensor",
        "test",
        "temperature",
        config_entry=owner,
        device_id=device.id,
        original_name="Hall temperature",
    )
    switch = registry.async_get_or_create(
        "switch",
        "test",
        "relay",
        config_entry=owner,
        device_id=device.id,
        original_name="Hall relay",
    )
    hass.states.async_set(temperature.entity_id, "21")
    hass.states.async_set(switch.entity_id, "off")
    config_data["monitoring_policies"] = [
        monitoring_policy(
            "devices", {"kind": ["device"]}, notifications=immediate_notification()
        ),
        monitoring_policy(
            "entities", {"kind": ["entity"]}, notifications=immediate_notification()
        ),
    ]
    return device, temperature, switch


async def test_outage_partial_recovery_absence_and_reload_keep_one_device_message(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A returning sibling never withdraws the remaining failed capability."""
    device, temperature, switch = device_sources(hass, config_data)
    config_data["timings"]["clear_hold"] = 5
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 3
    assert len(events) == 1
    first = events[0].data
    assert first["notification_subject"] == f"device:{device.id}"
    assert first["title"] == "Hall controller"
    assert len(first["episodes"]) == 3
    assert not first["silent"]
    tag = first["tag"]
    remaining_id = next(
        identity
        for identity, episode in runtime.episodes.items()
        if runtime.sources[str(episode["anchor"])].entity_id == temperature.entity_id
    )

    events.clear()
    hass.states.async_set(switch.entity_id, "on")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=6))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert set(runtime.episodes) == {remaining_id}
    assert events[-1].data["episodes"] == [remaining_id]
    assert events[-1].data["tag"] == tag
    assert all(
        event.data["silent"] and event.data["action"] != "resolve" for event in events
    )

    events.clear()
    hass.states.async_remove(temperature.entity_id)
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert remaining_id in runtime.episodes
    assert all(event.data["action"] != "resolve" for event in events)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert remaining_id in runtime.episodes
    assert {message["tag"] for message in runtime.delivery.messages.values()} == {tag}

    events.clear()
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=6))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert events[-1].data["action"] == "resolve"
    assert events[-1].data["tag"] == tag
    assert events[-1].data["episodes"] == []
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_distinct_delivery_instructions_do_not_combine(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A reminder request remains independent of an immediate-only request."""
    _, temperature, switch = device_sources(hass, config_data)
    config_data["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "acknowledge",
        "remind_every": "1h",
    }
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 3
    assert len(events) == 2
    assert len({event.data["tag"] for event in events}) == 2
    assert sorted(len(event.data["episodes"]) for event in events) == [1, 2]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_compatible_route_removal_keeps_other_device_findings(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Removing one contributor updates shared delivery without clearing siblings."""
    _, temperature, switch = device_sources(hass, config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    tag = events[-1].data["tag"]
    events.clear()
    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["notifications"] = []
    hass.config_entries.async_update_entry(entry, options=changed)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 3
    assert len(runtime.delivery.messages) == 2
    assert {message["tag"] for message in runtime.delivery.messages.values()} == {tag}
    assert all(event.data["action"] != "resolve" for event in events)
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_new_battery_problem_joins_acknowledged_availability_message(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Different problems share delivery, and a new problem requires attention."""
    device, temperature, _ = device_sources(hass, config_data)
    owner = hass.config_entries.async_get_entry(next(iter(device.config_entries)))
    assert owner is not None
    battery = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "battery",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    hass.states.async_set(battery.entity_id, "90", {"unit_of_measurement": "%"})
    config_data["monitoring_policies"].append(
        monitoring_policy(
            "batteries",
            {"kind": ["battery"]},
            check="battery",
            notifications=immediate_notification(),
        )
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    first = events[-1].data
    [old_id] = first["episodes"]
    await runtime.async_control("acknowledge", {"episode_id": old_id}, None)
    await hass.async_block_till_done()
    events.clear()
    hass.states.async_set(battery.entity_id, "10", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    assert {
        runtime.sources[str(item["anchor"])].check_id
        for item in runtime.episodes.values()
    } == {"availability", "battery"}
    assert len(events) == 1
    assert events[0].data["tag"] == first["tag"]
    assert not events[0].data["silent"]
    assert set(events[0].data["episodes"]) == set(runtime.episodes)
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(old_id) is not None
    new_id = next(identity for identity in runtime.episodes if identity != old_id)
    assert runtime.policy.acknowledgment(new_id) is None
    events.clear()
    hass.states.async_set(battery.entity_id, "80", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert events[-1].data["episodes"] == [old_id]
    assert events[-1].data["silent"]
    assert events[-1].data["action"] == "update"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_presence_change_keeps_new_findings_away_from_previous_destination(
    hass: HomeAssistant, config_data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Silent recovery never adds a later failure to a former audience's message."""
    _, temperature, switch = device_sources(hass, config_data)
    config_data["notification_definitions"]["methods"]["test"] = {
        "name": "Household",
        "mode": "home_away",
        "people": ["person.owner"],
        "home": ["notify:home"],
        "away": ["notify:away"],
        "fallback": ["notify:fallback"],
        "skip": False,
    }
    monkeypatch.setattr(runtime_module, "async_send", AsyncMock())
    hass.states.async_set("person.owner", "home")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert events[-1].data["channels"] == ["notify:home"]
    home_tag = events[-1].data["tag"]
    hass.states.async_set("person.owner", "not_home")
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert events[-1].data["channels"] == ["notify:away"]
    away_tag = events[-1].data["tag"]
    assert away_tag != home_tag
    events.clear()
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    home_updates = [
        event.data for event in events if "notify:home" in event.data["channels"]
    ]
    away_updates = [
        event.data for event in events if "notify:away" in event.data["channels"]
    ]
    assert len(home_updates) == 1
    assert home_updates[0]["action"] == "resolve"
    assert home_updates[0]["episodes"] == []
    assert home_updates[0]["tag"] == home_tag
    assert away_updates[-1]["action"] == "update"
    assert len(away_updates[-1]["episodes"]) == 1
    assert away_updates[-1]["tag"] == away_tag
    assert await hass.config_entries.async_unload(entry.entry_id)
