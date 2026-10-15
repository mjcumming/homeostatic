"""Policy saves reuse unchanged presentation without changing monitoring outcomes."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import report
from custom_components.homeostatic.monitoring_runtime import enrollment_rules
from custom_components.homeostatic.serialization import json_object
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("edit", ["name", "parameters"])
async def test_policy_edit_preserves_exact_catalog_and_unaffected_monitoring(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: str,
) -> None:
    """A rename retains findings; a threshold edit removes its previous expectation."""
    hass.states.async_set("sensor.observed", "unavailable")
    hass.states.async_set(
        "sensor.room",
        "59",
        {"unit_of_measurement": "°F", "device_class": "temperature"},
    )
    config_data["monitoring_policies"].append(
        monitoring_policy(
            "temperature",
            {"entity": ["entity_id:sensor.room"]},
            check="temperature_limit",
            parameters={"unit": "°F", "minimum": 60, "duration_seconds": 0},
        )
    )
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 2
    previous_catalog = runtime.inventory_static["catalog"]
    previous_nodes = {row["node_id"]: row for row in runtime.inventory_static["nodes"]}
    unaffected = {
        identity: deepcopy(episode)
        for identity, episode in runtime.episodes.items()
        if ":observed:" in episode["anchor"]
    }
    previous_episodes = set(runtime.episodes)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    current = (await client.receive_json())["result"]
    proposed = deepcopy(current["settings"])
    proposed["monitoring_policies"][1][edit] = {
        "name": "Indoor temperature",
        "parameters": {
            "unit": "°F",
            "minimum": 58,
            "maximum": None,
            "duration_seconds": 0,
        },
    }[edit]
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/save_settings",
            "revision": current["revision"],
            "settings": proposed,
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    assert entry.runtime_data is runtime
    assert runtime.inventory_static["catalog"] is previous_catalog
    assert runtime.inventory_static["catalog"] == report(
        runtime.candidates, enrollment_rules(runtime.settings.monitoring_policies)
    )
    assert runtime.inventory_static["nodes"] == [
        json_object(source) for source in runtime.sources.values()
    ]
    current_nodes = {row["node_id"]: row for row in runtime.inventory_static["nodes"]}
    assert (
        current_nodes["entity:entity_id:sensor.observed"]
        is previous_nodes["entity:entity_id:sensor.observed"]
    )
    assert {
        identity: runtime.episodes[identity] for identity in unaffected
    } == unaffected
    assert (
        set(runtime.episodes)
        == {"name": previous_episodes, "parameters": set(unaffected)}[edit]
    )
    assert [row["resolution"] for row in runtime.history.snapshot()["episodes"]] == {
        "name": [],
        "parameters": ["removed"],
    }[edit]
    await client.send_json(
        {"id": 3, "type": "homeostatic/configuration", "section": "settings"}
    )
    assert (await client.receive_json())["result"]["settings"] == proposed
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_disabled_policy_scope_refreshes_catalog_rules(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An unchanged candidate set still gets fresh match counts after a rule edit."""
    hass.states.async_set("sensor.observed", "1")
    hass.states.async_set("sensor.other", "1")
    config_data["monitoring_policies"][0]["enabled"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    previous_candidates = runtime.candidates
    previous_catalog = runtime.inventory_static["catalog"]
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    current = (await client.receive_json())["result"]
    proposed = deepcopy(current["settings"])
    proposed["monitoring_policies"][0]["match"] = {"kind": ["entity"]}
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/save_settings",
            "revision": current["revision"],
            "settings": proposed,
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    assert runtime.candidates == previous_candidates
    assert runtime.inventory_static["catalog"] is not previous_catalog
    assert runtime.inventory_static["catalog"] == report(
        runtime.candidates, enrollment_rules(runtime.settings.monitoring_policies)
    )
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
