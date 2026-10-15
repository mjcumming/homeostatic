"""Settings reloads retain navigation through success and rollback failures."""

from collections.abc import Awaitable, Callable
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD, MODULE_URL
from tests.test_lifecycle import start_monitor


async def test_timing_save_reloads_runtime_without_removing_panel(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An installation timing save keeps its page and subscription until the reload confirms success."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    panel = hass.data[frontend.DATA_PANELS][DOMAIN]
    client = await hass_ws_client(hass)
    stream = await hass_ws_client(hass)
    await stream.send_json({"id": 1, "type": "homeostatic/subscribe"})
    assert (await stream.receive_json())["success"]
    assert (await stream.receive_json())["event"]["available"]
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["timings"]["settle"] = 5
    with (
        patch.object(
            frontend,
            "async_remove_panel",
            side_effect=AssertionError("Save must retain its panel"),
        ),
        patch.object(
            frontend,
            "async_register_built_in_panel",
            side_effect=AssertionError("Retained panel must not be replaced"),
        ),
        patch.object(
            frontend,
            "remove_extra_js_url",
            side_effect=AssertionError("Save must retain its assets"),
        ),
    ):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["result"] == {"saved": True}
        await hass.async_block_till_done()
    publications = [
        (await stream.receive_json())["event"]["available"] for _ in range(3)
    ]
    assert publications == [False, False, True]
    assert entry.runtime_data is not runtime
    assert entry.runtime_data.settings.timings["settle"] == 5
    assert hass.data[frontend.DATA_PANELS][DOMAIN] is panel
    assert MODULE_URL in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    assert not dashboard.reloading_settings
    assert not entry.runtime_data.settings.notifications
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert DOMAIN not in hass.data[frontend.DATA_PANELS]
    assert MODULE_URL not in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    assert await hass.config_entries.async_remove(entry.entry_id)
    await client.close()
    await stream.close()


@pytest.mark.parametrize("recover", [True, False])
async def test_failed_settings_reload_retains_error_page_and_removal_cleanup(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    recover: bool,
) -> None:
    """Failed apply and rollback retain the error page, with no retention flag after response."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    panel = hass.data[frontend.DATA_PANELS][DOMAIN]
    previous_options = dict(entry.options)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["timings"]["settle"] = 5
    real_reload = hass.config_entries.async_reload

    async def unload_then_fail(entry_id: str) -> bool:
        assert await hass.config_entries.async_unload(entry_id)
        return False

    async def fail_recovery(entry_id: str) -> bool:
        assert entry_id == entry.entry_id
        return False

    recovery: Callable[[str], Awaitable[bool]] = {
        True: real_reload,
        False: fail_recovery,
    }[recover]
    operations = iter((unload_then_fail, recovery))

    async def reload_attempt(entry_id: str) -> bool:
        return await next(operations)(entry_id)

    with (
        patch.object(hass.config_entries, "async_reload", side_effect=reload_attempt),
        patch.object(
            frontend,
            "async_remove_panel",
            side_effect=AssertionError("Error must retain its page"),
        ),
    ):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        response = await client.receive_json()
        assert response["error"]["code"] == "reload_failed"
        await hass.async_block_till_done()
    assert entry.options == previous_options
    assert dashboard.value["available"] == recover
    assert hass.data[frontend.DATA_PANELS][DOMAIN] is panel
    assert MODULE_URL in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    assert not dashboard.reloading_settings
    assert await hass.config_entries.async_remove(entry.entry_id)
    assert DOMAIN not in hass.data[frontend.DATA_PANELS]
    assert MODULE_URL not in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    await client.close()
