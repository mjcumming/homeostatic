"""Person routing scenarios in an isolated Home Assistant instance."""

from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant, ServiceCall
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_routes, simple_notifications
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.notification_routes import Destination
from tests.test_lifecycle import start_monitor


def test_admin_fault_and_household_situation_routes(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The generated policy separates faults from actionable home alerts."""
    routes = [
        Destination(
            channel="phone:admin", name="Admin phone", user_id="a", available=True
        ),
        Destination(
            channel="phone:home", name="Home phone", user_id="h", available=True
        ),
    ]
    monkeypatch.setattr(simple_notifications, "destinations", lambda _hass: routes)
    people = [
        {"id": "admin", "name": "Admin", "user_id": "a", "administrator": True},
        {"id": "home", "name": "Home", "user_id": "h", "administrator": False},
    ]
    policy = simple_notifications.generate_policy(
        hass,
        {
            "timezone": "UTC",
            "people": {
                "admin": {"level": "Important", "channels": ["phone:admin"]},
                "home": {"level": "All", "channels": ["phone:home"]},
            },
        },
        people,
    )
    assert policy["rules"][3]["to"] == ["person:admin"]
    assert policy["rules"][4]["to"] == ["person:admin", "person:home"]
    assert policy["rules"][5]["to"] == ["person:admin"]
    assert simple_notifications.simple_choices(policy) is not None
    build_policy(policy, timedelta(0))


def test_other_users_phone_is_rejected(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A route cannot silently be assigned to the wrong person."""
    monkeypatch.setattr(
        simple_notifications,
        "destinations",
        lambda _hass: [
            Destination(
                channel="phone:other",
                name="Other phone",
                user_id="other",
                available=True,
            )
        ],
    )
    with pytest.raises(ValueError, match="belongs to another person"):
        simple_notifications.generate_policy(
            hass,
            {
                "timezone": "UTC",
                "people": {
                    "admin": {"level": "Important", "channels": ["phone:other"]}
                },
            },
            [
                {
                    "id": "admin",
                    "name": "Admin",
                    "user_id": "admin",
                    "administrator": True,
                }
            ],
        )


async def test_phone_route_requests_only_selected_service(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A phone test uses its resolved webhook and preserves its replacement tag."""
    calls: list[dict[str, Any]] = []

    async def receive(call: ServiceCall) -> None:
        calls.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_admin", receive)
    monkeypatch.setattr(
        notification_routes,
        "webhook_id_from_device_id",
        lambda _hass, _id: "webhook-admin",
    )
    monkeypatch.setattr(notification_routes, "supports_push", lambda _hass, _id: True)
    monkeypatch.setattr(
        notification_routes, "get_notify_service", lambda _hass, _id: "mobile_app_admin"
    )
    await notification_routes.async_send(
        hass, "phone:admin", title="Test", message="Hello", tag="homeostatic_test"
    )
    assert calls == [
        {
            "message": "Hello",
            "title": "Test",
            "data": {"tag": "homeostatic_test", "group": "homeostatic"},
            "target": "webhook-admin",
        }
    ]


async def test_replayed_request_uses_one_durable_route_attempt(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A repeated bus request does not call a built-in route twice."""
    route = Destination(
        channel="phone:admin", name="Admin phone", user_id="a", available=True
    )
    monkeypatch.setattr(simple_notifications, "destinations", lambda _hass: [route])
    policy = simple_notifications.generate_policy(
        hass,
        {
            "timezone": "UTC",
            "people": {"admin": {"level": "Important", "channels": ["phone:admin"]}},
        },
        [{"id": "admin", "name": "Admin", "user_id": "a", "administrator": True}],
    )
    config_data.update(policy=policy, consumer=None)
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    send = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", send)
    payload = {
        "delivery_id": f"{entry.entry_id}:123",
        "channels": ["phone:admin"],
        "recipient": "person:admin",
        "title": "Test problem",
        "message": "Check the source",
        "tag": "homeostatic_test",
        "loudness": "notify",
        "action": "open",
    }
    await runtime.async_send_notification(payload)
    await runtime.async_send_notification(payload)
    send.assert_awaited_once()
    assert f"{entry.entry_id}:123:phone:admin" in runtime.delivery.attempted
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    await restored.async_send_notification(payload)
    send.assert_awaited_once()
    assert await hass.config_entries.async_unload(entry.entry_id)
