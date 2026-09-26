"""Observed integration conditions for presentation, independent of health decisions."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol
from health_tree.types import JSONValue, Observation, Status

from .serialization import json_object


def _timestamp(value: str) -> datetime:
    result = datetime.fromisoformat(value)
    if result.utcoffset() != timedelta(0):
        raise ValueError("Integration evidence timestamps must be UTC")
    return result


_REPORT = {
    vol.Required("reason"): str,
    vol.Required("message"): str,
    vol.Required("observed_at"): vol.All(str, _timestamp),
}
_STORED = vol.Schema(
    {
        str: {
            vol.Required("current"): _REPORT,
            vol.Required("last_failure"): vol.Any(None, _REPORT),
        }
    }
)


@dataclass(frozen=True, slots=True, kw_only=True)
class ReportedCondition:
    """HA's reported condition at an adapter observation boundary."""

    reason: str
    message: str
    observed_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class IntegrationContext:
    """Current evidence and a previous failure, without a health verdict."""

    current: ReportedCondition
    last_failure: ReportedCondition | None


class IntegrationEvidence:
    """Retain one failure through incomplete setup attempts and across reloads."""

    def __init__(self) -> None:
        """Begin without synthesizing historical observations."""
        self._records: dict[str, IntegrationContext] = {}

    def observe(self, observation: Observation, name: str) -> None:
        """Capture evidence only when the matching observation is ingested."""
        report = ReportedCondition(
            reason=observation.reason,
            message=(observation.message or "").removeprefix(f"{name}: "),
            observed_at=observation.observed_at,
        )
        previous = self._records.get(observation.node_id)
        failure = previous.last_failure if previous else None
        if observation.status in {Status.FAIL, Status.WARN}:
            failure = report
        elif observation.status is Status.PASS:
            failure = None
        self._records[observation.node_id] = IntegrationContext(
            current=report, last_failure=failure
        )

    def retain(self, node_ids: set[str]) -> None:
        """Discard presentation when monitoring of the integration ends."""
        self._records = {
            key: value for key, value in self._records.items() if key in node_ids
        }

    def view(self, node_id: str) -> dict[str, JSONValue] | None:
        """Return detached presentation without reading or advancing a clock."""
        record = self._records.get(node_id)
        return json_object(record) if record else None

    def snapshot(self) -> dict[str, JSONValue]:
        """Serialize presentation separately from opaque library snapshots."""
        return json_object(self._records)

    def restore(self, value: Any) -> None:
        """Reject malformed evidence before replacing any retained record."""
        data = _STORED(value)
        records = {}
        for node_id, item in data.items():
            current = ReportedCondition(**item["current"])
            failure = (
                ReportedCondition(**item["last_failure"])
                if item["last_failure"]
                else None
            )
            if failure and failure.observed_at > current.observed_at:
                raise ValueError(
                    "Integration failure cannot be newer than current evidence"
                )
            records[node_id] = IntegrationContext(current=current, last_failure=failure)
        self._records = records
