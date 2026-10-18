"""Concurrent configuration reads observe a complete save or its rollback."""

import asyncio
from copy import deepcopy
from datetime import datetime
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.components.websocket_api.connection import ActiveConnection
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.runtime import Runtime
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("section", ["settings", "all"])
@pytest.mark.parametrize("fail", [False, True], ids=["committed", "rolled-back"])
async def test_configuration_read_waits_for_coherent_save(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    section: str,
    fail: bool,
) -> None:
    """A second editor cannot use a new revision with pre-save settings."""
    hass.states.async_set("sensor.observed", "1")
    runtime = await start_monitor(hass, config_entry)
    first = await hass_ws_client(hass)
    second = await hass_ws_client(hass)
    await first.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    baseline = (await first.receive_json())["result"]
    draft = deepcopy(baseline["settings"])
    draft["monitoring_policies"][0]["name"] = "Renamed by first editor"
    apply_started, read_started = asyncio.Event(), asyncio.Event()
    apply = runtime.async_apply_settings
    complete = runtime._complete
    configuration = dashboard._async_configuration

    async def applying(settings: Settings) -> None:
        apply_started.set()
        await apply(settings)

    async def reading(
        current_hass: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        read_started.set()
        await configuration(current_hass, connection, msg)

    failures = 0

    async def completing(
        current_runtime: Runtime, now: datetime, *, durable: bool = False
    ) -> None:
        nonlocal failures
        # Only the first editor's save fails; the reload that follows completes.
        if fail and failures == 0:
            failures += 1
            raise OSError("Write failed")
        await complete(now, durable=durable)

    await runtime._lock.acquire()
    try:
        with (
            patch.object(runtime, "async_apply_settings", side_effect=applying),
            patch.object(dashboard, "_async_configuration", side_effect=reading),
            patch.object(
                dashboard,
                "_settings_configuration",
                wraps=dashboard._settings_configuration,
            ) as settings_read,
            patch.object(
                Runtime,
                "_complete",
                new=completing,
            ),
        ):
            await first.send_json(
                {
                    "id": 2,
                    "type": "homeostatic/save_settings",
                    "revision": baseline["revision"],
                    "settings": draft,
                }
            )
            await asyncio.wait_for(apply_started.wait(), timeout=1)
            await second.send_json(
                {"id": 1, "type": "homeostatic/configuration", "section": section}
            )
            await asyncio.wait_for(read_started.wait(), timeout=1)
            settings_read.assert_not_called()
            runtime._lock.release()
            saved = await first.receive_json()
            if fail:
                assert saved["error"]["code"] == "apply_failed"
            else:
                assert saved.get("result") == {"saved": True}, saved
            fresh = (await second.receive_json())["result"]
            expected = baseline["settings"] if fail else draft
            assert fresh["settings"] == expected
            assert fresh["revision"] == dashboard._configuration(runtime)[1]
            assert (fresh["revision"] == baseline["revision"]) is fail

        if fail:
            # The failed save reloads the integration from the saved state (ADR 0100).
            await hass.async_block_till_done()
            runtime = config_entry.runtime_data
        second_draft = deepcopy(fresh["settings"])
        second_draft["monitoring_policies"][0]["enabled"] = False
        await second.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": fresh["revision"],
                "settings": second_draft,
            }
        )
        second_saved = await second.receive_json()
        assert second_saved.get("result") == {"saved": True}, (
            second_saved,
            config_entry.state,
            getattr(config_entry.runtime_data, "error", None),
            getattr(config_entry.runtime_data, "running", None),
        )
        assert (
            runtime.settings.monitoring_policies[0].name
            == expected["monitoring_policies"][0]["name"]
        )
    finally:
        if runtime._lock.locked():
            runtime._lock.release()
        assert await hass.config_entries.async_unload(config_entry.entry_id)
        await first.close()
        await second.close()


@pytest.mark.parametrize("section", ["settings", "all"])
@pytest.mark.parametrize("replace_runtime", [True, False], ids=["reloaded", "unloaded"])
async def test_queued_configuration_read_uses_runtime_after_save_lock(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    section: str,
    replace_runtime: bool,
) -> None:
    """A queued read uses the replacement runtime or reports terminal unavailability."""
    hass.states.async_set("sensor.observed", "1")
    original = await start_monitor(hass, config_entry)
    model = hass.data[dashboard.DATA_DASHBOARD]
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    baseline = (await client.receive_json())["result"]
    read_started = asyncio.Event()
    configuration = dashboard._async_configuration

    async def reading(
        current_hass: HomeAssistant,
        connection: ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        read_started.set()
        await configuration(current_hass, connection, msg)

    try:
        with (
            patch.object(dashboard, "_async_configuration", side_effect=reading),
            patch.object(
                dashboard,
                "_settings_configuration",
                wraps=dashboard._settings_configuration,
            ) as settings_read,
        ):
            async with model.save_lock:
                await client.send_json(
                    {"id": 2, "type": "homeostatic/configuration", "section": section}
                )
                await asyncio.wait_for(read_started.wait(), timeout=1)
                settings_read.assert_not_called()
                assert model.runtime is original
                if replace_runtime:
                    options = deepcopy(dict(config_entry.data))
                    options["monitoring_policies"][0]["name"] = "Name after reload"
                    hass.config_entries.async_update_entry(
                        config_entry, options=options
                    )
                    assert await hass.config_entries.async_reload(config_entry.entry_id)
                    replacement = config_entry.runtime_data
                    assert model.runtime is replacement
                    assert replacement is not original
                else:
                    assert await hass.config_entries.async_unload(config_entry.entry_id)
                    assert model.runtime is None
                settings_read.assert_not_called()
            response = await client.receive_json()
            if replace_runtime:
                fresh = response["result"]
                settings_read.assert_called_once_with(hass, replacement)
                assert fresh["settings"] == dashboard._editable_settings(
                    replacement.settings
                )
                assert fresh["settings"]["monitoring_policies"][0]["name"] == (
                    "Name after reload"
                )
                assert fresh["revision"] == dashboard._configuration(replacement)[1]
                assert fresh["revision"] != baseline["revision"]
            else:
                assert response["error"]["code"] == "not_ready"
                assert "result" not in response
                settings_read.assert_not_called()
    finally:
        if config_entry.state is ConfigEntryState.LOADED:
            assert await hass.config_entries.async_unload(config_entry.entry_id)
        await client.close()
