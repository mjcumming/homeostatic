"""The opt-in panel view carries current issue context without unrelated inventory."""

import json
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor


async def test_empty_panel_summary_omits_coverage_and_catalog(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A healthy large catalog does not travel with the default Issues view."""
    config_data["notifications"] = False
    for index in range(405):
        hass.states.async_set(f"sensor.unrelated_{index}", "42")
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/subscribe", "paged": True, "panel": True}
    )
    assert (await client.receive_json())["success"]
    summary = (await client.receive_json())["event"]
    assert summary["panel_context"] is True
    assert summary["catalog_loaded"] is False
    assert summary["inventory"]["monitored_count"] > 0
    assert summary["inventory"]["nodes"] == []
    assert summary["inventory"]["catalog"]["candidates"] == []
    assert "coverage" not in summary
    assert len(json.dumps(summary)) < 5000
    assert summary["catalog_sections"]["candidates"] >= 405
    legacy = hass.data[DATA_DASHBOARD].summary
    assert "coverage" in legacy
    assert "panel_context" not in legacy
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)
    unavailable = (await client.receive_json())["event"]
    assert unavailable["available"] is False
    assert unavailable["panel_context"] is True
    await client.close()


async def test_panel_summary_keeps_grouped_checks_and_control_only_source(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Grouped device checks and healthy maintenance targets keep their own context."""
    failed_owner = MockConfigEntry(domain="test", state=ConfigEntryState.SETUP_ERROR)
    healthy_owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    failed_owner.add_to_hass(hass)
    healthy_owner.add_to_hass(hass)
    floor = fr.async_get(hass).async_create("Main floor")
    devices, entities, areas = [], [], []
    for name, owner in (
        ("Dishwasher", failed_owner),
        ("Fridge", failed_owner),
        ("Washer", healthy_owner),
        ("Unrelated", healthy_owner),
    ):
        area = ar.async_get(hass).async_create(name, floor_id=floor.floor_id)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("test", name)},
            name=name,
        )
        dr.async_get(hass).async_update_device(device.id, area_id=area.id)
        entity = er.async_get(hass).async_get_or_create(
            "sensor", "test", name, config_entry=owner, device_id=device.id
        )
        hass.states.async_set(
            entity.entity_id, "unavailable" if owner is failed_owner else "42"
        )
        devices.append(device)
        entities.append(entity)
        areas.append(area)
    policies = [
        monitoring_policy("integrations", {"kind": ["integration"]}),
        monitoring_policy("devices", {"kind": ["device"]}),
        monitoring_policy("entities", {"kind": ["entity"], "domain": ["sensor"]}),
    ]
    config_data.update(notifications=False, monitoring_policies=policies)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [episode] = runtime.episodes.values()
    recorded = {
        *(bound_identity(policies[1], f"device:{device.id}") for device in devices[:2]),
        *(
            bound_identity(policies[2], f"entity:registry:{entity.id}")
            for entity in entities[:2]
        ),
    }
    assert set(episode["recorded"]) == recorded
    assert episode["anchor"] == bound_identity(
        policies[0], f"entry:{failed_owner.entry_id}"
    )
    controlled = f"entity:registry:{entities[2].id}"
    maintenance = await action(
        hass,
        "start_maintenance",
        {"node_id": controlled, "include_dependents": False, "until": end()},
    )
    client = await hass_ws_client(hass)
    try:
        await client.send_json(
            {"id": 1, "type": "homeostatic/subscribe", "paged": True, "panel": True}
        )
        assert (await client.receive_json())["success"]
        summary = (await client.receive_json())["event"]
        rows = {
            row["node_id"]: row
            for row in summary["inventory"]["nodes"]
            + summary["inventory"]["catalog"]["candidates"]
        }
        [current_episode] = summary["inventory"]["episodes"]
        issue_ids = {current_episode["anchor"], *current_episode["recorded"]}
        issue_ids.update(reason["node_id"] for reason in current_episode["reasons"])
        assert issue_ids <= rows.keys()
        assert recorded <= issue_ids
        assert controlled not in issue_ids
        assert controlled in rows
        assert summary["inventory"]["operator_controls"] == [maintenance["control"]]
        assert {f"device:{device.id}" for device in devices[:3]} <= rows.keys()
        assert {
            f"entity:registry:{entity.id}" for entity in entities[:2]
        } <= rows.keys()
        assert {
            f"entry:{failed_owner.entry_id}",
            f"entry:{healthy_owner.entry_id}",
        } <= rows.keys()
        assert {row["id"] for row in summary["devices"]} == {
            device.id for device in devices[:3]
        }
        assert {row["id"] for row in summary["areas"]} == {
            area.id for area in areas[:3]
        }
        assert summary["floors"] == [{"id": floor.floor_id, "name": floor.name}]
        assert f"device:{devices[3].id}" not in rows
        assert all(
            row.get("entity_id") != entities[3].entity_id for row in rows.values()
        )
        assert not runtime.settings.notifications
        assert not runtime.delivery.outbox
    finally:
        await client.close()
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_panel_summary_contains_issue_owners_and_locations(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A failing entity retains its canonical source, device and integration context."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    floor = fr.async_get(hass).async_create("Main floor")
    area = ar.async_get(hass).async_create("Kitchen", floor_id=floor.floor_id)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "dishwasher")},
        name="Dishwasher",
    )
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "status", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(entity.entity_id, "unavailable")
    hass.states.async_set("sensor.unrelated", "42")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("entities", {"kind": ["entity"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    model = hass.data[DATA_DASHBOARD]
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/subscribe", "paged": True, "panel": True}
    )
    assert (await client.receive_json())["success"]
    summary = (await client.receive_json())["event"]
    rows = {
        row["node_id"]: row
        for row in summary["inventory"]["nodes"]
        + summary["inventory"]["catalog"]["candidates"]
    }
    assert len(summary["inventory"]["episodes"]) == 1
    episode = summary["inventory"]["episodes"][0]
    expected = {episode["anchor"], *episode["recorded"]}
    expected.update(reason["node_id"] for reason in episode["reasons"])
    assert expected <= rows.keys()
    assert f"entity:registry:{entity.id}" in rows
    assert f"device:{device.id}" in rows
    assert f"entry:{owner.entry_id}" in rows
    assert all(row.get("entity_id") != "sensor.unrelated" for row in rows.values())
    assert summary["devices"] == [model._device_rows[device.id]]
    assert summary["areas"] == [
        {"id": area.id, "name": area.name, "floor_id": floor.floor_id}
    ]
    assert summary["floors"] == [{"id": floor.floor_id, "name": floor.name}]
    assert summary["inventory"]["episodes"] == model.value["inventory"]["episodes"]
    assert not runtime.settings.notifications
    assert not runtime.delivery.outbox
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("registered", [False, True])
async def test_temperature_issue_retains_canonical_source_and_all_policies(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    registered: bool,
) -> None:
    """Thermal checks resolve their entity without loading unrelated catalog rows."""
    entity_id = "sensor.cold_room"
    identity = f"entity_id:{entity_id}"
    if registered:
        entity = er.async_get(hass).async_get_or_create("sensor", "test", "cold_room")
        entity_id = entity.entity_id
        identity = f"registry:{entity.id}"
    canonical = f"entity:{identity}"
    hass.states.async_set(
        entity_id,
        "40",
        {"device_class": "temperature", "unit_of_measurement": "°F"},
    )
    hass.states.async_set("sensor.unrelated", "42")
    match = {"entity": [identity]}
    policies = [
        monitoring_policy("availability", match),
        monitoring_policy(
            "freeze",
            match,
            check="temperature_limit",
            parameters={"unit": "°F", "minimum": 60, "duration_seconds": 0},
        ),
        monitoring_policy(
            "overheat",
            match,
            check="temperature_limit",
            parameters={"unit": "°F", "maximum": 80, "duration_seconds": 0},
        ),
    ]
    config_data.update(notifications=False, monitoring_policies=policies)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    try:
        await client.send_json(
            {"id": 1, "type": "homeostatic/subscribe", "paged": True, "panel": True}
        )
        assert (await client.receive_json())["success"]
        summary = (await client.receive_json())["event"]
        [episode] = summary["inventory"]["episodes"]
        rows = {
            row["node_id"]: row
            for row in summary["inventory"]["nodes"]
            + summary["inventory"]["catalog"]["candidates"]
        }
        thermal = rows[episode["anchor"]]
        assert thermal["kind"] == "temperature_limit"
        assert not thermal.get("monitoring_source")
        assert canonical in rows
        assert rows[canonical]["kind"] == "entity"
        assert not rows[canonical].get("monitoring_policy")
        assert all(row.get("entity_id") != "sensor.unrelated" for row in rows.values())
        assert summary["catalog_loaded"] is False
        await client.send_json(
            {"id": 2, "type": "homeostatic/source", "node_id": canonical}
        )
        response = (await client.receive_json())["result"]
        assert {item["id"] for item in response["monitoring_policies"]} == {
            policy["id"] for policy in policies
        }
        assert {item["policy_id"] for item in response["temperature_checks"]} == {
            "freeze",
            "overheat",
        }
        assert all(
            item["source_id"] == canonical for item in response["temperature_checks"]
        )
        assert not runtime.delivery.outbox
    finally:
        await client.close()
        assert await hass.config_entries.async_unload(entry.entry_id)
