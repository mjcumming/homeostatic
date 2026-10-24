"""Exercise actual Core phone services with a wholly mocked push gateway."""

import logging
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components.mobile_app.notify import MobileAppNotificationService
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.json import json_bytes
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_routes as routes
from custom_components.homeostatic.notification_reports import NotificationReports
from tests.test_notification_reports import large_payload


async def setup_phone(hass: HomeAssistant) -> tuple[str, AsyncMock]:
    """Register Core's real phone service; replace only its external HTTP client."""
    entry = MockConfigEntry(
        domain="mobile_app",
        title="Synthetic phone",
        data={
            "webhook_id": "synthetic-webhook",
            "device_name": "Synthetic phone",
            "device_id": "synthetic-device",
            "app_id": "io.homeassistant.companion.ios",
            "app_version": "2026.10",
            "os_version": "26.0",
            "manufacturer": "Apple",
            "app_data": {
                "push_url": "https://push.invalid",
                "push_token": "synthetic-token",
            },
        },
    )
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("mobile_app", "synthetic-device")}
    )
    service = MobileAppNotificationService()
    hass.data["mobile_app"] = {
        "config_entries": {"synthetic-webhook": entry},
        "devices": {"synthetic-webhook": device},
        "notify": service,
        "push_channel": {},
        "live_activity_tokens": {},
    }
    await service.async_setup(hass, "mobile_app", "mobile_app")
    await service.async_register_services()
    return f"phone:{device.id}", AsyncMock()


async def test_core_gateway_rejects_old_report_and_accepts_compact_request(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture
) -> None:
    """Reproduce a provider rejection, then verify the complete corrected path."""
    channel, post = await setup_phone(hass)
    received: list[dict[str, Any]] = []

    async def gateway(_url: str, *, json: dict[str, Any]) -> SimpleNamespace:
        received.append(json)
        rejected = len(json_bytes(json)) > 4096
        return SimpleNamespace(
            status=413 if rejected else 200,
            json=AsyncMock(
                return_value={"message": "Payload too large"} if rejected else {}
            ),
        )

    post.side_effect = gateway
    original = large_payload()
    original.update(tag="synthetic-report")
    service = routes.get_notify_service(hass, "synthetic-webhook")
    assert service is not None
    with patch(
        "homeassistant.components.mobile_app.notify.async_get_clientsession",
        return_value=SimpleNamespace(post=post),
    ):
        # Core catches and logs the gateway's error instead of failing this call.
        await hass.services.async_call(
            "notify",
            service,
            {
                "message": original["message"],
                "title": original["title"],
                "data": {
                    "url": routes.notification_url(original),
                    "clickAction": routes.notification_url(original),
                },
            },
            blocking=True,
        )
        assert len(received) == 1 and len(json_bytes(received[0])) > 4096
        errors = [
            record
            for record in caplog.records
            if record.name == "homeassistant.components.mobile_app.notify"
            and record.levelno >= logging.ERROR
        ]
        assert len(errors) == 1
        public = NotificationReports("synthetic").present(original, dt_util.utcnow())
        await routes.async_send(
            hass,
            channel,
            title=public["title"],
            message=public["message"],
            tag=public["tag"],
            url=routes.notification_url(public),
            urgent=True,
        )
    assert len(received) == 2
    assert len(json_bytes(received[1])) < 3000
    assert (
        received[1]["data"]["url"]
        == received[1]["data"]["clickAction"]
        == public["details_url"]
    )
    assert public["episodes"] == original["episodes"]
    assert (
        len(
            [
                record
                for record in caplog.records
                if record.name == "homeassistant.components.mobile_app.notify"
                and record.levelno >= logging.ERROR
            ]
        )
        == 1
    )


@pytest.mark.parametrize("field", ["message", "url", "acknowledgment"])
async def test_oversized_phone_request_fails_before_core_can_hide_rejection(
    hass: HomeAssistant, field: str
) -> None:
    """Unbounded callers get a visible HA error and never reach the provider."""
    channel, post = await setup_phone(hass)
    kwargs = {
        "title": "Synthetic test",
        "message": "Synthetic message",
        "tag": "synthetic",
        field: '🏠\\"' * 3000,
    }
    with (
        patch(
            "homeassistant.components.mobile_app.notify.async_get_clientsession",
            return_value=SimpleNamespace(post=post),
        ),
        pytest.raises(HomeAssistantError, match="size budget"),
    ):
        await routes.async_send(hass, channel, **kwargs)
    post.assert_not_awaited()
