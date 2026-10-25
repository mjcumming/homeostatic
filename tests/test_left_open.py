"""Reported openings use fresh countdowns and stop attention at monitoring expiry."""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import Status
from homeassistant.core import HomeAssistant, State
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.left_open import (
    LeftOpenMonitor,
    LeftOpenParameters,
    LeftOpenResult,
    monitoring_window,
    temperature_value,
)
from tests.policy_helpers import immediate_notification, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import advance, reload_policies

NOW = datetime(2026, 10, 25, 22, tzinfo=UTC)


def monitor(**parameters: Any) -> LeftOpenMonitor:
    """Build a detector with explicit five-minute qualification."""
    return LeftOpenMonitor(
        node_id="opening",
        name="Patio door",
        parameters=LeftOpenParameters.from_data(
            {"duration_seconds": 300, **parameters}
        ),
    )


def contact(value: str = "on", **attributes: Any) -> State:
    """Represent the contact's current report without physical-freshness claims."""
    return State("binary_sensor.patio", value, attributes)


def temperature(value: str = "43", **attributes: Any) -> State:
    """Provide an explicit sensor value and unit."""
    return State(
        "sensor.outdoor",
        value,
        {"device_class": "temperature", "unit_of_measurement": "°F", **attributes},
    )


@pytest.mark.parametrize(
    "parameters",
    [
        {"duration_seconds": -1},
        {"duration_seconds": True},
        {"duration_seconds": 1.5},
        {"start": "22:00"},
        {"start": "07:00", "end": "07:00"},
        {"start": "25:00", "end": "07:00"},
        {"unit": []},
        {"use_temperature": True},
        {"minimum": float("inf")},
        {"minimum": 60, "maximum": 50},
        {"unexpected": 1},
    ],
)
def test_invalid_parameters(parameters: dict[str, Any]) -> None:
    """Invalid settings cannot become an enabled detector."""
    with pytest.raises(ValueError):
        monitor(**parameters)


def test_continuity_temperature_and_recovery() -> None:
    """Temperature cancels an unfinished countdown but never clears a qualified issue."""
    detector = monitor(
        use_temperature=True, temperature_source="entity_id:sensor.outdoor", minimum=50
    )

    def evaluate(
        seconds: int, state: str = "on", outdoor: str = "43"
    ) -> LeftOpenResult:
        """Advance only the explicit observation time."""
        return detector.evaluate(
            contact(state),
            temperature(outdoor),
            NOW + timedelta(seconds=seconds),
            timezone="UTC",
        )

    assert evaluate(0).observation.reason == "left_open_waiting"
    assert evaluate(200, outdoor="55").observation.status is Status.PASS
    assert evaluate(300).observation.reason == "left_open_waiting"
    assert evaluate(599).observation.status is Status.PASS
    assert evaluate(600).observation.status is Status.FAIL
    assert evaluate(700, outdoor="55").observation.status is Status.FAIL
    assert evaluate(800, state="unavailable").observation.status is Status.UNKNOWN
    assert evaluate(900, outdoor="unavailable").observation.status is Status.FAIL
    assert (
        evaluate(1000, state="off", outdoor="unavailable").observation.status
        is Status.PASS
    )
    assert not detector.qualified


@pytest.mark.parametrize(
    "bounds,value,qualifies",
    [
        ({"minimum": 45}, 44, True),
        ({"minimum": 45}, 45, False),
        ({"maximum": 90}, 91, True),
        ({"maximum": 90}, 90, False),
        ({"minimum": 45, "maximum": 90}, 44, True),
        ({"minimum": 45, "maximum": 90}, 91, True),
        ({"minimum": 45, "maximum": 90}, 70, False),
    ],
)
def test_temperature_bounds_are_strict(
    bounds: dict[str, int], value: int, qualifies: bool
) -> None:
    """Either selected bound can qualify; equality and the interior are in range."""
    detector = monitor(
        duration_seconds=0,
        use_temperature=True,
        temperature_source="entity_id:sensor.outdoor",
        **bounds,
    )
    result = detector.evaluate(contact(), temperature(str(value)), NOW, timezone="UTC")
    assert (result.observation.status is Status.FAIL) is qualifies


@pytest.mark.parametrize(
    "state",
    [
        None,
        contact("off", restored=True),
        contact("unknown"),
        contact("unavailable"),
        contact("open"),
    ],
)
def test_contact_gap_restarts_pending_interval(state: State | None) -> None:
    """A gap cannot qualify or resolve an opening and resets unfinished credit."""
    detector = monitor()
    detector.evaluate(contact(), None, NOW, timezone="UTC")
    assert (
        detector.evaluate(
            state, None, NOW + timedelta(seconds=200), timezone="UTC"
        ).observation.status
        is Status.UNKNOWN
    )
    assert (
        detector.evaluate(
            contact(), None, NOW + timedelta(seconds=400), timezone="UTC"
        ).observation.reason
        == "left_open_waiting"
    )
    assert (
        detector.evaluate(
            contact(), None, NOW + timedelta(seconds=700), timezone="UTC"
        ).observation.status
        is Status.FAIL
    )


