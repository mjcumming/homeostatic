"""Home Assistant fixtures with explicitly controlled time."""

from collections.abc import Generator
from typing import Any

import pytest
from homeassistant.components import persistent_notification
from homeassistant.core import Event, HomeAssistant, callback
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DEFAULTS, DOMAIN, EVENT_NOTIFICATION

pytest_plugins = ["pytest_homeassistant_custom_component"]


@pytest.fixture(autouse=True)
def custom_integrations(enable_custom_integrations: None) -> None:
    """Allow the repository's custom integration."""


@pytest.fixture
def config_data() -> dict[str, Any]:
    """Short explicit durations keep lifecycle tests clear without sleeping."""
    return {
        "entities": ["entity_id:sensor.observed"],
        "config_entries": [],
        "notifications": True,
        "consumer": "automation.homeostatic_test_consumer",
        "timings": {
            **DEFAULTS,
            "startup_grace": 0,
            "settle": 0,
            "rejoin_grace": 0,
            "clear_hold": 0,
            "batch": 0,
            "unknown_hold": 30,
            "retry_hold": 20,
        },
    }


@pytest.fixture
def config_entry(config_data: dict[str, Any]) -> MockConfigEntry:
    """Unloaded singleton config entry."""
    return MockConfigEntry(
        domain=DOMAIN, title="Homeostatic", unique_id=DOMAIN, data=config_data
    )


@pytest.fixture(autouse=True)
def notification_consumer(hass: HomeAssistant) -> Generator[None]:
    """An isolated test consumer proves transport stays outside the integration."""
    hass.states.async_set("automation.homeostatic_test_consumer", "on")

    @callback
    def consume(event: Event[Any]) -> None:
        data = event.data
        if data["action"] == "resolve":
            persistent_notification.async_dismiss(hass, data["tag"])
        else:
            persistent_notification.async_create(
                hass, data["message"], data["title"], data["tag"]
            )

    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, consume)
    yield
    cancel()
