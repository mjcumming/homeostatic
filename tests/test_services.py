"""Response-only public queries and invalid request handling."""

from typing import Any

import pytest
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor

NODE = "entity:entity_id:sensor.observed"


@pytest.mark.parametrize(
    "action,data,expected_key",
    [
        ("inventory", {}, "episodes"),
        ("explain", {"node_id": NODE}, "findings"),
        ("impact", {"node_id": NODE}, "importance"),
        ("coverage", {}, "never_observed"),
        ("readiness", {}, "answer"),
        ("readiness", {"node_ids": [NODE]}, "answer"),
        ("rollup", {}, "counts"),
        ("rollup", {"node_ids": [NODE]}, "counts"),
    ],
    ids=[
        "inventory",
        "explain",
        "impact",
        "coverage",
        "readiness-default",
        "readiness-explicit",
        "rollup-default",
        "rollup-explicit",
    ],
)
async def test_response_actions(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    action: str,
    data: dict[str, Any],
    expected_key: str,
) -> None:
    """HA exposes structured responses using public library records."""
    hass.states.async_set("sensor.observed", "unavailable")
    await start_monitor(hass, config_entry)
    response = await hass.services.async_call(
        DOMAIN, action, data, blocking=True, return_response=True
    )
    assert expected_key in response
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "action,data",
    [
        ("explain", {"node_id": "missing"}),
        ("impact", {"node_id": "missing"}),
        ("readiness", {"node_ids": ["missing"]}),
        ("rollup", {"node_ids": ["missing"]}),
    ],
)
async def test_unknown_node(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    action: str,
    data: dict[str, Any],
) -> None:
    """Invalid node ids are reported as action validation errors."""
    await start_monitor(hass, config_entry)
    with pytest.raises(ServiceValidationError, match="Unknown Homeostatic node"):
        await hass.services.async_call(
            DOMAIN, action, data, blocking=True, return_response=True
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_empty_readiness(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An explicitly empty request does not report readiness without evidence."""
    await start_monitor(hass, config_entry)
    response = await hass.services.async_call(
        DOMAIN, "readiness", {"node_ids": []}, blocking=True, return_response=True
    )
    assert response == {"answer": "unknown", "nodes": [], "blocked_by": None}
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_query_before_start(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An unloaded engine cannot return a cached all-clear."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.runtime_data.evidence_gaps == 0
    with pytest.raises(HomeAssistantError, match="not ready"):
        await hass.services.async_call(
            DOMAIN, "inventory", {}, blocking=True, return_response=True
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)
