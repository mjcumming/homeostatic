"""Saved notifications collect unrelated issues without losing their controls."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from health_tree.delivery_collections import DeliveryCollections
from homeassistant.auth.models import User
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Context, Event, EventOrigin, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import notification_routes as routes
from custom_components.homeostatic import phone_actions
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.notification_routes import Destination
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


def configure(config: dict[str, Any], *, delay: int = 60) -> None:
    """Select a saved notification for every operational entity in isolated HA."""
    config["monitoring_policies"] = [
        monitoring_policy(
            "entities",
            {"kind": ["entity"]},
            notifications=[{"id": "now", "profile": "immediate"}],
        )
    ]
    profile = config["notification_definitions"]["profiles"]["immediate"]
    profile["methods"] = ["test"]
    profile["timing"]["collection_delay_seconds"] = delay
    config["timings"]["batch"] = 30


async def advance(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, seconds: int
) -> None:
    """Advance the actual HA timer boundary without sleeping."""
    freezer.tick(timedelta(seconds=seconds))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


@pytest.mark.parametrize("destination", ["service", "notify", "phone"])
async def test_thirty_unrelated_issues_restart_fixed_deadline_and_late_arrival(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    destination: str,
) -> None:
    """Thirty independent openings produce one event and direct destination request."""
    configure(config_data)
    service = "homeostatic_test"
    channel = f"service:{service}"
    if destination == "notify":
        entity = er.async_get(hass).async_get_or_create("notify", "test", "mail")
        hass.states.async_set(entity.entity_id, "unknown")
        service, channel = "send_message", f"notify:{entity.id}"
    elif destination == "phone":
        service, channel = "mobile_app_collection", "phone:mine"
        monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: "webhook")
        monkeypatch.setattr(routes, "supports_push", lambda *_: True)
        monkeypatch.setattr(routes, "get_notify_service", lambda *_: service)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        channel
    ]
    for index in range(31):
        hass.states.async_set(f"sensor.collection_{index}", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    direct = async_mock_service(hass, "notify", service)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.collection_0", "unavailable")
    await hass.async_block_till_done()
    due = runtime.delivery.collections.next_deadline()
    assert due == dt_util.utcnow() + timedelta(seconds=60)
    await advance(hass, freezer, 30)
    for index in range(1, 30):
        hass.states.async_set(f"sensor.collection_{index}", "unavailable")
    await hass.async_block_till_done()
    assert runtime.delivery.collections.next_deadline() == due
    assert events == []
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.delivery.collections.next_deadline() == due
    await advance(hass, freezer, 29)
    assert events == []
    await advance(hass, freezer, 1)
    [first] = events
    assert len(first.data["episodes"]) == 30
    assert len(runtime.episodes) == 30
    assert first.data["notification_id"] == "immediate"
    assert first.data["title"] == "Homeostatic: 30 issues need attention"
    assert first.data["cause"] is None
    assert len(direct) == 1
    assert direct[0].data["message"] == first.data["message"]
    hass.states.async_set("sensor.collection_30", "unavailable")
    await hass.async_block_till_done()
    assert len(events) == 1
    await advance(hass, freezer, 60)
    assert len(events) == 2
    assert set(events[1].data["episodes"]).isdisjoint(first.data["episodes"])
    assert len(events[1].data["episodes"]) == 1
    assert len(direct) == 2
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_startup_release_persists_collection_deadline_before_delivery(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """Ending startup stores the fixed window immediately even without a message."""
    configure(config_data, delay=60)
    config_data["timings"]["startup_grace"] = 20
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    runtime._quiet_since = dt_util.utcnow()
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert runtime.startup_quiet
    assert runtime.delivery.collections.pending()
    assert runtime.delivery.collections.next_deadline() is None
    await advance(hass, freezer, 20)
    assert not runtime.startup_quiet
    due = dt_util.utcnow() + timedelta(seconds=60)
    assert runtime.delivery.collections.next_deadline() == due
    saved = await runtime.store.async_load()
    restored = DeliveryCollections()
    restored.restore(saved["delivery"]["delivery_collections"])
    assert restored.next_deadline() == due
    assert not events
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.delivery.collections.next_deadline() == due
    await advance(hass, freezer, 60)
    assert len(events) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_partial_recovery_while_reminder_collects_keeps_existing_members(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A pending reminder cannot corrupt the message that is already shown."""
    configure(config_data, delay=60)
    config_data["notification_definitions"]["profiles"]["immediate"]["timing"] = {
        "mode": "acknowledge",
        "remind_every": 100,
        "collection_delay_seconds": 60,
    }
    for entity in ("sensor.one", "sensor.two"):
        hass.states.async_set(entity, "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    for entity in ("sensor.one", "sensor.two"):
        hass.states.async_set(entity, "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    [opening] = events
    assert len(opening.data["episodes"]) == 2
    await advance(hass, freezer, 40)
    assert runtime.delivery.collections.pending()
    await advance(hass, freezer, 10)
    hass.states.async_set("sensor.two", "43")
    await hass.async_block_till_done()
    assert runtime.available
    assert len(events[-1].data["episodes"]) == 1
    assert events[-1].data["tag"] == opening.data["tag"]
    assert events[-1].data["silent"]
    await advance(hass, freezer, 50)
    assert runtime.available
    assert len(events[-1].data["episodes"]) == 1
    assert not events[-1].data["silent"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_observation_arriving_during_collection_save_is_retained(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A captured failure during persistence joins the same fixed collection."""
    configure(config_data, delay=60)
    for entity in ("sensor.one", "sensor.two"):
        hass.states.async_set(entity, "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    entered, release, observed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    save = runtime._save

    async def slow_save() -> None:
        entered.set()
        await release.wait()
        await save()

    @callback
    def saw_state(event: Event[Any]) -> None:
        if event.data["entity_id"] == "sensor.two":
            observed.set()

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, saw_state)
    with patch.object(runtime, "_save", side_effect=slow_save):
        hass.states.async_set("sensor.one", "unavailable")
        await entered.wait()
        hass.states.async_set("sensor.two", "unavailable")
        await observed.wait()
        release.set()
        await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    assert not events
    await advance(hass, freezer, 60)
    [message] = events
    assert set(message.data["episodes"]) == set(runtime.episodes)
    assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()


async def test_collection_outbox_replay_retains_id_and_exact_members(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Restart after authorization replays the saved collection once to its target."""
    configure(config_data, delay=5)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    runtime = await start_monitor(hass, entry)
    with patch.object(runtime, "_flush_events", new=AsyncMock()):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        await advance(hass, freezer, 5)
        [pending] = deepcopy(runtime.delivery.outbox)
        assert not events
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    [replayed] = events
    assert replayed.data["delivery_id"] == pending["delivery_id"]
    assert replayed.data["episodes"] == pending["episodes"]
    assert replayed.data["channels"] == pending["channels"]
    direct.assert_awaited_once()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert len(events) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_collected_integration_issue_has_exact_phone_acknowledgment(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    hass_read_only_user: User,
) -> None:
    """A shared integration cause supports the same explicit phone response."""
    configure(config_data, delay=5)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        "phone:mine"
    ]
    config_data["monitoring_policies"].append(
        monitoring_policy("integrations", {"kind": ["integration"]})
    )
    route = Destination(
        channel="phone:mine",
        name="Phone",
        available=True,
        user_id=hass_read_only_user.id,
    )
    monkeypatch.setattr(phone_actions, "destinations", lambda _h: [route])
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    lock = er.async_get(hass).async_get_or_create(
        "lock", "test", "front", config_entry=owner
    )
    hass.states.async_set(lock.entity_id, "locked")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
    await hass.async_block_till_done()
    hass.states.async_set(lock.entity_id, "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    [episode] = runtime.episodes
    [token] = runtime.phone_actions.records
    assert runtime.phone_actions.records[token]["episodes"] == [episode]
    assert direct.await_args.kwargs["acknowledgment"] == token
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert runtime.policy.acknowledgment(episode).actor_id == hass_read_only_user.id
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("delay", [0, 5, 60])
async def test_collection_zero_and_empty_window(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    delay: int,
) -> None:
    """Recovery before a deadline empties the window; zero has no batch wait."""
    configure(config_data, delay=delay)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert len(events) == int(delay == 0)
    hass.states.async_set("sensor.observed", "43")
    await hass.async_block_till_done()
    await advance(hass, freezer, delay + 1)
    assert not runtime.episodes
    assert len([event for event in events if not event.data["silent"]]) == int(
        delay == 0
    )
    assert runtime.delivery.collections.next_deadline() is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_saved_identity_and_resolved_destination_isolation(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """Identical named definitions remain independent and targets each receive one."""
    configure(config_data, delay=5)
    definitions = config_data["notification_definitions"]
    definitions["profiles"]["copy"] = deepcopy(definitions["profiles"]["immediate"])
    definitions["methods"]["test"]["destinations"] += ["service:second_test"]
    config_data["monitoring_policies"][0]["notifications"].append(
        {"id": "copy", "profile": "copy"}
    )
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    assert len(events) == 4
    assert {event.data["notification_id"] for event in events} == {"immediate", "copy"}
    assert {tuple(event.data["channels"]) for event in events} == {
        ("service:homeostatic_test",),
        ("service:second_test",),
    }
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("sending", [False, True])
async def test_collection_requires_sending_and_a_destination(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    sending: bool,
) -> None:
    """Off or unconfigured saved notifications never queue or request delivery."""
    configure(config_data, delay=5)
    config_data["notifications"] = sending
    if sending:
        config_data["notification_definitions"]["profiles"]["immediate"]["methods"] = []
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 10)
    assert runtime.episodes
    assert not runtime.delivery.collections.pending()
    assert not events
    direct.assert_not_awaited()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_turning_sending_off_cancels_pending_collection(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    hass_ws_client: WebSocketGenerator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Saving the global off switch cancels accepted unsent collection requests."""
    configure(config_data, delay=60)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert runtime.delivery.collections.pending()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["notifications"] = False
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/save_settings",
            "revision": configuration["revision"],
            "settings": draft,
        }
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    await advance(hass, freezer, 70)
    assert not entry.runtime_data.settings.notifications
    assert not entry.runtime_data.delivery.collections.pending()
    assert not events
    direct.assert_not_awaited()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_pending_instructions_and_presence_survive_edit_and_restart(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A saved edit cannot retarget an accepted request or restart its delay."""
    configure(config_data, delay=60)
    definitions = config_data["notification_definitions"]
    definitions["methods"]["test"] = {
        "name": "Who is home",
        "mode": "home_away",
        "people": ["person.owner"],
        "home": ["service:homeostatic_test"],
        "away": ["service:away_test"],
        "fallback": [],
        "skip": True,
    }
    hass.states.async_set("person.owner", "home")
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    due = runtime.delivery.collections.next_deadline()
    await advance(hass, freezer, 20)
    hass.states.async_set("person.owner", "not_home")
    updated = deepcopy(config_data)
    updated["notification_definitions"]["profiles"]["immediate"]["timing"][
        "collection_delay_seconds"
    ] = 120
    updated["notification_definitions"]["methods"]["test"]["away"] = [
        "service:changed_away_test"
    ]
    await runtime.async_apply_settings(Settings.from_data(updated))
    assert runtime.delivery.collections.next_deadline() == due
    assert events == []
    await advance(hass, freezer, 40)
    [message] = events
    assert message.data["channels"] == ["service:homeostatic_test"]
    await advance(hass, freezer, 120)
    assert len(events) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)
