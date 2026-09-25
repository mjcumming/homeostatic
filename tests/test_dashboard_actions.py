"""Dashboard operator scenarios through Home Assistant's native WebSocket API."""

from typing import Any

import pytest
from homeassistant.auth.models import User
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.dashboard import snapshot
from tests.test_controls import NODE, end
from tests.test_lifecycle import start_monitor


async def test_dashboard_native_actions_and_resolved_history(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The browser response wrapper confirms scope, saved controls and recovery."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    episode_id = next(iter(runtime.episodes))
    maintenance = {"node_id": NODE, "until": end(), "include_dependents": False}
    await client.send_json(
        {
            "id": 1,
            "type": "call_service",
            "domain": "homeostatic",
            "service": "preview_maintenance",
            "service_data": maintenance,
            "return_response": True,
        }
    )
    preview = (await client.receive_json())["result"]["response"]
    assert preview["node_ids"] == [NODE]
    assert preview["existing_episode_ids"] == [episode_id]
    assert not runtime.controls
    await client.send_json(
        {
            "id": 2,
            "type": "call_service",
            "domain": "homeostatic",
            "service": "start_maintenance",
            "service_data": {**maintenance, "reason": "Battery replacement"},
            "return_response": True,
        }
    )
    applied = (await client.receive_json())["result"]["response"]
    assert applied["node_ids"] == preview["node_ids"]
    assert applied["control"]["reason"] == "Battery replacement"
    assert runtime.readiness == "blocked"
    await client.send_json(
        {
            "id": 3,
            "type": "call_service",
            "domain": "homeostatic",
            "service": "shelve",
            "service_data": {"episode_id": episode_id, "until": end()},
            "return_response": True,
        }
    )
    shelf = (await client.receive_json())["result"]["response"]["control"]
    assert shelf["action"] == "shelve"
    assert shelf["target"] == episode_id
    assert episode_id in runtime.episodes
    assert len(runtime.controls) == 2
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    history: Any = snapshot(runtime)["inventory"]
    assert history["episodes"] == []
    assert history["resolved_history"]["episodes"][0]["resolution"] == "cleared"
    assert (
        history["resolved_history"]["episodes"][0]["episode"]["episode_id"]
        == episode_id
    )
    assert len(history["operator_controls"]) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "service,target",
    [
        pytest.param("shelve", {"episode_id": "open"}, id="shelving"),
        pytest.param("start_maintenance", {"node_id": NODE}, id="maintenance"),
    ],
)
async def test_dashboard_native_mutations_require_admin(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: User,
    service: str,
    target: dict[str, str],
) -> None:
    """Direct service calls cannot bypass dashboard or administrator restrictions."""
    runtime = await start_monitor(hass, config_entry)
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, client_id="http://test.local"
    )
    client = await hass_ws_client(
        hass, access_token=hass.auth.async_create_access_token(refresh)
    )
    await client.send_json(
        {
            "id": 1,
            "type": "call_service",
            "domain": "homeostatic",
            "service": service,
            "service_data": {**target, "until": end()},
            "return_response": True,
        }
    )
    assert not (await client.receive_json())["success"]
    assert not runtime.controls
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()
