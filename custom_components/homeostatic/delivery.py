"""Durable notification requests, independent of transport and engine state."""

from typing import Any

from health_tree.types import Delivery, JSONValue, Notification


class DeliveryState:
    """Keep policy-authorized content and an at-least-once event outbox."""

    def __init__(self, entry_id: str) -> None:
        """Scope stable delivery ids to this installation."""
        self.entry_id = entry_id
        self.sequence = 0
        self.messages: dict[str, dict[str, JSONValue]] = {}
        self.outbox: list[dict[str, JSONValue]] = []
        self.summarized: set[str] = set()

    @property
    def episode_ids(self) -> set[str]:
        """Episodes whose notification information has been requested."""
        return {str(message["episode_id"]) for message in self.messages.values()}

    def restore(self, data: dict[str, Any]) -> None:
        """Reject malformed delivery state before mutating it."""
        if (
            set(data) != {"sequence", "messages", "outbox", "summarized"}
            or type(data["sequence"]) is not int
            or data["sequence"] < 0
        ):
            raise ValueError("Invalid delivery state")
        messages, outbox, summarized = (
            data["messages"],
            data["outbox"],
            data["summarized"],
        )
        if (
            not isinstance(messages, dict)
            or not isinstance(outbox, list)
            or not isinstance(summarized, list)
            or not all(isinstance(key, str) for key in summarized)
        ):
            raise ValueError("Invalid delivery state collections")
        for payload in [*messages.values(), *outbox]:
            if (
                not isinstance(payload, dict)
                or payload.get("schema_version") != 1
                or not all(
                    isinstance(payload.get(key), str)
                    for key in (
                        "episode_id",
                        "recipient",
                        "action",
                        "title",
                        "message",
                        "tag",
                    )
                )
            ):
                raise ValueError("Invalid notification payload")
        if any(not isinstance(payload.get("delivery_id"), str) for payload in outbox):
            raise ValueError("Invalid delivery id")
        self.sequence = data["sequence"]
        self.messages = {key: dict(value) for key, value in messages.items()}
        self.outbox = [dict(value) for value in outbox]
        self.summarized = set(summarized)

    def snapshot(self) -> dict[str, Any]:
        """Return the adapter-owned durable state."""
        return {
            "sequence": self.sequence,
            "messages": self.messages.copy(),
            "outbox": list(self.outbox),
            "summarized": sorted(self.summarized),
        }

    def enqueue(self, payload: dict[str, JSONValue]) -> None:
        """Assign an id once, preserved if a crash replays the request."""
        self.sequence += 1
        self.outbox.append(
            {**payload, "delivery_id": f"{self.entry_id}:{self.sequence}"}
        )

    def record(self, delivery: Delivery, content: dict[str, JSONValue]) -> None:
        """Change requested content only in response to a policy delivery."""
        key = f"{delivery.recipient}:{delivery.episode_id}"
        previous = self.messages.get(key)
        if isinstance(delivery, Notification):
            payload = {
                **content,
                "recipient": delivery.recipient,
                "loudness": delivery.loudness.value,
                "silent": delivery.silent,
                "action": "update" if previous else "open",
            }
            self.messages[key] = payload
            summarized = key in self.summarized
            self.summarized.discard(key)
            if (
                summarized
                and previous is not None
                and previous["message"] == payload["message"]
                and previous["loudness"] == payload["loudness"]
            ):
                return
            if previous == payload:
                return
            self.enqueue(payload)
            return
        self.messages.pop(key, None)
        self.summarized.discard(key)
        self.outbox = [
            item
            for item in self.outbox
            if not (
                item["episode_id"] == delivery.episode_id
                and item["recipient"] == delivery.recipient
            )
        ]
        # An unacknowledged opening may already have reached a consumer.
        # Clearing its tag is safe even when the opening was never published.
        if previous is not None:
            self.enqueue(
                {
                    **previous,
                    "action": "resolve",
                    "silent": True,
                    "resolution": delivery.resolution,
                    "title": f"{previous['title']} — {delivery.resolution}",
                    "message": f"Problem {delivery.resolution}.",
                }
            )

    def activate(self, contents: list[dict[str, JSONValue]]) -> None:
        """Publish one activation snapshot, suppressing queued individual openings."""
        for content in contents:
            key = f"owner:{content['episode_id']}"
            self.messages[key] = {
                **content,
                "recipient": "owner",
                "action": "update",
                "silent": True,
            }
            self.summarized.add(key)
        self.enqueue(
            {
                "schema_version": 1,
                "entry_id": self.entry_id,
                "episode_id": "activation",
                "tag": f"homeostatic_{self.entry_id}_activation",
                "action": "summary",
                "recipient": "owner",
                "loudness": "notify",
                "silent": False,
                "title": "Homeostatic notifications activated",
                "message": f"At activation: {len(contents)} open problems."
                + "".join(
                    f"\n{content['title']}: {content['message']}"
                    for content in contents
                ),
                "episodes": [content["episode_id"] for content in contents],
                "functions": [],
                "cause": None,
            }
        )

    def deactivate(self) -> None:
        """Withdraw old messages without claiming that their problems recovered."""
        self.outbox = [
            payload for payload in self.outbox if payload["action"] == "resolve"
        ]
        for payload in self.messages.values():
            self.enqueue(
                {
                    **payload,
                    "action": "resolve",
                    "silent": True,
                    "resolution": "notifications_disabled",
                    "message": "Notifications disabled; the problem may still be open.",
                }
            )
        self.messages.clear()
        self.summarized.clear()
