"""Executable temperature policy timelines and invalid evidence boundaries."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from health_tree.types import Status
from homeassistant.core import State

from custom_components.homeostatic.temperature import (
    TemperatureLimitParameters,
    TemperatureMonitor,
    ThermostatParameters,
)

NOW = datetime(2026, 10, 12, tzinfo=UTC)
SCENARIOS = yaml.safe_load(
    (Path(__file__).parent / "fixtures" / "temperature.yaml").read_text(
        encoding="utf-8"
    )
)


def _monitor(kind: str, parameters: dict[str, Any]) -> TemperatureMonitor:
    return TemperatureMonitor(
        node_id="temperature:policy:source",
        check_id=kind,
        name="Room",
        parameters=(
            ThermostatParameters.from_data(parameters)
            if kind == "thermostat"
            else TemperatureLimitParameters.from_data(parameters)
        ),
    )


def _run_scenario(scenario: dict[str, Any]) -> None:
    monitor = _monitor(scenario["kind"], scenario["parameters"])
    for step in scenario["steps"]:
        if step.get("restart"):
            saved = monitor.snapshot()
            monitor = _monitor(scenario["kind"], scenario["parameters"])
            monitor.restore(saved)
        unit = step.get("unit", "°F")
        state = (
            State(
                step.get("entity_id", "climate.room"),
                step.get("mode", "heat"),
                {
                    "current_temperature": step["value"],
                    "temperature": step.get("target", 70),
                    "target_temp_low": step.get("low"),
                    "target_temp_high": step.get("high"),
                    "hvac_action": step.get("action"),
                },
            )
            if scenario["kind"] == "thermostat"
            else State(
                step.get("entity_id", "sensor.room"),
                str(step["value"]),
                {"unit_of_measurement": unit},
            )
        )
        result = monitor.evaluate(
            state, NOW + timedelta(seconds=step["at"]), climate_unit=unit
        )
        assert result.removed == step.get("removed", False), step
        if result.removed:
            assert result.observation is None
        else:
            assert result.observation is not None
            assert result.observation.status.value == step["status"], step
            assert result.observation.reason == step["reason"], step
        assert result.next_deadline == (
            NOW + timedelta(seconds=step["deadline"]) if "deadline" in step else None
        ), step


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[item["id"] for item in SCENARIOS])
def test_temperature_scenario(scenario: dict[str, Any]) -> None:
    """Run each specified sequence against the same bounded producer."""
    _run_scenario(scenario)


@pytest.mark.parametrize(
    "state",
    [
        pytest.param(None, id="missing"),
        pytest.param(State("sensor.room", "unknown"), id="unknown"),
        pytest.param(State("sensor.room", "unavailable"), id="unavailable"),
        pytest.param(State("sensor.room", "42", {"restored": True}), id="restored"),
        pytest.param(
            State("sensor.room", "nan", {"unit_of_measurement": "°F"}), id="nan"
        ),
        pytest.param(
            State("sensor.room", "inf", {"unit_of_measurement": "°F"}), id="infinite"
        ),
        pytest.param(
            State("sensor.room", "bad", {"unit_of_measurement": "°F"}), id="nonnumeric"
        ),
        pytest.param(
            State("sensor.room", "42", {"unit_of_measurement": "%"}), id="wrong-unit"
        ),
    ],
)
def test_missing_readings_preserve_open_condition(state: State | None) -> None:
    """Missing readings neither clear a finding nor construct a trend."""
    monitor = _monitor("limit", {"unit": "°F", "minimum": 40, "duration_seconds": 0})
    monitor.evaluate(State("sensor.room", "39", {"unit_of_measurement": "°F"}), NOW)
    result = monitor.evaluate(state, NOW + timedelta(seconds=1))
    assert result.observation is not None
    assert result.observation.status == Status.UNKNOWN
    assert monitor.snapshot() == {"active_reason": "temperature_low"}
    assert result.next_deadline is None


@pytest.mark.parametrize(
    "parameters",
    [
        pytest.param({"unit": "°F", "duration_seconds": 0}, id="no-bounds"),
        pytest.param({"unit": "°F", "minimum": 0}, id="no-duration"),
        pytest.param(
            {"unit": "°F", "minimum": 2, "maximum": 1, "duration_seconds": 0},
            id="reversed",
        ),
        pytest.param({"unit": "%", "minimum": 0, "duration_seconds": 0}, id="unit"),
        pytest.param(
            {"unit": "°F", "minimum": float("nan"), "duration_seconds": 0}, id="nan"
        ),
        pytest.param(
            {"unit": "°F", "minimum": 10**1000, "duration_seconds": 0}, id="overflow"
        ),
        pytest.param(
            {"unit": "°F", "minimum": True, "duration_seconds": 0}, id="boolean"
        ),
        pytest.param(
            {"unit": "°F", "minimum": 0, "duration_seconds": True},
            id="boolean-duration",
        ),
        pytest.param(
            {"unit": "°F", "minimum": 0, "duration_seconds": -1}, id="negative-duration"
        ),
        pytest.param({"bogus": 1}, id="unknown-field"),
    ],
)
def test_invalid_limit_parameters(parameters: dict[str, Any]) -> None:
    """Invalid policies fail before monitoring starts."""
    with pytest.raises(ValueError):
        TemperatureLimitParameters.from_data(parameters)


@pytest.mark.parametrize(
    "parameters",
    [
        pytest.param({"margin": -1}, id="negative-margin"),
        pytest.param({"progress": 0}, id="zero-progress"),
        pytest.param({"progress": 0.00000001}, id="unrepresentable-progress"),
        pytest.param({"worsening": 0}, id="zero-worsening"),
        pytest.param({"progress_seconds": 0}, id="zero-duration"),
        pytest.param({"progress_seconds": 31536001}, id="unbounded-duration"),
        pytest.param({"unit": "%"}, id="unit"),
        pytest.param({"bogus": 1}, id="unknown-field"),
    ],
)
def test_invalid_thermostat_parameters(parameters: dict[str, Any]) -> None:
    """Unusable progress policies fail before monitoring starts."""
    with pytest.raises(ValueError):
        ThermostatParameters.from_data(parameters)


def test_restart_rejects_invalid_state() -> None:
    """Malformed stored state cannot manufacture a recovered condition."""
    monitor = _monitor("thermostat", {})
    with pytest.raises(ValueError):
        monitor.restore({"active_reason": "made_up"})


def test_naive_time_rejected() -> None:
    """The adapter boundary must supply UTC time."""
    monitor = _monitor("thermostat", {})
    with pytest.raises(ValueError):
        monitor.evaluate(None, datetime(2026, 10, 12))


@pytest.mark.parametrize(
    ("mode", "attributes"),
    [
        pytest.param("heat", {}, id="missing-temperature"),
        pytest.param("heat", {"current_temperature": 65}, id="missing-target"),
        pytest.param(
            "heat",
            {"current_temperature": True, "temperature": 70},
            id="boolean-temperature",
        ),
        pytest.param(
            "heat",
            {"current_temperature": 65, "temperature": float("inf")},
            id="infinite-target",
        ),
        pytest.param(
            "heat",
            {"current_temperature": 65, "temperature": 70, "restored": True},
            id="restored-climate",
        ),
        pytest.param(
            "heat_cool",
            {"current_temperature": 65, "target_temp_low": 72, "target_temp_high": 68},
            id="reversed-range",
        ),
    ],
)
def test_unusable_climate_evidence(mode: str, attributes: dict[str, Any]) -> None:
    """Incomplete climate reports cannot qualify a thermostat failure."""
    result = _monitor("thermostat", {}).evaluate(
        State("climate.room", mode, attributes), NOW, climate_unit="°F"
    )
    assert result.observation is not None
    assert result.observation.status == Status.UNKNOWN
    assert result.removed is False


@pytest.mark.parametrize(
    "saved", [{"active_reason": []}, {}, {"active_reason": None, "other": 1}]
)
def test_invalid_snapshot_shape(saved: dict[str, Any]) -> None:
    """Reject malformed producer persistence before changing state."""
    with pytest.raises(ValueError):
        _monitor(
            "limit", {"unit": "°F", "minimum": 40, "duration_seconds": 10}
        ).restore(saved)


def test_celsius_defaults_preserve_fahrenheit_difference() -> None:
    """Selecting a display unit cannot change the default policy's tolerance."""
    parameters = ThermostatParameters.from_data({"unit": "°C"})
    assert parameters.margin == pytest.approx(10 / 9)
    assert parameters.progress == pytest.approx(10 / 9)
    assert parameters.worsening == pytest.approx(10 / 9)
