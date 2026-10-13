"""Independent policy ownership through real Home Assistant lifecycle scenarios."""

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.const import DOMAIN, EVENT_EPISODE
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.monitoring_runtime import (
    assignments,
    contributing_policies,
    ordinary_sources,
)
from tests.test_battery import battery_device
from tests.test_broken_automations import DECK as BROKEN_DECK
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies
from tests.test_repairs import DECK, raise_deck_repair


def policy(
    identity: str, check: str, match: dict[str, list[str]], **changes: Any
) -> dict[str, Any]:
    """Build one dashboard-only independently owned monitoring expectation."""
    return {
        "id": identity,
        "name": identity,
        "check": check,
        "match": match,
        "enabled": True,
        "parameters": {},
        "notifications": [],
        **changes,
    }


def entry_for(
    config_data: dict[str, Any], policies: list[dict[str, Any]]
) -> MockConfigEntry:
    """Use the unified schema without converting an older test entry."""
    return MockConfigEntry(
        domain=DOMAIN,
        version=1,
        data={
            **config_data,
            "entities": [],
            "notifications": False,
            "rules": [],
            "monitoring_policy_version": 1,
            "monitoring_policies": policies,
        },
    )


@pytest.mark.parametrize(
    "threshold",
    [
        pytest.param(-1, id="negative"),
        pytest.param(101, id="over-percent"),
        pytest.param(True, id="boolean"),
        pytest.param(float("nan"), id="nan"),
        pytest.param("20", id="text"),
    ],
)
def test_battery_threshold_rejects_invalid_values(threshold: Any) -> None:
    """Invalid thresholds cannot enter a policy or its detection identity."""
    with pytest.raises(ValueError, match="Battery threshold"):
        parse_policies(
            [policy("battery", "battery", {}, parameters={"threshold": threshold})]
        )


def test_availability_clones_keep_upstream_dependencies_and_policy_ownership() -> None:
    """Independent source findings still point to the actual upstream expectations."""
    policies = parse_policies(
        [
            policy("integrations", "availability", {"kind": ["integration"]}),
            policy("entities", "availability", {"kind": ["entity"]}),
            policy("other_entities", "availability", {"kind": ["entity"]}),
        ]
    )
    integration = Source(
        node_id="entry:one",
        name="Owner",
        kind="integration",
        entry_id="one",
        attributes={"kind": ("integration",)},
    )
    entity = Source(
        node_id="entity:registry:one",
        name="Sensor",
        kind="entity",
        entity_id="sensor.one",
        owner_id="one",
        attributes={"kind": ("entity",)},
    )
    sources = ordinary_sources(
        policies, {source.node_id: source for source in (integration, entity)}
    )
    [parent] = [
        source
        for source in sources.values()
        if source.monitoring_policy == "integrations"
    ]
    children = [
        source
        for source in sources.values()
        if source.monitoring_source == entity.node_id
    ]
    assert len(children) == 2
    assert all(source.requirements == (parent.node_id,) for source in children)
    assert not sources[integration.node_id].watched
    assert not sources[entity.node_id].watched
    assert set(assignments(policies, sources)) == {
        parent.node_id,
        *(source.node_id for source in children),
    }
    assert [
        item.id for item in contributing_policies(policies, integration, sources)
    ] == ["integrations"]


