"""Persistence, delivery ordering, and lifecycle failure scenarios."""

from copy import deepcopy
from datetime import timedelta
from operator import ne
from pathlib import Path
from threading import Event, get_ident
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import json as storage_json
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.test_lifecycle import start_monitor

_STORE_LOAD = Store._async_load
_STORE_WRITE = Store._async_write_data


@pytest.mark.parametrize(
    "override",
    [
        {"schema_version": 999},
        {"engine": []},
        {"evidence": []},
        {"monitoring_identities": []},
        {"monitoring_identities": {"monitoring:entities": "monitoring:entities"}},
        {"monitoring_identities": {"monitoring:a:key:one": "monitoring:b:key:one"}},
        {"monitoring_identities": {"monitoring:a:key:one": "monitoring:a:key:two"}},
        {"notifications": "bad"},
        {"notifications": [2]},
        {"episodes": {"bad": {"episode_id": "different"}}},
        {"episodes": {"bad": {"episode_id": "bad"}}},
        {"episodes": {"bad": {"episode_id": "bad", "anchor": "a", "reasons": [2]}}},
    ],
    ids=[
        "version",
        "engine-shape",
        "evidence-shape",
        "monitoring-identities-shape",
        "monitoring-identity-shape",
        "monitoring-identity-policy",
        "monitoring-identity-source",
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
    await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    data.update(override)
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"] == data


@pytest.mark.parametrize("field", ["monitoring_identities"])
async def test_current_snapshot_requires_monitoring_continuity_metadata(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    field: str,
) -> None:
    """A damaged current envelope cannot fall back to legacy detector identities."""
    await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    assert data["schema_version"] == 3
    data.pop(field)
    before = deepcopy(data)
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"] == before


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
        assert runtime.episodes
        assert not runtime.available
        assert {
            message["tag"] for message in runtime.delivery.messages.values()
        }.isdisjoint(hass.data[persistent_notification.DOMAIN])
    await runtime.async_refresh()
    assert runtime.available
    assert (
        next(iter(runtime.delivery.messages.values()))["tag"]
        in hass.data[persistent_notification.DOMAIN]
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
    """A queued report is canceled if current evidence passed while HA was down."""
    report_at = dt_util.utcnow() + timedelta(minutes=1)
    config_entry.data["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "report",
        "at": report_at.strftime("%H:%M"),
        "weekdays": list(range(7)),
    }
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    assert runtime.episodes
    assert not events
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    freezer.tick(timedelta(seconds=61))
    hass.states.async_set("sensor.observed", "42")
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert not restored.episodes
    assert not restored.desired_notifications
    assert not events
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize("schema_version", [2, 3])
async def test_remove_cleans_store_and_notification(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    schema_version: int,
) -> None:
    """Removing Homeostatic leaves no owned message or snapshot behind."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    notification_tags = {
        message["tag"] for message in runtime.delivery.messages.values()
    }
    assert notification_tags
    snapshot = runtime.snapshot
    with patch.object(
        runtime,
        "snapshot",
        side_effect=lambda: {**snapshot(), "schema_version": schema_version},
    ):
        assert await hass.config_entries.async_remove(config_entry.entry_id)
    assert f"{DOMAIN}.{config_entry.entry_id}" not in hass_storage
    assert notification_tags.isdisjoint(hass.data[persistent_notification.DOMAIN])


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


async def test_large_snapshot_keeps_loop_responsive(
    hass: HomeAssistant, config_data: dict[str, Any], tmp_path: Path
) -> None:
    """A large verified save lets HA capture evidence before persistence finishes.

    Serialization and byte verification run off the loop; equal bytes need no
    parsed comparison.
    """
    config_data["notifications"] = False
    config_entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    snapshot = runtime.snapshot()
    snapshot["large_inventory"] = {str(node): "x" * 3500 for node in range(3966)}
    loop_thread = get_ident()
    serialization_threads: list[int] = []
    verification_threads: list[int] = []
    comparison_threads: list[int] = []
    evidence_captured = Event()
    prepare_json = storage_json.prepare_save_json

    @callback
    def capture_evidence() -> None:
        hass.states.async_set("sensor.observed", "unavailable")
        hass.loop.call_soon(evidence_captured.set)

    def serialize(data: Any, *, encoder: Any = None) -> tuple[str, str | bytes]:
        serialization_threads.append(get_ident())
        assert get_ident() != loop_thread
        hass.loop.call_soon_threadsafe(capture_evidence)
        assert evidence_captured.wait(timeout=5)
        return prepare_json(data, encoder=encoder)

    def verify(data: Any, *, encoder: Any = None) -> tuple[str, str | bytes]:
        verification_threads.append(get_ident())
        assert get_ident() != loop_thread
        return prepare_json(data, encoder=encoder)

    def differs(stored: Any, expected: Any) -> bool:
        comparison_threads.append(get_ident())
        assert get_ident() != loop_thread
        return ne(stored, expected)

    with (
        patch.object(runtime, "snapshot", return_value=snapshot),
        patch.object(runtime.store, "path", str(tmp_path / "snapshot")),
        patch.object(runtime.store, "_async_load", _STORE_LOAD.__get__(runtime.store)),
        patch.object(
            runtime.store, "_async_write_data", _STORE_WRITE.__get__(runtime.store)
        ),
        patch.object(storage_json, "prepare_save_json", side_effect=serialize),
        patch("custom_components.homeostatic.runtime.prepare_save_json", new=verify),
        patch("custom_components.homeostatic.runtime.ne", new=differs),
    ):
        async with runtime._lock:
            await runtime._save()
            assert runtime._pending
            assert not runtime.episodes

    assert len(serialization_threads) == 1
    assert len(verification_threads) == 1
    assert comparison_threads == []
    await hass.async_block_till_done()
    assert runtime.available
    assert len(runtime.episodes) == 1
    assert runtime.readiness == "degraded"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
