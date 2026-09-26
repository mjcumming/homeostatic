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

from .config import Settings, normalize_rules, rule_data
from .const import DOMAIN, NAME
from .runtime import Runtime
from .serialization import json_object

DATA_DASHBOARD: HassKey[Dashboard] = HassKey("homeostatic_dashboard")
SIGNAL_DASHBOARD = "homeostatic_dashboard_updated"
ASSET_URL = "/homeostatic_static"
MODULE_URL = f"{ASSET_URL}/homeostatic.js?v=13"
PANEL_ELEMENT = "homeostatic-panel-v13"


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
            {"id": device.id, "name": device.name_by_user or device.name or device.id}
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


@websocket_command({vol.Required("type"): "homeostatic/configuration"})
@require_admin
@callback
def websocket_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Provide the current catalog rules without a second configuration store."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is not loaded")
        return
    current, revision = _configuration(runtime)
    connection.send_result(
        msg["id"],
        {"revision": revision, "rules": rule_data(hass, Settings.from_data(current))},
    )


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
        websocket_api.async_register_command(hass, websocket_configuration)
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
