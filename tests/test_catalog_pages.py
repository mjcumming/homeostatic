"""Revision-bound catalog loading through real HA WebSocket connections."""

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from tests.test_lifecycle import start_monitor


async def test_summary_and_complete_catalog_pages(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """Overview omits candidates; bounded pages reconstruct the exact catalog."""
    config_data["notifications"] = False
    for index in range(405):
        hass.states.async_set(f"sensor.candidate_{index}", "42")
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    before = runtime.engine.snapshot()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe", "paged": True})
    assert (await client.receive_json())["success"]
    summary = (await client.receive_json())["event"]
    assert summary["schema_version"] == 3
    assert summary["catalog_loaded"] is False
    assert summary["inventory"]["catalog"]["candidates"] == []
    assert summary["inventory"]["nodes"][0]["name"]
    assert len(summary["inventory"]["episodes"]) == 1
    revision = summary["catalog_revision"]
    total = summary["catalog_sections"]["candidates"]
    assert total >= 405
    rows = []
    for request_id, offset in enumerate(range(0, total, 200), 2):
        await client.send_json(
            {
                "id": request_id,
                "type": "homeostatic/catalog",
                "revision": revision,
                "section": "candidates",
                "offset": offset,
            }
        )
        result = (await client.receive_json())["result"]
        assert result["revision"] == revision
        assert result["offset"] == offset
        assert result["total"] == total
        assert 0 < len(result["items"]) <= 200
        rows.extend(result["items"])
    assert result["next_offset"] is None
    assert rows == dashboard.catalog_sections["candidates"]
    assert runtime.engine.snapshot() == before
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"revision": -1}, "invalid_format"),
        ({"revision": 99999}, "stale_catalog"),
        ({"offset": 99999}, "invalid_offset"),
        ({"offset": -1}, "invalid_format"),
        ({"limit": 201}, "invalid_format"),
        ({"limit": 0}, "invalid_format"),
        ({"section": "private"}, "invalid_format"),
    ],
)
async def test_catalog_rejects_invalid_requests(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    changes: dict[str, Any],
    error: str,
) -> None:
    """Clients cannot bypass revision, section or page-size bounds."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/catalog",
            "revision": hass.data[DATA_DASHBOARD].catalog_revision,
            "section": "nodes",
            **changes,
        }
    )
    assert (await client.receive_json())["error"]["code"] == error
    await client.close()
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_catalog_reload_and_unavailability(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A reload invalidates old pages and unloading disallows catalog reads."""
    await start_monitor(hass, config_entry)
    revision = hass.data[DATA_DASHBOARD].catalog_revision
    client = await hass_ws_client(hass)
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/catalog",
            "revision": revision,
            "section": "nodes",
        }
    )
    assert (await client.receive_json())["error"]["code"] == "stale_catalog"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/catalog",
            "revision": revision,
            "section": "nodes",
        }
    )
    assert (await client.receive_json())["error"]["code"] == "not_ready"
    await client.close()
