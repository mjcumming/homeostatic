"""Operator scenarios: authorization, expiry, scope, restart and durability."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Context, CoreState, Event, HomeAssistant, callback
from homeassistant.exceptions import (
    HomeAssistantError,
    ServiceValidationError,
    Unauthorized,
)
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.controls import expiry, restore_controls
from tests.test_lifecycle import start_monitor

NODE = "entity:entity_id:sensor.observed"


def end(seconds: int = 30) -> str:
    """Provide an explicit expiry relative to the controlled adapter clock."""
    return (dt_util.utcnow() + timedelta(seconds=seconds)).isoformat()


async def action(
    hass: HomeAssistant, name: str, data: dict[str, Any], user_id: str | None = None
) -> dict[str, Any]:
    """Exercise native action validation and authorization with responses."""
    return await hass.services.async_call(
        DOMAIN,
        name,
        data,
        blocking=True,
        return_response=True,
        context=Context(user_id=user_id),
    )


@pytest.mark.parametrize("loudness", ["notify", "urgent"])
async def test_shelf_holds_all_recipients_across_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    loudness: str,
    hass_admin_user: User,
) -> None:
    """Shelving holds reminders/escalation for every route without changing health."""
    config_data["policy"] = {
        "timezone": "UTC",
        "recipients": {
            "owner": {"channels": ["phone"]},
            "backup": {"channels": ["phone"]},
        },
        "rules": [
            {
                "match": {},
                "loudness": loudness,
                "to": ["owner", "backup"],
                "remind_every": "10s",
                "escalate_after": "15s",
            }
        ],
    }
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    episode_id = next(iter(runtime.episodes))
    opened_at = runtime.episodes[episode_id]["opened_at"]
    events.clear()
    result = await action(
        hass,
        "shelve",
        {"episode_id": episode_id, "until": end(), "reason": "Replacing equipment"},
        hass_admin_user.id,
    )
    assert result["control"]["user_id"] == hass_admin_user.id
    assert runtime.readiness == "blocked"
    assert len(runtime.delivery.messages) == 2
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not events
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert (await action(hass, "operator_controls", {}))["controls"] == [
        result["control"]
    ]
    freezer.tick(timedelta(seconds=5))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not events
    freezer.tick(timedelta(seconds=14))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert {event.data["recipient"] for event in events} == {"owner", "backup"}
    assert all(event.data["loudness"] == "urgent" for event in events)
    assert restored.episodes[episode_id]["opened_at"] == opened_at
    assert (await action(hass, "operator_controls", {})) == {"controls": []}
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("include_dependents,expected_count", [(False, 1), (True, 0)])
async def test_equipment_scope_preserves_situation_and_readiness(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    include_dependents: bool,
    expected_count: int,
) -> None:
    """A scoped window survives reload and never covers an independent situation."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    source.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "test", config_entry=source
    )
    child = f"entity:registry:{registered.id}"
    root = f"entry:{source.entry_id}"
    config_data.update(
        entities=[f"registry:{registered.id}"],
        functions=[{"id": "lighting", "name": "Lighting", "requires": [child]}],
        situations=[
            {
                "id": "leak",
                "name": "Leak",
                "entity": "entity_id:binary_sensor.leak",
                "importance": "critical",
            }
        ],
    )
    hass.states.async_set(registered.entity_id, "42")
    hass.states.async_set("binary_sensor.leak", "off")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    data = {"node_id": root, "include_dependents": include_dependents, "until": end()}
    before = deepcopy(runtime.snapshot())
    preview = await action(hass, "preview_maintenance", data)
    assert runtime.snapshot() == before
    assert (child in preview["node_ids"]) is include_dependents
    assert ("function:lighting" in preview["functions"]) is include_dependents
    result = await action(hass, "start_maintenance", data)
    assert result["node_ids"] == preview["node_ids"]
    assert result["control"]["user_id"] is None
    hass.states.async_set(registered.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == expected_count
    assert runtime.readiness == "blocked"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(runtime.episodes) == expected_count
    assert runtime.controls[0].control_id == result["control"]["control_id"]
    hass.states.async_set("binary_sensor.leak", "on")
    await hass.async_block_till_done()
    assert "situation:leak" in [item["anchor"] for item in runtime.episodes.values()]
    assert len(runtime.episodes) == expected_count + 1
    freezer.tick(timedelta(seconds=30))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert {item["anchor"] for item in runtime.episodes.values()} == {
        child,
        "situation:leak",
    }
    assert not runtime.controls
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_maintenance_keeps_existing_alerts_and_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Maintenance preserves an existing episode, then suppresses a transient relapse."""
    config_data["policy"] = {
        "timezone": "UTC",
        "recipients": {"owner": {"channels": ["phone"]}},
        "rules": [
            {"match": {}, "loudness": "notify", "to": "owner", "remind_every": "10s"}
        ],
    }
    config_entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "unavailable")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    result = await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    assert result["existing_episode_ids"] == [episode_id]
    freezer.tick(timedelta(seconds=10))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert events[-1].data["action"] == "remind"
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert events[-1].data["action"] == "resolve"
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert not runtime.episodes
    hass.states.async_set("sensor.observed", "43")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=20))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.controls
    assert not runtime.episodes
    assert runtime.readiness == "ready"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_shelf_extension_resolution_and_expiry_without_reminders(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Shelf expiry is scheduled even without a library delivery deadline."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    await action(hass, "shelve", {"episode_id": episode_id, "until": end(10)})
    with pytest.raises(ServiceValidationError, match="only be extended"):
        await action(hass, "shelve", {"episode_id": episode_id, "until": end(5)})
    await action(hass, "shelve", {"episode_id": episode_id, "until": end(20)})
    assert len(runtime.controls) == 1
    freezer.tick(timedelta(seconds=20))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.controls
    await action(hass, "shelve", {"episode_id": episode_id, "until": end()})
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert not runtime.controls
    assert not runtime.delivery.messages
    with pytest.raises(ServiceValidationError, match="current episode"):
        await action(hass, "shelve", {"episode_id": episode_id, "until": end()})
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "name,target",
    [("shelve", {"episode_id": "unknown"}), ("start_maintenance", {"node_id": NODE})],
)
async def test_non_admin_cannot_change_controls(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    name: str,
    target: dict[str, str],
    hass_admin_user: User,
) -> None:
    """HA's native permission guard rejects users before touching runtime state."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    user = await hass.auth.async_create_user("Viewer", group_ids=[])
    assert not user.is_admin
    before = deepcopy(runtime.snapshot())
    with pytest.raises(Unauthorized):
        await action(hass, name, {**target, "until": end()}, user.id)
    with pytest.raises(Unauthorized):
        await action(hass, name, {**target, "until": end()}, "removed-user")
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "node_id", ["situation:leak", "function:lighting", "all", "missing"]
)
async def test_reject_unsafe_maintenance_roots(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    node_id: str,
) -> None:
    """Global, situation and function roots cannot become equipment maintenance."""
    config_data.update(
        functions=[{"id": "lighting", "name": "Lighting", "requires": [NODE]}],
        situations=[
            {"id": "leak", "name": "Leak", "entity": "entity_id:binary_sensor.leak"}
        ],
    )
    config_entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, config_entry)
    with pytest.raises(ServiceValidationError):
        await action(hass, "start_maintenance", {"node_id": node_id, "until": end()})
    assert runtime.available
    assert not runtime.controls
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "value",
    ["bad", "2026-09-25T12:00:00", "2026-09-25T12:00:00Z", "2026-10-03T12:00:00Z"],
)
def test_invalid_expiry(value: str) -> None:
    """Bad, naive, expired and excessive timestamps fail validation."""
    with pytest.raises(ValueError):
        expiry(value, datetime(2026, 9, 25, 12, tzinfo=UTC))


