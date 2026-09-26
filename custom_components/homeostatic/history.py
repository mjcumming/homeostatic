"""Bounded terminal-episode history derived only from public library events."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol
from health_tree.types import EpisodeResolved, Importance, JSONValue, Status

from .catalog import Source
from .serialization import json_object

MAX_EPISODES = 100
MAX_AGE = timedelta(days=30)


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value)
    if result.utcoffset() != timedelta(0):
        raise ValueError("History timestamps must be timezone-aware UTC")
    return result


def _timestamp(value: str) -> str:
    return _time(value).isoformat()


_TIMESTAMP = vol.All(str, _timestamp)
_TEXT = vol.All(str, vol.Length(min=1))
_STRINGS = {str: str}
_FINDING = vol.Schema(
    {
        vol.Required("node_id"): _TEXT,
        vol.Required("check_id"): vol.Any(None, str),
        vol.Required("status"): vol.In([status.value for status in Status]),
        vol.Required("reason"): str,
        vol.Required("since"): _TIMESTAMP,
        vol.Required("message"): vol.Any(None, str),
        vol.Required("due_at"): vol.Any(None, _TIMESTAMP),
        vol.Required("labels"): _STRINGS,
        vol.Required("annotations"): _STRINGS,
    }
)
_EPISODE = vol.Schema(
    {
        vol.Required("episode_id"): _TEXT,
        vol.Required("form"): vol.In(("root", "group")),
        vol.Required("anchor"): _TEXT,
        vol.Required("status"): vol.In([status.value for status in Status]),
        vol.Required("reasons"): [_FINDING],
        vol.Required("recorded"): [str],
        vol.Required("impact"): [str],
        vol.Required("importance"): vol.In(
            [importance.value for importance in Importance]
        ),
        vol.Required("opened_at"): _TIMESTAMP,
        vol.Required("updated_at"): _TIMESTAMP,
        vol.Required("due_at"): vol.Any(None, _TIMESTAMP),
        vol.Required("absorbed"): [str],
        vol.Required("labels"): _STRINGS,
        vol.Required("annotations"): _STRINGS,
    }
)
_RECORD = vol.Schema(
    {
        vol.Required("episode"): _EPISODE,
        vol.Required("resolved_at"): _TIMESTAMP,
        vol.Required("resolution"): vol.In(("cleared", "removed", "absorbed")),
        vol.Required("absorbed_into"): vol.Any(None, _TEXT),
        vol.Required("source"): vol.Any(
            None,
            {
                vol.Required("node_id"): _TEXT,
                vol.Required("name"): str,
                vol.Required("kind"): str,
            },
        ),
    }
)
_STORED = vol.Schema(
    {
        vol.Required("schema_version"): 1,
        vol.Required("started_at"): vol.Any(None, _TIMESTAMP),
        vol.Required("episodes"): vol.All([_RECORD], vol.Length(max=MAX_EPISODES)),
    }
)


@dataclass(frozen=True, slots=True, kw_only=True)
class ResolvedEpisode:
    """A library resolution and its display context at the observation boundary."""

    episode: dict[str, JSONValue]
    resolved_at: datetime
    resolution: str
    absorbed_into: str | None
    source: dict[str, JSONValue] | None


class ResolvedHistory:
    """Keep a small durable history without interpreting engine snapshots."""

    def __init__(self) -> None:
        """Start without inventing a collection time before HA startup."""
        self.started_at: datetime | None = None
        self._episodes: dict[str, ResolvedEpisode] = {}

    def advance(self, now: datetime) -> None:
        """Initialize collection and expire records at an adapter evaluation."""
        if self.started_at is None:
            self.started_at = now
        kept = [
            record
            for record in self._episodes.values()
            if record.resolved_at > now - MAX_AGE
        ][-MAX_EPISODES:]
        self._episodes = {str(record.episode["episode_id"]): record for record in kept}

    def record(
        self, event: EpisodeResolved, source: Source | None, now: datetime
    ) -> None:
        """Capture a terminal episode once, even if its event is replayed."""
        if event.episode.episode_id in self._episodes:
            return
        self._episodes[event.episode.episode_id] = ResolvedEpisode(
            episode=json_object(event.episode),
            resolved_at=now,
            resolution=event.resolution,
            absorbed_into=event.absorbed_into,
            source={"node_id": source.node_id, "name": source.name, "kind": source.kind}
            if source
            else None,
        )
        self.advance(now)

    def snapshot(self) -> dict[str, JSONValue]:
        """Serialize owned history separately from opaque library state."""
        return json_object(
            {
                "schema_version": 1,
                "started_at": self.started_at,
                "episodes": list(self._episodes.values()),
            }
        )

    def restore(self, value: Any) -> None:
        """Validate the complete saved history before replacing current state."""
        data = _STORED(value)
        started_at = (
            _time(data["started_at"]) if data["started_at"] is not None else None
        )
        records: dict[str, ResolvedEpisode] = {}
        previous = started_at
        for item in data["episodes"]:
            episode = item["episode"]
            resolved_at = _time(item["resolved_at"])
            if (
                previous is None
                or resolved_at < previous
                or not _time(episode["opened_at"])
                <= _time(episode["updated_at"])
                <= resolved_at
            ):
                raise ValueError("Invalid history chronology")
            if episode["episode_id"] in records:
                raise ValueError("Duplicate history episode")
            if (item["resolution"] == "absorbed") != (
                item["absorbed_into"] is not None
            ) or item["absorbed_into"] == episode["episode_id"]:
                raise ValueError("Invalid history absorption")
            if (
                item["source"] is not None
                and item["source"]["node_id"] != episode["anchor"]
            ):
                raise ValueError("Invalid history source")
            records[episode["episode_id"]] = ResolvedEpisode(
                episode=json_object(episode),
                resolved_at=resolved_at,
                resolution=item["resolution"],
                absorbed_into=item["absorbed_into"],
                source=json_object(item["source"])
                if item["source"] is not None
                else None,
            )
            previous = resolved_at
        self.started_at, self._episodes = started_at, records

    def view(self, now: datetime) -> dict[str, JSONValue]:
        """Return a detached, newest-first view without changing retained state."""
        return json_object(
            {
                "started_at": self.started_at,
                "retention": {
                    "max_episodes": MAX_EPISODES,
                    "max_age_days": MAX_AGE.days,
                },
                "episodes": [
                    record
                    for record in reversed(self._episodes.values())
                    if record.resolved_at > now - MAX_AGE
                ],
            }
        )
