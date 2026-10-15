"""Source browsing preserves runtime identities and current evidence semantics."""

from copy import deepcopy
from typing import Any
from unittest.mock import patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import limit_policy
from tests.test_repairs import raise_deck_repair


async def test_source_restored_readings_sort_before_current_values(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Current off values remain ordinary availability evidence across pages."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "connection")}
    )
    registry = er.async_get(hass)
    connection = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "connection",
        config_entry=owner,
        device_id=device.id,
        original_name="Z connection",
        original_device_class="connectivity",
    )
    normal = registry.async_get_or_create(
        "sensor",
        "test",
        "normal",
        config_entry=owner,
        device_id=device.id,
        original_name="A normal value",
    )
    restored = registry.async_get_or_create(
        "sensor",
        "test",
        "restored",
        config_entry=owner,
        device_id=device.id,
        original_name="Y restored value",
    )
    hass.states.async_set(
        connection.entity_id,
        "off",
        {"device_class": "connectivity", "friendly_name": "Z connection"},
    )
    hass.states.async_set(normal.entity_id, "42", {"friendly_name": "A normal value"})
    hass.states.async_set(
        restored.entity_id,
        "42",
        {"restored": True, "friendly_name": "Y restored value"},
    )
    config_data.update(monitoring_policies=[], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    before = deepcopy(runtime.snapshot())
    client = await hass_ws_client(hass)
    request = {"type": "homeostatic/source", "node_id": f"device:{device.id}"}
    await client.send_json({"id": 1, **request, "limit": 2})
    first = (await client.receive_json())["result"]
    assert [member["entity_id"] for member in first["members"]] == [
        restored.entity_id,
        normal.entity_id,
    ]
    assert "connectivity" not in first["members"][1]
    assert first["members"][1]["state"] == "42"
    assert first["members"][0]["restored"] is True
    assert first["unavailable_count"] == 0
    assert first["unknown_count"] == 1
    assert first["next_offset"] == 2
    await client.send_json({"id": 2, **request, "offset": 2})
    last = (await client.receive_json())["result"]
    assert last["members"][0]["entity_id"] == connection.entity_id
    assert last["members"][0]["state"] == "off"
    assert last["next_offset"] is None
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_source_counts_distinguish_restored_from_current_unavailability(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Paged device evidence counts restored and missing states only as unknown."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "mixed_evidence")}
    )
    registry = er.async_get(hass)
    members = {
        name: registry.async_get_or_create(
            "sensor",
            "test",
            name,
            config_entry=owner,
            device_id=device.id,
            original_name=name,
        )
        for name in (
            "restored_unavailable",
            "restored_value",
            "missing",
            "unknown_value",
            "current_value",
            "unavailable",
        )
    }
    hass.states.async_set(
        members["restored_unavailable"].entity_id, "unavailable", {"restored": True}
    )
    hass.states.async_set(members["restored_value"].entity_id, "42", {"restored": True})
    hass.states.async_set(members["unknown_value"].entity_id, "unknown")
    hass.states.async_set(members["current_value"].entity_id, "42")
    hass.states.async_set(members["unavailable"].entity_id, "unavailable")
    config_data.update(monitoring_policies=[], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_remove(members["missing"].entity_id)
    await hass.async_block_till_done()
    before = deepcopy(runtime.snapshot())
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/source",
            "node_id": f"device:{device.id}",
            "limit": 2,
        }
    )
    result = (await client.receive_json())["result"]
    assert result["total"] == 6
    assert len(result["members"]) == 2
    assert result["unavailable_count"] == 1
    assert result["unknown_count"] == 3
    assert result["next_offset"] == 2
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/source",
            "node_id": f"device:{device.id}",
            "offset": 2,
        }
    )
    remaining = (await client.receive_json())["result"]
    readings = {
        member["entity_id"]: member
        for member in result["members"] + remaining["members"]
    }
    assert readings[members["missing"].entity_id]["state"] == "missing"
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_source_runtime_repair_aliases_preserve_independent_policy_identity(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A runtime-only Repair has one source and separately observed policy checks."""
    canonical = raise_deck_repair(hass)
    config_data.update(
        notifications=False,
        monitoring_policy_version=1,
        monitoring_policies=[
            {
                "id": identity,
                "name": name,
                "enabled": True,
                "check": "repair",
                "match": {"kind": ["repair"]},
                "parameters": {},
                "notifications": [],
            }
            for identity, name in [
                ("first", "First repair policy"),
                ("second", "Second repair policy"),
            ]
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    checks = [
        source
        for source in runtime.sources.values()
        if source.monitoring_source == canonical
    ]
    assert len(checks) == 2
    assert canonical not in runtime.candidates
    assert canonical not in runtime.sources
    before = deepcopy(runtime.snapshot())
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": canonical}
    )
    source = (await client.receive_json())["result"]
    assert source["monitoring_policies"] == [
        {"id": "first", "name": "First repair policy"},
        {"id": "second", "name": "Second repair policy"},
    ]
    assert source["members"] == []
    with patch.object(
        runtime, "entity_status", wraps=runtime.entity_status
    ) as observed:
        await client.send_json(
            {"id": 2, "type": "homeostatic/source", "node_id": checks[1].node_id}
        )
        alias = (await client.receive_json())["result"]
        observed.assert_called_once_with(checks[1].node_id)
    assert alias["monitoring_policies"] == source["monitoring_policies"]
    await client.send_json(
        {"id": 3, "type": "homeostatic/source", "node_id": "repair:removed"}
    )
    assert (await client.receive_json())["error"]["code"] == "not_found"
    assert runtime.snapshot() == before
    assert canonical not in runtime.candidates
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_source_reads_generated_temperature_check_without_catalog_identity(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A generated check reads its own evidence without replacing its entity."""
    hass.states.async_set(
        "sensor.temperature",
        "2",
        {
            "unit_of_measurement": "°C",
            "device_class": "temperature",
        },
    )
    config_data.update(
        notifications=False,
        monitoring_policies=[limit_policy()],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    check = next(
        source
        for source in runtime.sources.values()
        if source.kind == "temperature_limit"
    )
    assert check.node_id not in runtime.candidates
    assert check.monitoring_source is None
    before = deepcopy(runtime.snapshot())
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": check.node_id}
    )
    result = (await client.receive_json())["result"]
    assert result["members"][0]["entity_id"] == "sensor.temperature"
    assert result["members"][0]["state"] == "2"
    assert result["entity_status"] == runtime.entity_status(check.node_id)
    assert result["monitoring_policies"] == [
        {"id": "freeze", "name": "Freeze protection"}
    ]
    assert runtime.snapshot() == before
    assert check.node_id not in runtime.candidates
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
