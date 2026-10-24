"""Bounded notification requests preserve exact membership across HA restarts."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import notification_routes as routes
from custom_components.homeostatic import notifications as notifications_module
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.notification_reports import (
    MAX_MESSAGE_BYTES,
    MAX_TITLE_BYTES,
    RETENTION,
    NotificationReports,
    bounded_text,
    notification_url,
)
from tests.test_lifecycle import start_monitor
from tests.test_notification_collection import advance, configure


def large_payload(count: int = 221) -> dict[str, Any]:
    """Represent a report of individually addressable issues with long findings."""
    return {
        "schema_version": 1,
        "action": "summary",
        "delivery_id": "entry:1",
        "episodes": [f"{index:036d}" for index in range(count)],
        "title": f"Homeostatic: {count} issues need attention",
        "message": "\n".join(
            f"Kitchen sensor {index}: {'missing 🏠 ' * 15}" for index in range(count)
        ),
        "_alerting": True,
    }


@pytest.mark.parametrize("text", ['🏠é\\"\n' * 1000, "a" * 10000])
def test_encoded_text_budget(text: str) -> None:
    """Unicode and JSON escaping fit the byte budget without invalid characters."""
    result = bounded_text(text, MAX_MESSAGE_BYTES)
    assert len(json_bytes(result)) <= MAX_MESSAGE_BYTES
    assert text.startswith(result.removesuffix("…"))
    assert bounded_text("small", MAX_MESSAGE_BYTES) == "small"
    with pytest.raises(ValueError, match="suffix"):
        bounded_text(text, 1)


def test_compact_report_preserves_v1_and_exact_scope() -> None:
    """Short human text and links never truncate machine-readable membership."""
    reports = NotificationReports("entry")
    original = large_payload()
    original["title"] = "House 🏠 é" * 200
    before = deepcopy(original)
    now = dt_util.utcnow()
    payload = reports.present(original, now)
    assert original == before
    assert payload["schema_version"] == 1
    assert payload["episodes"] == original["episodes"]
    assert payload["message_summarized"] is True
    assert payload["issue_count"] == 221
    assert "_alerting" not in payload
    assert len(json_bytes(payload)) < 32768
    assert len(json_bytes(payload["message"])) <= MAX_MESSAGE_BYTES
    assert len(json_bytes(payload["title"])) <= MAX_TITLE_BYTES
    url = notification_url(payload)
    assert len(url) < 100
    restored = NotificationReports("entry")
    restored.restore(reports.snapshot())
    reference = url.rsplit("/", 1)[1]
    page = restored.view(reference, now, limit=200)
    assert page["episodes"] == original["episodes"][:200]
    assert page["next_offset"] == 200
    assert (
        restored.view(reference, now, offset=200)["episodes"]
        == original["episodes"][200:]
    )
    snapshot = restored.snapshot()
    assert restored.view(reference, now + RETENTION)["status"] == "expired"
    assert (
        restored.snapshot() == snapshot
    )  # Queries do not extend retention or mutate storage.
    corrupt = deepcopy(snapshot)
    corrupt[reference]["episodes"].append("later-issue")
    with pytest.raises(ValueError, match="membership changed"):
        restored.restore(corrupt)
    assert restored.snapshot() == snapshot
    reports.present(large_payload(222), now + timedelta(seconds=1))
    assert reports.view(reference, now)["episodes"] == original["episodes"][:200]


def test_large_v1_membership_limit_is_explicit() -> None:
    """Compatibility keeps all IDs even when they alone exceed Recorder's limit."""
    payload = NotificationReports("entry").present(
        large_payload(1000), dt_util.utcnow()
    )
    assert len(payload["episodes"]) == 1000
    assert len(json_bytes(payload)) > 32768
    assert len(notification_url(payload)) < 100


def test_retention_and_validated_local_links(monkeypatch: pytest.MonkeyPatch) -> None:
    """Oldest scopes expire under the cap; external or malformed URLs are ignored."""
    from custom_components.homeostatic import notification_reports as module

    monkeypatch.setattr(module, "MAX_REPORTS", 1)
    reports = NotificationReports("entry")
    now = dt_util.utcnow()
    first = reports.present(large_payload(10), now)
    reports.present(large_payload(11), now + timedelta(seconds=1))
    assert (
        reports.view(notification_url(first).rsplit("/", 1)[1], now)["status"]
        == "expired"
    )
    for url in ("https://example.org", "/homeostatic/notification/invalid"):
        assert (
            notification_url({"details_url": url, "episodes": ["one"]})
            == "/homeostatic/episode/one"
        )
    with pytest.raises(ValueError):
        reports.view("invalid", now)
    with pytest.raises(ValueError):
        reports.restore([])
    reports.prune(now + RETENTION + timedelta(seconds=2))
    assert reports.snapshot() == {}


