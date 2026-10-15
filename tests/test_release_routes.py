"""Focused route and policy validation in an isolated Home Assistant instance."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from custom_components.homeostatic import notification_people
from custom_components.homeostatic import notification_routes as routes
from custom_components.homeostatic.notification_routes import Destination


@pytest.mark.parametrize(
    ("mobile", "expected"),
    [
        (None, None),
        ({"devices": {}}, None),
        ({"devices": {"other": SimpleNamespace(id="other")}}, None),
        ({"devices": {"webhook": SimpleNamespace(id="selected")}}, "webhook"),
    ],
)
def test_phone_webhook_resolution(
    hass: HomeAssistant, mobile: Any, expected: str | None
) -> None:
    """Only the selected registered device yields its webhook."""
    hass.data["mobile_app"] = mobile
    assert routes.webhook_id_from_device_id(hass, "selected") == expected


@pytest.mark.parametrize(
    ("mobile", "expected"),
    [
        (None, False),
        ({"config_entries": {}}, False),
        (
            {"config_entries": {"webhook": SimpleNamespace(data={"app_data": {}})}},
            False,
        ),
        (
            {
                "config_entries": {
                    "webhook": SimpleNamespace(data={"app_data": {"push_token": "a"}})
                }
            },
            False,
        ),
        (
            {
                "config_entries": {
                    "webhook": SimpleNamespace(data={"app_data": {"push_url": "b"}})
                }
            },
            False,
        ),
        (
            {
                "config_entries": {
                    "webhook": SimpleNamespace(
                        data={"app_data": {"push_token": "a", "push_url": "b"}}
                    )
                }
            },
            True,
        ),
        (
            {
                "config_entries": {
                    "webhook": SimpleNamespace(
                        data={"app_data": {"push_websocket_channel": "a"}}
                    )
                }
            },
            True,
        ),
        (
            {"config_entries": {"webhook": SimpleNamespace(data={"app_data": "bad"})}},
            False,
        ),
    ],
)
def test_push_registration(hass: HomeAssistant, mobile: Any, expected: bool) -> None:
    """A selected phone needs a complete push registration."""
    hass.data["mobile_app"] = mobile
    assert routes.supports_push(hass, "webhook") is expected


@pytest.mark.parametrize(
    ("mobile", "expected"),
    [
        (None, None),
        ({"notify": None}, None),
        ({"notify": SimpleNamespace(registered_targets={"alice": "webhook"})}, "alice"),
        ({"notify": SimpleNamespace(registered_targets={"alice": "other"})}, None),
        (
            {
                "notify": SimpleNamespace(
                    registered_targets={"alice": "other", "bob": "webhook"}
                )
            },
            "bob",
        ),
    ],
)
def test_registered_notify_service(
    hass: HomeAssistant, mobile: Any, expected: str | None
) -> None:
    """Phone delivery uses the service mapped to its webhook."""
    hass.data["mobile_app"] = mobile
    assert routes.get_notify_service(hass, "webhook") == expected


@pytest.mark.parametrize(
    ("channel", "webhook", "push", "service", "message"),
    [
        ("phone:device", None, True, "alice", "no longer available"),
        ("phone:device", "webhook", False, "alice", "no longer available"),
        ("phone:device", "webhook", True, None, "no notification action"),
        ("unsupported", "webhook", True, "alice", "Unsupported"),
    ],
)
async def test_unavailable_phone_or_unknown_route(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    channel: str,
    webhook: str | None,
    push: bool,
    service: str | None,
    message: str,
) -> None:
    """Unavailable selected routes never request a notification."""
    monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: webhook)
    monkeypatch.setattr(routes, "supports_push", lambda *_: push)
    monkeypatch.setattr(routes, "get_notify_service", lambda *_: service)
    with pytest.raises(HomeAssistantError, match=message):
        await routes.async_send(hass, channel, title="Title", message="Body", tag="tag")


@pytest.mark.parametrize(
    ("urgent", "silent", "clear", "expected_message", "expected_data"),
    [
        (
            True,
            False,
            False,
            "Body",
            {
                "push": {"sound": {"name": "default", "critical": 1, "volume": 1.0}},
                "priority": "high",
                "channel": "Homeostatic urgent",
                "interruption-level": "critical",
                "url": "/homeostatic/notifications",
                "clickAction": "/homeostatic/notifications",
            },
        ),
        (
            False,
            True,
            False,
            "Body",
            {
                "push": {"sound": "none"},
                "alert_once": True,
                "interruption-level": "passive",
                "url": "/homeostatic/notifications",
                "clickAction": "/homeostatic/notifications",
            },
        ),
        (True, False, True, "clear_notification", {}),
    ],
)
async def test_phone_delivery_modes(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    urgent: bool,
    silent: bool,
    clear: bool,
    expected_message: str,
    expected_data: dict[str, Any],
) -> None:
    """Phone requests retain replacement tags and use the selected alert mode."""
    send = AsyncMock()
    monkeypatch.setattr(type(hass.services), "async_call", send)
    monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: "webhook")
    monkeypatch.setattr(routes, "supports_push", lambda *_: True)
    monkeypatch.setattr(routes, "get_notify_service", lambda *_: "alice")
    await routes.async_send(
        hass,
        "phone:device",
        title="Title",
        message="Body",
        tag="tag",
        urgent=urgent,
        silent=silent,
        clear=clear,
    )
    send.assert_awaited_once_with(
        "notify",
        "alice",
        {
            "message": expected_message,
            "title": "Title",
            "data": {"tag": "tag", "group": "homeostatic", **expected_data},
            "target": "webhook",
        },
        blocking=True,
    )


@pytest.mark.parametrize(
    ("entity", "clear", "error"),
    [
        (None, False, "unavailable"),
        (SimpleNamespace(domain="sensor", disabled_by=None), False, "unavailable"),
        (SimpleNamespace(domain="notify", disabled_by="user"), False, "unavailable"),
        (
            SimpleNamespace(
                domain="notify", disabled_by=None, entity_id="notify.owner"
            ),
            True,
            None,
        ),
        (
            SimpleNamespace(
                domain="notify", disabled_by=None, entity_id="notify.owner"
            ),
            False,
            None,
        ),
    ],
)
async def test_notify_entity_route(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    entity: Any,
    clear: bool,
    error: str | None,
) -> None:
    """Only an enabled current notify entity receives a message request."""
    send = AsyncMock()
    monkeypatch.setattr(type(hass.services), "async_call", send)
    registry = SimpleNamespace(entities=SimpleNamespace(get_entry=lambda _: entity))
    monkeypatch.setattr(routes.er, "async_get", lambda _: registry)
    if error is not None:
        with pytest.raises(HomeAssistantError, match=error):
            await routes.async_send(
                hass,
                "notify:selected",
                title="Title",
                message="Body",
                tag="tag",
                clear=clear,
            )
        send.assert_not_awaited()
        return
    await routes.async_send(
        hass,
        "notify:selected",
        title="Title",
        message="Body",
        tag="tag",
        clear=clear,
    )
    if clear:
        send.assert_not_awaited()
    else:
        send.assert_awaited_once_with(
            "notify",
            "send_message",
            {"entity_id": "notify.owner", "title": "Title", "message": "Body"},
            blocking=True,
        )


@pytest.mark.parametrize(
    ("platform", "device_id", "phone_channel"),
    [
        pytest.param("test", None, None, id="independent-message"),
        pytest.param("test", "phone-device", None, id="other-platform-same-device"),
        pytest.param("mobile_app", "other-device", None, id="unmatched-mobile-device"),
        pytest.param(
            "mobile_app", "phone-device", "phone:phone-device", id="same-phone-alias"
        ),
    ],
)
def test_destination_catalog_uses_current_registry_and_state(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    platform: str,
    device_id: str | None,
    phone_channel: str | None,
) -> None:
    """Displayed routes reflect current phones and enabled notify entities."""
    phone = SimpleNamespace(
        id="phone-device", config_entries={"entry"}, name="Kitchen phone"
    )
    notify = SimpleNamespace(
        id="notify-id",
        domain="notify",
        disabled_by=None,
        entity_id="notify.owner",
        name="Fallback",
        platform=platform,
        device_id=device_id,
    )
    disabled = SimpleNamespace(
        id="disabled",
        domain="notify",
        disabled_by="user",
        entity_id="notify.disabled",
    )
    other = SimpleNamespace(id="other", domain="sensor", disabled_by=None)
    monkeypatch.setattr(
        routes.dr, "async_get", lambda _: SimpleNamespace(devices=[phone])
    )
    monkeypatch.setattr(
        routes.er,
        "async_get",
        lambda _: SimpleNamespace(
            entities={
                "notify.owner": notify,
                "notify.disabled": disabled,
                "sensor.other": other,
            }
        ),
    )
    entry = SimpleNamespace(
        entry_id="entry", data={"device_name": "Owner phone", "user_id": "owner"}
    )
    absent = SimpleNamespace(entry_id="absent", data={})
    monkeypatch.setattr(
        type(hass.config_entries), "async_entries", lambda self, _: [entry, absent]
    )
    monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: "webhook")
    monkeypatch.setattr(routes, "supports_push", lambda *_: True)
    monkeypatch.setattr(routes, "get_notify_service", lambda *_: "owner")
    hass.states.async_set("notify.owner", "ready", {"friendly_name": "Owner inbox"})
    assert routes.destinations(hass) == [
        Destination(
            channel="notify:notify-id",
            name="Owner inbox",
            user_id=None,
            available=True,
            phone_channel=phone_channel,
        ),
        Destination(
            channel="phone:phone-device",
            name="Owner phone",
            user_id="owner",
            available=True,
        ),
    ]
    monkeypatch.undo()


async def test_available_people_requires_linked_current_users() -> None:
    """Only linked people with current HA users appear in the editor."""
    states = [
        SimpleNamespace(name="No person id", attributes={"user_id": "admin"}),
        SimpleNamespace(name="No user id", attributes={"id": "missing"}),
        SimpleNamespace(name="Gone", attributes={"id": "gone", "user_id": "gone"}),
        SimpleNamespace(
            name="Zoe",
            entity_id="person.zoe_renamed",
            attributes={"id": "zoe", "user_id": "member"},
        ),
        SimpleNamespace(
            name="Alice",
            entity_id="person.alice_renamed",
            attributes={"id": "alice", "user_id": "admin"},
        ),
    ]

    async def get_user(user_id: str) -> Any:
        users = {
            "member": SimpleNamespace(is_admin=False),
            "admin": SimpleNamespace(is_admin=True),
        }
        return users.get(user_id)

    fake_hass = SimpleNamespace(
        states=SimpleNamespace(async_all=lambda _: states),
        auth=SimpleNamespace(async_get_user=get_user),
    )
    assert await notification_people.available_people(fake_hass) == [
        {
            "id": "alice",
            "entity_id": "person.alice_renamed",
            "name": "Alice",
            "user_id": "admin",
            "administrator": True,
        },
        {
            "id": "zoe",
            "entity_id": "person.zoe_renamed",
            "name": "Zoe",
            "user_id": "member",
            "administrator": False,
        },
    ]


async def test_phone_action_payload(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both Companion platforms receive the explicit authenticated action and detail link."""
    monkeypatch.setattr(routes, "webhook_id_from_device_id", lambda *_: "webhook")
    monkeypatch.setattr(routes, "supports_push", lambda *_: True)
    monkeypatch.setattr(routes, "get_notify_service", lambda *_: "alice")
    send = AsyncMock()
    hass.services.async_register("notify", "alice", send)
    await routes.async_send(
        hass,
        "phone:device",
        title="Leak",
        message="Wet",
        tag="tag",
        url="/homeostatic/episode/one",
        acknowledgment="HOMEOSTATIC_ACK_example",
    )
    data = send.call_args.args[0].data["data"]
    assert data["actions"] == [
        {
            "action": "HOMEOSTATIC_ACK_example",
            "title": "Acknowledge",
            "authenticationRequired": True,
        }
    ]
    assert data["url"] == data["clickAction"] == "/homeostatic/episode/one"
