"""Enrollment rule changes regenerate only the candidate rows whose decisions changed."""

from copy import deepcopy
from typing import Any
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import enrollment
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from custom_components.homeostatic.monitoring_runtime import enrollment_rules
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


def _rows(dashboard: Any) -> dict[str, Any]:
    return {row["node_id"]: row for row in dashboard.catalog_sections["candidates"]}


async def _prepare(hass: HomeAssistant, config_data: dict[str, Any]) -> MockConfigEntry:
    config_data["notifications"] = False
    config_data["monitoring_policies"] = [
        monitoring_policy("entities", {"kind": ["entity"]})
    ]
    for index in range(40):
        hass.states.async_set(f"sensor.candidate_{index}", "42")
    hass.states.async_set("sensor.observed", "1")
    return MockConfigEntry(domain=DOMAIN, data=config_data)


async def test_exclusion_serializes_only_the_changed_candidate(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """One Stop Monitoring edit re-serializes one candidate row and reuses the rest."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    before = _rows(dashboard)
    target = "entity:entity_id:sensor.candidate_7"
    assert runtime.candidates[target].watched
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe", "paged": True})
    assert (await client.receive_json())["success"]
    revision = (await client.receive_json())["event"]["catalog_revision"]

    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["excluded_sources"] = [target]
    serialized: list[str] = []
    original = enrollment.json_object

    def counting(source: Any) -> Any:
        serialized.append(source.node_id)
        return original(source)

    with patch.object(enrollment, "json_object", side_effect=counting):
        await runtime.async_apply_settings(Settings.from_data(changed))

    assert serialized == [target]
    after = _rows(dashboard)
    assert after.keys() == before.keys()
    assert all(
        after[node_id] is before[node_id] for node_id in before if node_id != target
    )
    assert after[target] is not before[target]
    assert after[target]["watched"] is False
    fresh = enrollment.report(
        runtime.candidates, enrollment_rules(runtime.settings.monitoring_policies)
    )
    assert {row["node_id"]: row for row in fresh["candidates"]} == after
    reused = enrollment.report(
        runtime.candidates,
        enrollment_rules(runtime.settings.monitoring_policies),
        evaluated=True,
        previous=runtime.candidates,
        previous_rows=after,
    )
    assert all(row is after[row["node_id"]] for row in reused["candidates"])
    assert reused["watched"] == fresh["watched"] and reused["rules"] == fresh["rules"]

    event = (await client.receive_json())["event"]
    while event["catalog_revision"] == revision:
        event = (await client.receive_json())["event"]
    delta = event["catalog_delta"]
    assert delta["sections"]["candidates"] == {"upsert": [after[target]], "remove": []}
    assert target in delta["sections"]["nodes"]["remove"]
    assert not delta["sections"]["nodes"]["upsert"]
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_many_changed_decisions_regenerate_exactly_those_rows(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Excluding many candidates regenerates each affected row once and no other."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    before = _rows(dashboard)
    excluded = [f"entity:entity_id:sensor.candidate_{index}" for index in range(30)]
    assert all(runtime.candidates[node_id].watched for node_id in excluded)
    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["excluded_sources"] = excluded
    serialized: list[str] = []
    original = enrollment.json_object

    def counting(source: Any) -> Any:
        serialized.append(source.node_id)
        return original(source)

    with patch.object(enrollment, "json_object", side_effect=counting):
        await runtime.async_apply_settings(Settings.from_data(changed))

    assert sorted(serialized) == sorted(excluded)
    after = _rows(dashboard)
    assert all(
        after[node_id] is before[node_id]
        for node_id in before
        if node_id not in excluded
    )
    assert all(after[node_id]["watched"] is False for node_id in excluded)
    fresh = enrollment.report(
        runtime.candidates, enrollment_rules(runtime.settings.monitoring_policies)
    )
    assert {row["node_id"]: row for row in fresh["candidates"]} == after
    assert await hass.config_entries.async_unload(entry.entry_id)
