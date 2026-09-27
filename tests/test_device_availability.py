"""One HA device check summarizes entity availability without a hardware claim."""

from datetime import UTC, datetime
from typing import Any

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.catalog import Source, device_observation
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import (
    device_members,
    restore_device_exclusions,
)
from custom_components.homeostatic.rules import parse_rules
from tests.test_controls import action
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("states", "status", "reason"),
    [
        pytest.param(
            (State("sensor.a", "off"), State("sensor.b", "unknown")),
            Status.UNKNOWN,
            "incomplete_evidence",
            id="usable-with-unknown",
        ),
        pytest.param(
            (State("sensor.a", "unavailable"), State("sensor.b", "unknown")),
            Status.WARN,
            "some_unavailable",
            id="no-usable-evidence",
        ),
        pytest.param(
            (
                State("sensor.a", "off", {"restored": True}),
                State("sensor.b", "unavailable"),
            ),
            Status.WARN,
            "some_unavailable",
            id="restored-is-not-recovery",
        ),
    ],
)
def test_generic_summary_reports_selected_availability_expectations(
    states: tuple[State, ...],
    status: Status,
    reason: str,
) -> None:
    """Missing or unavailable selected evidence cannot be assumed harmless."""
    observation = device_observation(
        Source(node_id="device:generic", name="Generic", kind="device"),
        states,
        datetime(2026, 9, 26, tzinfo=UTC),
    )
    assert observation.status == status
    assert observation.reason == reason


def test_existing_broad_rules_do_not_enroll_device_summaries() -> None:
    """A new source kind requires an explicit choice in saved rules."""
    device = {"kind": ("device",), "device": ("bridge",)}
    legacy = parse_rules(
        [{"id": "legacy", "action": "attach", "match": {"device": "bridge"}}]
    )
    broad = parse_rules([{"id": "broad", "action": "attach", "match": {}}])
    selected = parse_rules(
        [
            {
                "id": "device_summary",
                "action": "attach",
                "match": {"kind": "device", "device": "bridge"},
            }
        ]
    )
    assert not legacy[0].matches(device)
    assert not broad[0].matches(device)
    assert selected[0].matches(device)