def test_window_start_end_and_restore() -> None:
    """Time outside hours receives no credit and expiry ends rather than recovers."""
    detector = monitor(start="22:00", end="23:00")
    assert (
        detector.evaluate(
            contact(), None, NOW - timedelta(seconds=1), timezone="UTC"
        ).observation.reason
        == "left_open_outside_hours"
    )
    assert detector.evaluate(
        contact(), None, NOW, timezone="UTC"
    ).next_deadline == NOW + timedelta(seconds=300)
    snapshot = detector.snapshot()
    pending = monitor(start="22:00", end="23:00")
    pending.restore(snapshot)
    assert pending.evaluate(
        contact(), None, NOW + timedelta(seconds=299), timezone="UTC"
    ).next_deadline == NOW + timedelta(seconds=599)
    assert (
        detector.evaluate(
            contact(), None, NOW + timedelta(seconds=300), timezone="UTC"
        ).observation.status
        is Status.FAIL
    )
    restored = monitor(start="22:00", end="23:00")
    restored.restore(detector.snapshot())
    assert (
        restored.evaluate(
            contact(), None, NOW + timedelta(seconds=301), timezone="UTC"
        ).observation.status
        is Status.FAIL
    )
    expired = restored.evaluate(
        contact(), None, NOW + timedelta(hours=1), timezone="UTC"
    )
    assert expired.removed and expired.observation.reason == "left_open_outside_hours"
    next_window = restored.evaluate(
        contact(), None, NOW + timedelta(days=1), timezone="UTC"
    )
    assert next_window.observation.reason == "left_open_waiting"
    assert next_window.next_deadline == NOW + timedelta(days=1, seconds=300)


def test_window_end_takes_precedence_over_qualification() -> None:
    """An exact deadline at the excluded end cannot open an issue."""
    detector = monitor(duration_seconds=3600, start="22:00", end="23:00")
    detector.evaluate(contact(), None, NOW, timezone="UTC")
    result = detector.evaluate(
        contact(), None, NOW + timedelta(hours=1), timezone="UTC"
    )
    assert result.removed and not detector.qualified
    assert result.observation.status is Status.PASS


def test_daylight_saving_boundaries() -> None:
    """A nonexistent local start is skipped and a repeated start is used once."""
    params = LeftOpenParameters.from_data(
        {"duration_seconds": 0, "start": "02:30", "end": "04:00"}
    )
    assert (
        monitoring_window(
            params, datetime(2026, 3, 8, 8, 45, tzinfo=UTC), "America/Chicago"
        )[0]
        is None
    )
    params = LeftOpenParameters.from_data(
        {"duration_seconds": 0, "start": "01:15", "end": "01:45"}
    )
    assert (
        monitoring_window(
            params, datetime(2026, 11, 1, 6, 20, tzinfo=UTC), "America/Chicago"
        )[0]
        is not None
    )
    assert (
        monitoring_window(
            params, datetime(2026, 11, 1, 7, 20, tzinfo=UTC), "America/Chicago"
        )[0]
        is None
    )


@pytest.mark.parametrize(
    "state,expected",
    [
        (temperature("32"), 0),
        (
            State(
                "weather.home", "cloudy", {"temperature": 32, "temperature_unit": "°F"}
            ),
            0,
        ),
        (
            State(
                "weather.home",
                "cloudy",
                {"apparent_temperature": 32, "temperature_unit": "°F"},
            ),
            None,
        ),
        (
            State(
                "weather.home",
                "unavailable",
                {"temperature": 32, "temperature_unit": "°F"},
            ),
            None,
        ),
        (temperature("nan"), None),
        (temperature("43", restored=True), None),
        (State("sensor.other", "43", {"unit_of_measurement": "°F"}), None),
        (State("climate.other", "43", {"unit_of_measurement": "°F"}), None),
    ],
)
def test_temperature_sources(state: State, expected: float | None) -> None:
    """Sensor and weather units are explicit and cached invalid states are unusable."""
    assert temperature_value(state, "°C") == expected


def opening_policy(**parameters: Any) -> dict[str, Any]:
    """Select one state-only contact through the ordinary named-policy model."""
    return monitoring_policy(
        "openings",
        {"kind": ["entity"], "entity": ["entity_id:binary_sensor.patio"]},
        check="left_open",
        parameters={
            "duration_seconds": 60,
            "start": "22:00",
            "end": "23:00",
            **parameters,
        },
        notifications=immediate_notification(),
    )


