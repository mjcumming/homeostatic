"""Focused route and policy validation in an isolated Home Assistant instance."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from custom_components.homeostatic import notification_routes as routes
from custom_components.homeostatic import simple_notifications as simple
from custom_components.homeostatic.attention import DEFAULT_POLICY
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
    ("level", "channels", "error"),
    [
        ("Unexpected", ["phone:admin"], "valid notification level"),
        ("Important", [], "Choose a destination"),
        (
            "Important",
            ["phone:admin", "phone:admin"],
            "distinct notification destinations",
        ),
        ("Important", ["phone:missing"], "unavailable or belongs"),
    ],
)
def test_invalid_person_choices(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    level: str,
    channels: list[str],
    error: str,
) -> None:
    """Policy generation rejects invalid levels and stale or repeated routes."""
    monkeypatch.setattr(
        simple,
        "destinations",
        lambda _: [
            Destination(
                channel="phone:admin", name="Admin", user_id="admin", available=True
            )
        ],
    )
    with pytest.raises(ValueError, match=error):
        simple.generate_policy(
            hass,
            {
                "timezone": "UTC",
                "people": {"admin": {"level": level, "channels": channels}},
            },
            [{"id": "admin", "user_id": "admin", "administrator": True}],
        )


def test_simple_choices_detects_edits(hass: HomeAssistant) -> None:
    """A changed generated policy cannot be silently edited as simple choices."""
    assert simple.simple_choices(DEFAULT_POLICY) == {"people": {}, "timezone": "UTC"}
    assert simple.simple_choices({"timezone": "UTC"}) is None
    assert simple.simple_choices({"generated": {"version": "simple-v1"}}) is None
    assert (
        simple.simple_choices(
            {
                "generated": {
                    "version": "simple-v1",
                    "choices": {"people": [], "timezone": "UTC"},
                }
            }
        )
        is None
    )
    assert (
        simple.simple_choices(
            {
                "generated": {
                    "version": "simple-v1",
                    "choices": {"people": {}, "timezone": 2},
                }
            }
        )
        is None
    )
    assert (
        simple.simple_choices(
            {
                "generated": {
                    "version": "simple-v1",
                    "choices": {"people": {}, "timezone": "UTC"},
                    "hash": "wrong",
                },
            }
        )
        is None
    )


@pytest.mark.parametrize(
    "choices",
    [
        {},
        {"people": []},
        {"timezone": "UTC", "people": {"missing": {"level": "Off", "channels": []}}},
        {"timezone": "UTC", "people": {"admin": {"level": "Off", "channels": "bad"}}},
    ],
)
def test_invalid_policy_shape(hass: HomeAssistant, choices: dict[str, Any]) -> None:
    """Unknown people and malformed choice documents are rejected."""
    with pytest.raises(ValueError):
        simple.generate_policy(
            hass,
            choices,
            [{"id": "admin", "user_id": "admin", "administrator": True}],
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


def test_destination_catalog_uses_current_registry_and_state(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
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
            channel="notify:notify-id", name="Owner inbox", user_id=None, available=True
        ),
        Destination(
            channel="phone:phone-device",
            name="Owner phone",
            user_id="owner",
            available=True,
        ),
    ]
    monkeypatch.undo()


@pytest.mark.parametrize(
    ("level", "admin", "expected"),
    [
        ("Off", True, None),
        ("Urgent only", True, "person:person"),
        ("Everything", True, "person:person"),
        ("All", False, "person:person"),
        ("Urgent only", False, "person:person"),
    ],
)
def test_person_policy_levels(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    level: str,
    admin: bool,
    expected: str | None,
) -> None:
    """Policy rules follow a person's selected role and notification level."""
    monkeypatch.setattr(
        simple,
        "destinations",
        lambda _: [
            Destination(
                channel="notify:shared", name="Shared", user_id=None, available=True
            )
        ],
    )
    result = simple.generate_policy(
        hass,
        {
            "timezone": "UTC",
            "people": {
                "person": {
                    "level": level,
                    "channels": ["notify:shared"],
                    "quiet_hours": {"start": "22:00", "end": "07:00"},
                }
            },
        },
        [{"id": "person", "user_id": "owner", "administrator": admin}],
    )
    assert (next(iter(result["recipients"]), None)) == expected
    if expected:
        assert result["recipients"][expected]["quiet_hours"] == {
            "start": "22:00",
            "end": "07:00",
        }
        assert simple.simple_choices(result) is not None


async def test_available_people_requires_linked_current_users() -> None:
    """Only linked people with current HA users appear in the editor."""
    states = [
        SimpleNamespace(name="No person id", attributes={"user_id": "admin"}),
        SimpleNamespace(name="No user id", attributes={"id": "missing"}),
        SimpleNamespace(name="Gone", attributes={"id": "gone", "user_id": "gone"}),
        SimpleNamespace(name="Zoe", attributes={"id": "zoe", "user_id": "member"}),
        SimpleNamespace(name="Alice", attributes={"id": "alice", "user_id": "admin"}),
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
    assert await simple.available_people(fake_hass) == [
        {"id": "alice", "name": "Alice", "user_id": "admin", "administrator": True},
        {"id": "zoe", "name": "Zoe", "user_id": "member", "administrator": False},
    ]


@pytest.mark.parametrize(
    ("choice", "route", "error"),
    [
        (
            {"level": "Everything", "channels": ["notify:shared"]},
            True,
            "valid notification level",
        ),
        ({"level": "All", "channels": [1]}, True, "distinct notification destinations"),
        (
            {"level": "All", "channels": ["notify:shared"]},
            False,
            "unavailable or belongs",
        ),
    ],
)
def test_household_policy_rejects_invalid_routes(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    choice: dict[str, Any],
    route: bool,
    error: str,
) -> None:
    """Household levels and route availability are validated separately."""
    monkeypatch.setattr(
        simple,
        "destinations",
        lambda _: [
            Destination(
                channel="notify:shared", name="Shared", user_id=None, available=route
            )
        ],
    )
    with pytest.raises(ValueError, match=error):
        simple.generate_policy(
            hass,
            {"timezone": "UTC", "people": {"member": choice}},
            [{"id": "member", "user_id": "member", "administrator": False}],
        )
