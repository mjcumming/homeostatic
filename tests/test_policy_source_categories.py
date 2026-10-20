"""Focused source scopes use existing saved selectors without a category field."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import (
    _editable_settings,
    _settings_candidate,
)
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.policy_defaults import policy_templates
from tests.policy_helpers import current_config, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies


@pytest.mark.parametrize(
    ("domain", "device_class"),
    [
        ("camera", None),
        ("lock", None),
        ("alarm_control_panel", None),
        ("binary_sensor", "smoke"),
    ],
)
async def test_custom_category_scope_preserves_empty_exact_and_future_choices(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    domain: str,
    device_class: str | None,
) -> None:
    """Choosing a category alone never enrolls current or later equipment."""
    registry = er.async_get(hass)
    first = registry.async_get_or_create(
        domain, "test", "first", original_device_class=device_class
    )
    outside = registry.async_get_or_create(
        "binary_sensor", "test", "outside", original_device_class="door"
    )
    for entity in (first, outside):
        hass.states.async_set(entity.entity_id, "unavailable")
    match = {"kind": ["entity"], "domain": [domain], "entity": []}
    if device_class:
        match["device_class"] = ["smoke", "carbon_monoxide", "gas", "moisture"]
    row = monitoring_policy("focused", match)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={**config_data, "notifications": False, "monitoring_policies": [row]},
    )
    runtime = await start_monitor(hass, entry)

    def watched() -> set[str | None]:
        return {
            source.entity_id
            for source in runtime.sources.values()
            if source.monitoring_policy == "focused" and source.watched
        }

    assert not watched()
    assert not runtime.episodes
    row["match"]["entity"] = [f"registry:{first.id}"]
    await reload_policies(hass, entry, [row])
    runtime = entry.runtime_data
    assert watched() == {first.entity_id}

    later = registry.async_get_or_create(
        domain, "test", "later", original_device_class=device_class
    )
    hass.states.async_set(later.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert watched() == {first.entity_id}

    del row["match"]["entity"]
    await reload_policies(hass, entry, [row])
    runtime = entry.runtime_data
    assert watched() == {first.entity_id, later.entity_id}
    assert runtime.settings.monitoring_policies[0].match["domain"] == (domain,)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert watched() == {first.entity_id, later.entity_id}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_category_rename_and_duplicate_preserve_scopes_and_overrides(
    hass: HomeAssistant,
) -> None:
    """Presentation edits preserve metadata scope, exceptions and general coverage."""
    camera = next(row for row in policy_templates() if row["id"] == "default_cameras")
    camera.update(
        included_sources=["entity:entity_id:light.explicit_exception"],
        excluded_sources=["entity:registry:missing_camera"],
    )
    general = monitoring_policy(
        "older_general", {"kind": ["entity"], "area": ["garage"]}
    )
    original = Settings.from_data(current_config([camera, general]))
    draft = _editable_settings(original)
    draft["monitoring_policies"][0]["name"] = "Outside equipment"
    duplicate = deepcopy(draft["monitoring_policies"][0])
    duplicate.update(id="independent_copy", name="Spare policy", enabled=False)
    draft["monitoring_policies"].append(duplicate)
    saved = await _settings_candidate(hass, current_config([camera, general]), draft)
    restored = Settings.from_data(saved)
    first, untouched, copied = restored.monitoring_policies
    assert first.detection_key() == copied.detection_key()
    assert first.detection_key() == original.monitoring_policies[0].detection_key()
    assert first.match_any == copied.match_any == ({"domain": ("camera",)},)
    assert (
        first.included_sources
        == copied.included_sources
        == ("entity:entity_id:light.explicit_exception",)
    )
    assert (
        first.excluded_sources
        == copied.excluded_sources
        == ("entity:registry:missing_camera",)
    )
    assert untouched == original.monitoring_policies[1]
    assert not copied.enabled
    assert first.matches(
        {"kind": ("entity",), "domain": ("light",)},
        source_id="entity:entity_id:light.explicit_exception",
    )
    assert parse_policies([row.data() for row in restored.monitoring_policies]) == (
        restored.monitoring_policies
    )
    reloaded = await _settings_candidate(hass, saved, _editable_settings(restored))
    assert (
        Settings.from_data(reloaded).monitoring_policies == restored.monitoring_policies
    )


@pytest.mark.parametrize("check", ["battery", "vacuum"])
async def test_flat_condition_selection_retains_existing_exclusions(
    hass: HomeAssistant, check: str
) -> None:
    """Positive exact choices do not erase canonical or missing saved exclusions."""
    row = monitoring_policy(
        "focused",
        {"kind": [check], "entity": ["registry:first", "registry:second"]},
        check=check,
    )
    row["excluded_sources"] = [f"{check}:registry:first", f"{check}:registry:missing"]
    current = current_config([row])
    saved = await _settings_candidate(
        hass, current, _editable_settings(Settings.from_data(current))
    )
    [policy] = Settings.from_data(saved).monitoring_policies
    assert policy.excluded_sources == (
        f"{check}:registry:first",
        f"{check}:registry:missing",
    )
    assert not policy.matches(
        {"kind": (check,), "entity": ("registry:first",)},
        source_id=f"{check}:registry:first",
    )
    assert policy.matches(
        {"kind": (check,), "entity": ("registry:second",)},
        source_id=f"{check}:registry:second",
    )
    assert not policy.matches(
        {"kind": (check,), "entity": ("registry:later",)},
        source_id=f"{check}:registry:later",
    )
