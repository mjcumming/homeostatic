"""Editable metadata availability scopes and independent causal-issue routes."""

from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from health_tree.policy import Policy
from health_tree.types import PolicyContext
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import changed_exclusions
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.monitoring_runtime import enrollment_rules
from custom_components.homeostatic.notification_definitions import defaults, generate
from custom_components.homeostatic.policy_defaults import initial_settings
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies
from tests.test_notification_definitions import problem


def entity_defaults() -> list[dict[str, Any]]:
    """Read ordinary editable entity policy records from fresh setup."""
    return [
        row
        for row in initial_settings("UTC")["monitoring_policies"]
        if row["match"] == {"kind": ["entity"]}
    ]


@pytest.mark.parametrize(
    ("domain", "device_class", "important"),
    [
        ("camera", "", True),
        ("lock", "", True),
        ("alarm_control_panel", "", True),
        ("binary_sensor", "smoke", True),
        ("binary_sensor", "carbon_monoxide", True),
        ("binary_sensor", "gas", True),
        ("binary_sensor", "moisture", True),
        ("binary_sensor", "door", False),
        ("binary_sensor", "window", False),
        ("binary_sensor", "motion", False),
        ("binary_sensor", "occupancy", False),
        ("sensor", "temperature", False),
        ("sensor", "gas", False),
        ("light", "", False),
    ],
)
def test_initial_metadata_union_and_complement(
    domain: str, device_class: str, important: bool
) -> None:
    """Every operational entity belongs to exactly one editable starting scope."""
    general, equipment = parse_policies(entity_defaults())
    metadata = {"kind": ("entity",), "domain": (domain,)}
    if device_class:
        metadata["device_class"] = (device_class,)
    assert equipment.matches(metadata) is important
    assert general.matches(metadata) is not important
    assert general.notifications[0]["profile"] == "morning"
    assert equipment.notifications[0]["profile"] == "immediate"
    for category in ("diagnostic", "config"):
        categorized = {**metadata, "entity_category": (category,)}
        assert not general.matches(categorized)
        assert not equipment.matches(categorized)
    assert parse_policies([general.data(), equipment.data()]) == (general, equipment)


@pytest.mark.parametrize("field", ["match_any", "match_none"])
@pytest.mark.parametrize(
    "value",
    [None, {}, [], [{}], [{"domain": []}], ["camera"], [{"area": ["kitchen"]}]],
)
def test_invalid_metadata_alternatives_cannot_broaden_scope(
    field: str, value: Any
) -> None:
    """Empty or malformed expressions fail instead of enrolling all entities."""
    row = monitoring_policy("chosen", {"kind": ["entity"]})
    row[field] = value
    with pytest.raises(ValueError):
        parse_policies([row])


def test_metadata_alternatives_have_one_editable_entity_availability_mode() -> None:
    """The public model accepts exactly the metadata scopes the entity editor owns."""
    general, important = entity_defaults()
    with pytest.raises(ValueError, match="matching entity types or excluded"):
        parse_policies([{**general, "match_any": important["match_any"]}])
    with pytest.raises(ValueError, match="entity availability"):
        parse_policies([{**important, "match": {"kind": ["device"]}}])


def test_selection_edits_invalidate_cached_enrollment_and_detection() -> None:
    """Metadata selector edits re-evaluate scopes while simple exclusions stay local."""
    before = parse_policies(entity_defaults())
    draft = deepcopy([row.data() for row in before])
    draft[1]["match_any"] = [{"domain": ["camera"]}]
    after = parse_policies(draft)
    assert before[1].detection_key() != after[1].detection_key()
    assert before[0] == after[0]
    assert changed_exclusions(enrollment_rules(before), enrollment_rules(after)) is None


async def test_future_metadata_changes_and_editable_gaps_survive_reload(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Registry changes follow saved expressions; one policy never edits its peer."""
    rows = entity_defaults()
    data = {**config_data, "notifications": False, "monitoring_policies": rows}
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    registry = er.async_get(hass)
    camera = registry.async_get_or_create("camera", "test", "porch")
    diagnostic = registry.async_get_or_create(
        "camera", "test", "diagnostic", entity_category=EntityCategory.DIAGNOSTIC
    )
    disabled = registry.async_get_or_create(
        "lock", "test", "disabled", disabled_by=er.RegistryEntryDisabler.USER
    )
    hass.states.async_set(camera.entity_id, "idle")
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    hass.states.async_set(disabled.entity_id, "unavailable")
    runtime = await start_monitor(hass, entry)

    def owners(entity: er.RegistryEntry) -> set[str | None]:
        return {
            source.monitoring_policy
            for source in runtime.sources.values()
            if source.entity_id == entity.entity_id and source.watched
        }

    assert owners(camera) == {"default_important_equipment"}
    assert owners(diagnostic) == owners(disabled) == set()
    added = registry.async_get_or_create(
        "binary_sensor", "test", "new", original_device_class="door"
    )
    hass.states.async_set(added.entity_id, "off")
    await hass.async_block_till_done()
    assert owners(added) == {"default_entities"}
    registry.async_update_entity(added.entity_id, device_class="moisture")
    await hass.async_block_till_done()
    assert owners(added) == {"default_important_equipment"}
    hass.states.async_set(added.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    rows[1]["match_any"] = [{"domain": ["camera"]}]
    await reload_policies(hass, entry, rows)
    runtime = entry.runtime_data
    assert not owners(added)
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not owners(added)
    assert runtime.settings.monitoring_policies[0] == parse_policies([rows[0]])[0]
    rows[0].pop("match_none")
    await reload_policies(hass, entry, rows)
    runtime = entry.runtime_data
    assert owners(camera) == {"default_entities", "default_important_equipment"}
    assert owners(added) == {"default_entities"}
    assert bound_identity(rows[0], f"entity:registry:{added.id}") in runtime.sources
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("reverse", [False, True])
def test_affected_availability_assignments_keep_independent_schedules(
    reverse: bool,
) -> None:
    """The same integration issue requests equipment now and integration at morning."""
    now = datetime(2026, 10, 18, 1, tzinfo=UTC)
    definitions = defaults("UTC")
    definitions["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:test"]}
    }
    for profile in ("immediate", "morning"):
        definitions["profiles"][profile]["methods"] = ["phone"]
    scopes = [
        ("integration", "morning"),
        ("lock", "immediate"),
    ]
    definitions["assignments"] = {
        node: {
            "default": [],
            "checks": {"availability": [{"id": node, "profile": profile}]},
        }
        for node, profile in (reversed(scopes) if reverse else scopes)
    }
    compiled = generate(definitions)
    policy = Policy(build_policy(compiled, timedelta(0)))
    opened = problem(now, node="integration")
    opened = replace(
        opened,
        episode=replace(opened.episode, impact=frozenset({"integration", "lock"})),
    )
    assert {
        message.route for message in policy.handle(opened, now, PolicyContext())
    } == {"lock"}
    assert {
        message.route
        for message in policy.advance(now.replace(hour=8), PolicyContext())
    } == {"integration"}
    unrelated = Policy(build_policy(compiled, timedelta(0)))
    battery = problem(now, node="lock", check="battery")
    assert unrelated.handle(battery, now, PolicyContext()) == []
    assert unrelated.advance(now.replace(hour=8), PolicyContext()) == []
