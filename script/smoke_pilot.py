"""Verify a pilot ZIP in a fresh HA-only environment without editable dependencies."""

import asyncio
import hashlib
import importlib.metadata
import json
import socket
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from aiohttp import ClientSession
from homeassistant import bootstrap
from homeassistant.config_entries import ConfigEntryState
from homeassistant.runner import RuntimeConfig, create_event_loop


def unpack(archive_path: Path, config: Path) -> dict[str, str]:
    """Verify all packaged checksums and install only the custom component."""
    with ZipFile(archive_path) as archive:
        assert archive.testzip() is None, "Corrupt installation archive"
        info = json.loads(archive.read("BUILD_INFO.json"))
        for name, digest in info["files_sha256"].items():
            data = archive.read(name)
            assert hashlib.sha256(data).hexdigest() == digest, name
            if name.startswith("custom_components/homeostatic/"):
                target = (config / name).resolve()
                assert target.is_relative_to(config.resolve()), name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    return {"version": info["version"], "commit": info["commit"]}


async def exercise(config: Path, port: int) -> None:
    """Use normal HA dependency installation, setup, observations and reload."""
    hass = await bootstrap.async_setup_hass(
        RuntimeConfig(config_dir=str(config), log_no_color=True)
    )
    assert hass is not None, "Home Assistant failed to bootstrap"
    try:
        await hass.async_start()
        hass.states.async_set("sensor.pilot_source", "42")
        flow = await hass.config_entries.flow.async_init(
            "homeostatic", context={"source": "user"}
        )
        assert flow["type"] == "form", flow
        result = await hass.config_entries.flow.async_configure(
            flow["flow_id"],
            {
                "notifications": False,
                "rules": [
                    {
                        "id": "pilot",
                        "action": "attach",
                        "match": {"entity": "sensor.pilot_source"},
                    }
                ],
                "functions": [
                    {
                        "id": "pilot_function",
                        "name": "Pilot function",
                        "requires": ["sensor.pilot_source"],
                    }
                ],
                "startup_grace": 0,
                "settle": 0,
                "rejoin_grace": 0,
                "clear_hold": 0,
            },
        )
        assert result["type"] == "create_entry", result
        await hass.async_block_till_done()
        entry = result["result"]
        assert entry.state is ConfigEntryState.LOADED, entry.state
        runtime = entry.runtime_data
        assert runtime.available
        assert not runtime.settings.notifications
        assert runtime.query("readiness", {})["answer"] == "ready"
        async with ClientSession() as client:
            for asset in (
                "homeostatic.js?v=7",
                "model.mjs?v=7",
                "problem.mjs?v=7",
                "history-controls.mjs?v=7",
                "styles.mjs?v=7",
            ):
                async with client.get(
                    f"http://127.0.0.1:{port}/homeostatic_static/{asset}"
                ) as response:
                    assert response.status == 200, asset
                    assert await response.read(), asset
        hass.states.async_set("sensor.pilot_source", "unavailable")
        await hass.async_block_till_done()
        assert runtime.query("readiness", {})["answer"] == "blocked"
        assert len(runtime.query("inventory", {})["episodes"]) == 1
        hass.states.async_set("sensor.pilot_source", "42")
        await hass.async_block_till_done()
        history = runtime.query("resolved_history", {})
        assert len(history["episodes"]) == 1
        assert history["episodes"][0]["resolution"] == "cleared"
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.runtime_data.available
        assert entry.runtime_data.query("resolved_history", {}) == history
        assert entry.runtime_data.query("operator_controls", {}) is not None
        assert not entry.runtime_data.query("inventory", {})["notification_requests"]
    finally:
        await hass.async_stop()


def main() -> None:
    """Require a pristine dependency environment and report the installed release."""
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python script/smoke_pilot.py <pilot.zip>")
    try:
        importlib.metadata.distribution("health-tree")
    except importlib.metadata.PackageNotFoundError:
        pass
    else:
        raise SystemExit(
            "Use a fresh HA-only environment without health-tree installed."
        )
    archive_path = Path(sys.argv[1]).resolve()
    with TemporaryDirectory(prefix="homeostatic-pilot-") as temporary:
        config = Path(temporary)
        identity = unpack(archive_path, config)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        (config / "configuration.yaml").write_text(
            "homeassistant:\n  name: Isolated pilot smoke\n  latitude: 0\n"
            "  longitude: 0\n  elevation: 0\n  time_zone: UTC\n"
            "  unit_system: metric\n  country: US\n"
            f"http:\n  server_host: 127.0.0.1\n  server_port: {port}\n"
            "logger:\n  default: warning\n",
            encoding="utf-8",
        )
        # HA's blocking-I/O detector stays attached to its loop thread after shutdown.
        with ThreadPoolExecutor(max_workers=1) as runner:
            runner.submit(
                asyncio.run, exercise(config, port), loop_factory=create_event_loop
            ).result()
        installed = importlib.metadata.distribution("health-tree")
        assert installed.version == "0.3.0", installed.version
        assert installed.read_text("direct_url.json") is None
        identity["health_tree"] = installed.version
        identity["health_tree_location"] = str(installed.locate_file("health_tree"))
        identity["result"] = "PASS"
        sys.stdout.write(json.dumps(identity, indent=2) + "\n")


if __name__ == "__main__":
    main()
