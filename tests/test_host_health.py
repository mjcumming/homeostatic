"""Host-health trial timelines and source evidence boundaries."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, ServiceCall, State, callback
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.const import (
    DOMAIN,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
)
from custom_components.homeostatic.host_health import (
    HostCondition,
    HostHealthMonitor,
    HostHealthParameters,
)
from tests.policy_helpers import immediate_notification, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import advance

NOW = datetime(2026, 10, 26, tzinfo=UTC)


@pytest.mark.parametrize(
    ("condition", "threshold", "recovery", "bad", "border", "good", "unit"),
    [
        ("storage", 5, 6, 4, 5, 7, "GiB"),
        ("memory", 5, 2, 6, 5, 1, "%"),
        ("io", 5, 2, 6, 5, 1, "%"),
        ("cpu", 20, 10, 21, 20, 9, "%"),
    ],
)
def test_problem_recovery_restart_and_gaps(
    condition: HostCondition,
    threshold: float,
    recovery: float,
    bad: float,
    border: float,
    good: float,
    unit: str,
) -> None:
    """Qualify continuously, hold through gaps, and recover only after the wait."""
    params = HostHealthParameters(
        condition=condition,
        threshold=threshold,
        recovery=recovery,
        duration_seconds=60,
        recovery_seconds=30,
    )
    monitor = HostHealthMonitor(node_id="source", name="Host", parameters=params)

    def read(value: float, second: int):
        return monitor.evaluate(
            State("sensor.host", str(value), {"unit_of_measurement": unit}),
            NOW + timedelta(seconds=second),
        )

    assert read(bad, 0).observation.status == Status.PASS
    assert read(border, 59).observation.status == Status.PASS
    assert read(bad, 60).next_deadline == NOW + timedelta(seconds=120)
    assert read(bad, 120).observation.status == Status.WARN
    assert (
        monitor.evaluate(None, NOW + timedelta(seconds=130)).observation.status
        == Status.UNKNOWN
    )
    saved = monitor.snapshot()
    monitor = HostHealthMonitor(node_id="source", name="Host", parameters=params)
    monitor.restore(saved)
    assert read(good, 140).observation.status == Status.WARN
    assert read(recovery, 160).observation.status == Status.WARN
    assert read(good, 170).next_deadline == NOW + timedelta(seconds=200)
    assert read(good, 200).observation.status == Status.PASS
    assert read(bad, 201).observation.status == Status.PASS


@pytest.mark.parametrize("value", ["unknown", "unavailable", "nan", "inf", "-1", "101"])
def test_invalid_pressure_is_unknown(value: str) -> None:
    """Invalid readings cannot establish failure or recovery."""
    monitor = HostHealthMonitor(
        node_id="source",
        name="Host",
        parameters=HostHealthParameters(
            condition="cpu",
            threshold=20,
            recovery=10,
            duration_seconds=0,
            recovery_seconds=0,
        ),
    )
    result = monitor.evaluate(
        State("sensor.host", value, {"unit_of_measurement": "%"}), NOW
    )
    assert result.observation.status == Status.UNKNOWN


def test_pending_gap_discards_elapsed_time() -> None:
    """A missing or restored value cannot advance pending qualification."""
    monitor = HostHealthMonitor(
        node_id="source",
        name="Host",
        parameters=HostHealthParameters(
            condition="storage",
            threshold=5,
            recovery=6,
            duration_seconds=60,
            recovery_seconds=30,
        ),
    )
    bad = State("sensor.host", "4", {"unit_of_measurement": "GiB"})
    monitor.evaluate(bad, NOW)
    restored = State(
        "sensor.host", "4", {"unit_of_measurement": "GiB", "restored": True}
    )
    assert (
        monitor.evaluate(restored, NOW + timedelta(seconds=59)).observation.status
        == Status.UNKNOWN
    )
    assert monitor.evaluate(
        bad, NOW + timedelta(seconds=60)
    ).next_deadline == NOW + timedelta(seconds=120)


@pytest.mark.parametrize(
    "changes",
    [
        {"threshold": True},
        {"threshold": float("nan")},
        {"threshold": 101},
        {"recovery": 20},
        {"duration_seconds": -1},
        {"recovery_seconds": 1.5},
    ],
)
def test_invalid_detection_settings_are_rejected(changes: dict[str, Any]) -> None:
    """Incomplete or inconsistent detection settings cannot become a policy."""
    values = {
        "threshold": 20,
        "recovery": 10,
        "duration_seconds": 60,
        "recovery_seconds": 30,
    }
    values.update(changes)
    with pytest.raises(ValueError):
        HostHealthParameters.from_data("cpu", values)


def test_invalid_saved_monitor_is_rejected() -> None:
    """Corrupt retained state cannot be mistaken for a recovered condition."""
    monitor = HostHealthMonitor(
        node_id="source",
        name="Host",
        parameters=HostHealthParameters(
            condition="cpu",
            threshold=20,
            recovery=10,
            duration_seconds=60,
            recovery_seconds=30,
        ),
    )
    with pytest.raises(ValueError):
        monitor.restore({"active": "yes"})


async def test_selected_sensor_runtime_and_reload(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A real HA registry signal opens, survives reload and recovers after its wait."""
    owner = MockConfigEntry(domain="systemmonitor", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    sensor = registry.async_get_or_create(
        "sensor",
        "systemmonitor",
        "memory_pressure_full_avg300",
        config_entry=owner,
        translation_key="memory_pressure_full_avg300",
    )
    hass.states.async_set(sensor.entity_id, "8", {"unit_of_measurement": "%"})
    policy = monitoring_policy(
        "host_memory",
        {"kind": ["entity"], "entity": [f"registry:{sensor.id}"]},
        check="host_memory",
        parameters={
            "threshold": 5,
            "recovery": 2,
            "duration_seconds": 60,
            "recovery_seconds": 30,
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN, data={**config_data, "monitoring_policies": [policy]}
    )
    runtime = await start_monitor(hass, entry)
    assert not runtime.episodes
    await advance(hass, freezer, 60)
    assert len(runtime.episodes) == 1
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [episode_id]
    hass.states.async_set(sensor.entity_id, "1", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    await advance(hass, freezer, 30)
    assert not runtime.episodes


@pytest.mark.parametrize("sending", [False, True])
async def test_notification_paths_use_only_mocked_services(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    sending: bool,
    freezer: FrozenDateTimeFactory,
) -> None:
    """A selected host condition requests direct and consumer delivery only when enabled."""
    owner = MockConfigEntry(domain="systemmonitor", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    sensor = registry.async_get_or_create(
        "sensor",
        "systemmonitor",
        "cpu_pressure_some_avg300",
        config_entry=owner,
        translation_key="cpu_pressure_some_avg300",
    )
    destination = registry.async_get_or_create("notify", "test", "host_messages")
    calls: list[ServiceCall] = []

    @callback
    def receive(call: ServiceCall) -> None:
        calls.append(call)

    hass.services.async_register("notify", "send_message", receive)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        f"notify:{destination.id}"
    ]
    policy = monitoring_policy(
        "host_cpu",
        {"kind": ["entity"], "entity": [f"registry:{sensor.id}"]},
        check="host_cpu",
        parameters={
            "threshold": 20,
            "recovery": 10,
            "duration_seconds": 0,
            "recovery_seconds": 0,
        },
        notifications=immediate_notification(),
    )
    config_data.update(notifications=sending, monitoring_policies=[policy])
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    hass.states.async_set(sensor.entity_id, "30", {"unit_of_measurement": "%"})
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    assert len(calls) == len(events) == int(sending)
    if sending:
        assert calls[0].data["entity_id"] == destination.entity_id
    hass.states.async_set(sensor.entity_id, "unknown", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    await advance(hass, freezer, 31)
    assert len(runtime.episodes) == 1
    assert len(calls) == len(events) == int(sending)


async def test_queued_host_reports_keep_their_order(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A blocked worker observes each captured report in the order HA supplied it."""
    owner = MockConfigEntry(domain="systemmonitor", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    sensor = er.async_get(hass).async_get_or_create(
        "sensor",
        "systemmonitor",
        "memory_pressure_full_avg300",
        config_entry=owner,
        translation_key="memory_pressure_full_avg300",
    )
    policy = monitoring_policy(
        "host_memory",
        {"kind": ["entity"], "entity": [f"registry:{sensor.id}"]},
        check="host_memory",
        parameters={
            "threshold": 5,
            "recovery": 2,
            "duration_seconds": 0,
            "recovery_seconds": 0,
        },
    )
    config_data.update(notifications=False, monitoring_policies=[policy])
    hass.states.async_set(sensor.entity_id, "0", {"unit_of_measurement": "%"})
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    events = async_capture_events(hass, EVENT_EPISODE)
    captured: asyncio.Queue[str] = asyncio.Queue()

    @callback
    def received(event: Event[Any]) -> None:
        if event.data["entity_id"] == sensor.entity_id:
            captured.put_nowait(sensor.entity_id)

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, received)
    async with runtime._lock:
        for value in ("8", "unknown", "0", "8"):
            hass.states.async_set(sensor.entity_id, value, {"unit_of_measurement": "%"})
            await captured.get()
        assert len(runtime._pending) == 4
    cancel()
    await hass.async_block_till_done()
    assert [event.data["change"] for event in events] == [
        "opened",
        "updated",
        "resolved",
        "opened",
    ]
    [current] = runtime.episodes
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert list(entry.runtime_data.episodes) == [current]


async def test_host_outbox_replays_the_same_delivery_identity(
    hass: HomeAssistant, config_data: dict[str, Any], hass_storage: dict[str, Any]
) -> None:
    """Reload a qualified host issue and its queued delivery without a new identity."""
    owner = MockConfigEntry(domain="systemmonitor", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    sensor = er.async_get(hass).async_get_or_create(
        "sensor",
        "systemmonitor",
        "cpu_pressure_some_avg300",
        config_entry=owner,
        translation_key="cpu_pressure_some_avg300",
    )
    policy = monitoring_policy(
        "host_cpu",
        {"kind": ["entity"], "entity": [f"registry:{sensor.id}"]},
        check="host_cpu",
        parameters={
            "threshold": 20,
            "recovery": 10,
            "duration_seconds": 0,
            "recovery_seconds": 0,
        },
        notifications=immediate_notification(),
    )
    config_data.update(notifications=True, monitoring_policies=[policy])
    hass.states.async_set(sensor.entity_id, "30", {"unit_of_measurement": "%"})
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [message] = runtime.notifications.delivery.messages.values()
    pending = deepcopy(message)
    pending["delivery_id"] = f"{entry.entry_id}:host-pending"
    assert await hass.config_entries.async_unload(entry.entry_id)
    stored = hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"]
    stored["delivery"]["outbox"] = [pending]
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    for _ in range(2):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert runtime.notifications.delivery.outbox == []
        assert await hass.config_entries.async_unload(entry.entry_id)
    replayed = [
        event.data
        for event in events
        if event.data["delivery_id"] == pending["delivery_id"]
    ]
    assert len(replayed) == 1
    assert replayed[0]["episode_id"] == pending["episode_id"]
