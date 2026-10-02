"""Home Assistant Repairs become ordinary issues with one reporting choice."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import voluptuous as vol
from health_tree.policy import Policy
from health_tree.types import (
    Episode,
    EpisodeOpened,
    Finding,
    Importance,
    PolicyContext,
    Status,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import repairs as repairs_module
from custom_components.homeostatic import reporting
from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.automation_alerts import AutomationAlerts
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.repairs import Repairs, node_id, profile
from tests.test_lifecycle import start_monitor
from tests.test_reporting import PEOPLE
from tests.test_reporting import configured as configured

DECK = "automation.deck_service_not_found_light.turn_on"


def raise_deck_repair(hass: HomeAssistant) -> str:
    """Create the Repair HA raises for an automation calling a missing action."""
    ir.async_create_issue(
        hass,
        "automation",
        DECK,
        is_fixable=True,
        severity=ir.IssueSeverity.ERROR,
        translation_key="service_not_found",
        translation_placeholders={
            "name": "Deck lights",
            "entity_id": "automation.deck_lights",
            "service": "light.turn_on",
            "edit": "/config/automation/edit/deck",
        },
    )
    return node_id("automation", DECK)


def open_for(runtime: Any, node: str) -> list[dict[str, Any]]:
    """Open issues anchored on one source."""
    return [row for row in runtime.episodes.values() if row["anchor"] == node]


async def test_repair_opens_an_issue_and_clears_with_ha(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The issue uses HA's title and link, and ends when HA deletes the Repair."""
    runtime = await start_monitor(hass, config_entry)
    node = raise_deck_repair(hass)
    await hass.async_block_till_done()
    source = runtime.sources[node]
    assert (source.kind, source.name, source.fix_url) == (
        "repair",
        "Deck lights uses an unknown action",
        "/config/automation/edit/deck",
    )
    [episode] = open_for(runtime, node)
    assert episode["reasons"][0]["message"] == (
        "Automation reported this in Home Assistant Repairs (error)."
    )
    assert runtime.snapshot()["repairs"][node]["state"] == "active"

    ir.async_delete_issue(hass, "automation", DECK)
    await hass.async_block_till_done()
    assert not open_for(runtime, node)
    last = runtime.history.snapshot()["episodes"][-1]
    assert (last["resolution"], last["source"]["kind"]) == ("cleared", "repair")
    await runtime.async_refresh()
    assert node not in runtime.sources
    assert not runtime.repairs.records
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_ignoring_a_repair_ends_its_issue(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An owner who ignores a Repair in HA has decided it needs no reminder."""
    runtime = await start_monitor(hass, config_entry)
    node = raise_deck_repair(hass)
    await hass.async_block_till_done()
    assert open_for(runtime, node)
    ir.async_ignore_issue(hass, "automation", DECK, True)
    await hass.async_block_till_done()
    assert not open_for(runtime, node)
    assert runtime.history.snapshot()["episodes"][-1]["episode"]["reasons"][0][
        "reason"
    ] in {"reported", "ignored"}
    await runtime.async_refresh()
    assert node not in runtime.sources
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_unknown_repair_uses_integration_name_and_repairs_page(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Without a translated title the integration still identifies the Repair."""
    runtime = await start_monitor(hass, config_entry)
    ir.async_create_issue(
        hass,
        "zha",
        "zha.unrelated_repair",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="unrelated_repair",
    )
    ir.async_create_issue(
        hass,
        "not_a_real_integration",
        "mystery",
        is_fixable=False,
        severity=ir.IssueSeverity.CRITICAL,
        translation_key="mystery",
    )
    ir.async_create_issue(
        hass,
        DOMAIN,
        "own_issue",
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key="own_issue",
    )
    await hass.async_block_till_done()
    zha = runtime.sources[node_id("zha", "zha.unrelated_repair")]
    assert (zha.name, zha.fix_url) == (
        "Zigbee Home Automation repair",
        "/config/repairs",
    )
    assert (
        runtime.sources[node_id("not_a_real_integration", "mystery")].name
        == "not_a_real_integration repair"
    )
    assert node_id(DOMAIN, "own_issue") not in runtime.sources
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_repair_issue_survives_a_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A reload keeps the same issue while HA still reports the Repair."""
    runtime = await start_monitor(hass, config_entry)
    node = raise_deck_repair(hass)
    await hass.async_block_till_done()
    [before] = open_for(runtime, node)
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    [after] = open_for(runtime, node)
    assert after["episode_id"] == before["episode_id"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_repair_capacity_is_bounded(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Repairs past the limit stay in HA without becoming issues."""
    monkeypatch.setattr(repairs_module, "MAX_REPAIRS", 1)
    runtime = await start_monitor(hass, config_entry)
    for issue_id in ("a", "b"):
        ir.async_create_issue(
            hass,
            "zha",
            issue_id,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=issue_id,
        )
    await hass.async_block_till_done()
    assert list(runtime.repairs.records) == [node_id("zha", "a")]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def test_cleared_repair_is_held_during_startup() -> None:
    """A Repair not yet raised again after a restart keeps its issue open."""
    repairs = Repairs()
    key = node_id("zha", "a")
    row = {
        "domain": "zha",
        "issue_id": "a",
        "name": "Zigbee Home Automation repair",
        "integration": "Zigbee Home Automation",
        "severity": "warning",
        "url": "/config/repairs",
        "state": "cleared",
    }
    repairs.restore({key: row})
    now = dt_util.utcnow()
    assert repairs.observation(key, now, holding=True) is None
    cleared = repairs.observation(key, now, holding=False)
    assert cleared is not None and cleared.reason == "cleared"
    repairs.records[key]["state"] = "ignored"
    ignored = repairs.observation(key, now, holding=True)
    assert ignored is not None and ignored.reason == "ignored"
    assert repairs.prune(set()) is True
    assert not repairs.records
    assert repairs.prune(set()) is False


def test_stored_repairs_are_validated() -> None:
    """Stored identity must match the Repair it names."""
    repairs = Repairs()
    row = {
        "domain": "zha",
        "issue_id": "a",
        "name": "Repair",
        "integration": "ZHA",
        "severity": "error",
        "url": "/config/repairs",
        "state": "active",
    }
    with pytest.raises(ValueError, match="Invalid stored Repairs"):
        repairs.restore({"repair:wrong": row})
    with pytest.raises(vol.Invalid):
        repairs.restore({node_id("zha", "a"): {**row, "url": "https://example.com"}})
    repairs.restore({node_id("zha", "a"): row})
    assert repairs.snapshot() == {node_id("zha", "a"): row}


async def test_repairs_share_one_reporting_choice(hass: HomeAssistant) -> None:
    """The choice defaults to the morning summary and is absent for custom policies."""
    policy = reporting.generate(hass, reporting.defaults(), [])
    assert reporting.choices(policy)["repairs"] == "morning"
    assert profile(policy) == "morning"
    weekly = reporting.generate(hass, {**reporting.defaults(), "repairs": "weekly"}, [])
    assert profile(weekly) == "weekly"
    legacy = {**policy, "generated": {**policy["generated"]}}
    legacy["generated"]["choices"] = {
        key: value
        for key, value in policy["generated"]["choices"].items()
        if key != "repairs"
    }
    assert profile(legacy) == "morning"
    custom = {key: value for key, value in policy.items() if key != "generated"}
    assert profile(custom) is None
    with pytest.raises(ValueError, match="six reporting preferences"):
        reporting.generate(hass, {**reporting.defaults(), "repairs": "hourly"}, [])
    repairs = Repairs()
    repairs.restore(
        {
            node_id("zha", "a"): {
                "domain": "zha",
                "issue_id": "a",
                "name": "Repair",
                "integration": "ZHA",
                "severity": "warning",
                "url": "/config/repairs",
                "state": "active",
            }
        }
    )
    [source] = repairs.sources(weekly).values()
    assert source.alert_profile == "weekly"
    assert (
        source.node(Settings.from_data({})).labels["homeostatic_alert_profile"]
        == "weekly"
    )
    [unlabelled] = repairs.sources(custom).values()
    assert (
        "homeostatic_alert_profile"
        not in unlabelled.node(Settings.from_data({})).labels
    )


async def test_repair_profile_label_routes_the_issue(
    hass: HomeAssistant, configured: dict[str, Any]
) -> None:
    """A Repair follows the shared Repairs choice, not the household default."""
    configured["repairs"] = "immediate"
    data = reporting.generate(hass, configured, PEOPLE)
    composed = AutomationAlerts().policy(Settings.from_data({"policy": data}))
    policy = Policy(build_policy(composed, timedelta(seconds=30)))
    now = datetime(2026, 10, 1, 23, tzinfo=UTC)
    key = node_id("automation", DECK)
    episode = Episode(
        episode_id="repair",
        form="root",
        anchor=key,
        status=Status.FAIL,
        importance=Importance.NORMAL,
        reasons=(
            Finding(
                node_id=key,
                check_id="repair",
                status=Status.FAIL,
                reason="reported",
                since=now,
            ),
        ),
        recorded=frozenset(),
        impact=frozenset(),
        opened_at=now,
        updated_at=now,
        labels={"homeostatic_alert_profile": "immediate"},
    )
    [delivery] = policy.handle(EpisodeOpened(episode=episode), now, PolicyContext())
    assert (delivery.recipient, delivery.loudness.value) == ("person:owner", "urgent")
