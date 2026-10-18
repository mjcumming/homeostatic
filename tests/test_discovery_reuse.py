"""A save that changes only rules or exclusions re-evaluates the last registry scan."""

from copy import deepcopy
from typing import Any
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic import enrollment
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, RECONCILE_INTERVAL
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


async def _prepare(hass: HomeAssistant, config_data: dict[str, Any]) -> MockConfigEntry:
    config_data["notifications"] = False
    config_data["monitoring_policies"] = [
        monitoring_policy("entities", {"kind": ["entity"]})
    ]
    for index in range(20):
        hass.states.async_set(f"sensor.candidate_{index}", "42")
    return MockConfigEntry(domain=DOMAIN, data=config_data)


def _counting(calls: list[str]) -> Any:
    original = enrollment.inventory

    def scan(hass: HomeAssistant, settings: Settings, known: dict[str, Any]) -> Any:
        calls.append("scan")
        return original(hass, settings, known)

    return scan


async def test_exclusion_edit_reuses_the_last_scan(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Stopping monitoring for an entity reads no registry when nothing changed."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    target = "entity:entity_id:sensor.candidate_3"
    assert runtime.candidates[target].watched
    calls: list[str] = []
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        async_fire_time_changed(hass, dt_util.utcnow() + RECONCILE_INTERVAL)
        await hass.async_block_till_done()
    assert calls == ["scan"]
    calls.clear()
    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["excluded_sources"] = [target]
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        await runtime.async_apply_settings(Settings.from_data(changed))
    assert calls == []
    assert runtime.candidates[target].watched is False
    assert target not in runtime.sources
    resumed = deepcopy(config_data)
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        await runtime.async_apply_settings(Settings.from_data(resumed))
    assert calls == []
    assert runtime.candidates[target].watched is True
    assert target in runtime.sources
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_selection_changes_and_registry_changes_still_scan(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Selecting new sources or changing a registry reads the registries again."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    async_fire_time_changed(hass, dt_util.utcnow() + RECONCILE_INTERVAL)
    await hass.async_block_till_done()
    calls: list[str] = []
    widened = deepcopy(config_data)
    widened["monitoring_policies"][0]["match"] = {"kind": ["entity", "device"]}
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        await runtime.async_apply_settings(Settings.from_data(widened))
    assert calls == ["scan"]

    ar.async_get(hass).async_create("Workshop")
    await hass.async_block_till_done()
    calls.clear()
    excluded = deepcopy(widened)
    excluded["monitoring_policies"][0]["excluded_sources"] = [
        "entity:entity_id:sensor.candidate_1"
    ]
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        runtime._inventory_dirty = True
        await runtime.async_apply_settings(Settings.from_data(excluded))
    assert calls == ["scan"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_reconcile_tick_keeps_reading_the_registries(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """The periodic reconciliation still captures changes no event announced."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    calls: list[str] = []
    with patch(
        "custom_components.homeostatic.runtime.inventory", side_effect=_counting(calls)
    ):
        async_fire_time_changed(hass, dt_util.utcnow() + RECONCILE_INTERVAL)
        await hass.async_block_till_done()
    assert calls == ["scan"]
    assert runtime._scan is not None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_exclusion_edit_decides_only_the_named_candidates(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Rules that differ only by exclusions re-decide only the excluded ids."""
    entry = await _prepare(hass, config_data)
    runtime = await start_monitor(hass, entry)
    async_fire_time_changed(hass, dt_util.utcnow() + RECONCILE_INTERVAL)
    await hass.async_block_till_done()
    target = "entity:entity_id:sensor.candidate_5"
    decided: list[str | None] = []
    original = enrollment.decide

    def counting(
        rules: Any,
        metadata: Any,
        check_id: Any = "availability",
        *,
        source_id: Any = None,
    ) -> Any:
        decided.append(source_id)
        return original(rules, metadata, check_id, source_id=source_id)

    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["excluded_sources"] = [target]
    with patch.object(enrollment, "decide", side_effect=counting):
        await runtime.async_apply_settings(Settings.from_data(changed))
    assert decided == [target]
    assert runtime.candidates[target].watched is False
    decided.clear()
    widened = deepcopy(changed)
    widened["monitoring_policies"][0]["match"] = {"kind": ["entity", "device"]}
    with patch.object(enrollment, "decide", side_effect=counting):
        await runtime.async_apply_settings(Settings.from_data(widened))
    assert len(decided) == len(runtime.candidates)
    assert await hass.config_entries.async_unload(entry.entry_id)