async def test_device_summary_tracks_partial_total_unknown_and_recovery(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """One watched device retains one episode across an OmniLink-sized outage."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "bridge")},
        name="Test bridge",
    )
    registry = er.async_get(hass)
    entities = []
    for index in range(41):
        entity = registry.async_get_or_create(
            "binary_sensor",
            "test",
            f"zone_{index}",
            config_entry=owner,
            device_id=device.id,
        )
        entities.append(entity.entity_id)
        hass.states.async_set(entity.entity_id, "off")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[
            {"id": "devices", "action": "attach", "match": {"kind": "device"}},
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert [
        source.node_id for source in runtime.sources.values() if source.watched
    ] == [node_id]
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes

    hass.states.async_set(entities[0], "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    assert len(runtime.episodes) == 1
    partial_episode_id = next(iter(runtime.episodes))

    for entity_id in entities[1:]:
        hass.states.async_set(entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    assert len(runtime.episodes) == 1
    episode_id = next(iter(runtime.episodes))
    assert episode_id == partial_episode_id
    assert runtime.episodes[episode_id]["reasons"][0]["reason"] == "all_unavailable"

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine is not None

    for entity_id in entities:
        hass.states.async_set(entity_id, "unknown")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "unknown"
    assert list(runtime.episodes) == [episode_id]

    for entity_id in entities:
        hass.states.async_set(entity_id, "off")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("platform", ["wiim", "test"])
async def test_persistent_ignore_changes_expectation_without_claiming_recovery(
    hass: HomeAssistant, config_data: dict[str, Any], platform: str
) -> None:
    """Explicit exclusions survive renames/reloads and keep real outages visible."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={(platform, "outdoor")}
    )
    registry = er.async_get(hass)
    primary = registry.async_get_or_create(
        "media_player", platform, "outdoor", config_entry=owner, device_id=device.id
    )
    group = registry.async_get_or_create(
        "media_player",
        platform,
        "outdoor_group_master",
        config_entry=owner,
        device_id=device.id,
        original_name="Optional group",
    )
    diagnostic = registry.async_get_or_create(
        "sensor",
        platform,
        "status",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    hass.states.async_set(primary.entity_id, "off")
    hass.states.async_set(group.entity_id, "unavailable")
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    rules = [{"id": "devices", "action": "attach", "match": {"kind": "device"}}]
    config_data.update(entities=[], config_entries=[], notifications=False, rules=rules)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    episode_id = next(iter(runtime.episodes))
    evidence = runtime.device_evidence(node_id)
    assert evidence is not None
    assert evidence["total"] == 2
    assert evidence["members"][0]["entity_id"] == group.entity_id
    assert evidence["members"][0]["state"] == "unavailable"
    excluded = [
        *rules,
        {
            "id": "optional",
            "action": "exclude",
            "match": {"entity": f"registry:{group.id}"},
        },
    ]
    preview = await action(hass, "preview_rules", {"rules": excluded})
    candidate = next(
        item for item in preview["candidates"] if item["node_id"] == node_id
    )
    assert candidate["availability_entities"] == [primary.entity_id]
    assert list(runtime.episodes) == [episode_id]
    hass.config_entries.async_update_entry(
        entry, options={**config_data, "rules": excluded}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes
    history = await action(hass, "resolved_history", {})
    assert history["episodes"][0]["episode"]["episode_id"] == episode_id
    assert history["episodes"][0]["resolution"] == "removed"
    assert hass.states.get(group.entity_id).state == "unavailable"

    renamed = registry.async_update_entity(
        group.entity_id, new_entity_id="media_player.renamed_group"
    )
    hass.states.async_set(renamed.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.sources[node_id].availability_entities == (primary.entity_id,)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.episodes
    assert runtime.sources[node_id].ignored_availability == (
        f"entity:registry:{group.id}",
    )
    hass.states.async_set(primary.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    outage_id = next(iter(runtime.episodes))
    assert outage_id != episode_id

    runtime.settings = Settings.from_data(
        {
            **config_data,
            "rules": [
                *excluded,
                {
                    "id": "primary",
                    "action": "exclude",
                    "match": {"entity": f"registry:{primary.id}"},
                },
            ],
        }
    )
    await runtime.async_refresh()
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert not runtime.candidates[node_id].availability_entities
    assert not runtime.candidates[node_id].watched
    history = await action(hass, "resolved_history", {})
    assert history["episodes"][0]["resolution"] == "removed"
    assert runtime.readiness == "unknown"

    runtime.settings = Settings.from_data(config_data)
    await runtime.async_refresh()
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    assert runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "value", [None, [], {1: []}, {"entity:x": []}, {"device:x": "x"}, {"device:x": [1]}]
)
def test_invalid_persisted_exclusions_are_rejected(value: Any) -> None:
    """Corrupt scope history cannot silently become a recovery decision."""
    with pytest.raises(ValueError, match="Invalid stored device exclusions"):
        restore_device_exclusions(value)


async def test_device_summary_uses_operational_entities_before_diagnostics(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An optional diagnostic cannot fail a device with usable main evidence."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "one")},
    )
    registry = er.async_get(hass)
    ordinary = registry.async_get_or_create(
        "switch", "test", "power", config_entry=owner, device_id=device.id
    )
    diagnostic = registry.async_get_or_create(
        "sensor",
        "test",
        "voltage",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    configuration = registry.async_get_or_create(
        "number",
        "test",
        "level",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.CONFIG,
    )
    hass.states.async_set(ordinary.entity_id, "on")
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    hass.states.async_set(configuration.entity_id, "unavailable")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[
            {"id": "devices", "action": "attach", "match": {"kind": "device"}},
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.engine is not None
    assert runtime.engine.readiness([f"device:{device.id}"]).answer == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_rule_tracks_hidden_entities_but_not_disabled_devices(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Hidden evidence remains usable; disabling a device ends its check."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "hidden")}
    )
    registry = er.async_get(hass)
    hidden = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "hidden",
        config_entry=owner,
        device_id=device.id,
        hidden_by=er.RegistryEntryHider.USER,
    )
    disabled = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "disabled",
        config_entry=owner,
        device_id=device.id,
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    hass.states.async_set(hidden.entity_id, "unavailable")
    hass.states.async_set(disabled.entity_id, "off")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[{"id": "devices", "action": "attach", "match": {"kind": "device"}}],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert device_members(hass)[device.id] == (hidden.entity_id,)
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    assert runtime.episodes

    devices.async_update_device(device.id, disabled_by=dr.DeviceEntryDisabler.USER)
    await hass.async_block_till_done()
    assert device.id not in device_members(hass)
    assert node_id not in runtime.sources
    assert not runtime.episodes

    devices.async_update_device(device.id, disabled_by=None)
    await hass.async_block_till_done()
    assert device_members(hass)[device.id] == (hidden.entity_id,)
    assert runtime.sources[node_id].watched
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_summary_falls_back_to_diagnostic_evidence(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A device with no operational entity can still report an HA outage."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "diagnostic_only")},
    )
    diagnostic = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "connection",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    config_data.update(
        entities=[],
        config_entries=[],
        notifications=False,
        rules=[{"id": "devices", "action": "attach", "match": {"kind": "device"}}],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"device:{device.id}"
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "blocked"
    assert len(runtime.episodes) == 1
    hass.states.async_set(diagnostic.entity_id, "ok")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
