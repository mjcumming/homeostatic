"""Observed conditions for presentation, independent of health decisions."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol
from health_tree.types import JSONValue, Observation, Status

from .serialization import json_object


def _timestamp(value: str) -> datetime:
    result = datetime.fromisoformat(value)
    if result.utcoffset() != timedelta(0):
        raise ValueError("Reported evidence timestamps must be UTC")
    return result


_REPORT = {
    vol.Required("reason"): str,
    vol.Required("message"): str,
    vol.Required("observed_at"): vol.All(str, _timestamp),
    vol.Optional("status", default=None): vol.Any(
        None, "pass", "warn", "fail", "unknown"
    ),
}
_STORED = vol.Schema(
    {
        str: {
            vol.Optional("current"): _REPORT,
            vol.Required("last_failure"): vol.Any(None, _REPORT),
            vol.Optional("history_complete"): bool,
        }
    }
)


@dataclass(frozen=True, slots=True, kw_only=True)
class ReportedCondition:
    """HA's reported condition at an adapter observation boundary."""

    reason: str
    message: str
    observed_at: datetime
    status: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class EvidenceContext:
    """Current evidence and a previous failure, without a health verdict.

    The current observation is presentation state rebuilt by the first refresh
    after a restart; only the last failure and history completeness persist.
    """

    current: ReportedCondition | None
    last_failure: ReportedCondition | None
    history_complete: bool = True


class ReportedEvidence:
    """Retain one reported problem through evidence gaps and across reloads.

    Also used for independent checks; this is presentation evidence only.
    """

    def __init__(self) -> None:
        """Begin without synthesizing historical observations."""
        self._records: dict[str, EvidenceContext] = {}
        self._history_complete = True

    def observe(self, observation: Observation, name: str) -> None:
        """Capture evidence only when the matching observation is ingested."""
        report = ReportedCondition(
            reason=observation.reason,
            message=(observation.message or "").removeprefix(f"{name}: "),
            observed_at=observation.observed_at,
            status=observation.status.value,
        )
        previous = self._records.get(observation.node_id)
        failure = previous.last_failure if previous else None
        history_complete = (
            previous.history_complete if previous else self._history_complete
        )
        if observation.status in {Status.FAIL, Status.WARN}:
            # A failure that continues with the same reason keeps its first
            # report, so an ongoing failure does not change the snapshot.
            failure = (
                previous.last_failure
                if previous is not None
                and previous.last_failure is not None
                and (
                    previous.last_failure.reason,
                    previous.last_failure.message,
                    previous.last_failure.status,
                )
                == (report.reason, report.message, report.status)
                else report
            )
            history_complete = True
        elif observation.status is Status.PASS:
            failure = None
            history_complete = True
        self._records[observation.node_id] = EvidenceContext(
            current=report, last_failure=failure, history_complete=history_complete
        )

    def retain(self, node_ids: set[str]) -> None:
        """Discard presentation when monitoring of the source ends."""
        self._records = {
            key: value for key, value in self._records.items() if key in node_ids
        }

    def view(self, node_id: str) -> dict[str, JSONValue] | None:
        """Return detached presentation without reading or advancing a clock."""
        record = self._records.get(node_id)
        return json_object(record) if record else None

    def snapshot(self) -> dict[str, JSONValue]:
        """Persist the durable part: known failures and incomplete history.

        A source with no known failure and complete history carries no fact.
        """
        return {
            node_id: {
                "last_failure": json_object(record.last_failure)
                if record.last_failure is not None
                else None,
                "history_complete": record.history_complete,
            }
            for node_id, record in self._records.items()
            if record.last_failure is not None or not record.history_complete
        }

    def restore(self, value: Any, *, history_complete: bool = True) -> None:
        """Reject malformed evidence before replacing any retained record."""
        data = _STORED(value)
        records = {}
        for node_id, item in data.items():
            current = (
                ReportedCondition(**item["current"]) if item.get("current") else None
            )
            failure = (
                ReportedCondition(**item["last_failure"])
                if item["last_failure"]
                else None
            )
            if failure and current and failure.observed_at > current.observed_at:
                raise ValueError(
                    "Reported failure cannot be newer than current evidence"
                )
            records[node_id] = EvidenceContext(
                current=current,
                last_failure=failure,
                history_complete=item.get(
                    "history_complete",
                    failure is not None
                    or (
                        current is not None
                        and current.status in {"pass", "warn", "fail"}
                    ),
                ),
            )
        self._records = records
        self._history_complete = history_complete
