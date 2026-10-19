"""Preserving published settings when adding notification collection fields."""

import json
from contextlib import nullcontext
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
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
async def test_old_settings_are_converted_once_without_replacing_choices(
    hass: HomeAssistant,
    legacy_settings: dict[str, Any],
    location: str,
    customized: bool,
) -> None:
    """Both saved locations retain edits and add only zero collection delays."""
    if customized:
        legacy_settings["notifications"] = True
        legacy_settings["monitoring_policies"][0]["name"] = "Old custom policy"
        legacy_settings["monitoring_policies"][0]["enabled"] = False
        legacy_settings["monitoring_policies"][1]["match"]["device"] = ["missing"]
        legacy_settings["monitoring_policies"][1]["excluded_sources"] = [
            "device:excluded",
            "entity:registry:excluded",
        ]
        legacy_settings["monitoring_policies"] = [
            row
            for row in legacy_settings["monitoring_policies"]
            if row["id"] not in {"default_batteries", "default_vacuums"}
        ]
        del legacy_settings["notification_definitions"]["profiles"]["evening"]
        legacy_settings["notification_definitions"]["profiles"]["morning"]["timing"][
            "at"
        ] = "09:15"
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
        expected = deepcopy(old)
        for profile in expected["notification_definitions"]["profiles"].values():
            if profile["timing"]["mode"] != "report":
                profile["timing"]["collection_delay_seconds"] = 0
        expected["monitoring_policies"][1]["match"] = {
            "kind": ["entity"],
            "device": ["missing"] if customized else [],
        }
        assert dict(entry.data) == expected
        assert not entry.options
        assert runtime.settings == Settings.from_data(expected, functions_enabled=False)
        assert legacy_settings == old
        assert runtime.available
        assert runtime.settings.notifications is old["notifications"]
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


@pytest.mark.parametrize("location", ["data", "options"])
async def test_conversion_waits_for_startup_and_does_not_trigger_reload(
    hass: HomeAssistant,
    legacy_settings: dict[str, Any],
    hass_storage: dict[str, Any],
    location: str,
) -> None:
    """Conversion waits for a successful start and fires no recursive entry reload."""
    hass.set_state(CoreState.not_running)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=legacy_settings if location == "data" else initial_settings("UTC"),
        options=legacy_settings if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options)))
    entry.add_to_hass(hass)
    with patch.object(
        hass.config_entries, "async_reload", wraps=hass.config_entries.async_reload
    ) as reload:
        assert await hass.config_entries.async_setup(entry.entry_id)
        runtime = entry.runtime_data
        assert runtime.engine is None
        assert (dict(entry.data), dict(entry.options)) == before
        assert f"{DOMAIN}.{entry.entry_id}" not in hass_storage
        await hass.async_start()
        await hass.async_block_till_done()
        assert entry.runtime_data is runtime
        assert runtime.available
        assert not entry.options
        converted = deepcopy(dict(entry.data))
        assert (dict(entry.data), dict(entry.options)) != before
        reload.assert_not_awaited()
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.runtime_data is not runtime
        assert entry.runtime_data.available
        assert dict(entry.data) == converted
        assert not entry.options
        assert reload.await_count == 1
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "invalid",
    ["policy_version", "timing", "method", "mixed_collection", "profile"],
)
@pytest.mark.parametrize("location", ["data", "options"])
async def test_unrelated_invalid_settings_are_never_reset(
    hass: HomeAssistant, legacy_settings: dict[str, Any], invalid: str, location: str
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
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=legacy_settings if location == "data" else initial_settings("UTC"),
        options=legacy_settings if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options)))
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert (dict(entry.data), dict(entry.options)) == before


async def test_invalid_stored_state_prevents_configuration_conversion(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    legacy_settings: dict[str, Any],
    hass_storage: dict[str, Any],
) -> None:
    """A damaged saved envelope cannot leave a partially converted installation."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    hass_storage[key]["data"]["schema_version"] = 999
    hass.config_entries.async_update_entry(entry, options=legacy_settings)
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before


@pytest.mark.parametrize("field", ["engine", "policy"])
@pytest.mark.parametrize("location", ["data", "options"])
async def test_failed_runtime_restore_never_persists_conversion(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    field: str,
    location: str,
) -> None:
    """Public restore failures preserve both saved locations and the original state."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    hass_storage[key]["data"][field]["schema_version"] = 900
    legacy = deepcopy(config_data)
    for profile in legacy["notification_definitions"]["profiles"].values():
        profile["timing"].pop("collection_delay_seconds", None)
    hass.config_entries.async_update_entry(
        entry,
        data=legacy if location == "data" else config_data,
        options=legacy if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
        patch(
            "custom_components.homeostatic.runtime.Runtime._save", new=AsyncMock()
        ) as save,
    ):
        for _ in range(2):
            assert await hass.config_entries.async_setup(entry.entry_id)
            await hass.async_block_till_done()
            runtime = entry.runtime_data
            assert not runtime.available
            assert runtime.error == "cannot restore schema 900"
            await runtime.async_refresh()
            assert not runtime.available
            freezer.tick(timedelta(minutes=16))
            async_fire_time_changed(hass, dt_util.utcnow())
            await hass.async_block_till_done()
            assert not runtime.available
            assert await hass.config_entries.async_unload(entry.entry_id)
            assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before
        save.assert_not_awaited()
        send.assert_not_awaited()
        assert not events


