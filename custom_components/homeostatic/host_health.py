"""Qualify selected Home Assistant host-health readings."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from health_tree.types import JSONValue, Observation, Status
from homeassistant.core import State
from homeassistant.helpers.entity_registry import RegistryEntry

type HostCondition = Literal["storage", "memory", "io", "cpu"]

SYSTEM_MONITOR_KEYS: dict[HostCondition, str] = {
    "storage": "disk_free",
    "memory": "memory_pressure_full_avg300",
    "io": "io_pressure_full_avg300",
    "cpu": "cpu_pressure_some_avg300",
}
HOST_CHECKS: dict[str, HostCondition] = {
    f"host_{condition}": condition for condition in SYSTEM_MONITOR_KEYS
}

TRIAL_DEFAULTS: dict[HostCondition, tuple[float, float, int, int]] = {
    "storage": (5, 6, 1800, 1800),
    "memory": (5, 2, 600, 600),
    "io": (5, 2, 900, 600),
    "cpu": (20, 10, 900, 600),
}


def source_condition(entry: RegistryEntry) -> HostCondition | None:
    """Recognize System Monitor's exact registered measurement type."""
    if entry.domain != "sensor" or entry.platform != "systemmonitor":
        return None
    return next(
        (
            condition
            for condition, key in SYSTEM_MONITOR_KEYS.items()
            if entry.translation_key == key
        ),
        None,
    )


def supports_source(entry: RegistryEntry, condition: HostCondition) -> bool:
    """Match the integration's registered signal rather than its editable name."""
    return source_condition(entry) == condition and not entry.disabled


