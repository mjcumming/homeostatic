"""Compact notification presentation and durable, exact issue-link scopes."""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Any
from urllib.parse import quote

from health_tree.types import JSONValue
from homeassistant.helpers.json import json_bytes

MAX_MESSAGE_BYTES = 1400
MAX_TITLE_BYTES = 200
MAX_INLINE_URL_BYTES = 256
MAX_REPORTS = 1000
MAX_MEMBERS = 20000
RETENTION = timedelta(days=30)
REFERENCE = re.compile(r"[0-9a-f]{32}")
REPORT_PATH = "/homeostatic/notification/"


def bounded_text(value: str, maximum: int, suffix: str = "…") -> str:
    """Bound a string's encoded JSON bytes without cutting a Unicode character."""
    if len(json_bytes(suffix)) > maximum:
        raise ValueError("Text bound cannot contain its suffix")
    if len(json_bytes(value)) <= maximum:
        return value
    low, high = 0, len(value)
    while low < high:
        middle = (low + high + 1) // 2
        if len(json_bytes(value[:middle] + suffix)) <= maximum:
            low = middle
        else:
            high = middle - 1
    return value[:low] + suffix


def included_episodes(payload: dict[str, Any]) -> list[str]:
    """Read exact public message membership without inferring current issues."""
    included = payload.get("episodes")
    if isinstance(included, list):
        return list(
            dict.fromkeys(item for item in included if isinstance(item, str) and item)
        )
    identity = payload.get("episode_id")
    if payload.get("action") in {"summary", "digest"}:
        return []
    return [identity] if isinstance(identity, str) and identity else []


def notification_url(payload: dict[str, Any]) -> str:
    """Prefer a validated local report link, retaining every older link format."""
    details = payload.get("details_url")
    if (
        isinstance(details, str)
        and details.startswith(REPORT_PATH)
        and REFERENCE.fullmatch(details.removeprefix(REPORT_PATH))
    ):
        return details
    included = payload.get("episodes")
    if isinstance(included, list):
        identities = included_episodes(payload)
        if len(identities) == 1:
            return f"/homeostatic/episode/{quote(identities[0], safe='')}"
        members = ",".join(quote(item, safe="") for item in identities)
        return f"/homeostatic/issues/notification/{members}"
    identity = payload.get("episode_id")
    if included is not None or payload.get("action") in {"summary", "digest"}:
        return "/homeostatic/issues"
    if isinstance(identity, str) and identity:
        return f"/homeostatic/episode/{quote(identity, safe='')}"
    return "/homeostatic/issues"


@dataclass(frozen=True, slots=True, kw_only=True)
class NotificationReport:
    """Exact issue occurrences referenced by a delivered notification link."""

    episodes: tuple[str, ...]
    expires_at: datetime


