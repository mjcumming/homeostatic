"""Verify a release ZIP in a fresh HA-only environment without editable dependencies."""

import asyncio
import hashlib
import importlib.metadata
import json
import socket
import sys
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from aiohttp import ClientSession
from homeassistant import bootstrap
from homeassistant.config_entries import ConfigEntryState
from homeassistant.runner import RuntimeConfig, create_event_loop
from homeassistant.util import dt as dt_util


def unpack(archive_path: Path, config: Path) -> dict[str, str]:
    """Verify all packaged checksums and install only the custom component."""
    with ZipFile(archive_path) as archive:
        assert archive.testzip() is None, "Corrupt installation archive"
        info = json.loads(archive.read("BUILD_INFO.json"))
        changelog = archive.read("CHANGELOG.md").decode("utf-8")
        assert f"## [{info['version']}]" in changelog, "Missing release upgrade notes"
        for name, digest in info["files_sha256"].items():
            data = archive.read(name)
            assert hashlib.sha256(data).hexdigest() == digest, name
            if name.startswith("custom_components/homeostatic/"):
                target = (config / name).resolve()
                assert target.is_relative_to(config.resolve()), name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    requirement = next(
        value for value in info["requirements"] if value.startswith("health-tree==")
    )
    return {
        "version": info["version"],
        "commit": info["commit"],
        "health_tree_requirement": requirement,
    }


