"""Dashboard scenarios through real Home Assistant WebSocket connections."""

from typing import Any

import pytest
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.dispatcher import async_dispatcher_send
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import (
    DATA_DASHBOARD,
    MODULE_URL,
    snapshot,
)
from tests.test_lifecycle import SCENARIOS, start_monitor

NODE = "entity:entity_id:sensor.observed"


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
async def test_dashboard_observation_scenarios(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    scenario: dict[str, Any],
) -> None:
    """A live snapshot preserves failure, unknown and restored evidence."""
    hass.states.async_set("sensor.observed", scenario["state"], scenario["attributes"])
    runtime = await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe"})
    assert (await client.receive_json())["success"]
    data = (await client.receive_json())["event"]
    assert data["available"]
    assert data["schema_version"] == 1
    assert data["readiness"]["answer"] == scenario["readiness"]
    assert len(data["inventory"]["episodes"]) == scenario["episodes"]
    assert runtime.engine is not None
    before = runtime.engine.snapshot()
    await client.send_json({"id": 2, "type": "homeostatic/node", "node_id": NODE})
    detail = (await client.receive_json())["result"]
    assert detail["source"]["node_id"] == NODE
    assert detail["readiness"]["answer"] == scenario["readiness"]
    assert runtime.engine.snapshot() == before
    await client.send_json({"id": 3, "type": "unsubscribe_events", "subscription": 1})
    assert (await client.receive_json())["success"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_stream_tracks_enrollment_failure_unload_and_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """One subscription follows future sources and survives runtime replacement."""
    config_data.update(
        rules=[{"id": "watch", "action": "attach", "match": {"domain": "sensor"}}],
        functions=[
            {
                "id": "lighting",
                "name": "Lighting",
                "requires": ["entity:entity_id:sensor.observed"],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "42")
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe"})
    await client.receive_json()
    initial = (await client.receive_json())["event"]
    assert initial["functions"][0]["readiness"]["answer"] == "ready"
    assert frontend.DATA_PANELS in hass.data
    assert hass.data[frontend.DATA_PANELS][DOMAIN].require_admin
    assert MODULE_URL in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    hass.states.async_set("sensor.added", "unknown")
    await hass.async_block_till_done()
    added = (await client.receive_json())["event"]
    assert "entity:entity_id:sensor.added" in [
        item["node_id"] for item in added["inventory"]["nodes"]
    ]
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    failed = (await client.receive_json())["event"]
    assert failed["functions"][0]["readiness"]["answer"] == "blocked"
    assert failed["inventory"]["episodes"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert not (await client.receive_json())["event"]["available"]
    assert DOMAIN not in hass.data[frontend.DATA_PANELS]
    assert MODULE_URL not in hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert not (await client.receive_json())["event"]["available"]
    assert (await client.receive_json())["event"]["available"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_startup_error_and_unknown_node(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Unavailable states and removed selections never return a false all-clear."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/node", "node_id": NODE})
    assert (await client.receive_json())["error"]["code"] == "not_ready"
    await hass.async_start()
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    await client.send_json({"id": 2, "type": "homeostatic/node", "node_id": "removed"})
    assert (await client.receive_json())["error"]["code"] == "not_found"
    runtime.error = "storage failed"
    async_dispatcher_send(hass, runtime.signal)
    await hass.async_block_till_done()
    assert not hass.data[DATA_DASHBOARD].value["available"]
    assert hass.data[DATA_DASHBOARD].value["error"] == "storage failed"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.send_json({"id": 3, "type": "homeostatic/node", "node_id": NODE})
    assert (await client.receive_json())["error"]["code"] == "not_ready"
    await client.close()
    assert not snapshot(None)["available"]


async def test_location_names_and_situation_detail(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Registry names populate browsing; situation detail does not imply readiness."""
    floor = fr.async_get(hass).async_create("Main floor")
    area = ar.async_get(hass).async_create("Garage")
    ar.async_get(hass).async_update(area.id, floor_id=floor.floor_id)
    sensor = er.async_get(hass).async_get_or_create(
        "sensor", "test", "garage", suggested_object_id="garage"
    )
    er.async_get(hass).async_update_entity(sensor.entity_id, area_id=area.id)
    hass.states.async_set(sensor.entity_id, "42")
    hass.states.async_set("binary_sensor.door_alert", "on")
    config_data.update(
        rules=[{"id": "watch", "action": "attach", "match": {"domain": "sensor"}}],
        situations=[
            {
                "id": "door",
                "name": "Door left open",
                "entity": "entity_id:binary_sensor.door_alert",
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    data = hass.data[DATA_DASHBOARD].value
    assert data["areas"] == [
        {"id": area.id, "name": "Garage", "floor_id": floor.floor_id}
    ]
    assert data["floors"] == [{"id": floor.floor_id, "name": "Main floor"}]
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/node", "node_id": "situation:door"}
    )
    result = (await client.receive_json())["result"]
    assert result["readiness"] is None
    assert result["impact"]["nodes"] == []
    assert result["explanation"]["findings"][0]["reason"] == "active"
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "command",
    [
        pytest.param({"type": "homeostatic/subscribe"}, id="subscription"),
        pytest.param({"type": "homeostatic/node", "node_id": NODE}, id="node"),
    ],
)
async def test_dashboard_requires_administrator(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: Any,
    command: dict[str, Any],
) -> None:
    """A user cannot bypass panel visibility by calling the data commands."""
    await start_monitor(hass, config_entry)
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, client_id="http://test.local"
    )
    token = hass.auth.async_create_access_token(refresh)
    client = await hass_ws_client(hass, access_token=token)
    await client.send_json({"id": 1, **command})
    assert (await client.receive_json())["error"]["code"] == "unauthorized"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_setup_error_detail_survives_episode_and_recovers(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An entry's real reported failure reaches the read model and clears on recovery."""
    source = MockConfigEntry(
        domain="test",
        title="Bathroom controller",
        state=ConfigEntryState.LOADED,
        data={"password": "must-not-be-exposed"},
    )
    source.add_to_hass(hass)
    config_data.update(
        entities=[], config_entries=[source.entry_id], notifications=False
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source._async_set_state(
        hass, ConfigEntryState.SETUP_ERROR, "Unable to sign in to provider"
    )
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    command = {"type": "homeostatic/node", "node_id": f"entry:{source.entry_id}"}
    await client.send_json({"id": 1, **command})
    detail = (await client.receive_json())["result"]
    assert detail["source"]["attributes"]["domain"] == ["test"]
    assert detail["explanation"]["findings"][0]["reason"] == "setup_error"
    assert (
        detail["explanation"]["findings"][0]["message"]
        == "Bathroom controller: Unable to sign in to provider"
    )
    assert (
        next(iter(runtime.episodes.values()))["reasons"][0]["message"]
        == "Bathroom controller: Unable to sign in to provider"
    )
    assert "must-not-be-exposed" not in str(detail)
    source._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    await client.send_json({"id": 2, **command})
    recovered = (await client.receive_json())["result"]
    assert recovered["explanation"]["findings"] == []
    assert recovered["readiness"]["answer"] == "ready"
    assert runtime.episodes == {}
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
