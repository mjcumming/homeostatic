"""Lock jams retain independent problems and use the existing reporting paths."""

import asyncio
from copy import deepcopy
from dataclasses import replace
from typing import Any

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.const import (
    DOMAIN,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
)
from custom_components.homeostatic.lock import observe
from custom_components.homeostatic.notification_grouping import subject
from custom_components.homeostatic.policy_defaults import initial_settings
from tests.policy_helpers import (
    availability_policies,
    bound_identity,
    immediate_notification,
    monitoring_policy,
)
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies


def policy(identity: str = "jams") -> dict[str, Any]:
    """Watch reported jams through a normal independent condition policy."""
    return monitoring_policy(identity, {"kind": ["lock"]}, check="lock_jam")


@pytest.fixture
def lock_entity(hass: HomeAssistant) -> tuple[MockConfigEntry, er.RegistryEntry]:
    """Create a lock in real HA registries without requiring feature flags."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "front")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "lock",
        "test",
        "front",
        config_entry=owner,
        device_id=device.id,
        original_name="Front door",
    )
    hass.states.async_set(entity.entity_id, "locked")
    return owner, entity


@pytest.mark.parametrize(
    ("value", "restored", "disabled", "expected"),
    [("jammed", False, False, Status.FAIL)]
    + [
        (value, False, False, Status.PASS)
        for value in ("locked", "unlocked", "locking", "unlocking", "open", "opening")
    ]
    + [
        (value, False, False, Status.UNKNOWN)
        for value in (None, "unknown", "unavailable", "blocked")
    ]
    + [
        ("jammed", True, False, Status.UNKNOWN),
        ("jammed", False, True, Status.UNKNOWN),
    ],
)
async def test_reported_states_do_not_infer_recovery(
    hass: HomeAssistant,
    value: str | None,
    restored: bool,
    disabled: bool,
    expected: Status,
) -> None:
    """Only a fresh recognized non-jammed state can establish a passing check."""
    source = Source(
        node_id="lock:entity_id:lock.front",
        name="Front door",
        kind="lock",
        entity_id="lock.front",
        check_id="lock_jam",
        disabled=disabled,
    )
    if value is not None:
        hass.states.async_set("lock.front", value, {"restored": restored})
    observation = observe(hass, source, dt_util.utcnow())
    assert observation.status == expected
    assert observation.evidence["physical_freshness_verified"] is False
    assert (
        observation.reason == "lock_jammed"
        if expected == Status.FAIL
        else observation.reason != "lock_jammed"
    )


@pytest.mark.parametrize(
    "cleared_state", ["locked", "unlocked", "locking", "unlocking", "open", "opening"]
)
async def test_jam_recurrence_unknown_restart_and_independent_integration(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    lock_entity: tuple[MockConfigEntry, er.RegistryEntry],
    cleared_state: str,
) -> None:
    """An evidence gap and owner failure cannot clear or absorb a reported jam."""
    owner, entity = lock_entity
    selected = policy()
    config_data.update(
        notifications=False,
        monitoring_policies=[
            selected,
            *availability_policies(integrations=[owner.entry_id]),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = bound_identity(selected, f"lock:registry:{entity.id}")
    source = runtime.sources[node_id]
    assert source.node(runtime.settings).depends_on == ()
    assert subject(source) == f"device:{entity.device_id}"
    assert (
        subject(replace(source, attributes={"entity": (f"registry:{entity.id}",)}))
        == f"entity:registry:{entity.id}"
    )
    assert not runtime.episodes

    hass.states.async_set(entity.entity_id, "jammed")
    await hass.async_block_till_done()
    [first] = runtime.episodes
    for value, attributes in (
        ("jammed", {"counter": 1}),
        ("unavailable", {}),
        ("locked", {"restored": True}),
        ("blocked", {}),
    ):
        hass.states.async_set(entity.entity_id, value, attributes)
        await hass.async_block_till_done()
        assert list(runtime.episodes) == [first]
        assert runtime.entity_status(node_id)["last_failure"]["reason"] == "lock_jammed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [first]
    assert runtime.entity_status(node_id)["last_failure"]["reason"] == "lock_jammed"
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "offline")
    await hass.async_block_till_done()
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {
        node_id,
        bound_identity(
            config_data["monitoring_policies"][1], f"entry:{owner.entry_id}"
        ),
    }
    hass.states.async_set(entity.entity_id, cleared_state)
    await hass.async_block_till_done()
    assert first not in runtime.episodes
    hass.states.async_set(entity.entity_id, "jammed")
    await hass.async_block_till_done()
    [next_id] = [
        identity
        for identity, episode in runtime.episodes.items()
        if episode["anchor"] == node_id
    ]
    assert next_id != first
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_jam_availability_and_battery_keep_independent_issues(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    lock_entity: tuple[MockConfigEntry, er.RegistryEntry],
) -> None:
    """Device grouping cannot merge a jam with availability or a low battery."""
    owner, entity = lock_entity
    battery = er.async_get(hass).async_get_or_create(
        "sensor", "test", "battery", config_entry=owner, device_id=entity.device_id
    )
    hass.states.async_set(
        battery.entity_id, "5", {"device_class": "battery", "unit_of_measurement": "%"}
    )
    config_data.update(
        notifications=False,
        monitoring_policies=[
            policy(),
            monitoring_policy("battery", {"kind": ["battery"]}, check="battery"),
            *availability_policies(entities=[f"registry:{entity.id}"]),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(entity.entity_id, "jammed")
    await hass.async_block_till_done()
    jam = next(
        identity
        for identity, episode in runtime.episodes.items()
        if runtime.sources[episode["anchor"]].kind == "lock"
    )
    hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 3
    assert jam in runtime.episodes
    assert {
        runtime.sources[episode["anchor"]].kind for episode in runtime.episodes.values()
    } == {"lock", "entity", "battery"}
    assert {
        subject(runtime.sources[episode["anchor"]])
        for episode in runtime.episodes.values()
    } == {f"device:{entity.device_id}"}
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("sending", [False, True])
async def test_overlapping_jams_use_direct_notify_and_consumer_events(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    lock_entity: tuple[MockConfigEntry, er.RegistryEntry],
    sending: bool,
) -> None:
    """Independent policies keep issues and the standard notification request path."""
    _, entity = lock_entity
    destination = er.async_get(hass).async_get_or_create("notify", "test", "messages")
    calls: list[ServiceCall] = []

    @callback
    def receive(call: ServiceCall) -> None:
        calls.append(call)

    hass.services.async_register("notify", "send_message", receive)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        f"notify:{destination.id}"
    ]
    policies = [policy("front_jam"), policy("second_jam")]
    for selected in policies:
        selected["notifications"] = immediate_notification()
    config_data.update(notifications=sending, monitoring_policies=policies)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    facts = async_capture_events(hass, EVENT_EPISODE)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set(entity.entity_id, "jammed")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    assert len([event for event in facts if event.data["change"] == "opened"]) == 2
    assert len(calls) == (1 if sending else 0)
    assert len(events) == (1 if sending else 0)
    if sending:
        assert set(events[0].data["episodes"]) == set(runtime.episodes)
        assert calls[0].data["entity_id"] == destination.entity_id
        assert "jammed" in calls[0].data["message"]
    first, second = runtime.episodes
    await runtime.async_control("acknowledge", {"episode_id": first}, None)
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(first) is not None
    assert runtime.policy.acknowledgment(second) is None
    assert set(runtime.episodes) == {first, second}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_queued_jam_clear_and_recurrence_survive_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    lock_entity: tuple[MockConfigEntry, er.RegistryEntry],
) -> None:
    """Captured states preserve a jam and recovery while the worker is occupied."""
    _, entity = lock_entity
    config_data.update(notifications=False, monitoring_policies=[policy()])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    captured: asyncio.Queue[str] = asyncio.Queue()

    @callback
    def received(event: Event[Any]) -> None:
        if event.data["entity_id"] == entity.entity_id:
            captured.put_nowait(entity.entity_id)

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, received)
    async with runtime._lock:
        for value in ("jammed", "unknown", "locked", "jammed"):
            hass.states.async_set(entity.entity_id, value)
            assert await captured.get() == entity.entity_id
        assert len(runtime._pending) == 4
        assert not runtime.episodes
    cancel()
    await hass.async_block_till_done()
    assert [(event.data["change"], event.data["anchor_kind"]) for event in facts] == [
        ("opened", "lock"),
        ("updated", "lock"),
        ("resolved", "lock"),
        ("opened", "lock"),
    ]
    [current] = runtime.episodes
    assert current != facts[0].data["episode_id"]
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert list(runtime.episodes) == [current]
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("scope", ["area", "label"])
async def test_group_selection_future_locks_exclusions_and_removal(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    lock_entity: tuple[MockConfigEntry, er.RegistryEntry],
    scope: str,
) -> None:
    """Group scopes retain exclusions and treat ending monitoring as removal."""
    owner, first = lock_entity
    group_id = (
        ar.async_get(hass).async_create("Doors").id
        if scope == "area"
        else lr.async_get(hass).async_create("Doors").label_id
    )
    selection = {"area_id": group_id} if scope == "area" else {"labels": {group_id}}
    registry = er.async_get(hass)
    registry.async_update_entity(first.entity_id, **selection)
    future, excluded, disabled = [
        registry.async_get_or_create("lock", "test", key, config_entry=owner)
        for key in ("future", "excluded", "disabled")
    ]
    for entity in (first, excluded, disabled):
        hass.states.async_set(entity.entity_id, "jammed")
    hass.states.async_set(future.entity_id, "unavailable")
    registry.async_update_entity(excluded.entity_id, **selection)
    registry.async_update_entity(
        disabled.entity_id, disabled_by=er.RegistryEntryDisabler.USER, **selection
    )
    selected = policy()
    selected["match"][scope] = [group_id]
    selected["excluded_sources"] = [f"lock:registry:{excluded.id}"]
    config_data.update(notifications=False, monitoring_policies=[selected])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [first_issue] = runtime.episodes
    registry.async_update_entity(future.entity_id, **selection)
    await hass.async_block_till_done()
    future_node = bound_identity(selected, f"lock:registry:{future.id}")
    assert runtime.sources[future_node].watched
    assert list(runtime.episodes) == [first_issue]
    hass.states.async_set(future.entity_id, "jammed")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    registry.async_update_entity(
        first.entity_id, disabled_by=er.RegistryEntryDisabler.USER
    )
    await hass.async_block_till_done()
    assert first_issue not in runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    [remaining] = runtime.episodes
    assert runtime.episodes[remaining]["anchor"] == future_node
    await reload_policies(hass, entry, [])
    runtime = entry.runtime_data
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("deleted_immediate", [False, True])
async def test_published_upgrade_adds_disabled_once_and_preserves_deletion(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    location: str,
    deleted_immediate: bool,
) -> None:
    """A new supplied condition preserves prior choices through repeated upgrades."""
    previous = initial_settings("UTC")
    previous["supplied_policy_introductions"].remove("default_jammed_locks")
    previous["monitoring_policies"] = [
        row
        for row in previous["monitoring_policies"]
        if row["id"] not in {"default_jammed_locks", "default_batteries"}
    ]
    previous["monitoring_policies"][0]["name"] = "Edited integration policy"
    if deleted_immediate:
        previous["notification_definitions"]["profiles"].pop("immediate")
        for row in previous["monitoring_policies"]:
            row["notifications"] = [
                item for item in row["notifications"] if item["profile"] != "immediate"
            ]
    previous.update(notifications=True, timings=config_data["timings"])
    before = deepcopy(previous)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=previous if location == "data" else {},
        options=previous if location == "options" else {},
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    await start_monitor(hass, entry)
    saved = deepcopy(dict(entry.data))
    assert saved["monitoring_policies"][:-1] == before["monitoring_policies"]
    added = saved["monitoring_policies"][-1]
    assert added["id"] == "default_jammed_locks"
    assert added["enabled"] is False
    assert added["notifications"] == (
        [] if deleted_immediate else [{"id": "default", "profile": "immediate"}]
    )
    assert {
        key: value
        for key, value in saved.items()
        if key not in {"monitoring_policies", "supplied_policy_introductions"}
    } == {
        key: value
        for key, value in before.items()
        if key not in {"monitoring_policies", "supplied_policy_introductions"}
    }
    saved["monitoring_policies"].pop()
    hass.config_entries.async_update_entry(entry, options=saved)
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert not any(
            row.id == "default_jammed_locks"
            for row in entry.runtime_data.settings.monitoring_policies
        )
    assert not events
    assert await hass.config_entries.async_unload(entry.entry_id)
