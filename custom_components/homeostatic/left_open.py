"""Qualify reported openings within daily monitoring hours and temperature limits."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from health_tree.types import JSONValue, Observation, Status
from homeassistant.core import State
from homeassistant.util.unit_conversion import TemperatureConverter

CONTACT_CLASSES = frozenset({"door", "window", "garage_door", "opening"})


def _clock(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) != 5:
        raise ValueError("Choose a monitoring time in HH:MM format")
    try:
        parsed = time.fromisoformat(value)
    except ValueError as err:
        raise ValueError("Choose a monitoring time in HH:MM format") from err
    if parsed.isoformat(timespec="minutes") != value:
        raise ValueError("Choose a monitoring time in HH:MM format")
    return value


def _bound(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Choose finite temperature limits")
    try:
        result = float(value)
    except OverflowError as err:
        raise ValueError("Choose finite temperature limits") from err
    if not math.isfinite(result):
        raise ValueError("Choose finite temperature limits")
    return result


@dataclass(frozen=True, slots=True, kw_only=True)
class LeftOpenParameters:
    """An explicit wait, optional daily hours and one optional temperature input."""

    duration_seconds: int | None = None
    start: str | None = None
    end: str | None = None
    use_temperature: bool = False
    temperature_source: str | None = None
    unit: str = "°F"
    minimum: float | None = None
    maximum: float | None = None

    @classmethod
    def from_data(
        cls, data: Mapping[str, Any], *, complete: bool = True
    ) -> LeftOpenParameters:
        """Validate incomplete templates and require usable settings before enabling."""
        if data.keys() - cls.__dataclass_fields__.keys():
            raise ValueError("Unknown left-open detection parameter")
        duration = data.get("duration_seconds")
        if duration is None:
            if complete:
                raise ValueError("Choose how long an opening may stay open")
        elif type(duration) is not int or not 0 <= duration <= 31536000:
            raise ValueError("Choose an open duration from 0 to 365 days")
        start, end = _clock(data.get("start")), _clock(data.get("end"))
        if (start is None) != (end is None) or (start is not None and start == end):
            raise ValueError("Choose different monitoring start and end times")
        use_temperature = data.get("use_temperature", False)
        if type(use_temperature) is not bool:
            raise ValueError("Choose whether to use outdoor temperature")
        source = data.get("temperature_source")
        if source is not None and (
            not isinstance(source, str)
            or not source.startswith(("registry:", "entity_id:"))
            or not source.split(":", 1)[1]
            or any(character.isspace() for character in source)
        ):
            raise ValueError("Choose a temperature sensor or weather entity")
        unit = data.get("unit", "°F")
        if not isinstance(unit, str) or unit not in {"°F", "°C", "K"}:
            raise ValueError("Choose °C, °F or K")
        minimum, maximum = _bound(data.get("minimum")), _bound(data.get("maximum"))
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError("Below must not exceed Above")
        if (
            complete
            and use_temperature
            and (source is None or (minimum is None and maximum is None))
        ):
            raise ValueError(
                "Choose an outdoor temperature source and at least one limit"
            )
        return cls(
            duration_seconds=duration,
            start=start,
            end=end,
            use_temperature=use_temperature,
            temperature_source=source,
            unit=unit,
            minimum=minimum,
            maximum=maximum,
        )


def _boundary(day: date, clock: str, zone: ZoneInfo) -> datetime | None:
    """Use a real local boundary once, choosing its first occurrence on a repeated hour."""
    local = datetime.combine(day, time.fromisoformat(clock), zone)
    utc = local.astimezone(UTC)
    if utc.astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None):
        return None
    return utc


def monitoring_window(
    parameters: LeftOpenParameters, now: datetime, timezone: str
) -> tuple[datetime | None, datetime | None, datetime | None]:
    """Return current UTC bounds and the next boundary without inventing local times."""
    if parameters.start is None or parameters.end is None:
        return None, None, None
    zone = ZoneInfo(timezone)
    today = now.astimezone(zone).date()
    upcoming = []
    for offset in range(-1, 4):
        day = today + timedelta(days=offset)
        start = _boundary(day, parameters.start, zone)
        end = _boundary(
            day + timedelta(days=parameters.end < parameters.start),
            parameters.end,
            zone,
        )
        if start is None or end is None:
            continue
        if start <= now < end:
            return start, end, end
        if start > now:
            upcoming.append(start)
    return None, None, min(upcoming, default=None)


def temperature_value(state: State | None, unit: str) -> float | None:
    """Read current sensor or weather temperature with its reported units."""
    if (
        state is None
        or not (
            state.domain == "weather"
            or (
                state.domain == "sensor"
                and state.attributes.get("device_class") == "temperature"
            )
        )
        or state.state in {"unknown", "unavailable"}
        or state.attributes.get("restored")
    ):
        return None
    weather = state.domain == "weather"
    value = state.attributes.get("temperature") if weather else state.state
    native_unit = state.attributes.get(
        "temperature_unit" if weather else "unit_of_measurement"
    )
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        numeric = float(value)
        if not math.isfinite(numeric) or native_unit not in {"°C", "°F", "K"}:
            return None
        return round(TemperatureConverter.convert(numeric, native_unit, unit), 6)
    except ValueError, TypeError, OverflowError:
        return None


@dataclass(frozen=True, slots=True, kw_only=True)
class LeftOpenResult:
    """An observation and work due on the shared adapter timer."""

    observation: Observation
    next_deadline: datetime | None
    removed: bool = False


class LeftOpenMonitor:
    """Retain qualified evidence until reported closure or the monitoring boundary."""

    def __init__(
        self, *, node_id: str, name: str, parameters: LeftOpenParameters
    ) -> None:
        """Start without crediting elapsed time before enrollment."""
        self.node_id = node_id
        self.name = name
        self.parameters = parameters
        self.since: datetime | None = None
        self.qualified = False
        self.window_start: datetime | None = None
        self.window_end: datetime | None = None

    def snapshot(self) -> dict[str, JSONValue]:
        """Persist qualified continuity without retaining unfinished countdown credit."""
        return {
            "qualified": self.qualified,
            "window_start": self.window_start.isoformat()
            if self.window_start
            else None,
            "window_end": self.window_end.isoformat() if self.window_end else None,
        }

    def restore(self, data: Mapping[str, Any]) -> None:
        """Read this producer's bounded state without inspecting an engine snapshot."""
        if (
            set(data) != {"qualified", "window_start", "window_end"}
            or type(data["qualified"]) is not bool
        ):
            raise ValueError("Invalid stored left-open monitor")
        parsed = []
        for key in ("window_start", "window_end"):
            value = data[key]
            if value is not None and not isinstance(value, str):
                raise ValueError("Invalid stored left-open window")
            stamp = datetime.fromisoformat(value) if value is not None else None
            if stamp is not None and stamp.utcoffset() != timedelta(0):
                raise ValueError("Stored left-open times must be UTC")
            parsed.append(stamp)
        self.window_start, self.window_end = parsed
        if (self.window_start is None) != (self.window_end is None) or (
            self.window_start is not None
            and self.window_end is not None
            and self.window_start >= self.window_end
        ):
            raise ValueError("Invalid stored left-open window bounds")
        self.qualified = data["qualified"]
        self.since = None

    def evaluate(
        self,
        contact: State | None,
        temperature: State | None,
        now: datetime,
        *,
        timezone: str,
    ) -> LeftOpenResult:
        """Evaluate a coherent captured input before advancing the library lifecycle."""
        if now.utcoffset() != timedelta(0):
            raise ValueError("now must be an aware UTC time")
        p = self.parameters
        start, end, next_deadline = monitoring_window(p, now, timezone)
        removed = self.window_start is not None and self.window_start != start
        if removed:
            self.qualified = False
            self.since = None
        self.window_start, self.window_end = start, end
        active = p.start is None or start is not None
        reading = temperature_value(temperature, p.unit) if p.use_temperature else None
        evidence: dict[str, JSONValue] = {
            "entity_id": contact.entity_id if contact else None,
            "state": contact.state if contact else None,
            "duration_seconds": p.duration_seconds,
            "monitoring_active": active,
            "window_end": end.isoformat() if end else None,
            "temperature": reading,
            "unit": p.unit,
            "minimum": p.minimum,
            "maximum": p.maximum,
            "physical_freshness_verified": False,
        }
        status, reason, message = Status.PASS, "left_open_closed", "reports closed."
        usable = (
            contact is not None
            and not contact.attributes.get("restored")
            and contact.state in {"on", "off"}
        )
        if not active:
            self.since = None
            self.qualified = False
            reason, message = "left_open_outside_hours", "monitoring hours have ended."
        elif not usable:
            self.since = None
            status, reason, message = (
                Status.UNKNOWN,
                "left_open_contact_missing",
                "waiting for a current open or closed report.",
            )
        elif contact is not None and contact.state == "off":
            self.since = None
            self.qualified = False
        elif self.qualified:
            status, reason, message = (
                Status.FAIL,
                "left_open",
                "is still reported open.",
            )
        elif p.use_temperature and reading is None:
            self.since = None
            status, reason, message = (
                Status.UNKNOWN,
                "left_open_temperature_missing",
                "waiting for a usable outdoor temperature reading.",
            )
        elif p.use_temperature and not (
            (p.minimum is not None and reading is not None and reading < p.minimum)
            or (p.maximum is not None and reading is not None and reading > p.maximum)
        ):
            self.since = None
            reason, message = (
                "left_open_temperature_in_range",
                "reported open; outdoor temperature is within the selected limits.",
            )
        else:
            self.since = self.since or now
            deadline = self.since + timedelta(seconds=p.duration_seconds or 0)
            evidence["qualifying_since"] = self.since.isoformat()
            if now >= deadline:
                self.qualified = True
                status, reason, message = (
                    Status.FAIL,
                    "left_open",
                    "has stayed reported open for the allowed interval.",
                )
            else:
                next_deadline = min(
                    item for item in (deadline, next_deadline) if item is not None
                )
                evidence["qualifies_at"] = deadline.isoformat()
                reason, message = (
                    "left_open_waiting",
                    "waiting for the allowed open interval.",
                )
        return LeftOpenResult(
            observation=Observation(
                node_id=self.node_id,
                check_id="left_open",
                status=status,
                reason=reason,
                observed_at=now,
                message=f"{self.name}: {message}",
                evidence=evidence,
            ),
            next_deadline=next_deadline,
            removed=removed,
        )
