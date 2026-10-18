"""Native setup and options contract, including stable source identities."""

from typing import Any
from unittest.mock import patch

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import (
    Settings,
    resolve_entity,
)
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.policy_defaults import initial_settings


async def test_user_flow(hass: HomeAssistant) -> None:
    """Setup creates editable basic policies with no outgoing notifications."""
    source = MockConfigEntry(domain="test", title="Controller")
    source.add_to_hass(hass)
    with patch("custom_components.homeostatic.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": config_entries.SOURCE_USER}
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["monitoring_policy_version"] == 1
    assert {
        item["id"] for item in result["data"]["monitoring_policies"] if item["enabled"]
    } == {
        "default_integrations",
        "default_devices",
        "default_entities",
        "default_important_equipment",
        "default_repairs",
        "default_broken_automations",
    }
    profiles = result["data"]["notification_definitions"]["profiles"]
    assert all(
        row["profile"] in profiles
        for item in result["data"]["monitoring_policies"]
        for row in item["notifications"]
    )
    assert not any(profile["methods"] for profile in profiles.values())
    assert result["data"]["notifications"] is False


async def test_singleton(hass: HomeAssistant, config_entry: MockConfigEntry) -> None:
    """A second setup is directed to the existing entry's options."""
    config_entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


def test_native_options_flow_is_absent(config_entry: MockConfigEntry) -> None:
    """All edits now belong to the Homeostatic panel."""
    from custom_components.homeostatic.config_flow import HomeostaticConfigFlow

    assert not HomeostaticConfigFlow.async_supports_options_flow(config_entry)


def test_stored_functions_are_dormant() -> None:
    """Stored definitions survive while production ignores their effects."""
    data = {
        **initial_settings("UTC"),
        "functions": [
            {"id": "lighting", "name": "Lighting", "entities": ["entity_id:light.room"]}
        ],
    }
    assert len(Settings.from_data(data).functions) == 1
    assert Settings.from_data(data, functions_enabled=False).functions == ()
    assert data["functions"][0]["id"] == "lighting"


@pytest.mark.parametrize(
    "data",
    [
        {"timings": {"batch": -1}},
        {"timings": {"batch": True}},
        {"timings": {"invented": 2}},
        {"timings": {"coalesce_count": 1}},
        {"notifications": "yes"},
    ],
    ids=[
        "negative-time",
        "boolean-time",
        "unknown-time",
        "invalid-coalescing-count",
        "notification-string",
    ],
)
def test_invalid_stored_settings(data: dict[str, Any]) -> None:
    """Reject malformed persisted or externally supplied configuration."""
    with pytest.raises(ValueError):
        Settings.from_data({**initial_settings("UTC"), **data})


def test_invalid_reference(hass: HomeAssistant) -> None:
    """An unrecognized source reference cannot silently drop monitoring."""
    with pytest.raises(ValueError, match="source reference"):
        resolve_entity(hass, "invented")
