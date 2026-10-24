"""Notification composition and transport, coordinated by Runtime's save boundary."""

from collections import deque
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta
from functools import partial
from typing import Any

from health_tree.delivery_collections import CollectionRequest
from health_tree.engine import Engine
from health_tree.policy import Policy
from health_tree.types import (
    Delivery,
    Importance,
    JSONValue,
    Notification,
    PolicyConfig,
    QuietHours,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from . import notification_definitions, notification_grouping
from .catalog import Source
from .config import Settings
from .const import DOMAIN, EVENT_NOTIFICATION
from .delivery import DeliveryState
from .notification_reports import NotificationReports
from .notification_routes import async_send, notification_url
from .phone_actions import PhoneActionRecord, PhoneActions


@dataclass(frozen=True, slots=True, kw_only=True)
class NotificationContext:
    """Current inputs for one operation under the runtime's serialization boundary."""

    settings: Settings
    sources: Mapping[str, Source]
    candidates: Mapping[str, Source]
    episodes: Mapping[str, dict[str, JSONValue]]
    engine: Engine
    policy: Policy
    at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class Publication:
    """Exact raw requests, public previews and prior report scopes for one flush."""

    pending: tuple[dict[str, JSONValue], ...]
    payloads: tuple[dict[str, JSONValue], ...]
    previous_reports: dict[str, Any]
    scopes_changed: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class AuthorizedRequest:
    """A validated request and the routes it may use."""

    payload: dict[str, Any]
    channels: tuple[str, ...]
    resolved: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class SendingAttempt:
    """Prepared transport work whose attempt and phone action must be saved first."""

    request: AuthorizedRequest
    channel: str
    identity: str
    acknowledgment: str | None
    previous_actions: dict[str, PhoneActionRecord]
    sending_enabled: bool


class Notifications:
    """Own notification details without a worker, timer, lock or storage callback."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        """Prepare one installation's delivery and presentation state."""
        self.hass = hass
        self.entry_id = entry_id
        self.delivery = DeliveryState(entry_id)
        self.phone_actions = PhoneActions()
        self.reports = NotificationReports(entry_id)
        self.failures: deque[dict[str, str]] = deque(maxlen=50)
        self._resolved_requests: dict[str, dict[str, JSONValue]] = {}

    def restore(self, snapshot: dict[str, Any]) -> None:
        """Restore existing sections without changing the published envelope."""
        self.delivery.restore(snapshot["delivery"])
        self.phone_actions.restore(snapshot.get("phone_actions", {}))
        self.reports.restore(snapshot.get("notification_reports", {}))

    def snapshot(self) -> dict[str, Any]:
        """Return owned sections for the runtime's single verified save."""
        return {
            "delivery": self.delivery.snapshot(),
            "phone_actions": deepcopy(self.phone_actions.records),
            "notification_reports": self.reports.snapshot(),
        }

    def advance(
        self, policy: Policy, now: datetime, *, enabled: bool, held: bool
    ) -> bool:
        """Prune presentation and apply the library's due collections."""
        self.phone_actions.prune(now)
        self.reports.prune(now)
        if not enabled:
            self.delivery.deactivate()
            return False
        before = self.delivery.collections.snapshot()
        changed = False
        for update in self.delivery.collections.advance(now, policy, held=held):
            self.delivery.record_collection(update)
            changed = True
        return changed or self.delivery.collections.snapshot() != before

    def record(
        self,
        deliveries: list[Delivery],
        context: NotificationContext,
        now: datetime,
        *,
        startup: bool,
        held: bool,
    ) -> bool:
        """Compose requests from already-authorized public library deliveries."""
        self.delivery.prepare_reports(deliveries)
        intents = notification_grouping.compatible_intents(context.settings)
        collections = notification_grouping.collection_settings(context.settings)
        requests: list[CollectionRequest] = []
        grouped: list[Delivery] = []
        group_ids: dict[tuple[str, str], str] = {}
        contents: dict[tuple[str, str], dict[str, JSONValue]] = {}
        for delivery in deliveries:
            content = (
                self.content(context, delivery.episode_id)
                if isinstance(delivery, Notification)
                else {}
            )
            if isinstance(delivery, Notification):
                if delivery.route in collections:
                    accepted = collections[delivery.route]
                    instructions = accepted["instructions"]
                    timing = instructions["timing"]
                    requests.append(
                        CollectionRequest(
                            notification=replace(
                                delivery,
                                channels=self.resolve_channels(
                                    context.settings, delivery.channels
                                ),
                            ),
                            group_id=accepted["group_id"],
                            delay=timedelta(seconds=timing["collection_delay_seconds"]),
                            instructions=instructions,
                            content=content,
                            quiet_hours=QuietHours(
                                start=time.fromisoformat(timing["end"]),
                                end=time.fromisoformat(timing["start"]),
                            )
                            if timing["mode"] == "window"
                            else None,
                            timezone=instructions["timezone"],
                        )
                    )
                    continue
                subject = content.get("notification_subject")
                previous = self.delivery.messages.get(
                    f"{delivery.recipient}:{delivery.episode_id}"
                    + (f"_route_{delivery.route}" if delivery.route else "")
                )
                prior_summary = (
                    previous is not None
                    and "group" in previous
                    and str(previous["group"]).startswith("digest_")
                )
                if (
                    subject
                    and delivery.route in intents
                    and delivery.cause != "digest"
                    and not (delivery.silent and prior_summary)
                ):
                    key = (delivery.episode_id, delivery.route)
                    group_ids[key] = f"{subject}:{intents[delivery.route]}"
                    contents[key] = content
                    channels = (
                        tuple(str(channel) for channel in previous["channels"])
                        if delivery.silent
                        and previous is not None
                        and isinstance(previous["channels"], list)
                        else self.resolve_channels(context.settings, delivery.channels)
                    )
                    grouped.append(replace(delivery, channels=channels))
                    continue
            else:
                grouped.append(delivery)
                previous = self.delivery.messages.get(
                    f"{delivery.recipient}:{delivery.episode_id}"
                    + (f"_route_{delivery.route}" if delivery.route else "")
                )
                if previous and str(previous.get("group", "")).startswith("device_"):
                    continue
            self.delivery.record(
                delivery,
                content,
                startup=startup,
                resolve_channels=partial(self.resolve_channels, context.settings),
            )
        for update in sorted(
            self.delivery.groups.apply(grouped, group_ids),
            key=lambda update: not update.closed,
        ):
            self.delivery.record_group(update, contents)
        for collected in self.delivery.collections.apply(
            requests,
            [item for item in deliveries if not isinstance(item, Notification)],
            now,
            context.policy,
            held=held,
            flush=False,
        ):
            self.delivery.record_collection(collected)
        return bool(requests)

    def resolve_channels(
        self, settings: Settings, channels: tuple[str, ...]
    ) -> tuple[str, ...]:
        """Resolve saved methods once for this newly accepted request."""
        result = []
        for channel in channels:
            if channel.startswith("method:"):
                result.extend(
                    notification_definitions.resolve_channels(
                        self.hass, settings.notification_definitions, channel[7:]
                    )
                )
            else:
                result.append(channel)
        return tuple(dict.fromkeys(result))

    def content(
        self, context: NotificationContext, episode_id: str
    ) -> dict[str, JSONValue]:
        """Compose an issue message from current public queries and captured presentation."""
        episode = context.episodes[episode_id]
        anchor = str(episode["anchor"])
        source = context.sources[anchor]
        functions = [
            context.sources[item.node_id]
            for item in context.engine.impact(anchor).nodes
            if context.sources[item.node_id].kind == "function"
        ]
        names: list[JSONValue] = [item.name for item in functions]
        title = source.name
        subject_id = notification_grouping.subject(source)
        subject = context.candidates.get(subject_id) if subject_id else None
        canonical = source.monitoring_source or source.node_id
        original = context.candidates.get(canonical)
        if subject_id:
            title = original.name if original else source.name
        if functions:
            title = f"{', '.join(item.name for item in functions)}: {context.engine.readiness([item.node_id for item in functions]).answer}"
        findings = episode["reasons"]
        assert isinstance(findings, list)
        message = (
            "\n".join(
                str(finding.get("message") or finding["reason"])
                for finding in findings
                if isinstance(finding, dict)
            )
            or "Current evidence is unknown."
        )
        return {
            "schema_version": 1,
            "entry_id": self.entry_id,
            "episode_id": episode_id,
            "tag": self.notification_id(episode_id),
            "title": title,
            **(
                {
                    "notification_subject": subject_id,
                    "notification_subject_name": subject.name if subject else title,
                }
                if subject_id
                else {}
            ),
            "age": f"{max(0, int((context.at - datetime.fromisoformat(str(episode['opened_at']))).total_seconds()) // 3600)}h",
            "message": message,
            "functions": names,
            "cause": anchor,
            "loudness": "urgent"
            if episode["importance"] == Importance.CRITICAL.value
            else "notify",
        }

    def notification_id(self, episode_id: str) -> str:
        """Stable id for replacement and dismissal, scoped to this installation."""
        return f"{DOMAIN}_{self.entry_id}_{episode_id}"

    def prepare_publication(self, now: datetime) -> Publication:
        """Prepare bounded public payloads, undoing partial report creation on error."""
        pending = tuple(self.delivery.outbox)
        before = self.reports.snapshot()
        try:
            payloads = tuple(self.reports.present(payload, now) for payload in pending)
        except OSError, HomeAssistantError, ValueError, TypeError:
            self.reports.restore(before)
            raise
        return Publication(
            pending=pending,
            payloads=payloads,
            previous_reports=before,
            scopes_changed=self.reports.snapshot() != before,
        )

    def rollback_publication(self, batch: Publication) -> None:
        """Undo report scopes when their prepublication save fails."""
        self.reports.restore(batch.previous_reports)

    def publish(self, batch: Publication) -> None:
        """Publish saved requests and remember the exact authorized transport payloads."""
        for payload, public in zip(batch.pending, batch.payloads, strict=True):
            self._resolved_requests[str(payload["delivery_id"])] = public
            if len(self._resolved_requests) > 2000:
                self._resolved_requests.pop(next(iter(self._resolved_requests)))
            self.hass.bus.async_fire(EVENT_NOTIFICATION, public)
        self.delivery.outbox.clear()

    def requeue(self, batch: Publication) -> None:
        """Retain original delivery IDs if clearing the outbox cannot be saved."""
        self.delivery.outbox[:0] = batch.pending

    def authorize(
        self, payload: dict[str, Any], settings: Settings, policy: PolicyConfig
    ) -> AuthorizedRequest | None:
        """Reject forged or no-longer-authorized routes before preparing transport."""
        if not settings.notifications and payload.get("action") != "resolve":
            return None
        delivery_id = payload.get("delivery_id")
        channels = payload.get("channels")
        if (
            not isinstance(delivery_id, str)
            or not delivery_id.startswith(f"{self.entry_id}:")
            or not isinstance(channels, list)
        ):
            return None
        recipient_id = payload.get("recipient")
        if not isinstance(recipient_id, str):
            return None
        recipient = policy.recipients.get(recipient_id)
        resolved = self._resolved_requests.get(delivery_id) == payload
        if recipient is None and not resolved:
            return None
        permitted = (
            set(channels) if resolved else set(recipient.channels if recipient else ())
        )
        allowed = tuple(
            channel
            for channel in channels
            if isinstance(channel, str)
            and channel in permitted
            and channel.startswith(
                ("phone:", "notify:", "satellite:", "tts:", "sms:", "service:")
            )
        )
        return AuthorizedRequest(payload=payload, channels=allowed, resolved=resolved)

    def prepare_attempt(
        self, request: AuthorizedRequest, channel: str, context: NotificationContext
    ) -> SendingAttempt | None:
        """Stage an attempt and exact phone scope under the runtime lock."""
        payload = request.payload
        delivery_id = payload["delivery_id"]
        if request.resolved and self._resolved_requests.get(delivery_id) != payload:
            return None
        identity = f"{delivery_id}:{channel}"
        if identity in self.delivery.attempted:
            return None
        self.delivery.attempted.add(identity)
        previous_actions = deepcopy(self.phone_actions.records)
        shown = payload.get("episodes", [payload.get("episode_id")])
        current = (
            [
                episode_id
                for episode_id in shown
                if isinstance(episode_id, str) and episode_id in context.episodes
            ]
            if isinstance(shown, list)
            else []
        )
        sent_to = [
            context.policy.explain(episode_id)["sent_to"] for episode_id in current
        ]
        acknowledgment = (
            self.phone_actions.prepare(self.hass, payload, channel, context.at)
            if current
            and not (payload.get("message_summarized") is True and len(shown) > 1)
            and any(
                context.policy.acknowledgment(episode_id) is None
                for episode_id in current
            )
            and all(
                isinstance(recipients, list) and payload["recipient"] in recipients
                for recipients in sent_to
            )
            else None
        )
        return SendingAttempt(
            request=request,
            channel=channel,
            identity=identity,
            acknowledgment=acknowledgment,
            previous_actions=previous_actions,
            sending_enabled=context.settings.notifications,
        )

    def rollback_attempt(self, attempt: SendingAttempt) -> None:
        """Undo a staged attempt whose verified save failed."""
        self.delivery.attempted.remove(attempt.identity)
        self.phone_actions.records = attempt.previous_actions

    async def async_send(self, attempt: SendingAttempt) -> None:
        """Send a saved attempt and retain caught Home Assistant route failures."""
        payload, channel = attempt.request.payload, attempt.channel
        try:
            await async_send(
                self.hass,
                channel,
                title=str(payload.get("title", "Homeostatic")),
                message=str(payload.get("message", "")),
                tag=str(payload.get("tag", "")),
                url=notification_url(payload),
                **(
                    {"acknowledgment": attempt.acknowledgment}
                    if attempt.acknowledgment
                    else {}
                ),
                urgent=payload.get("loudness") == "urgent"
                and payload.get("silent") is not True
                and payload.get("action") != "resolve",
                silent=payload.get("silent") is True,
                clear=payload.get("action") == "resolve"
                and (
                    not channel.startswith("phone:")
                    or not attempt.sending_enabled
                    or payload.get("loudness") != "urgent"
                ),
            )
        except HomeAssistantError as err:
            self.failures.append(
                {
                    "delivery_id": payload["delivery_id"],
                    "channel": channel,
                    "error": str(err),
                }
            )
