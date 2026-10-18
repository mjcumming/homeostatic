"""Source browsing preserves runtime identities and current evidence semantics."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import advance, limit_policy
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


@pytest.mark.parametrize("selection", ["device", "entity", "check"])
async def test_source_temperature_checks_show_independent_member_conditions(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    selection: str,
) -> None:
    """A device exposes temperature policies even outside its availability scope."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    devices = {
        name: dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id, identifiers={("test", name)}
        )
        for name in ("selected", "other")
    }
    sensors = {
        name: er.async_get(hass).async_get_or_create(
            "sensor",
            "test",
            name,
            config_entry=owner,
            device_id=device.id,
            original_device_class="temperature",
            original_name=f"{name} temperature",
        )
        for name, device in devices.items()
    }
    for sensor in sensors.values():
        hass.states.async_set(
            sensor.entity_id,
            "68",
            {
                "device_class": "temperature",
                "unit_of_measurement": "°F",
                "friendly_name": sensor.original_name,
            },
        )
    selected = sensors["selected"]
    canonical = f"entity:registry:{selected.id}"
    policies = [
        {
            **limit_policy(identity),
            "name": name,
            "match": {},
            "parameters": {
                "unit": "°F",
                "minimum": minimum,
                "duration_seconds": duration,
            },
        }
        for identity, name, minimum, duration in (
            ("pending", "Wait an hour", 80, 3600),
            ("immediate", "Immediate limit", 80, 0),
            ("in_range", "Lower limit", 60, 3600),
        )
    ]
    config_data.update(
        notifications=False,
        monitoring_policies=[
            {
                **monitoring_policy("entities", {"kind": ["entity"]}),
                "excluded_sources": [canonical],
            },
            *policies,
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    monitored = {
        source.monitoring_policy: source
        for source in runtime.sources.values()
        if source.kind == "temperature_limit" and source.entity_id == selected.entity_id
    }
    node_id = {
        "device": f"device:{devices['selected'].id}",
        "entity": canonical,
        "check": monitored["pending"].node_id,
    }[selection]
    before = deepcopy(runtime.snapshot())
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/source", "node_id": node_id})
    result = (await client.receive_json())["result"]
    conditions = {row["policy_id"]: row for row in result["temperature_checks"]}
    assert set(conditions) == {"pending", "immediate", "in_range"}
    assert {row["source_id"] for row in conditions.values()} == {canonical}
    assert {row["entity_id"] for row in conditions.values()} == {selected.entity_id}
    assert {row["source_name"] for row in conditions.values()} == {
        "selected temperature"
    }
    assert {row["node_id"] for row in conditions.values()} == {
        source.node_id for source in monitored.values()
    }
    assert {row["policy_name"] for row in conditions.values()} == {
        "Wait an hour",
        "Immediate limit",
        "Lower limit",
    }
    assert {row["check"] for row in conditions.values()} == {"temperature_limit"}
    pending = conditions["pending"]
    assert pending["observation"]["status"] == "pass"
    assert pending["observation"]["reason"] == "temperature_qualifying"
    assert pending["observation"]["evidence"]["minimum"] == 80
    assert pending["observation"]["evidence"]["temperature_celsius"] == 20
    assert pending["observation"]["evidence"]["duration_seconds"] == 3600
    assert pending["observation"]["evidence"]["observed_seconds"] == 0
    since = runtime.temperature_monitors[monitored["pending"].node_id].since
    assert since is not None
    assert pending["qualifying_since"] == since.isoformat()
    assert pending["next_deadline"] == (since + timedelta(hours=1)).isoformat()
    assert conditions["immediate"]["observation"]["status"] == "warn"
    assert conditions["immediate"]["next_deadline"] is None
    assert conditions["in_range"]["observation"]["reason"] == "temperature_in_range"
    assert conditions["in_range"]["qualifying_since"] is None
    assert conditions["in_range"]["next_deadline"] is None
    assert {row["id"] for row in result["monitoring_policies"]} == {
        "pending",
        "immediate",
        "in_range",
    }
    assert runtime.snapshot() == before
    assert runtime.temperature_monitors[monitored["pending"].node_id].since == since
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    (
        "check",
        "entity_id",
        "state",
        "attributes",
        "parameters",
        "pending_reason",
        "qualified_reason",
        "recovered_state",
        "recovered_attributes",
        "recovered_reason",
    ),
    [
        pytest.param(
            "temperature_limit",
            "sensor.temperature",
            "68",
            {"device_class": "temperature", "unit_of_measurement": "°F"},
            {"unit": "°F", "minimum": 80, "duration_seconds": 3600},
            "temperature_qualifying",
            "temperature_low",
            "85",
            {"device_class": "temperature", "unit_of_measurement": "°F"},
            "temperature_in_range",
            id="temperature-limit",
        ),
        pytest.param(
            "thermostat",
            "climate.temperature",
            "heat",
            {"current_temperature": 68, "temperature": 80},
            {},
            "thermostat_qualifying",
            "thermostat_stalled",
            "heat",
            {"current_temperature": 80, "temperature": 80},
            "thermostat_in_margin",
            id="thermostat",
        ),
    ],
)
async def test_source_temperature_evidence_tracks_deadline_gap_and_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
    check: str,
    entity_id: str,
    state: str,
    attributes: dict[str, Any],
    parameters: dict[str, Any],
    pending_reason: str,
    qualified_reason: str,
    recovered_state: str,
    recovered_attributes: dict[str, Any],
    recovered_reason: str,
) -> None:
    """Source queries follow ingested temperature transitions without evaluating them."""
    hass.config.units = US_CUSTOMARY_SYSTEM
    hass.states.async_set(entity_id, state, attributes)
    config_data.update(
        notifications=False,
        monitoring_policies=[
            {**limit_policy(), "check": check, "match": {}, "parameters": parameters}
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entity:entity_id:{entity_id}"
    client = await hass_ws_client(hass)

    async def query_temperature(request_id: int) -> dict[str, Any]:
        """Read the same captured condition through source and issue details."""
        snapshot = deepcopy(runtime.snapshot())
        qualification = {
            key: monitor.since for key, monitor in runtime.temperature_monitors.items()
        }
        observations = {key: runtime.evidence.latest(key) for key in runtime.sources}
        await client.send_json(
            {"id": request_id, "type": "homeostatic/source", "node_id": node_id}
        )
        condition: dict[str, Any]
        [condition] = (await client.receive_json())["result"]["temperature_checks"]
        await client.send_json(
            {
                "id": request_id + 1,
                "type": "homeostatic/node",
                "node_id": condition["node_id"],
            }
        )
        details = (await client.receive_json())["result"]
        assert details["temperature_status"] == {
            "observation": condition["observation"],
            "qualifying_since": condition["qualifying_since"],
            "next_deadline": condition["next_deadline"],
        }
        assert runtime.snapshot() == snapshot
        assert {
            key: monitor.since for key, monitor in runtime.temperature_monitors.items()
        } == qualification
        assert {
            key: runtime.evidence.latest(key) for key in runtime.sources
        } == observations
        return condition

    pending = await query_temperature(1)
    assert pending["observation"]["reason"] == pending_reason
    assert pending["next_deadline"] is not None
    assert not runtime.episodes
    await advance(hass, freezer, 3600)
    qualified = await query_temperature(3)
    assert qualified["node_id"] == pending["node_id"]
    assert qualified["observation"]["status"] == "warn"
    assert qualified["observation"]["reason"] == qualified_reason
    assert qualified["observation"]["evidence"]["observed_seconds"] == 3600
    assert qualified["qualifying_since"] is None
    assert qualified["next_deadline"] is None
    assert len(runtime.episodes) == 1
    hass.states.async_set(entity_id, "unknown", attributes)
    await hass.async_block_till_done()
    missing = await query_temperature(5)
    assert missing["observation"]["status"] == "unknown"
    assert missing["observation"]["reason"] == "temperature_evidence_missing"
    assert missing["qualifying_since"] is None
    assert missing["next_deadline"] is None
    assert len(runtime.episodes) == 1
    hass.states.async_set(entity_id, recovered_state, recovered_attributes)
    await hass.async_block_till_done()
    recovered = await query_temperature(7)
    assert recovered["observation"]["reason"] == recovered_reason
    assert recovered["observation"]["status"] == "pass"
    assert recovered["next_deadline"] is None
    assert not runtime.episodes
    hass.states.async_remove(entity_id)
    await hass.async_block_till_done()
    await runtime.async_refresh()
    assert runtime.evidence.latest(pending["node_id"]) is None
    assert runtime.temperature_status(pending["node_id"])["observation"] is None
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
