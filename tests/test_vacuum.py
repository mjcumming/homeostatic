"""Vacuum error scenarios over real HA registries and runtime events."""

from typing import Any

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import evaluate, inventory
from custom_components.homeostatic.rules import DEFAULT_RULES, parse_rules
from custom_components.homeostatic.vacuum import observe
from tests.test_lifecycle import start_monitor


def vacuum_rules() -> list[dict[str, Any]]:
    """Select discovered vacuum errors independently of availability."""
    return [
        *DEFAULT_RULES,
        {
            "id": "vacuum_error",
            "action": "attach",
            "match": {"kind": "vacuum"},
            "checks": ["vacuum"],
        },
    ]


def vacuum_source(area_id: str | None, *, disabled: bool = False) -> Source:
    """Build the candidate shape discovery would offer for one vacuum."""
    attributes: dict[str, tuple[str, ...]] = {
        "kind": ("vacuum",),
        "entity": ("registry:robot",),
        "domain": ("vacuum",),
    }
    if area_id is not None:
        attributes["area"] = (area_id,)
    return Source(
        node_id="vacuum:registry:robot",
        name="Downstairs robot",
        kind="vacuum",
        entity_id="vacuum.robot",
        disabled=disabled,
        attributes=attributes,
        check_id="vacuum",
        watched=False,
    )


@pytest.mark.parametrize(
    ("state", "restored", "disabled", "reason", "status"),
    [
        pytest.param("error", False, False, "vacuum_error", Status.FAIL, id="error"),
        pytest.param("cleaning", False, False, "cleaning", Status.PASS, id="cleaning"),
        pytest.param("docked", False, False, "docked", Status.PASS, id="docked"),
        pytest.param("idle", False, False, "idle", Status.PASS, id="idle"),
        pytest.param("paused", False, False, "paused", Status.PASS, id="paused"),
        pytest.param(
            "returning", False, False, "returning", Status.PASS, id="returning"
        ),
        pytest.param(
            STATE_UNKNOWN, False, False, "vacuum_unknown", Status.UNKNOWN, id="unknown"
        ),
        pytest.param(
            STATE_UNAVAILABLE,
            False,
            False,
            "vacuum_unknown",
            Status.UNKNOWN,
            id="unavailable",
        ),
        pytest.param(
            None, False, False, "vacuum_unknown", Status.UNKNOWN, id="missing"
        ),
        pytest.param(
            "error", True, False, "vacuum_unknown", Status.UNKNOWN, id="restored"
        ),
        pytest.param(
            "stuck", False, False, "vacuum_unknown", Status.UNKNOWN, id="other"
        ),
        pytest.param("error", False, True, "disabled", Status.UNKNOWN, id="disabled"),
    ],
)
async def test_vacuum_activity_scenarios(
    hass: HomeAssistant,
    state: str | None,
    restored: bool,
    disabled: bool,
    reason: str,
    status: Status,
) -> None:
    """Error fails, the five working activities pass, and anything else is unknown."""
    area = ar.async_get(hass).async_create("Kitchen")
    if state is not None:
        hass.states.async_set(
            "vacuum.robot", state, {"restored": True} if restored else {}
        )
    observation = observe(
        hass, vacuum_source(area.id, disabled=disabled), dt_util.utcnow()
    )
    assert observation.status is status
    assert observation.reason == reason
    assert observation.check_id == "vacuum"
    assert observation.evidence["physical_freshness_verified"] is False
    assert observation.evidence["area"] == "Kitchen"
    if reason == "vacuum_error":
        assert (
            observation.message
            == "Home Assistant reports Downstairs robot in error in Kitchen."
        )
    elif status is Status.PASS:
        assert observation.message == f"Downstairs robot is {state}."
    elif reason == "disabled":
        assert observation.message == "Downstairs robot is disabled in Home Assistant."
    else:
        assert (
            observation.message
            == "Home Assistant has no current activity for Downstairs robot."
        )


