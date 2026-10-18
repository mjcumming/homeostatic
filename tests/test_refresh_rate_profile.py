"""Opt-in replay of a household event rate with the real reconcile timer running."""

import json
import logging
import os
import statistics
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, RECONCILE_INTERVAL
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import populate

TIMING_LOGGER = "custom_components.homeostatic.save_timing"


def _fields(line: str) -> dict[str, str]:
    return dict(item.split("=", 1) for item in line.split(" ") if "=" in item)


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 6) if values else None


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_SAVE_PROFILE") != "1", reason="Opt-in refresh profiling"
)
async def test_live_rate_refresh_profile(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    caplog: pytest.LogCaptureFixture,
    tmp_path: Path,
) -> None:
    """Replay state changes at a household rate across reconcile ticks and record phases."""
    shape = populate(hass)
    config_data.update(
        notifications=False,
        monitoring_policy_version=1,
        monitoring_policies=[
            {
                "id": "watch",
                "name": "Watch",
                "check": "availability",
                "match": {"kind": ["entity"]},
                "parameters": {},
                "enabled": True,
                "notifications": [],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    caplog.set_level(logging.DEBUG, logger=TIMING_LOGGER)
    caplog.clear()
    minutes = int(os.environ.get("HOMEOSTATIC_PROFILE_MINUTES", "3"))
    rate = int(os.environ.get("HOMEOSTATIC_PROFILE_RATE", "50"))
    entities = shape.entities
    now = dt_util.utcnow()
    for minute in range(minutes):
        for index in range(rate):
            entity_id = entities[(minute * rate + index) % len(entities)]
            current = hass.states.get(entity_id)
            next_state = (
                "unavailable"
                if current is None or current.state != "unavailable"
                else "on"
            )
            hass.states.async_set(entity_id, next_state)
            if index % 10 == 9:
                await hass.async_block_till_done()
        await hass.async_block_till_done()
        now += RECONCILE_INTERVAL
        async_fire_time_changed(hass, now)
        await hass.async_block_till_done()

    lines = [
        record.getMessage() for record in caplog.records if record.name == TIMING_LOGGER
    ]
    refreshes = [_fields(line) for line in lines if line.startswith("phase=refresh ")]
    evaluations = [
        _fields(line) for line in lines if line.startswith("phase=evaluate ")
    ]
    snapshots = [
        float(_fields(line)["seconds"])
        for line in lines
        if line.startswith("phase=snapshot ")
    ]
    collections = [_fields(line) for line in lines if line.startswith("phase=gc ")]
    summaries = [_fields(line) for line in lines if line.startswith("phase=summary ")]
    by_cause = Counter(fields["cause"] for fields in refreshes)
    report = {
        "schema_version": 1,
        "recorded_at": dt_util.utcnow().isoformat(),
        "fixture": {
            "entities": len(entities),
            "devices": len(shape.devices),
            "owners": len(shape.owners),
        },
        "replay": {
            "minutes": minutes,
            "state_changes_per_minute": rate,
            "reconcile_interval_seconds": RECONCILE_INTERVAL.total_seconds(),
        },
        "refreshes": {
            "count": len(refreshes),
            "by_cause": dict(by_cause),
            "discoveries": sum(fields["discover"] == "True" for fields in refreshes),
            "evaluation_median": _median([float(f["evaluation"]) for f in refreshes]),
            "evaluation_max": max(
                (float(f["evaluation"]) for f in refreshes), default=None
            ),
            "lock_wait_max": max(
                (float(f["lock_wait"]) for f in refreshes), default=None
            ),
        },
        "evaluate_phase_medians": {
            key: _median([float(f[key]) for f in evaluations if key in f])
            for key in ("discovery", "engine", "catalog", "policy", "rest", "total")
        },
        "evaluate_phase_medians_with_discovery": {
            key: _median(
                [float(f[key]) for f in evaluations if f.get("discover") == "True"]
            )
            for key in ("discovery", "engine", "catalog", "policy", "rest", "total")
        },
        "saves": {
            "count": len(snapshots),
            "snapshot_median": _median(snapshots),
            "snapshot_max": max(snapshots, default=None),
        },
        "gc": {
            "long_or_full_collections": len(collections),
            "seconds": round(sum(float(f["seconds"]) for f in collections), 6),
        },
        "summaries": summaries,
        "note": "Isolated desktop harness with mocked registry storage; durations differ from the Raspberry Pi. Phase names match the live trace.",
    }
    output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))

    def write() -> None:
        output.mkdir(parents=True, exist_ok=True)
        (output / "refresh-rate-profile.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )

    await hass.async_add_executor_job(write)
    assert len(summaries) == minutes
    assert by_cause.get("reconcile", 0) >= minutes
    assert by_cause.get("state", 0) >= 1
    assert await hass.config_entries.async_unload(entry.entry_id)
