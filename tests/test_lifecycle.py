"""Executable setup, observation, delivery, and restart scenarios."""

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from freezegun.api import FrozenDateTimeFactory
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.runtime import Runtime

SCENARIOS = yaml.safe_load(
    (Path(__file__).parent / "fixtures/scenarios.yaml").read_text()
)


async def start_monitor(hass: HomeAssistant, entry: MockConfigEntry) -> Runtime:
    """Load the real integration and complete HA startup."""
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
async def test_observation_scenarios(
    hass: HomeAssistant, config_entry: MockConfigEntry, scenario: dict[str, Any]
) -> None:
    """Observed HA states keep restored and unknown evidence distinct."""
    hass.states.async_set("sensor.observed", scenario["state"], scenario["attributes"])
    runtime = await start_monitor(hass, config_entry)
    assert runtime.readiness == scenario["readiness"]
    assert len(runtime.episodes) == scenario["episodes"]
    assert runtime.available
    assert (
        hass.states.get("sensor.homeostatic_readiness").state == scenario["readiness"]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_failure_notification_recovery(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An actual state event opens one notification and recovery dismisses it."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    episode_id = next(iter(runtime.episodes))
    assert runtime.readiness == "blocked"
    assert (
        runtime.notification_id(episode_id) in hass.data[persistent_notification.DOMAIN]
    )
    hass.states.async_set("sensor.observed", "43")
    await hass.async_block_till_done()
    assert runtime.readiness == "ready"
    assert not runtime.episodes
    assert (
        runtime.notification_id(episode_id)
        not in hass.data[persistent_notification.DOMAIN]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_startup_deferral(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The engine does not start its grace period during integration setup."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert runtime.engine is None
    assert not runtime.available
    assert hass.states.get("sensor.homeostatic_readiness").state == "unavailable"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert runtime.engine is None


async def test_restart_preserves_episode(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Reload restores an open episode and its notification identity."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert restored is not runtime
    assert list(restored.episodes) == [episode_id]
    assert restored.desired_notifications == {episode_id}
    assert not runtime.running
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_missing_source_stales(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A selected absent entity remains unknown and eventually opens stale."""
    runtime = await start_monitor(hass, config_entry)
    assert runtime.readiness == "unknown"
    assert not runtime.episodes
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert runtime.evidence_gaps == 1
    assert runtime.readiness == "unknown"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_recovery_before_delayed_delivery(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A recovered problem does not send a stale opening after the batch delay."""
    config_entry.data["timings"]["batch"] = 10
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    assert len(runtime.episodes) == 1
    assert not runtime.desired_notifications
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert not runtime.desired_notifications
    assert await hass.config_entries.async_unload(config_entry.entry_id)
