"""Saved-method previews and explicit tests through authenticated WebSockets."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from homeassistant.auth.models import User
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard, notification_definitions
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.runtime import Runtime
from tests.test_lifecycle import start_monitor


@pytest.fixture
async def saved_method(
    hass: HomeAssistant, config_data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> tuple[Runtime, AsyncMock, list[dict[str, Any]]]:
    """Load a real adapter with isolated, mocked notification transports."""
    definitions = notification_definitions.defaults()
    definitions["methods"] = {
        "mixed": {
            "name": "All methods",
            "mode": "fixed",
            "destinations": [
                "phone:owner",
                "notify:email",
                "satellite:kitchen",
                "tts:provider:speaker",
                "sms:twilio:%2B15551234567",
            ],
        },
        "presence": {
            "name": "Home or away",
            "mode": "home_away",
            "people": ["person.owner"],
            "home": ["satellite:kitchen"],
            "away": ["phone:owner"],
            "fallback": [],
            "skip": True,
        },
    }
    config_data.update(notifications=False, notification_definitions=definitions)
    hass.states.async_set("sensor.observed", "42")
    hass.states.async_set("person.owner", "home")
    runtime = await start_monitor(
        hass, MockConfigEntry(domain=DOMAIN, data=config_data)
    )
    catalog = [
        {
            "channel": "phone:owner",
            "name": "Owner phone",
            "type": "app",
            "available": True,
        },
        {
            "channel": "notify:email",
            "name": "Email",
            "type": "email",
            "available": True,
        },
        {
            "channel": "satellite:kitchen",
            "name": "Kitchen",
            "type": "voice",
            "available": True,
        },
        {
            "channel": "tts:provider:speaker",
            "name": "TTS speaker",
            "type": "voice",
            "available": True,
        },
        {
            "channel": "sms:twilio:",
            "name": "Twilio",
            "type": "sms",
            "available": True,
            "requires_target": True,
        },
    ]
    monkeypatch.setattr(dashboard, "delivery_targets", lambda _: catalog)
    send = AsyncMock()
    monkeypatch.setattr(dashboard, "async_send", send)
    return runtime, send, catalog


async def test_preview_then_explicit_mixed_test(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Only an explicit send contacts the exact app, voice, email and SMS targets."""
    runtime, send, _ = saved_method
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    revision = (await client.receive_json())["result"]["revision"]
    request = {"method_id": "mixed", "revision": revision}
    await client.send_json(
        {"id": 2, "type": "homeostatic/preview_delivery_method", **request}
    )
    preview = (await client.receive_json())["result"]
    assert preview["targets"][-1]["name"] == "Twilio → +15551234567"
    assert preview["skipped"] is False
    assert runtime.delivery.outbox == []
    assert runtime.settings.notifications is False
    send.assert_not_awaited()
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    result = (await client.receive_json())["result"]
    expected = [target["channel"] for target in preview["targets"]]
    assert result == {"requested": expected, "failed": [], "skipped": False}
    assert [call.args[1] for call in send.await_args_list] == expected
    assert runtime.delivery.outbox == []
    assert runtime.episodes == {}
    await client.close()


@pytest.mark.parametrize(
    "state",
    [
        pytest.param("not_home", id="new-targets"),
        pytest.param("Work", id="named-zone"),
        pytest.param("unknown", id="unknown-fallback"),
    ],
)
async def test_changed_presence_invalidates_test(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
    state: str,
) -> None:
    """The sender rejects an old preview instead of silently choosing new people."""
    _, send, _ = saved_method
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    revision = (await client.receive_json())["result"]["revision"]
    request = {"method_id": "presence", "revision": revision}
    await client.send_json(
        {"id": 2, "type": "homeostatic/preview_delivery_method", **request}
    )
    preview = (await client.receive_json())["result"]
    assert preview["presence"]["person.owner"]["state"] == "home"
    hass.states.async_set("person.owner", state)
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "preview_required"
    send.assert_not_awaited()
    await client.close()


async def test_skip_preview_sends_nothing(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The configured fallback can explicitly skip, including an explicit test."""
    _, send, _ = saved_method
    hass.states.async_set("person.owner", "unknown")
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    revision = (await client.receive_json())["result"]["revision"]
    request = {"method_id": "presence", "revision": revision}
    await client.send_json(
        {"id": 2, "type": "homeostatic/preview_delivery_method", **request}
    )
    preview = (await client.receive_json())["result"]
    assert preview["targets"] == []
    assert preview["skipped"] is True
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["result"] == {
        "requested": [],
        "failed": [],
        "skipped": True,
    }
    send.assert_not_awaited()
    await client.close()


async def test_unavailable_targets_and_changed_configuration(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A stale or unavailable preview rejects the whole batch before any request."""
    runtime, send, catalog = saved_method
    catalog[0]["available"] = False
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    revision = (await client.receive_json())["result"]["revision"]
    request = {"method_id": "mixed", "revision": revision}
    await client.send_json(
        {"id": 2, "type": "homeostatic/preview_delivery_method", **request}
    )
    preview = (await client.receive_json())["result"]
    assert preview["targets"][0]["available"] is False
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "invalid_route"
    hass.config_entries.async_update_entry(
        runtime.entry, options={**runtime.entry.data, "consumer": None}
    )
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "invalid_method"
    send.assert_not_awaited()
    await client.close()


async def test_transport_failure_is_reported_per_target(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A provider failure leaves other explicitly selected requests accountable."""
    _, send, _ = saved_method
    send.side_effect = [None, HomeAssistantError("Provider failed"), None, None, None]
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    revision = (await client.receive_json())["result"]["revision"]
    request = {"method_id": "mixed", "revision": revision}
    await client.send_json(
        {"id": 2, "type": "homeostatic/preview_delivery_method", **request}
    )
    preview = (await client.receive_json())["result"]
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/test_delivery_method",
            **request,
            "preview_token": preview["preview_token"],
        }
    )
    result = (await client.receive_json())["result"]
    assert result["failed"] == [{"channel": "notify:email", "error": "Provider failed"}]
    assert len(result["requested"]) == 4
    assert send.await_count == 5
    await client.close()


@pytest.mark.parametrize(
    "command",
    [
        pytest.param(
            {
                "type": "homeostatic/preview_delivery_method",
                "method_id": "mixed",
                "revision": "revision",
            },
            id="preview",
        ),
        pytest.param(
            {
                "type": "homeostatic/test_delivery_method",
                "method_id": "mixed",
                "revision": "revision",
                "preview_token": "token",
            },
            id="send",
        ),
    ],
)
async def test_method_tests_require_administrator(
    hass: HomeAssistant,
    saved_method: tuple[Runtime, AsyncMock, list[dict[str, Any]]],
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: User,
    command: dict[str, Any],
) -> None:
    """A non-administrator cannot inspect or send method-test requests."""
    _, send, _ = saved_method
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, client_id="http://test.local"
    )
    client = await hass_ws_client(
        hass, access_token=hass.auth.async_create_access_token(refresh)
    )
    await client.send_json({"id": 1, **command})
    assert (await client.receive_json())["error"]["code"] == "unauthorized"
    send.assert_not_awaited()
    await client.close()
