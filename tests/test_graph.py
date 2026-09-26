"""Inventory reconciliation, dependency evidence, and enrollment changes."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


async def test_parent_failure_correlates_child(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A failed integration explains its unavailable entity in one episode."""
    source = MockConfigEntry(
        domain="test", state=ConfigEntryState.SETUP_ERROR, title="Controller"
    )
    source.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "test", config_entry=source
    )
    config_data["entities"] = [f"registry:{registered.id}"]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set(registered.entity_id, "unavailable")
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    episode = next(iter(runtime.episodes.values()))
    assert episode["anchor"] == f"entry:{source.entry_id}"
    assert episode["recorded"] == [f"entity:registry:{registered.id}"]
    assert runtime.readiness == "blocked"
    assert (
        runtime.engine.explain(f"entity:registry:{registered.id}").findings[0].reason
        == "unavailable"
    )
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_rename_retains_identity(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Changing an entity id updates the observed source without losing its episode."""
    registered = er.async_get(hass).async_get_or_create("sensor", "test", "test")
    config_data["entities"] = [f"registry:{registered.id}"]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set(registered.entity_id, "unavailable")
    runtime = await start_monitor(hass, entry)
    episode_id = next(iter(runtime.episodes))
    er.async_get(hass).async_update_entity(
        registered.entity_id, new_entity_id="sensor.renamed"
    )
    hass.states.async_set("sensor.renamed", "unavailable")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]
    assert (
        runtime.sources[f"entity:registry:{registered.id}"].entity_id
        == "sensor.renamed"
    )
    hass.states.async_set("sensor.renamed", "42")
    await hass.async_block_till_done()
    assert runtime.readiness == "ready"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_registry_removal_stays_unknown(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Deleting a selected registry entry does not reduce the required scope."""
    registered = er.async_get(hass).async_get_or_create("sensor", "test", "test")
    config_data["entities"] = [f"registry:{registered.id}"]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set(registered.entity_id, "42")
    runtime = await start_monitor(hass, entry)
    er.async_get(hass).async_remove(registered.entity_id)
    await hass.async_block_till_done()
    assert runtime.readiness == "unknown"
    assert runtime.targets == [f"entity:registry:{registered.id}"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_disabled_entity(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Disabling a registry entry invalidates a cached available state."""
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "test", disabled_by=er.RegistryEntryDisabler.USER
    )
    config_data["entities"] = [f"registry:{registered.id}"]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set(registered.entity_id, "42")
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_retry_timer_and_recovery(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A deadline escalates retry before the periodic reconciliation interval."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.SETUP_RETRY)
    source.add_to_hass(hass)
    config_data["entities"] = []
    config_data["config_entries"] = [source.entry_id]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "degraded"
    freezer.tick(timedelta(seconds=21))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.readiness == "blocked"
    source._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert runtime.readiness == "ready"
    assert not runtime.retry_since
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_explicit_missing_entry(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Selected missing integrations are visible requirements with no evidence."""
    config_data["entities"] = []
    config_data["config_entries"] = ["missing"]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "unknown"
    assert runtime.sources["entry:missing"].name == "missing"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_pending_reauth(hass: HomeAssistant, config_data: dict[str, Any]) -> None:
    """An active HA reauthentication flow changes the producer observation."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    source.add_to_hass(hass)
    config_data["entities"] = []
    config_data["config_entries"] = [source.entry_id]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with patch.object(
        hass.config_entries.flow,
        "async_progress",
        return_value=[{"context": {"source": "reauth", "entry_id": source.entry_id}}],
    ):
        runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes.values()))
    assert episode["reasons"][0]["reason"] == "auth_required"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_scope_change_removes_source(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Explicit unenrollment removes its episode, notification, and query target."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    runtime.settings = Settings.from_data({"entities": [], "config_entries": []})
    await runtime.async_refresh()
    assert not runtime.sources
    assert not runtime.episodes
    assert runtime.readiness == "unknown"
    assert not runtime.desired_notifications
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_entry_removed_from_scope_unsubscribes(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Reconciliation removes lifecycle subscriptions for unenrolled entries."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    source.add_to_hass(hass)
    config_data["entities"] = []
    config_data["config_entries"] = [source.entry_id]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    runtime.settings = Settings.from_data({})
    await runtime.async_refresh()
    source._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_deleted_auto_enrolled_entry_is_removed(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Deleting an auto-enrolled HA entry ends monitoring as removed."""
    source = MockConfigEntry(
        domain="test", state=ConfigEntryState.SETUP_ERROR, title="Deleted controller"
    )
    source.add_to_hass(hass)
    config_data.update(
        entities=[],
        notifications=False,
        rules=[
            {
                "id": "integrations",
                "action": "attach",
                "match": {"kind": "integration"},
                "checks": ["availability"],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{source.entry_id}"
    episode_id = next(iter(runtime.episodes))

    await hass.config_entries.async_remove(source.entry_id)
    await hass.async_block_till_done()

    assert node_id not in runtime.sources
    assert node_id not in runtime.candidates
    assert not runtime.episodes
    history = runtime.history.view(dt_util.utcnow())["episodes"]
    assert history[0]["episode"]["episode_id"] == episode_id
    assert history[0]["resolution"] == "removed"
    change = runtime.enrollment_changes[-1]
    assert change["node_id"] == node_id
    assert change["reason"] == "source_removed"
    assert change["before"]["name"] == "Deleted controller"
    assert source.entry_id not in runtime._entries
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_deleted_auto_enrolled_entry_is_removed_after_restart(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Restored state drops an auto-enrolled entry deleted while stopped."""
    source = MockConfigEntry(
        domain="test", state=ConfigEntryState.SETUP_ERROR, title="Deleted controller"
    )
    source.add_to_hass(hass)
    config_data.update(
        entities=[],
        notifications=False,
        rules=[
            {
                "id": "integrations",
                "action": "attach",
                "match": {"kind": "integration"},
                "checks": ["availability"],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{source.entry_id}"
    episode_id = next(iter(runtime.episodes))

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.config_entries.async_remove(source.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data

    assert node_id not in restored.sources
    assert not restored.episodes
    history = restored.history.view(dt_util.utcnow())["episodes"]
    assert history[0]["episode"]["episode_id"] == episode_id
    assert history[0]["resolution"] == "removed"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "data",
    [{"entities": []}, {"notifications": False}],
    ids=["empty-enrollment", "notifications-disabled"],
)
async def test_record_only(
    hass: HomeAssistant, config_data: dict[str, Any], data: dict[str, Any]
) -> None:
    """Empty or notification-disabled configurations never send messages."""
    config_data.update(data)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, entry)
    assert not runtime.desired_notifications
    assert await hass.config_entries.async_unload(entry.entry_id)
