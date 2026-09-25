"""Durable notification requests, independent of transport and engine state."""

from typing import Any, cast

from health_tree.types import Delivery, JSONValue, Loudness, Notification


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
        """Render each authorized delivery, retaining summary membership."""
        key = f"{delivery.recipient}:{delivery.episode_id}"
        previous = self.messages.get(key)
        old_group = str(previous["group"]) if previous and "group" in previous else None
        if isinstance(delivery, Notification):
            action = delivery.cause
            group = None
            if delivery.cause == "activate":
                action = "summary"
                group = f"activation_{delivery.recipient}"
            elif delivery.cause == "digest":
                group = f"digest_{delivery.digest}_{delivery.recipient}"
            elif delivery.silent and old_group:
                group = old_group
            tag = (
                content["tag"]
                if delivery.recipient == "owner"
                else f"{content['tag']}_{delivery.recipient}"
            )
            payload: dict[str, JSONValue] = {
                **content,
                "tag": tag,
                "recipient": delivery.recipient,
                "channels": list(delivery.channels),
                "loudness": delivery.loudness.value,
                "silent": delivery.silent,
                "action": action,
                "digest": delivery.digest,
            }
            if group is not None:
                payload["group"] = group
                payload["tag"] = f"homeostatic_{self.entry_id}_{group}"
            self.messages[key] = payload
            self.summarized.discard(key)
            if old_group and old_group != group:
                self._group(old_group, "update", True, previous)
            elif group and previous is not None:
                self.outbox = [
                    item for item in self.outbox if item["tag"] != previous["tag"]
                ]
                self.enqueue(
                    {
                        **previous,
                        "action": "resolve",
                        "silent": True,
                        "resolution": "replaced",
                        "message": "Moved to summary.",
                    }
                )
            if group:
                self._group(
                    group,
                    action,
                    delivery.silent,
                    previous,
                    alert_episode=delivery.episode_id,
                )
            elif not (delivery.silent and previous == payload):
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
        if old_group:
            self._group(old_group, "update", True, previous, delivery.resolution)
        elif previous is not None:
            self.enqueue(
                {
                    **previous,
                    "action": "resolve",
                    "silent": True,
                    "resolution": delivery.resolution,
                    "message": f"Problem {delivery.resolution}.",
                }
            )

    def _group(
        self,
        group: str,
        action: str,
        silent: bool,
        previous: dict[str, JSONValue] | None,
        resolution: str = "replaced",
        *,
        alert_episode: str | None = None,
    ) -> None:
        """Replace one summary when its authorized membership changes."""
        members = [
            item for item in self.messages.values() if item.get("group") == group
        ]
        tag = f"homeostatic_{self.entry_id}_{group}"
        pending = [item for item in self.outbox if item["tag"] == tag]
        alerting = {
            str(episode_id)
            for item in pending
            for episode_id in cast(list[JSONValue], item.get("_alerting", []))
        }
        if not silent and alert_episode is not None:
            alerting.add(alert_episode)
        # Superseded unsent summaries cannot resurrect a removed member on replay.
        self.outbox = [item for item in self.outbox if item["tag"] != tag]
        if not members:
            assert previous is not None
            self.enqueue(
                {
                    **previous,
                    "episode_id": group,
                    "episodes": [],
                    "action": "resolve",
                    "silent": True,
                    "resolution": resolution,
                    "message": "Summary cleared.",
                }
            )
            return
        first = members[0]
        noisy = [item for item in members if item["episode_id"] in alerting]
        if silent and noisy:
            action = str(pending[-1]["action"])
        self.enqueue(
            {
                **first,
                "episode_id": group,
                "episodes": [item["episode_id"] for item in members],
                "action": action,
                "silent": not noisy,
                "_alerting": [item["episode_id"] for item in noisy],
                "loudness": max(
                    Loudness(str(item["loudness"])) for item in noisy or members
                ).value,
                "title": f"Homeostatic: {len(members)} open problems",
                "message": "\n".join(
                    f"{item['title']}: {item['message']}" for item in members
                ),
                "functions": cast(
                    list[JSONValue],
                    sorted(
                        {
                            str(name)
                            for item in members
                            for name in cast(list[JSONValue], item["functions"])
                        }
                    ),
                ),
                "cause": None,
            }
        )

    def deactivate(self) -> None:
        """Withdraw requests without claiming that their problems recovered."""
        self.outbox = [
            payload for payload in self.outbox if payload["action"] == "resolve"
        ]
        by_tag = {str(payload["tag"]): payload for payload in self.messages.values()}
        for payload in by_tag.values():
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