async def test_independent_battery_thresholds_unknowns_removal_and_restart(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Overlapping policies qualify independently and removal is never recovery."""
    level, warning, charging, registry = await battery_device(hass)
    hass.states.async_set(level, "25", {"unit_of_measurement": "%"})
    hass.states.async_set(warning, "off")
    hass.states.async_set(charging, "off")
    low = policy(
        "low",
        "battery",
        {"entity": [f"registry:{registry}"]},
        parameters={"threshold": 20},
    )
    early = policy(
        "early",
        "battery",
        {"entity": [f"registry:{registry}"]},
        parameters={"threshold": 30},
    )
    entry = entry_for(config_data, [low, early])
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    assert {
        runtime.sources[str(item["anchor"])].monitoring_policy
        for item in runtime.episodes.values()
    } == {"early"}
    hass.states.async_set(level, "15", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    before = set(runtime.episodes)
    hass.states.async_set(level, "unknown", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert set(runtime.episodes) == before
    await reload_policies(hass, entry, [early])
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    assert set(runtime.episodes) < before
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    hass.states.async_set(charging, "on")
    await hass.async_block_till_done()
    assert not runtime.episodes
    await reload_policies(hass, entry, [])
    runtime = entry.runtime_data
    hass.states.async_set(charging, "off")
    hass.states.async_set(level, "1", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert not any(source.watched for source in runtime.sources.values())


async def test_repair_policies_are_independent_and_observed_recovery_uses_original_record(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Deleting one policy leaves another Repair issue until HA clears its record."""
    first = policy("repairs", "repair", {"kind": ["repair"]})
    second = policy("other_repairs", "repair", {"kind": ["repair"]})
    entry = entry_for(config_data, [first, second])
    runtime = await start_monitor(hass, entry)
    raise_deck_repair(hass)
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    await reload_policies(hass, entry, [second])
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    ir.async_delete_issue(hass, "automation", DECK)
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "cleared"
    await runtime.async_refresh()
    assert not runtime.repairs.records


async def test_entity_and_integration_policies_keep_dependency_correlation(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """The engine groups dependent failures and entry events update every policy."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.SETUP_ERROR)
    owner.add_to_hass(hass)
    sensor = er.async_get(hass).async_get_or_create(
        "sensor", "test", "observed", config_entry=owner
    )
    hass.states.async_set(sensor.entity_id, "unavailable")
    policies = [
        policy(
            "owner",
            "availability",
            {"kind": ["integration"], "integration": [owner.entry_id]},
        ),
        policy(
            "sensor",
            "availability",
            {"kind": ["entity"], "entity": [f"registry:{sensor.id}"]},
        ),
    ]
    entry = entry_for(config_data, policies)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    [episode] = runtime.episodes.values()
    assert runtime.sources[str(episode["anchor"])].monitoring_policy == "owner"
    owner._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    [episode] = runtime.episodes.values()
    assert runtime.sources[str(episode["anchor"])].monitoring_policy == "sensor"
    hass.states.async_set(sensor.entity_id, "1")
    await hass.async_block_till_done()
    assert not runtime.episodes


async def test_device_policy_observes_members_and_survives_restart(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Policy-owned device identities retain their actual HA evidence members."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "room")}
    )
    sensor = er.async_get(hass).async_get_or_create(
        "sensor", "test", "room", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(sensor.entity_id, "unavailable")
    selected = policy(
        "device", "availability", {"kind": ["device"], "device": [device.id]}
    )
    entry = entry_for(config_data, [selected])
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    hass.states.async_set(sensor.entity_id, "1")
    await hass.async_block_till_done()
    assert not runtime.episodes


async def test_broken_automation_has_no_hidden_owner_after_policy_deletion(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Removing the ordinary policy stops monitoring without clearing the HA fault."""
    assert await async_setup_component(
        hass, "automation", {"automation": [BROKEN_DECK]}
    )
    selected = policy("broken", "broken_automation", {"kind": ["broken_automation"]})
    entry = entry_for(config_data, [selected])
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    await reload_policies(hass, entry, [])
    runtime = entry.runtime_data
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert runtime.broken.records
    assert not any(
        source.kind == "broken_automation" for source in runtime.sources.values()
    )


@pytest.mark.parametrize(
    "field", [pytest.param("area", id="areas"), pytest.param("label", id="labels")]
)
def test_multiple_group_selections_match_any_selected_member(field: str) -> None:
    """One policy accepts either selected group and never duplicates a source."""
    policies = parse_policies(
        [policy("battery", "battery", {field: ["kitchen", "garage"]})]
    )
    candidates = {
        identity: Source(
            node_id=identity,
            name=identity,
            kind="battery",
            check_id="battery",
            attributes={"kind": ("battery",), field: groups},
        )
        for identity, groups in (
            ("first", ("kitchen",)),
            ("second", ("garage",)),
            ("both", ("kitchen", "garage")),
            ("other", ("bedroom",)),
        )
    }
    sources = ordinary_sources(policies, candidates)
    assert {source.monitoring_source for source in sources.values()} == {
        "first",
        "second",
        "both",
    }


async def test_catalog_reports_enabled_policy_enrollment(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """The Sources catalog reports actual policy enrollment before and after deletion."""
    hass.states.async_set("sensor.policy_catalog", "42")
    selected = policy(
        "entities", "availability", {"entity": ["entity_id:sensor.policy_catalog"]}
    )
    entry = entry_for(config_data, [selected])
    runtime = await start_monitor(hass, entry)
    [source] = [
        row
        for row in runtime.inventory_static["catalog"]["candidates"]
        if row["entity_id"] == "sensor.policy_catalog"
    ]
    assert source["watched"] is True
    assert source["attached_by"] == ["policy_entities"]
    await reload_policies(hass, entry, [])
    runtime = entry.runtime_data
    [source] = [
        row
        for row in runtime.inventory_static["catalog"]["candidates"]
        if row["entity_id"] == "sensor.policy_catalog"
    ]
    assert source["watched"] is False


@pytest.mark.parametrize(
    "from_policy",
    [
        pytest.param(False, id="catalog-source"),
        pytest.param(True, id="policy-condition"),
    ],
)
async def test_equipment_maintenance_covers_all_policy_conditions(
    hass: HomeAssistant, config_data: dict[str, Any], from_policy: bool
) -> None:
    """Maintenance covers equipment's independent policies across restart and cancellation."""
    hass.states.async_set("sensor.maintained", "1")
    policies = [
        policy(identity, "availability", {"entity": ["entity_id:sensor.maintained"]})
        for identity in ("first", "second")
    ]
    entry = entry_for(config_data, policies)
    runtime = await start_monitor(hass, entry)
    target = "entity:entity_id:sensor.maintained"
    policy_sources = [
        source.node_id
        for source in runtime.sources.values()
        if source.monitoring_policy is not None
    ]
    selected = (target, policy_sources[0])[from_policy]
    preview = await action(
        hass, "preview_maintenance", {"node_id": selected, "until": end()}
    )
    assert set(policy_sources) <= set(preview["node_ids"])
    result = await action(
        hass, "start_maintenance", {"node_id": selected, "until": end()}
    )
    hass.states.async_set("sensor.maintained", "unavailable")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.episodes
    changed = [
        {**item, "match": {**item["match"], "kind": ["entity"]}} for item in policies
    ]
    await reload_policies(hass, entry, changed)
    runtime = entry.runtime_data
    assert not runtime.episodes
    assert not set(policy_sources).intersection(runtime.sources)
    await action(
        hass, "cancel_control", {"control_id": result["control"]["control_id"]}
    )
    assert len(runtime.episodes) == 2


async def test_episode_fact_marks_maintenance_on_policy_condition(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An existing policy issue reports equipment maintenance when it recovers."""
    hass.states.async_set("sensor.maintained_fact", "unavailable")
    selected = policy(
        "entity", "availability", {"entity": ["entity_id:sensor.maintained_fact"]}
    )
    entry = entry_for(config_data, [selected])
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    await action(
        hass,
        "start_maintenance",
        {"node_id": "entity:entity_id:sensor.maintained_fact", "until": end()},
    )
    facts = async_capture_events(hass, EVENT_EPISODE)
    hass.states.async_set("sensor.maintained_fact", "1")
    await hass.async_block_till_done()
    assert [fact.data["change"] for fact in facts] == ["resolved"]
    assert facts[0].data["maintenance"] is True
