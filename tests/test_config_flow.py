"""Native setup and options contract, including stable source identities."""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import (
    Settings,
    data_from_input,
    resolve_entity,
)
from custom_components.homeostatic.config_flow import preview_summary
from custom_components.homeostatic.const import DOMAIN


async def test_user_flow(hass: HomeAssistant) -> None:
    """Setup converts selected entities into stable registry identities."""
    source = MockConfigEntry(domain="test", title="Controller")
    source.add_to_hass(hass)
    registry_entry = er.async_get(hass).async_get_or_create(
        "sensor", "test", "observed", config_entry=source
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    with patch("custom_components.homeostatic.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                "rules": [
                    {
                        "id": "selected",
                        "action": "attach",
                        "match": {"entity": registry_entry.entity_id},
                    }
                ],
                "notifications": True,
                "consumer": "automation.homeostatic_test_consumer",
            },
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["rules"][0]["match"]["entity"] == [
        f"registry:{registry_entry.id}"
    ]


def test_preview_describes_ha_groupings(hass: HomeAssistant) -> None:
    """Preview distinguishes integrations, device entities and area signals."""
    source = MockConfigEntry(domain="test", title="Controller")
    source.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=source.entry_id,
        identifiers={("test", "controller")},
        name="Controller",
    )
    registry = er.async_get(hass)
    registry.async_get_or_create(
        "sensor", "test", "device_signal", config_entry=source, device_id=device.id
    )
    registry.async_get_or_create("sensor", "test", "area_signal", config_entry=source)

    preview = preview_summary(
        hass,
        {
            "rules": [
                {
                    "id": "passive_availability",
                    "action": "attach",
                    "match": {},
                    "checks": ["availability"],
                }
            ]
        },
    )

    assert "1 integration instance" in preview
    assert "1 device-associated entity" in preview
    assert "entities without an HA device" in preview
    assert "Device association does not prove physical hardware." in preview


async def test_singleton(hass: HomeAssistant, config_entry: MockConfigEntry) -> None:
    """A second setup is directed to the existing entry's options."""
    config_entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


@pytest.mark.parametrize(
    "selection",
    [{"config_entries": ["monitor"]}, {"entity_ids": ["sensor.monitor"]}],
    ids=["own-entry", "own-entity"],
)
async def test_reject_self_monitoring(
    hass: HomeAssistant, selection: dict[str, Any]
) -> None:
    """Self-derived health cannot be admitted as independent source evidence."""
    own = MockConfigEntry(domain=DOMAIN, entry_id="monitor")
    own.add_to_hass(hass)
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "monitor", suggested_object_id="monitor", config_entry=own
    )
    with pytest.raises(vol.Invalid):
        data_from_input(hass, selection)


async def test_invalid_input_keeps_form(hass: HomeAssistant) -> None:
    """A self-derived source is rejected with a useful form error."""
    own_sensor = er.async_get(hass).async_get_or_create("sensor", DOMAIN, "orphan")
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            "rules": [
                {
                    "id": "self",
                    "action": "attach",
                    "match": {"entity": own_sensor.entity_id},
                }
            ]
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_config"}


async def test_options_missing_selection(hass: HomeAssistant) -> None:
    """Legacy missing requirements become editable rules on options save."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"entities": ["registry:missing"], "config_entries": ["missing_entry"]},
    )
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    with patch.object(
        hass.config_entries, "async_reload", new=AsyncMock(return_value=True)
    ):
        result = await hass.config_entries.options.async_configure(
            result["flow_id"], {"notifications": False}
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["rules"][0]["match"]["entity"] == ["registry:missing"]
    assert result["data"]["rules"][1]["match"]["integration"] == ["missing_entry"]
    assert result["data"]["entities"] == []


async def test_options_invalid(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Invalid options do not replace valid settings."""
    config_entry.add_to_hass(hass)
    own_sensor = er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "orphan", config_entry=config_entry
    )
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "rules": [
                {
                    "id": "self",
                    "action": "attach",
                    "match": {"entity": own_sensor.entity_id},
                }
            ]
        },
    )
    assert result["errors"] == {"base": "invalid_config"}


@pytest.mark.parametrize(
    "data",
    [
        {"timings": {"batch": -1}},
        {"timings": {"batch": True}},
        {"timings": {"invented": 2}},
        {"timings": {"coalesce_count": 1}},
        {"entities": "sensor.a"},
        {"entities": [2]},
        {"config_entries": "one"},
        {"config_entries": [2]},
        {"notifications": "yes"},
    ],
    ids=[
        "negative-time",
        "boolean-time",
        "unknown-time",
        "invalid-coalescing-count",
        "entity-string",
        "entity-number",
        "entry-string",
        "entry-number",
        "notification-string",
    ],
)
def test_invalid_stored_settings(data: dict[str, Any]) -> None:
    """Reject malformed persisted or externally supplied configuration."""
    with pytest.raises(ValueError):
        Settings.from_data(data)


def test_invalid_reference(hass: HomeAssistant) -> None:
    """An unrecognized source reference cannot silently drop monitoring."""
    with pytest.raises(ValueError, match="source reference"):
        resolve_entity(hass, "invented")


async def test_native_flow_accepts_function_and_situation_yaml(
    hass: HomeAssistant,
) -> None:
    """Native object selectors accept the documented YAML-list shapes."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    with patch("custom_components.homeostatic.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                "functions": [
                    {"id": "garage", "name": "Garage", "entities": ["cover.garage"]}
                ],
                "situations": [
                    {
                        "id": "open_at_night",
                        "name": "Garage open at night",
                        "entity": "binary_sensor.garage_open_at_night",
                    }
                ],
            },
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["functions"][0]["entities"] == ["entity_id:cover.garage"]
    assert (
        result["data"]["situations"][0]["entity"]
        == "entity_id:binary_sensor.garage_open_at_night"
    )
    assert result["data"]["notifications"] is False
