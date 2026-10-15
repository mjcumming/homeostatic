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
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.runtime import Runtime
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import populate

_STORE_LOAD = Store._async_load
_STORE_WRITE = Store._async_write_data


@contextmanager
def profile_phases(totals: dict[str, float]) -> Iterator[None]:
    """Measure inclusive phase times without changing production scheduling."""
    with ExitStack() as stack:
        for owner, name, phase, asynchronous in (
            (Runtime, "async_stop", "stop_drain", True),
            (Runtime, "async_load", "snapshot_load", True),
            (Runtime, "async_start", "startup", True),
            (Runtime, "_save", "persistence", True),
            (Runtime, "async_apply_settings", "apply_including_lock", True),
            (Runtime, "_drain_pending", "pending_observations", True),
            (Runtime, "snapshot", "snapshot_creation", False),
            (Runtime, "_route_signatures", "route_signatures", False),
            (Runtime, "_discover", "discovery", False),
            (Runtime, "inventory_updates", "dynamic_inventory", False),
            (
                runtime_module,
                "unavailable_destinations",
                "destination_discovery",
                False,
            ),
            (Runtime, "_evaluate", "engine_policy", False),
            (dashboard, "_settings_candidate", "validation", True),
            (dashboard, "snapshot", "publication", False),
            (dashboard, "_settings_configuration", "settings_response", False),
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
        notifications=False,
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


@contextmanager
def real_runtime_storage(directory: Path) -> Iterator[None]:
    """Keep registry fixtures isolated while measuring real runtime Store I/O."""
    initialize = Runtime.__init__
    with ExitStack() as stack:

        def initialize_with_storage(
            runtime: Runtime, *args: Any, **kwargs: Any
        ) -> None:
            initialize(runtime, *args, **kwargs)
            for attribute, value in (
                ("path", str(directory / runtime.store.key)),
                ("_async_load", _STORE_LOAD.__get__(runtime.store)),
                ("_async_write_data", _STORE_WRITE.__get__(runtime.store)),
            ):
                stack.enter_context(patch.object(runtime.store, attribute, value))

        stack.enter_context(
            patch.object(Runtime, "__init__", new=initialize_with_storage)
        )
        yield


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_SAVE_PROFILE") != "1", reason="Opt-in save profiling"
)
@pytest.mark.parametrize(
    ("journey", "path", "values", "in_place"),
    [
        pytest.param(
            "profile_name",
            ("notification_definitions", "profiles", "morning", "name"),
            ("Renamed", "Morning summary"),
            True,
            id="profile-name",
        ),
        pytest.param(
            "profile_timing",
            ("notification_definitions", "profiles", "morning", "timing", "at"),
            ("09:00", "08:00"),
            True,
            id="profile-timing",
        ),
        pytest.param(
            "policy_assignment",
            ("monitoring_policies", 0, "notifications", 0, "profile"),
            ("evening", "morning"),
            True,
            id="policy-assignment",
        ),
        pytest.param(
            "profile_methods",
            ("notification_definitions", "profiles", "morning", "methods"),
            (["other"], ["test"]),
            True,
            id="profile-methods",
        ),
        pytest.param(
            "method_definition",
            ("notification_definitions", "methods", "test", "name"),
            ("Renamed method", "Test"),
            True,
            id="method-definition",
        ),
    ],
)
async def test_notification_editor_save_profile(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    journey: str,
    path: tuple[str | int, ...],
    values: tuple[Any, Any],
    in_place: bool,
    tmp_path: Path,
) -> None:
    """Separate save acknowledgment and settings reread with real runtime storage."""
    shape = populate(hass)
    phone_count = int(os.environ.get("HOMEOSTATIC_PROFILE_PHONES", "0"))
    for index in range(phone_count):
        phone = MockConfigEntry(
            domain="mobile_app", title=f"Phone {index}", state=ConfigEntryState.LOADED
        )
        phone.add_to_hass(hass)
        dr.async_get(hass).async_get_or_create(
            config_entry_id=phone.entry_id,
            identifiers={("mobile_app", f"phone_{index}")},
            name=f"Phone {index}",
        )
    for entity_id in shape.entities[-30:]:
        hass.states.async_set(entity_id, "unavailable")
    definitions = config_data["notification_definitions"]
    definitions["methods"]["other"] = {
        "name": "Other",
        "mode": "fixed",
        "destinations": ["service:other_test"],
    }
    definitions["profiles"]["morning"]["methods"] = ["test"]
    definitions["profiles"]["evening"]["methods"] = ["test"]
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
                "notifications": [{"id": "default", "profile": "morning"}],
            }
        ],
    )
    results = []
    ids = itertools.count(1)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with real_runtime_storage(tmp_path):
        await start_monitor(hass, entry)
        client = await hass_ws_client(hass)
        for load, value, burst in (
            ("first_after_completed_startup", values[0], ()),
            ("settled", values[1], ()),
            ("observation_burst", values[0], shape.entities[:50]),
        ):
            await client.send_json(
                {
                    "id": next(ids),
                    "type": "homeostatic/configuration",
                    "section": "settings",
                }
            )
            current = (await client.receive_json())["result"]
            proposed = deepcopy(current["settings"])
            target = proposed
            for part in path[:-1]:
                target = target[part]
            target[path[-1]] = value
            totals: dict[str, float] = defaultdict(float)
            before = entry.runtime_data
            with profile_phases(totals):
                started = perf_counter()
                for entity_id in burst:
                    hass.states.async_set(entity_id, "unavailable")
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
                read_started = perf_counter()
                await client.send_json(
                    {
                        "id": next(ids),
                        "type": "homeostatic/configuration",
                        "section": "settings",
                    }
                )
                saved = (await client.receive_json())["result"]
                settings_read = perf_counter() - read_started
                completed = perf_counter() - started
            assert saved["settings"] == proposed
            assert (entry.runtime_data is before) is in_place
            assert not entry.runtime_data.settings.notifications
            assert not entry.runtime_data.delivery.outbox
            stored_file = await hass.async_add_executor_job(
                Path(entry.runtime_data.store.path).stat
            )
            assert stored_file.st_size > 0
            results.append(
                {
                    "load": load,
                    "queued_state_changes": len(burst),
                    "snapshot_bytes": stored_file.st_size,
                    "episodes": len(entry.runtime_data.episodes),
                    "save_response_seconds": applied,
                    "settings_read_seconds": settings_read,
                    "editor_requests_seconds": completed,
                    "phases_inclusive": dict(totals),
                }
            )
            await hass.async_block_till_done()
        assert await hass.config_entries.async_unload(entry.entry_id)
        await client.close()
    report = {
        "entities": len(shape.entities),
        "devices": len(shape.devices),
        "journey": journey,
        "synthetic_phone_count": phone_count,
        "runtime_storage": "real_store_io",
        "registry_storage": "mocked",
        "results": results,
    }
    output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))

    def write() -> None:
        output.mkdir(parents=True, exist_ok=True)
        (output / f"notification-save-{journey}.json").write_text(
            json.dumps(report, indent=2)
        )

    await hass.async_add_executor_job(write)
