"""Resolve owner-selected Home Assistant notification destinations."""

from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from urllib.parse import quote, unquote

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

# Importing optional integration packages loads providers and their dependencies.
# These public feature bits are defined by Core's entity platform contracts.
_SATELLITE_ANNOUNCE = 1
_PLAYER_PLAY_MEDIA = 512


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
            iter(dr.async_entries_for_config_entry(devices, entry.entry_id)), None
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


def _legacy_providers(hass: HomeAssistant) -> dict[int, str]:
    """Match registered legacy service owners to Core's loaded notify platforms."""
    loaded = hass.data.get("notify_services", {})
    if not isinstance(loaded, dict):
        return {}
    return {
        id(provider): platform
        for platform, providers in loaded.items()
        for provider in providers
    }


def delivery_targets(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Discover configured notification capabilities without requesting delivery."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    areas = ar.async_get(hass)

    def name(entity: er.RegistryEntry) -> str:
        state = hass.states.get(entity.entity_id)
        return (
            state.name
            if state
            else entity.name or entity.original_name or entity.entity_id
        )

    def area(entity: er.RegistryEntry) -> str | None:
        device = devices.async_get(entity.device_id) if entity.device_id else None
        area_id = entity.area_id or (device.area_id if device else None)
        selected = areas.async_get_area(area_id) if area_id else None
        return selected.name if selected else None

    def available(entity: er.RegistryEntry) -> bool:
        state = hass.states.get(entity.entity_id)
        device = devices.async_get(entity.device_id) if entity.device_id else None
        return (
            entity.disabled_by is None
            and (device is None or device.disabled_by is None)
            and state is not None
            and state.state != "unavailable"
            and not state.attributes.get("restored", False)
        )

    result: list[dict[str, Any]] = []
    for route in destinations(hass):
        phone = route.channel.startswith("phone:")
        entity = registry.entities.get_entry(route.channel[7:]) if not phone else None
        platform = entity.platform if entity else "mobile_app"
        result.append(
            {
                "channel": route.channel,
                "name": route.name,
                "type": {"mobile_app": "app", "smtp": "email"}.get(
                    platform, "notification"
                ),
                "available": available(entity) if entity else route.available,
                "user_id": route.user_id,
                "alias_of": route.phone_channel,
                "area": area(entity) if entity else None,
                "replace": phone,
                "acknowledgment": phone,
            }
        )
    entries = [item for item in registry.entities.values() if item.disabled_by is None]
    players = [
        item
        for item in entries
        if item.domain == "media_player"
        and item.supported_features & _PLAYER_PLAY_MEDIA
    ]
    for entity in entries:
        if (
            entity.domain == "assist_satellite"
            and entity.supported_features & _SATELLITE_ANNOUNCE
        ):
            result.append(
                {
                    "channel": f"satellite:{entity.id}",
                    "name": name(entity),
                    "destination_id": entity.id,
                    "destination_name": name(entity),
                    "area": area(entity),
                    "type": "voice",
                    "available": available(entity)
                    and hass.services.has_service("assist_satellite", "announce"),
                    "replace": False,
                    "acknowledgment": False,
                }
            )
        elif entity.domain == "tts":
            for player in players:
                result.append(
                    {
                        "channel": f"tts:{entity.id}:{player.id}",
                        "name": name(player),
                        "destination_id": player.id,
                        "destination_name": name(player),
                        "provider_id": entity.id,
                        "provider_name": name(entity),
                        "area": area(player),
                        "type": "voice",
                        "available": available(entity)
                        and available(player)
                        and hass.services.has_service("tts", "speak"),
                        "replace": False,
                        "acknowledgment": False,
                    }
                )
    providers = _legacy_providers(hass)
    for service, definition in hass.services.async_services().get("notify", {}).items():
        if service == "send_message" or service.startswith("mobile_app_"):
            continue
        owner = getattr(definition.job.target, "__self__", None)
        provider_platform = providers.get(id(owner), "")
        # Core's notify base schema accepts target for every provider; only a
        # verified provider contract establishes that it means a phone number.
        kind = {"twilio_sms": "sms", "smtp": "email"}.get(
            provider_platform, "notification"
        )
        result.append(
            {
                "channel": f"sms:{service}:" if kind == "sms" else f"service:{service}",
                "name": service.replace("_", " ").capitalize(),
                "service": f"notify.{service}",
                "type": kind,
                "available": True,
                "requires_target": kind == "sms",
                "replace": False,
                "acknowledgment": False,
            }
        )
    return sorted(
        result, key=lambda item: (str(item["name"]).casefold(), str(item["channel"]))
    )


def _entity(hass: HomeAssistant, identity: str, domain: str) -> er.RegistryEntry:
    entity = er.async_get(hass).entities.get_entry(identity)
    if entity is None or entity.domain != domain or entity.disabled_by is not None:
        raise HomeAssistantError("Selected destination is unavailable")
    state = hass.states.get(entity.entity_id)
    if (
        state is None
        or state.state == "unavailable"
        or state.attributes.get("restored", False)
    ):
        raise HomeAssistantError("Selected destination is unavailable")
    return entity


def notification_url(payload: dict[str, Any]) -> str:
    """Keep the delivered membership in a history-safe issue destination."""
    included = payload.get("episodes")
    if isinstance(included, list):
        identities = list(
            dict.fromkeys(item for item in included if isinstance(item, str) and item)
        )
        if len(identities) == 1:
            return f"/homeostatic/episode/{quote(identities[0], safe='')}"
        members = ",".join(quote(item, safe="") for item in identities)
        return f"/homeostatic/issues/notification/{members}"
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
    acknowledgment: str | None = None,
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
            if acknowledgment:
                notification_data["actions"] = [
                    {
                        "action": acknowledgment,
                        "title": "Acknowledge",
                        "authenticationRequired": True,
                    }
                ]
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
        if clear or silent:
            return
        entity = er.async_get(hass).entities.get_entry(channel[7:])
        if (
            entity is None
            or entity.domain != "notify"
            or entity.disabled_by is not None
        ):
            raise HomeAssistantError("Selected message destination is unavailable")
        # HA's notify action validates the loaded entity and its availability.
        await hass.services.async_call(
            "notify",
            "send_message",
            {"entity_id": entity.entity_id, "title": title, "message": message},
            blocking=True,
        )
        return
    if channel.startswith("service:"):
        if clear or silent:
            return
        service = channel[8:]
        if (
            not service
            or service == "send_message"
            or service.startswith("mobile_app_")
            or not hass.services.has_service("notify", service)
        ):
            raise HomeAssistantError("Selected notification action is unavailable")
        await hass.services.async_call(
            "notify", service, {"title": title, "message": message}, blocking=True
        )
        return
    if channel.startswith(("satellite:", "tts:", "sms:")):
        if clear or silent:
            return
        if channel.startswith("satellite:"):
            entity = _entity(hass, channel[10:], "assist_satellite")
            if not entity.supported_features & _SATELLITE_ANNOUNCE:
                raise HomeAssistantError(
                    "Selected satellite does not support announcements"
                )
            await hass.services.async_call(
                "assist_satellite",
                "announce",
                {"entity_id": entity.entity_id, "message": message},
                blocking=True,
            )
        elif channel.startswith("tts:"):
            parts = channel.split(":")
            if len(parts) != 3:
                raise HomeAssistantError("Choose a TTS provider and media player")
            provider = _entity(hass, parts[1], "tts")
            player = _entity(hass, parts[2], "media_player")
            if not player.supported_features & _PLAYER_PLAY_MEDIA:
                raise HomeAssistantError("Selected media player cannot play media")
            await hass.services.async_call(
                "tts",
                "speak",
                {
                    "entity_id": provider.entity_id,
                    "media_player_entity_id": player.entity_id,
                    "message": message,
                },
                blocking=True,
            )
        else:
            parts = channel.split(":")
            if (
                len(parts) != 3
                or not parts[1]
                or not parts[2]
                or parts[1] == "send_message"
                or parts[1].startswith("mobile_app_")
            ):
                raise HomeAssistantError(
                    "Choose an SMS notification action and recipient"
                )
            await hass.services.async_call(
                "notify",
                parts[1],
                {"message": message, "target": [unquote(parts[2])]},
                blocking=True,
            )
        return
    raise HomeAssistantError("Unsupported notification destination")


def unavailable_destinations(hass: HomeAssistant, policy: dict[str, Any]) -> list[str]:
    """Report configured built-in destinations that no longer accept requests."""
    configured = {
        channel
        for recipient in policy["recipients"].values()
        for channel in recipient["channels"]
        if channel.startswith(("phone:", "notify:"))
    }
    if not configured:
        return []
    available = {route.channel for route in destinations(hass) if route.available}
    return sorted(configured - available)
