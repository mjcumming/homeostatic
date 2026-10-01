"""Device availability scenarios independent of monitoring expectations."""

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import EntityCategory
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.device_availability import (
    device_availability,
    summarize_device_availability,
)
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("states", "disabled", "expected"),
    [
        pytest.param({}, False, "unknown", id="empty-device"),
        pytest.param({"sensor.a": None}, False, "unknown", id="missing-state"),
        pytest.param(
            {"sensor.a": State("sensor.a", "off")},
            False,
            "available",
            id="off-is-available",
        ),
        pytest.param(
            {"button.a": State("button.a", "unknown")},
            False,
            "available",
            id="unknown-value-is-available",
        ),
        pytest.param(
            {"sensor.a": State("sensor.a", "off", {"restored": True})},
            False,
            "unknown",
            id="restored-is-not-current",
        ),
        pytest.param(
            {"sensor.a": State("sensor.a", "unavailable")},
            False,
            "unavailable",
            id="all-unavailable",
        ),
        pytest.param(
            {
                "sensor.a": State("sensor.a", "unavailable"),
                "sensor.b": State("sensor.b", "off"),
            },
            False,
            "available",
            id="mixed-entities-not-partial",
        ),
        pytest.param(
            {"sensor.a": State("sensor.a", "unavailable"), "sensor.b": None},
            False,
            "unknown",
            id="missing-cannot-prove-total-outage",
        ),
        pytest.param(
            {
                "sensor.a": State("sensor.a", "unavailable"),
                "sensor.b": State("sensor.b", "unavailable", {"restored": True}),
            },
            False,
            "unknown",
            id="restored-cannot-prove-total-outage",
        ),
        pytest.param(
            {"sensor.a": State("sensor.a", "off"), "sensor.b": None},
            False,
            "available",
            id="one-current-member-is-enough",
        ),
        pytest.param({}, True, "disabled", id="disabled-empty-device"),
    ],
)
def test_entity_fallback_scenarios(
    states: dict[str, State | None], disabled: bool, expected: str
) -> None:
    """Current access evidence decides device status without inventing partial reports."""
    assert (
        summarize_device_availability(states, disabled=disabled)["status"] == expected
    )


@pytest.mark.parametrize(
    ("connection_state", "disabled", "reports", "expected", "reason"),
    [
        pytest.param(
            "off",
            False,
            {},
            "unavailable",
            "connectivity_disconnected",
            id="disconnected-overrides-other-state",
        ),
        pytest.param("on", False, {}, "available", "entity_available", id="connected"),
        pytest.param(
            "unknown",
            False,
            {},
            "available",
            "entity_available",
            id="unknown-value-is-not-disconnected",
        ),
        pytest.param(
            "off",
            True,
            {},
            "disabled",
            "disabled",
            id="disabled-precedes-disconnection",
        ),
        pytest.param(
            "off",
            False,
            {"owner": "available"},
            "available",
            "integration_reports",
            id="native-report-precedes-fallback",
        ),
    ],
)
def test_connectivity_report_precedes_generic_entity_fallback(
    connection_state: str,
    disabled: bool,
    reports: dict[str, str],
    expected: str,
    reason: str,
) -> None:
    """A typed connection report has meaning beyond an ordinary on/off value."""
    result = summarize_device_availability(
        {
            "binary_sensor.connection": State(
                "binary_sensor.connection", connection_state
            ),
            "sensor.temperature": State("sensor.temperature", "72"),
        },
        disabled=disabled,
        reports=reports,
        attached_entries=frozenset({"owner"}),
        loaded_entries=frozenset({"owner"}),
        connectivity_entities=frozenset({"binary_sensor.connection"}),
    )
    assert result["status"] == expected
    assert result["reason"] == reason
    assert result["disconnected_count"] == (1 if connection_state == "off" else 0)


