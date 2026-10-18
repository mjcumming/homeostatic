"""Causal availability scope retains saved notification requests and history."""

from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.policy_defaults import policy_templates
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_notification_collection import advance, configure


def availability_config(config: dict[str, Any]) -> None:
    """Use actual editable defaults with only the two schedules under examination."""
    configure(config, delay=5)
    config["notification_definitions"]["timezone"] = "UTC"
    config["timings"]["settle"] = 30
    config["notification_definitions"]["profiles"]["morning"]["methods"] = ["test"]
    config["monitoring_policies"] = [
        row
        for row in policy_templates()
        if row["id"]
        in {"default_integrations", "default_entities", "default_important_equipment"}
    ]
    # General equipment remains watched without adding a second Morning route.
    config["monitoring_policies"][1]["notifications"] = []


@pytest.mark.parametrize(
    "arrival", ["integration_first", "pending_absorption", "sent_absorption"]
)
async def test_integration_and_equipment_arrival_orders_keep_one_opening(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    arrival: str,
) -> None:
    """Absorption preserves one equipment opening and the independent morning report."""
    freezer.move_to("2026-10-18T01:00:00+00:00")
    availability_config(config_data)
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    lock = er.async_get(hass).async_get_or_create(
        "lock", "test", "front", config_entry=owner
    )
    hass.states.async_set(lock.entity_id, "locked")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    if arrival == "integration_first":
        owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
        await hass.async_block_till_done()
        hass.states.async_set(lock.entity_id, "unavailable")
        await hass.async_block_till_done()
        await advance(hass, freezer, 5)
    else:
        hass.states.async_set(lock.entity_id, "unavailable")
        await hass.async_block_till_done()
        original_due = runtime.delivery.collections.next_deadline()
        await advance(hass, freezer, 1 if arrival == "pending_absorption" else 5)
        owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
        await hass.async_block_till_done()
        if arrival == "pending_absorption":
            assert runtime.delivery.collections.next_deadline() == original_due
            await advance(hass, freezer, 4)
    assert len(runtime.episodes) == 1
    [shared] = runtime.episodes
    openings = [
        event
        for event in events
        if not event.data["silent"] and event.data["action"] != "resolve"
    ]
    assert len(openings) == 1
    assert openings[0].data["notification_id"] == "immediate"
    assert direct.await_count >= 1
    if arrival != "sent_absorption":
        assert openings[0].data["episodes"] == [shared]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    before = len(openings)
    await advance(hass, freezer, 60)
    assert (
        len(
            [
                event
                for event in events
                if not event.data["silent"] and event.data["action"] != "resolve"
            ]
        )
        == before
    )
    seconds_until_morning = int(
        (
            dt_util.utcnow().replace(hour=8, minute=0, second=0) - dt_util.utcnow()
        ).total_seconds()
    )
    await advance(hass, freezer, seconds_until_morning)
    reports = [event for event in events if event.data["action"] == "digest"]
    assert len(reports) == 1
    assert reports[0].data["route"] == "policy_default_integrations_default"
    assert shared in reports[0].data["episodes"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_first_important_member_after_general_outage_requests_attention_once(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """New scope enables its assignment; later members update it without new openings."""
    freezer.move_to("2026-10-18T01:00:00+00:00")
    availability_config(config_data)
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    general = registry.async_get_or_create(
        "sensor", "test", "ordinary", config_entry=owner
    )
    hass.states.async_set(general.entity_id, "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
    hass.states.async_set(general.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert not events
    first = registry.async_get_or_create("lock", "test", "first", config_entry=owner)
    hass.states.async_set(first.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.delivery.collections.next_deadline() == dt_util.utcnow() + timedelta(
        seconds=5
    )
    await advance(hass, freezer, 5)
    assert len([event for event in events if not event.data["silent"]]) == 1
    second = registry.async_get_or_create("lock", "test", "second", config_entry=owner)
    hass.states.async_set(second.entity_id, "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    assert len([event for event in events if not event.data["silent"]]) == 1
    owner._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    assert len([event for event in events if not event.data["silent"]]) == 1
    hass.states.async_set(first.entity_id, "locked")
    await hass.async_block_till_done()
    assert any(
        second.entity_id in str(runtime.sources[str(episode["anchor"])].entity_id)
        for episode in runtime.episodes.values()
    )
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_availability_notification_assignment_does_not_route_battery_condition(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A diagnostic battery's separate condition does not borrow availability delivery."""
    availability_config(config_data)
    config_data["monitoring_policies"].append(
        monitoring_policy("batteries", {"kind": ["battery"]}, check="battery")
    )
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    battery = er.async_get(hass).async_get_or_create(
        "sensor", "test", "battery", config_entry=owner, original_device_class="battery"
    )
    hass.states.async_set(battery.entity_id, "5", {"unit_of_measurement": "%"})
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    assert (
        runtime.sources[str(next(iter(runtime.episodes.values()))["anchor"])].check_id
        == "battery"
    )
    await advance(hass, freezer, 65)
    assert not events
    assert await hass.config_entries.async_unload(entry.entry_id)
