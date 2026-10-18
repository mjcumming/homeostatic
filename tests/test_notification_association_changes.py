"""Registry association changes preserve open findings and their delivery state."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import Context, Event, EventOrigin, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic import notification_grouping, phone_actions
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.notification_routes import Destination
from tests.test_device_notifications import device_sources
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("initially_standalone", [False, True])
async def test_open_finding_moves_between_device_and_standalone_then_recovers(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    initially_standalone: bool,
) -> None:
    """A reminder moves the same finding, and recovery clears its current message."""
    device, temperature, _ = device_sources(hass, config_data)
    associations = {False: device.id, True: None}
    subjects = {
        False: f"device:{device.id}",
        True: f"entity:registry:{temperature.id}",
    }
    registry = er.async_get(hass)
    registry.async_update_entity(
        temperature.entity_id, device_id=associations[initially_standalone]
    )
    config_data["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "acknowledge",
        "remind_every": "1h",
    }
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    [episode] = runtime.episodes
    first = events[-1].data
    assert first["notification_subject"] == subjects[initially_standalone]

    events.clear()
    registry.async_update_entity(
        temperature.entity_id, device_id=associations[not initially_standalone]
    )
    await hass.async_block_till_done()
    freezer.tick(timedelta(hours=1, seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode]
    [withdrawn] = [event.data for event in events if event.data["action"] == "resolve"]
    assert withdrawn["tag"] == first["tag"]
    assert withdrawn["resolution"] == "replaced"
    assert withdrawn["message"] == "Monitoring continues in another notification."
    moved = events[-1].data
    assert moved["notification_subject"] == subjects[not initially_standalone]
    assert moved["episodes"] == [episode]
    assert moved["tag"] != first["tag"]
    assert not moved["silent"]
    assert {message["tag"] for message in runtime.delivery.messages.values()} == {
        moved["tag"]
    }

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [episode]
    events.clear()
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert len(events) == 1
    assert events[0].data["action"] == "resolve"
    assert events[0].data["tag"] == moved["tag"]
    assert events[0].data["resolution"] == "cleared"
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_detaching_finding_keeps_device_siblings_and_their_message(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Moving or recovering one finding cannot withdraw the other device findings."""
    device, temperature, switch = device_sources(hass, config_data)
    for policy in config_data["monitoring_policies"]:
        policy["notifications"][0]["timing"] = {
            "mode": "acknowledge",
            "remind_every": "1h",
        }
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    original = events[-1].data
    assert len(original["episodes"]) == 2
    moved_episode = next(
        identity
        for identity, episode in runtime.episodes.items()
        if runtime.sources[str(episode["anchor"])].entity_id == temperature.entity_id
    )
    siblings = set(runtime.episodes) - {moved_episode}
    events.clear()
    er.async_get(hass).async_update_entity(temperature.entity_id, device_id=None)
    await hass.async_block_till_done()
    freezer.tick(timedelta(hours=1, seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert set(runtime.episodes) == siblings | {moved_episode}
    assert all(event.data["action"] != "resolve" for event in events)
    by_subject = {event.data["notification_subject"]: event.data for event in events}
    remaining = by_subject[f"device:{device.id}"]
    standalone = by_subject[f"entity:registry:{temperature.id}"]
    assert remaining["tag"] == original["tag"]
    assert set(remaining["episodes"]) == siblings
    assert standalone["episodes"] == [moved_episode]
    assert standalone["episode_id"] == moved_episode
    assert standalone["title"] == "hall controller"
    assert standalone["message"] == "hall controller · temperature: unavailable"

    events.clear()
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    assert set(runtime.episodes) == siblings
    assert len(events) == 1
    assert events[0].data["action"] == "resolve"
    assert events[0].data["tag"] == standalone["tag"]
    assert {message["tag"] for message in runtime.delivery.messages.values()} == {
        original["tag"]
    }
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("initially_standalone", [False, True])
async def test_acknowledged_finding_can_recover_after_association_change(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    initially_standalone: bool,
) -> None:
    """Recovery needs no intervening reminder and never resets acknowledgment."""
    device, temperature, _ = device_sources(hass, config_data)
    associations = {False: device.id, True: None}
    registry = er.async_get(hass)
    registry.async_update_entity(
        temperature.entity_id, device_id=associations[initially_standalone]
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    [episode] = runtime.episodes
    first = events[-1].data
    await runtime.async_control("acknowledge", {"episode_id": episode}, None)
    events.clear()
    registry.async_update_entity(
        temperature.entity_id, device_id=associations[not initially_standalone]
    )
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode]
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(episode) is not None
    assert not events
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert len(events) == 1
    assert events[0].data["tag"] == first["tag"]
    assert events[0].data["resolution"] == "cleared"
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_changing_grouped_route_to_scheduled_report_retires_old_membership(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A route edit retires its old group before the scheduled report takes over."""
    freezer.move_to(datetime(2026, 10, 14, 7, tzinfo=UTC))
    _, temperature, _ = device_sources(hass, config_data)
    config_data["notification_definitions"]["timezone"] = "UTC"
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    [episode] = runtime.episodes
    original = events[-1].data
    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "report",
        "at": "08:00",
        "weekdays": list(range(7)),
    }
    events.clear()
    hass.config_entries.async_update_entry(entry, options=changed)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [episode]
    assert len(events) == 1
    assert events[0].data["tag"] == original["tag"]
    assert events[0].data["resolution"] == "notifications_disabled"
    assert not runtime.delivery.messages
    events.clear()
    freezer.tick(timedelta(hours=1, seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(events) == 1
    report = events[0].data
    assert report["action"] == "digest"
    assert report["episodes"] == [episode]
    assert report["tag"] != original["tag"]
    events.clear()
    hass.states.async_set(temperature.entity_id, "22")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert len(events) == 1
    assert events[0].data["tag"] == report["tag"]
    assert events[0].data["resolution"] == "cleared"
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_standalone_phone_action_acknowledges_the_shown_finding(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_read_only_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Standalone grouping retains the real phone button and exact occurrence."""
    _, temperature, _ = device_sources(hass, config_data)
    er.async_get(hass).async_update_entity(temperature.entity_id, device_id=None)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        "phone:mine"
    ]
    route = Destination(
        channel="phone:mine",
        name="Phone",
        user_id=hass_read_only_user.id,
        available=True,
    )
    monkeypatch.setattr(phone_actions, "destinations", lambda _: [route])
    send = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", send)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(temperature.entity_id, "unavailable")
    await hass.async_block_till_done()
    [episode] = runtime.episodes
    assert events[-1].data["episode_id"] == episode
    assert events[-1].data["episodes"] == [episode]
    send.assert_awaited_once()
    token = send.call_args.kwargs["acknowledgment"]
    assert token is not None
    assert runtime.phone_actions.records[token]["episodes"] == [episode]
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(episode) is not None
    assert list(runtime.episodes) == [episode]
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("entity", "entity:registry:source"),
        ("battery", "entity:registry:source"),
        ("vacuum", "entity:registry:source"),
        ("thermostat", "entity:registry:source"),
        ("temperature_limit", "entity:registry:source"),
        ("integration", None),
        ("repair", None),
        ("broken_automation", None),
        ("function", None),
        ("situation", None),
    ],
)
def test_standalone_subject_only_unifies_entity_derived_findings(
    kind: str, expected: str | None
) -> None:
    """Entity references do not change other source kinds' delivery contracts."""
    source = Source(
        node_id="monitoring:policy:source",
        monitoring_source="canonical:source",
        name="Source",
        kind=kind,
        attributes={"entity": ("registry:source",)},
    )
    assert notification_grouping.subject(source) == expected
