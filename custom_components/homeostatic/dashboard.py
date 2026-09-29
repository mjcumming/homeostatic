"""Authenticated dashboard presentation using public health-tree queries."""

import asyncio
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import voluptuous as vol
from health_tree.types import JSONValue
from homeassistant.components import frontend, websocket_api
from homeassistant.components.http.server import StaticPathConfig
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.components.websocket_api.decorators import (
    require_admin,
    websocket_command,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.util.hass_dict import HassKey

from . import reporting
from .config import Settings, normalize_rules, rule_data
from .const import DEFAULTS, DOMAIN, NAME
from .notification_routes import async_send, destinations
from .runtime import Runtime
from .serialization import json_object
from .simple_notifications import available_people, generate_policy, simple_choices

DATA_DASHBOARD: HassKey[Dashboard] = HassKey("homeostatic_dashboard")
SIGNAL_DASHBOARD = "homeostatic_dashboard_updated"
ASSET_URL = "/homeostatic_static"
MODULE_URL = f"{ASSET_URL}/homeostatic.js?v=39"
PANEL_ELEMENT = "homeostatic-panel-v22"


def _digest(value: dict[str, Any]) -> str:
    """Identify one exact saved configuration or proposed rule list."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _configuration(runtime: Runtime) -> tuple[dict[str, Any], str]:
    """Read the effective options and their concurrency revision."""
    current = dict(runtime.entry.options or runtime.entry.data)
    return current, _digest(current)


def snapshot(runtime: Runtime | None) -> dict[str, JSONValue]:
    """Build a versioned read model without advancing monitoring or policy."""
    result: dict[str, JSONValue] = {
        "schema_version": 1,
        "available": False,
        "entry_id": runtime.entry.entry_id if runtime else None,
        "updated_at": (
            runtime.updated_at.isoformat()
            if runtime and runtime.updated_at is not None
            else None
        ),
        "error": runtime.error if runtime else None,
    }
    if runtime is None or not runtime.available:
        return result
    assert runtime.engine is not None
    areas = ar.async_get(runtime.hass)
    devices = dr.async_get(runtime.hass)
    floors = fr.async_get(runtime.hass)
    return {
        **result,
        "available": True,
        "readiness": runtime.query("readiness", {}),
        "inventory": {**runtime.inventory_static, **runtime.inventory_updates()},
        "coverage": runtime.query("coverage", {}),
        "evidence_gaps": runtime.evidence_gaps,
        "policy": runtime.query("policy", {}),
        "functions": [
            {
                "node_id": source.node_id,
                "name": source.name,
                "importance": source.importance.value,
                "requirements": list(source.requirements),
                "readiness": json_object(runtime.engine.readiness([source.node_id])),
            }
            for source in runtime.sources.values()
            if source.kind == "function"
        ],
        "areas": [
            {"id": area.id, "name": area.name, "floor_id": area.floor_id}
            for area in areas.areas.values()
        ],
        "devices": [
            {
                "id": device.id,
                "name": device.name_by_user or device.name or device.id,
                "disabled": device.disabled_by is not None,
            }
            for device in devices.devices
        ],
        "floors": [
            {"id": floor.floor_id, "name": floor.name}
            for floor in floors.floors.values()
        ],
    }


class Dashboard:
    """Share one publication across connected cards and survive entry reloads."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Keep the transport lifecycle separate from the monitoring runtime."""
        self.hass = hass
        self.runtime: Runtime | None = None
        self.value = snapshot(None)
        self.update = self.value
        self.catalog_revision = 0
        self._catalog: dict[str, JSONValue] | None = None
        self._locations: dict[str, JSONValue] = {}
        self._cancel: Callable[[], None] | None = None
        self.save_lock = asyncio.Lock()

    @callback
    def attach(self, runtime: Runtime | None) -> None:
        """Replace the runtime listener and announce startup or unavailability."""
        if self._cancel is not None:
            self._cancel()
            self._cancel = None
        self.runtime = runtime
        if runtime is not None:
            self._cancel = async_dispatcher_connect(
                self.hass, runtime.signal, self.publish
            )
        self.publish()

    @callback
    def publish(self) -> None:
        """Cache one consistent evaluated view for all active subscriptions."""
        self.value = snapshot(self.runtime)
        if self.runtime is not None and self.runtime.available:
            if self._catalog is not self.runtime.inventory_static:
                self._catalog = self.runtime.inventory_static
                self.catalog_revision += 1
                self._locations = {
                    key: self.value[key] for key in ("areas", "devices", "floors")
                }
            self.value.update(self._locations)
            dynamic = self.runtime.inventory_updates()
            self.update = {
                **{
                    key: value
                    for key, value in self.value.items()
                    if key not in {"inventory", "areas", "devices", "floors"}
                },
                "schema_version": 2,
                "catalog_revision": self.catalog_revision,
                "inventory_changed": False,
                "inventory": dynamic,
            }
        else:
            self._catalog = None
            self.update = {**self.value, "schema_version": 2}
        async_dispatcher_send(self.hass, SIGNAL_DASHBOARD)


@websocket_command(
    {
        vol.Required("type"): "homeostatic/subscribe",
        vol.Optional("compact", default=False): bool,
    }
)
@require_admin
@callback
def websocket_subscribe(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send an initial view and updates until the client unsubscribes."""
    revision: int | None = None

    @callback
    def send() -> None:
        nonlocal revision
        dashboard = hass.data[DATA_DASHBOARD]
        payload = dashboard.value
        if msg["compact"]:
            if not payload["available"]:
                revision = None
                payload = dashboard.update
            elif revision == dashboard.catalog_revision:
                payload = dashboard.update
            else:
                revision = dashboard.catalog_revision
                payload = {
                    **payload,
                    "schema_version": 2,
                    "catalog_revision": revision,
                    "inventory_changed": True,
                }
        connection.send_event(msg["id"], payload)

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_DASHBOARD, send
    )
    connection.send_result(msg["id"])
    send()


@websocket_command(
    {
        vol.Required("type"): "homeostatic/node",
        vol.Required("node_id"): str,
    }
)
@require_admin
@callback
def websocket_node(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Explain one current node, with no access to private engine state."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Monitoring is unavailable")
        return
    node_id = msg["node_id"]
    if node_id not in runtime.sources:
        connection.send_error(
            msg["id"], "not_found", "This capability is no longer monitored"
        )
        return
    source = runtime.sources[node_id]
    connection.send_result(
        msg["id"],
        {
            "source": json_object(source),
            "integration_evidence": runtime.integration_evidence.view(node_id),
            "entity_status": runtime.entity_status(node_id),
            "device_evidence": runtime.device_evidence(node_id),
            "explanation": runtime.query("explain", {"node_id": node_id}),
            "impact": runtime.query("impact", {"node_id": node_id}),
            "readiness": (
                runtime.query("readiness", {"node_ids": [node_id]})
                if source.kind != "situation"
                else None
            ),
            "updated_at": runtime.updated_at.isoformat()
            if runtime.updated_at is not None
            else None,
        },
    )


@websocket_command(
    {vol.Required("type"): "homeostatic/source", vol.Required("node_id"): str}
)
@require_admin
@callback
def websocket_source(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Read current HA observations for a discovered source without enrolling it."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Monitoring is unavailable")
        return
    node_id = msg["node_id"]
    source = runtime.candidates.get(node_id)
    if source is None:
        connection.send_error(
            msg["id"], "not_found", "This source is no longer discovered"
        )
        return
    entity_ids = (
        source.availability_entities
        if source.kind == "device"
        else ((source.entity_id,) if source.entity_id else ())
    )
    candidates = {
        item.entity_id: item for item in runtime.candidates.values() if item.entity_id
    }
    members = []
    for entity_id in entity_ids:
        member = candidates.get(entity_id)
        state = hass.states.get(entity_id)
        members.append(
            {
                "node_id": member.node_id
                if member
                else f"entity:entity_id:{entity_id}",
                "entity_id": entity_id,
                "name": member.name if member else entity_id,
                "state": state.state if state is not None else "missing",
                "restored": bool(state and state.attributes.get("restored")),
            }
        )
    members.sort(
        key=lambda item: (
            item["state"] not in {"unavailable", "unknown", "missing"},
            str(item["name"]),
        )
    )
    evidence = runtime.integration_evidence.view(node_id) or {}
    if source.kind == "integration" and source.entry_id:
        entry = hass.config_entries.async_get_entry(source.entry_id)
        if entry is not None and not evidence.get("current"):
            evidence = {**evidence, "current": {"reason": entry.state.value}}
    connection.send_result(
        msg["id"],
        {
            "members": members[:50],
            "total": len(members),
            "unavailable_count": sum(
                item["state"] == "unavailable" for item in members
            ),
            "unknown_count": sum(
                item["state"] in {"unknown", "missing"} or bool(item["restored"])
                for item in members
            ),
            "integration_evidence": evidence,
            "entity_status": runtime.entity_status(node_id)
            if node_id in runtime.sources
            else None,
            "updated_at": runtime.updated_at.isoformat()
            if runtime.updated_at
            else None,
        },
    )


@websocket_command({vol.Required("type"): "homeostatic/configuration"})
@require_admin
def websocket_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Provide the current saved settings without a second configuration store."""
    hass.async_create_task(_async_configuration(hass, connection, msg))


async def _async_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Include current people and destinations in the administrator editor."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is not loaded")
        return
    current, revision = _configuration(runtime)
    settings = Settings.from_data(current)
    consumer = hass.states.get(settings.consumer) if settings.consumer else None
    connection.send_result(
        msg["id"],
        {
            "revision": revision,
            "rules": rule_data(hass, settings),
            "settings": _editable_settings(settings),
            "notification_people": await available_people(hass),
            "notification_destinations": [
                {
                    "channel": item.channel,
                    "name": item.name,
                    "user_id": item.user_id,
                    "available": item.available,
                    "phone_channel": item.phone_channel,
                }
                for item in destinations(hass)
            ],
            "alerts": {
                "notifications": settings.notifications,
                "consumer": settings.consumer,
                "consumer_state": consumer.state if consumer else None,
                "policy": settings.policy,
            },
            "consumers": [
                {
                    "entity_id": state.entity_id,
                    "name": state.name,
                    "state": state.state,
                }
                for state in hass.states.async_all("automation")
            ],
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/test_notification",
        vol.Required("channel"): str,
    }
)
@require_admin
@callback
def websocket_test_notification(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Request a fixed test through one currently available route."""
    hass.async_create_task(_async_test_notification(hass, connection, msg))


async def _async_test_notification(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Keep a route test outside episodes, policy clocks, and the outbox."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
        return
    channel = msg["channel"]
    if not any(
        item.channel == channel and item.available for item in destinations(hass)
    ):
        connection.send_error(msg["id"], "invalid_route", "Destination unavailable")
        return
    try:
        await async_send(
            hass,
            channel,
            title="Homeostatic test",
            message="Homeostatic test: this route works",
            tag="homeostatic_test",
        )
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "delivery_failed", str(err))
        return
    connection.send_result(msg["id"], {"requested": True})


def _editable_settings(settings: Settings) -> dict[str, Any]:
    """Expose only installation options supported by the dashboard editor."""
    return {
        "timings": dict(settings.timings),
        "notifications": settings.notifications,
        "consumer": settings.consumer,
        "policy": settings.policy,
        "simple_notifications": simple_choices(settings.policy),
        "reporting": reporting.choices(settings.policy),
    }


async def _settings_candidate(
    hass: HomeAssistant, current: dict[str, Any], proposed: dict[str, Any]
) -> dict[str, Any]:
    """Preserve unrelated options and validate a complete editable proposal."""
    if set(proposed) not in (
        {"timings", "notifications", "consumer", "policy"},
        {"timings", "notifications", "consumer", "policy", "simple_notifications"},
        {
            "timings",
            "notifications",
            "consumer",
            "policy",
            "simple_notifications",
            "reporting",
        },
    ):
        raise ValueError("Provide timing, notification, consumer, and policy settings")
    if not isinstance(proposed["timings"], dict) or set(proposed["timings"]) != set(
        DEFAULTS
    ):
        raise ValueError("Provide every supported timing")
    candidate = {
        **current,
        **{
            key: value
            for key, value in proposed.items()
            if key not in {"simple_notifications", "reporting"}
        },
    }
    simple = proposed.get("simple_notifications")
    if simple is not None and simple != simple_choices(
        Settings.from_data(current).policy
    ):
        candidate["policy"] = generate_policy(
            hass, simple, await available_people(hass)
        )
        if candidate.get("consumer"):
            raise ValueError(
                "Clear the existing notification automation before switching to person delivery"
            )
    requested_reporting = proposed.get("reporting")
    if requested_reporting is not None:
        if (
            requested_reporting != reporting.choices(Settings.from_data(current).policy)
            or proposed["notifications"]
        ):
            candidate["policy"] = reporting.generate(
                hass, requested_reporting, await available_people(hass)
            )
            if candidate.get("consumer"):
                raise ValueError(
                    "Clear the existing notification automation before switching"
                )
        if proposed["notifications"] and reporting.missing_profiles(
            requested_reporting
        ):
            raise ValueError(
                "Choose people and destinations for every used reporting profile"
            )
    settings = Settings.from_data(candidate)
    previous = Settings.from_data(current)
    if settings.notifications and (
        not previous.notifications or settings.consumer != previous.consumer
    ):
        consumer = hass.states.get(settings.consumer) if settings.consumer else None
        built_in = any(
            channel.startswith(("phone:", "notify:"))
            for recipient in settings.policy_config().recipients.values()
            for channel in recipient.channels
        )
        if not built_in and (consumer is None or consumer.state != "on"):
            raise ValueError("Enable the selected consumer automation first")
    return candidate


@websocket_command(
    {
        vol.Required("type"): "homeostatic/preview_settings",
        vol.Required("revision"): str,
        vol.Required("settings"): dict,
    }
)
@require_admin
@callback
def websocket_preview_settings(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Review timing and notification options without advancing live monitoring."""
    hass.async_create_task(_async_preview_settings(hass, connection, msg))


async def _async_preview_settings(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Validate people and routes before returning an exact review token."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
        return
    current, revision = _configuration(runtime)
    if msg["revision"] != revision:
        connection.send_error(
            msg["id"], "stale_configuration", "Settings changed; reload this page"
        )
        return
    try:
        candidate = await _settings_candidate(hass, current, msg["settings"])
        settings = Settings.from_data(candidate)
        policy = runtime.preview_policy(settings.policy)
    except (ValueError, TypeError, KeyError, vol.Invalid) as err:
        connection.send_error(msg["id"], "invalid_settings", str(err))
        return
    connection.send_result(
        msg["id"],
        {
            "preview_token": _digest(
                {"revision": revision, "settings": msg["settings"]}
            ),
            "before": _editable_settings(Settings.from_data(current)),
            "after": msg["settings"],
            "activating": settings.notifications
            and not Settings.from_data(current).notifications,
            "requests_now": len(cast(list[JSONValue], policy["deliveries"])),
            "open_problems": len(runtime.episodes),
            "reporting_assignments": len(
                msg["settings"].get("reporting", {}).get("assignments", {})
            )
            if msg["settings"].get("reporting")
            else 0,
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/save_settings",
        vol.Required("revision"): str,
        vol.Required("preview_token"): str,
        vol.Required("settings"): dict,
    }
)
@require_admin
@callback
def websocket_save_settings(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Apply exactly reviewed installation settings under the shared save lock."""
    hass.async_create_task(_async_save_settings(hass, connection, msg))


async def _async_save_settings(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    dashboard = hass.data[DATA_DASHBOARD]
    async with dashboard.save_lock:
        runtime = dashboard.runtime
        if runtime is None or not runtime.available:
            connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
            return
        current, revision = _configuration(runtime)
        if msg["revision"] != revision:
            connection.send_error(
                msg["id"], "stale_configuration", "Settings changed; reload this page"
            )
            return
        try:
            candidate = await _settings_candidate(hass, current, msg["settings"])
        except (ValueError, TypeError, KeyError, vol.Invalid) as err:
            connection.send_error(msg["id"], "invalid_settings", str(err))
            return
        if msg["preview_token"] != _digest(
            {"revision": revision, "settings": msg["settings"]}
        ):
            connection.send_error(
                msg["id"],
                "preview_required",
                "Review these exact settings before saving",
            )
            return
        entry = runtime.entry
        previous_options = dict(entry.options)
        hass.config_entries.async_update_entry(entry, options=candidate)
        try:
            loaded = await hass.config_entries.async_reload(entry.entry_id)
        except HomeAssistantError:
            loaded = False
        if not loaded:
            hass.config_entries.async_update_entry(entry, options=previous_options)
            try:
                recovered = await hass.config_entries.async_reload(entry.entry_id)
            except HomeAssistantError:
                recovered = False
            connection.send_error(
                msg["id"],
                "reload_failed",
                "Could not apply settings; previous options restored"
                if recovered
                else "Previous options restored, but monitoring is unavailable",
            )
            return
        connection.send_result(msg["id"], {"saved": True})


def _alert_candidate(
    hass: HomeAssistant, current: dict[str, Any], msg: dict[str, Any]
) -> dict[str, Any]:
    """Validate an alert edit against the saved option and consumer contracts."""
    candidate = {
        **current,
        "notifications": msg["notifications"],
        "consumer": msg["consumer"],
    }
    Settings.from_data(candidate)
    if msg["notifications"]:
        state = hass.states.get(msg["consumer"]) if msg["consumer"] else None
        if state is None or state.state != "on":
            raise ValueError("Enable the selected consumer automation first")
    return candidate


@websocket_command(
    {
        vol.Required("type"): "homeostatic/preview_alerts",
        vol.Required("revision"): str,
        vol.Required("notifications"): bool,
        vol.Required("consumer"): vol.Any(None, str),
    }
)
@require_admin
@callback
def websocket_preview_alerts(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Preview an alert edit without changing options or requesting delivery."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
        return
    current, revision = _configuration(runtime)
    if msg["revision"] != revision:
        connection.send_error(
            msg["id"], "stale_configuration", "Settings changed; reload this page"
        )
        return
    try:
        candidate = _alert_candidate(hass, current, msg)
        activating = (
            candidate["notifications"] and not Settings.from_data(current).notifications
        )
        policy = (
            runtime.preview_policy(Settings.from_data(candidate).policy)
            if activating
            else None
        )
    except (ValueError, TypeError, KeyError, vol.Invalid) as err:
        connection.send_error(msg["id"], "invalid_alerts", str(err))
        return
    connection.send_result(
        msg["id"],
        {
            "preview_token": _digest(
                {
                    "revision": revision,
                    "notifications": candidate["notifications"],
                    "consumer": candidate["consumer"],
                }
            ),
            "notifications": candidate["notifications"],
            "consumer": candidate["consumer"],
            "activating": activating,
            "open_problems": len(runtime.episodes),
            "requests_now": len(cast(list[JSONValue], policy["deliveries"]))
            if policy
            else 0,
            "next_deadline": policy["next_deadline"] if policy else None,
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/save_alerts",
        vol.Required("revision"): str,
        vol.Required("preview_token"): str,
        vol.Required("notifications"): bool,
        vol.Required("consumer"): vol.Any(None, str),
    }
)
@require_admin
@callback
def websocket_save_alerts(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Start an administrator-only alert-settings update."""
    hass.async_create_task(_async_save_alerts(hass, connection, msg))


async def _async_save_alerts(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save only notification activation and consumer after an exact preview."""
    dashboard = hass.data[DATA_DASHBOARD]
    async with dashboard.save_lock:
        runtime = dashboard.runtime
        if runtime is None or not runtime.available:
            connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
            return
        current, revision = _configuration(runtime)
        if msg["revision"] != revision:
            connection.send_error(
                msg["id"], "stale_configuration", "Settings changed; reload this page"
            )
            return
        try:
            candidate = _alert_candidate(hass, current, msg)
        except (ValueError, TypeError, KeyError, vol.Invalid) as err:
            connection.send_error(msg["id"], "invalid_alerts", str(err))
            return
        token = _digest(
            {
                "revision": revision,
                "notifications": candidate["notifications"],
                "consumer": candidate["consumer"],
            }
        )
        if msg["preview_token"] != token:
            connection.send_error(
                msg["id"],
                "preview_required",
                "Preview these exact alert settings before saving",
            )
            return
        entry = runtime.entry
        previous_options = dict(entry.options)
        hass.config_entries.async_update_entry(entry, options=candidate)
        try:
            loaded = await hass.config_entries.async_reload(entry.entry_id)
        except HomeAssistantError:
            loaded = False
        if not loaded:
            hass.config_entries.async_update_entry(entry, options=previous_options)
            try:
                recovered = await hass.config_entries.async_reload(entry.entry_id)
            except HomeAssistantError:
                recovered = False
            connection.send_error(
                msg["id"],
                "reload_failed",
                "Could not apply alerts; previous options restored"
                if recovered
                else "Could not apply alerts; previous options restored, but monitoring is unavailable",
            )
            return
        connection.send_result(msg["id"], {"saved": True})


@websocket_command(
    {
        vol.Required("type"): "homeostatic/preview_configuration",
        vol.Required("revision"): str,
        vol.Required("rules"): list,
    }
)
@require_admin
@callback
def websocket_preview_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Evaluate unsaved monitoring rules against current discovered sources."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Monitoring is unavailable")
        return
    current, revision = _configuration(runtime)
    if msg["revision"] != revision:
        connection.send_error(
            msg["id"], "stale_configuration", "Settings changed; reload this page"
        )
        return
    try:
        rules = normalize_rules(hass, msg["rules"])
        Settings.from_data({**current, "rules": rules})
        result = cast(dict[str, Any], runtime.query("preview_rules", {"rules": rules}))
        functions = cast(
            dict[str, Any], runtime.query("preview_functions", {"rules": rules})
        )["functions"]
    except (ValueError, TypeError, KeyError, vol.Invalid) as err:
        connection.send_error(msg["id"], "invalid_rules", str(err))
        return
    inventory = cast(dict[str, Any], runtime.query("inventory", {}))
    before = {item["node_id"]: item for item in inventory["catalog"]["candidates"]}
    added = []
    removed = []
    for item in result["candidates"]:
        previous = before.get(item["node_id"])
        if item["watched"] and not (previous and previous["watched"]):
            added.append({"node_id": item["node_id"], "name": item["name"]})
        elif not item["watched"] and previous and previous["watched"]:
            removed.append({"node_id": item["node_id"], "name": item["name"]})
    connection.send_result(
        msg["id"],
        {
            "preview_token": _digest({"revision": revision, "rules": rules}),
            "watched": result["watched"],
            "matches": result["rules"],
            "added_count": len(added),
            "removed_count": len(removed),
            "added": added[:50],
            "removed": removed[:50],
            "functions": functions,
            "current_evidence_only": True,
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/save_configuration",
        vol.Required("revision"): str,
        vol.Required("preview_token"): str,
        vol.Required("rules"): list,
    }
)
@require_admin
@callback
def websocket_save_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Start an administrator-only configuration update."""
    hass.async_create_task(_async_save_configuration(hass, connection, msg))


async def _async_save_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Replace only rules after validating an exact preview and saved revision."""
    dashboard = hass.data[DATA_DASHBOARD]
    async with dashboard.save_lock:
        runtime = dashboard.runtime
        if runtime is None or not runtime.available:
            connection.send_error(msg["id"], "not_ready", "Monitoring is unavailable")
            return
        current, revision = _configuration(runtime)
        if msg["revision"] != revision:
            connection.send_error(
                msg["id"], "stale_configuration", "Settings changed; reload this page"
            )
            return
        try:
            rules = normalize_rules(hass, msg["rules"])
            Settings.from_data({**current, "rules": rules})
        except (ValueError, TypeError, KeyError, vol.Invalid) as err:
            connection.send_error(msg["id"], "invalid_rules", str(err))
            return
        if msg["preview_token"] != _digest({"revision": revision, "rules": rules}):
            connection.send_error(
                msg["id"], "preview_required", "Preview these exact rules before saving"
            )
            return
        entry = runtime.entry
        previous_options = dict(entry.options)
        hass.config_entries.async_update_entry(
            entry, options={**current, "rules": rules}
        )
        try:
            loaded = await hass.config_entries.async_reload(entry.entry_id)
        except HomeAssistantError:
            loaded = False
        if not loaded:
            hass.config_entries.async_update_entry(entry, options=previous_options)
            try:
                recovered = await hass.config_entries.async_reload(entry.entry_id)
            except HomeAssistantError:
                recovered = False
            connection.send_error(
                msg["id"],
                "reload_failed",
                "Could not apply rules; previous options restored"
                if recovered
                else "Could not apply rules; previous options restored, but monitoring is unavailable",
            )
            return
        connection.send_result(msg["id"], {"saved": True})


async def async_register_dashboard(hass: HomeAssistant, runtime: Runtime) -> None:
    """Register local assets, cards, dashboard strategy and a sidebar overview."""
    if DATA_DASHBOARD not in hass.data:
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    ASSET_URL, str(Path(__file__).parent / "frontend"), False
                )
            ]
        )
        hass.data[DATA_DASHBOARD] = Dashboard(hass)
        websocket_api.async_register_command(hass, websocket_subscribe)
        websocket_api.async_register_command(hass, websocket_node)
        websocket_api.async_register_command(hass, websocket_source)
        websocket_api.async_register_command(hass, websocket_configuration)
        websocket_api.async_register_command(hass, websocket_test_notification)
        websocket_api.async_register_command(hass, websocket_preview_settings)
        websocket_api.async_register_command(hass, websocket_save_settings)
        websocket_api.async_register_command(hass, websocket_preview_alerts)
        websocket_api.async_register_command(hass, websocket_save_alerts)
        websocket_api.async_register_command(hass, websocket_preview_configuration)
        websocket_api.async_register_command(hass, websocket_save_configuration)
    hass.data[DATA_DASHBOARD].attach(runtime)
    frontend.add_extra_js_url(hass, MODULE_URL)
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=NAME,
        sidebar_icon="mdi:home-heart",
        frontend_url_path=DOMAIN,
        require_admin=True,
        update=True,
        config={
            "_panel_custom": {
                "name": PANEL_ELEMENT,
                "embed_iframe": False,
                "trust_external": False,
                "module_url": MODULE_URL,
            }
        },
    )


@callback
def async_remove_dashboard(hass: HomeAssistant) -> None:
    """Remove presentation and notify existing clients that monitoring stopped."""
    hass.data[DATA_DASHBOARD].attach(None)
    frontend.async_remove_panel(hass, DOMAIN)
    frontend.remove_extra_js_url(hass, MODULE_URL)
