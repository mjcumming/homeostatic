"""Restart scenarios: nothing is sent while Home Assistant finishes starting."""

from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.runtime import Runtime
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


async def fresh_start(hass: HomeAssistant, entry: MockConfigEntry) -> Runtime:
    """Set up the entry during HA startup, then finish starting HA."""
    hass.set_state(CoreState.not_running)
    if entry.entry_id not in {
        item.entry_id for item in hass.config_entries.async_entries()
    }:
        entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


def slow_integration(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> MockConfigEntry:
    """A watched integration that is still loading when HA reports started."""
    slow = MockConfigEntry(domain="slow_radio", title="Slow radio")
    slow.add_to_hass(hass)
    slow.mock_state(hass, ConfigEntryState.SETUP_IN_PROGRESS)
    config_data["monitoring_policies"].append(
        monitoring_policy(
            "slow", {"kind": ["integration"], "integration": [slow.entry_id]}
        )
    )
    return slow


def alerting(events: list[Any]) -> list[dict[str, Any]]:
    """Requests that would make a phone sound."""
    return [event.data for event in events if not event.data["silent"]]


async def test_slow_integration_holds_then_releases_each_standalone_subject(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Held standalone findings keep their subject, members and saved request ID."""
    slow = slow_integration(hass, config_data)
    config_data["monitoring_policies"][0]["match"]["entity"].append(
        "entity_id:sensor.second"
    )
    hass.states.async_set("sensor.observed", "unavailable")
    hass.states.async_set("sensor.second", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert len(runtime.episodes) == 2
    assert runtime.startup_quiet
    assert not events
    assert len(runtime.notifications.delivery.outbox) == 2
    expected = {
        f"entity:entity_id:{runtime.sources[str(episode['anchor'])].entity_id}": [
            identity
        ]
        for identity, episode in runtime.episodes.items()
    }
    held = {
        item["notification_subject"]: (item["delivery_id"], item["tag"])
        for item in runtime.notifications.delivery.outbox
    }
    assert {
        item["notification_subject"]: item["episodes"]
        for item in runtime.notifications.delivery.outbox
    } == expected

    slow.mock_state(hass, ConfigEntryState.LOADED)
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    loud = alerting(events)
    assert [item["action"] for item in loud] == ["open", "open"]
    assert len(events) == 2
    assert {item["notification_subject"]: item["episodes"] for item in loud} == expected
    assert {
        item["notification_subject"]: (item["delivery_id"], item["tag"])
        for item in loud
    } == held
    assert not runtime.notifications.delivery.outbox
    await runtime.async_refresh()
    await hass.async_block_till_done()
    assert len(events) == 2
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_hold_ends_at_the_cap(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """An integration that never finishes loading cannot hold alerts forever."""
    slow_integration(hass, config_data)
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    [episode] = runtime.episodes
    [held] = runtime.notifications.delivery.outbox
    freezer.tick(timedelta(seconds=599))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.startup_quiet
    assert not events
    freezer.tick(timedelta(seconds=2))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert len(events) == 1
    [released] = alerting(events)
    assert released["action"] == "open"
    assert released["notification_subject"] == "entity:entity_id:sensor.observed"
    assert released["episodes"] == [episode]
    assert released["delivery_id"] == held["delivery_id"]
    assert released["tag"] == held["tag"]
    assert not runtime.notifications.delivery.outbox
    await runtime.async_refresh()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_setup_retry_does_not_hold(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An integration stuck retrying counts as finished loading."""
    slow = slow_integration(hass, config_data)
    slow.mock_state(hass, ConfigEntryState.SETUP_RETRY)
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert not runtime.startup_quiet
    episode = next(
        identity
        for identity, problem in runtime.episodes.items()
        if runtime.sources[str(problem["anchor"])].entity_id == "sensor.observed"
    )
    assert len(events) == 1
    [released] = alerting(events)
    assert released["action"] == "open"
    assert released["notification_subject"] == "entity:entity_id:sensor.observed"
    assert released["episodes"] == [episode]
    assert not runtime.notifications.delivery.outbox
    await runtime.async_refresh()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_minimum_hold_is_the_startup_grace(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """With everything loaded, the hold still lasts the startup grace."""
    config_data["timings"]["startup_grace"] = 60
    config_data["timings"]["unknown_hold"] = 300
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "42")
    runtime = await fresh_start(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=59))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.startup_quiet
    assert not events
    freezer.tick(timedelta(seconds=2))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_restart_sends_one_due_reminder_for_the_existing_subject(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A known problem is not re-announced; an overdue reminder is sent once."""
    config_data["monitoring_policies"][0]["notifications"] = [
        {
            "id": "repeat",
            "timing": {"mode": "acknowledge", "remind_every": "1h"},
            "methods": ["test"],
        }
    ]
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.startup_quiet  # already running: no hold
    assert [item["action"] for item in alerting(events)] == ["open"]
    original = alerting(events)[0]
    [episode] = runtime.episodes
    assert original["notification_subject"] == "entity:entity_id:sensor.observed"
    assert original["episodes"] == [episode]
    assert await hass.config_entries.async_unload(entry.entry_id)

    freezer.tick(timedelta(minutes=90))  # HA was down past the hourly reminder
    events.clear()
    restarted = await fresh_start(hass, entry)
    assert not restarted.startup_quiet  # nothing watched was still loading
    loud = alerting(events)
    assert [item["action"] for item in loud] == ["remind"]
    assert list(restarted.episodes) == [episode]
    assert loud[0]["episodes"] == [episode]
    assert loud[0]["notification_subject"] == original["notification_subject"]
    assert loud[0]["tag"] == original["tag"]
    assert loud[0]["delivery_id"] != original["delivery_id"]
    assert not restarted.notifications.delivery.outbox
    freezer.tick(timedelta(minutes=20))  # before the next hourly reminder
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(alerting(events)) == 1  # no burst of catch-up reminders
    assert [item["delivery_id"] for item in alerting(events)] == [
        loud[0]["delivery_id"]
    ]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_restart_with_nothing_new_sends_nothing(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A restart alone never produces a message."""
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    events.clear()
    freezer.tick(timedelta(minutes=5))
    runtime = await fresh_start(hass, entry)
    freezer.tick(timedelta(minutes=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert not alerting(events)
    assert await hass.config_entries.async_unload(entry.entry_id)