@dataclass(frozen=True, slots=True, kw_only=True)
class HostHealthParameters:
    """Explicit trial limits and continuous problem and recovery intervals."""

    condition: HostCondition
    threshold: float
    recovery: float
    duration_seconds: int
    recovery_seconds: int

    def __post_init__(self) -> None:
        """Reject invalid comparisons before evaluating a source."""
        if self.condition not in SYSTEM_MONITOR_KEYS:
            raise ValueError("Choose a supported host-health condition")
        for value in (self.threshold, self.recovery):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Choose finite limits")
            if not math.isfinite(value) or value < 0:
                raise ValueError("Choose finite nonnegative limits")
            if self.condition != "storage" and value > 100:
                raise ValueError("Pressure limits must not exceed 100 percent")
        if (self.condition == "storage" and self.recovery <= self.threshold) or (
            self.condition != "storage" and self.recovery >= self.threshold
        ):
            raise ValueError("Choose a recovery limit beyond the problem limit")
        for value in (self.duration_seconds, self.recovery_seconds):
            if type(value) is not int or not 0 <= value <= 31536000:
                raise ValueError("Choose a duration in seconds up to 365 days")

    @classmethod
    def from_data(
        cls, condition: HostCondition, data: Mapping[str, object]
    ) -> HostHealthParameters:
        """Validate all explicitly configured detection settings."""
        if set(data) != {
            "threshold",
            "recovery",
            "duration_seconds",
            "recovery_seconds",
        }:
            raise ValueError("Choose the host-health limits and durations")
        threshold = data["threshold"]
        recovery = data["recovery"]
        duration = data["duration_seconds"]
        recovery_seconds = data["recovery_seconds"]
        if (
            isinstance(threshold, bool)
            or not isinstance(threshold, (int, float))
            or isinstance(recovery, bool)
            or not isinstance(recovery, (int, float))
            or type(duration) is not int
            or type(recovery_seconds) is not int
        ):
            raise ValueError("Choose numeric limits and whole-second durations")
        return cls(
            condition=condition,
            threshold=threshold,
            recovery=recovery,
            duration_seconds=duration,
            recovery_seconds=recovery_seconds,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class HostHealthResult:
    """One observation and the next pending transition, if any."""

    observation: Observation
    next_deadline: datetime | None = None


class HostHealthMonitor:
    """Evaluate one selected signal using explicit UTC times."""

    def __init__(
        self,
        *,
        node_id: str,
        name: str,
        parameters: HostHealthParameters,
    ) -> None:
        """Start without credit for unobserved history."""
        self.node_id = node_id
        self.name = name
        self.parameters = parameters
        self.active = False
        self.since: datetime | None = None
        self.recovery_since: datetime | None = None

    def snapshot(self) -> dict[str, JSONValue]:
        """Keep an established finding without persisting unfinished waits."""
        return {"active": self.active}

    def restore(self, data: dict[str, object]) -> None:
        """Restore the finding while restarting any unfinished interval."""
        if set(data) != {"active"} or type(data["active"]) is not bool:
            raise ValueError("Invalid host-health monitoring state")
        self.active = data["active"]
        self.since = None
        self.recovery_since = None

    def evaluate(self, state: State | None, now: datetime) -> HostHealthResult:
        """Observe a usable report, or preserve an open issue through a gap."""
        if now.tzinfo is None or now.utcoffset() != timedelta(0):
            raise ValueError("now must be a timezone-aware UTC datetime")
        p = self.parameters
        unit = "GiB" if p.condition == "storage" else "%"
        evidence: dict[str, JSONValue] = {
            "entity_id": state.entity_id if state else None,
            "condition": p.condition,
            "unit": unit,
            "threshold": p.threshold,
            "recovery": p.recovery,
            "physical_freshness_verified": False,
        }
        try:
            if (
                state is None
                or state.state in {"unknown", "unavailable"}
                or state.attributes.get("restored")
                or state.attributes.get("unit_of_measurement") != unit
            ):
                raise ValueError("Missing report")
            value = float(state.state)
            if not math.isfinite(value) or value < 0 or (unit == "%" and value > 100):
                raise ValueError("Invalid report")
        except ValueError, OverflowError:
            self.since = None
            self.recovery_since = None
            return self._result(now, Status.UNKNOWN, "host_evidence_missing", evidence)

        evidence["value"] = value
        problem = (
            value < p.threshold if p.condition == "storage" else value > p.threshold
        )
        recovered = (
            value > p.recovery if p.condition == "storage" else value < p.recovery
        )
        if not self.active:
            self.recovery_since = None
            if not problem:
                self.since = None
                return self._result(now, Status.PASS, "host_normal", evidence)
            if self.since is None:
                self.since = now
            deadline = self.since + timedelta(seconds=p.duration_seconds)
            evidence["observed_seconds"] = (now - self.since).total_seconds()
            if now < deadline:
                return self._result(
                    now, Status.PASS, "host_qualifying", evidence, deadline
                )
            self.active = True
        if self.since is not None:
            evidence["observed_seconds"] = (now - self.since).total_seconds()
        if recovered:
            if self.recovery_since is None:
                self.recovery_since = now
            deadline = self.recovery_since + timedelta(seconds=p.recovery_seconds)
            if now >= deadline:
                self.active = False
                self.since = None
                self.recovery_since = None
                return self._result(now, Status.PASS, "host_normal", evidence)
            evidence["recovery_waiting"] = True
            return self._result(now, Status.WARN, "host_problem", evidence, deadline)
        self.recovery_since = None
        return self._result(now, Status.WARN, "host_problem", evidence)

    def _result(
        self,
        now: datetime,
        status: Status,
        reason: str,
        evidence: dict[str, JSONValue],
        deadline: datetime | None = None,
    ) -> HostHealthResult:
        condition = self.parameters.condition
        noun = {
            "storage": "Available storage",
            "memory": "Memory pressure",
            "io": "Storage I/O pressure",
            "cpu": "CPU pressure",
        }[condition]
        action = {
            "storage": "Review storage, backups and database history in Home Assistant.",
            "memory": "Review memory use and workloads on this system.",
            "io": "Review storage health and workloads on this system.",
            "cpu": "Review processor use and workloads on this system.",
        }[condition]
        if status == Status.UNKNOWN:
            message = f"{noun}: Home Assistant has no usable current reading."
        elif reason == "host_qualifying":
            message = (
                f"{noun} is outside the limit; waiting for the configured interval."
            )
        elif status == Status.PASS:
            message = f"{noun} is within its configured limits."
        elif evidence.get("recovery_waiting") is True:
            message = (
                f"{noun}: {evidence['value']} {evidence['unit']}; confirming recovery."
            )
        else:
            message = f"{noun}: {evidence['value']} {evidence['unit']}. {action}"
        return HostHealthResult(
            observation=Observation(
                node_id=self.node_id,
                check_id=f"host_{self.parameters.condition}",
                observed_at=now,
                status=status,
                reason=reason,
                message=f"{self.name}: {message}",
                evidence=evidence,
            ),
            next_deadline=deadline,
        )
