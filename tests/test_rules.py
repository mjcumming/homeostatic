"""Rule catalog scenarios: enrollment, exclusion, provenance, and native previews."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import (
    Settings,
    data_from_input,
    normalize_rules,
    rule_data,
)
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import inventory, restore_enrollment
from custom_components.homeostatic.rules import DEFAULT_RULES, decide, parse_rules
from tests.test_lifecycle import start_monitor


def rule(
    rule_id: str, action: str = "attach", **match: str | list[str]
) -> dict[str, Any]:
    """Build readable rule scenarios with exact attribute matching."""
    return {"id": rule_id, "action": action, "match": match}


@pytest.mark.parametrize("reverse", [False, True])
def test_exclusion_is_order_independent(reverse: bool) -> None:
    """Additive matches retain every explanation; an exclusion always wins."""
    rules = [
        rule("all"),
        rule("sensors", domain="sensor"),
        rule("garage", "exclude", area="garage"),
        {**rule("disabled", "exclude"), "enabled": False},
    ]
    ordered = sorted(rules, key=lambda row: row["id"], reverse=reverse)
    decision = decide(
        parse_rules(ordered), {"domain": ("sensor",), "area": ("garage",)}
    )
    assert decision.attached_by == ("all", "sensors")
    assert decision.excluded_by == ("garage",)
    assert not decision.watched
    assert decide(
        parse_rules(ordered), {"domain": ("sensor",), "area": ("kitchen",)}
    ).watched
    assert not decide(
        parse_rules([rule("both", domain=["sensor", "light"], label="security")]),
        {"domain": ("sensor",)},
    ).watched


@pytest.mark.parametrize(
    "value",
    [
        None,
        {},
        [None],
        [{"id": "a", "action": "attach", "invented": True}],
        [rule("Bad ID")],
        [rule("a"), rule("a")],
        [rule("a", "replace")],
        [{**rule("a"), "checks": []}],
        [{**rule("a"), "checks": ["heartbeat"]}],
        [{**rule("a"), "enabled": "true"}],
        [rule("a", typo="sensor")],
        [rule("a", domain=[])],
        [rule("a", domain="")],
        [{**rule("a"), "match": {"domain": [3]}}],
        [{**rule("a"), "match": None}],
    ],
    ids=[
        "null",
        "object",
        "row",
        "unknown-field",
        "id",
        "duplicate",
        "action",
        "no-checks",
        "unsupported-check",
        "enabled",
        "unknown-match",
        "empty-list",
        "empty-value",
        "non-string",
        "null-match",
    ],
)
def test_invalid_rules(value: Any) -> None:
    """Invalid rules cannot silently broaden or narrow monitoring."""
    with pytest.raises(ValueError):
        parse_rules(value)


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
    sources = inventory(hass, Settings.from_data({"rules": DEFAULT_RULES}), {})
    metadata = sources[node_id].attributes
    assert metadata == {
        "kind": ("entity",),
        "entity": (f"registry:{entity.id}",),
        "domain": ("sensor",),
        "device_class": ("temperature",),
        "integration": (entry.entry_id,),
        "device": (device.id,),
        "area": (area.id,),
        "floor": (floor.floor_id,),
        "label": ("area_label", "device_label", "entity_label"),
    }
    assert decide(
        parse_rules(
            [
                rule(
                    "all_fields",
                    **{key: list(values) for key, values in metadata.items()},
                )
            ]
        ),
        metadata,
    ).watched
    er.async_get(hass).async_update_entity(
        entity.entity_id,
        area_id=other.id,
        device_class="humidity",
        new_entity_id="sensor.renamed",
    )
    updated = inventory(hass, Settings.from_data({"rules": DEFAULT_RULES}), {})[node_id]
    assert updated.entity_id == "sensor.renamed"
    assert updated.attributes["area"] == (other.id,)
    assert "floor" not in updated.attributes
    assert updated.attributes["device_class"] == ("humidity",)
    assert updated.attributes["label"] == ("device_label", "entity_label")
    assert updated.owner_id == entry.entry_id
    assert normalize_rules(hass, [rule("renamed", entity="sensor.renamed")])[0][
        "match"
    ]["entity"] == [f"registry:{entity.id}"]


async def test_future_sources_and_excluded_function(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Passive enrollment includes future arrivals; exclusions cannot green a function."""
    config_data.update(
        entities=[],
        notifications=False,
        rules=[
            *DEFAULT_RULES,
            rule("exclude_required", "exclude", entity="entity_id:sensor.required"),
        ],
        functions=[
            {
                "id": "safety",
                "name": "Safety",
                "entities": ["entity_id:sensor.required"],
            }
        ],
        situations=[
            {"id": "alert", "name": "Alert", "entity": "entity_id:binary_sensor.alert"}
        ],
    )
    hass.states.async_set("sensor.required", "1")
    hass.states.async_set("binary_sensor.alert", "off")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "unknown"
    assert len(runtime.enrollment_changes) == 1
    initial = runtime.enrollment_changes[0]
    assert initial["reason"] == "initial_scope"
    assert initial["total"] == sum(
        source.watched for source in runtime.candidates.values()
    )
    required = runtime.sources["entity:entity_id:sensor.required"]
    assert not required.watched
    assert required.excluded_by == ("exclude_required",)
    assert (
        "entity:entity_id:sensor.required" in runtime.query("coverage", {})["no_checks"]
    )
    hass.states.async_set("sensor.new_arrival", "unavailable")
    hass.states.async_set("binary_sensor.alert", "on")
    await hass.async_block_till_done()
    assert runtime.sources["entity:entity_id:sensor.new_arrival"].attached_by == (
        "passive_availability",
    )
    arrival = next(
        change
        for change in runtime.enrollment_changes
        if change.get("node_id") == "entity:entity_id:sensor.new_arrival"
    )
    assert arrival["reason"] == "source_enrolled"
    assert isinstance(arrival["batch"], str)
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {
        "entity:entity_id:sensor.new_arrival",
        "situation:alert",
    }
    assert not runtime.delivery.messages
    assert all(source.owner_id != entry.entry_id for source in runtime.sources.values())
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_area_move_changes_checks_with_provenance(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Device registry changes re-evaluate live area exclusions and record why."""
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
    config_data.update(
        entities=[],
        notifications=False,
        rules=[*DEFAULT_RULES, rule("garage_exclusion", "exclude", area=area.id)],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entity:registry:{entity.id}"
    assert node_id in runtime.sources
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    await hass.async_block_till_done()
    assert node_id not in runtime.sources
    assert runtime.candidates[node_id].excluded_by == ("garage_exclusion",)
    change = next(
        change
        for change in reversed(runtime.enrollment_changes)
        if change["node_id"] == node_id
    )
    assert change["reason"] == "match_attributes_changed"
    assert change["before"]["watched"] is True
    assert change["after"]["watched"] is False
    dr.async_get(hass).async_update_device(device.id, area_id=None)
    await hass.async_block_till_done()
    assert node_id in runtime.sources
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_missing_enrollment_survives_reload(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Removing registry evidence preserves identity, rule matches and unknown state."""
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "observed", original_device_class="temperature"
    )
    hass.states.async_set(entity.entity_id, "12")
    config_data.update(
        entities=[],
        notifications=False,
        rules=[rule("temperature", device_class="temperature")],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entity:registry:{entity.id}"
    assert runtime.readiness == "ready"
    hass.states.async_remove(entity.entity_id)
    er.async_get(hass).async_remove(entity.entity_id)
    await hass.async_block_till_done()
    assert runtime.readiness == "unknown"
    assert runtime.sources[node_id].entity_id is None
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert restored.available
    assert restored.readiness == "unknown"
    assert restored.sources[node_id].attached_by == ("temperature",)
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_preview_service_is_read_only(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Unsaved exclusions can be inspected without changing episodes or requests."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    before = deepcopy(runtime.snapshot())
    result = await hass.services.async_call(
        DOMAIN,
        "preview_rules",
        {"rules": [rule("everything"), rule("exclude", "exclude")]},
        blocking=True,
        return_response=True,
    )
    assert result["watched"] == 0
    assert result["rules"][0]["matches"] > 0
    assert runtime.snapshot() == before
    with pytest.raises(ServiceValidationError, match="action"):
        await hass.services.async_call(
            DOMAIN,
            "preview_rules",
            {"rules": [rule("bad", "delete")]},
            blocking=True,
            return_response=True,
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_native_preview_edit_save(hass: HomeAssistant) -> None:
    """Native previews preserve unsaved edits and do not create an entry."""
    hass.states.async_set("sensor.observed", "42")
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    rules = [rule("observed", entity="sensor.observed")]
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"rules": rules, "preview": True}
    )
    assert result["type"] is FlowResultType.FORM
    assert "observed: 1 matches" in result["description_placeholders"]["preview"]
    assert not hass.config_entries.async_entries(DOMAIN)
    with patch("custom_components.homeostatic.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"preview": False}
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["rules"][0]["match"]["entity"] == [
        "entity_id:sensor.observed"
    ]
    assert result["data"]["notifications"] is False


async def test_options_preview_no_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Previewing changed rules retains current monitoring until explicitly saved."""
    config_entry.add_to_hass(hass)
    before = dict(config_entry.data)
    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    with patch.object(hass.config_entries, "async_reload", new=AsyncMock()) as reload:
        result = await hass.config_entries.options.async_configure(
            result["flow_id"], {"rules": [], "preview": True, "notifications": False}
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.FORM
    assert "0 watched" in result["description_placeholders"]["preview"]
    assert dict(config_entry.data) == before
    reload.assert_not_called()


async def test_future_entry_reconciles(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """New integration instances inherit passive checks on periodic reconciliation."""
    config_data.update(entities=[], notifications=False, rules=DEFAULT_RULES)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    freezer.tick(timedelta(seconds=61))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.sources[f"entry:{owner.entry_id}"].attached_by == (
        "passive_availability",
    )
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "failure")
    await hass.async_block_till_done()
    assert runtime.readiness == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_empty_rules_and_legacy_conversion(hass: HomeAssistant) -> None:
    """Empty catalogs intentionally watch nothing; legacy empty selections stay empty."""
    assert data_from_input(hass, {"rules": []})["rules"] == []
    assert rule_data(hass, Settings.from_data({"entities": []})) == []
    assert data_from_input(hass, {})["rules"][0]["id"] == "passive_availability"


@pytest.mark.parametrize("state", [None, "unavailable", "unknown"])
async def test_lost_state_class_remains_monitored(
    hass: HomeAssistant, config_data: dict[str, Any], state: str | None
) -> None:
    """State-derived class loss is missing evidence, not automatic unenrollment."""
    entity = er.async_get(hass).async_get_or_create("sensor", "test", "dynamic")
    hass.states.async_set(entity.entity_id, "20", {"device_class": "temperature"})
    config_data.update(
        entities=[],
        notifications=False,
        rules=[rule("temperature", device_class="temperature")],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_remove(entity.entity_id)
    await hass.async_block_till_done()
    assert f"entity:registry:{entity.id}" in runtime.sources
    assert runtime.readiness == "unknown"
    hass.states.async_set(entity.entity_id, state or "unknown")
    await hass.async_block_till_done()
    assert f"entity:registry:{entity.id}" in runtime.sources
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_and_integration_exclusions(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A device exclusion leaves its shared owner; an entry exclusion covers both."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "one")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "one", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(entity.entity_id, "available")
    config_data.update(
        entities=[],
        notifications=False,
        rules=[*DEFAULT_RULES, rule("device", "exclude", device=device.id)],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert f"entity:registry:{entity.id}" not in runtime.sources
    assert f"entry:{owner.entry_id}" in runtime.sources
    runtime.settings = Settings.from_data(
        {
            **config_data,
            "rules": [
                *DEFAULT_RULES,
                rule("integration", "exclude", integration=owner.entry_id),
            ],
        }
    )
    await runtime.async_refresh()
    assert f"entity:registry:{entity.id}" not in runtime.sources
    assert f"entry:{owner.entry_id}" not in runtime.sources
    assert runtime.candidates[f"entry:{owner.entry_id}"].excluded_by == ("integration",)
    assert any(
        change["reason"] == "rules_changed" for change in runtime.enrollment_changes
    )
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_service_rejects_self_rule(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Invalid self-selection previews are reported as user validation errors."""
    await start_monitor(hass, config_entry)
    with pytest.raises(ServiceValidationError, match="itself"):
        await hass.services.async_call(
            DOMAIN,
            "preview_rules",
            {"rules": [rule("self", integration=config_entry.entry_id)]},
            blocking=True,
            return_response=True,
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_disabled_device_is_unknown(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A disabled device cannot pass on a leftover available entity state."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "disabled")}
    )
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "disabled", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(entity.entity_id, "available")
    config_data.update(entities=[], notifications=False, rules=DEFAULT_RULES)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dr.async_get(hass).async_update_device(
        device.id, disabled_by=dr.DeviceEntryDisabler.USER
    )
    await hass.async_block_till_done()
    assert runtime.readiness == "unknown"
    assert runtime.sources[f"entity:registry:{entity.id}"].disabled
    assert await hass.config_entries.async_unload(entry.entry_id)
