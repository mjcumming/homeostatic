"""Opt-in acknowledgment measurements with isolated inventory and real storage."""

import json
import os
from collections import defaultdict
from pathlib import Path
from time import perf_counter
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_controls import action
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import populate
from tests.test_save_performance import profile_phases, real_runtime_storage


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_ACK_PROFILE") != "1",
    reason="Opt-in acknowledgment profiling for large installations",
)
async def test_acknowledgment_profile(
    hass: HomeAssistant, config_data: dict[str, Any], tmp_path: Path
) -> None:
    """Measure three control responses while saving actual temporary files."""
    shape = populate(hass)
    config_data.update(
        monitoring_policies=[monitoring_policy("entities", {"kind": ["entity"]})],
        notifications=False,
    )
    for entity_id in shape.entities[:3]:
        hass.states.async_set(entity_id, "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with real_runtime_storage(tmp_path):
        runtime = await start_monitor(hass, entry)
        assert len(runtime.episodes) == 3
        samples = []
        for episode_id in tuple(runtime.episodes):
            phases: dict[str, float] = defaultdict(float)
            with (
                profile_phases(phases),
                patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
            ):
                started = perf_counter()
                response = await action(hass, "acknowledge", {"episode_id": episode_id})
                elapsed = perf_counter() - started
            assert response["acknowledgment"]["episode_id"] == episode_id
            samples.append(
                {
                    "seconds": elapsed,
                    "inventory_scans": discover.call_count,
                    "phases": phases,
                }
            )
            await hass.async_block_till_done()
        snapshot = await runtime.store.async_load()
        assert snapshot is not None
        output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))
        report = {
            "entities": len(shape.entities),
            "devices": len(shape.devices),
            "source_records": len(runtime.sources),
            "snapshot_bytes": len(json.dumps(snapshot).encode()),
            "real_runtime_storage": True,
            "notifications": False,
            "samples": samples,
        }

        def write() -> None:
            output.mkdir(parents=True, exist_ok=True)
            (output / "acknowledgment.json").write_text(json.dumps(report, indent=2))

        await hass.async_add_executor_job(write)
        assert await hass.config_entries.async_unload(entry.entry_id)
