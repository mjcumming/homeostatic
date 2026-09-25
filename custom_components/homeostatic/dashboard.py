"""Authenticated dashboard presentation using public health-tree queries."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

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
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN, NAME
from .runtime import Runtime
from .serialization import json_object

DATA_DASHBOARD: HassKey[Dashboard] = HassKey("homeostatic_dashboard")
SIGNAL_DASHBOARD = "homeostatic_dashboard_updated"
ASSET_URL = "/homeostatic_static"
MODULE_URL = f"{ASSET_URL}/homeostatic.js?v=2"


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
    floors = fr.async_get(runtime.hass)
    return {
        **result,
        "available": True,
        "readiness": runtime.query("readiness", {}),
        "inventory": runtime.query("inventory", {}),
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
        self._cancel: Callable[[], None] | None = None

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
        async_dispatcher_send(self.hass, SIGNAL_DASHBOARD)


@websocket_command({vol.Required("type"): "homeostatic/subscribe"})
@require_admin
@callback
def websocket_subscribe(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send an initial view and updates until the client unsubscribes."""

    @callback
    def send() -> None:
        connection.send_event(msg["id"], hass.data[DATA_DASHBOARD].value)

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
                "name": "homeostatic-panel",
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
