"""Validated operator requests and their separately persisted presentation."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import voluptuous as vol

from .serialization import json_object

MAX_CONTROL_DURATION = timedelta(days=7)


def utc_time(value: str) -> datetime:
    """Parse an explicit zoned ISO timestamp and normalize it to UTC."""
    result = datetime.fromisoformat(value)
    if result.utcoffset() is None:
        raise ValueError("until must include a timezone")
    return result.astimezone(UTC)


def expiry(value: str, now: datetime) -> datetime:
    """Require a future expiry no more than seven days from the action."""
    until = utc_time(value)
    if not now < until <= now + MAX_CONTROL_DURATION:
        raise ValueError("until must be in the future and within seven days")
    return until


@dataclass(frozen=True, slots=True, kw_only=True)
class OperatorControl:
    """An accepted request; the library owns its actual health/attention effects."""

    control_id: str
    action: Literal["shelve", "maintenance"]
    target: str
    started_at: datetime
    until: datetime
    user_id: str | None
    reason: str
    include_dependents: bool = False


_STORED = vol.Schema(
    {
        vol.Required("control_id"): vol.All(str, vol.Length(min=1)),
        vol.Required("action"): vol.In(("shelve", "maintenance")),
        vol.Required("target"): vol.All(str, vol.Length(min=1)),
        vol.Required("started_at"): str,
        vol.Required("until"): str,
        vol.Required("user_id"): vol.Any(None, str),
        vol.Required("reason"): vol.All(str, vol.Length(max=500)),
        vol.Required("include_dependents"): bool,
    }
)


def restore_controls(value: Any) -> list[OperatorControl]:
    """Reject malformed control presentation instead of silently losing it."""
    if not isinstance(value, list):
        raise ValueError("Invalid stored operator controls")
    result: list[OperatorControl] = []
    ids: set[str] = set()
    shelves: set[str] = set()
    for item in value:
        data = _STORED(item)
        data["started_at"] = utc_time(data["started_at"])
        data["until"] = expiry(data["until"], data["started_at"])
        control = OperatorControl(**data)
        if control.control_id in ids or (
            control.action == "shelve"
            and (control.include_dependents or control.target in shelves)
        ):
            raise ValueError("Invalid duplicate or scoped shelf control")
        ids.add(control.control_id)
        if control.action == "shelve":
            shelves.add(control.target)
        result.append(control)
    return result


def presentation(controls: list[OperatorControl]) -> list[dict[str, Any]]:
    """Serialize records without consulting library snapshot internals."""
    return [json_object(control) for control in controls]
