"""Authenticated dashboard presentation using public health-tree queries."""

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable
from pathlib import Path
from time import perf_counter
from typing import Any, cast
from urllib.parse import unquote

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
from homeassistant.helpers import label_registry as lr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey

from . import notification_definitions
from .battery import observe as battery_observation
from .catalog import Source
from .config import Settings, normalize_requirement
from .const import DEFAULTS, DOMAIN, NAME
from .device_availability import device_availability
from .monitoring import TEMPERATURE_CHECKS
from .monitoring_runtime import (
    contributing_policies,
)
from .notification_people import available_people
from .notification_routes import async_send, delivery_targets, destinations
from .policy_defaults import policy_templates
from .runtime import Runtime
from .serialization import json_object
from .vacuum import observe as vacuum_observation

DATA_DASHBOARD: HassKey[Dashboard] = HassKey("homeostatic_dashboard")
SIGNAL_DASHBOARD = "homeostatic_dashboard_updated"
ASSET_URL = "/homeostatic_static"
CATALOG_PAGE_ROWS = 200
_SECTION_KEYS = {
    "nodes": "node_id",
    "candidates": "node_id",
    "areas": "id",
    "devices": "id",
    "floors": "id",
}


def catalog_changes(
    previous: dict[str, list[JSONValue]], current: dict[str, list[JSONValue]]
) -> dict[str, JSONValue] | None:
    """Describe how published catalog sections changed, keyed by row identity.

    Returns an empty mapping when every section has equal content, or None when
    the change has no one-step representation (an enrollment change history that
    was not extended in place).
    """
    changes: dict[str, JSONValue] = {}
    for section, rows in current.items():
        before = previous.get(section, [])
        if section == "enrollment_changes":
            if rows == before:
                continue
            if rows[: len(before)] != before:
                return None
            changes[section] = {"append": rows[len(before) :]}
            continue
        key = _SECTION_KEYS.get(section)
        if key is None:
            kept = set(rows)
            seen = set(before)
            upsert = [value for value in rows if value not in seen]
            remove = [value for value in before if value not in kept]
        else:
            indexed = {str(cast(dict[str, JSONValue], row)[key]): row for row in before}
            current_keys = {str(cast(dict[str, JSONValue], row)[key]) for row in rows}
            upsert = [
                row
                for row in rows
                if indexed.get(str(cast(dict[str, JSONValue], row)[key])) != row
            ]
            remove = [identity for identity in indexed if identity not in current_keys]
        if upsert or remove:
            changes[section] = {"upsert": upsert, "remove": remove}
    return changes


def _change_rows(changes: dict[str, JSONValue]) -> int:
    return sum(
        len(cast(list[JSONValue], items))
        for change in changes.values()
        for items in cast(dict[str, JSONValue], change).values()
    )


MODULE_URL = f"{ASSET_URL}/homeostatic.js?v=95"
PANEL_ELEMENT = "homeostatic-panel-v47"
_SAVE_TIMING_LOGGER = logging.getLogger(f"{__package__}.save_timing")


