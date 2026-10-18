"""Explicit replacement of valid settings from before notification collection."""

import json
from contextlib import nullcontext
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.policy_defaults import initial_settings
from tests.test_lifecycle import start_monitor


@pytest.fixture
def legacy_settings() -> dict[str, Any]:
    """Load the exact initial settings produced by the published v1.9.0 tag."""
    return json.loads(
        (Path(__file__).parent / "fixtures/settings_1_9.json").read_text()
    )


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("customized", [False, True])
async def test_old_settings_are_replaced_once_with_sending_off(
    hass: HomeAssistant,
    legacy_settings: dict[str, Any],
    location: str,
    customized: bool,
) -> None:
    """Both saved locations receive fresh defaults, including explicit old edits."""
    if customized:
        legacy_settings["notifications"] = True
        legacy_settings["monitoring_policies"][0]["name"] = "Old custom policy"
        legacy_settings["notification_definitions"]["methods"]["old_phone"] = {
            "name": "Old phone",
            "mode": "fixed",
            "destinations": ["service:homeostatic_test"],
        }
        legacy_settings["notification_definitions"]["profiles"]["immediate"][
            "methods"
        ] = ["old_phone"]
        legacy_settings["monitoring_policies"][2]["notifications"] = [
            {"id": "custom", "profile": "immediate"}
        ]
    old = deepcopy(legacy_settings)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=legacy_settings if location == "data" else initial_settings("UTC"),
        options=legacy_settings if location == "options" else {},
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        runtime = await start_monitor(hass, entry)
        expected = initial_settings(hass.config.time_zone)
        assert dict(entry.data) == expected
        assert not entry.options
        assert runtime.settings == Settings.from_data(expected, functions_enabled=False)
        assert legacy_settings == old
        assert runtime.available
        assert not runtime.settings.notifications
        assert not events
        send.assert_not_awaited()

        edited = deepcopy(expected)
        edited["monitoring_policies"][0]["name"] = "Keep this new choice"
        hass.config_entries.async_update_entry(entry, options=edited)
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert dict(entry.data) == expected
        assert dict(entry.options) == edited
        assert (
            entry.runtime_data.settings.monitoring_policies[0].name
            == "Keep this new choice"
        )
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("location", ["data", "options"])
async def test_current_settings_are_not_replaced(
    hass: HomeAssistant, config_data: dict[str, Any], location: str
) -> None:
    """Current customized settings keep their policy choices and delivery methods."""
    config_data["notifications"] = False
    config_data["monitoring_policies"][0]["name"] = "Current custom policy"
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=config_data if location == "data" else initial_settings("UTC"),
        options=config_data if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options)))
    runtime = await start_monitor(hass, entry)
    assert (dict(entry.data), dict(entry.options)) == before
    assert runtime.settings == Settings.from_data(config_data, functions_enabled=False)
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "invalid",
    ["policy_version", "timing", "method", "mixed_collection", "profile"],
)
async def test_unrelated_invalid_settings_are_never_reset(
    hass: HomeAssistant, legacy_settings: dict[str, Any], invalid: str
) -> None:
    """Malformed settings fail visibly even when they contain the older shape."""
    if invalid == "policy_version":
        legacy_settings["monitoring_policy_version"] = 0
    elif invalid == "timing":
        legacy_settings["timings"]["settle"] = -1
    elif invalid == "method":
        legacy_settings["notification_definitions"]["profiles"]["immediate"][
            "methods"
        ] = ["missing"]
    elif invalid == "mixed_collection":
        legacy_settings["notification_definitions"]["profiles"]["immediate"]["timing"][
            "collection_delay_seconds"
        ] = 60
    else:
        legacy_settings["notification_definitions"]["profiles"]["extra"] = None
    entry = MockConfigEntry(domain=DOMAIN, data=legacy_settings)
    before = deepcopy(dict(entry.data))
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert dict(entry.data) == before
    assert not entry.options


async def test_replacement_preserves_compatible_history(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    legacy_settings: dict[str, Any],
) -> None:
    """Replacing policies retains ended issues and records removed monitoring."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [cleared] = runtime.episodes
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    before = runtime.history.view(dt_util.utcnow())["episodes"]
    assert len(before) == 1
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    [removed] = runtime.episodes
    legacy_settings["monitoring_policies"].extend(config_data["monitoring_policies"])
    # The retained source has no delivery assignment in this isolated scenario.
    legacy_settings["monitoring_policies"][-1]["notifications"] = []
    hass.config_entries.async_update_entry(entry, options=legacy_settings)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    history = {
        row["episode"]["episode_id"]: row
        for row in restored.history.view(dt_util.utcnow())["episodes"]
    }
    assert history[cleared] == before[0]
    assert history[removed]["resolution"] == "removed"
    assert restored.available
    assert not restored.settings.notifications
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("queued", [False, True], ids=["presented", "outbox"])
async def test_replacement_cancels_old_requests_without_alerting(
    hass: HomeAssistant, config_data: dict[str, Any], queued: bool
) -> None:
    """Old durable delivery state can withdraw a message but cannot send an alert."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
    ):
        runtime = await start_monitor(hass, entry)
        with (
            patch.object(runtime, "_flush_events", new=AsyncMock())
            if queued
            else nullcontext()
        ):
            hass.states.async_set("sensor.observed", "unavailable")
            await hass.async_block_till_done()
            assert runtime.delivery.messages
            assert bool(runtime.delivery.outbox) is queued
            events.clear()
            send.reset_mock()
            legacy = deepcopy(config_data)
            for profile in legacy["notification_definitions"]["profiles"].values():
                profile["timing"].pop("collection_delay_seconds", None)
            hass.config_entries.async_update_entry(entry, options=legacy)
            assert await hass.config_entries.async_reload(entry.entry_id)
            await hass.async_block_till_done()
        assert not entry.runtime_data.settings.notifications
        assert all(event.data["action"] == "resolve" for event in events)
        assert all(
            call.kwargs["clear"] and not call.kwargs["urgent"]
            for call in send.await_args_list
        )
        assert not entry.runtime_data.delivery.outbox
        assert await hass.config_entries.async_unload(entry.entry_id)
