"""The snapshot persists durable facts: digests, lean evidence, skipped identical writes (ADR 0097)."""

import logging
from copy import deepcopy
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.evidence import ReportedEvidence
from custom_components.homeostatic.runtime import Runtime
from tests.test_lifecycle import start_monitor

TRACE = "custom_components.homeostatic.save_timing"


async def test_snapshot_holds_route_digests_and_last_failures_only(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Route signatures persist as digests; evidence persists without the current observation."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    snapshot = runtime.snapshot()
    routes = snapshot["attention_routes"]
    assert routes and all(
        isinstance(value, str) and len(value) == 64 for value in routes.values()
    )
    assert routes == runtime._route_digests()
    evidence = snapshot["evidence"]
    assert evidence
    for record in evidence.values():
        assert set(record) == {"last_failure", "history_complete"}
    [node_id] = [key for key, item in evidence.items() if item["last_failure"]]
    view = runtime.evidence.view(node_id)
    assert view is not None and view["current"]["status"] in {"warn", "fail"}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_legacy_route_signatures_compare_equal_after_restart(
    hass: HomeAssistant, config_data: dict[str, Any], hass_storage: dict[str, Any]
) -> None:
    """A snapshot holding full signatures converts to digests, so unchanged routes do not re-activate."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    legacy = runtime._route_signatures()
    changed_route = next(iter(legacy))
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    seen: list[set[str] | None] = []
    original = Runtime._complete

    async def record(self: Runtime, now: Any, *, durable: bool = False) -> None:
        seen.append(self._activating_routes)
        await original(self, now, durable=durable)

    # A changed policy setting while unloaded activates routes on startup; the
    # stored signatures decide which ones.
    stored = hass_storage[key]["data"]
    stored["attention_routes"] = deepcopy(legacy)
    stored["policy_settings"] = {**stored["policy_settings"], "batch": 999}
    with patch.object(Runtime, "_complete", record):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert seen[0] == set()
    assert await hass.config_entries.async_unload(entry.entry_id)

    stored = hass_storage[key]["data"]
    altered = deepcopy(legacy)
    altered[changed_route]["batch"] = altered[changed_route]["batch"] + 1
    stored["attention_routes"] = altered
    stored["policy_settings"] = {**stored["policy_settings"], "batch": 999}
    seen.clear()
    with patch.object(Runtime, "_complete", record):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert seen[0] == {changed_route}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_evidence_restores_without_current_and_rebuilds_it(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Restart keeps the last failure and the first refresh supplies the current observation."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [node_id] = [
        key
        for key, item in runtime.snapshot()["evidence"].items()
        if item["last_failure"]
    ]
    before = runtime.evidence.view(node_id)
    assert before is not None and before["current"]["status"] in {"warn", "fail"}
    assert before["last_failure"] == before["current"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    after = runtime.evidence.view(node_id)
    assert after is not None
    # The first refresh re-observes the still failing source and refreshes the time.
    assert {k: v for k, v in after["last_failure"].items() if k != "observed_at"} == {
        k: v for k, v in before["last_failure"].items() if k != "observed_at"
    }
    assert after["current"]["status"] == before["current"]["status"]
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_legacy_evidence_with_current_still_restores() -> None:
    """Snapshots written before this change carry the current observation and still load."""
    evidence = ReportedEvidence()
    report = {
        "reason": "unavailable",
        "message": "Sensor is unavailable",
        "observed_at": "2026-10-18T04:00:00+00:00",
        "status": "fail",
    }
    evidence.restore({"node": {"current": report, "last_failure": report}})
    view = evidence.view("node")
    assert view is not None and view["current"]["status"] == "fail"
    assert evidence.snapshot() == {
        "node": {"last_failure": view["last_failure"], "history_complete": True}
    }
    with pytest.raises(vol.Invalid):
        evidence.restore({"node": {"last_failure": {"reason": 1}}})


async def test_identical_content_skips_the_write(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """A save whose bytes equal the last verified write performs no write."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    writes: list[dict[str, Any]] = []
    original = runtime.store.async_save

    async def save(data: dict[str, Any]) -> None:
        writes.append(data)
        await original(data)

    with (
        patch.object(runtime.store, "async_save", side_effect=save),
        caplog.at_level(logging.DEBUG, logger=TRACE),
    ):
        # The startup write already holds this content.
        async with runtime._lock:
            await runtime._save()
            await runtime._save()
        assert writes == []
        assert caplog.text.count("phase=storage_skip") == 2
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        assert len(writes) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_refresh_trace_names_the_engine_events(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """Each refresh line counts the engine event types it produced."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with caplog.at_level(logging.DEBUG, logger=TRACE):
        await runtime.async_refresh(reconcile=False, cause="test")
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
    lines = [
        record.getMessage()
        for record in caplog.records
        if record.name == TRACE and record.getMessage().startswith("phase=refresh")
    ]
    assert any("events=none" in line for line in lines), lines
    assert any("EpisodeOpened:1" in line for line in lines), lines
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_ongoing_failure_keeps_its_first_report_and_healthy_records_are_not_persisted() -> (
    None
):
    """Evidence persists only facts: a continuing failure keeps its first report."""
    from datetime import UTC, datetime

    from health_tree.types import Observation, Status

    evidence = ReportedEvidence()
    first = datetime(2026, 10, 18, 4, 0, tzinfo=UTC)
    later = datetime(2026, 10, 18, 4, 1, tzinfo=UTC)

    def observe(status: Status, at: datetime, reason: str = "unavailable") -> None:
        evidence.observe(
            Observation(
                node_id="node",
                check_id="availability",
                status=status,
                reason=reason,
                message=f"Sensor: {reason}",
                observed_at=at,
            ),
            "Sensor",
        )

    observe(Status.FAIL, first)
    observe(Status.FAIL, later)
    view = evidence.view("node")
    assert view is not None
    assert view["current"]["observed_at"] == later.isoformat()
    assert view["last_failure"]["observed_at"] == first.isoformat()
    observe(Status.FAIL, later, reason="timeout")
    assert evidence.view("node")["last_failure"]["reason"] == "timeout"
    assert "node" in evidence.snapshot()
    observe(Status.PASS, later)
    assert evidence.view("node")["current"]["status"] == "pass"
    assert evidence.snapshot() == {}
