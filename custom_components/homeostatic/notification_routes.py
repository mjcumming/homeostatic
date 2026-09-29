"""Resolve owner-selected Home Assistant notification destinations."""

from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from urllib.parse import quote

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er


def webhook_id_from_device_id(hass: HomeAssistant, device_id: str) -> str | None:
    """Resolve the selected registry device through loaded mobile registrations."""
    mobile = hass.data.get("mobile_app")
    if not isinstance(mobile, dict):
        return None
    for webhook_id, device in mobile.get("devices", {}).items():
        if device.id == device_id:
            return str(webhook_id)
    return None


def supports_push(hass: HomeAssistant, webhook_id: str) -> bool:
    """Accept only a registration with a usable push channel."""
    mobile = hass.data.get("mobile_app")
    if not isinstance(mobile, dict):
        return False
    entry = mobile.get("config_entries", {}).get(webhook_id)
    if entry is None:
        return False
    app_data = entry.data.get("app_data", {})
    return isinstance(app_data, dict) and (
        ("push_token" in app_data and "push_url" in app_data)
        or "push_websocket_channel" in app_data
    )


def get_notify_service(hass: HomeAssistant, webhook_id: str) -> str | None:
    """Use HA's registered target map instead of guessing a service name."""
    mobile = hass.data.get("mobile_app")
    if not isinstance(mobile, dict):
        return None
    notify = mobile.get("notify")
    if notify is None:
        return None
    for service, target in notify.registered_targets.items():
        if target == webhook_id:
            return str(service)
    return None


@dataclass(frozen=True, slots=True, kw_only=True)
class Destination:
    """One stable route with its current display name and owner."""

    channel: str
    name: str
    user_id: str | None
    available: bool
    phone_channel: str | None = None


def destinations(hass: HomeAssistant) -> list[Destination]:
    """List supported phone and message routes without guessing delivery."""
    result: list[Destination] = []
    phones: set[str] = set()
    devices = dr.async_get(hass)
    for entry in hass.config_entries.async_entries("mobile_app"):
        device = next(
            (item for item in devices.devices if entry.entry_id in item.config_entries),
            None,
        )
        if device is None:
            continue
        webhook_id = webhook_id_from_device_id(hass, device.id)
        ready = bool(
            webhook_id
            and supports_push(hass, webhook_id)
            and get_notify_service(hass, webhook_id)
        )
        result.append(
            Destination(
                channel=f"phone:{device.id}",
                name=str(entry.data.get("device_name") or device.name or "Phone"),
                user_id=entry.data.get("user_id"),
                available=ready,
            )
        )
        phones.add(device.id)
    for entity in er.async_get(hass).entities.values():
        if entity.domain != "notify" or entity.disabled_by is not None:
            continue
        state = hass.states.get(entity.entity_id)
        result.append(
            Destination(
                channel=f"notify:{entity.id}",
                name=state.name if state else entity.name or entity.entity_id,
                user_id=None,
                available=state is not None and state.state != "unavailable",
                phone_channel=(
                    f"phone:{entity.device_id}"
                    if entity.platform == "mobile_app" and entity.device_id in phones
                    else None
                ),
            )
        )
    return sorted(result, key=lambda item: (item.name.casefold(), item.channel))


def notification_url(payload: dict[str, Any]) -> str:
    """Link individual deliveries to history-safe issue detail on the HA server."""
    episode_id = payload.get("episode_id")
    if payload.get("episodes") is not None or payload.get("action") in {
        "summary",
        "digest",
    }:
        return "/homeostatic/issues"
    if isinstance(episode_id, str) and episode_id:
        return f"/homeostatic/episode/{quote(episode_id, safe='')}"
    return "/homeostatic/issues"


async def async_send(
    hass: HomeAssistant,
    channel: str,
    *,
    title: str,
    message: str,
    tag: str,
    urgent: bool = False,
    silent: bool = False,
    clear: bool = False,
    url: str = "/homeostatic/notifications",
) -> None:
    """Request one delivery through a currently valid selected route."""
    if channel.startswith("phone:"):
        device_id = channel[6:]
        webhook_id = webhook_id_from_device_id(hass, device_id)
        if not webhook_id or not supports_push(hass, webhook_id):
            raise HomeAssistantError("Selected phone is no longer available")
        service = get_notify_service(hass, webhook_id)
        if service is None:
            raise HomeAssistantError("Selected phone has no notification action")
        phone_tag = sha256(tag.encode()).hexdigest() if len(tag.encode()) > 64 else tag
        notification_data: dict[str, Any] = {"tag": phone_tag, "group": "homeostatic"}
        if clear:
            message = "clear_notification"
        else:
            notification_data.update(url=url, clickAction=url)
            if urgent:
                notification_data.update(
                    {
                        "push": {
                            "sound": {"name": "default", "critical": 1, "volume": 1.0}
                        },
                        "priority": "high",
                        "channel": "Homeostatic urgent",
                        "interruption-level": "critical",
                    }
                )
            elif silent:
                notification_data.update(
                    {
                        "push": {"sound": "none"},
                        "alert_once": True,
                        "interruption-level": "passive",
                    }
                )
        await hass.services.async_call(
            "notify",
            service,
            {
                "message": message,
                "title": title,
                "data": notification_data,
                "target": webhook_id,
            },
            blocking=True,
        )
        return
    if channel.startswith("notify:"):
        entity = er.async_get(hass).entities.get_entry(channel[7:])
        if (
            entity is None
            or entity.domain != "notify"
            or entity.disabled_by is not None
        ):
            raise HomeAssistantError("Selected message destination is unavailable")
        if clear or silent:
            return
        await hass.services.async_call(
            "notify",
            "send_message",
            {"entity_id": entity.entity_id, "title": title, "message": message},
            blocking=True,
        )
        return
    raise HomeAssistantError("Unsupported notification destination")
