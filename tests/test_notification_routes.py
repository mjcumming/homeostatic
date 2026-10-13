"""Delivery discovery scenarios use provider identity and stable saved routes."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er

from custom_components.homeostatic import notification_definitions, notification_routes
from custom_components.homeostatic.notification_routes import Destination


class NotifyProvider:
    """Stand in for a loaded Core legacy notify service owner."""

    async def send(self, call: ServiceCall) -> None:
        """Accept a mocked service request."""


def test_legacy_classification_uses_provider_identity(hass: HomeAssistant) -> None:
    """Renamed SMS providers work while misleading action names remain generic."""
    sms = NotifyProvider()
    email = NotifyProvider()
    unknown = NotifyProvider()
    hass.data["notify_services"] = {"twilio_sms": [sms], "smtp": [email]}
    hass.services.async_register("notify", "house_messages", sms.send)
    hass.services.async_register("notify", "house_mail", email.send)
    hass.services.async_register("notify", "twilio_sms", unknown.send)
    hass.services.async_register("notify", "alexa_media", unknown.send)
    targets = {
        row["channel"]: row for row in notification_routes.delivery_targets(hass)
    }
    assert targets["sms:house_messages:"]["requires_target"] is True
    assert targets["sms:house_messages:"]["type"] == "sms"
    assert targets["service:house_mail"]["type"] == "email"
    assert targets["service:twilio_sms"]["type"] == "notification"
    assert targets["service:alexa_media"]["requires_target"] is False


def test_notify_entity_classification_and_saved_phone_alias(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A mobile alias stays resolvable without becoming another new destination."""
    registry = er.async_get(hass)
    mobile = registry.async_get_or_create("notify", "mobile_app", "phone")
    other = registry.async_get_or_create("notify", "some_provider", "not_mail")
    smtp = registry.async_get_or_create("notify", "smtp", "mail")
    for entity in (mobile, other, smtp):
        hass.states.async_set(entity.entity_id, "unknown")
    monkeypatch.setattr(
        notification_routes,
        "destinations",
        lambda _: [
            Destination(
                channel="phone:phone", name="Phone", user_id="owner", available=True
            ),
            Destination(
                channel=f"notify:{mobile.id}",
                name="Phone",
                user_id=None,
                available=True,
                phone_channel="phone:phone",
            ),
            Destination(
                channel=f"notify:{other.id}", name="Other", user_id=None, available=True
            ),
            Destination(
                channel=f"notify:{smtp.id}", name="Mail", user_id=None, available=True
            ),
        ],
    )
    targets = {
        row["channel"]: row for row in notification_routes.delivery_targets(hass)
    }
    assert targets[f"notify:{mobile.id}"]["alias_of"] == "phone:phone"
    assert targets[f"notify:{mobile.id}"]["type"] == "app"
    assert targets[f"notify:{other.id}"]["type"] == "notification"
    assert targets[f"notify:{other.id}"]["available"] is True
    assert targets[f"notify:{smtp.id}"]["type"] == "email"
    hass.states.async_set(other.entity_id, "unknown", {"restored": True})
    restored = {
        row["channel"]: row for row in notification_routes.delivery_targets(hass)
    }
    assert restored[f"notify:{other.id}"]["available"] is False


def test_voice_discovery_groups_speakers_and_keeps_saved_unavailable_routes(
    hass: HomeAssistant,
) -> None:
    """Friendly speaker/provider metadata does not offer incapable media players."""
    registry = er.async_get(hass)
    area = ar.async_get(hass).async_create("Kitchen")
    first = registry.async_get_or_create("tts", "test", "first")
    second = registry.async_get_or_create("tts", "test", "second")
    speaker = registry.async_get_or_create(
        "media_player", "test", "speaker", supported_features=512
    )
    registry.async_update_entity(speaker.entity_id, area_id=area.id)
    unsupported = registry.async_get_or_create("media_player", "test", "unsupported")
    satellite = registry.async_get_or_create("assist_satellite", "test", "unsupported")
    hass.states.async_set(first.entity_id, "unknown", {"friendly_name": "Local speech"})
    hass.states.async_set(
        second.entity_id, "unknown", {"friendly_name": "Cloud speech"}
    )
    hass.states.async_set(
        speaker.entity_id, "off", {"friendly_name": "Kitchen speaker"}
    )
    hass.services.async_register("tts", "speak", AsyncMock())
    targets = notification_routes.delivery_targets(hass)
    assert {row["destination_id"] for row in targets} == {speaker.id}
    assert {row["provider_name"] for row in targets} == {"Local speech", "Cloud speech"}
    assert all(
        row["name"] == "Kitchen speaker" and row["area"] == "Kitchen" for row in targets
    )
    assert all(row["available"] for row in targets)
    assert all(
        unsupported.id not in row["channel"] and satellite.id not in row["channel"]
        for row in targets
    )
    hass.states.async_set(
        speaker.entity_id, "unavailable", {"friendly_name": "Kitchen speaker"}
    )
    unavailable = notification_routes.delivery_targets(hass)
    assert {row["channel"] for row in unavailable} == {
        row["channel"] for row in targets
    }
    assert not any(row["available"] for row in unavailable)


async def test_generic_notification_saved_route_sends_without_a_phone_target(
    hass: HomeAssistant,
) -> None:
    """Unknown notify providers accept a message without invented SMS arguments."""
    calls: list[dict[str, Any]] = []

    async def receive(call: ServiceCall) -> None:
        calls.append(dict(call.data))

    hass.services.async_register("notify", "living_room", receive)
    definitions = notification_definitions.defaults("UTC")
    definitions["methods"]["screen"] = {
        "name": "Living room",
        "mode": "fixed",
        "destinations": ["service:living_room"],
    }
    notification_definitions.validate(definitions)
    await notification_routes.async_send(
        hass, "service:living_room", title="Test", message="Hello", tag="test"
    )
    assert calls == [{"title": "Test", "message": "Hello"}]
    await notification_routes.async_send(
        hass,
        "service:living_room",
        title="Test",
        message="Hello",
        tag="test",
        silent=True,
    )
    assert len(calls) == 1
    hass.services.async_remove("notify", "living_room")
    with pytest.raises(HomeAssistantError, match="unavailable"):
        await notification_routes.async_send(
            hass, "service:living_room", title="Test", message="Hello", tag="test"
        )
