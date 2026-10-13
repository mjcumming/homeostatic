"""Bounded temperature qualification from current Home Assistant reports."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from health_tree.types import JSONValue, Observation, Status
from homeassistant.core import State

_UNITS = {"°C", "°F", "K"}


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("Provide a finite number")
    try:
        number = float(value)
    except OverflowError as err:
        raise ValueError("Provide a finite number") from err
    if not math.isfinite(number):
        raise ValueError("Provide a finite number")
    return number


def _unit(value: object) -> str:
    if not isinstance(value, str) or value not in _UNITS:
        raise ValueError("Choose °C, °F or K")
    return value


def _seconds(value: object, *, zero: bool) -> int:
    if type(value) is not int or not (0 if zero else 1) <= value <= 31536000:
        raise ValueError("Choose a duration in seconds up to 365 days")
    return value


def _celsius(value: object, unit: str, *, difference: bool = False) -> float:
    number = _number(value)
    _unit(unit)
    if unit == "°F":
        number = (number - (0 if difference else 32)) * (5 / 9)
    elif unit == "K" and not difference:
        number -= 273.15
    return round(number, 6)


@dataclass(frozen=True, slots=True, kw_only=True)
class TemperatureLimitParameters:
    """Owner-selected inclusive bounds and continuous qualification duration."""

    unit: str
    duration_seconds: int
    minimum: float | None = None
    maximum: float | None = None

    def __post_init__(self) -> None:
        """Reject incomplete and ambiguous bounds before activating monitoring."""
        _unit(self.unit)
        _seconds(self.duration_seconds, zero=True)
        if self.minimum is None and self.maximum is None:
            raise ValueError("Select a minimum, maximum or both")
        for value in (self.minimum, self.maximum):
            if value is not None:
                _number(value)
        if (
            self.minimum is not None
            and self.maximum is not None
            and self.minimum > self.maximum
        ):
            raise ValueError("Minimum must not exceed maximum")

    @classmethod
    def from_data(cls, data: Mapping[str, object]) -> TemperatureLimitParameters:
        """Validate a saved or draft temperature-limit parameter object."""
        if data.keys() - {"unit", "duration_seconds", "minimum", "maximum"}:
            raise ValueError("Unknown temperature-limit parameter")
        return cls(
            unit=_unit(data.get("unit")),
            duration_seconds=_seconds(data.get("duration_seconds"), zero=True),
            minimum=_number(data["minimum"])
            if data.get("minimum") is not None
            else None,
            maximum=_number(data["maximum"])
            if data.get("maximum") is not None
            else None,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ThermostatParameters:
    """Configured temperature differences and progress interval."""

    unit: str = "°F"
    margin: float = 2
    progress: float = 2
    worsening: float = 2
    progress_seconds: int = 3600

    def __post_init__(self) -> None:
        """Require positive progress and worsening thresholds."""
        _unit(self.unit)
        _seconds(self.progress_seconds, zero=False)
        if _number(self.margin) < 0:
            raise ValueError("The permitted margin cannot be negative")
        if (
            _celsius(self.progress, self.unit, difference=True) <= 0
            or _celsius(self.worsening, self.unit, difference=True) <= 0
        ):
            raise ValueError("Progress and worsening must be positive")

    @classmethod
    def from_data(cls, data: Mapping[str, object]) -> ThermostatParameters:
        """Validate thermostat settings using the agreed Fahrenheit defaults."""
        if data.keys() - {
            "unit",
            "margin",
            "progress",
            "worsening",
            "progress_seconds",
        }:
            raise ValueError("Unknown thermostat parameter")
        unit = _unit(data.get("unit", "°F"))
        default_difference = 2 if unit == "°F" else 10 / 9
        return cls(
            unit=unit,
            margin=_number(data.get("margin", default_difference)),
            progress=_number(data.get("progress", default_difference)),
            worsening=_number(data.get("worsening", default_difference)),
            progress_seconds=_seconds(data.get("progress_seconds", 3600), zero=False),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TemperatureResult:
    """One observation or an instruction to retire an inapplicable check."""

    observation: Observation | None
    next_deadline: datetime | None = None
    removed: bool = False


class TemperatureMonitor:
    """Evaluate one stable source-policy identity without I/O or clock reads."""

    def __init__(
        self,
        *,
        node_id: str,
        check_id: str,
        name: str,
        parameters: TemperatureLimitParameters | ThermostatParameters,
    ) -> None:
        """Start an independent monitoring expectation with no credited history."""
        self.node_id = node_id
        self.check_id = check_id
        self.name = name
        self.parameters = parameters
        self.active_reason: str | None = None
        self.since: datetime | None = None
        self.context: tuple[str, float, float] | None = None
        self.best: float | None = None
        self.comparison: float | None = None
        self.direction = 0

    def snapshot(self) -> dict[str, JSONValue]:
        """Persist qualified findings without crediting unobserved restart time."""
        return {"active_reason": self.active_reason}

    def restore(self, data: Mapping[str, object]) -> None:
        """Restore an open condition while requiring fresh qualification history."""
        reason = data.get("active_reason")
        if (
            set(data) != {"active_reason"}
            or not isinstance(reason, (str, type(None)))
            or reason
            not in {
                None,
                "temperature_low",
                "temperature_high",
                "thermostat_stalled",
                "thermostat_worsening",
            }
        ):
            raise ValueError("Invalid temperature monitoring state")
        self.active_reason = str(reason) if reason is not None else None
        self._reset_trend()

    def _reset_trend(self) -> None:
        self.since = None
        self.context = None
        self.best = None
        self.comparison = None
        self.direction = 0

    def _display(self, celsius: float) -> str:
        unit = self.parameters.unit
        value = (
            celsius * 9 / 5 + 32
            if unit == "°F"
            else celsius + 273.15
            if unit == "K"
            else celsius
        )
        return f"{value:g} {unit}"

    def _result(
        self,
        now: datetime,
        status: Status,
        reason: str,
        message: str,
        evidence: dict[str, JSONValue],
        deadline: datetime | None = None,
    ) -> TemperatureResult:
        return TemperatureResult(
            observation=Observation(
                node_id=self.node_id,
                check_id=self.check_id,
                observed_at=now,
                status=status,
                reason=reason,
                message=f"{self.name}: {message}",
                evidence={**evidence, "physical_freshness_verified": False},
            ),
            next_deadline=deadline,
        )

    def evaluate(
        self, state: State | None, now: datetime, *, climate_unit: str = "°C"
    ) -> TemperatureResult:
        """Consume a current report or revisit it at the returned deadline.

        Climate attributes use the installation temperature unit in HA 2026.9.
        The caller supplies that unit and retires checks marked removed.
        """
        if now.tzinfo is None or now.utcoffset() != timedelta(0):
            raise ValueError("now must be a timezone-aware UTC datetime")
        evidence: dict[str, JSONValue] = {
            "entity_id": state.entity_id if state else None,
            "unit": self.parameters.unit,
        }
        if (
            state is None
            or state.state in {"unknown", "unavailable"}
            or state.attributes.get("restored")
        ):
            return self._unknown(now, evidence)
        if isinstance(self.parameters, ThermostatParameters):
            if state.state not in {"heat", "cool", "heat_cool"}:
                self.active_reason = None
                self._reset_trend()
                return TemperatureResult(observation=None, removed=True)
            try:
                temperature = _celsius(
                    state.attributes.get("current_temperature"), climate_unit
                )
                low = _celsius(
                    state.attributes.get(
                        "target_temp_low"
                        if state.state == "heat_cool"
                        else "temperature"
                    ),
                    climate_unit,
                )
                high = _celsius(
                    state.attributes.get(
                        "target_temp_high"
                        if state.state == "heat_cool"
                        else "temperature"
                    ),
                    climate_unit,
                )
                if low > high:
                    raise ValueError("Invalid thermostat range")
            except ValueError:
                return self._unknown(now, evidence)
            evidence.update(
                temperature_celsius=temperature,
                target_low_celsius=low,
                target_high_celsius=high,
                mode=state.state,
            )
            return self._thermostat(now, temperature, low, high, state.state, evidence)
        try:
            temperature = _celsius(
                state.state, _unit(state.attributes.get("unit_of_measurement"))
            )
        except ValueError:
            return self._unknown(now, evidence)
        evidence.update(temperature_celsius=temperature)
        return self._limit(now, temperature, evidence)

    def _unknown(
        self, now: datetime, evidence: dict[str, JSONValue]
    ) -> TemperatureResult:
        self._reset_trend()
        return self._result(
            now,
            Status.UNKNOWN,
            "temperature_evidence_missing",
            "Home Assistant has no usable current temperature evidence.",
            evidence,
        )

    def _limit(
        self, now: datetime, temperature: float, evidence: dict[str, JSONValue]
    ) -> TemperatureResult:
        parameters = self.parameters
        assert isinstance(parameters, TemperatureLimitParameters)
        minimum = (
            _celsius(parameters.minimum, parameters.unit)
            if parameters.minimum is not None
            else None
        )
        maximum = (
            _celsius(parameters.maximum, parameters.unit)
            if parameters.maximum is not None
            else None
        )
        evidence.update(
            minimum=parameters.minimum,
            maximum=parameters.maximum,
            duration_seconds=parameters.duration_seconds,
        )
        reason = (
            "temperature_low"
            if minimum is not None and temperature < minimum
            else "temperature_high"
            if maximum is not None and temperature > maximum
            else None
        )
        if reason is None:
            self.active_reason = None
            self._reset_trend()
            return self._result(
                now,
                Status.PASS,
                "temperature_in_range",
                "Temperature is within the configured range.",
                evidence,
            )
        if self.since is None:
            self.since = now
        elapsed = (now - self.since).total_seconds()
        evidence["observed_seconds"] = elapsed
        deadline = self.since + timedelta(seconds=parameters.duration_seconds)
        if self.active_reason or now >= deadline:
            self.active_reason = reason
            bound = (
                parameters.minimum
                if reason == "temperature_low"
                else parameters.maximum
            )
            relation = (
                "below the minimum"
                if reason == "temperature_low"
                else "above the maximum"
            )
            return self._result(
                now,
                Status.WARN,
                reason,
                f"Temperature {self._display(temperature)} is {relation} {bound:g} {parameters.unit}.",
                evidence,
            )
        return self._result(
            now,
            Status.PASS,
            "temperature_qualifying",
            "Temperature is outside the range; the configured duration has not elapsed.",
            evidence,
            deadline,
        )

    def _thermostat(
        self,
        now: datetime,
        temperature: float,
        low: float,
        high: float,
        mode: str,
        evidence: dict[str, JSONValue],
    ) -> TemperatureResult:
        parameters = self.parameters
        assert isinstance(parameters, ThermostatParameters)
        margin = _celsius(parameters.margin, parameters.unit, difference=True)
        progress = _celsius(parameters.progress, parameters.unit, difference=True)
        worsening = _celsius(parameters.worsening, parameters.unit, difference=True)
        context = (mode, low, high)
        changed = self.context is not None and self.context != context
        direction = (
            1
            if mode in {"heat", "heat_cool"} and temperature < round(low - margin, 6)
            else -1
            if mode in {"cool", "heat_cool"} and temperature > round(high + margin, 6)
            else 0
        )
        evidence.update(
            margin=parameters.margin,
            progress=parameters.progress,
            worsening=parameters.worsening,
            progress_seconds=parameters.progress_seconds,
        )
        if direction == 0:
            self.active_reason = None
            self._reset_trend()
            self.context = context
            reason = (
                "thermostat_target_satisfied" if changed else "thermostat_in_margin"
            )
            return self._result(
                now,
                Status.PASS,
                reason,
                "Reported temperature satisfies the current target and permitted margin.",
                evidence,
            )
        directed = temperature * direction
        if changed or self.since is None or direction != self.direction:
            self.context = context
            self.direction = direction
            self.since = now
            self.best = directed
            self.comparison = directed
        assert (
            self.best is not None
            and self.comparison is not None
            and self.since is not None
        )
        evidence["change_toward_target_celsius"] = round(directed - self.comparison, 6)
        evidence["worsening_from_best_celsius"] = round(self.best - directed, 6)
        evidence["observed_seconds"] = (now - self.since).total_seconds()
        deadline = self.since + timedelta(seconds=parameters.progress_seconds)
        if self.active_reason is None and now > deadline:
            self.active_reason = "thermostat_stalled"
        if round(self.best - directed, 6) >= worsening:
            self.active_reason = "thermostat_worsening"
        self.best = max(self.best, directed)
        if round(self.best - self.comparison, 6) >= progress:
            self.comparison = self.best
            self.since = now
            deadline = now + timedelta(seconds=parameters.progress_seconds)
        if self.active_reason is None and now >= deadline:
            self.active_reason = "thermostat_stalled"
        if self.active_reason is not None:
            action = "heating" if direction == 1 else "cooling"
            target = low if direction == 1 else high
            detail = (
                "is moving away from"
                if self.active_reason == "thermostat_worsening"
                else "has not made the expected progress toward"
            )
            return self._result(
                now,
                Status.WARN,
                self.active_reason,
                f"Temperature {self._display(temperature)} {detail} the {action} target {self._display(target)}; the permitted margin is {parameters.margin:g} {parameters.unit}.",
                evidence,
            )
        return self._result(
            now,
            Status.PASS,
            "thermostat_qualifying",
            "Temperature is outside the permitted margin; progress is being observed.",
            evidence,
            deadline,
        )
