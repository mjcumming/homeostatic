"""Serve a disposable, loopback-only Home Assistant installation for UI sweeps.

All entities and notification transports are synthetic. The authenticated lab
control command is fixture setup, not evidence that a Homeostatic UI path works.
"""

import argparse
import asyncio
import json
import os
import shutil
import signal
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from copy import deepcopy
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest.mock import patch

from aiohttp import ClientSession
from homeassistant import bootstrap
from homeassistant.auth.const import GROUP_ID_ADMIN
from homeassistant.components import websocket_api
from homeassistant.components.http.config import async_get_and_load_store
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers import label_registry as lr
from homeassistant.runner import RuntimeConfig, create_event_loop
from homeassistant.util import dt as dt_util

REPO = Path(__file__).resolve().parents[1]
DOMAIN = "homeostatic_ui_lab"
SEED = """async def async_setup_entry(hass, entry):
    if hass.data.get('ui_lab_integration_failed'):
        from homeassistant.exceptions import ConfigEntryNotReady
        raise ConfigEntryNotReady('Synthetic connection is unavailable')
    return True

async def async_unload_entry(hass, entry):
    return True
"""
FLOW = """from homeassistant import config_entries

class LabFlow(config_entries.ConfigFlow, domain='homeostatic_ui_lab'):
    VERSION = 1
    async def async_step_user(self, user_input=None):
        return self.async_create_entry(title='UI Lab Controller', data={})
"""


