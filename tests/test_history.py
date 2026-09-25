"""Resolution history scenarios using library events and real HA lifecycle."""

from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import Episode, EpisodeResolved, Finding, Importance, Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.history import MAX_AGE, MAX_EPISODES, ResolvedHistory
from tests.test_controls import NODE, action, end
from tests.test_lifecycle import start_monitor

T0 = datetime(2026, 9, 25, tzinfo=UTC)


def terminal(episode_id: str = "episode") -> EpisodeResolved:
    """Make a public resolution record for retention and corruption scenarios."""
    return EpisodeResolved(
        episode=Episode(
            episode_id=episode_id,
            form="root",
            anchor=NODE,
            status=Status.FAIL,
            reasons=(
                Finding(
                    node_id=NODE,
                    check_id="availability",
                    status=Status.FAIL,
                    reason="unavailable",
                    since=T0,
                ),
            ),
            recorded=frozenset(),
            impact=frozenset(),
            importance=Importance.NORMAL,
            opened_at=T0,
            updated_at=T0,
            labels={"name": "Original name"},
        ),
        resolution="cleared",
    )


@pytest.mark.parametrize("batch", [0, 10])
async def test_recovery_history_persists_without_query_side_effects(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
    hass_storage: dict[str, Any],
    batch: int,
) -> None:
    """Even recovery before notification delivery retains its original evidence."""
    config_entry.data["timings"]["batch"] = batch
    hass.states.async_set(
        "sensor.observed", "unavailable", {"friendly_name": "Original name"}
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    opened = deepcopy(runtime.episodes[episode_id])
    started = (await action(hass, "resolved_history", {}))["started_at"]
    freezer.tick(timedelta(seconds=5))
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    response = await action(hass, "resolved_history", {})
    row = response["episodes"][0]
    assert row["episode"]["episode_id"] == episode_id
    assert row["episode"]["opened_at"] == opened["opened_at"]
    assert row["episode"]["reasons"] == opened["reasons"]
    assert row["resolution"] == "cleared"
    assert row["absorbed_into"] is None
    assert row["resolved_at"] == dt_util.utcnow().isoformat()
    assert response["started_at"] == started
    assert response["retention"] == {"max_episodes": 100, "max_age_days": 30}
    assert not runtime.episodes
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert (await action(hass, "resolved_history", {})) == response
    before, count = deepcopy(runtime.snapshot()), len(events)
    response["episodes"][0]["episode"]["reasons"].clear()
    assert runtime.snapshot() == before
    assert (await action(hass, "inventory", {}))["resolved_history"]["episodes"][0][
        "episode"
    ]["reasons"] == opened["reasons"]
    assert len(events) == count
    hass.states.async_set(
        "sensor.observed", "unavailable", {"friendly_name": "Renamed source"}
    )
    await hass.async_block_till_done()
    assert next(iter(runtime.episodes)) != episode_id
    assert (await action(hass, "resolved_history", {}))["episodes"][0]["episode"][
        "labels"
    ]["name"] == "Original name"
    assert await hass.config_entries.async_remove(config_entry.entry_id)
    assert f"{DOMAIN}.{config_entry.entry_id}" not in hass_storage


async def test_removal_during_reload_is_not_recovery(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An unenrolled fault keeps its identity and last display labels as removed."""
    hass.states.async_set(
        "sensor.observed", "unavailable", {"friendly_name": "Old source"}
    )
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    hass.config_entries.async_update_entry(
        config_entry, options={**config_entry.data, "rules": [], "entities": []}
    )
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    row = (await action(hass, "resolved_history", {}))["episodes"][0]
    assert row["episode"]["episode_id"] == episode_id
    assert row["episode"]["labels"]["name"] == "Old source"
    assert row["resolution"] == "removed"
    assert row["source"] is None
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert (await action(hass, "resolved_history", {}))["episodes"] == [row]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_absorption_links_to_still_open_episode(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A child absorbed by its failed controller is never represented as recovered."""
    config_data["timings"]["settle"] = 30
    source = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    source.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "child", config_entry=source
    )
    config_data["entities"] = [f"registry:{registered.id}"]
    hass.states.async_set(registered.entity_id, "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    child_episode = next(iter(runtime.episodes))
    source._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "controller failed")
    await hass.async_block_till_done()
    parent_episode = next(iter(runtime.episodes))
    assert child_episode != parent_episode
    row = (await action(hass, "resolved_history", {}))["episodes"][0]
    assert row["episode"]["episode_id"] == child_episode
    assert row["resolution"] == "absorbed"
    assert row["absorbed_into"] == parent_episode
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert (await action(hass, "resolved_history", {}))["episodes"] == [row]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unknown_and_operator_controls_do_not_create_recovery(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
) -> None:
    """Unknown evidence, shelving, maintenance and disabled notifications leave history empty."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    hass.states.async_set("sensor.observed", "unknown")
    await hass.async_block_till_done()
    await action(hass, "shelve", {"episode_id": episode_id, "until": end()})
    await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    hass.config_entries.async_update_entry(
        config_entry, options={**config_entry.data, "notifications": False}
    )
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert (await action(hass, "resolved_history", {}))["episodes"] == []
    assert list(config_entry.runtime_data.episodes) == [episode_id]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_legacy_upgrade_and_recovery_observed_after_downtime(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """An old envelope starts collection now and cannot invent the offline recovery time."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    del hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]["resolved_history"]
    freezer.tick(timedelta(days=2))
    hass.states.async_set("sensor.observed", "42")
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    response = await action(hass, "resolved_history", {})
    assert response["started_at"] == dt_util.utcnow().isoformat()
    assert response["episodes"][0]["resolved_at"] == response["started_at"]
    assert response["episodes"][0]["episode"]["episode_id"] == episode_id
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_failed_resolution_save_preserves_last_durable_snapshot(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    """History and the engine advance together after a failed write recovers."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    key = f"{DOMAIN}.{config_entry.entry_id}"
    durable = deepcopy(hass_storage[key])
    with patch.object(
        runtime.store, "async_save", side_effect=OSError("disk unavailable")
    ):
        hass.states.async_set("sensor.observed", "42")
        await hass.async_block_till_done()
    assert hass_storage[key] == durable
    assert not runtime.available
    with pytest.raises(HomeAssistantError, match="not ready"):
        await action(hass, "resolved_history", {})
    await runtime.async_refresh()
    assert runtime.available
    assert len((await action(hass, "resolved_history", {}))["episodes"]) == 1
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert len((await action(hass, "resolved_history", {}))["episodes"]) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "path,value",
    [
        pytest.param(("schema_version",), 99, id="schema"),
        pytest.param(("started_at",), None, id="missing-start"),
        pytest.param(
            ("episodes", 0, "resolved_at"), "2026-09-25T00:00:00", id="naive-time"
        ),
        pytest.param(
            ("episodes", 0, "resolved_at"), "1900-01-01T00:00:00Z", id="chronology"
        ),
        pytest.param(
            ("episodes", 0, "resolution"),
            "notifications_disabled",
            id="transport-is-not-resolution",
        ),
        pytest.param(
            ("episodes", 0, "absorbed_into"), "another", id="false-absorption"
        ),
        pytest.param(
            ("episodes", 0, "source", "node_id"), "unrelated", id="source-identity"
        ),
        pytest.param(("episodes", 0, "episode", "reasons"), "bad", id="findings-shape"),
    ],
)
async def test_corrupt_history_fails_without_overwriting(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    path: tuple[str | int, ...],
    value: Any,
) -> None:
    """Invalid terminal records remain visible storage failures rather than disappearing."""
    hass.states.async_set("sensor.observed", "unavailable")
    await start_monitor(hass, config_entry)
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    key = f"{DOMAIN}.{config_entry.entry_id}"
    target = hass_storage[key]["data"]["resolved_history"]
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    before = deepcopy(hass_storage[key])
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.SETUP_ERROR
    assert hass_storage[key] == before


def test_retention_count_age_and_detached_reads() -> None:
    """Count and time bounds survive restart; reads do not rewrite persistence."""
    history = ResolvedHistory()
    for index in range(MAX_EPISODES + 1):
        history.record(terminal(str(index)), None, T0 + timedelta(seconds=index))
    now = T0 + timedelta(seconds=MAX_EPISODES)
    rows = history.view(now)["episodes"]
    assert len(rows) == MAX_EPISODES
    assert rows[0]["episode"]["episode_id"] == "100"
    assert rows[-1]["episode"]["episode_id"] == "1"
    snapshot = deepcopy(history.snapshot())
    restored = ResolvedHistory()
    restored.restore(snapshot)
    snapshot["episodes"].clear()
    assert restored.view(now) == history.view(now)
    expired = now + MAX_AGE
    assert restored.view(expired)["episodes"] == []
    assert restored.snapshot() == history.snapshot()
    restored.advance(expired)
    assert restored.snapshot()["episodes"] == []
    assert restored.view(expired)["started_at"] == T0.isoformat()


def test_replay_and_group_record_restore() -> None:
    """Replayed resolutions keep the first observation, including grouped problems."""
    history = ResolvedHistory()
    history.restore(history.snapshot())
    event = replace(terminal(), episode=replace(terminal().episode, form="group"))
    history.record(event, Source(node_id=NODE, name="Original name", kind="entity"), T0)
    history.record(event, None, T0 + timedelta(seconds=5))
    assert len(history.view(T0)["episodes"]) == 1
    assert history.view(T0)["episodes"][0]["resolved_at"] == T0.isoformat()
    restored = ResolvedHistory()
    restored.restore(history.snapshot())
    assert restored.view(T0) == history.view(T0)


def test_duplicate_stored_identity_is_invalid() -> None:
    """Stored duplicate identities are corruption, not a second recovery."""
    history = ResolvedHistory()
    history.record(terminal(), None, T0)
    state = history.snapshot()
    state["episodes"] *= 2
    with pytest.raises(ValueError, match="Duplicate history"):
        history.restore(state)


@pytest.mark.parametrize("until", ["2026-09-25T01:00:00+01:00", "not-a-time"])
def test_invalid_stored_timestamp(until: str) -> None:
    """Persisted history timestamps must use valid UTC datetimes."""
    history = ResolvedHistory()
    state = history.snapshot()
    state["started_at"] = until
    with pytest.raises((ValueError, vol.Invalid)):
        history.restore(state)
