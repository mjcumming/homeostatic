"""Automations that name a missing entity become ordinary issues."""

from copy import deepcopy
from typing import Any

import pytest
import voluptuous as vol
from homeassistant.components.automation import (
    DATA_COMPONENT,
    EVENT_AUTOMATION_RELOADED,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.broken_automations import (
    BrokenAutomations,
    node_id,
)
from custom_components.homeostatic.config import Settings
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import start_monitor

POLICY = monitoring_policy(
    "broken_automation", {"kind": ["broken_automation"]}, check="broken_automation"
)


@pytest.fixture(autouse=True)
def monitor_source_type(config_data: dict[str, Any]) -> None:
    """Select this producer explicitly through the current policy model."""
    config_data["monitoring_policies"].append(POLICY)


DECK = {
    "alias": "Deck lights",
    "id": "deck",
    "trigger": {
        "platform": "state",
        "entity_id": ["binary_sensor.missing", "light.porch"],
    },
    "action": {
        "action": "homeassistant.turn_on",
        "target": {"entity_id": "light.missing"},
    },
}
SUN = {
    **DECK,
    "trigger": {"platform": "state", "entity_id": "sun.sun"},
    "action": {
        "action": "homeassistant.turn_on",
        "target": {"entity_id": "sun.sun"},
    },
}
TEMPLATE = {
    "alias": "Deck lights",
    "id": "deck",
    "trigger": {"platform": "event", "event_type": "test_event"},
    "action": {
        "action": "homeassistant.turn_on",
        "target": {"entity_id": "{{ 'light.missing' }}"},
    },
}


def present(hass: HomeAssistant) -> None:
    """Give the automation one entity that still exists."""
    hass.states.async_set("light.porch", "off")


def unavailable(hass: HomeAssistant) -> None:
    """A registered entity with no current value is still present."""
    present(hass)
    er.async_get(hass).async_get_or_create(
        "light", "test", "missing", suggested_object_id="missing"
    )
    er.async_get(hass).async_get_or_create(
        "binary_sensor", "test", "missing", suggested_object_id="missing"
    )
    hass.states.async_set("light.missing", "unavailable")
    hass.states.async_set("binary_sensor.missing", "unknown")


def disabled(hass: HomeAssistant) -> None:
    """A disabled registry row is still an entity."""
    present(hass)
    registry = er.async_get(hass)
    registry.async_get_or_create(
        "light",
        "test",
        "missing",
        suggested_object_id="missing",
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    registry.async_get_or_create(
        "binary_sensor",
        "test",
        "missing",
        suggested_object_id="missing",
        disabled_by=er.RegistryEntryDisabler.USER,
    )


def state_only(hass: HomeAssistant) -> None:
    """A state without a registry row, such as sun.sun, is not missing."""
    hass.states.async_set("sun.sun", "above_horizon")


def nothing(hass: HomeAssistant) -> None:
    """Leave the referenced entity id unregistered and without a state."""


async def load(
    hass: HomeAssistant, entry: MockConfigEntry, config: dict[str, Any]
) -> Any:
    """Load one automation, then start Homeostatic."""
    assert await async_setup_component(
        hass, "automation", {"automation": [deepcopy(config)]}
    )
    return await start_monitor(hass, entry)


def automation_id(hass: HomeAssistant) -> str:
    """The deck automation, apart from the test notification consumer."""
    assert hass.states.get("automation.deck_lights") is not None
    return "automation.deck_lights"


def open_for(runtime: Any, node: str) -> list[dict[str, Any]]:
    """Open issues anchored on one source."""
    return [
        row
        for row in runtime.episodes.values()
        if row["anchor"] == bound_identity(POLICY, node)
    ]


async def test_missing_entity_opens_one_issue_per_automation(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The issue uses the automation name, lists every missing id, and links to the editor."""
    present(hass)
    runtime = await load(hass, config_entry, DECK)
    entity_id = automation_id(hass)
    node = node_id(entity_id)
    source = runtime.sources[bound_identity(POLICY, node)]
    assert (source.kind, source.name, source.fix_url) == (
        "broken_automation",
        "Deck lights · broken_automation",
        "/config/automation/edit/deck",
    )
    [episode] = open_for(runtime, node)
    assert episode["reasons"][0]["message"] == (
        "This automation names binary_sensor.missing and light.missing, which no longer exist."
    )
    assert "light.porch" not in episode["reasons"][0]["message"]
    assert runtime.snapshot()["broken_automations"][node]["state"] == "active"
    assert node not in runtime.enrolled

    er.async_get(hass).async_get_or_create(
        "light", "test", "missing", suggested_object_id="missing"
    )
    er.async_get(hass).async_get_or_create(
        "binary_sensor", "test", "missing", suggested_object_id="missing"
    )
    await hass.async_block_till_done()
    assert not open_for(runtime, node)
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "cleared"

    er.async_get(hass).async_remove("light.missing")
    await hass.async_block_till_done()
    assert open_for(runtime, node)
    assert "light.missing" in open_for(runtime, node)[0]["reasons"][0]["message"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    ("prepare", "config"),
    [
        pytest.param(unavailable, DECK, id="unavailable"),
        pytest.param(disabled, DECK, id="disabled"),
        pytest.param(state_only, SUN, id="state-without-registry"),
        pytest.param(nothing, TEMPLATE, id="template"),
    ],
)
async def test_present_or_invisible_references_stay_quiet(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    prepare: Any,
    config: dict[str, Any],
) -> None:
    """Unavailable, disabled, state-only, and template-only ids do not open an issue."""
    prepare(hass)
    runtime = await load(hass, config_entry, config)
    assert not any(
        source.kind == "broken_automation" for source in runtime.sources.values()
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_rename_flags_the_old_id(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An entity-id change asks which automations still name the previous id."""
    present(hass)
    er.async_get(hass).async_get_or_create(
        "light", "test", "kitchen", suggested_object_id="kitchen"
    )
    runtime = await load(
        hass,
        config_entry,
        {
            **DECK,
            "trigger": {"platform": "state", "entity_id": "light.kitchen"},
            "action": {
                "action": "homeassistant.turn_on",
                "target": {"entity_id": "light.porch"},
            },
        },
    )
    node = node_id(automation_id(hass))
    assert bound_identity(POLICY, node) not in runtime.sources
    er.async_get(hass).async_update_entity(
        "light.kitchen", new_entity_id="light.kitchen_2"
    )
    await hass.async_block_till_done()
    assert open_for(runtime, node)
    assert "light.kitchen" in open_for(runtime, node)[0]["reasons"][0]["message"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_other_registry_updates_wait_for_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A name change does not scan, and a reload does."""
    present(hass)
    runtime = await start_monitor(hass, config_entry)
    assert await async_setup_component(
        hass, "automation", {"automation": [deepcopy(DECK)]}
    )
    await hass.async_block_till_done()
    node = node_id(automation_id(hass))
    assert bound_identity(POLICY, node) not in runtime.sources
    other = er.async_get(hass).async_get_or_create(
        "light", "test", "other", suggested_object_id="other"
    )
    er.async_get(hass).async_update_entity(other.entity_id, name="Other light")
    await hass.async_block_till_done()
    assert bound_identity(POLICY, node) not in runtime.sources
    hass.bus.async_fire(EVENT_AUTOMATION_RELOADED)
    await hass.async_block_till_done()
    assert open_for(runtime, node)
    await hass.data[DATA_COMPONENT].async_remove_entity(automation_id(hass))
    hass.bus.async_fire(EVENT_AUTOMATION_RELOADED)
    await hass.async_block_till_done()
    assert not open_for(runtime, node)
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_turning_the_check_off_ends_the_issue(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    config_data: dict[str, Any],
) -> None:
    """Disabling the named policy ends monitoring; re-enabling it detects the issue."""
    present(hass)
    runtime = await load(hass, config_entry, DECK)
    node = node_id(automation_id(hass))
    assert open_for(runtime, node)
    runtime.settings = Settings.from_data(
        {**config_data, "monitoring_policies": [{**POLICY, "enabled": False}]}
    )
    await runtime.async_refresh()
    assert bound_identity(POLICY, node) not in runtime.sources
    assert not open_for(runtime, node)
    assert runtime.broken.records[node]["state"] == "active"
    runtime.settings = Settings.from_data(
        {**config_data, "monitoring_policies": [POLICY]}
    )
    await runtime.async_refresh()
    assert open_for(runtime, node)
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def test_unloaded_component_does_not_end_a_stored_issue(hass: HomeAssistant) -> None:
    """A scan while automations are unloaded leaves existing issues alone."""
    broken = BrokenAutomations()
    key = node_id("automation.deck_lights")
    broken.restore(
        {
            key: {
                "entity_id": "automation.deck_lights",
                "name": "Deck lights",
                "missing": ["light.missing"],
                "url": "/config/automation/edit/deck",
                "state": "active",
            }
        }
    )
    assert broken.scan(hass, full=True, named=set(), created=set()) is False
    assert broken.records[key]["state"] == "active"


def test_stored_rows_are_validated() -> None:
    """A stored row has to name the automation it claims."""
    broken = BrokenAutomations()
    row = {
        "entity_id": "automation.deck_lights",
        "name": "Deck lights",
        "missing": ["light.missing"],
        "url": "/config/automation/edit/deck",
        "state": "active",
    }
    with pytest.raises(ValueError, match="Invalid stored broken automations"):
        broken.restore({"broken:wrong": row})
    with pytest.raises(vol.Invalid):
        broken.restore(
            {node_id("automation.deck_lights"): {**row, "url": "https://example.com"}}
        )
    broken.restore({node_id("automation.deck_lights"): row})
    assert broken.snapshot() == {node_id("automation.deck_lights"): row}
