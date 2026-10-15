"""Bounded, durable correlation for explicit Companion acknowledgment actions."""

from datetime import datetime, timedelta
from typing import Any, NotRequired, TypedDict
from uuid import uuid4

import voluptuous as vol
from homeassistant.core import Event, EventOrigin, HomeAssistant

from .notification_routes import destinations

MAX_ACTIONS = 2000
RETENTION = timedelta(days=30)
SCHEMA = vol.Schema(
    {
        str: {
            vol.Required("episode_id"): str,
            vol.Required("recipient"): str,
            vol.Required("channel"): str,
            vol.Required("user_id"): str,
            vol.Required("delivery_id"): str,
            vol.Required("expires_at"): str,
            vol.Optional("episodes"): vol.All(
                [vol.All(str, vol.Length(min=1))], vol.Length(min=1), vol.Unique()
            ),
        }
    }
)


class PhoneActionRecord(TypedDict):
    """The recipient and exact issue occurrences shown in one delivered message."""

    episode_id: str
    recipient: str
    channel: str
    user_id: str
    delivery_id: str
    expires_at: str
    episodes: NotRequired[list[str]]


class PhoneActions:
    """Keep notification responses separate from issue and delivery state."""

    def __init__(self) -> None:
        """Prepare an empty adapter-owned registry."""
        self.records: dict[str, PhoneActionRecord] = {}

    def restore(self, value: Any) -> None:
        """Validate only adapter-owned callback state."""
        records = SCHEMA(value)
        if len(records) > MAX_ACTIONS or any(
            not key.startswith("HOMEOSTATIC_ACK_")
            or datetime.fromisoformat(row["expires_at"]).tzinfo is None
            for key, row in records.items()
        ):
            raise ValueError("Invalid stored phone actions")
        self.records = records

    def prune(self, now: datetime) -> None:
        """Expire old buttons without granting them a new occurrence's identity."""
        self.records = {
            key: row
            for key, row in self.records.items()
            if datetime.fromisoformat(row["expires_at"]) > now
        }

    def prepare(
        self, hass: HomeAssistant, payload: dict[str, Any], channel: str, now: datetime
    ) -> str | None:
        """Bind a private action to the exact active issues in one delivery."""
        if payload.get("action") in {
            "resolve",
            "summary",
            "digest",
        }:
            return None
        episodes = payload.get("episodes")
        subject = payload.get("notification_subject")
        if ("episodes" in payload or "notification_subject" in payload) and (
            not isinstance(subject, str)
            or not subject.startswith(("device:", "entity:"))
            or not isinstance(episodes, list)
            or not episodes
            or any(not isinstance(episode, str) or not episode for episode in episodes)
            or len(episodes) != len(set(episodes))
        ):
            return None
        episode_id = payload.get("episode_id")
        route = next((r for r in destinations(hass) if r.channel == channel), None)
        if (
            not isinstance(episode_id, str)
            or route is None
            or not route.user_id
            or not channel.startswith("phone:")
        ):
            return None
        self.prune(now)
        if len(self.records) >= MAX_ACTIONS:
            oldest = min(self.records, key=lambda key: self.records[key]["expires_at"])
            del self.records[oldest]
        token = "HOMEOSTATIC_ACK_" + uuid4().hex
        self.records[token] = {
            "episode_id": episode_id,
            "recipient": payload["recipient"],
            "channel": channel,
            "user_id": route.user_id,
            "delivery_id": payload["delivery_id"],
            "expires_at": (now + RETENTION).isoformat(),
        }
        if isinstance(episodes, list):
            self.records[token]["episodes"] = list(episodes)
        return token

    async def authorize(
        self, hass: HomeAssistant, event: Event[Any], now: datetime
    ) -> PhoneActionRecord | None:
        """Trust HA's authenticated context, never client-supplied actor/device fields."""
        token = event.data.get("action")
        if not isinstance(token, str):
            return None
        row = self.records.get(token)
        if (
            row is None
            or event.origin != EventOrigin.remote
            or event.context.user_id != row["user_id"]
            or datetime.fromisoformat(row["expires_at"]) <= now
        ):
            return None
        user = await hass.auth.async_get_user(row["user_id"])
        if user is None or not user.is_active:
            return None
        route = next(
            (r for r in destinations(hass) if r.channel == row["channel"]), None
        )
        if route is None or route.user_id != row["user_id"]:
            return None
        return row
