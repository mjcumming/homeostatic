"""Opt-in policy edit timings against isolated inventory and real runtime storage."""

import json
import os
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import populate
from tests.test_save_performance import profile_phases, real_runtime_storage


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_POLICY_PROFILE") != "1",
    reason="Opt-in policy save profiling for large installations",
)
@pytest.mark.parametrize("edit", ["name", "parameters"])
async def test_temperature_policy_save_profile(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    tmp_path: Path,
    edit: str,
) -> None:
    """Measure three complete policy saves and confirmed-settings responses."""
    shape = populate(hass)
    for entity_id in shape.entities[:2]:
        hass.states.async_set(
            entity_id,
            "70",
            {"unit_of_measurement": "°F", "device_class": "temperature"},
        )
    config_data.update(
        monitoring_policies=[
            monitoring_policy("entities", {"kind": ["entity"]}),
            monitoring_policy(
                "temperature",
                {
                    "entity": [
                        f"entity_id:{identity}" for identity in shape.entities[:2]
                    ]
                },
                check="temperature_limit",
                parameters={"unit": "°F", "minimum": 60, "duration_seconds": 10},
            ),
        ],
        notifications=False,
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    results = []
    with real_runtime_storage(tmp_path):
        runtime = await start_monitor(hass, entry)
        client = await hass_ws_client(hass)
        for index in range(3):
            await client.send_json(
                {
                    "id": index * 3 + 1,
                    "type": "homeostatic/configuration",
                    "section": "settings",
                }
            )
            current = (await client.receive_json())["result"]
            proposed = deepcopy(current["settings"])
            proposed["monitoring_policies"][1][edit] = {
                "name": f"Temperature {index}",
                "parameters": {
                    "unit": "°F",
                    "minimum": 61 + index,
                    "maximum": None,
                    "duration_seconds": 10,
                },
            }[edit]
            phases: dict[str, float] = defaultdict(float)
            with profile_phases(phases):
                started = perf_counter()
                await client.send_json(
                    {
                        "id": index * 3 + 2,
                        "type": "homeostatic/save_settings",
                        "revision": current["revision"],
                        "settings": proposed,
                    }
                )
                response = await client.receive_json()
                assert response.get("result") == {"saved": True}, response
                elapsed = perf_counter() - started
                await client.send_json(
                    {
                        "id": index * 3 + 3,
                        "type": "homeostatic/configuration",
                        "section": "settings",
                    }
                )
                saved = (await client.receive_json())["result"]
                complete = perf_counter() - started
            assert saved["settings"] == proposed
            assert entry.runtime_data is runtime
            assert not runtime.settings.notifications
            assert not runtime.delivery.outbox
            results.append(
                {
                    "save_seconds": elapsed,
                    "editor_requests_seconds": complete,
                    "phases_inclusive": dict(phases),
                }
            )
            await hass.async_block_till_done()
        stored_file = await hass.async_add_executor_job(Path(runtime.store.path).stat)
        report = {
            "edit": edit,
            "entities": len(shape.entities),
            "devices": len(shape.devices),
            "runtime_storage": "real_store_io",
            "registry_storage": "mocked",
            "snapshot_bytes": stored_file.st_size,
            "results": results,
        }
        output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))

        def write() -> None:
            output.mkdir(parents=True, exist_ok=True)
            (output / f"policy-save-{edit}.json").write_text(
                json.dumps(report, indent=2)
            )

        await hass.async_add_executor_job(write)
        assert await hass.config_entries.async_unload(entry.entry_id)
        await client.close()
