"""Device notifications retain their grouping through startup and activation."""

from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, Event, EventOrigin, HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic import phone_actions
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.notification_routes import Destination
from tests.test_device_notifications import device_sources
from tests.test_lifecycle import start_monitor
from tests.test_startup_quiet import fresh_start, slow_integration


async def test_enabling_existing_device_failures_sends_one_acknowledgeable_message(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_read_only_user: User,
    monkeypatch: pytest.MonkeyPatch,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Activation combines device and entity issues and binds the shown occurrences."""
    device, temperature, switch = device_sources(hass, config_data)
    config_data["notifications"] = False
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
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    shown = set(runtime.episodes)
    assert len(shown) == 3
    assert not events
    assert not runtime.delivery.outbox
    send.assert_not_called()

    hass.config_entries.async_update_entry(
        entry, options={**config_data, "notifications": True}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(events) == 1
    [payload] = [event.data for event in events]
    assert payload["notification_subject"] == f"device:{device.id}"
    assert payload["action"] == "activate"
    assert set(payload["episodes"]) == shown
    assert not payload["silent"]
    assert {row["tag"] for row in runtime.delivery.messages.values()} == {
        payload["tag"]
    }
    assert send.await_count == 1
    token = send.call_args.kwargs["acknowledgment"]
    assert token is not None
    assert set(runtime.phone_actions.records[token]["episodes"]) == shown
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert runtime.policy is not None
    assert all(runtime.policy.acknowledgment(episode) is not None for episode in shown)
    hass.states.async_set(switch.entity_id, "on")
    await hass.async_block_till_done()
    hass.states.async_set(switch.entity_id, "unavailable")
    await hass.async_block_till_done()
    new_token = send.call_args.kwargs["acknowledgment"]
    assert new_token != token
    assert events[-1].data["tag"] == payload["tag"]
    assert set(runtime.phone_actions.records[new_token]["episodes"]) == set(
        runtime.episodes
    )
    new_failures = set(runtime.episodes) - shown
    assert len(new_failures) == 2
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert all(
        runtime.policy.acknowledgment(episode) is None for episode in new_failures
    )
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": new_token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert all(
        runtime.policy.acknowledgment(episode) is not None
        for episode in runtime.episodes
    )
    freezer.tick(timedelta(minutes=1))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len([event for event in events if not event.data["silent"]]) == 2
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_startup_hold_emits_one_message_per_device_without_individual_copies(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Held failures retain device identity when several devices fail together."""
    first, temperature, switch = device_sources(hass, config_data)
    owner = hass.config_entries.async_get_entry(next(iter(first.config_entries)))
    assert owner is not None
    second = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "bedroom")},
        name="Bedroom controller",
    )
    humidity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "humidity", config_entry=owner, device_id=second.id
    )
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    hass.states.async_set(humidity.entity_id, "unavailable")
    slow = slow_integration(hass, config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert runtime.startup_quiet
    assert len(runtime.episodes) == 5
    assert not events
    assert len(runtime.delivery.outbox) == 2
    slow.mock_state(hass, ConfigEntryState.LOADED)
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert len(events) == 2
    assert {event.data["notification_subject"] for event in events} == {
        f"device:{first.id}",
        f"device:{second.id}",
    }
    assert len({event.data["tag"] for event in events}) == 2
    assert all(not event.data["silent"] for event in events)
    assert sorted(len(event.data["episodes"]) for event in events) == [2, 3]
    assert {episode for event in events for episode in event.data["episodes"]} == set(
        runtime.episodes
    )
    assert {row["tag"] for row in runtime.delivery.messages.values()} == {
        event.data["tag"] for event in events
    }
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_partial_recovery_during_startup_hold_delivers_only_remaining_failure(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A held device message is replaced before publication when a sibling recovers."""
    device, temperature, switch = device_sources(hass, config_data)
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    slow = slow_integration(hass, config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert runtime.startup_quiet
    assert len(runtime.episodes) == 3
    remaining = next(
        episode
        for episode, issue in runtime.episodes.items()
        if runtime.sources[str(issue["anchor"])].entity_id == temperature.entity_id
    )
    hass.states.async_set(switch.entity_id, "on")
    await hass.async_block_till_done()
    assert runtime.startup_quiet
    assert set(runtime.episodes) == {remaining}
    assert not events
    assert len(runtime.delivery.outbox) == 1
    assert runtime.delivery.outbox[0]["episodes"] == [remaining]
    slow.mock_state(hass, ConfigEntryState.LOADED)
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["notification_subject"] == f"device:{device.id}"
    assert events[0].data["episodes"] == [remaining]
    assert events[0].data["action"] != "resolve"
    assert not events[0].data["silent"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_disabled_notifications_stay_silent_after_startup_and_partial_recovery(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Device grouping never enables delivery or erases remaining dashboard failures."""
    _, temperature, switch = device_sources(hass, config_data)
    config_data["notifications"] = False
    hass.states.async_set(temperature.entity_id, "unavailable")
    hass.states.async_set(switch.entity_id, "unavailable")
    slow = slow_integration(hass, config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert runtime.startup_quiet
    assert len(runtime.episodes) == 3
    slow.mock_state(hass, ConfigEntryState.LOADED)
    hass.states.async_set(switch.entity_id, "on")
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert len(runtime.episodes) == 1
    assert not events
    assert not runtime.delivery.outbox
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.settings.notifications
    assert len(runtime.episodes) == 1
    assert not events
    assert not runtime.delivery.outbox
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)
