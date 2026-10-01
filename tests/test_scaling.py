"""Large catalog preview and graph registration scenarios, isolated from live HA."""

from collections.abc import Callable
from copy import deepcopy
from time import perf_counter
from typing import Any
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.config_flow import preview_summary
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.function_model import preview
from tests.test_lifecycle import start_monitor

LIGHTS = [{"id": "lights", "action": "attach", "match": {"domain": ["light"]}}]


async def test_ten_thousand_source_rule_preview_without_engine(
    hass: HomeAssistant,
    record_property: Callable[[str, object], None],
) -> None:
    """Enrollment counts must not construct a graph even for a large catalog."""
    for index in range(10000):
        hass.states.async_set(f"light.scale_{index}", "off")
    with (
        patch(
            "custom_components.homeostatic.config.Engine",
            side_effect=AssertionError("Enrollment counts need no engine"),
        ),
        patch(
            "custom_components.homeostatic.function_model.Engine",
            side_effect=AssertionError("Enrollment counts need no engine"),
        ),
    ):
        started = perf_counter()
        summary = preview_summary(hass, {"rules": LIGHTS})
    record_property("rule_preview_seconds", perf_counter() - started)
    assert "10000 watched sources" in summary
    assert not hass.config_entries.async_entries(DOMAIN)


def test_removing_all_functions_needs_no_graph(hass: HomeAssistant) -> None:
    """An empty function proposal still reports removed edges without discovery."""
    previous = Settings.from_data(
        {
            "functions": [
                {"id": "room", "name": "Room", "requires": ["external:network"]}
            ]
        }
    ).functions
    with patch(
        "custom_components.homeostatic.function_model.inventory",
        side_effect=AssertionError("No function graph needed"),
    ):
        result = preview(hass, Settings.from_data({}), {}, previous)
    assert result == {
        "preview_kind": "current_evidence_without_history",
        "functions": [],
        "edges_added": [],
        "edges_removed": [{"from": "function:room", "to": "external:network"}],
    }


async def test_large_graph_setup_reconcile_and_failure(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    record_property: Callable[[str, object], None],
) -> None:
    """Ten thousand healthy monitors retain failure detection with dormant functions."""
    for index in range(10000):
        hass.states.async_set(f"light.scale_{index}", "off")
    hass.states.async_set("sensor.unwatched", "available")
    config_data.update(
        rules=LIGHTS,
        notifications=False,
        functions=[
            {
                "id": "room",
                "name": "Room",
                "requires": [
                    "entity:entity_id:light.scale_0",
                    "entity:entity_id:sensor.unwatched",
                ],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with patch(
        "health_tree.engine.Engine.register",
        side_effect=AssertionError("Use batch registration"),
    ):
        started = perf_counter()
        runtime = await start_monitor(hass, entry)
        record_property("setup_seconds", perf_counter() - started)
        assert len(runtime.sources) == 10000
        assert runtime.sources["entity:entity_id:light.scale_0"].watched
        assert not runtime.candidates["entity:entity_id:sensor.unwatched"].watched
        assert "entity:entity_id:sensor.unwatched" not in runtime.sources
        assert (
            "entity:entity_id:automation.homeostatic_test_consumer"
            not in runtime.sources
        )
        assert runtime.readiness == "ready"
        before = deepcopy(runtime.episodes)
        with patch(
            "health_tree.engine.Engine.register_many",
            side_effect=AssertionError("Unchanged graph needs no registration"),
        ):
            started = perf_counter()
            await runtime.async_refresh()
            record_property("reconcile_seconds", perf_counter() - started)
        assert runtime.episodes == before
        started = perf_counter()
        hass.states.async_set("light.scale_0", "unavailable")
        await hass.async_block_till_done()
        record_property("failure_processing_seconds", perf_counter() - started)
        assert runtime.readiness == "degraded"
        assert len(runtime.episodes) == 1
        assert (
            next(iter(runtime.episodes.values()))["anchor"]
            == "entity:entity_id:light.scale_0"
        )
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_function_preview_batches_registration(hass: HomeAssistant) -> None:
    """Function preview retains healthy evidence and missing required evidence."""
    hass.states.async_set("light.observed", "off")
    settings = Settings.from_data(
        {
            "rules": LIGHTS,
            "functions": [
                {
                    "id": "room",
                    "name": "Room",
                    "requires": ["entity:entity_id:light.observed", "external:missing"],
                }
            ],
        }
    )
    with patch(
        "health_tree.engine.Engine.register",
        side_effect=AssertionError("Use batch registration"),
    ):
        result = preview(hass, settings, {})
    assert result["functions"][0]["readiness"]["answer"] == "unknown"
    assert {item["node_id"] for item in result["functions"][0]["requirements"]} == {
        "entity:entity_id:light.observed",
        "external:missing",
    }
