"""Detected facts for owner automations (ADR 0014)."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import (
    DOMAIN,
    EVENT_CONTROL,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
)
from custom_components.homeostatic.facts import Fact
from tests.test_controls import NODE, action, end
from tests.test_lifecycle import start_monitor
from tests.test_startup_quiet import fresh_start, slow_integration

FUNCTION = "function:lighting"


@pytest.fixture
def lighting(config_data: dict[str, Any]) -> dict[str, Any]:
    """One function over the observed sensor, with notifications off."""
    config_data["notifications"] = False
    config_data["functions"] = [
        {"id": "lighting", "name": "Lighting", "entities": [NODE[7:]]}
    ]
    return config_data


def event_entity(hass: HomeAssistant) -> str:
    """Find the function's event entity by its stable unique id."""
    registry = er.async_get(hass)
    entity_id = next(
        entry.entity_id
        for entry in registry.entities.values()
        if entry.platform == DOMAIN and entry.unique_id.endswith("_lighting_problems")
    )
    assert entity_id.startswith("event.")
    return entity_id


async def test_episode_facts_without_notifications(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """Owners see opened and resolved facts, linked to the causing state change."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    runtime = await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    requests = async_capture_events(hass, EVENT_NOTIFICATION)
    cause = Context()
    hass.states.async_set("sensor.observed", "unavailable", context=cause)
    await hass.async_block_till_done()
    assert [fact.data["change"] for fact in facts] == ["opened"]
    opened = facts[0]
    assert opened.context.parent_id == cause.id
    assert opened.data | {"episode_id": None, "opened_at": None, "reasons": None} == {
        "schema_version": 1,
        "entry_id": entry.entry_id,
        "change": "opened",
        "episode_id": None,
        "form": "root",
        "anchor": NODE,
        "anchor_name": "observed",
        "anchor_kind": "entity",
        "entity_ids": ["sensor.observed"],
        "device_id": None,
        "area_id": None,
        "floor_id": None,
        "status": "fail",
        "importance": "normal",
        "reasons": None,
        "function_ids": [FUNCTION],
        "functions": ["Lighting"],
        "opened_at": None,
        "shelved": False,
        "maintenance": False,
        "acknowledged": False,
    }
    assert opened.data["episode_id"] in runtime.episodes
    assert opened.data["reasons"][0]["node_id"] == NODE
    state = hass.states.get(event_entity(hass))
    assert state is not None
    assert state.attributes["event_type"] == "problem_opened"
    assert state.attributes["episode_id"] == opened.data["episode_id"]
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    resolved = facts[-1]
    assert resolved.data["change"] == "resolved"
    assert resolved.data["resolution"] == "cleared"
    assert resolved.data["absorbed_into"] is None
    assert resolved.data["function_ids"] == [FUNCTION]
    state = hass.states.get(event_entity(hass))
    assert state is not None
    assert state.attributes["event_type"] == "problem_resolved"
    assert state.attributes["resolution"] == "cleared"
    assert not requests
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_repeats_and_reload_publish_nothing(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """Identical observations and ordinary reloads do not repeat facts."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    hass.states.async_set("sensor.observed", "unavailable", {"note": "same"})
    await hass.async_block_till_done()
    # A rename updates the library episode's labels, not its condition.
    hass.states.async_set("sensor.observed", "unavailable", {"friendly_name": "Hall"})
    await hass.async_block_till_done()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert not facts
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_condition_change_is_an_update(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """Losing evidence changes an open problem's condition without resolving it."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    hass.states.async_set("sensor.observed", "unknown")
    await hass.async_block_till_done()
    assert [(fact.data["change"], fact.data["status"]) for fact in facts] == [
        ("updated", "unknown")
    ]
    state = hass.states.get(event_entity(hass))
    assert state is not None
    assert state.attributes["event_type"] == "problem_changed"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_readiness_sensors_are_enums(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """The automation editor can offer readiness states."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    await start_monitor(hass, entry)
    registry = er.async_get(hass)
    for suffix in ("_readiness", "_function_lighting"):
        entity_id = next(
            item.entity_id
            for item in registry.entities.values()
            if item.platform == DOMAIN and item.unique_id.endswith(suffix)
        )
        state = hass.states.get(entity_id)
        assert state is not None
        assert state.state == "ready"
        assert state.attributes["options"] == [
            "ready",
            "degraded",
            "blocked",
            "unknown",
        ]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_situation_is_a_fact_without_function_entity(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A situation publishes its source identity and affects no function."""
    config_data.update(
        entities=[],
        notifications=False,
        situations=[
            {
                "id": "door",
                "name": "Door open",
                "entity": "entity_id:binary_sensor.door",
            }
        ],
    )
    hass.states.async_set("binary_sensor.door", "off")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    hass.states.async_set("binary_sensor.door", "on")
    await hass.async_block_till_done()
    assert [fact.data["change"] for fact in facts] == ["opened"]
    assert facts[0].data["anchor_kind"] == "situation"
    assert facts[0].data["entity_ids"] == ["binary_sensor.door"]
    assert facts[0].data["function_ids"] == []
    assert not [
        item
        for item in er.async_get(hass).entities.values()
        if item.platform == DOMAIN and item.domain == "event"
    ]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_control_facts_reuse_the_action_context(
    hass: HomeAssistant,
    lighting: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    hass_admin_user: User,
) -> None:
    """Controls report start and end; actions carry the acting user's context."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes))
    controls = async_capture_events(hass, EVENT_CONTROL)
    first = await action(
        hass, "shelve", {"episode_id": episode, "until": end()}, hass_admin_user.id
    )
    second = await action(hass, "shelve", {"episode_id": episode, "until": end(60)})
    await action(hass, "acknowledge", {"episode_id": episode}, hass_admin_user.id)
    await action(hass, "acknowledge", {"episode_id": episode})
    maintenance = await action(
        hass, "start_maintenance", {"node_id": NODE, "until": end(10)}
    )
    await action(
        hass,
        "cancel_control",
        {"control_id": second["control"]["control_id"]},
        hass_admin_user.id,
    )
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert [
        (fact.data["kind"], fact.data["change"], fact.data.get("ended_reason"))
        for fact in controls
    ] == [
        ("shelve", "started", None),
        ("shelve", "ended", "replaced"),
        ("shelve", "started", None),
        ("acknowledge", "started", None),
        ("maintenance", "started", None),
        ("shelve", "ended", "cancelled"),
        ("maintenance", "ended", "expired"),
    ]
    assert controls[0].context.user_id == hass_admin_user.id
    assert controls[0].data["control_id"] == first["control"]["control_id"]
    assert controls[0].data["episode_id"] == episode
    assert controls[3].data["episode_id"] == episode
    assert controls[3].context.user_id == hass_admin_user.id
    assert controls[4].data["node_id"] == NODE
    assert controls[4].data["control_id"] == maintenance["control"]["control_id"]
    assert controls[5].context.user_id == hass_admin_user.id
    assert controls[6].context.user_id is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_episode_flags_describe_controls(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """Shelving, maintenance and acknowledgment are reported, not suppressive."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes))
    await action(hass, "shelve", {"episode_id": episode, "until": end()})
    await action(hass, "acknowledge", {"episode_id": episode})
    await action(hass, "start_maintenance", {"node_id": NODE, "until": end()})
    facts = async_capture_events(hass, EVENT_EPISODE)
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert [fact.data["change"] for fact in facts] == ["resolved"]
    assert {key: facts[0].data[key] for key in ("shelved", "maintenance")} == {
        "shelved": True,
        "maintenance": True,
    }
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unsaved_facts_are_not_published(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """A fact describes saved state; a failed save publishes nothing."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    runtime = await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    with patch.object(runtime, "_save", side_effect=HomeAssistantError("disk full")):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
    assert runtime.error == "disk full"
    assert not facts
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        pytest.param(set(), {"f"}, {"f": "problem_opened"}, id="opened"),
        pytest.param({"f"}, {"f"}, {"f": "problem_changed"}, id="changed"),
        pytest.param({"f"}, set(), {"f": "problem_resolved"}, id="resolved"),
    ],
)
def test_function_changes(
    before: set[str], after: set[str], expected: dict[str, str]
) -> None:
    """Each function sees an episode enter, change within, or leave its impact."""
    fact = Fact(
        event_type=EVENT_EPISODE,
        data={},
        context=Context(),
        functions_before=frozenset(before),
        functions_after=frozenset(after),
    )
    assert fact.function_changes() == expected


async def test_startup_hold_delays_requests_not_facts(
    hass: HomeAssistant, lighting: dict[str, Any]
) -> None:
    """Owners see problems found during startup while notifications are held."""
    lighting["notifications"] = True
    slow_integration(hass, lighting)
    hass.states.async_set("sensor.observed", "unavailable")
    facts = async_capture_events(hass, EVENT_EPISODE)
    requests = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=lighting)
    runtime = await fresh_start(hass, entry)
    assert runtime.startup_quiet
    assert [fact.data["change"] for fact in facts] == ["opened"]
    assert not requests
    assert await hass.config_entries.async_unload(entry.entry_id)
