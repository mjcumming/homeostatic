"""Dashboard scenarios through real Home Assistant WebSocket connections."""

from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers.dispatcher import async_dispatcher_send
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard as dashboard_module
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import (
    DATA_DASHBOARD,
    MODULE_URL,
    PANEL_ELEMENT,
    snapshot,
)
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import SCENARIOS, start_monitor

SOURCE_ID = "entity:entity_id:sensor.observed"
NODE = bound_identity(
    monitoring_policy(
        "observed", {"kind": ["entity"], "entity": ["entity_id:sensor.observed"]}
    ),
    SOURCE_ID,
)


@pytest.mark.parametrize(
    "command",
    ["preview_configuration", "save_configuration", "preview_alerts", "save_alerts"],
)
async def test_retired_configuration_endpoints_cannot_change_settings(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    command: str,
) -> None:
    """An obsolete client has no alternate route to save a retired draft."""
    await start_monitor(hass, config_entry)
    before = deepcopy(dict(config_entry.options))
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": f"homeostatic/{command}"})
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"]["code"] == "unknown_command"
    assert config_entry.options == before
    assert not hass.services.has_service(DOMAIN, "preview_rules")
    assert await hass.config_entries.async_unload(config_entry.entry_id)


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
        monitoring_policies=[
            monitoring_policy("watch", {"kind": ["entity"], "domain": ["sensor"]})
        ],
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
    assert initial["functions"] == []
    assert frontend.DATA_PANELS in hass.data
    assert hass.data[frontend.DATA_PANELS][DOMAIN].require_admin
    assert (
        hass.data[frontend.DATA_PANELS][DOMAIN].config["_panel_custom"]["name"]
        == PANEL_ELEMENT
    )
    module = Path(dashboard_module.__file__).parent / "frontend" / "homeostatic.js"
    assert f'customElements.define("{PANEL_ELEMENT}"' in module.read_text()
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
    assert failed["functions"] == []
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
    source_entry = MockConfigEntry(domain="test")
    source_entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=source_entry.entry_id,
        identifiers={("test", "garage-device")},
        name="Garage monitor",
    )
    sensor = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "garage",
        suggested_object_id="garage",
        device_id=device.id,
    )
    er.async_get(hass).async_update_entity(sensor.entity_id, area_id=area.id)
    hass.states.async_set(sensor.entity_id, "42")
    hass.states.async_set("binary_sensor.door_alert", "on")
    config_data.update(
        monitoring_policies=[
            monitoring_policy("watch", {"kind": ["entity"], "domain": ["sensor"]})
        ],
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
    assert {
        "id": device.id,
        "name": "Garage monitor",
        "disabled": False,
        "config_entry_id": source_entry.entry_id,
    } in data["devices"]
    assert data["floors"] == [{"id": floor.floor_id, "name": "Main floor"}]
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/node", "node_id": "situation:door"}
    )
    result = (await client.receive_json())["result"]
    assert result["readiness"] is None
    assert result["impact"]["nodes"] == []
    assert result["explanation"]["findings"][0]["reason"] == "active"
    await client.send_json({"id": 2, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    assert {
        "id": area.id,
        "name": "Garage",
        "floor_id": floor.floor_id,
    } in configuration["areas"]
    assert {"id": floor.floor_id, "name": "Main floor"} in configuration["floors"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "command",
    [
        pytest.param({"type": "homeostatic/subscribe"}, id="subscription"),
        pytest.param(
            {"type": "homeostatic/subscribe", "paged": True}, id="paged-subscription"
        ),
        pytest.param(
            {"type": "homeostatic/catalog", "revision": 0, "section": "nodes"},
            id="catalog-page",
        ),
        pytest.param({"type": "homeostatic/node", "node_id": NODE}, id="node"),
        pytest.param({"type": "homeostatic/configuration"}, id="configuration"),
        pytest.param({"type": "homeostatic/source", "node_id": NODE}, id="source"),
        pytest.param(
            {"type": "homeostatic/preview_settings", "revision": "x", "settings": {}},
            id="preview-settings",
        ),
        pytest.param(
            {
                "type": "homeostatic/save_settings",
                "revision": "x",
                "settings": {},
                "preview_token": "x",
            },
            id="save-settings",
        ),
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
        monitoring_policies=[
            monitoring_policy(
                "controller",
                {"kind": ["integration"], "integration": [source.entry_id]},
            )
        ],
        notifications=False,
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source._async_set_state(
        hass, ConfigEntryState.SETUP_ERROR, "Unable to sign in to provider"
    )
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    command = {
        "type": "homeostatic/node",
        "node_id": bound_identity(
            config_data["monitoring_policies"][0], f"entry:{source.entry_id}"
        ),
    }
    await client.send_json({"id": 1, **command})
    detail = (await client.receive_json())["result"]
    assert detail["source"]["attributes"]["domain"] == ["test"]
    assert detail["explanation"]["findings"][0]["reason"] == "setup_error"
    assert (
        detail["explanation"]["findings"][0]["message"]
        == "Bathroom controller · controller: Unable to sign in to provider"
    )
    assert (
        next(iter(runtime.episodes.values()))["reasons"][0]["message"]
        == "Bathroom controller · controller: Unable to sign in to provider"
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


async def test_entity_brief_uses_current_queries_through_unknown_and_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Compact cards and node details agree while one problem changes condition."""
    config_data["timings"]["clear_hold"] = 120
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, entry)
    episode_id = next(iter(runtime.episodes))
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe", "compact": True})
    assert (await client.receive_json())["success"]
    initial = (await client.receive_json())["event"]
    assert (
        initial["inventory"]["entity_status"][NODE]["explanation"]["findings"][0][
            "reason"
        ]
        == "unavailable"
    )
    hass.states.async_set("sensor.observed", "unknown")
    await hass.async_block_till_done()
    unknown = (await client.receive_json())["event"]
    assert unknown["inventory_changed"] is False
    assert (
        unknown["inventory"]["entity_status"][NODE]["current"]["reason"]
        == "value_unknown"
    )
    assert (
        unknown["inventory"]["entity_status"][NODE]["readiness"]["answer"] == "degraded"
    )
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    recovering = (await client.receive_json())["event"]
    assert list(runtime.episodes) == [episode_id]
    context = recovering["inventory"]["entity_status"][NODE]
    assert context["explanation"]["findings"][0]["status"] == "warn"
    assert context["current"]["reason"] == "available"
    assert context["readiness"]["answer"] == "degraded"
    assert runtime.engine is not None
    before = runtime.engine.snapshot()
    await client.send_json({"id": 2, "type": "homeostatic/node", "node_id": NODE})
    detail = (await client.receive_json())["result"]
    assert detail["entity_status"] == context
    assert runtime.engine.snapshot() == before
    freezer.tick(121)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    resolved = (await client.receive_json())["event"]
    assert resolved["inventory"]["entity_status"] == {}
    assert runtime.episodes == {}
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_installation_settings_exact_review_preserves_definitions(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Timing and notification edits remain read-only until the exact guarded save."""
    config_data.update(
        notifications=False,
        functions=[
            {
                "id": "lighting",
                "name": "Lighting",
                "requires": [SOURCE_ID],
            }
        ],
    )
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = deepcopy(current["settings"])
    draft["timings"]["unknown_hold"] = 240
    draft["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "report",
        "at": "08:00",
        "weekdays": [0, 1, 2, 3, 4],
    }
    before = deepcopy(runtime.snapshot())
    change = {"revision": current["revision"], "settings": draft}
    await client.send_json({"id": 2, "type": "homeostatic/preview_settings", **change})
    response = await client.receive_json()
    assert "result" in response, response
    preview = response["result"]
    assert preview["after"] == draft
    assert runtime.snapshot() == before
    assert not entry.options
    altered = deepcopy(draft)
    altered["timings"]["unknown_hold"] = 300
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/save_settings",
            **change,
            "settings": altered,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "preview_required"
    assert not entry.options
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/save_settings",
            **change,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    assert entry.options["functions"] == config_data["functions"]
    assert entry.options["timings"]["unknown_hold"] == 240
    assert entry.options["monitoring_policies"] == draft["monitoring_policies"]
    assert entry.runtime_data.available
    assert not entry.runtime_data.delivery.messages
    await client.send_json({"id": 5, "type": "homeostatic/preview_settings", **change})
    assert (await client.receive_json())["error"]["code"] == "stale_configuration"
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "field,value",
    [
        pytest.param("settle", -1, id="negative"),
        pytest.param("settle", "120", id="text"),
        pytest.param("coalesce_count", 1, id="count"),
        pytest.param("unknown_hold", True, id="boolean"),
    ],
)
async def test_installation_settings_reject_invalid_timing(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    field: str,
    value: Any,
) -> None:
    """The API enforces timing limits even when bypassing browser validation."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = deepcopy(current["settings"])
    draft["timings"][field] = value
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/preview_settings",
            "revision": current["revision"],
            "settings": draft,
        }
    )
    assert (await client.receive_json())["error"]["code"] == "invalid_settings"
    assert not config_entry.options
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_installation_settings_restore_on_failed_reload(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An unsuccessful apply restores the previous options and attempts recovery."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    draft = deepcopy(current["settings"])
    draft["timings"]["unknown_hold"] = 240
    change = {"revision": current["revision"], "settings": draft}
    await client.send_json({"id": 2, "type": "homeostatic/preview_settings", **change})
    response = await client.receive_json()
    assert "result" in response, response
    with patch.object(
        hass.config_entries, "async_reload", new=AsyncMock(side_effect=[False, True])
    ) as reload:
        await client.send_json(
            {
                "id": 3,
                "type": "homeostatic/save_settings",
                **change,
                "preview_token": response["result"]["preview_token"],
            }
        )
        assert (await client.receive_json())["error"]["code"] == "reload_failed"
    assert reload.await_count == 2
    assert not config_entry.options
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_unmonitored_sources_show_observations_without_enrollment(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Browsing unmonitored entities and connections cannot create checks or episodes."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", "test", "sample", config_entry=owner
    )
    hass.states.async_set(
        registered.entity_id, "unavailable", {"unit_of_measurement": "%"}
    )
    config_data.update(monitoring_policies=[], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    before = deepcopy(runtime.snapshot())
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/source",
            "node_id": f"entity:registry:{registered.id}",
        }
    )
    response = await client.receive_json()
    assert "result" in response, response
    assert response["result"]["members"][0]["state"] == "unavailable"
    assert response["result"]["members"][0]["unit"] == "%"
    assert response["result"]["entity_status"] is None
    await client.send_json(
        {"id": 2, "type": "homeostatic/source", "node_id": f"entry:{owner.entry_id}"}
    )
    response = await client.receive_json()
    assert "result" in response, response
    assert response["result"]["integration_evidence"]["current"]["reason"] == "loaded"
    assert runtime.snapshot() == before
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    ("command", "page_from_result"),
    [
        pytest.param("source", lambda result: result, id="discovered-source"),
        pytest.param(
            "node", lambda result: result["device_evidence"], id="monitored-device"
        ),
    ],
)
async def test_member_evidence_pages_are_complete_stable_and_read_only(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    command: str,
    page_from_result: Callable[[dict[str, Any]], dict[str, Any]],
) -> None:
    """Every member is reachable once, including equal-name rows past page one."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "many-members")}
    )
    registry = er.async_get(hass)
    by_state: dict[str, list[str]] = {"unavailable": [], "42": []}
    for index, state in enumerate(["42"] * 15 + ["unavailable"] * 60):
        entity = registry.async_get_or_create(
            "sensor",
            "test",
            f"signal_{74 - index:02}",
            config_entry=owner,
            device_id=device.id,
            original_name="Reading",
            suggested_object_id=f"signal_{74 - index:02}",
        )
        hass.states.async_set(entity.entity_id, state)
        by_state[state].append(entity.entity_id)
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    node_id = {
        "source": f"device:{device.id}",
        "node": bound_identity(
            config_data["monitoring_policies"][0], f"device:{device.id}"
        ),
    }[command]
    request = {"type": f"homeostatic/{command}", "node_id": node_id}
    before = deepcopy(runtime.snapshot())

    await client.send_json({"id": 1, **request})
    first = page_from_result((await client.receive_json())["result"])
    assert len(first["members"]) == 50
    assert first["offset"] == 0
    assert first["next_offset"] == 50
    assert first["total"] == 75
    assert first["unavailable_count"] == 60

    await client.send_json({"id": 2, **request, "offset": 50, "limit": 20})
    second = page_from_result((await client.receive_json())["result"])
    assert len(second["members"]) == 20
    assert second["offset"] == 50
    assert second["next_offset"] == 70
    assert second["total"] == 75
    assert second["unavailable_count"] == 60

    await client.send_json({"id": 3, **request, "offset": 70, "limit": 20})
    last = page_from_result((await client.receive_json())["result"])
    assert len(last["members"]) == 5
    assert last["next_offset"] is None
    assert last["total"] == 75
    assert last["unavailable_count"] == 60
    combined = [*first["members"], *second["members"], *last["members"]]
    assert [member["entity_id"] for member in combined] == [
        *sorted(by_state["unavailable"]),
        *sorted(by_state["42"]),
    ]

    await client.send_json({"id": 4, **request, "limit": 200})
    complete = page_from_result((await client.receive_json())["result"])
    assert complete["members"] == combined
    assert complete["next_offset"] is None
    await client.send_json({"id": 5, **request, "offset": 75})
    empty = page_from_result((await client.receive_json())["result"])
    assert empty["members"] == []
    assert empty["next_offset"] is None
    await client.send_json({"id": 6, **request, "offset": 76})
    assert (await client.receive_json())["error"]["code"] == "invalid_offset"
    with pytest.raises(ValueError, match="nonnegative offset"):
        runtime.device_evidence(node_id, offset=-1)
    with pytest.raises(ValueError, match="limit from 1 to 200"):
        runtime.device_evidence(node_id, limit=0)
    with pytest.raises(ValueError, match="limit from 1 to 200"):
        runtime.device_evidence(node_id, limit=201)
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize("command", ["source", "node"])
@pytest.mark.parametrize(
    "pagination",
    [
        pytest.param({"offset": -1}, id="negative-offset"),
        pytest.param({"limit": 0}, id="empty-limit"),
        pytest.param({"limit": 201}, id="oversized-limit"),
    ],
)
async def test_member_evidence_rejects_unbounded_requests(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    command: str,
    pagination: dict[str, int],
) -> None:
    """Invalid page boundaries are rejected before reading evidence."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": f"homeostatic/{command}", "node_id": NODE, **pagination}
    )
    assert (await client.receive_json())["error"]["code"] == "invalid_format"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_configuration_sections_keep_delivery_discovery_off_policy_reads(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Saved policy reads neither rediscover delivery nor revalidate settings."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    with (
        patch.object(
            dashboard_module,
            "_async_configuration",
            wraps=dashboard_module._async_configuration,
        ) as discovery,
        patch.object(
            dashboard_module, "available_people", new=AsyncMock(return_value=[])
        ) as people,
        patch.object(dashboard_module, "delivery_targets", return_value=[]) as targets,
        patch.object(dashboard_module, "destinations", return_value=[]) as routes,
        patch.object(
            dashboard_module.Settings,
            "from_data",
            side_effect=AssertionError("Unexpected revalidation"),
        ),
    ):
        await client.send_json(
            {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
        )
        saved = (await client.receive_json())["result"]
        assert "settings" in saved
        assert "delivery_targets" not in saved
        discovery.assert_not_called()
        people.assert_not_awaited()
        targets.assert_not_called()
        routes.assert_not_called()
        await client.send_json(
            {"id": 2, "type": "homeostatic/configuration", "section": "delivery"}
        )
        delivery = (await client.receive_json())["result"]
        assert "settings" not in delivery
        assert delivery["delivery_targets"] == []
        discovery.assert_awaited_once()
        people.assert_awaited_once()
        targets.assert_called_once()
        routes.assert_called_once()
    await client.close()
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_publication_reads_dynamic_inventory_once_for_all_wire_versions(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
) -> None:
    """Full and compact subscriptions share one current evidence read per publication."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    model = hass.data[DATA_DASHBOARD]
    with patch.object(
        runtime, "inventory_updates", wraps=runtime.inventory_updates
    ) as updates:
        model.publish()
        updates.assert_called_once_with()
    full = model.value["inventory"]
    compact = model.update["inventory"]
    summary = model.summary["inventory"]
    assert isinstance(full, dict)
    assert isinstance(compact, dict)
    assert isinstance(summary, dict)
    assert full["entity_status"]
    for key, value in compact.items():
        assert full[key] == value
        assert summary[key] == value
    assert await hass.config_entries.async_unload(config_entry.entry_id)
