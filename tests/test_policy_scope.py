"""Policy-owned exclusions and registry-based availability eligibility."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.monitoring import parse_policies
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies


@pytest.mark.parametrize(
    "excluded",
    [
        None,
        "entity:registry:one",
        [1],
        ["monitoring:policy:one"],
        ["device:"],
        ["entry:two words"],
    ],
)
def test_exclusions_require_canonical_source_ids(excluded: object) -> None:
    """Malformed exclusions cannot become silently ineffective saved choices."""
    policy = monitoring_policy("entities", {"kind": ["entity"]})
    policy["excluded_sources"] = excluded
    with pytest.raises(ValueError, match="canonical source"):
        parse_policies([policy])


def test_exclusion_identity_and_serialization() -> None:
    """Exclusions preserve independent checks and serialize their negative scope."""
    policy = monitoring_policy("entities", {"kind": ["entity"]})
    [original] = parse_policies([policy])
    [empty] = parse_policies([{**policy, "excluded_sources": []}])
    assert empty.detection_key() == original.detection_key()
    assert empty.data() == original.data()
    [excluded] = parse_policies(
        [
            {
                **policy,
                "excluded_sources": [
                    "entity:registry:missing",
                    "entity:registry:one",
                    "entity:registry:missing",
                ],
            }
        ]
    )
    assert excluded.detection_key() == original.detection_key()
    assert excluded.data()["match"] == {"kind": ["entity"]}
    assert excluded.data()["excluded_sources"] == [
        "entity:registry:missing",
        "entity:registry:one",
    ]
    assert parse_policies([excluded.data()]) == (excluded,)


@pytest.mark.parametrize("category", [EntityCategory.DIAGNOSTIC, EntityCategory.CONFIG])
async def test_categories_require_explicit_entity_selection_and_enabled_registry(
    hass: HomeAssistant, config_data: dict[str, Any], category: EntityCategory
) -> None:
    """An exact choice opts in; disablement still removes it and survives reload."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "category")}
    )
    registry = er.async_get(hass)
    entity = registry.async_get_or_create(
        "sensor",
        "test",
        "category",
        config_entry=owner,
        device_id=device.id,
        entity_category=category,
    )
    hass.states.async_set(entity.entity_id, "unavailable")
    policies = [
        monitoring_policy("entities", {"kind": ["entity"]}),
    ]
    config_data.update(notifications=False, monitoring_policies=policies)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    canonical = f"entity:registry:{entity.id}"
    assert runtime.candidates[canonical].attributes["entity_category"] == (
        category.value,
    )
    assert not runtime.candidates[canonical].watched
    assert not runtime.candidates[f"device:{device.id}"].availability_entities
    assert not runtime.episodes

    explicit = monitoring_policy(
        "selected", {"kind": ["entity"], "entity": [f"registry:{entity.id}"]}
    )
    await reload_policies(hass, entry, [*policies, explicit])
    runtime = entry.runtime_data
    node_id = bound_identity(explicit, canonical)
    assert runtime.sources[node_id].watched
    assert len(runtime.episodes) == 1
    registry.async_update_entity(
        entity.entity_id, disabled_by=er.RegistryEntryDisabler.USER
    )
    await hass.async_block_till_done()
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert node_id not in runtime.sources
    registry.async_update_entity(entity.entity_id, disabled_by=None)
    hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.sources[node_id].watched
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_diagnostic_battery_condition_remains_available_for_selection(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Category excludes automatic availability, not an explicitly configured condition."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "battery",
        config_entry=owner,
        entity_category=EntityCategory.DIAGNOSTIC,
        original_device_class="battery",
    )
    hass.states.async_set(entity.entity_id, "5", {"unit_of_measurement": "%"})
    selected = monitoring_policy("batteries", {"kind": ["battery"]}, check="battery")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy("entities", {"kind": ["entity"]}),
            selected,
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.candidates[f"entity:registry:{entity.id}"].watched
    assert runtime.sources[
        bound_identity(selected, f"battery:registry:{entity.id}")
    ].watched
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_all_except_preserves_absent_exclusions_and_enrolls_new_entities(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An excluded source stays excluded across missing state, rename, and restart."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    excluded = registry.async_get_or_create(
        "sensor", "test", "excluded", config_entry=owner
    )
    selected = monitoring_policy("entities", {"kind": ["entity"]})
    selected["excluded_sources"] = [
        f"entity:registry:{excluded.id}",
        "entity:registry:removed",
    ]
    config_data.update(notifications=False, monitoring_policies=[selected])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.candidates[f"entity:registry:{excluded.id}"].watched
    assert not runtime.episodes
    added = registry.async_get_or_create("sensor", "test", "new", config_entry=owner)
    hass.states.async_set(added.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.sources[
        bound_identity(selected, f"entity:registry:{added.id}")
    ].watched
    assert len(runtime.episodes) == 1
    saved = deepcopy(dict(entry.data))
    registry.async_update_entity(
        excluded.entity_id, new_entity_id="sensor.renamed_excluded"
    )
    hass.states.async_set("sensor.renamed_excluded", "unavailable")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    assert not runtime.candidates[f"entity:registry:{excluded.id}"].watched
    assert dict(entry.data) == saved
    assert runtime.settings.monitoring_policies[0].match == {"kind": ("entity",)}
    assert set(runtime.settings.monitoring_policies[0].excluded_sources) == set(
        selected["excluded_sources"]
    )
    assert await hass.config_entries.async_unload(entry.entry_id)