def test_restored_connectivity_off_is_not_disconnection_evidence() -> None:
    """A restored value cannot create a current connection finding."""
    result = summarize_device_availability(
        {
            "binary_sensor.connection": State(
                "binary_sensor.connection", "off", {"restored": True}
            )
        },
        connectivity_entities=frozenset({"binary_sensor.connection"}),
    )
    assert result["status"] == "unknown"
    assert result["disconnected_entity_ids"] == []


@pytest.mark.parametrize(
    ("reports", "attached", "loaded", "disabled", "expected", "retained"),
    [
        pytest.param(
            {"a": "available"},
            {"a"},
            {"a"},
            False,
            "available",
            {"a": "available"},
            id="report-overrides-unavailable-entities",
        ),
        pytest.param(
            {"a": "available", "b": "unavailable"},
            {"a", "b"},
            {"a", "b"},
            False,
            "partially_available",
            {"a": "available", "b": "unavailable"},
            id="conflicting-reports",
        ),
        pytest.param(
            {"a": "unavailable", "b": "unavailable"},
            {"a", "b"},
            {"a", "b"},
            False,
            "unavailable",
            {"a": "unavailable", "b": "unavailable"},
            id="matching-unavailable-reports",
        ),
        pytest.param(
            {"a": "available", "b": "unavailable"},
            {"a", "b"},
            {"a"},
            False,
            "available",
            {"a": "available"},
            id="unload-removes-report",
        ),
        pytest.param(
            {"a": "available", "b": "unavailable"},
            {"a"},
            {"a", "b"},
            False,
            "available",
            {"a": "available"},
            id="detach-removes-report",
        ),
        pytest.param(
            {"a": "available"},
            {"a"},
            set(),
            False,
            "unavailable",
            {},
            id="last-unload-restores-fallback",
        ),
        pytest.param(
            {"a": "available"},
            {"a", "b"},
            {"a", "b"},
            False,
            "available",
            {"a": "available"},
            id="absent-report-is-not-negative",
        ),
        pytest.param(
            {"a": "available"},
            {"a"},
            {"a"},
            True,
            "disabled",
            {"a": "available"},
            id="disabled-overrides-reports",
        ),
    ],
)
def test_report_snapshot_scenarios(
    reports: dict[str, str],
    attached: set[str],
    loaded: set[str],
    disabled: bool,
    expected: str,
    retained: dict[str, str],
) -> None:
    """Only current attached and loaded reports have precedence and provenance."""
    result = summarize_device_availability(
        {"sensor.a": State("sensor.a", "unavailable")},
        reports=reports,
        attached_entries=frozenset(attached),
        loaded_entries=frozenset(loaded),
        disabled=disabled,
    )
    assert result["status"] == expected
    assert result["integration_statuses"] == retained


def test_invalid_report_is_rejected() -> None:
    """Unknown is a computed status, not a producer report."""
    with pytest.raises(ValueError, match="Invalid integration"):
        summarize_device_availability(
            {},
            reports={"a": "unknown"},
            attached_entries=frozenset({"a"}),
            loaded_entries=frozenset({"a"}),
        )


