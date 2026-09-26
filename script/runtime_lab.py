"""Run a loopback-only, synthetic HA laboratory with real Store and WebSocket I/O."""

import argparse
import asyncio
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from unittest.mock import patch

from aiohttp import ClientSession
from homeassistant import bootstrap
from homeassistant.auth.const import GROUP_ID_ADMIN
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import callback
from homeassistant.runner import RuntimeConfig, create_event_loop

PORT = 8126
CONFIG: Path
REPO = Path(__file__).resolve().parents[1]
REPORT = REPO / "build/runtime-profile/real-storage.json"

SEED = """from homeassistant.helpers import device_registry as dr, entity_registry as er

async def async_setup_entry(hass, entry):
    entities = []
    devices = []
    for number in range(30):
        index = entry.data['index'] * 30 + number
        device = dr.async_get(hass).async_get_or_create(config_entry_id=entry.entry_id,
            identifiers={('homeostatic_lab', str(index))}, name=f'Lab device {index:03}')
        devices.append(device.id)
        for capability in range(20):
            name = f'Lab {index:03} capability {capability:02}'
            entity = er.async_get(hass).async_get_or_create('sensor', 'homeostatic_lab',
                f'{index}_{capability}', config_entry=entry, device_id=device.id,
                original_name=name, suggested_object_id=f'lab_{index:03}_{capability:02}')
            entities.append(entity.entity_id)
            hass.states.async_set(entity.entity_id, '0', {'friendly_name': name})
    hass.data.setdefault('homeostatic_lab', {})[entry.entry_id] = (devices, entities)
    return True

async def async_unload_entry(hass, entry):
    return True
"""
FLOW = """from homeassistant import config_entries

class LabFlow(config_entries.ConfigFlow, domain='homeostatic_lab'):
    VERSION = 1
    async def async_step_user(self, user_input=None):
        return self.async_create_entry(title=f"Synthetic controller {user_input['index']}", data=user_input)
"""


