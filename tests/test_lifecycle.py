"""Executable setup, observation, delivery, and restart scenarios."""

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from freezegun.api import FrozenDateTimeFactory
from health_tree.engine import Engine
from health_tree.types import Check, Node
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import snapshot
from custom_components.homeostatic.runtime import Runtime
from custom_components.homeostatic.serialization import json_object

SCENARIOS = yaml.safe_load(
    (Path(__file__).parent / "fixtures/scenarios.yaml").read_text()
)


async def start_monitor(hass: HomeAssistant, entry: MockConfigEntry) -> Runtime:
    """Load the real integration and complete HA startup."""
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
async def test_observation_scenarios(
    hass: HomeAssistant, config_entry: MockConfigEntry, scenario: dict[str, Any]
) -> None:
    """Observed HA states keep restored and unknown evidence distinct."""
    hass.states.async_set("sensor.observed", scenario["state"], scenario["attributes"])
    runtime = await start_monitor(hass, config_entry)
    assert runtime.readiness == scenario["readiness"]
    assert len(runtime.episodes) == scenario["episodes"]
    assert runtime.available
    assert (
        hass.states.get("sensor.homeostatic_readiness").state == scenario["readiness"]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_failure_notification_recovery(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An actual state event opens one notification and recovery dismisses it."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    episode_id = next(iter(runtime.episodes))
    assert runtime.readiness == "degraded"
    [message] = runtime.notifications.delivery.messages.values()
    notification_tag = message["tag"]
    assert message["episode_id"] == episode_id
    assert notification_tag in hass.data[persistent_notification.DOMAIN]
    hass.states.async_set("sensor.observed", "43")
    await hass.async_block_till_done()
    assert runtime.readiness == "ready"
    assert not runtime.episodes
    assert notification_tag not in hass.data[persistent_notification.DOMAIN]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_startup_deferral(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The engine does not start its grace period during integration setup."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert runtime.engine is None
    assert not runtime.available
    assert hass.states.get("sensor.homeostatic_readiness").state == "unavailable"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert runtime.engine is None


async def test_full_start_keeps_startup_grace(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    freezer: FrozenDateTimeFactory,
) -> None:
    """A failure present at HA startup waits for the configured grace."""
    config_entry.data["timings"]["startup_grace"] = 120
    hass.set_state(CoreState.not_running)
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    assert runtime.fresh_start
    assert not runtime.episodes
    freezer.tick(timedelta(seconds=121))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_restart_preserves_episode(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Reload restores an open episode and its notification identity."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert restored is not runtime
    assert list(restored.episodes) == [episode_id]
    assert restored.desired_notifications == {episode_id}
    assert not runtime.running
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_missing_source_stales(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A selected absent entity remains unknown and eventually opens stale."""
    runtime = await start_monitor(hass, config_entry)
    assert runtime.readiness == "unknown"
    assert not runtime.episodes
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    coverage = runtime.query("coverage", {})
    assert coverage["never_observed"] == []
    assert coverage["stale"] == [
        {
            "node_id": next(
                source.node_id for source in runtime.sources.values() if source.watched
            ),
            "check_id": "availability",
        }
    ]
    assert runtime.evidence_gaps == 1
    assert snapshot(runtime)["evidence_gaps"] == 1
    assert hass.states.get("sensor.homeostatic_evidence_gaps").state == "1"
    assert runtime.readiness == "unknown"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_coverage_gaps_deduplicate_check_references(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Overlapping never-observed and stale rows count each node/check pair once."""
    runtime = await start_monitor(hass, config_entry)
    engine = Engine(runtime.settings.engine_settings())
    now = dt_util.utcnow()
    checks = tuple(
        Check(
            check_id=check_id,
            raise_hold=timedelta(0),
            clear_hold=timedelta(0),
            ttl=None,
            unknown_hold=timedelta(seconds=30),
        )
        for check_id in ("availability", "battery")
    )
    engine.register_many(
        (
            Node(node_id="first", checks=checks),
            Node(node_id="second", checks=checks[:1]),
        ),
        now,
    )
    for elapsed, stale_count in ((0, 0), (31, 3)):
        engine.advance(now + timedelta(seconds=elapsed))
        coverage = {
            **json_object(engine.coverage()),
            "notification_consumer_missing": False,
        }
        assert len(engine.coverage().never_observed) == 3
        assert len(engine.coverage().stale) == stale_count
        assert runtime.evidence_gaps_from_coverage(coverage) == 3
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_recovery_before_delayed_delivery(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """A recovered problem is absent when its scheduled report becomes due."""
    report_at = dt_util.utcnow() + timedelta(minutes=1)
    config_entry.data["monitoring_policies"][0]["notifications"][0]["timing"] = {
        "mode": "report",
        "at": report_at.strftime("%H:%M"),
        "weekdays": list(range(7)),
    }
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    assert len(runtime.episodes) == 1
    assert not runtime.desired_notifications
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=61))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert not runtime.desired_notifications
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    ("functions", "disabled"),
    [
        pytest.param(
            [{"id": "garage", "name": "Garage"}],
            er.RegistryEntryDisabler.INTEGRATION,
            id="saved-function",
        ),
        pytest.param({"garage": "not a list"}, None, id="malformed-definitions"),
    ],
)
async def test_dormant_function_entities_are_disabled(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    functions: Any,
    disabled: er.RegistryEntryDisabler | None,
) -> None:
    """ADR 0039: saved function entities are disabled and nothing else changes."""
    entry = MockConfigEntry(
        domain=DOMAIN, unique_id=DOMAIN, data={**config_data, "functions": functions}
    )
    entry.add_to_hass(hass)
    registry = er.async_get(hass)
    function_entities = [
        registry.async_get_or_create(
            platform,
            DOMAIN,
            f"{entry.entry_id}_function_garage{suffix}",
            config_entry=entry,
        ).entity_id
        for platform, suffix in (("sensor", ""), ("event", "_problems"))
    ]
    other = registry.async_get_or_create(
        "sensor", DOMAIN, f"{entry.entry_id}_unrelated", config_entry=entry
    ).entity_id
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert [
        registry.async_get(entity_id).disabled_by for entity_id in function_entities
    ] == [disabled, disabled]
    assert registry.async_get(other).disabled_by is None
    assert await hass.config_entries.async_unload(entry.entry_id)
