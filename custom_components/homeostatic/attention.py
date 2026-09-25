"""Owner-authored attention configuration translated to public library records."""

import re
from copy import deepcopy
from datetime import time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import voluptuous as vol
from health_tree.policy import Policy
from health_tree.types import (
    Digest,
    Importance,
    Loudness,
    Match,
    PolicyConfig,
    QuietHours,
    Recipient,
    Rule,
    Status,
)

DEFAULT_POLICY: dict[str, Any] = {
    "timezone": "UTC",
    "recipients": {"owner": {"channels": ["event"]}},
    "digests": {},
    "rules": [
        {"match": {"importance": ["critical"]}, "loudness": "urgent", "to": ["owner"]},
        {"match": {}, "loudness": "notify", "to": ["owner"]},
    ],
}
_ID = vol.Match(r"^[a-z][a-z0-9_]*$")
_TEXT = vol.All(str, vol.Length(min=1))
_CLOCK = vol.All(str, vol.Match(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$"))
_DURATION = re.compile(r"^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")


def duration(value: Any) -> timedelta:
    """Parse a bounded integer-second or d/h/m/s duration without coercing booleans."""
    seconds = value
    if isinstance(value, str):
        match = _DURATION.fullmatch(value)
        if not value or match is None:
            raise vol.Invalid("Use integer seconds or a duration such as 1h30m")
        seconds = sum(
            int(part or 0) * scale
            for part, scale in zip(match.groups(), (86400, 3600, 60, 1), strict=True)
        )
    if type(seconds) is not int or not 0 <= seconds <= 31536000:
        raise vol.Invalid("Durations must be between zero and 365 days")
    return timedelta(seconds=seconds)


def names(value: Any) -> list[str]:
    """Accept one name or a nonempty list, rejecting duplicates and blanks."""
    result: list[str] = vol.All([_TEXT], vol.Length(min=1))(
        [value] if isinstance(value, str) else value
    )
    if len(set(result)) != len(result):
        raise vol.Invalid("Names must not repeat")
    return result


_MATCH = vol.Schema(
    {
        vol.Optional("status"): names,
        vol.Optional("importance"): names,
        vol.Optional("reason"): names,
        vol.Optional("category"): names,
        vol.Optional("labels", default=dict): {_TEXT: str},
        vol.Optional("age"): duration,
        vol.Optional("due_within"): duration,
    }
)
_SCHEMA = vol.Schema(
    {
        vol.Required("timezone"): _TEXT,
        vol.Required("recipients"): {
            _ID: {
                vol.Required("channels"): names,
                vol.Optional("quiet_hours"): {
                    vol.Required("start"): _CLOCK,
                    vol.Required("end"): _CLOCK,
                },
            }
        },
        vol.Optional("digests", default=dict): {
            _ID: {vol.Required("at"): _CLOCK, vol.Required("to"): _TEXT}
        },
        vol.Required("rules"): vol.All(
            [
                {
                    vol.Required("match"): _MATCH,
                    vol.Required("loudness"): _TEXT,
                    vol.Optional("to"): names,
                    vol.Optional("digest"): _TEXT,
                    vol.Optional("remind_every"): duration,
                    vol.Optional("escalate_after"): duration,
                }
            ],
            vol.Length(min=1),
        ),
    }
)


def policy_data(value: Any = None) -> dict[str, Any]:
    """Copy configuration after validating it, retaining its editable YAML shape."""
    data = deepcopy(DEFAULT_POLICY if value is None else value)
    build_policy(data, timedelta(0))
    return data


def build_policy(value: Any, batch: timedelta) -> PolicyConfig:
    """Translate only supported owner fields; matching and timing stay in HealthTree."""
    data = _SCHEMA(value)
    try:
        zone = ZoneInfo(data["timezone"])
    except ZoneInfoNotFoundError as err:
        raise vol.Invalid("Choose an IANA timezone such as America/Chicago") from err
    return PolicyConfig(
        batch=batch,
        timezone=zone,
        recipients={
            name: Recipient(
                channels=tuple(row["channels"]),
                quiet_hours=QuietHours(
                    start=time.fromisoformat(row["quiet_hours"]["start"]),
                    end=time.fromisoformat(row["quiet_hours"]["end"]),
                )
                if "quiet_hours" in row
                else None,
            )
            for name, row in data["recipients"].items()
        },
        digests={
            name: Digest(at=time.fromisoformat(row["at"]), to=row["to"])
            for name, row in data["digests"].items()
        },
        rules=tuple(_rule(row) for row in data["rules"]),
    )


def _rule(row: dict[str, Any]) -> Rule:
    match = row["match"]
    return Rule(
        match=Match(
            status=frozenset(Status(value) for value in match["status"])
            if "status" in match
            else None,
            importance=frozenset(Importance(value) for value in match["importance"])
            if "importance" in match
            else None,
            reason=frozenset(match["reason"]) if "reason" in match else None,
            category=frozenset(match["category"]) if "category" in match else None,
            labels=match["labels"],
            age=match.get("age"),
            due_within=match.get("due_within"),
        ),
        loudness=Loudness(row["loudness"]),
        to=tuple(row.get("to", ())),
        digest=row.get("digest"),
        remind_every=row.get("remind_every"),
        escalate_after=row.get("escalate_after"),
    )


def explanations(policy: Policy, episode_ids: list[str]) -> list[dict[str, Any]]:
    """Read evaluated decisions using the public query, never snapshot internals."""
    return [policy.explain(episode_id) for episode_id in episode_ids]
