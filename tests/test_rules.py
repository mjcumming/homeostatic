"""Current policy catalog identity, scope, and retirement scenarios."""

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import Settings, entity_reference
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import inventory, restore_enrollment
from custom_components.homeostatic.rules import CatalogRule, attributes
from tests.policy_helpers import bound_identity, current_config, monitoring_policy
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    "value", [[], {"bad": {}}, {"entry:x": {"typo": "x"}}, {"entry:x": {"domain": []}}]
)
def test_invalid_enrollment_snapshot(value: Any) -> None:
    """Corrupt retained identities fail visibly before restoration."""
    with pytest.raises(ValueError):
        restore_enrollment(value)


async def test_stable_registry_match_fields(hass: HomeAssistant) -> None:
    """Entity area overrides device area; labels inherit without dependency edges."""
    entry = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    entry.add_to_hass(hass)
    floor = fr.async_get(hass).async_create("Ground")
    area = ar.async_get(hass).async_create("Garage")
    ar.async_get(hass).async_update(
        area.id, floor_id=floor.floor_id, labels={"area_label"}
    )
    other = ar.async_get(hass).async_create("Kitchen")
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", "device")}
    )
    dr.async_get(hass).async_update_device(
        device.id, area_id=area.id, labels={"device_label"}
    )
    entity = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "temperature",
        config_entry=entry,
        device_id=device.id,
        original_device_class="temperature",
    )
    er.async_get(hass).async_update_entity(entity.entity_id, labels={"entity_label"})
    node_id = f"entity:registry:{entity.id}"
    sources = inventory(hass, Settings.from_data(current_config()), {})
    metadata = sources[node_id].attributes
    assert metadata == {
        "kind": ("entity",),
        "entity": (f"registry:{entity.id}",),
        "domain": ("sensor",),
        "device_class": ("temperature",),
        "integration": (entry.entry_id,),
        "integration_domain": ("test",),
        "device": (device.id,),
        "area": (area.id,),
        "floor": (floor.floor_id,),
        "label": ("area_label", "device_label", "entity_label"),
    }
    assert CatalogRule(id="all_fields", match=metadata).matches(metadata)
    er.async_get(hass).async_update_entity(
        entity.entity_id,
        area_id=other.id,
        device_class="humidity",
        new_entity_id="sensor.renamed",
    )
    updated = inventory(hass, Settings.from_data(current_config()), {})[node_id]
    assert updated.entity_id == "sensor.renamed"
    assert updated.attributes["area"] == (other.id,)
    assert "floor" not in updated.attributes
    assert updated.attributes["device_class"] == ("humidity",)
    assert updated.attributes["label"] == ("device_label", "entity_label")
    assert updated.owner_id == entry.entry_id
    assert entity_reference(hass, "sensor.renamed") == f"registry:{entity.id}"


@pytest.mark.parametrize(
    "value",
    [None, [], {"typo": "sensor"}, {"domain": []}, {"domain": [3]}, {"domain": ""}],
)
def test_invalid_matching_attributes(value: Any) -> None:
    """Invalid selectors cannot silently broaden a policy."""
    with pytest.raises(ValueError):
        attributes(value)


def test_current_policy_matching_requires_every_field() -> None:
    """Multiple values match any value, while separate fields all constrain scope."""
    selector = CatalogRule(
        id="chosen",
        match={
            "kind": ("entity",),
            "domain": ("light", "sensor"),
            "label": ("critical",),
        },
    )
    assert selector.matches(
        {"kind": ("entity",), "domain": ("sensor",), "label": ("critical",)}
    )
    assert not selector.matches({"kind": ("entity",), "domain": ("sensor",)})
    assert not CatalogRule(id="off", match={}, enabled=False).matches(
        {"kind": ("entity",)}
    )
    assert not CatalogRule(id="broad", match={}).matches({"kind": ("device",)})


async def test_area_selection_reconciles_without_an_exclusion_editor(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Moving equipment into and out of a selected area changes only that policy."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    area = ar.async_get(hass).async_create("Garage")
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "controller")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "observed", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(entity.entity_id, "1")
    policy = monitoring_policy("garage", {"kind": ["entity"], "area": [area.id]})
    config_data.update(monitoring_policies=[policy], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    canonical = f"entity:registry:{entity.id}"
    condition = bound_identity(policy, canonical)
    assert condition not in runtime.sources
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.async_block_till_done()
    assert runtime.sources[condition].watched
    assert runtime.candidates[canonical].attached_by == ("policy_garage",)
    dr.async_get(hass).async_update_device(device.id, area_id=None)
    await hass.async_block_till_done()
    assert condition not in runtime.sources
    assert canonical in runtime.candidates
    assert not runtime.candidates[canonical].watched
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_deleted_automatic_entity_ends_monitoring_across_reload(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Broad source discovery retires deleted identities without claiming repair."""
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "observed", original_device_class="temperature"
    )
    hass.states.async_set(entity.entity_id, "unavailable")
    policy = monitoring_policy(
        "temperature", {"kind": ["entity"], "device_class": ["temperature"]}
    )
    config_data.update(monitoring_policies=[policy], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    canonical = f"entity:registry:{entity.id}"
    condition = bound_identity(policy, canonical)
    assert runtime.sources[condition].watched
    episode_id = next(iter(runtime.episodes))
    hass.states.async_remove(entity.entity_id)
    er.async_get(hass).async_remove(entity.entity_id)
    await hass.async_block_till_done()
    assert condition not in runtime.sources
    assert canonical not in runtime.candidates
    assert not runtime.episodes
    history = runtime.history.view(dt_util.utcnow())["episodes"]
    assert history[0]["episode"]["episode_id"] == episode_id
    assert history[0]["resolution"] == "removed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert condition not in entry.runtime_data.sources
    assert (
        entry.runtime_data.history.view(dt_util.utcnow())["episodes"][0]["resolution"]
        == "removed"
    )
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_entities_without_devices_remain_individually_monitored(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Device membership is not a prerequisite for detecting entity loss."""
    entity = er.async_get(hass).async_get_or_create("sensor", "test", "orphan")
    hass.states.async_set(entity.entity_id, "unavailable")
    policy = monitoring_policy("entities", {"kind": ["entity"]})
    config_data.update(monitoring_policies=[policy], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    condition = bound_identity(policy, f"entity:registry:{entity.id}")
    assert runtime.sources[condition].watched
    assert len(runtime.episodes) == 1
    assert next(iter(runtime.episodes.values()))["anchor"] == condition
    assert await hass.config_entries.async_unload(entry.entry_id)
