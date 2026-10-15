"""Reusable method delivery through the runtime's durable request boundary."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_definitions as definitions
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


async def test_scheduled_method_signature_tracks_destinations_but_not_names(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A scheduled-only destination edit must invalidate its delivery route."""
    data = definitions.defaults()
    data["methods"] = {
        "mail": {"name": "Email", "mode": "fixed", "destinations": ["notify:mail"]}
    }
    config_data["monitoring_policies"][0]["notifications"] = [
        {
            "id": "daily",
            "timing": {"mode": "report", "at": "08:00", "weekdays": list(range(7))},
            "methods": ["mail"],
        }
    ]
    config_data.update(notifications=False, notification_definitions=data)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    before = runtime._route_signatures()
    renamed = deepcopy(data)
    renamed["methods"]["mail"]["name"] = "Household email"
    assert (
        runtime._route_signatures(
            Settings.from_data({**config_data, "notification_definitions": renamed})
        )
        == before
    )
    changed = deepcopy(data)
    changed["methods"]["mail"]["destinations"] = ["notify:new_mail"]
    after = runtime._route_signatures(
        Settings.from_data({**config_data, "notification_definitions": changed})
    )
    assert before.keys() == after.keys()
    assert before != after
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_presence_change_replay_and_original_target_cleanup(
    hass: HomeAssistant, config_data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A queued request keeps its resolved targets and clears those same targets."""
    data = definitions.defaults()
    data["methods"] = {
        "household": {
            "name": "Household",
            "mode": "home_away",
            "people": ["person.owner"],
            "home": ["notify:home"],
            "away": ["notify:away"],
            "fallback": ["notify:fallback"],
            "skip": False,
        }
    }
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "immediate", "timing": {"mode": "immediate"}, "methods": ["household"]}
    ]
    config_data.update(consumer=None, notification_definitions=data)
    send = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", send)
    hass.states.async_set("person.owner", "home")
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    send.assert_awaited_once()
    assert send.call_args.args[1] == "notify:home"
    payload = deepcopy(next(iter(runtime._resolved_requests.values())))
    hass.states.async_set("person.owner", "not_home")
    await hass.async_block_till_done()
    await runtime.async_send_notification(payload)
    send.assert_awaited_once()
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert send.await_count == 2
    assert send.call_args.args[1] == "notify:home"
    assert send.call_args.kwargs["clear"] is True
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_name_only_method_edit_does_not_notify_again(
    hass: HomeAssistant, config_data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Renaming a shared method preserves an open issue's delivered state."""
    data = definitions.defaults()
    data["methods"] = {
        "mail": {"name": "Email", "mode": "fixed", "destinations": ["notify:mail"]}
    }
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "now", "timing": {"mode": "immediate"}, "methods": ["mail"]}
    ]
    config_data.update(consumer=None, notification_definitions=data)
    send = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", send)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    send.assert_awaited_once()
    episode_ids = set(runtime.episodes)
    renamed = deepcopy(data)
    renamed["methods"]["mail"]["name"] = "Household email"
    hass.config_entries.async_update_entry(
        entry,
        options={
            **config_data,
            "notification_definitions": renamed,
        },
    )
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert set(entry.runtime_data.episodes) == episode_ids
    assert all(
        call.kwargs.get("silent") or call.kwargs.get("clear")
        for call in send.await_args_list[1:]
    )
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_edit_only_restarts_affected_notification_row(
    hass: HomeAssistant, config_data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Changing one method leaves an independent row's delivery history intact."""
    data = definitions.defaults()
    data["methods"] = {
        "mail": {"name": "Email", "mode": "fixed", "destinations": ["notify:mail"]},
        "other": {"name": "Other", "mode": "fixed", "destinations": ["notify:other"]},
    }
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "mail_now", "timing": {"mode": "immediate"}, "methods": ["mail"]},
        {"id": "other_now", "timing": {"mode": "immediate"}, "methods": ["other"]},
    ]
    config_data.update(consumer=None, notification_definitions=data)
    send = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", send)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert send.await_count == 2
    unaffected = deepcopy(
        runtime.delivery.messages[
            next(key for key in runtime.delivery.messages if "other_now" in key)
        ]
    )
    changed = deepcopy(data)
    changed["methods"]["mail"]["destinations"] = ["notify:new_mail"]
    hass.config_entries.async_update_entry(
        entry,
        options={
            **config_data,
            "notification_definitions": changed,
        },
    )
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert all(call.args[1] != "notify:other" for call in send.await_args_list[2:])
    assert any(
        call.args[1] == "notify:new_mail" and not call.kwargs["clear"]
        for call in send.await_args_list[2:]
    )
    assert unaffected in entry.runtime_data.delivery.messages.values()
    assert await hass.config_entries.async_unload(entry.entry_id)