async def exercise(config: Path, port: int) -> None:
    """Use normal HA dependency installation, setup, observations and reload."""
    hass = await bootstrap.async_setup_hass(
        RuntimeConfig(config_dir=str(config), log_no_color=True)
    )
    assert hass is not None, "Home Assistant failed to bootstrap"
    try:
        await hass.async_start()
        hass.states.async_set("sensor.pilot_source", "42")
        result = await hass.config_entries.flow.async_init(
            "homeostatic", context={"source": "user"}
        )
        assert result["type"] == "create_entry", result
        await hass.async_block_till_done()
        entry = result["result"]
        assert entry.state is ConfigEntryState.LOADED, entry.state
        assert entry.data["monitoring_policy_version"] == 1
        assert len(entry.data["monitoring_policies"]) == 8
        assert {
            item["id"]: item["notifications"]
            for item in entry.data["monitoring_policies"]
        } == {
            identity: [{"id": "default", "profile": profile}]
            for identity, profile in (
                ("default_integrations", "morning"),
                ("default_devices", "morning"),
                ("default_entities", "morning"),
                ("default_important_equipment", "immediate"),
                ("default_repairs", "morning"),
                ("default_broken_automations", "morning"),
                ("default_batteries", "morning"),
                ("default_vacuums", "evening"),
            )
        }
        definitions = entry.data["notification_definitions"]
        assert set(definitions["profiles"]) == {
            "immediate",
            "acknowledge",
            "urgent",
            "morning",
            "evening",
            "weekly",
        }
        assert all(
            profile["methods"] == [] for profile in definitions["profiles"].values()
        )
        assert definitions["methods"] == {}
        assert {
            identity: definitions["profiles"][identity]["timing"][
                "collection_delay_seconds"
            ]
            for identity in ("immediate", "acknowledge", "urgent")
        } == {"immediate": 60, "acknowledge": 5, "urgent": 60}
        assert all(
            "collection_delay_seconds"
            not in definitions["profiles"][identity]["timing"]
            for identity in ("morning", "evening", "weekly")
        )
        assert entry.data["notifications"] is False
        assert entry.data["consumer"] is None
        assert not entry.runtime_data.query("inventory", {})["notification_requests"]

        # Published 1.9 settings used these named timing shapes without a delay.
        # Exercise the authorized reset through real setup, using only a fake route.
        fresh = deepcopy(dict(entry.data))
        legacy = deepcopy(fresh)
        legacy["notifications"] = True
        legacy["consumer"] = "automation.legacy_consumer"
        legacy["timings"]["batch"] = 123
        legacy_definitions = legacy["notification_definitions"]
        for profile in legacy_definitions["profiles"].values():
            profile["timing"].pop("collection_delay_seconds", None)
        legacy_definitions["methods"] = {
            "legacy": {
                "name": "Legacy destination",
                "mode": "fixed",
                "destinations": ["service:legacy_unused"],
            }
        }
        legacy_definitions["profiles"]["immediate"].update(
            name="Legacy immediate", methods=["legacy"]
        )
        legacy["monitoring_policies"] = [
            {
                "id": "legacy_policy",
                "name": "Legacy entity choice",
                "check": "availability",
                "enabled": True,
                "match": {"kind": ["entity"]},
                "parameters": {},
                "notifications": [{"id": "now", "profile": "immediate"}],
            }
        ]
        hass.config_entries.async_update_entry(entry, options=legacy)
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.LOADED, entry.state
        assert dict(entry.data) == fresh, "Legacy settings did not reset to defaults"
        assert not entry.options, "Legacy options still override the reset settings"
        assert not entry.runtime_data.settings.notifications
        assert not entry.runtime_data.query("inventory", {})["notification_requests"]

        hass.config_entries.async_update_entry(
            entry,
            options={
                **entry.data,
                "timings": {
                    **entry.data["timings"],
                    "startup_grace": 0,
                    "settle": 0,
                    "rejoin_grace": 0,
                    "clear_hold": 0,
                },
                "monitoring_policies": [
                    {
                        "id": "pilot",
                        "name": "Pilot entity",
                        "check": "availability",
                        "enabled": True,
                        "match": {
                            "kind": ["entity"],
                            "entity": ["entity_id:sensor.pilot_source"],
                        },
                        "parameters": {},
                        "notifications": [],
                    },
                    next(
                        item
                        for item in entry.data["monitoring_policies"]
                        if item["id"] == "default_repairs"
                    ),
                ],
            },
        )
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert runtime.available
        assert not runtime.settings.notifications
        pilot_anchor = next(
            source.node_id
            for source in runtime.sources.values()
            if source.monitoring_policy == "pilot"
        )
        assert runtime.query("readiness", {})["answer"] == "ready"
        async with ClientSession() as client:
            frontend = config / "custom_components" / "homeostatic" / "frontend"
            assets = await hass.async_add_executor_job(
                lambda: sorted(
                    path.name
                    for path in frontend.iterdir()
                    if path.suffix in {".js", ".mjs"}
                )
            )
            assert "homeostatic.js" in assets, "Missing frontend entry point"
            for asset in assets:
                async with client.get(
                    f"http://127.0.0.1:{port}/homeostatic_static/{asset}"
                ) as response:
                    assert response.status == 200, asset
                    assert await response.read(), asset
        hass.states.async_set("sensor.pilot_source", "unavailable")
        await hass.async_block_till_done()
        assert runtime.query("readiness", {})["answer"] == "degraded"
        inventory = runtime.query("inventory", {})
        pilot = [row for row in inventory["episodes"] if row["anchor"] == pilot_anchor]
        # A fresh Home Assistant can raise its own Repairs, which are issues too.
        assert len(pilot) == 1, inventory["episodes"]
        assert all(
            runtime.sources[row["anchor"]].kind == "repair"
            for row in inventory["episodes"]
            if row not in pilot
        ), inventory["episodes"]
        assert inventory["attention_controls_supported"]
        episode = pilot[0]["episode_id"]
        acknowledgment = await hass.services.async_call(
            "homeostatic",
            "acknowledge",
            {"episode_id": episode},
            blocking=True,
            return_response=True,
        )
        assert acknowledgment["acknowledgment"]["episode_id"] == episode
        shelf = await hass.services.async_call(
            "homeostatic",
            "shelve",
            {
                "episode_id": episode,
                "until": (dt_util.utcnow() + timedelta(minutes=5)).isoformat(),
            },
            blocking=True,
            return_response=True,
        )
        await hass.services.async_call(
            "homeostatic",
            "cancel_control",
            {"control_id": shelf["control"]["control_id"]},
            blocking=True,
            return_response=True,
        )
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        decision = next(
            row
            for row in runtime.query("policy", {})["episodes"]
            if row["episode_id"] == episode
        )
        assert decision["acknowledgment"] == acknowledgment["acknowledgment"]
        assert not runtime.query("operator_controls", {})["controls"]
        assert runtime.query("readiness", {})["answer"] == "degraded"
        hass.states.async_set("sensor.pilot_source", "42")
        await hass.async_block_till_done()
        history = runtime.query("resolved_history", {})
        # Integration problems from the isolated HA install can also end here.
        pilot = [
            row
            for row in history["episodes"]
            if row["episode"]["anchor"] == pilot_anchor
        ]
        assert [row["resolution"] for row in pilot] == ["cleared"], history
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
        raise SystemExit("Usage: python script/smoke_release.py <release.zip>")
    try:
        importlib.metadata.distribution("health-tree")
    except importlib.metadata.PackageNotFoundError:
        pass
    else:
        raise SystemExit(
            "Use a fresh HA-only environment without health-tree installed."
        )
    archive_path = Path(sys.argv[1]).resolve()
    with TemporaryDirectory(prefix="homeostatic-release-") as temporary:
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
        assert (
            f"health-tree=={installed.version}" == identity["health_tree_requirement"]
        ), installed.version
        assert installed.read_text("direct_url.json") is None
        identity["health_tree"] = installed.version
        identity["health_tree_location"] = str(installed.locate_file("health_tree"))
        identity["result"] = "PASS"
        sys.stdout.write(json.dumps(identity, indent=2) + "\n")


if __name__ == "__main__":
    main()
