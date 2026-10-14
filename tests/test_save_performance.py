"""Opt-in isolated save-to-catalog latency measurement."""

import itertools
import json
import os
from collections import defaultdict
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager, nullcontext
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.runtime import Runtime
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import populate


@contextmanager
def profile_phases(totals: dict[str, float]) -> Iterator[None]:
    """Measure inclusive phase times without changing production scheduling."""
    with ExitStack() as stack:
        for owner, name, phase, asynchronous in (
            (Runtime, "async_stop", "stop_drain", True),
            (Runtime, "async_load", "snapshot_load", True),
            (Runtime, "async_start", "startup", True),
            (Runtime, "_save", "persistence", True),
            (Runtime, "_discover", "discovery", False),
            (Runtime, "_evaluate", "engine_policy", False),
            (dashboard, "_settings_candidate", "validation", True),
            (dashboard, "snapshot", "publication", False),
        ):
            original = getattr(owner, name)
            if asynchronous:

                def wrap_async(fn: Any, label: str) -> Any:
                    async def measured(*args: Any, **kwargs: Any) -> Any:
                        started = perf_counter()
                        try:
                            return await fn(*args, **kwargs)
                        finally:
                            totals[label] += perf_counter() - started

                    return measured

                wrapped = wrap_async(original, phase)
            else:

                def wrap_sync(fn: Any, label: str) -> Any:
                    def measured(*args: Any, **kwargs: Any) -> Any:
                        started = perf_counter()
                        try:
                            return fn(*args, **kwargs)
                        finally:
                            totals[label] += perf_counter() - started

                    return measured

                wrapped = callback(wrap_sync(original, phase))
            stack.enter_context(patch.object(owner, name, wrapped))
        yield


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_SAVE_PROFILE") != "1", reason="Opt-in save profiling"
)
@pytest.mark.parametrize("kind", ["device", "entity", "repair"])
async def test_save_to_visible_profile(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    kind: str,
    tmp_path: Path,
) -> None:
    """Time a real settings request followed by every frontend catalog page."""
    shape = populate(hass)
    for index in range(10):
        ir.async_create_issue(
            hass,
            "test",
            f"profile_{index}",
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key="profile",
        )
    reload_baseline = os.environ.get("HOMEOSTATIC_SAVE_BASELINE") == "1"
    concurrency = 1 if reload_baseline else 4
    config_data.update(
        entities=[],
        notifications=False,
        rules=[],
        monitoring_policy_version=1,
        monitoring_policies=[
            {
                "id": "watch",
                "name": "Watch",
                "check": "repair" if kind == "repair" else "availability",
                "match": {} if kind == "repair" else {"kind": [kind]},
                "parameters": {},
                "enabled": True,
                "notifications": [],
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    results = []
    ids = itertools.count(1)
    for enabled in (False, True) * 3:
        await client.send_json({"id": next(ids), "type": "homeostatic/configuration"})
        current = (await client.receive_json())["result"]
        proposed = deepcopy(current["settings"])
        proposed["monitoring_policies"][0]["enabled"] = enabled
        totals: dict[str, float] = defaultdict(float)
        started = perf_counter()
        baseline = (
            patch.object(Runtime, "can_apply_settings", return_value=False)
            if reload_baseline
            else nullcontext()
        )
        with baseline, profile_phases(totals):
            await client.send_json(
                {
                    "id": next(ids),
                    "type": "homeostatic/save_settings",
                    "revision": current["revision"],
                    "settings": proposed,
                }
            )
            response = await client.receive_json()
            assert response.get("result") == {"saved": True}, response
            applied = perf_counter() - started
            model = hass.data[dashboard.DATA_DASHBOARD]
            pages = [
                (section, offset)
                for section, rows in model.catalog_sections.items()
                for offset in range(0, len(rows), 200)
            ]
            for start in range(0, len(pages), concurrency):
                batch = pages[start : start + concurrency]
                for section, offset in batch:
                    await client.send_json(
                        {
                            "id": next(ids),
                            "type": "homeostatic/catalog",
                            "revision": model.catalog_revision,
                            "section": section,
                            "offset": offset,
                        }
                    )
                for _ in batch:
                    page = await client.receive_json()
                    assert page["success"], page
            await hass.async_block_till_done()
        results.append(
            {
                "enabled": enabled,
                "applied_seconds": applied,
                "visible_seconds": perf_counter() - started,
                "phases_inclusive": dict(totals),
            }
        )
    output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))
    report = {
        "entities": len(shape.entities),
        "devices": len(shape.devices),
        "kind": kind,
        "mode": "reload_serial_catalog"
        if reload_baseline
        else "in_place_bounded_catalog",
        "results": results,
    }

    def write() -> None:
        output.mkdir(parents=True, exist_ok=True)
        (output / f"save-{kind}.json").write_text(json.dumps(report, indent=2))

    await hass.async_add_executor_job(write)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