async def test_missing_area_is_omitted(hass: HomeAssistant) -> None:
    """A stale or absent area id is left out of the finding."""
    hass.states.async_set("vacuum.robot", "error")
    missing = observe(hass, vacuum_source("gone"), dt_util.utcnow())
    assert missing.evidence["area"] is None
    assert missing.message == "Home Assistant reports Downstairs robot in error."
    unassigned = observe(hass, vacuum_source(None), dt_util.utcnow())
    assert unassigned.message == "Home Assistant reports Downstairs robot in error."


async def test_default_rules_list_a_vacuum_without_watching_it(
    hass: HomeAssistant,
) -> None:
    """Discovery offers the vacuum, and availability rules leave it alone."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    area = ar.async_get(hass).async_create("Kitchen")
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "robot")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "vacuum",
        "test",
        "robot",
        config_entry=owner,
        device_id=device.id,
        original_name="Downstairs robot",
    )
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=area.id)
    hass.states.async_set(
        entity.entity_id, "error", {"friendly_name": "Downstairs robot"}
    )
    discovered = inventory(hass, Settings.from_data({"rules": DEFAULT_RULES}), {})
    vacuum_id = f"vacuum:registry:{entity.id}"
    vacuum = discovered[vacuum_id]
    entity_source = discovered[f"entity:registry:{entity.id}"]
    assert vacuum.kind == "vacuum"
    assert vacuum.check_id == "vacuum"
    assert vacuum.entity_id == entity.entity_id
    assert not evaluate(discovered, parse_rules(DEFAULT_RULES))[vacuum_id].watched
    assert not evaluate(discovered, parse_rules(DEFAULT_RULES))[
        entity_source.node_id
    ].watched
    selected = evaluate(discovered, parse_rules(vacuum_rules()))
    assert selected[vacuum_id].watched
    assert not selected[entity_source.node_id].watched
    assert vacuum.node(Settings.from_data({})).depends_on == ()


async def test_vacuum_error_opens_clears_and_survives_an_integration_failure(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """The issue follows the activity and stays separate from the integration."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    area = ar.async_get(hass).async_create("Kitchen")
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "robot")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "vacuum",
        "test",
        "robot",
        config_entry=owner,
        device_id=device.id,
        original_name="Downstairs robot",
    )
    er.async_get(hass).async_update_entity(entity.entity_id, area_id=area.id)
    hass.states.async_set(
        entity.entity_id, "docked", {"friendly_name": "Downstairs robot"}
    )
    config_data.update(entities=[], notifications=False, rules=vacuum_rules())
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    vacuum_id = f"vacuum:registry:{entity.id}"
    assert runtime.sources[vacuum_id].watched
    assert runtime.sources[vacuum_id].node(runtime.settings).depends_on == ()
    assert not runtime.episodes

    hass.states.async_set(
        entity.entity_id,
        "error",
        {"friendly_name": "Downstairs robot", "restored": True},
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    hass.states.async_set(
        entity.entity_id, "error", {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    [episode] = runtime.episodes.values()
    assert episode["anchor"] == vacuum_id
    assert "in Kitchen" in str(episode["reasons"][0]["message"])

    hass.states.async_set(
        entity.entity_id, "docked", {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes

    hass.states.async_set(
        entity.entity_id, "error", {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    assert {item["anchor"] for item in runtime.episodes.values()} == {vacuum_id}
    hass.states.async_set(
        entity.entity_id, STATE_UNAVAILABLE, {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    assert {item["anchor"] for item in runtime.episodes.values()} == {vacuum_id}
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert {item["anchor"] for item in runtime.episodes.values()} == {vacuum_id}

    hass.states.async_set(
        entity.entity_id, "stuck", {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    assert {item["anchor"] for item in runtime.episodes.values()} == {vacuum_id}
    hass.states.async_set(
        entity.entity_id, "cleaning", {"friendly_name": "Downstairs robot"}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes

    hass.states.async_set(
        entity.entity_id, "error", {"friendly_name": "Downstairs robot"}
    )
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "connection lost")
    await hass.async_block_till_done()
    assert {item["anchor"] for item in runtime.episodes.values()} == {
        vacuum_id,
        f"entry:{owner.entry_id}",
    }
    assert await hass.config_entries.async_unload(entry.entry_id)