def prepare() -> None:
    """Install only synthetic fixtures into the newly allocated temporary directory."""
    shutil.copytree(
        REPO / "custom_components/homeostatic",
        CONFIG / "custom_components/homeostatic",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    seed = CONFIG / "custom_components/homeostatic_lab"
    seed.mkdir()
    (seed / "__init__.py").write_text(SEED)
    (seed / "config_flow.py").write_text(FLOW)
    (seed / "manifest.json").write_text(
        json.dumps(
            {
                "domain": "homeostatic_lab",
                "name": "Synthetic runtime laboratory",
                "version": "1.0.0",
                "config_flow": True,
                "codeowners": [],
                "documentation": "https://github.com/mjcumming/homeostatic",
                "iot_class": "local_push",
            }
        )
    )
    storage = CONFIG / ".storage"
    storage.mkdir()
    (storage / "onboarding").write_text(
        json.dumps(
            {
                "version": 4,
                "minor_version": 1,
                "key": "onboarding",
                "data": {"done": ["user", "core_config", "integration", "analytics"]},
            }
        )
    )
    (CONFIG / "configuration.yaml").write_text(
        "homeassistant:\n  name: Synthetic Homeostatic laboratory\n  latitude: 0\n"
        "  longitude: 0\n  elevation: 0\n  time_zone: UTC\n  unit_system: metric\n  country: US\n"
        "  auth_providers:\n    - type: trusted_networks\n      trusted_networks:\n"
        "        - 127.0.0.1/32\n      allow_bypass_login: true\n"
        f"http:\n  server_host: 127.0.0.1\n  server_port: {PORT}\n"
        "frontend:\nconfig:\napi:\nwebsocket_api:\nlogger:\n  default: warning\n"
    )


async def run(serve: bool) -> None:
    """Measure real disk and transport work, then optionally keep the lab open."""
    hass = await bootstrap.async_setup_hass(
        RuntimeConfig(config_dir=str(CONFIG), log_no_color=True)
    )
    assert hass is not None
    try:
        user = await hass.auth.async_create_user(
            "Synthetic lab owner", group_ids=[GROUP_ID_ADMIN], local_only=True
        )
        await hass.async_start()
        devices, entities = [], []
        for index in range(10):
            result = await hass.config_entries.flow.async_init(
                "homeostatic_lab", context={"source": "user"}, data={"index": index}
            )
            assert result["type"] == "create_entry", result
            await hass.async_block_till_done()
            owner = result["result"]
            assert owner.state is ConfigEntryState.LOADED, owner.state
            owned_devices, owned_entities = hass.data["homeostatic_lab"][owner.entry_id]
            devices.extend(owned_devices)
            entities.extend(owned_entities)
        flow = await hass.config_entries.flow.async_init(
            "homeostatic", context={"source": "user"}
        )
        started = perf_counter()
        result = await hass.config_entries.flow.async_configure(
            flow["flow_id"],
            {
                "notifications": False,
                "rules": [
                    {
                        "id": "lab_controllers",
                        "action": "attach",
                        "match": {"domain": "homeostatic_lab", "kind": "integration"},
                    },
                    {
                        "id": "lab_selected",
                        "action": "attach",
                        "match": {"device": devices[:3]},
                    },
                ],
                "startup_grace": 0,
                "settle": 0,
                "rejoin_grace": 0,
                "clear_hold": 0,
                "coalesce_count": 10000,
            },
        )
        assert result["type"] == "create_entry", result
        await hass.async_block_till_done()
        entry = result["result"]
        assert entry.state is ConfigEntryState.LOADED, entry.state
        runtime = entry.runtime_data
        assert len(runtime.sources) == 70
        results = {
            "ha": "2026.9.3",
            "scope": "60 synthetic entities and 10 controllers",
            "setup_seconds": perf_counter() - started,
            "registered_entities": 6000,
        }
        refresh = await hass.auth.async_create_refresh_token(
            user, client_id=f"http://127.0.0.1:{PORT}/"
        )
        token = hass.auth.async_create_access_token(refresh)
        async with (
            ClientSession() as client,
            client.ws_connect(f"http://127.0.0.1:{PORT}/api/websocket") as ws,
        ):
            assert (await ws.receive_json())["type"] == "auth_required"
            await ws.send_json({"type": "auth", "access_token": token})
            assert (await ws.receive_json())["type"] == "auth_ok"
            await ws.send_json(
                {"id": 1, "type": "homeostatic/subscribe", "compact": True}
            )
            assert (await ws.receive_json())["success"]
            baseline = await ws.receive()
            assert json.loads(baseline.data)["event"]["inventory_changed"]
            results["initial_websocket_bytes"] = len(baseline.data.encode())

            async def measure(name: str, state: str) -> None:
                """Time one captured burst through a received WebSocket event."""
                previous = perf_counter()
                gaps = []
                handle = None

                def probe() -> None:
                    """Sample event-loop scheduling gaps without sleeps."""
                    nonlocal previous, handle
                    current = perf_counter()
                    gaps.append(current - previous)
                    previous = current
                    handle = asyncio.get_running_loop().call_soon(probe)

                started = perf_counter()
                handle = asyncio.get_running_loop().call_soon(probe)
                try:
                    with (
                        patch.object(runtime, "_save", wraps=runtime._save) as saves,
                        patch.object(
                            runtime, "_discover", wraps=runtime._discover
                        ) as scans,
                    ):
                        for entity_id in entities[:60]:
                            attributes = hass.states.get(entity_id).attributes
                            hass.states.async_set(entity_id, state, attributes)
                        await hass.async_block_till_done()
                        packet = await asyncio.wait_for(ws.receive(), 10)
                        payload = json.loads(packet.data)["event"]
                        assert (
                            payload["schema_version"] == 2
                            and not payload["inventory_changed"]
                        )
                        assert len(payload["inventory"]["episodes"]) == (
                            60 if state == "unavailable" else 0
                        )
                        results[name] = {
                            "seconds": perf_counter() - started,
                            "max_loop_gap_seconds": max(gaps, default=0),
                            "save_calls": saves.call_count,
                            "inventory_scans": scans.call_count,
                            "websocket_bytes": len(packet.data.encode()),
                            "episodes": len(runtime.episodes),
                        }
                finally:
                    handle.cancel()

            await measure("outage_60", "unavailable")
            assert runtime.readiness == "blocked"
            await measure("recovery_60", "1")
            assert runtime.readiness == "ready"
        await hass.async_add_executor_job(
            REPORT.write_text, json.dumps(results, indent=2)
        )
        for entity_id in entities[:2]:
            hass.states.async_set(
                entity_id, "unavailable", hass.states.get(entity_id).attributes
            )
        await hass.async_block_till_done()
        episode_ids = set(runtime.episodes)
        assert len(episode_ids) == 2
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert set(entry.runtime_data.episodes) == episode_ids
        results["reload_preserved_episode_ids"] = True
        results["storage_bytes"] = (
            await hass.async_add_executor_job(Path(runtime.store.path).stat)
        ).st_size
        await hass.async_add_executor_job(
            REPORT.write_text, json.dumps(results, indent=2)
        )

        @callback
        def change(call) -> None:
            """Change only generated lab states for interactive inspection."""
            state = "unavailable" if call.service == "outage" else "1"
            for entity_id in entities[:60]:
                hass.states.async_set(
                    entity_id, state, hass.states.get(entity_id).attributes
                )

        hass.services.async_register("homeostatic_lab", "outage", change)
        hass.services.async_register("homeostatic_lab", "recover", change)
        sys.stdout.write(f"LAB READY http://127.0.0.1:{PORT}/homeostatic\n")
        sys.stdout.flush()
        if serve:
            await asyncio.Event().wait()
    finally:
        await hass.async_stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Keep the synthetic dashboard available after measuring",
    )
    args = parser.parse_args()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="homeostatic-runtime-lab-") as directory:
        CONFIG = Path(directory)
        prepare()
        if args.serve:
            with suppress(KeyboardInterrupt):
                asyncio.run(run(True), loop_factory=create_event_loop)
        else:
            with ThreadPoolExecutor(max_workers=1) as runner:
                runner.submit(
                    asyncio.run, run(False), loop_factory=create_event_loop
                ).result()
