"""Acknowledgment avoids rediscovery while preserving evidence and durability."""

import asyncio
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("inventory_dirty", "discoveries"),
    [
        pytest.param(False, 0, id="current-inventory"),
        pytest.param(True, 1, id="changed-inventory"),
    ],
)
async def test_acknowledgment_discovers_only_changed_inventory(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    inventory_dirty: bool,
    discoveries: int,
) -> None:
    """Acknowledging an existing problem reuses current source inventory."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode = next(iter(runtime.episodes))
    runtime._inventory_dirty = inventory_dirty

    with patch.object(runtime, "_discover", wraps=runtime._discover) as discover:
        result = await action(hass, "acknowledge", {"episode_id": episode})

    assert discover.call_count == discoveries
    assert result["acknowledgment"]["episode_id"] == episode
    assert list(runtime.episodes) == [episode]
    assert runtime.available
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_expired_control_rejected_before_timer_fires(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Skipping discovery still expires a control before validating cancellation."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode = next(iter(runtime.episodes))
    result = await action(hass, "shelve", {"episode_id": episode, "until": end(5)})
    freezer.tick(timedelta(seconds=6))
    with pytest.raises(ServiceValidationError, match="already ended"):
        await action(
            hass, "cancel_control", {"control_id": result["control"]["control_id"]}
        )
    assert not runtime.controls
    assert list(runtime.episodes) == [episode]
    assert runtime.available
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_queued_recovery_and_recurrence_reject_old_acknowledgment(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Captured transitions replace the old issue before validating its action."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    previous_episode = next(iter(runtime.episodes))

    with patch.object(runtime, "_request_refresh"):
        hass.states.async_set("sensor.observed", "42")
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()

    assert len(runtime._pending) == 2
    assert list(runtime.episodes) == [previous_episode]
    with pytest.raises(ServiceValidationError, match="current episode id"):
        await action(hass, "acknowledge", {"episode_id": previous_episode})

    assert not runtime._pending
    assert len(runtime.episodes) == 1
    current_episode = next(iter(runtime.episodes))
    assert current_episode != previous_episode
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(current_episode) is None
    ended = runtime.query("resolved_history", {})["episodes"]
    assert len(ended) == 1
    assert ended[0]["episode"]["episode_id"] == previous_episode
    assert ended[0]["resolution"] == "cleared"
    assert runtime.available
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_acknowledgment_waits_for_durable_save(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The action stays pending until its acknowledgment is saved and restorable."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode = next(iter(runtime.episodes))
    saving, release = asyncio.Event(), asyncio.Event()
    save = runtime.store.async_save

    async def hold_save(data: dict[str, Any]) -> None:
        saving.set()
        await release.wait()
        await save(data)

    with patch.object(runtime.store, "async_save", side_effect=hold_save):
        task = hass.async_create_task(
            action(hass, "acknowledge", {"episode_id": episode})
        )
        try:
            await saving.wait()
            assert not task.done()
            assert runtime.policy is not None
            assert runtime.policy.acknowledgment(episode) is not None
        finally:
            release.set()
            result = await task

    assert result["acknowledgment"]["episode_id"] == episode
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert (await action(hass, "policy", {}))["episodes"][0][
        "acknowledgment"
    ] == result["acknowledgment"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)
