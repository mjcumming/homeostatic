"""Durable notification requests, independent of transport and engine state."""

from collections.abc import Callable
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
        self.attempted: set[str] = set()

    @property
    def episode_ids(self) -> set[str]:
        """Episodes whose notification information has been requested."""
        return {str(message["episode_id"]) for message in self.messages.values()}

    def restore(self, data: dict[str, Any]) -> None:
        """Reject malformed delivery state before mutating it."""
        if (
            set(data)
            not in (
                {"sequence", "messages", "outbox", "summarized"},
                {"sequence", "messages", "outbox", "summarized", "attempted"},
            )
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
            for field in ("channels", "_target_channels"):
                if field in payload and (
                    not isinstance(payload[field], list)
                    or any(not isinstance(channel, str) for channel in payload[field])
                ):
                    raise ValueError("Invalid resolved notification destinations")
        if any(not isinstance(payload.get("delivery_id"), str) for payload in outbox):
            raise ValueError("Invalid delivery id")
        attempts = data.get("attempted", [])
        if not isinstance(attempts, list) or not all(
            isinstance(item, str) for item in attempts
        ):
            raise ValueError("Invalid delivery attempts")
        self.sequence = data["sequence"]
        self.messages = {key: dict(value) for key, value in messages.items()}
        self.outbox = [dict(value) for value in outbox]
        self.summarized = set(summarized)
        self.attempted = set(attempts)

    def snapshot(self) -> dict[str, Any]:
        """Return the adapter-owned durable state."""
        return {
            "sequence": self.sequence,
            "messages": self.messages.copy(),
            "outbox": list(self.outbox),
            "summarized": sorted(self.summarized),
            "attempted": sorted(self.attempted),
        }

    def enqueue(self, payload: dict[str, JSONValue]) -> None:
        """Assign an id once, preserved if a crash replays the request."""
        self.sequence += 1
        self.outbox.append(
            {**payload, "delivery_id": f"{self.entry_id}:{self.sequence}"}
        )

    def prepare_reports(self, deliveries: list[Delivery]) -> None:
        """Limit each new report to this occurrence's authorized membership."""
        groups: dict[str, set[str]] = {}
        for delivery in deliveries:
            if isinstance(delivery, Notification) and delivery.cause == "digest":
                group = f"digest_{delivery.digest}_{delivery.recipient}{self._route_suffix(delivery)}"
                groups.setdefault(group, set()).add(delivery.episode_id)
        for key, message in list(self.messages.items()):
            group = str(message.get("group", ""))
            if group in groups and message["episode_id"] not in groups[group]:
                del self.messages[key]
                self.summarized.discard(key)

    def record(
        self,
        delivery: Delivery,
        content: dict[str, JSONValue],
        *,
        startup: bool = False,
        resolve_channels: Callable[[tuple[str, ...]], tuple[str, ...]] | None = None,
    ) -> None:
        """Render each authorized delivery, retaining summary membership.

        While Home Assistant starts, alerting requests join one startup summary
        per recipient. Silent replacements keep their existing presentation.
        """
        suffix = self._route_suffix(delivery)
        key = f"{delivery.recipient}:{delivery.episode_id}{suffix}"
        previous = self.messages.get(key)
        old_group = str(previous["group"]) if previous and "group" in previous else None
        if isinstance(delivery, Notification):
            action = delivery.cause
            group = None
            if delivery.cause == "activate":
                action = "summary"
                group = f"activation_{delivery.recipient}{suffix}"
            elif startup and not delivery.silent:
                action = "summary"
                group = f"startup_{delivery.recipient}{suffix}"
            elif delivery.cause == "digest":
                group = f"digest_{delivery.digest}_{delivery.recipient}{suffix}"
            elif delivery.silent and old_group:
                group = old_group
            tag = (
                content["tag"]
                if delivery.recipient == "owner"
                else f"{content['tag']}_{delivery.recipient}"
            )
            prior_channels = (
                cast(
                    list[str],
                    previous.get("_target_channels", previous.get("channels", [])),
                )
                if previous
                else []
            )
            channels = (
                prior_channels
                if delivery.silent and previous is not None
                else list(resolve_channels(delivery.channels))
                if resolve_channels
                else list(delivery.channels)
            )
            payload: dict[str, JSONValue] = {
                **content,
                "tag": f"{tag}{suffix}",
                "recipient": delivery.recipient,
                "channels": cast(list[JSONValue], channels),
                "loudness": delivery.loudness.value,
                "silent": delivery.silent,
                "action": action,
                "digest": delivery.digest,
                "previously_reported": previous.get("previously_reported", False)
                if delivery.silent and previous
                else delivery.previously_reported,
            }
            if suffix:
                payload["route"] = delivery.route
            if resolve_channels is not None or (
                previous is not None and "_target_channels" in previous
            ):
                payload["_target_channels"] = list(
                    dict.fromkeys([*prior_channels, *channels])
                )
            if group is not None:
                payload["group"] = group
                payload["tag"] = f"homeostatic_{self.entry_id}_{group}"
            self.messages[key] = payload
            self.summarized.discard(key)
            if old_group and old_group != group:
                self._group(old_group, "update", True, previous)
            elif group and previous is not None and old_group != group:
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
                and item.get("route", "") == getattr(delivery, "route", "")
            )
        ]
        if old_group:
            self._group(old_group, "update", True, previous, delivery.resolution)
        elif previous is not None:
            self.enqueue(
                {
                    **previous,
                    "channels": previous.get("_target_channels", previous["channels"]),
                    "action": "resolve",
                    "silent": True,
                    "resolution": delivery.resolution,
                    "message": f"Problem {delivery.resolution}.",
                }
            )

    @staticmethod
    def _route_suffix(delivery: Delivery) -> str:
        """Keep legacy identities intact while separating independent assignments."""
        route = getattr(delivery, "route", "")
        return f"_route_{route}" if route else ""

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
                    "channels": previous.get("_target_channels", previous["channels"]),
                    "episode_id": group,
                    "episodes": [],
                    "action": "resolve",
                    "silent": True,
                    "resolution": resolution,
                    "message": "Summary cleared.",
                }
            )
            return
        members.sort(key=lambda item: bool(item.get("previously_reported", False)))
        first = members[0]
        noisy = [item for item in members if item["episode_id"] in alerting]
        history = list(
            dict.fromkeys(
                str(channel)
                for item in [*members, *([previous] if previous else [])]
                for channel in cast(
                    list[JSONValue], item.get("_target_channels", item["channels"])
                )
            )
        )
        for member in members:
            member["_target_channels"] = list(history)
        channels = (
            list(
                dict.fromkeys(
                    str(channel)
                    for item in noisy
                    for channel in cast(list[JSONValue], item["channels"])
                )
            )
            if noisy
            else history
        )
        if silent and noisy:
            action = str(pending[-1]["action"])
        self.enqueue(
            {
                **first,
                "channels": cast(list[JSONValue], channels),
                "_target_channels": cast(list[JSONValue], history),
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
                    (
                        (
                            "Still outstanding: "
                            if item.get("previously_reported")
                            else "New: "
                        )
                        if group.startswith("digest_")
                        else ""
                    )
                    + f"{item['title']}: {item['message']}"
                    + (f" (open {item['age']})" if "age" in item else "")
                    for item in members
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

    def deactivate(self, *, routes: set[str] | None = None) -> None:
        """Withdraw selected requests without claiming that their problems recovered."""
        self.outbox = [
            payload
            for payload in self.outbox
            if payload["action"] == "resolve"
            or (routes is not None and str(payload.get("route", "")) not in routes)
        ]
        selected = {
            key: payload
            for key, payload in self.messages.items()
            if routes is None or str(payload.get("route", "")) in routes
        }
        by_tag = {str(payload["tag"]): payload for payload in selected.values()}
        for payload in by_tag.values():
            self.enqueue(
                {
                    **payload,
                    "channels": payload.get("_target_channels", payload["channels"]),
                    "action": "resolve",
                    "silent": True,
                    "resolution": "notifications_disabled",
                    "message": "Notifications disabled; the problem may still be open.",
                }
            )
        for key in selected:
            del self.messages[key]
            self.summarized.discard(key)
        if routes is None:
            self.summarized.clear()