class NotificationReports:
    """Keep small immutable scopes independently of changing message groups."""

    def __init__(self, entry_id: str) -> None:
        """Scope deterministic references to this Home Assistant installation."""
        self.entry_id = entry_id
        self.records: dict[str, NotificationReport] = {}

    def restore(self, value: Any) -> None:
        """Validate the additive adapter-owned section before accepting it."""
        if not isinstance(value, dict) or len(value) > MAX_REPORTS:
            raise ValueError("Invalid stored notification reports")
        restored: dict[str, NotificationReport] = {}
        for reference, row in value.items():
            if (
                not isinstance(reference, str)
                or REFERENCE.fullmatch(reference) is None
                or not isinstance(row, dict)
                or set(row) != {"episodes", "expires_at"}
                or not isinstance(row["episodes"], list)
                or not row["episodes"]
                or any(
                    not isinstance(item, str) or not item for item in row["episodes"]
                )
                or len(set(row["episodes"])) != len(row["episodes"])
                or not isinstance(row["expires_at"], str)
            ):
                raise ValueError("Invalid stored notification report")
            expires_at = datetime.fromisoformat(row["expires_at"])
            if expires_at.tzinfo is None:
                raise ValueError("Notification report expiry must include a timezone")
            if reference != self._reference(row["episodes"]):
                raise ValueError("Stored notification report membership changed")
            restored[reference] = NotificationReport(
                episodes=tuple(row["episodes"]), expires_at=expires_at
            )
        if sum(len(row.episodes) for row in restored.values()) > MAX_MEMBERS:
            raise ValueError("Stored notification reports exceed their retention bound")
        self.records = restored

    def snapshot(self) -> dict[str, Any]:
        """Serialize only exact link scopes and expiry, without copied findings."""
        return {
            reference: {
                "episodes": list(row.episodes),
                "expires_at": row.expires_at.isoformat(),
            }
            for reference, row in self.records.items()
        }

    def prune(self, now: datetime) -> None:
        """Keep the newest scopes within time, record and total-member bounds."""
        self.records = {
            key: row for key, row in self.records.items() if row.expires_at > now
        }
        count = sum(len(row.episodes) for row in self.records.values())
        while len(self.records) > MAX_REPORTS or count > MAX_MEMBERS:
            oldest = min(self.records, key=lambda key: self.records[key].expires_at)
            count -= len(self.records.pop(oldest).episodes)

    def _reference(self, episodes: list[str]) -> str:
        return sha256(json_bytes([self.entry_id, episodes])).hexdigest()[:32]

    def _retain(self, episodes: list[str], now: datetime) -> str:
        if len(episodes) > MAX_MEMBERS:
            raise ValueError(
                "A notification exceeds the retained report membership limit"
            )
        reference = self._reference(episodes)
        previous = self.records.get(reference)
        if previous is not None and previous.episodes != tuple(episodes):
            raise ValueError("Notification report reference collision")
        self.records[reference] = NotificationReport(
            episodes=tuple(episodes), expires_at=now + RETENTION
        )
        self.prune(now)
        return reference

    def present(
        self, payload: dict[str, JSONValue], now: datetime
    ) -> dict[str, JSONValue]:
        """Prepare bounded human text while retaining exact public membership."""
        public = {
            key: value for key, value in payload.items() if not key.startswith("_")
        }
        message = str(public.get("message", ""))
        title = str(public.get("title", "Homeostatic"))
        episodes = included_episodes(public)
        suffix = "… Open Homeostatic for full details."
        public["message"] = bounded_text(message, MAX_MESSAGE_BYTES, suffix)
        public["title"] = bounded_text(title, MAX_TITLE_BYTES)
        summarized = public["message"] != message or public["title"] != title
        url = notification_url(public)
        if len(url.encode()) > MAX_INLINE_URL_BYTES and episodes:
            url = REPORT_PATH + self._retain(episodes, now)
            public["details_url"] = url
        if summarized:
            public["message_summarized"] = True
            public["details_url"] = url
        if "details_url" in public:
            public["issue_count"] = len(episodes)
        return public

    def view(
        self, reference: str, now: datetime, *, offset: int = 0, limit: int = 200
    ) -> dict[str, JSONValue]:
        """Read one bounded page without extending retention or changing state."""
        if (
            REFERENCE.fullmatch(reference) is None
            or offset < 0
            or not 1 <= limit <= 200
        ):
            raise ValueError("Invalid notification report query")
        row = self.records.get(reference)
        if row is None or row.expires_at <= now:
            return {
                "status": "expired",
                "reference": reference,
                "episodes": [],
                "total": 0,
                "next_offset": None,
            }
        if offset > len(row.episodes):
            raise ValueError("Notification report offset exceeds its membership")
        end = min(offset + limit, len(row.episodes))
        return {
            "status": "available",
            "reference": reference,
            "episodes": list(row.episodes[offset:end]),
            "total": len(row.episodes),
            "next_offset": end if end < len(row.episodes) else None,
        }