async def test_registry_evidence_lifecycle(hass: HomeAssistant) -> None:
    """Use all enabled categories while ignoring disabled members and old states."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    devices, entities = dr.async_get(hass), er.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "availability")}
    )
    ordinary = entities.async_get_or_create(
        "sensor", "test", "ordinary", config_entry=owner, device_id=device.id
    )
    diagnostic = entities.async_get_or_create(
        "sensor",
        "test",
        "diagnostic",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    config = entities.async_get_or_create(
        "button",
        "test",
        "config",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.CONFIG,
    )
    disabled = entities.async_get_or_create(
        "sensor",
        "test",
        "disabled",
        config_entry=owner,
        device_id=device.id,
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    hass.states.async_set(ordinary.entity_id, "unavailable")
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    hass.states.async_set(config.entity_id, "unknown")
    hass.states.async_set(disabled.entity_id, "off")
    result = device_availability(hass, device.id)
    assert result["status"] == "available"
    assert result["entity_count"] == 3
    assert result["available_count"] == 1
    assert result["unavailable_count"] == 2
    hass.states.async_set(config.entity_id, "unavailable")
    assert device_availability(hass, device.id)["status"] == "unavailable"
    hass.states.async_remove(config.entity_id)
    assert device_availability(hass, device.id)["status"] == "unknown"
    devices.async_update_device(device.id, disabled_by=dr.DeviceEntryDisabler.USER)
    assert device_availability(hass, device.id)["status"] == "disabled"
    devices.async_remove_device(device.id)
    assert device_availability(hass, device.id)["reason"] == "device_missing"


async def test_device_display_preserves_monitoring_issue(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """Available device access coexists with its selected-entity warning."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "display")}
    )
    entities = er.async_get(hass)
    selected = entities.async_get_or_create(
        "sensor", "test", "selected", config_entry=owner, device_id=device.id
    )
    excluded = entities.async_get_or_create(
        "sensor", "test", "excluded", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(selected.entity_id, "unavailable")
    hass.states.async_set(excluded.entity_id, "off")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[
            {"id": "devices", "action": "attach", "match": {"kind": "device"}},
            {
                "id": "exclude",
                "action": "exclude",
                "match": {"entity": f"registry:{excluded.id}"},
            },
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/source", "node_id": node_id})
    source = (await client.receive_json())["result"]
    assert source["device_availability"]["status"] == "available"
    assert source["device_availability"]["entity_count"] == 2
    assert source["entity_status"]["current"]["reason"] == "all_unavailable"
    episode_ids = set(runtime.episodes)
    assert len(episode_ids) == 1
    await client.send_json({"id": 2, "type": "homeostatic/node", "node_id": node_id})
    node = (await client.receive_json())["result"]
    assert node["device_availability"] == source["device_availability"]
    assert set(runtime.episodes) == episode_ids
    assert not runtime.delivery.messages
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_watched_connectivity_report_keeps_device_issue_open(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A disconnected selected sensor opens and sustains one device issue."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "connected-device")}
    )
    registry = er.async_get(hass)
    connection = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "connection",
        config_entry=owner,
        device_id=device.id,
        original_device_class="connectivity",
    )
    motion = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "motion",
        config_entry=owner,
        device_id=device.id,
        original_device_class="motion",
    )
    hass.states.async_set(connection.entity_id, "on")
    hass.states.async_set(motion.entity_id, "off")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[{"id": "devices", "action": "attach", "match": {"kind": "device"}}],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert not runtime.episodes

    hass.states.async_set(connection.entity_id, "off")
    await hass.async_block_till_done()
    assert device_availability(hass, device.id)["status"] == "unavailable"
    assert (
        runtime.entity_status(node_id)["current"]["reason"]
        == "connectivity_disconnected"
    )
    assert runtime.device_evidence(node_id)["members"][0]["connectivity"] is True
    episode_id = next(iter(runtime.episodes))

    hass.states.async_set(motion.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]
    hass.states.async_set(motion.entity_id, "on")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]

    hass.states.async_set(connection.entity_id, "on")
    await hass.async_block_till_done()
    assert device_availability(hass, device.id)["status"] == "available"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("disabled", [False, True], ids=["empty", "disabled-empty"])
async def test_empty_devices_remain_browsable(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    disabled: bool,
) -> None:
    """An empty device stays in Sources without gaining a monitoring check."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "empty")},
        disabled_by=dr.DeviceEntryDisabler.USER if disabled else None,
    )
    config_data.update(entities=[], config_entries=[], notifications=False, rules=[])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert node_id in runtime.candidates
    assert not runtime.candidates[node_id].watched
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/source", "node_id": node_id})
    result = (await client.receive_json())["result"]
    assert result["device_availability"]["status"] == (
        "disabled" if disabled else "unknown"
    )
    assert not runtime.episodes
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)
