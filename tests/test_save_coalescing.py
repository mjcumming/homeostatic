"""Evidence-only saves coalesce on a Home Assistant timer; saves verify by bytes (ADR 0096)."""

from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.json import prepare_save_json
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, SAVE_COALESCE_SECONDS
from tests.test_lifecycle import start_monitor
from tests.test_save_performance import real_runtime_storage

WINDOW = timedelta(seconds=SAVE_COALESCE_SECONDS + 1)


def _count_saves(runtime: Any, calls: list[dict[str, Any]]) -> Any:
    original = runtime.store.async_save

    async def save(data: dict[str, Any]) -> None:
        calls.append(data)
        await original(data)

    return patch.object(runtime.store, "async_save", side_effect=save)


async def test_evidence_only_refreshes_save_once_per_window(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Refreshes without requests or episode changes defer to one timed save."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    calls: list[dict[str, Any]] = []
    with _count_saves(runtime, calls):
        await runtime.async_refresh(reconcile=False, cause="test")
        await runtime.async_refresh(reconcile=False, cause="test")
        assert calls == []
        assert runtime._save_pending is True
        assert runtime._pending_save_cancel is not None
        async_fire_time_changed(hass, dt_util.utcnow() + WINDOW)
        await hass.async_block_till_done()
        assert len(calls) == 1
        assert runtime._save_pending is False
        assert runtime._pending_save_cancel is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_episode_changes_and_settings_save_immediately(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An opened episode and a settings save persist at once and clear a pending timer."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    calls: list[dict[str, Any]] = []
    with _count_saves(runtime, calls):
        await runtime.async_refresh(reconcile=False, cause="test")
        assert calls == [] and runtime._save_pending is True
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        assert len(calls) == 1
        assert runtime._save_pending is False
        assert runtime._pending_save_cancel is None
        assert any(episode["anchor"] for episode in runtime.episodes.values())
        await runtime.async_refresh(reconcile=False, cause="test")
        assert len(calls) == 1 and runtime._save_pending is True
        changed = deepcopy(config_data)
        changed["monitoring_policies"][0]["name"] = "Renamed policy"
        await runtime.async_apply_settings(Settings.from_data(changed))
        assert len(calls) == 2
        assert runtime._save_pending is False
        assert runtime._pending_save_cancel is None
        async_fire_time_changed(hass, dt_util.utcnow() + WINDOW)
        await hass.async_block_till_done()
        assert len(calls) == 2
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unload_saves_and_cancels_the_pending_timer(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Shutdown performs the final save and leaves no timer behind."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    calls: list[dict[str, Any]] = []
    with _count_saves(runtime, calls):
        await runtime.async_refresh(reconcile=False, cause="test")
        assert runtime._pending_save_cancel is not None
        assert await hass.config_entries.async_unload(entry.entry_id)
        assert len(calls) == 1
    assert runtime._pending_save_cancel is None
    assert runtime._save_pending is False


async def test_saves_verify_by_bytes_and_fall_back_to_parsing(
    hass: HomeAssistant, config_data: dict[str, Any], tmp_path: Path
) -> None:
    """Equal bytes skip the parsed read-back; different bytes use it; mismatches raise."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    with real_runtime_storage(tmp_path):
        entry = MockConfigEntry(domain=DOMAIN, data=config_data)
        runtime = await start_monitor(hass, entry)
        loads: list[int] = []
        original_load = runtime.store.async_load

        async def counting_load() -> Any:
            loads.append(1)
            return await original_load()

        with patch.object(runtime.store, "async_load", side_effect=counting_load):
            hass.states.async_set("sensor.observed", "unavailable")
            await hass.async_block_till_done()
            assert runtime.error is None
            assert loads == []

            def padded(data: Any, **kwargs: Any) -> tuple[str, Any]:
                mode, payload = prepare_save_json(data, **kwargs)
                return mode, (
                    payload + b" " if isinstance(payload, bytes) else payload + " "
                )

            with patch.object(runtime_module, "prepare_save_json", side_effect=padded):
                hass.states.async_set("sensor.observed", "1")
                await hass.async_block_till_done()
            assert runtime.error is None
            assert len(loads) == 1
        original_save = runtime.store.async_save

        async def corrupting_save(data: dict[str, Any]) -> None:
            await original_save({**data, "corrupted": True})

        with (
            patch.object(runtime.store, "async_save", side_effect=corrupting_save),
            pytest.raises(HomeAssistantError, match="could not be saved"),
        ):
            await runtime._save()
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_failed_deferred_save_is_reported_and_retried(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A deferred save that fails marks monitoring failed; the next refresh saves at once."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    await runtime.async_refresh(reconcile=False, cause="test")
    assert runtime._save_pending is True
    with patch.object(
        runtime.store, "async_save", side_effect=OSError("disk unavailable")
    ):
        async_fire_time_changed(hass, dt_util.utcnow() + WINDOW)
        await hass.async_block_till_done()
    assert runtime.error == "disk unavailable"
    assert not runtime.available
    calls: list[dict[str, Any]] = []
    with _count_saves(runtime, calls):
        await runtime.async_refresh(reconcile=False, cause="test")
    assert len(calls) == 1
    assert runtime.error is None
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)
