"""Persistence, delivery ordering, and lifecycle failure scenarios."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    "override",
    [
        {"schema_version": 2},
        {"engine": []},
        {"notifications": "bad"},
        {"notifications": [2]},
        {"episodes": {"bad": {"episode_id": "different"}}},
        {"episodes": {"bad": {"episode_id": "bad"}}},
        {"episodes": {"bad": {"episode_id": "bad", "anchor": "a", "reasons": [2]}}},
    ],
    ids=[
        "version",
        "engine-shape",
        "notifications-shape",
        "notification-id",
        "episode-identity",
        "episode-presentation",
        "episode-reason",
    ],
)
async def test_invalid_snapshot_fails_setup(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    override: dict[str, Any],
) -> None:
    """Malformed envelopes cannot be treated as an empty successful restore."""
    config_entry.add_to_hass(hass)
    data = {
        "schema_version": 1,
        "engine": {},
        "policy": {},
        "episodes": {},
        "notifications": [],
        "retry_since": {},
    }
    data.update(override)
    hass_storage[f"{DOMAIN}.{config_entry.entry_id}"] = {"version": 1, "data": data}
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"] == data


async def test_corrupt_engine_does_not_overwrite_snapshot(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """A failed engine restore stays failed on retries and preserves the source."""
    runtime = await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    key = f"{DOMAIN}.{config_entry.entry_id}"
    hass_storage[key]["data"]["engine"]["schema_version"] = 900
    original = deepcopy(hass_storage[key])
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert not restored.available
    assert restored.engine is None
    await restored.async_refresh()
    assert not restored.available
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert hass_storage[key] == original
    assert not runtime.running


async def test_storage_failure_defers_notification(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A problem becomes visible only after its snapshot write succeeds."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    with patch.object(
        runtime.store, "async_save", side_effect=OSError("disk unavailable")
    ):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        episode_id = next(iter(runtime.episodes))
        assert not runtime.available
        assert (
            runtime.notification_id(episode_id)
            not in hass.data[persistent_notification.DOMAIN]
        )
    await runtime.async_refresh()
    assert runtime.available
    assert (
        runtime.notification_id(episode_id) in hass.data[persistent_notification.DOMAIN]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_logged_write_failure_is_detected(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Store may return without writing; read-back must still detect failure."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    with patch.object(runtime.store, "async_save", new=AsyncMock()):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        assert not runtime.available
        assert runtime.error == "Homeostatic snapshot could not be saved"
    await runtime.async_refresh()
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_recovered_while_unloaded(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A batched opening is canceled if current evidence passed while HA was down."""
    config_entry.data["timings"]["batch"] = 10
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    freezer.tick(timedelta(seconds=20))
    hass.states.async_set("sensor.observed", "42")
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert not restored.episodes
    assert not restored.desired_notifications
    assert restored.notification_id(episode_id) not in hass.data.get(
        persistent_notification.DOMAIN, {}
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_remove_cleans_store_and_notification(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """Removing Homeostatic leaves no owned message or snapshot behind."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_remove(config_entry.entry_id)
    assert f"{DOMAIN}.{config_entry.entry_id}" not in hass_storage
    assert (
        runtime.notification_id(episode_id)
        not in hass.data[persistent_notification.DOMAIN]
    )


async def test_unload_cancels_callbacks(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Queued work and late startup cannot reactivate an unloaded monitor."""
    runtime = await start_monitor(hass, config_entry)
    await runtime.async_start(hass)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    snapshot = runtime.snapshot()
    hass.states.async_set("sensor.observed", "unavailable")
    freezer.tick(timedelta(seconds=90))
    async_fire_time_changed(hass, dt_util.utcnow())
    await runtime.async_refresh()
    await runtime.async_start(hass)
    await hass.async_block_till_done()
    assert runtime.snapshot() == snapshot
    assert not runtime.running
    assert not hass.services.has_service(DOMAIN, "inventory")


async def test_failed_platform_unload_keeps_monitor(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A refused platform unload must not leave loaded entities without runtime."""
    runtime = await start_monitor(hass, config_entry)
    with patch.object(
        hass.config_entries, "async_unload_platforms", return_value=False
    ):
        assert not await hass.config_entries.async_unload(config_entry.entry_id)
    assert runtime.running
    await hass.async_stop()
    assert not runtime.running
