"""Explicit awareness and cancellation through authorized, durable HA actions."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import HomeAssistant
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

from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.test_controls import NODE, action, end
from tests.test_lifecycle import start_monitor


async def test_acknowledgment_is_shared_durable_and_not_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    hass_admin_user: User,
) -> None:
    """One authenticated acknowledgment stops opted-in repeats through reload."""
    config_data["policy"] = {
        "timezone": "UTC",
        "recipients": {
            "owner": {"channels": ["phone"]},
            "backup": {"channels": ["phone"]},
        },
        "rules": [
            {
                "match": {},
                "loudness": "notify",
                "to": ["owner", "backup"],
                "remind_every": "10s",
                "escalate_after": "15s",
                "require_acknowledgment": True,
            }
        ],
    }
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes))
    result = await action(
        hass, "acknowledge", {"episode_id": episode}, hass_admin_user.id
    )
    assert result["acknowledgment"]["actor_id"] == hass_admin_user.id
    assert await action(hass, "acknowledge", {"episode_id": episode}) == result
    assert runtime.readiness == "degraded"
    assert runtime.query("inventory", {})["attention_controls_supported"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    freezer.tick(timedelta(seconds=20))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not events
    assert next(iter(entry.runtime_data.episodes)) == episode
    assert (await action(hass, "policy", {}))["episodes"][0][
        "acknowledgment"
    ] == result["acknowledgment"]
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert not entry.runtime_data.episodes
    assert {event.data["action"] for event in events} == {"resolve"}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_cancel_one_overlapping_maintenance_after_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
) -> None:
    """One control id removes one window, including identical restored windows."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    data = {"node_id": NODE, "until": end()}
    first = await action(hass, "start_maintenance", data)
    second = await action(hass, "start_maintenance", data)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    await action(hass, "cancel_control", {"control_id": first["control"]["control_id"]})
    assert not entry.runtime_data.episodes
    with pytest.raises(ServiceValidationError, match="already ended"):
        await action(
            hass, "cancel_control", {"control_id": first["control"]["control_id"]}
        )
    await action(
        hass, "cancel_control", {"control_id": second["control"]["control_id"]}
    )
    assert len(entry.runtime_data.episodes) == 1
    assert entry.runtime_data.readiness == "degraded"
    assert (await action(hass, "operator_controls", {}))["controls"] == []
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_cancel_shelf_resumes_due_reminder(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Canceling a shelf releases due attention without resolving the episode."""
    config_data["policy"] = {
        "timezone": "UTC",
        "recipients": {"owner": {"channels": ["phone"]}},
        "rules": [
            {"match": {}, "loudness": "notify", "to": "owner", "remind_every": "10s"}
        ],
    }
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes))
    shelf = await action(hass, "shelve", {"episode_id": episode, "until": end()})
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not events
    result = await action(
        hass, "cancel_control", {"control_id": shelf["control"]["control_id"]}
    )
    assert result["cancelled_control_id"] == shelf["control"]["control_id"]
    assert len(events) == 1
    assert runtime.readiness == "degraded"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "name,data",
    [
        pytest.param("acknowledge", {"episode_id": "missing"}, id="awareness"),
        pytest.param("cancel_control", {"control_id": "missing"}, id="cancellation"),
    ],
)
async def test_attention_actions_require_administrator(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_read_only_user: User,
    name: str,
    data: dict[str, str],
) -> None:
    """Authorization is enforced by HA before target lookup or mutation."""
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    with pytest.raises(Unauthorized):
        await action(hass, name, data, hass_read_only_user.id)
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_attention_controls_are_guarded_on_incompatible_library(
    hass: HomeAssistant,
    config_data: dict[str, Any],
) -> None:
    """An incompatible dependency cannot silently promise unsupported controls."""
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with patch(
        "custom_components.homeostatic.runtime.supports_attention_controls",
        return_value=False,
    ):
        assert not runtime.query("inventory", {})["attention_controls_supported"]
        with pytest.raises(ServiceValidationError, match=r"HealthTree 0\.4\.0"):
            await action(hass, "acknowledge", {"episode_id": "missing"})
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_failed_acknowledgment_save_is_not_confirmed(
    hass: HomeAssistant,
    config_data: dict[str, Any],
) -> None:
    """A failed durable save leaves unavailable monitoring and an ambiguous action."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes))
    with (
        patch.object(
            runtime.store, "async_save", side_effect=OSError("storage unavailable")
        ),
        pytest.raises(HomeAssistantError, match="Could not confirm"),
    ):
        await action(hass, "acknowledge", {"episode_id": episode})
    assert not runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_acknowledgment_flag_rejects_text() -> None:
    """The opt-in rule requires a YAML boolean, not a string that looks true."""
    with pytest.raises(vol.Invalid):
        build_policy(
            {
                "timezone": "UTC",
                "recipients": {"owner": {"channels": ["phone"]}},
                "rules": [
                    {
                        "match": {},
                        "loudness": "notify",
                        "to": "owner",
                        "require_acknowledgment": "false",
                    }
                ],
            },
            timedelta(0),
        )