async def test_runtime_window_expiry_and_next_window(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Real HA events and the shared timer stop issues and requests at the cutoff."""
    freezer.move_to(NOW - timedelta(seconds=10))
    await hass.config.async_set_time_zone("UTC")
    hass.states.async_set("binary_sensor.patio", "on", {"device_class": "door"})
    config_data.update(monitoring_policies=[opening_policy()])
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.episodes
    await advance(hass, freezer, 10)
    assert not runtime.episodes
    await advance(hass, freezer, 60)
    [first] = runtime.episodes
    assert any(not event.data.get("silent") for event in events)
    before = len(events)
    await advance(hass, freezer, 3540)
    assert not runtime.episodes
    assert all(event.data.get("silent") for event in events[before:])
    [record] = runtime.history.snapshot()["episodes"]
    assert record["resolution"] == "removed"
    assert (
        record["episode"]["annotations"]["homeostatic_end_reason"]
        == "monitoring_window_ended"
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.episodes
    before = len(events)
    await advance(hass, freezer, 23 * 3600)
    assert not runtime.episodes
    await advance(hass, freezer, 60)
    [second] = runtime.episodes
    assert second != first
    assert any(not event.data.get("silent") for event in events[before:])
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_cutoff_blocks_a_transport_already_queued_before_timer_runs(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A queued request checks the actual clock before each transport release."""
    freezer.move_to(NOW)
    await hass.config.async_set_time_zone("UTC")
    hass.states.async_set("binary_sensor.patio", "off", {"device_class": "door"})
    config_data.update(
        monitoring_policies=[opening_policy(duration_seconds=0, end="22:01")]
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with monkeypatch.context() as held:
        held.setattr(runtime, "async_send_notification", AsyncMock())
        hass.states.async_set("binary_sensor.patio", "on", {"device_class": "door"})
        await hass.async_block_till_done()
    [payload] = runtime.notifications._resolved_requests.values()
    assert runtime.episodes
    send = AsyncMock()
    monkeypatch.setattr(runtime.notifications, "async_send", send)
    freezer.move_to(NOW + timedelta(minutes=1))
    await runtime.async_send_notification(dict(payload))
    send.assert_not_awaited()
    await advance(hass, freezer, 0)
    assert not runtime.episodes
    assert all(
        call.args[0].request.payload.get("silent") for call in send.await_args_list
    )
    send.reset_mock()
    await runtime.async_send_notification(dict(payload))
    send.assert_not_awaited()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_window_end_cancels_delayed_collection(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A collection deadline at window end cannot release a queued alert."""
    freezer.move_to(NOW)
    await hass.config.async_set_time_zone("UTC")
    hass.states.async_set("binary_sensor.patio", "on", {"device_class": "window"})
    policy = opening_policy(duration_seconds=0, end="22:01")
    policy["notifications"] = [{"id": "delayed", "profile": "immediate"}]
    definitions = config_data["notification_definitions"]
    definitions["profiles"]["immediate"]["methods"] = ["test"]
    definitions["profiles"]["immediate"]["timing"]["collection_delay_seconds"] = 60
    config_data.update(monitoring_policies=[policy])
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.episodes and not events
    await advance(hass, freezer, 60)
    assert not runtime.episodes
    assert not [event for event in events if not event.data.get("silent")]
    await advance(hass, freezer, 3600)
    assert not runtime.episodes
    assert not [event for event in events if not event.data.get("silent")]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_qualified_reload_and_expired_offline_window(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Reload retains a qualified issue, then ends an expired window before replay."""
    freezer.move_to(NOW)
    await hass.config.async_set_time_zone("UTC")
    hass.states.async_set("binary_sensor.patio", "on", {"device_class": "door"})
    config_data.update(monitoring_policies=[opening_policy(duration_seconds=0)])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [identity] = runtime.episodes
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert list(runtime.episodes) == [identity]
        assert next(iter(runtime.producers.left_open_monitors.values())).qualified
    assert await hass.config_entries.async_unload(entry.entry_id)

    freezer.move_to(NOW + timedelta(hours=2))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.episodes
    assert runtime.history.window_ended(identity)
    assert not [event for event in events if not event.data.get("silent")]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_overlap_rename_detection_and_removal(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Independent policies retain identity on rename and replace it on detection edits."""
    freezer.move_to(NOW)
    await hass.config.async_set_time_zone("UTC")
    hass.states.async_set("binary_sensor.patio", "on", {"device_class": "door"})
    first = opening_policy(duration_seconds=0)
    second = {**opening_policy(duration_seconds=0), "id": "second"}
    config_data.update(notifications=False, monitoring_policies=[first, second])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    original = set(runtime.episodes)
    assert len(original) == 2
    renamed = {**first, "name": "Renamed opening policy"}
    await reload_policies(hass, entry, [renamed, second])
    assert set(entry.runtime_data.episodes) == original
    changed = {
        **renamed,
        "parameters": {**renamed["parameters"], "duration_seconds": 60},
    }
    await reload_policies(hass, entry, [changed, second])
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    [survivor] = runtime.episodes
    assert survivor in original
    await advance(hass, freezer, 60)
    assert len(runtime.episodes) == 2
    assert len(original.intersection(runtime.episodes)) == 1
    await reload_policies(hass, entry, [changed])
    assert survivor not in entry.runtime_data.episodes
    await reload_policies(hass, entry, [{**changed, "enabled": False}])
    assert not entry.runtime_data.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