def test_offset_expiry_and_maximum() -> None:
    """Explicit local offsets are accepted and the seven-day boundary is inclusive."""
    now = datetime(2026, 9, 25, 12, tzinfo=UTC)
    assert expiry("2026-10-02T07:00:00-05:00", now) == now + timedelta(days=7)


@pytest.mark.parametrize("stored", [None, {}, [{}], [{"action": "all"}]])
def test_invalid_control_storage(stored: Any) -> None:
    """Malformed storage cannot be mistaken for no active controls."""
    with pytest.raises((ValueError, vol.Invalid)):
        restore_controls(stored)


async def test_control_storage_failure_is_visible_and_recoverable(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
) -> None:
    """A failed write never reports success and is recoverable through normal refresh."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    key = f"{DOMAIN}.{config_entry.entry_id}"
    with (
        patch.object(runtime.store, "async_save", return_value=None),
        pytest.raises(HomeAssistantError, match="Could not confirm"),
    ):
        await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    assert not runtime.available
    assert not hass_storage[key]["data"]["operator_controls"]
    with pytest.raises(HomeAssistantError, match="not ready"):
        await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    await runtime.async_refresh()
    assert runtime.available
    assert len(hass_storage[key]["data"]["operator_controls"]) == 1
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert len(config_entry.runtime_data.controls) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_controls_before_start_are_rejected(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Controls cannot act on an unstarted engine."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    with pytest.raises(HomeAssistantError, match="not ready"):
        await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_observations_during_control_save_are_not_lost(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
) -> None:
    """A fault arriving during maintenance persistence is evaluated after expiry."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    entered, release, observed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    save = runtime._save

    async def slow_save() -> None:
        entered.set()
        await release.wait()
        await save()

    @callback
    def saw_state(event: Event[Any]) -> None:
        if event.data["entity_id"] == "sensor.observed":
            observed.set()

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, saw_state)
    with patch.object(runtime, "_save", side_effect=slow_save):
        task = hass.async_create_task(
            action(hass, "start_maintenance", {"node_id": NODE, "until": end(5)})
        )
        await entered.wait()
        freezer.tick(timedelta(seconds=6))
        hass.states.async_set("sensor.observed", "unavailable")
        await observed.wait()
        release.set()
        await task
        await hass.async_block_till_done()
    assert runtime.readiness == "blocked"
    assert len(runtime.episodes) == 1
    assert not runtime.controls
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    cancel()
