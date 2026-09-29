"""Combined integration settings scenarios through the real WebSocket API."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import reporting
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


def combined_proposal(current: dict[str, Any]) -> dict[str, Any]:
    """Exclude one source and set its reporting preference in the same draft."""
    draft = deepcopy(current["settings"])
    draft["rules"] = [
        *current["rules"],
        {
            "id": "exclude_observed",
            "action": "exclude",
            "enabled": True,
            "match": {"entity": ["entity_id:sensor.observed"]},
            "checks": ["availability"],
        },
    ]
    draft["reporting"] = reporting.defaults()
    draft["reporting"]["assignments"] = {
        "entity:entity_id:sensor.observed": {
            "default": "morning",
            "checks": {"availability": "immediate"},
        }
    }
    draft["notifications"] = False
    draft["consumer"] = None
    draft["simple_notifications"] = None
    return draft


async def test_combined_review_save_and_stale_revision(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """One exact save applies both drafts, preserves definitions and sends nothing."""
    config_data["notifications"] = False
    config_data["functions"] = [
        {
            "id": "reading",
            "name": "Reading",
            "requires": ["entity:entity_id:sensor.observed"],
        }
    ]
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = combined_proposal(current)
    change = {"revision": current["revision"], "settings": draft}
    before = deepcopy(runtime.snapshot())
    await client.send_json({"id": 2, "type": "homeostatic/preview_settings", **change})
    response = await client.receive_json()
    assert "result" in response, response
    preview = response["result"]
    assert preview["monitoring"]["removed_count"] == 1
    assert preview["monitoring"]["functions"][0]["name"] == "Reading"
    assert preview["requests_now"] == 0
    assert runtime.snapshot() == before
    assert not entry.options
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/save_settings",
            **change,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    assert entry.options["rules"][-1]["action"] == "exclude"
    assert reporting.choices(entry.options["policy"]) == draft["reporting"]
    assert entry.options["functions"] == config_data["functions"]
    assert entry.options["notifications"] is False
    assert not entry.runtime_data.delivery.messages
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/save_settings",
            **change,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "stale_configuration"
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "replacement",
    [
        pytest.param({"rules": []}, id="monitoring-changed"),
        pytest.param({"reporting": reporting.defaults()}, id="reporting-changed"),
    ],
)
async def test_combined_token_covers_both_drafts(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    replacement: dict[str, Any],
) -> None:
    """Neither half may change between review and save."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = combined_proposal(current)
    change = {"revision": current["revision"], "settings": draft}
    await client.send_json({"id": 2, "type": "homeostatic/preview_settings", **change})
    preview = (await client.receive_json())["result"]
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/save_settings",
            **change,
            "settings": {**draft, **replacement},
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "preview_required"
    assert not config_entry.options
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_combined_reload_failure_restores_both_parts(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A failed combined apply restores the complete previous options."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    change = {"revision": current["revision"], "settings": combined_proposal(current)}
    await client.send_json({"id": 2, "type": "homeostatic/preview_settings", **change})
    preview = (await client.receive_json())["result"]
    with patch.object(
        hass.config_entries, "async_reload", new=AsyncMock(side_effect=[False, True])
    ) as reload:
        await client.send_json(
            {
                "id": 3,
                "type": "homeostatic/save_settings",
                **change,
                "preview_token": preview["preview_token"],
            }
        )
        assert (await client.receive_json())["error"]["code"] == "reload_failed"
    assert reload.await_count == 2
    assert not config_entry.options
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


@pytest.mark.parametrize("command", ["preview_settings", "save_settings"])
async def test_combined_settings_reject_invalid_rules(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    command: str,
) -> None:
    """The settings endpoint cannot bypass monitoring rule validation."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = combined_proposal(current)
    draft["rules"] = [{"id": "invalid", "action": "invalid", "match": {}}]
    request = {
        "id": 2,
        "type": f"homeostatic/{command}",
        "revision": current["revision"],
        "settings": draft,
    }
    request.update(
        {"save_settings": {"preview_token": "invalid"}, "preview_settings": {}}[command]
    )
    await client.send_json(request)
    assert (await client.receive_json())["error"]["code"] == "invalid_settings"
    assert not config_entry.options
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()
