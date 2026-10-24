"""Executable scenarios for editable reusable-notification collection timing."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic import notification_definitions as definitions
from custom_components.homeostatic import notifications as notifications_module
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.test_lifecycle import start_monitor
from tests.test_notification_collection import advance, configure


def test_supplied_collection_delays_are_editable() -> None:
    """Supplied non-report profiles expose their ordinary editable starting delay."""
    data = definitions.defaults()
    profiles = data["profiles"]
    assert {
        key: value["timing"].get("collection_delay_seconds")
        for key, value in profiles.items()
    } == {
        "immediate": 60,
        "acknowledge": 5,
        "urgent": 60,
        "morning": None,
        "evening": None,
        "weekly": None,
    }
    profiles["custom"] = deepcopy(profiles["immediate"])
    for key, delay in (
        ("immediate", 0),
        ("acknowledge", 11),
        ("urgent", 42),
        ("custom", 8),
    ):
        profiles[key]["timing"]["collection_delay_seconds"] = delay
    assert definitions.validate(data) == data


@pytest.mark.parametrize("profile", ["immediate", "acknowledge", "urgent"])
@pytest.mark.parametrize("bad", [None, "", -1, 1.5, "12", "later", True, 0.0])
def test_named_collection_delay_rejects_invalid_values(
    profile: str, bad: object
) -> None:
    """Every applicable timing requires whole nonnegative seconds before save."""
    data = definitions.defaults()
    data["profiles"][profile]["timing"]["collection_delay_seconds"] = bad
    with pytest.raises(ValueError, match="Collection delay"):
        definitions.validate(data)


@pytest.mark.parametrize("profile", ["immediate", "acknowledge", "urgent"])
def test_named_collection_delay_is_required(profile: str) -> None:
    """An omitted field cannot silently select a delay when it applies."""
    data = definitions.defaults()
    del data["profiles"][profile]["timing"]["collection_delay_seconds"]
    with pytest.raises(ValueError, match="Collection delay"):
        definitions.validate(data)


def test_report_timing_and_existing_inline_rows_keep_their_contract() -> None:
    """Reports contain no wait while existing Custom rows need no conversion."""
    data = definitions.defaults()
    data["methods"]["phone"] = {
        "name": "Phone",
        "mode": "fixed",
        "destinations": ["phone:one"],
    }
    data["default"] = [
        {"id": "custom", "timing": {"mode": "immediate"}, "methods": ["phone"]}
    ]
    assert definitions.validate(data) == data
    data["profiles"]["immediate"]["timing"] = {
        "mode": "report",
        "at": "08:00",
        "weekdays": [0, 1, 2, 3, 4, 5, 6],
    }
    assert definitions.validate(data) == data
    data["profiles"]["immediate"]["timing"]["collection_delay_seconds"] = 60
    with pytest.raises(ValueError, match="settings for the selected timing"):
        definitions.validate(data)


async def test_switch_from_collection_to_report_sends_at_the_report_time(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An edited named report requests both transports exactly at its scheduled time."""
    freezer.move_to("2026-10-18T07:59:00+00:00")
    configure(config_data, delay=60)
    config_data["notification_definitions"]["timezone"] = "UTC"
    hass.states.async_set("sensor.observed", "42")
    direct = AsyncMock()
    monkeypatch.setattr(notifications_module, "async_send", direct)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    updated = deepcopy(config_data)
    updated["notification_definitions"]["profiles"]["immediate"]["timing"] = {
        "mode": "report",
        "at": "08:00",
        "weekdays": list(range(7)),
    }
    await runtime.async_apply_settings(Settings.from_data(updated))
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 59)
    assert events == []
    direct.assert_not_awaited()
    await advance(hass, freezer, 1)
    assert len(events) == 1
    assert events[0].time_fired.isoformat() == "2026-10-18T08:00:00+00:00"
    direct.assert_awaited_once()
    assert runtime.notifications.delivery.collections.next_deadline() is None
    await advance(hass, freezer, 60)
    assert len(events) == 1
    direct.assert_awaited_once()
    assert await hass.config_entries.async_unload(entry.entry_id)