def _digest(value: dict[str, Any]) -> str:
    """Identify one exact saved configuration or proposed rule list."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _configuration(runtime: Runtime) -> tuple[dict[str, Any], str]:
    """Read the effective options and their concurrency revision."""
    current = dict(runtime.entry.options or runtime.entry.data)
    return current, _digest(current)


def _settings_review_token(
    runtime: Runtime, revision: str, settings: dict[str, Any]
) -> str:
    """Bind named-policy review to the sources and issues it describes."""
    reviewed: dict[str, Any] = {"revision": revision, "settings": settings}
    if "monitoring_policies" in settings:
        reviewed.update(
            inventory_revision=runtime.inventory_revision,
            episodes=sorted(runtime.episodes),
        )
    return _digest(reviewed)


def snapshot(
    runtime: Runtime | None,
    *,
    dynamic_inventory: dict[str, JSONValue] | None = None,
) -> dict[str, JSONValue]:
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
    coverage = runtime.query("coverage", {})
    return {
        **result,
        "available": True,
        "readiness": runtime.query("readiness", {}),
        "inventory": {
            **runtime.inventory_static,
            **(
                runtime.inventory_updates()
                if dynamic_inventory is None
                else dynamic_inventory
            ),
        },
        "coverage": coverage,
        "evidence_gaps": runtime.evidence_gaps_from_coverage(coverage),
        "policy": runtime.query("policy", {}),
        "functions": [],
        "areas": [
            {"id": area.id, "name": area.name, "floor_id": area.floor_id}
            for area in areas.areas.values()
        ],
        "devices": [
            {
                "id": device.id,
                "name": device.name_by_user or device.name or device.id,
                "disabled": device.disabled_by is not None,
                "config_entry_id": device.config_entry_id,
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
        self.catalog_delta: dict[str, JSONValue] | None = None
        self._catalog: dict[str, JSONValue] | None = None
        self._locations: dict[str, JSONValue] = {}
        self.catalog_sections: dict[str, list[JSONValue]] = {}
        self._node_rows: dict[str, JSONValue] = {}
        self._context_rows: dict[str, dict[str, JSONValue]] = {}
        self._entity_nodes: dict[str, str] = {}
        self._device_rows: dict[str, dict[str, JSONValue]] = {}
        self._monitored_count = 0
        self.summary = self.update
        self.panel_summary = self.update
        self._cancel: Callable[[], None] | None = None
        self.save_lock = asyncio.Lock()
        self.reloading_settings = False

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
        dynamic = (
            self.runtime.inventory_updates()
            if self.runtime is not None and self.runtime.available
            else None
        )
        self.value = snapshot(self.runtime, dynamic_inventory=dynamic)
        self.catalog_delta = None
        if self.runtime is not None and self.runtime.available:
            assert dynamic is not None
            locations = {key: self.value[key] for key in ("areas", "devices", "floors")}
            if (
                self._catalog is not self.runtime.inventory_static
                or self._locations != locations
            ):
                sections = self._sections(self.runtime.inventory_static, locations)
                # Content decides the revision: an equal republication keeps every
                # client's catalog, and a small change travels as a one-step delta.
                changes = (
                    catalog_changes(self.catalog_sections, sections)
                    if self._catalog is not None
                    else None
                )
                self._catalog = self.runtime.inventory_static
                self._locations = locations
                if changes != {}:
                    if (
                        changes is not None
                        and _change_rows(changes) <= CATALOG_PAGE_ROWS
                    ):
                        self.catalog_delta = {
                            "from_revision": self.catalog_revision,
                            "sections": changes,
                        }
                    self.catalog_revision += 1
                    self.catalog_sections = sections
                    self._index_sections()
            self.value.update(self._locations)
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
            names = {
                str(episode["anchor"]) for episode in self.runtime.episodes.values()
            }
            names.update(
                str(control["target"])
                for control in cast(
                    list[dict[str, JSONValue]], dynamic["operator_controls"]
                )
            )
            names.update(
                f"entry:{self.runtime.sources[name].owner_id}"
                for name in tuple(names)
                if name in self.runtime.sources and self.runtime.sources[name].owner_id
            )
            catalog = cast(dict[str, JSONValue], self._catalog["catalog"])
            self.summary = {
                **self.update,
                "schema_version": 3,
                "catalog_loaded": False,
                **(
                    {"catalog_delta": self.catalog_delta}
                    if self.catalog_delta is not None
                    else {}
                ),
                "catalog_sections": {
                    key: len(rows) for key, rows in self.catalog_sections.items()
                },
                "inventory": {
                    **dynamic,
                    "nodes": [
                        row for name, row in self._node_rows.items() if name in names
                    ],
                    "catalog": {**catalog, "candidates": []},
                    "targets": [],
                    "enrollment_changes": [],
                },
                "areas": [],
                "devices": [],
                "floors": [],
            }
            self.panel_summary = self._panel_summary(dynamic)
        else:
            self._catalog = None
            self.update = {**self.value, "schema_version": 2}
            self.catalog_sections = {}
            self._node_rows = {}
            self._context_rows = {}
            self._entity_nodes = {}
            self._device_rows = {}
            self.summary = {**self.value, "schema_version": 3, "catalog_loaded": False}
            self.panel_summary = {**self.summary, "panel_context": True}
        async_dispatcher_send(self.hass, SIGNAL_DASHBOARD)

    @staticmethod
    def _sections(
        static: dict[str, JSONValue], locations: dict[str, JSONValue]
    ) -> dict[str, list[JSONValue]]:
        """Arrange the static inventory and HA locations as pageable sections."""
        catalog = cast(dict[str, JSONValue], static["catalog"])
        sections = {
            key: cast(list[JSONValue], static[key])
            for key in ("nodes", "targets", "enrollment_changes")
        }
        sections["candidates"] = cast(list[JSONValue], catalog["candidates"])
        sections.update(
            {key: cast(list[JSONValue], value) for key, value in locations.items()}
        )
        return sections

    def _index_sections(self) -> None:
        """Rebuild the row indexes that summaries and detail views read."""
        self._node_rows = {
            str(cast(dict[str, JSONValue], row)["node_id"]): row
            for row in self.catalog_sections["nodes"]
        }
        self._context_rows = {
            str(row["node_id"]): row
            for row in cast(
                list[dict[str, JSONValue]],
                self.catalog_sections["candidates"] + self.catalog_sections["nodes"],
            )
        }
        self._entity_nodes = {
            str(row["entity_id"]): str(row["node_id"])
            for row in self._context_rows.values()
            if row.get("kind") == "entity"
            and not row.get("monitoring_policy")
            and row.get("entity_id")
        }
        self._device_rows = {
            str(row["id"]): row
            for row in cast(
                list[dict[str, JSONValue]], self.catalog_sections["devices"]
            )
        }
        self._monitored_count = sum(
            bool(cast(dict[str, JSONValue], row).get("watched"))
            for row in self.catalog_sections["nodes"]
        )

    def _panel_summary(self, dynamic: dict[str, JSONValue]) -> dict[str, JSONValue]:
        """Include current issue context without the installation-wide catalog."""
        assert self.runtime is not None
        names: set[str] = set()
        for episode in self.runtime.episodes.values():
            names.add(str(episode["anchor"]))
            names.update(cast(list[str], episode.get("recorded", [])))
            names.update(
                str(reason["node_id"])
                for reason in cast(
                    list[dict[str, JSONValue]], episode.get("reasons", [])
                )
                if reason.get("node_id")
            )
        names.update(
            str(control["target"])
            for control in cast(
                list[dict[str, JSONValue]], dynamic["operator_controls"]
            )
        )
        pending = list(names)
        devices: set[str] = set()
        areas: set[str] = set()
        floors: set[str] = set()
        while pending:
            row = self._context_rows.get(pending.pop())
            if row is None:
                continue
            related: set[str] = set()
            if row.get("monitoring_source"):
                related.add(str(row["monitoring_source"]))
            if canonical := self._entity_nodes.get(str(row.get("entity_id", ""))):
                related.add(canonical)
            if row.get("owner_id"):
                related.add(f"entry:{row['owner_id']}")
            attributes = cast(dict[str, JSONValue], row.get("attributes", {}))
            related.update(
                f"entry:{identity}"
                for identity in cast(list[str], attributes.get("integration", []))
            )
            for identity in cast(list[str], attributes.get("device", [])):
                devices.add(identity)
                related.add(f"device:{identity}")
                owner = self._device_rows.get(identity, {}).get("config_entry_id")
                if owner:
                    related.add(f"entry:{owner}")
            areas.update(cast(list[str], attributes.get("area", [])))
            floors.update(cast(list[str], attributes.get("floor", [])))
            pending.extend(related - names)
            names.update(related)
        area_rows = [
            row
            for row in cast(list[dict[str, JSONValue]], self._locations["areas"])
            if row["id"] in areas
        ]
        floors.update(str(row["floor_id"]) for row in area_rows if row.get("floor_id"))
        inventory = cast(dict[str, JSONValue], self.summary["inventory"])
        catalog = cast(dict[str, JSONValue], inventory["catalog"])
        return {
            **{key: value for key, value in self.summary.items() if key != "coverage"},
            "panel_context": True,
            "inventory": {
                **inventory,
                "monitored_count": self._monitored_count,
                "nodes": [
                    self._node_rows[name]
                    for name in sorted(names)
                    if name in self._node_rows
                ],
                "catalog": {
                    **catalog,
                    "candidates": [
                        self._context_rows[name]
                        for name in sorted(names)
                        if name in self._context_rows and name not in self._node_rows
                    ],
                },
            },
            "areas": cast(list[JSONValue], area_rows),
            "devices": [
                self._device_rows[identity]
                for identity in sorted(devices)
                if identity in self._device_rows
            ],
            "floors": [
                row
                for row in cast(list[dict[str, JSONValue]], self._locations["floors"])
                if row["id"] in floors
            ],
        }


@websocket_command(
    {
        vol.Required("type"): "homeostatic/subscribe",
        vol.Optional("compact", default=False): bool,
        vol.Optional("paged", default=False): bool,
        vol.Optional("panel", default=False): bool,
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
        if msg["paged"]:
            payload = dashboard.panel_summary if msg["panel"] else dashboard.summary
        elif msg["compact"]:
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
        vol.Required("type"): "homeostatic/catalog",
        vol.Required("revision"): vol.All(int, vol.Range(min=0)),
        vol.Required("section"): vol.In(
            (
                "nodes",
                "candidates",
                "targets",
                "enrollment_changes",
                "areas",
                "devices",
                "floors",
            )
        ),
        vol.Optional("offset", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=200): vol.All(int, vol.Range(min=1, max=200)),
    }
)
@require_admin
@callback
def websocket_catalog(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return one bounded page from the exact currently published catalog."""
    dashboard = hass.data[DATA_DASHBOARD]
    if not dashboard.value["available"]:
        connection.send_error(msg["id"], "not_ready", "Monitoring is unavailable")
        return
    if msg["revision"] != dashboard.catalog_revision:
        connection.send_error(
            msg["id"], "stale_catalog", "The source catalog changed; reload its pages"
        )
        return
    rows = dashboard.catalog_sections[msg["section"]]
    offset = msg["offset"]
    if offset > len(rows):
        connection.send_error(
            msg["id"], "invalid_offset", "The offset exceeds this catalog section"
        )
        return
    end = min(offset + msg["limit"], len(rows))
    connection.send_result(
        msg["id"],
        {
            "revision": dashboard.catalog_revision,
            "section": msg["section"],
            "offset": offset,
            "total": len(rows),
            "items": rows[offset:end],
            "next_offset": end if end < len(rows) else None,
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/node",
        vol.Required("node_id"): str,
        vol.Optional("offset", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=50): vol.All(int, vol.Range(min=1, max=200)),
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
    try:
        members = runtime.device_evidence(
            node_id, offset=msg["offset"], limit=msg["limit"]
        )
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_offset", str(err))
        return
    connection.send_result(
        msg["id"],
        {
            "source": json_object(source),
            "monitoring_policies": [
                {"id": item.id, "name": item.name}
                for item in contributing_policies(
                    runtime.settings.monitoring_policies, source, runtime.sources
                )
            ],
            "integration_evidence": runtime.evidence.view(node_id),
            "entity_status": runtime.entity_status(node_id),
            "temperature_status": runtime.temperature_status(node_id)
            if source.kind in TEMPERATURE_CHECKS
            else None,
            "device_evidence": members,
            "device_availability": device_availability(
                hass, source.attributes["device"][0]
            )
            if source.kind == "device"
            else None,
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


def _temperature_checks(
    runtime: Runtime, source: Source, candidates: dict[str, Source]
) -> list[dict[str, JSONValue]]:
    """Expose independent conditions on this entity or its device's entities."""
    policies = {item.id: item for item in runtime.settings.monitoring_policies}
    result: list[dict[str, JSONValue]] = []
    for check in runtime.sources.values():
        if (
            check.kind not in TEMPERATURE_CHECKS
            or not check.watched
            or check.disabled
            or check.monitoring_policy is None
            or not (
                (source.entity_id is not None and check.entity_id == source.entity_id)
                or (
                    source.kind == "device"
                    and set(source.attributes.get("device", ())).intersection(
                        check.attributes.get("device", ())
                    )
                )
            )
        ):
            continue
        entity = candidates.get(check.entity_id) if check.entity_id else None
        result.append(
            {
                "node_id": check.node_id,
                "source_id": entity.node_id if entity is not None else check.node_id,
                "entity_id": check.entity_id,
                "source_name": entity.name if entity is not None else check.name,
                "policy_id": check.monitoring_policy,
                "policy_name": policies[check.monitoring_policy].name,
                "check": check.check_id,
                **runtime.temperature_status(check.node_id),
            }
        )
    return result


@websocket_command(
    {
        vol.Required("type"): "homeostatic/source",
        vol.Required("node_id"): str,
        vol.Optional("offset", default=0): vol.All(int, vol.Range(min=0)),
        vol.Optional("limit", default=50): vol.All(int, vol.Range(min=1, max=200)),
    }
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
    monitored = runtime.sources.get(node_id)
    if monitored is not None and monitored.monitoring_source:
        node_id = monitored.monitoring_source
    related = [
        item for item in runtime.sources.values() if item.monitoring_source == node_id
    ]
    source = (
        runtime.candidates.get(node_id)
        or runtime.sources.get(node_id)
        or next(iter(related), None)
    )
    if source is None:
        connection.send_error(
            msg["id"], "not_found", "This source is no longer discovered"
        )
        return
    device_checks = [
        item
        for item in (
            [monitored]
            if monitored is not None and monitored.monitoring_policy is not None
            else related
        )
        if item.kind == "device" and item.watched and not item.disabled
    ]
    device_entities = (
        tuple(
            sorted(
                {
                    entity_id
                    for item in device_checks
                    for entity_id in item.availability_entities
                }
            )
        )
        if source.watched or device_checks
        else source.availability_entities
    )
    entity_ids = (
        device_entities
        if source.kind == "device"
        else tuple(
            dict.fromkeys(
                entity_id
                for entity_id in (
                    source.battery_level_entity,
                    source.battery_warning_entity,
                    source.battery_charging_entity,
                )
                if entity_id
            )
        )
        if source.kind == "battery"
        else ((source.entity_id,) if source.entity_id else ())
    )
    candidates = {
        item.entity_id: item
        for item in runtime.candidates.values()
        if item.kind == "entity" and item.entity_id
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
                "unit": state.attributes.get("unit_of_measurement")
                if state is not None
                else None,
                "restored": bool(state and state.attributes.get("restored")),
            }
        )
    members.sort(
        key=lambda item: (
            not (item["state"] in {"unavailable", "missing"} or item["restored"]),
            str(item["name"]),
            str(item["entity_id"]),
        )
    )
    offset = msg["offset"]
    if offset > len(members):
        connection.send_error(
            msg["id"], "invalid_offset", "The offset exceeds this source's members"
        )
        return
    end = min(offset + msg["limit"], len(members))
    observed_node = (
        monitored.node_id
        if monitored and monitored.watched
        else next(
            (item.node_id for item in related if item.watched),
            source.node_id,
        )
    )
    policy_ids = {
        policy.id
        for item in [source, *related]
        for policy in contributing_policies(
            runtime.settings.monitoring_policies, item, runtime.sources
        )
    }
    temperature_checks = _temperature_checks(runtime, source, candidates)
    policy_ids.update(str(item["policy_id"]) for item in temperature_checks)
    evidence = runtime.evidence.view(observed_node) or {}
    if source.kind == "integration" and source.entry_id:
        entry = hass.config_entries.async_get_entry(source.entry_id)
        if entry is not None and not evidence.get("current"):
            evidence = {**evidence, "current": {"reason": entry.state.value}}
    connection.send_result(
        msg["id"],
        {
            "temperature_checks": temperature_checks,
            "battery_conditions": [
                {
                    "policy_id": item.id,
                    "policy_name": item.name,
                    "condition": json_object(
                        battery_observation(
                            hass,
                            source,
                            dt_util.utcnow(),
                            threshold=float(item.parameters["threshold"]),
                        )
                    ),
                }
                for item in runtime.settings.monitoring_policies
                if source.kind == "battery"
                and not source.disabled
                and item.check == "battery"
                and item.enabled
                and item.matches(
                    source.attributes,
                    source_id=source.monitoring_source or source.node_id,
                )
            ],
            "vacuum_activity": json_object(
                vacuum_observation(hass, source, dt_util.utcnow())
            )
            if source.kind == "vacuum"
            else None,
            "device_availability": device_availability(
                hass, source.attributes["device"][0]
            )
            if source.kind == "device"
            else None,
            "members": members[offset:end],
            "offset": offset,
            "next_offset": end if end < len(members) else None,
            "monitoring_policies": [
                {"id": item.id, "name": item.name}
                for item in runtime.settings.monitoring_policies
                if item.id in policy_ids
            ],
            "total": len(members),
            "unavailable_count": sum(
                item["state"] == "unavailable" and not item["restored"]
                for item in members
            ),
            "unknown_count": sum(
                item["state"] == "missing" or bool(item["restored"]) for item in members
            ),
            "integration_evidence": evidence,
            "entity_status": runtime.entity_status(observed_node)
            if observed_node in runtime.sources
            else None,
            "updated_at": runtime.updated_at.isoformat()
            if runtime.updated_at
            else None,
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/configuration",
        vol.Optional("section", default="all"): vol.In(["all", "settings", "delivery"]),
    }
)
@require_admin
@callback
def websocket_configuration(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Read coherent saved settings, waiting for a pending save if necessary."""
    dashboard = hass.data[DATA_DASHBOARD]
    runtime = dashboard.runtime
    if runtime is None:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is not loaded")
        return
    if msg["section"] == "settings" and not dashboard.save_lock.locked():
        connection.send_result(msg["id"], _settings_configuration(hass, runtime))
        return
    hass.async_create_task(_async_configuration(hass, connection, msg))


def _settings_configuration(hass: HomeAssistant, runtime: Runtime) -> dict[str, Any]:
    """Read validated settings without yielding to another refresh."""
    _, revision = _configuration(runtime)
    settings = runtime.settings
    return {
        "revision": revision,
        "monitoring_policy_templates": policy_templates(),
        "areas": [
            {"id": area.id, "name": area.name, "floor_id": area.floor_id}
            for area in ar.async_get(hass).areas.values()
        ],
        "floors": [
            {"id": floor.floor_id, "name": floor.name}
            for floor in fr.async_get(hass).floors.values()
        ],
        "labels": [
            {"id": label.label_id, "name": label.name}
            for label in lr.async_get(hass).labels.values()
        ],
        "settings": _editable_settings(settings),
    }


async def _async_configuration(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Discover notification capabilities only when their editor needs them."""
    result: dict[str, Any] = {}
    if msg["section"] in {"settings", "all"}:
        dashboard = hass.data[DATA_DASHBOARD]
        async with dashboard.save_lock:
            current = dashboard.runtime
            if current is None:
                connection.send_error(
                    msg["id"], "not_ready", "Homeostatic is not loaded"
                )
                return
            result = _settings_configuration(hass, current)
        if msg["section"] == "settings":
            connection.send_result(msg["id"], result)
            return
    result.update(
        notification_people=await available_people(hass),
        delivery_targets=delivery_targets(hass),
        notification_destinations=[
            {
                "channel": item.channel,
                "name": item.name,
                "user_id": item.user_id,
                "available": item.available,
                "phone_channel": item.phone_channel,
            }
            for item in destinations(hass)
        ],
        consumers=[
            {"entity_id": state.entity_id, "name": state.name, "state": state.state}
            for state in hass.states.async_all("automation")
        ],
    )
    connection.send_result(msg["id"], result)


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


def _delivery_method_test_preview(
    runtime: Runtime, method_id: str, revision: str
) -> dict[str, Any]:
    """Bind a saved method test to its current presence evidence and exact targets."""
    _, current_revision = _configuration(runtime)
    if revision != current_revision:
        raise ValueError("Notification settings changed; reload before testing")
    definitions = runtime.settings.notification_definitions
    if definitions is None or method_id not in definitions["methods"]:
        raise ValueError("Save this delivery method before testing it")
    method = definitions["methods"][method_id]
    channels = notification_definitions.resolve_channels(
        runtime.hass, definitions, method_id
    )
    catalog = {item["channel"]: item for item in delivery_targets(runtime.hass)}
    targets: list[dict[str, Any]] = []
    for channel in channels:
        target = catalog.get(channel)
        if target is None and channel.startswith("sms:"):
            parts = channel.split(":")
            template = catalog.get(f"sms:{parts[1]}:")
            if template is not None:
                target = {
                    **template,
                    "name": f"{template['name']} → {unquote(parts[2])}",
                }
        targets.append(
            {
                "channel": channel,
                "name": target["name"] if target else channel,
                "type": target["type"] if target else channel.split(":", 1)[0],
                "available": bool(target and target["available"]),
            }
        )
    presence: dict[str, dict[str, Any]] = {}
    for person in method.get("people", []):
        state = runtime.hass.states.get(person)
        presence[person] = {
            "state": state.state if state else None,
            "restored": bool(state and state.attributes.get("restored", False)),
        }
    preview = {
        "method_id": method_id,
        "name": method["name"],
        "targets": targets,
        "presence": presence,
        "skipped": not channels,
    }
    return {
        **preview,
        "preview_token": _digest({"revision": revision, "method": method, **preview}),
    }


@websocket_command(
    {
        vol.Required("type"): "homeostatic/preview_delivery_method",
        vol.Required("method_id"): str,
        vol.Required("revision"): str,
    }
)
@require_admin
@callback
def websocket_preview_delivery_method(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Show currently resolved saved destinations without requesting delivery."""
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
        return
    try:
        preview = _delivery_method_test_preview(
            runtime, msg["method_id"], msg["revision"]
        )
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_method", str(err))
        return
    connection.send_result(msg["id"], preview)


@websocket_command(
    {
        vol.Required("type"): "homeostatic/test_delivery_method",
        vol.Required("method_id"): str,
        vol.Required("revision"): str,
        vol.Required("preview_token"): str,
    }
)
@require_admin
@callback
def websocket_test_delivery_method(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Request a test only for the destinations in an unchanged explicit preview."""
    hass.async_create_task(_async_test_delivery_method(hass, connection, msg))


async def _async_test_delivery_method(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    runtime = hass.data[DATA_DASHBOARD].runtime
    if runtime is None or not runtime.available:
        connection.send_error(msg["id"], "not_ready", "Homeostatic is unavailable")
        return
    try:
        preview = _delivery_method_test_preview(
            runtime, msg["method_id"], msg["revision"]
        )
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_method", str(err))
        return
    if msg["preview_token"] != preview["preview_token"]:
        connection.send_error(
            msg["id"],
            "preview_required",
            "Destinations or presence changed; preview again before sending",
        )
        return
    if any(not target["available"] for target in preview["targets"]):
        connection.send_error(
            msg["id"], "invalid_route", "A selected destination is unavailable"
        )
        return
    requested: list[str] = []
    failed: list[dict[str, str]] = []
    for target in preview["targets"]:
        channel = target["channel"]
        try:
            await async_send(
                hass,
                channel,
                title="Homeostatic test",
                message=f"Test notification for {preview['name']}.",
                tag=f"homeostatic_test_{msg['method_id']}",
            )
        except HomeAssistantError as err:
            failed.append({"channel": channel, "error": str(err)})
        else:
            requested.append(channel)
    connection.send_result(
        msg["id"],
        {"requested": requested, "failed": failed, "skipped": preview["skipped"]},
    )


def _editable_settings(settings: Settings) -> dict[str, Any]:
    """Expose only installation options supported by the dashboard editor."""
    result = {
        "timings": dict(settings.timings),
        "notifications": settings.notifications,
        "consumer": settings.consumer,
        "monitoring_policies": [
            policy.data() for policy in settings.monitoring_policies
        ],
        "notification_definitions": settings.notification_definitions,
    }
    return result


async def _settings_candidate(
    hass: HomeAssistant, current: dict[str, Any], proposed: dict[str, Any]
) -> dict[str, Any]:
    """Preserve unrelated options and validate a complete editable proposal."""
    if set(proposed) != {
        "timings",
        "notifications",
        "consumer",
        "monitoring_policies",
        "notification_definitions",
    }:
        raise ValueError("Provide the complete unified policy settings")
    if not isinstance(proposed["timings"], dict) or set(proposed["timings"]) != set(
        DEFAULTS
    ):
        raise ValueError("Provide every supported timing")
    candidate = {**current, **proposed}
    candidate.pop("policy", None)
    if "monitoring_policies" in proposed:
        candidate["monitoring_policies"] = []
        for item in proposed["monitoring_policies"]:
            match = dict(item.get("match", {}))
            if "entity" in match:
                values = match["entity"]
                match["entity"] = [
                    normalize_requirement(hass, value, node=False)
                    for value in ([values] if isinstance(values, str) else values)
                ]
            candidate["monitoring_policies"].append({**item, "match": match})
    if proposed.get("notification_definitions") is not None:
        candidate["notification_definitions"] = notification_definitions.validate(
            proposed["notification_definitions"]
        )
    settings = Settings.from_data(candidate)
    previous = Settings.from_data(current)
    existing = {item.id: item for item in previous.monitoring_policies}
    for item in settings.monitoring_policies:
        old = existing.get(item.id)
        if old is not None and (
            item.check != old.check
            or (
                item.check == "availability"
                and item.match.get("kind") != old.match.get("kind")
            )
        ):
            raise ValueError("Monitoring type cannot change; create a new policy")
    if settings.notifications and (
        not previous.notifications or settings.consumer != previous.consumer
    ):
        consumer = hass.states.get(settings.consumer) if settings.consumer else None
        built_in = any(
            channel.startswith(("phone:", "notify:", "method:"))
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
        proposed_sources = runtime.preview_sources(settings)
        policy = runtime.preview_policy(
            settings.policy, settings=settings, sources=proposed_sources
        )
        monitoring = None
        if "monitoring_policies" in msg["settings"]:
            after = {
                key: source
                for key, source in proposed_sources.items()
                if source.watched and source.kind not in {"situation", "function"}
            }
            before = {
                key: source
                for key, source in runtime.sources.items()
                if source.watched and source.kind not in {"situation", "function"}
            }
            added = [
                {"node_id": key, "name": after[key].name}
                for key in after.keys() - before.keys()
            ]
            removed = [
                {"node_id": key, "name": before[key].name}
                for key in before.keys() - after.keys()
            ]
            monitoring = {
                "watched": len(after),
                "added": added[:50],
                "added_count": len(added),
                "removed": removed[:50],
                "removed_count": len(removed),
                "functions": [],
                "ended_issues": [
                    key
                    for key, issue in runtime.episodes.items()
                    if issue["anchor"] in before.keys() - after.keys()
                ],
            }
    except (ValueError, TypeError, KeyError, vol.Invalid) as err:
        connection.send_error(msg["id"], "invalid_settings", str(err))
        return
    connection.send_result(
        msg["id"],
        {
            "preview_token": _settings_review_token(runtime, revision, msg["settings"]),
            "before": _editable_settings(Settings.from_data(current)),
            "after": msg["settings"],
            **({"monitoring": monitoring} if monitoring is not None else {}),
            "activating": settings.notifications
            and not Settings.from_data(current).notifications,
            "requests_now": len(cast(list[JSONValue], policy["deliveries"])),
            "reports": policy["reports"],
            "open_problems": len(runtime.episodes),
        },
    )


@websocket_command(
    {
        vol.Required("type"): "homeostatic/save_settings",
        vol.Required("revision"): str,
        vol.Optional("preview_token"): str,
        vol.Required("settings"): dict,
    }
)
@require_admin
@callback
def websocket_save_settings(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    """Validate and apply installation settings under the shared save lock."""
    hass.async_create_task(
        _async_save_settings(hass, connection, msg, received_at=perf_counter())
    )


async def _async_apply_monitoring(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
    runtime: Runtime,
    candidate: dict[str, Any],
) -> bool:
    """Keep monitoring and named notification drafts in the registered runtime."""
    settings = Settings.from_data(candidate, functions_enabled=False)
    if not runtime.can_apply_settings(settings):
        return False
    previous_options = dict(runtime.entry.options)
    hass.config_entries.async_update_entry(runtime.entry, options=candidate)
    try:
        await runtime.async_apply_settings(settings)
    except OSError, HomeAssistantError, ValueError, KeyError, TypeError:
        hass.config_entries.async_update_entry(runtime.entry, options=previous_options)
        connection.send_error(
            msg["id"],
            "apply_failed",
            "Could not apply settings; previous options restored"
            if runtime.available
            else "Previous options restored, but monitoring is unavailable",
        )
    else:
        connection.send_result(msg["id"], {"saved": True})
    return True


async def _async_save_settings(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict[str, Any],
    *,
    received_at: float,
) -> None:
    _SAVE_TIMING_LOGGER.debug(
        "phase=request_queue seconds=%.6f", perf_counter() - received_at
    )
    try:
        await _async_save_settings_locked(hass, connection, msg)
    finally:
        _SAVE_TIMING_LOGGER.debug(
            "phase=request_total seconds=%.6f", perf_counter() - received_at
        )


async def _async_save_settings_locked(
    hass: HomeAssistant, connection: ActiveConnection, msg: dict[str, Any]
) -> None:
    dashboard = hass.data[DATA_DASHBOARD]
    phase_started = perf_counter()
    async with dashboard.save_lock:
        _SAVE_TIMING_LOGGER.debug(
            "phase=save_lock seconds=%.6f", perf_counter() - phase_started
        )
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
        phase_started = perf_counter()
        try:
            candidate = await _settings_candidate(hass, current, msg["settings"])
        except (ValueError, TypeError, KeyError, vol.Invalid) as err:
            connection.send_error(msg["id"], "invalid_settings", str(err))
            return
        _SAVE_TIMING_LOGGER.debug(
            "phase=validation seconds=%.6f", perf_counter() - phase_started
        )
        if dashboard.runtime is not runtime or _configuration(runtime)[1] != revision:
            connection.send_error(
                msg["id"], "stale_configuration", "Settings changed; reload this page"
            )
            return
        if "preview_token" in msg and msg["preview_token"] != _settings_review_token(
            runtime, revision, msg["settings"]
        ):
            connection.send_error(
                msg["id"],
                "preview_required",
                "Review these exact settings before saving",
            )
            return
        if await _async_apply_monitoring(hass, connection, msg, runtime, candidate):
            return
        entry = runtime.entry
        previous_options = dict(entry.options)
        hass.config_entries.async_update_entry(entry, options=candidate)
        dashboard.reloading_settings = True
        try:
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
        finally:
            dashboard.reloading_settings = False


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
        websocket_api.async_register_command(hass, websocket_catalog)
        websocket_api.async_register_command(hass, websocket_node)
        websocket_api.async_register_command(hass, websocket_source)
        websocket_api.async_register_command(hass, websocket_configuration)
        websocket_api.async_register_command(hass, websocket_test_notification)
        websocket_api.async_register_command(hass, websocket_preview_delivery_method)
        websocket_api.async_register_command(hass, websocket_test_delivery_method)
        websocket_api.async_register_command(hass, websocket_preview_settings)
        websocket_api.async_register_command(hass, websocket_save_settings)
    dashboard = hass.data[DATA_DASHBOARD]
    dashboard.attach(runtime)
    if dashboard.reloading_settings and DOMAIN in hass.data[frontend.DATA_PANELS]:
        return
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
    """Notify clients of unload, retaining navigation during a settings transaction."""
    dashboard = hass.data.get(DATA_DASHBOARD)
    if dashboard is None:
        return
    dashboard.attach(None)
    if dashboard.reloading_settings:
        return
    frontend.async_remove_panel(hass, DOMAIN)
    frontend.remove_extra_js_url(hass, MODULE_URL)