@pytest.mark.parametrize("kind", ["presented", "queued"])
@pytest.mark.parametrize("location", ["data", "options"])
async def test_historical_delivery_state_is_rejected_without_mutation_or_sending(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    kind: str,
    location: str,
) -> None:
    """Real published state stays intact rather than reopening existing messages.

    The opaque fixtures were generated with Homeostatic v1.9.0 (5f1ca281)
    and health-tree v0.8.0 (8a1e6f7b) in isolated Home Assistant 2026.9.3.
    """
    freezer.move_to("2026-10-19T12:00:00+00:00")
    fixture = json.loads(
        (Path(__file__).parent / f"fixtures/upgrade_1_9_{kind}.json").read_text()
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        entry_id="legacy-upgrade",
        data=fixture["data"] if location == "data" else initial_settings("UTC"),
        options=fixture["data"] if location == "options" else {},
    )
    key = f"{DOMAIN}.{entry.entry_id}"
    hass_storage[key] = {
        "version": 1,
        "minor_version": 1,
        "key": key,
        "data": fixture["snapshot"],
    }
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry.add_to_hass(hass)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        assert not await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_start()
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.SETUP_ERROR
        assert "predates supported collection tracking" in entry.reason
        assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before
        assert not events
        send.assert_not_awaited()


async def test_existing_current_store_without_collection_marker_is_not_empty_setup(
    hass: HomeAssistant, config_data: dict[str, Any], hass_storage: dict[str, Any]
) -> None:
    """A missing delivery envelope field never becomes a fresh empty installation."""
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    del hass_storage[key]["data"]["delivery"]["delivery_collections"]
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before
    assert not events


async def test_conversion_preserves_history_and_continuing_monitoring(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    legacy_settings: dict[str, Any],
) -> None:
    """Adding collection fields retains ended and continuing entity issues."""
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
    [continuing] = runtime.episodes
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
    assert continuing not in history
    assert continuing in restored.episodes
    assert restored.available
    assert not restored.settings.notifications
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("queued", [False, True], ids=["presented", "outbox"])
@pytest.mark.parametrize("named", [False, True], ids=["inline", "named"])
async def test_conversion_preserves_presented_messages_and_queued_requests(
    hass: HomeAssistant, config_data: dict[str, Any], queued: bool, named: bool
) -> None:
    """Conversion neither withdraws a shown message nor duplicates queued delivery."""
    if named:
        config_data["monitoring_policies"][0]["notifications"] = [
            {"id": "now", "profile": "immediate"}
        ]
        profile = config_data["notification_definitions"]["profiles"]["immediate"]
        profile["timing"]["collection_delay_seconds"] = 0
        profile["methods"] = ["test"]
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
            messages = deepcopy(runtime.delivery.messages)
            pending = deepcopy(runtime.delivery.outbox)
            events.clear()
            send.reset_mock()
            legacy = deepcopy(config_data)
            for profile in legacy["notification_definitions"]["profiles"].values():
                profile["timing"].pop("collection_delay_seconds", None)
            hass.config_entries.async_update_entry(entry, options=legacy)
            assert await hass.config_entries.async_reload(entry.entry_id)
            await hass.async_block_till_done()
        assert entry.runtime_data.settings.notifications
        assert entry.runtime_data.delivery.messages == messages
        assert [event.data["delivery_id"] for event in events] == [
            row["delivery_id"] for row in pending
        ]
        assert [event.data["channels"] for event in events] == [
            row["channels"] for row in pending
        ]
        assert len(send.await_args_list) == len(pending)
        assert not entry.runtime_data.delivery.outbox
        previous = list(events)
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert events == previous
        assert await hass.config_entries.async_unload(entry.entry_id)
