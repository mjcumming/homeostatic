"""Exercise the shipped consumer with Home Assistant's automation engine."""

from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.blueprint import BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import yaml as yaml_util
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.homeostatic.const import EVENT_NOTIFICATION


@pytest.mark.parametrize(
    "action,loudness,silent,expected_message,critical",
    [
        pytest.param("open", "notify", False, "Door open", 0, id="ordinary"),
        pytest.param("open", "urgent", False, "Door open", 1, id="urgent"),
        pytest.param("update", "urgent", True, "Door open", 0, id="silent-update"),
        pytest.param(
            "resolve", "notify", True, "clear_notification", None, id="resolution"
        ),
        pytest.param("summary", "notify", False, "Door open", 0, id="summary"),
    ],
)
async def test_companion_consumer(
    hass: HomeAssistant,
    action: str,
    loudness: str,
    silent: bool,
    expected_message: str,
    critical: int | None,
) -> None:
    """The real blueprint routes requests without contacting any device."""
    path = (
        Path(__file__).parents[1]
        / "blueprints/automation/homeostatic/companion_notification.yaml"
    )
    data = await hass.async_add_executor_job(yaml_util.load_yaml, str(path))
    blueprint = Blueprint(data, expected_domain="automation", schema=BLUEPRINT_SCHEMA)
    inputs = BlueprintInputs(
        blueprint,
        {
            "use_blueprint": {
                "path": "homeostatic/companion_notification.yaml",
                "input": {
                    "recipient": "owner",
                    "notify_service": "notify.mobile_app_test",
                },
            }
        },
    )
    inputs.validate()
    automation: dict[str, Any] = {
        **inputs.async_substitute(),
        "id": "homeostatic_blueprint_test",
        "alias": "Homeostatic blueprint test",
    }
    calls = async_mock_service(hass, "notify", "mobile_app_test")
    assert await async_setup_component(hass, "automation", {"automation": [automation]})
    await hass.async_block_till_done()
    hass.bus.async_fire(
        EVENT_NOTIFICATION,
        {
            "schema_version": 1,
            "entry_id": "test",
            "episode_id": "episode",
            "delivery_id": "test:1",
            "tag": "homeostatic_test_episode",
            "action": action,
            "recipient": "owner",
            "loudness": loudness,
            "silent": silent,
            "title": "Garage",
            "message": "Door open",
        },
    )
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["message"] == expected_message
    assert calls[0].data["data"]["tag"] == "homeostatic_test_episode"
    assert (
        calls[0].data["data"].get("push", {}).get("sound", {}).get("critical")
        == critical
    )
