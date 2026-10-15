"""Source evidence reflects each policy's actual monitored membership."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("selection", "expected_members", "unavailable"),
    [
        pytest.param("canonical", {"left", "right"}, 1, id="combined-policy-scope"),
        pytest.param("left", {"left"}, 1, id="failed-policy-alias"),
        pytest.param("right", {"right"}, 0, id="available-policy-alias"),
    ],
)
async def test_device_source_uses_actual_policy_members(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    selection: str,
    expected_members: set[str],
    unavailable: int,
) -> None:
    """Exclusions remain local while canonical inspection combines active checks."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "scope")}
    )
    members = {
        name: er.async_get(hass).async_get_or_create(
            "sensor", "test", name, config_entry=owner, device_id=device.id
        )
        for name in ("left", "right", "excluded")
    }
    hass.states.async_set(members["left"].entity_id, "unavailable")
    hass.states.async_set(members["right"].entity_id, "on")
    hass.states.async_set(members["excluded"].entity_id, "unavailable")
    policies = [
        {
            **monitoring_policy(name, {"kind": ["device"]}),
            "excluded_sources": [
                f"entity:registry:{entity.id}"
                for key, entity in members.items()
                if key != name
            ],
        }
        for name in ("left", "right")
    ]
    config_data.update(notifications=False, monitoring_policies=policies)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    canonical = f"device:{device.id}"
    node_id = {
        "canonical": canonical,
        "left": bound_identity(
            policies[0],
            canonical,
            member_exclusions=tuple(sorted(policies[0]["excluded_sources"])),
        ),
        "right": bound_identity(
            policies[1],
            canonical,
            member_exclusions=tuple(sorted(policies[1]["excluded_sources"])),
        ),
    }[selection]
    client = await hass_ws_client(hass)
    before = deepcopy(runtime.snapshot())
    await client.send_json({"id": 1, "type": "homeostatic/source", "node_id": node_id})
    result = (await client.receive_json())["result"]
    assert {row["entity_id"] for row in result["members"]} == {
        members[name].entity_id for name in expected_members
    }
    assert result["total"] == len(expected_members)
    assert result["unavailable_count"] == unavailable
    assert result["unknown_count"] == 0
    assert set(result["device_availability"]["entity_ids"]) == {
        entity.entity_id for entity in members.values()
    }
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_device_source_with_every_member_excluded_has_no_monitored_readings(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An empty policy scope cannot fall back to reporting excluded members."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "empty-scope")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "excluded", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(entity.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            {
                **monitoring_policy("devices", {"kind": ["device"]}),
                "excluded_sources": [f"entity:registry:{entity.id}"],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": f"device:{device.id}"}
    )
    result = (await client.receive_json())["result"]
    assert result["members"] == []
    assert result["total"] == 0
    assert result["unavailable_count"] == 0
    assert result["monitoring_policies"] == []
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_device_check_counts_current_unknown_and_off_as_available(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Current values stay ordinary; missing and restored values remain gaps."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "evidence-counts")}
    )
    members = {
        name: er.async_get(hass).async_get_or_create(
            "sensor", "test", name, config_entry=owner, device_id=device.id
        )
        for name in ("unknown", "off", "restored", "missing")
    }
    hass.states.async_set(members["unknown"].entity_id, "unknown")
    hass.states.async_set(members["off"].entity_id, "off")
    hass.states.async_set(
        members["restored"].entity_id, "unavailable", {"restored": True}
    )
    policy = monitoring_policy("devices", {"kind": ["device"]})
    config_data.update(notifications=False, monitoring_policies=[policy])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {
            "id": 1,
            "type": "homeostatic/node",
            "node_id": bound_identity(policy, f"device:{device.id}"),
        }
    )
    result = (await client.receive_json())["result"]["device_evidence"]
    assert result["reporting_count"] == 2
    assert result["unknown_count"] == 2
    assert result["unavailable_count"] == 0
    assert {row["entity_id"] for row in result["members"][:2]} == {
        members["missing"].entity_id,
        members["restored"].entity_id,
    }
    assert all("connectivity" not in row for row in result["members"])
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    ("include_enabled", "expected_policies"),
    [
        pytest.param(True, ["included"], id="another-policy-remains"),
        pytest.param(False, [], id="excluded-battery-unmonitored"),
    ],
)
async def test_battery_source_conditions_honor_policy_exclusions(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    include_enabled: bool,
    expected_policies: list[str],
) -> None:
    """Raw battery readings remain inspectable without excluded policy findings."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "battery",
        config_entry=owner,
        original_device_class="battery",
    )
    hass.states.async_set(entity.entity_id, "5", {"unit_of_measurement": "%"})
    canonical = f"battery:registry:{entity.id}"
    config_data.update(
        notifications=False,
        monitoring_policies=[
            {
                **monitoring_policy("excluded", {"kind": ["battery"]}, check="battery"),
                "excluded_sources": [canonical],
            },
            monitoring_policy(
                "included",
                {"kind": ["battery"]},
                check="battery",
                enabled=include_enabled,
            ),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    before = deepcopy(runtime.snapshot())
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": canonical}
    )
    result = (await client.receive_json())["result"]
    assert [
        row["policy_id"] for row in result["battery_conditions"]
    ] == expected_policies
    assert [row["id"] for row in result["monitoring_policies"]] == expected_policies
    assert result["members"][0]["state"] == "5"
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
