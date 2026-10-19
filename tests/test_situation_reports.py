"""Executable automation-report scenarios using the real HA engine and policy."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import (
    HomeAssistantError,
    ServiceValidationError,
    Unauthorized,
)
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import Settings, normalize_definitions
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.policy_helpers import current_config, immediate_notification
from tests.test_lifecycle import start_monitor

NODE = "situation:basement_water"


@pytest.fixture
def report_entry(config_data: dict[str, Any]) -> MockConfigEntry:
    """Declare a finite-lived producer beside the existing availability source."""
    config_data["notification_definitions"]["assignments"][NODE] = {
        "default": immediate_notification(),
        "checks": {},
    }
    config_data["situations"] = [
        {
            "id": "basement_water",
            "name": "Water in basement",
            "importance": "critical",
            "report_timeout": 300,
        },
        {
            "id": "bound",
            "name": "Bound source",
            "entity": "entity_id:binary_sensor.bound",
        },
    ]
    return MockConfigEntry(
        domain=DOMAIN, title="Homeostatic", unique_id=DOMAIN, data=config_data
    )


async def report(
    hass: HomeAssistant,
    state: str,
    *,
    situation_id: str = "basement_water",
    user_id: str | None = None,
) -> dict[str, Any]:
    """Exercise HA's public action including validation and authorization."""
    return await hass.services.async_call(
        DOMAIN,
        "report_situation",
        {"situation_id": situation_id, "state": state},
        blocking=True,
        return_response=True,
        context=Context(user_id=user_id),
    )


async def test_open_refresh_unknown_reload_and_clear(
    hass: HomeAssistant, report_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Water opens once, survives uncertainty/reload, and clears only on evidence."""
    hass.states.async_set("sensor.observed", "42")
    hass.states.async_set("binary_sensor.bound", "off")
    runtime = await start_monitor(hass, report_entry)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    response = await report(hass, "active")
    episode_id = next(iter(runtime.episodes))
    assert response["node_id"] == NODE
    assert runtime.readiness == "ready"
    assert runtime.engine.impact(NODE).importance.value == "critical"
    freezer.tick(timedelta(seconds=10))
    await report(hass, "active")
    await runtime.async_refresh()
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine.readiness([NODE]).answer == "blocked"
    await report(hass, "unknown")
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine.readiness([NODE]).answer == "unknown"
    await report(hass, "active")
    assert await hass.config_entries.async_reload(report_entry.entry_id)
    await hass.async_block_till_done()
    runtime = report_entry.runtime_data
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine.readiness([NODE]).answer == "unknown"
    await report(hass, "active")
    assert list(runtime.episodes) == [episode_id]
    await report(hass, "clear")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert runtime.engine.readiness([NODE]).answer == "ready"
    assert len([event for event in events if event.data["action"] == "open"]) == 1
    assert events[-1].data["action"] == "resolve"
    assert await hass.config_entries.async_unload(report_entry.entry_id)
    assert not hass.services.has_service(DOMAIN, "report_situation")


async def test_expiry_is_unknown_then_stale(
    hass: HomeAssistant, report_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Reconciliation cannot refresh an abandoned report or invent recovery."""
    hass.states.async_set("sensor.observed", "42")
    hass.states.async_set("binary_sensor.bound", "off")
    runtime = await start_monitor(hass, report_entry)
    await report(hass, "active")
    episode_id = next(iter(runtime.episodes))
    freezer.tick(timedelta(seconds=301))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine.readiness([NODE]).answer == "unknown"
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert "stale" in [
        reason["reason"] for reason in runtime.episodes[episode_id]["reasons"]
    ]
    await report(hass, "clear")
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(report_entry.entry_id)


@pytest.mark.parametrize(
    "situation_id",
    [
        pytest.param("missing", id="undeclared"),
        pytest.param("bound", id="entity-owned"),
    ],
)
async def test_report_target_is_configured(
    hass: HomeAssistant, report_entry: MockConfigEntry, situation_id: str
) -> None:
    """An action cannot create arbitrary sources or overwrite an entity binding."""
    runtime = await start_monitor(hass, report_entry)
    with pytest.raises(ServiceValidationError, match="configured automation situation"):
        await report(hass, "active", situation_id=situation_id)
    assert runtime.available
    assert await hass.config_entries.async_unload(report_entry.entry_id)


async def test_report_authorization_and_notification_switch(
    hass: HomeAssistant,
    report_entry: MockConfigEntry,
    hass_read_only_user: User,
    hass_admin_user: User,
) -> None:
    """Only authorized reports are processed, and reporting never activates delivery."""
    report_entry = MockConfigEntry(
        domain=DOMAIN,
        title="Homeostatic",
        unique_id=DOMAIN,
        data={**report_entry.data, "notifications": False},
    )
    runtime = await start_monitor(hass, report_entry)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with pytest.raises(Unauthorized):
        await report(hass, "active", user_id=hass_read_only_user.id)
    assert not runtime.episodes
    await report(hass, "active", user_id=hass_admin_user.id)
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert not events
    assert not runtime.settings.notifications
    assert await hass.config_entries.async_unload(report_entry.entry_id)


async def test_report_storage_failure_does_not_publish(
    hass: HomeAssistant, report_entry: MockConfigEntry
) -> None:
    """Failed durable processing returns an error before any new notification."""
    runtime = await start_monitor(hass, report_entry)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch.object(
            runtime.store, "async_save", side_effect=OSError("disk unavailable")
        ),
        pytest.raises(HomeAssistantError, match="Could not confirm"),
    ):
        await report(hass, "active")
    await hass.async_block_till_done()
    assert not events
    assert not runtime.available
    await runtime.async_refresh()
    assert runtime.available
    assert await hass.config_entries.async_unload(report_entry.entry_id)


@pytest.mark.parametrize(
    "extra",
    [
        pytest.param({"report_timeout": 59}, id="too-short"),
        pytest.param({"report_timeout": 86401}, id="too-long"),
        pytest.param({"report_timeout": True}, id="boolean"),
        pytest.param({"report_timeout": None}, id="null"),
        pytest.param(
            {"report_timeout": 300, "entity": "entity_id:binary_sensor.leak"},
            id="two-producers",
        ),
    ],
)
def test_invalid_report_configuration(extra: dict[str, Any]) -> None:
    """Producer ownership and finite evidence lifetime are explicit."""
    with pytest.raises(ValueError, match="report_timeout"):
        Settings.from_data(
            {
                **current_config(),
                **({"situations": [{"id": "leak", "name": "Leak", **extra}]}),
            }
        )


async def test_reporter_definition_normalization(hass: HomeAssistant) -> None:
    """Definition normalization preserves a report-only declaration."""
    data = normalize_definitions(
        hass, {"situations": [{"id": "leak", "name": "Leak", "report_timeout": 300}]}
    )
    situation = Settings.from_data({**current_config(), **(data)}).situations[0]
    assert situation.entity is None
    assert situation.report_timeout == 300
