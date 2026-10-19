"""Source evidence reflects each policy's actual monitored membership."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


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
