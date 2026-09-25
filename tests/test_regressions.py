"""Scenarios for quiet monitoring and configuration reload boundaries."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import data_from_input
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


async def test_ordinary_value_change_does_not_write_snapshot(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An available power sensor can change rapidly without a disk write per value."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    with patch.object(
        runtime.store, "async_save", wraps=runtime.store.async_save
    ) as save:
        hass.states.async_set("sensor.observed", "43")
        await hass.async_block_till_done()
    save.assert_not_called()
    assert runtime.readiness == "ready"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_unchanged_problem_does_not_republish(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Periodic reconciliation does not repeatedly recreate an unchanged message."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    with patch.object(
        persistent_notification,
        "async_create",
        wraps=persistent_notification.async_create,
    ) as create:
        await runtime.async_refresh()
        await runtime.async_refresh()
    create.assert_not_called()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_notification_options_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Turning messages off clears the existing message but preserves the problem."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {"entity_ids": ["sensor.observed"], "notifications": False}
    )
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert restored is not runtime
    assert list(restored.episodes) == [episode_id]
    assert not restored.desired_notifications
    assert (
        runtime.notification_id(episode_id)
        not in hass.data[persistent_notification.DOMAIN]
    )
    assert restored.readiness == "blocked"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_unenrollment_options_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Removing all sources resolves removed episodes and reports unknown scope."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "entity_ids": [],
            "notifications": True,
            "consumer": "automation.homeostatic_test_consumer",
        },
    )
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert restored is not runtime
    assert restored.readiness == "unknown"
    assert not restored.episodes
    assert not restored.desired_notifications
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_probe_does_not_fabricate_freshness(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A dependency in doubt stays unknown when a settle probe has no live proof."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.NOT_LOADED)
    source.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "test", config_entry=source
    )
    config_data["entities"] = [f"registry:{registered.id}"]
    config_data["timings"]["settle"] = 10
    config_data["timings"]["unknown_hold"] = 100
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set(registered.entity_id, "unavailable")
    runtime = await start_monitor(hass, entry)
    assert not runtime.episodes
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert runtime.engine.readiness([f"entry:{source.entry_id}"]).answer == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unregistered_entity_selection(hass: HomeAssistant) -> None:
    """A state-only entity is selected explicitly without inventing a registry id."""
    result = data_from_input(hass, {"entity_ids": ["sensor.unregistered"]})
    assert result["entities"] == ["entity_id:sensor.unregistered"]


async def test_retry_restore_keeps_onset(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """Restart cannot repeatedly reset a setup-retry warning's escalation hold."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.SETUP_RETRY)
    source.add_to_hass(hass)
    config_data["entities"] = []
    config_data["config_entries"] = [source.entry_id]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    onset = deepcopy(runtime.retry_since)
    assert await hass.config_entries.async_unload(entry.entry_id)
    freezer.tick(timedelta(seconds=21))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert restored.retry_since == onset
    assert restored.readiness == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)