async def test_221_issue_report_phone_and_repeat_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Real HA collection, sender and authenticated reader keep a frozen report."""
    configure(config_data)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        "phone:mine"
    ]
    monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: "webhook")
    monkeypatch.setattr(routes, "supports_push", lambda *_: True)
    monkeypatch.setattr(routes, "get_notify_service", lambda *_: "mobile_app_test")
    for index in range(222):
        hass.states.async_set(
            f"sensor.payload_{index}",
            "42",
            {"friendly_name": f"House 🏠 sensor {index} " + "é" * 100},
        )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    calls = async_mock_service(hass, "notify", "mobile_app_test")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    for index in range(221):
        hass.states.async_set(
            f"sensor.payload_{index}",
            "unavailable",
            {"friendly_name": f"House 🏠 sensor {index} " + "é" * 100},
        )
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    [event] = events
    [call] = calls
    assert len(event.data["episodes"]) == 221
    assert event.data["message_summarized"] is True
    assert len(json_bytes(dict(event.data))) < 32768
    assert len(json_bytes(dict(call.data))) < 3000
    assert len(json_bytes(event.data["title"])) <= MAX_TITLE_BYTES
    assert (
        call.data["data"]["url"]
        == call.data["data"]["clickAction"]
        == event.data["details_url"]
    )
    assert (
        "actions" not in call.data["data"]
    )  # Never acknowledge an unseen multi-issue preview.
    reference = event.data["details_url"].rsplit("/", 1)[1]
    stored = await runtime.store.async_load()
    assert (
        stored["notification_reports"][reference]["episodes"] == event.data["episodes"]
    )
    options = deepcopy(dict(entry.options))
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert (
            runtime.query("notification_report", {"reference": reference})["total"]
            == 221
        )
        assert dict(entry.options) == options
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/notification_report",
            "reference": reference,
            "offset": 200,
        }
    )
    response = await client.receive_json()
    assert response["success"]
    assert response["result"]["episodes"] == event.data["episodes"][200:]
    await client.send_json(
        {
            "id": 2,
            "type": "call_service",
            "domain": DOMAIN,
            "service": "notification_report",
            "service_data": {"reference": reference, "offset": 200},
            "return_response": True,
        }
    )
    action = await client.receive_json()
    assert action["success"]
    assert action["result"]["response"] == response["result"]
    result = await hass.services.async_call(
        DOMAIN,
        "notification_report",
        {"reference": reference, "offset": 200},
        blocking=True,
        return_response=True,
    )
    assert result["episodes"] == event.data["episodes"][200:]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_report_persist_failure_never_publishes_an_unresolvable_link(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A failed prepublication save preserves raw outbox IDs for a safe retry."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    pending = large_payload()
    pending["delivery_id"] = f"{config_entry.entry_id}:123"
    runtime.notifications.delivery.outbox.append(pending)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch.object(runtime, "_save", AsyncMock(side_effect=OSError("disk full"))),
        pytest.raises(OSError),
    ):
        await runtime._flush_events()
    await hass.async_block_till_done()
    assert not events
    assert runtime.notifications.reports.snapshot() == {}
    assert runtime.notifications.delivery.outbox == [pending]
    with patch.object(runtime, "_save", AsyncMock()) as save:
        await runtime._flush_events()
    await hass.async_block_till_done()
    assert save.await_count == 2
    assert events[0].data["delivery_id"] == pending["delivery_id"]
    assert runtime.notifications.delivery.outbox == []
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_older_store_preserves_choices_and_pending_delivery_on_repeat_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """An existing schema-three store gains link storage without resetting data."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    [message] = runtime.notifications.delivery.messages.values()
    pending = deepcopy(message)
    pending["delivery_id"] = f"{config_entry.entry_id}:pending-upgrade"
    options = deepcopy(dict(config_entry.options))
    data = deepcopy(dict(config_entry.data))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    old = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    old.pop("notification_reports")
    old["delivery"]["outbox"] = [pending]
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    for _ in range(2):
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()
        assert dict(config_entry.options) == options
        assert dict(config_entry.data) == data
        runtime = config_entry.runtime_data
        assert (
            next(iter(runtime.notifications.delivery.messages.values()))["tag"]
            == message["tag"]
        )
        assert runtime.notifications.delivery.outbox == []
        assert runtime.settings.notifications
        assert await hass.config_entries.async_unload(config_entry.entry_id)
    replayed = [
        event.data
        for event in events
        if event.data["delivery_id"] == pending["delivery_id"]
    ]
    assert len(replayed) == 1
    assert replayed[0]["channels"] == pending["channels"]
    assert replayed[0]["episode_id"] == pending["episode_id"]


async def test_short_preview_never_acknowledges_an_unseen_remaining_member(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Recovery before I/O cannot put an Acknowledge action on a short preview."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    [message] = runtime.notifications._resolved_requests.values()
    payload = {
        **message,
        "delivery_id": f"{config_entry.entry_id}:preview",
        "channels": ["phone:mine"],
        "episodes": ["already-ended", next(iter(runtime.episodes))],
        "message_summarized": True,
    }
    runtime.notifications._resolved_requests[payload["delivery_id"]] = payload
    with (
        patch.object(runtime.notifications.phone_actions, "prepare") as prepare,
        patch.object(notifications_module, "async_send", AsyncMock()) as send,
    ):
        await runtime.async_send_notification(payload)
    prepare.assert_not_called()
    send.assert_awaited_once()
    assert send.call_args.kwargs.get("acknowledgment") is None
    assert await hass.config_entries.async_unload(config_entry.entry_id)