def write_json(path: Path, value: Any, *, private: bool = False) -> None:
    """Write local evidence, restricting files containing temporary lab tokens."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(
        path,
        "w",
        encoding="utf-8",
        opener=(lambda name, flags: os.open(name, flags, 0o600)) if private else None,
    ) as stream:
        json.dump(value, stream, indent=2, default=str)
        stream.write("\n")
    if private:
        path.chmod(0o600)
        if path.stat().st_mode & 0o077:
            path.unlink()
            raise ValueError(
                "The ready file must be on a private Linux filesystem, such as /tmp"
            )


def prepare(config: Path, port: int, component: Path) -> None:
    """Copy only the candidate component and create a synthetic local HA config."""
    shutil.copytree(
        component,
        config / "custom_components/homeostatic",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    seed = config / "custom_components" / DOMAIN
    seed.mkdir()
    (seed / "__init__.py").write_text(SEED, encoding="utf-8")
    (seed / "config_flow.py").write_text(FLOW, encoding="utf-8")
    write_json(
        seed / "manifest.json",
        {
            "domain": DOMAIN,
            "name": "Synthetic UI laboratory",
            "version": "1.0.0",
            "config_flow": True,
            "codeowners": [],
            "iot_class": "local_push",
            "documentation": "https://github.com/mjcumming/homeostatic",
        },
    )
    write_json(
        config / ".storage/onboarding",
        {
            "version": 4,
            "minor_version": 1,
            "key": "onboarding",
            "data": {"done": ["user", "core_config", "integration", "analytics"]},
        },
    )
    write_json(
        config / "configuration.yaml",
        {
            "homeassistant": {
                "name": "Homeostatic isolated UI laboratory",
                "latitude": 0,
                "longitude": 0,
                "elevation": 0,
                "time_zone": "America/Chicago",
                "unit_system": "us_customary",
                "country": "US",
                "auth_providers": [
                    {
                        "type": "trusted_networks",
                        "trusted_networks": ["127.0.0.1/32"],
                        "allow_bypass_login": True,
                    }
                ],
            },
            "http": {"server_host": "127.0.0.1", "server_port": port},
            "frontend": {},
            "recorder": {},
            "config": {},
            "api": {},
            "websocket_api": {},
            "logger": {"default": "warning"},
            "automation": [
                {
                    "id": "ui_lab_missing_light",
                    "alias": "Lab missing porch light",
                    "triggers": [{"trigger": "event", "event_type": "ui_lab_never"}],
                    "actions": [
                        {
                            "action": "light.turn_on",
                            "target": {"entity_id": "light.ui_lab_missing_porch"},
                        }
                    ],
                }
            ],
        },
    )


class Lab:
    """Own fixture state and captured requests for exactly one temporary HA."""

    def __init__(
        self, hass: HomeAssistant, ready_file: Path, capture_file: Path
    ) -> None:
        """Initialize independent in-memory fixture bookkeeping."""
        self.hass = hass
        self.ready_file = ready_file
        self.capture_file = capture_file
        self.requests: list[dict[str, Any]] = []
        self.delivery_mode = "capture"
        self.entities: dict[str, str] = {}
        self.registry_ids: dict[str, str] = {}
        self.devices: dict[str, str] = {}
        self.areas: dict[str, str] = {}
        self.labels: dict[str, str] = {}
        self.owner: ConfigEntry | None = None
        self.clock: Any = None
        self.frozen_clock: Any = None
        self.clock_patch: Any = None
        self.registry_baseline: dict[str, dict[str, Any]] = {}
        self.removed_registry: list[Any] = []
        self.states: dict[str, tuple[str, dict[str, Any]]] = {}
        self.entry: ConfigEntry | None = None
        self.baseline: dict[str, Any] = {}
        self.stop = asyncio.Event()

    async def receive(self, call: ServiceCall) -> None:
        """Capture mock transport requests locally and optionally reject them."""
        self.requests.append(
            {
                "at": datetime.now(UTC).isoformat(),
                "domain": call.domain,
                "service": call.service,
                "data": dict(call.data),
                "outcome": "failed" if self.delivery_mode == "fail" else "requested",
            }
        )
        await self.hass.async_add_executor_job(
            write_json, self.capture_file, self.requests
        )
        if self.delivery_mode == "fail":
            raise HomeAssistantError("Synthetic UI lab provider failure")

    async def seed(self, user_id: str) -> None:
        """Create real HA registry entries, reported states and mock services."""
        hass = self.hass
        flow = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": "user"}
        )
        assert flow["type"] == "create_entry", flow
        owner = flow["result"]
        self.owner = owner
        await hass.async_block_till_done()
        assert owner.state is ConfigEntryState.LOADED, owner.state
        areas = {
            name: ar.async_get(hass).async_create(name).id
            for name in ("Kitchen", "Office", "Upstairs", "Future room")
        }
        self.areas = areas
        self.labels = {
            name: lr.async_get(hass).async_create(name).label_id
            for name in ("Lab temperature", "Lab equipment", "Future equipment")
        }
        for name, area_names in (
            ("Ground floor", ("Kitchen", "Office")),
            ("Upper floor", ("Upstairs", "Future room")),
        ):
            floor = fr.async_get(hass).async_create(name)
            for area_name in area_names:
                ar.async_get(hass).async_update(
                    areas[area_name], floor_id=floor.floor_id
                )
        for key, name, area in (
            ("offline", "Lab offline device", "Office"),
            ("temperature", "Lab room sensor", "Upstairs"),
            ("battery", "Lab battery sensor", "Kitchen"),
            ("vacuum", "Lab vacuum", "Kitchen"),
            ("thermostat", "Lab thermostat", "Upstairs"),
            ("ups", "Lab office UPS", "Office"),
            ("speaker", "Lab kitchen speaker", "Kitchen"),
        ):
            device = dr.async_get(hass).async_get_or_create(
                config_entry_id=owner.entry_id,
                name=name,
                identifiers={("nut", "ui_lab_ups")}
                if key == "ups"
                else {(DOMAIN, key)},
            )
            dr.async_get(hass).async_update_device(device.id, area_id=areas[area])
            self.devices[key] = device.id

        def entity(
            key: str,
            domain: str,
            name: str,
            state: str,
            *,
            device: str | None = None,
            platform: str = DOMAIN,
            unique_id: str | None = None,
            features: int = 0,
            attributes: dict[str, Any] | None = None,
        ) -> None:
            attributes = {"friendly_name": name, **(attributes or {})}
            row = er.async_get(hass).async_get_or_create(
                domain,
                platform,
                unique_id or f"ui_lab_{key}",
                config_entry=owner,
                device_id=self.devices.get(device or ""),
                original_name=name,
                original_device_class=attributes.get("device_class"),
                suggested_object_id=f"ui_lab_{key}",
                supported_features=features,
            )
            self.entities[key], self.registry_ids[key] = row.entity_id, row.id
            self.states[key] = (state, attributes)
            hass.states.async_set(row.entity_id, state, attributes)

        entity(
            "offline",
            "sensor",
            "Lab offline sensor",
            "23",
            device="offline",
            attributes={"unit_of_measurement": "W"},
        )
        entity(
            "offline_second",
            "sensor",
            "Lab secondary reading",
            "12",
            device="offline",
            attributes={"unit_of_measurement": "V"},
        )
        entity(
            "temperature",
            "sensor",
            "Lab room temperature",
            "72",
            device="temperature",
            attributes={"device_class": "temperature", "unit_of_measurement": "°F"},
        )
        entity(
            "temperature_unknown",
            "sensor",
            "Lab unavailable temperature",
            "unknown",
            device="temperature",
            attributes={"device_class": "temperature", "unit_of_measurement": "°F"},
        )
        entity(
            "battery",
            "sensor",
            "Lab battery level",
            "75",
            device="battery",
            attributes={"device_class": "battery", "unit_of_measurement": "%"},
        )
        entity(
            "cleaner",
            "vacuum",
            "Lab vacuum",
            "docked",
            device="vacuum",
            attributes={"battery_level": 90},
        )
        entity(
            "thermostat",
            "climate",
            "Lab thermostat",
            "heat",
            device="thermostat",
            attributes={
                "current_temperature": 70,
                "temperature": 70,
                "hvac_modes": ["off", "heat", "cool"],
                "hvac_action": "idle",
            },
        )
        entity("history", "sensor", "Lab previously failed sensor", "10")
        for index in range(60):
            entity(
                f"bulk_{index}", "sensor", f"Lab standalone reading {index:02d}", "10"
            )
        for index in range(45):
            key = f"temperature_{index}"
            name = (
                "Lab identical temperature"
                if index < 2
                else f"Lab temperature reading {index:02d} with a long equipment name"
            )
            entity(
                key,
                "sensor",
                name,
                "72",
                attributes={"device_class": "temperature", "unit_of_measurement": "°F"},
            )
            er.async_get(hass).async_update_entity(
                self.entities[key],
                area_id=areas["Office" if index < 2 or index % 2 else "Upstairs"]
                if index < 44
                else None,
                labels={self.labels["Lab temperature"]},
            )
        entity("disabled", "sensor", "Lab disabled reading", "unavailable")
        er.async_get(hass).async_update_entity(
            self.entities["disabled"], disabled_by=er.RegistryEntryDisabler.USER
        )
        entity("unmonitored", "sensor", "Lab unmonitored reading", "10")
        entity("messages", "notify", "Lab captured messages", "unknown")
        entity("phone", "notify", "Lab phone", "unknown", platform="mobile_app")
        entity("email", "notify", "Lab email", "unknown", platform="smtp")
        entity(
            "speaker",
            "media_player",
            "Lab kitchen speaker",
            "idle",
            device="speaker",
            features=512,
        )
        entity("local_speech", "tts", "Lab local speech", "unknown")
        entity("alternate_speech", "tts", "Lab alternate speech", "unknown")
        for index in range(24):
            key = f"speaker_{index}"
            entity(
                key,
                "media_player",
                f"Lab speaker {index:02d} with a long room description",
                "idle",
                features=512,
            )
            er.async_get(hass).async_update_entity(
                self.entities[key], area_id=areas["Kitchen" if index % 2 else "Office"]
            )
        entity(
            "satellite", "assist_satellite", "Lab Assist speaker", "idle", features=1
        )
        entity(
            "owner",
            "person",
            "Lab owner",
            "home",
            attributes={"id": "ui_lab_owner", "user_id": user_id},
        )
        for key, suffix, state, attributes in (
            ("ups_status", "ups.status", "OL", {}),
            (
                "ups_charge",
                "battery.charge",
                "90",
                {"device_class": "battery", "unit_of_measurement": "%"},
            ),
            ("ups_runtime", "battery.runtime", "3600", {"unit_of_measurement": "s"}),
        ):
            entity(
                key,
                "sensor",
                f"Lab {key.replace('_', ' ')}",
                state,
                device="ups",
                platform="nut",
                unique_id=f"ui_lab_ups_{suffix}",
                attributes=attributes,
            )
        for domain, service in (
            ("notify", "send_message"),
            ("notify", "ui_lab_sms"),
            ("tts", "speak"),
            ("assist_satellite", "announce"),
        ):
            hass.services.async_register(domain, service, self.receive)
        hass.data["notify_services"] = {"twilio_sms": [self]}
        automation = next(
            state
            for state in hass.states.async_all("automation")
            if state.attributes.get("id") == "ui_lab_missing_light"
        )
        self.entities["automation"] = automation.entity_id
        for entity_id in self.entities.values():
            row = er.async_get(hass).async_get(entity_id)
            if row is not None:
                self.registry_baseline[row.entity_id] = {
                    "name": row.name,
                    "disabled_by": row.disabled_by,
                    "device_id": row.device_id,
                }
        await hass.async_add_executor_job(write_json, self.capture_file, [])

    def settings(self) -> dict[str, Any]:
        """Build current-schema policies against actual registry identities."""
        from custom_components.homeostatic.policy_defaults import initial_settings

        data = initial_settings(self.hass.config.time_zone)
        data["timings"].update(
            settle=0,
            rejoin_grace=0,
            startup_grace=0,
            startup_quiet_max=0,
            clear_hold=0,
            batch=0,
        )
        for policy in data["monitoring_policies"]:
            policy["enabled"] = True
            if policy["check"] == "availability" and "entity" in policy["match"].get(
                "kind", []
            ):
                policy["excluded_sources"] = [
                    f"entity:registry:{self.registry_ids['unmonitored']}"
                ]
        methods = {
            "lab_messages": {
                "name": "Lab captured messages",
                "mode": "fixed",
                "destinations": [f"notify:{self.registry_ids['messages']}"],
            },
            "lab_phone": {
                "name": "Lab phone",
                "mode": "fixed",
                "destinations": [f"notify:{self.registry_ids['phone']}"],
            },
            "lab_speaker": {
                "name": "Lab kitchen speaker",
                "mode": "fixed",
                "destinations": [
                    f"tts:{self.registry_ids['local_speech']}:{self.registry_ids['speaker']}"
                ],
            },
            "lab_presence": {
                "name": "Lab presence delivery",
                "mode": "home_away",
                "people": [self.entities["owner"]],
                "home": [f"notify:{self.registry_ids['phone']}"],
                "away": [f"notify:{self.registry_ids['email']}"],
                "fallback": [f"notify:{self.registry_ids['messages']}"],
                "skip": False,
            },
        }
        data["notification_definitions"]["methods"] = methods
        data["notification_definitions"]["profiles"]["immediate"]["methods"] = [
            "lab_messages"
        ]
        checks = [
            (
                "temperature",
                "Lab temperature limits",
                "temperature_limit",
                {"entity": [f"registry:{self.registry_ids['temperature']}"]},
                {"unit": "°F", "minimum": 60, "maximum": 80, "duration_seconds": 0},
            ),
            (
                "thermostat",
                "Lab thermostat comfort",
                "thermostat",
                {"entity": [f"registry:{self.registry_ids['thermostat']}"]},
                {
                    "unit": "°F",
                    "margin": 2,
                    "progress": 2,
                    "worsening": 2,
                    "progress_seconds": 60,
                },
            ),
            *[
                (check, "Lab " + check.replace("_", " "), check, {"kind": ["ups"]}, {})
                for check in (
                    "ups_power",
                    "ups_reserve",
                    "ups_battery_replacement",
                    "ups_fault",
                )
            ],
        ]
        for identity, name, check, match, parameters in checks:
            data["monitoring_policies"].append(
                {
                    "id": f"lab_{identity}",
                    "name": name,
                    "check": check,
                    "match": match,
                    "parameters": parameters,
                    "enabled": True,
                    "notifications": [
                        {
                            "id": "lab",
                            "profile": "immediate",
                            **({"when": "backup"} if check == "ups_reserve" else {}),
                        }
                    ],
                }
            )
        return data

    async def refresh(self) -> None:
        """Drain reported HA state changes through the real adapter."""
        await self.hass.async_block_till_done()
        assert self.entry is not None
        await self.entry.runtime_data.async_refresh()
        await self.hass.async_block_till_done()

    async def condition(self, failed: bool) -> None:
        """Produce genuine HA evidence for failures or recovery without I/O."""
        values = {
            "offline": "unavailable",
            "offline_second": "unavailable",
            "temperature": "87",
            "battery": "12",
            "cleaner": "error",
            "ups_status": "OB LB RB ALARM",
            "ups_charge": "12",
            "ups_runtime": "120",
        }
        for key, value in values.items():
            state, attributes = self.states[key]
            self.hass.states.async_set(
                self.entities[key], value if failed else state, attributes
            )
        if failed:
            ir.async_create_issue(
                self.hass,
                "automation",
                "ui_lab_service_not_found",
                is_fixable=True,
                severity=ir.IssueSeverity.ERROR,
                translation_key="service_not_found",
                translation_placeholders={
                    "name": "Lab porch alert",
                    "entity_id": "automation.lab_missing_porch_light",
                    "service": "light.ui_lab_missing",
                    "edit": "/config/automation/edit/ui_lab_missing_light",
                },
            )
        else:
            ir.async_delete_issue(self.hass, "automation", "ui_lab_service_not_found")
        await self.hass.services.async_call(
            "homeostatic",
            "report_alert",
            {
                "automation": self.entities["automation"],
                "name": "Lab basement water",
                "message": "Synthetic water reading near the heater",
                "profile": "dashboard",
                "state": "active" if failed else "clear",
                "report_timeout": 86400,
            },
            blocking=True,
            return_response=True,
        )
        await self.refresh()

    async def reset(self) -> None:
        """Recreate the integration and baseline, including a resolved issue."""
        if self.entry is not None:
            assert await self.hass.config_entries.async_remove(self.entry.entry_id)
            await self.hass.async_block_till_done()
        if self.clock is not None:
            self.clock_patch.stop()
            self.clock_patch = None
            self.clock.stop()
            self.clock = self.frozen_clock = None
        if self.hass.data.get("ui_lab_integration_failed"):
            self.hass.data["ui_lab_integration_failed"] = False
            assert self.owner is not None
            await self.hass.config_entries.async_reload(self.owner.entry_id)
        for row in self.removed_registry:
            assert self.owner is not None
            restored = er.async_get(self.hass).async_get_or_create(
                row.domain,
                row.platform,
                row.unique_id,
                config_entry=self.owner,
                device_id=row.device_id,
                original_name=row.original_name,
                original_device_class=row.original_device_class,
                suggested_object_id=row.entity_id.split(".", 1)[1],
                supported_features=row.supported_features,
            )
            for key, identity in self.entities.items():
                if identity == row.entity_id:
                    self.entities[key] = restored.entity_id
                    self.registry_ids[key] = restored.id
        self.removed_registry.clear()
        for entity_id, values in self.registry_baseline.items():
            er.async_get(self.hass).async_update_entity(entity_id, **values)
        self.delivery_mode = "capture"
        for key, (state, attributes) in self.states.items():
            self.hass.states.async_set(self.entities[key], state, attributes)
        ir.async_delete_issue(self.hass, "automation", "ui_lab_service_not_found")
        result = await self.hass.config_entries.flow.async_init(
            "homeostatic", context={"source": "user"}
        )
        assert result["type"] == "create_entry", result
        self.entry = result["result"]
        await self.hass.async_block_till_done()
        self.baseline = self.settings()
        self.hass.config_entries.async_update_entry(
            self.entry, options=deepcopy(self.baseline)
        )
        assert await self.hass.config_entries.async_reload(self.entry.entry_id)
        await self.refresh()
        self.hass.states.async_set(
            self.entities["history"], "unavailable", self.states["history"][1]
        )
        await self.refresh()
        self.hass.states.async_set(self.entities["history"], *self.states["history"])
        await self.refresh()
        await self.condition(True)

    def status(self) -> dict[str, Any]:
        """Report fixture bookkeeping without reading opaque runtime snapshots."""
        return {
            "entry_id": self.entry.entry_id if self.entry else None,
            "delivery_mode": self.delivery_mode,
            "capture_count": len(self.requests),
            "requests": self.requests,
            "entities": self.entities,
            "registry_ids": self.registry_ids,
            "devices": self.devices,
            "areas": self.areas,
            "labels": self.labels,
            "fixture_entry_id": self.owner.entry_id if self.owner else None,
        }

    def register_control(self) -> None:
        """Expose authenticated local fixture controls for the browser runner."""
        import voluptuous as vol

        @websocket_api.websocket_command(
            {
                vol.Required("type"): "homeostatic_ui_lab/control",
                vol.Required("action"): vol.In(
                    [
                        "status",
                        "reset",
                        "outage",
                        "recover",
                        "set_state",
                        "delivery_mode",
                        "reload",
                        "bulk",
                        "remove_state",
                        "remove_registry",
                        "rename_registry",
                        "integration_failure",
                        "temperature_device",
                        "importance_cases",
                        "advance",
                        "shutdown",
                    ]
                ),
                vol.Optional("entity_id"): str,
                vol.Optional("state"): str,
                vol.Optional("attributes"): dict,
                vol.Optional("mode"): vol.In(["capture", "fail"]),
                vol.Optional("failed"): bool,
                vol.Optional("name"): str,
                vol.Optional("seconds"): vol.All(
                    vol.Coerce(float), vol.Range(min=0, max=3600)
                ),
            }
        )
        @websocket_api.require_admin
        @websocket_api.async_response
        async def control(
            hass: HomeAssistant, connection: ActiveConnection, message: dict[str, Any]
        ) -> None:
            action = message["action"]
            if action == "reset":
                await self.reset()
            elif action in {"outage", "recover"}:
                await self.condition(action == "outage")
            elif action == "set_state":
                identity = message.get("entity_id")
                if identity not in self.entities.values() or "state" not in message:
                    connection.send_error(
                        message["id"],
                        "invalid_fixture",
                        "Choose a lab entity and state",
                    )
                    return
                previous = hass.states.get(identity)
                hass.states.async_set(
                    identity,
                    message["state"],
                    message.get(
                        "attributes", dict(previous.attributes) if previous else {}
                    ),
                )
                await self.refresh()
            elif action == "delivery_mode":
                self.delivery_mode = message.get("mode", "capture")
            elif action == "reload":
                assert self.entry is not None
                assert await hass.config_entries.async_reload(self.entry.entry_id)
                await self.refresh()
            elif action == "bulk":
                for key, identity in self.entities.items():
                    if key.startswith("bulk_"):
                        hass.states.async_set(
                            identity,
                            "unavailable"
                            if message.get("failed", True)
                            else self.states[key][0],
                            self.states[key][1],
                        )
                await self.refresh()
            elif action in {"remove_state", "remove_registry", "rename_registry"}:
                identity = message.get("entity_id")
                if identity not in self.registry_baseline:
                    connection.send_error(
                        message["id"], "invalid_fixture", "Choose a lab registry entity"
                    )
                    return
                if action == "remove_registry":
                    row = er.async_get(hass).async_get(identity)
                    if row is not None:
                        self.removed_registry.append(row)
                        er.async_get(hass).async_remove(identity)
                    hass.states.async_remove(identity)
                elif action == "remove_state":
                    hass.states.async_remove(identity)
                else:
                    er.async_get(hass).async_update_entity(
                        identity, name=message.get("name", "Renamed lab source")
                    )
                await self.refresh()
            elif action == "integration_failure":
                hass.data["ui_lab_integration_failed"] = message.get("failed", True)
                assert self.owner is not None
                await hass.config_entries.async_reload(self.owner.entry_id)
                await self.refresh()
            elif action == "temperature_device":
                for key, identity in self.entities.items():
                    if (
                        key.startswith("temperature_")
                        and key.removeprefix("temperature_").isdigit()
                    ) or (
                        key.startswith("bulk_") and int(key.removeprefix("bulk_")) < 10
                    ):
                        er.async_get(hass).async_update_entity(
                            identity, device_id=self.devices["temperature"]
                        )
                await self.refresh()
            elif action == "importance_cases":
                assert self.entry is not None
                options = deepcopy(dict(self.entry.options))
                options["situations"] = [
                    {
                        "id": f"lab_importance_{importance}",
                        "name": f"Lab {importance} importance",
                        "importance": importance,
                        "report_timeout": 86400,
                    }
                    for importance in ("high", "critical")
                ]
                hass.config_entries.async_update_entry(self.entry, options=options)
                assert await hass.config_entries.async_reload(self.entry.entry_id)
                for situation in options["situations"]:
                    await hass.services.async_call(
                        "homeostatic",
                        "report_situation",
                        {"situation_id": situation["id"], "state": "active"},
                        blocking=True,
                        return_response=True,
                    )
                await self.refresh()
            elif action == "advance":
                from freezegun import freeze_time

                if self.clock is None:
                    self.clock = freeze_time(datetime.now(UTC), real_asyncio=True)
                    self.frozen_clock = self.clock.start()
                    # HA binds utcnow to datetime.now in a native partial,
                    # which freezegun cannot replace through its module scan.
                    self.clock_patch = patch.object(
                        dt_util, "utcnow", lambda: datetime.now(UTC)
                    )
                    self.clock_patch.start()
                self.frozen_clock.tick(message.get("seconds", 0))
                await self.refresh()
            connection.send_result(message["id"], self.status())
            if action == "shutdown":
                self.stop.set()

        websocket_api.async_register_command(self.hass, control)


async def smoke(url: str, token: str, lab: Lab) -> dict[str, Any]:
    """Check actual WebSocket saves, reload persistence and mocked delivery."""
    async with (
        ClientSession() as client,
        client.ws_connect(url + "/api/websocket") as ws,
    ):
        assert (await ws.receive_json())["type"] == "auth_required"
        await ws.send_json({"type": "auth", "access_token": token})
        assert (await ws.receive_json())["type"] == "auth_ok"
        identity = 0

        async def call(command: str, **fields: Any) -> Any:
            nonlocal identity
            identity += 1
            await ws.send_json({"id": identity, "type": command, **fields})
            result = await ws.receive_json(timeout=60)
            assert result.get("id") == identity and result.get("success"), result
            return result["result"]

        configuration = await call("homeostatic/configuration")
        saved = deepcopy(configuration["settings"])
        changed = deepcopy(saved)
        changed["notification_definitions"]["methods"]["lab_messages"]["name"] = (
            "Persisted lab method"
        )
        await call(
            "homeostatic/save_settings",
            revision=configuration["revision"],
            settings=changed,
        )
        assert (await call("homeostatic/configuration"))["settings"] == changed
        assert lab.entry is not None
        assert await lab.hass.config_entries.async_reload(lab.entry.entry_id)
        await lab.refresh()
        configuration = await call("homeostatic/configuration")
        assert configuration["settings"] == changed
        preview = await call(
            "homeostatic/preview_delivery_method",
            method_id="lab_messages",
            revision=configuration["revision"],
        )
        result = await call(
            "homeostatic/test_delivery_method",
            method_id="lab_messages",
            revision=configuration["revision"],
            preview_token=preview["preview_token"],
        )
        assert len(result["requested"]) == 1 and not result["failed"], result
        assert len(lab.requests) == 1, lab.requests
        capture_count = len(lab.requests)
        await lab.reset()
        assert (await call("homeostatic/configuration"))["settings"] == saved
        return {
            "result": "pass",
            "saved_and_reloaded": True,
            "reset_restored": True,
            "mock_capture_count": capture_count,
            "no_live_destinations": True,
        }


async def run(
    config: Path, port: int, ready_file: Path, capture_file: Path, smoke_test: bool
) -> None:
    """Start one isolated HA, publish its credentials, and shut down cleanly."""
    hass = await bootstrap.async_setup_hass(
        RuntimeConfig(config_dir=str(config), log_no_color=True)
    )
    assert hass is not None
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    signals = (signal.SIGINT, signal.SIGTERM)
    previous_handlers = {item: signal.getsignal(item) for item in signals}
    for item in signals:
        loop.add_signal_handler(item, stop.set)
    try:
        user = await hass.auth.async_create_user(
            "UI laboratory owner", group_ids=[GROUP_ID_ADMIN], local_only=True
        )
        await hass.async_start()
        http_store = await async_get_and_load_store(hass)
        if http_store.pending is not None:
            assert http_store.pending["server_host"] == ["127.0.0.1"]
            assert http_store.pending["server_port"] == port
            await http_store.async_promote_pending()
        lab = Lab(hass, ready_file, capture_file)
        lab.stop = stop
        await lab.seed(user.id)
        await lab.reset()
        lab.register_control()
        url = f"http://127.0.0.1:{port}"
        refresh = await hass.auth.async_create_refresh_token(user, client_id=url + "/")
        token = hass.auth.async_create_access_token(refresh)
        from custom_components.homeostatic.dashboard import PANEL_ELEMENT

        versions = await hass.async_add_executor_job(
            lambda: {
                "ha_version": version("homeassistant"),
                "health_tree_version": version("health-tree"),
            }
        )
        result = {
            "url": url,
            "panel_url": url + "/homeostatic",
            "access_token": token,
            "refresh_token": refresh.token,
            "token_type": "Bearer",
            "expires_in": 1800,
            "hass_url": url,
            "client_id": url + "/",
            "panel_element": PANEL_ELEMENT,
            "python_version": sys.version.split()[0],
            **versions,
            "config_dir": str(config),
            "capture_file": str(lab.capture_file),
            "baseline_settings": {
                key: lab.baseline[key]
                for key in (
                    "timings",
                    "notifications",
                    "consumer",
                    "monitoring_policies",
                    "notification_definitions",
                )
            },
            **lab.status(),
        }
        await hass.async_add_executor_job(
            lambda: write_json(ready_file, result, private=True)
        )
        sys.stdout.write(f"UI LAB READY {url}/homeostatic\n")
        sys.stdout.flush()
        if smoke_test:
            evidence = await smoke(url, token, lab)
            await hass.async_add_executor_job(
                write_json,
                capture_file.with_name(capture_file.stem + "-smoke.json"),
                evidence,
            )
            sys.stdout.write(json.dumps(evidence) + "\n")
        else:
            await lab.stop.wait()
    finally:
        await hass.async_stop()
        await asyncio.to_thread(ready_file.unlink, missing_ok=True)
        for item in signals:
            loop.remove_signal_handler(item)
            signal.signal(item, previous_handlers[item])


def main() -> None:
    """Parse independent-worker paths and run only against a temporary config."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8127)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument(
        "--capture-file", type=Path, default=REPO / "build/ui-sweep/mock-requests.json"
    )
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument(
        "--component", type=Path, default=REPO / "custom_components/homeostatic"
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose an unprivileged loopback port")
    ready_file = args.ready_file.resolve()
    ready_file.parent.mkdir(parents=True, exist_ok=True)
    ready_file.unlink(missing_ok=True)
    temporary = TemporaryDirectory(prefix="homeostatic-ui-lab-")
    try:
        config = Path(temporary.name)
        prepare(config, args.port, args.component.resolve())
        with suppress(KeyboardInterrupt):
            asyncio.run(
                run(
                    config,
                    args.port,
                    ready_file,
                    args.capture_file.resolve(),
                    args.smoke_test,
                ),
                loop_factory=create_event_loop,
            )
    finally:
        # HA's blocking-I/O detector remains attached after the loop stops.
        with ThreadPoolExecutor(max_workers=1) as cleanup:
            cleanup.submit(temporary.cleanup).result()


if __name__ == "__main__":
    main()
