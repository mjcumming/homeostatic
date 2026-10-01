"""Home Assistant's own automation repair reports are surfaced unchanged."""

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.automation_failures import (
    reported_automation_failures,
)
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


def test_automation_repair_failure_is_listed_and_clears(hass: HomeAssistant) -> None:
    """Only an active HA error appears, with its editor link."""
    ir.async_create_issue(
        hass,
        "automation",
        "automation.hall_validation_error",
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key="validation_error",
        translation_placeholders={
            "name": "Hall lights",
            "error": "Unknown entity",
            "edit": "/config/automation/edit/hall-lights",
        },
    )
    assert reported_automation_failures(hass) == [
        {
            "id": "automation.hall_validation_error",
            "name": "Hall lights",
            "reason": "Unknown entity",
            "url": "/config/automation/edit/hall-lights",
        }
    ]
    ir.async_delete_issue(hass, "automation", "automation.hall_validation_error")
    assert reported_automation_failures(hass) == []


def test_unrelated_repair_is_not_an_automation_failure(hass: HomeAssistant) -> None:
    """Homeostatic does not infer failures from ordinary Repairs entries."""
    ir.async_create_issue(
        hass,
        "automation",
        "automation.hall_notice",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="validation_error",
    )
    assert reported_automation_failures(hass) == []


async def test_dashboard_tracks_ha_automation_repair_lifecycle(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A reported failure appears and disappears without a rule scan."""
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe"})
    await client.receive_json()
    assert (await client.receive_json())["event"]["automation_failures"] == []
    ir.async_create_issue(
        hass,
        "zha",
        "zha.unrelated_repair",
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key="unrelated_repair",
    )
    ir.async_create_issue(
        hass,
        "automation",
        "automation.kitchen_service_not_found_light.turn_on",
        is_fixable=True,
        is_persistent=True,
        severity=ir.IssueSeverity.ERROR,
        translation_key="service_not_found",
        translation_placeholders={
            "name": "Kitchen lights",
            "service": "light.turn_on",
            "edit": "/config/automation/edit/kitchen-lights",
        },
    )
    failure = (await client.receive_json())["event"]["automation_failures"][0]
    assert failure["name"] == "Kitchen lights"
    ir.async_delete_issue(
        hass, "automation", "automation.kitchen_service_not_found_light.turn_on"
    )
    assert (await client.receive_json())["event"]["automation_failures"] == []
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
