"""Isolated runtime load measurements; no connection to a household instance."""

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD, SIGNAL_DASHBOARD
from custom_components.homeostatic.runtime import Runtime
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_lifecycle import start_monitor


@dataclass(frozen=True, slots=True, kw_only=True)
class InventoryShape:
    """Synthetic identities grouped into controllers, devices and capabilities."""

    owners: tuple[MockConfigEntry, ...]
    devices: tuple[str, ...]
    entities: tuple[str, ...]


def populate(hass: HomeAssistant) -> InventoryShape:
    """Create a reproducible 6,000-entity registry, not a physical-house replica."""
    owners = tuple(
        MockConfigEntry(
            domain="test", title=f"Controller {i}", state=ConfigEntryState.LOADED
        )
        for i in range(10)
    )
    for owner in owners:
        owner.add_to_hass(hass)
    device_ids = []
    entity_ids = []
    for index in range(300):
        owner = owners[index // 30]
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("test", f"device_{index}")},
            name=f"Device {index}",
        )
        device_ids.append(device.id)
        for capability in range(20):
            entity = er.async_get(hass).async_get_or_create(
                "sensor",
                "test",
                f"device_{index}_capability_{capability}",
                config_entry=owner,
                device_id=device.id,
            )
            entity_ids.append(entity.entity_id)
            hass.states.async_set(entity.entity_id, "0")
    return InventoryShape(
        owners=owners, devices=tuple(device_ids), entities=tuple(entity_ids)
    )


async def changes(hass: HomeAssistant, entities: tuple[str, ...], state: str) -> None:
    """Deliver one burst through HA's real state-change event listeners."""
    for entity_id in entities:
        hass.states.async_set(entity_id, state)
    await hass.async_block_till_done()


async def measure(
    hass: HomeAssistant,
    runtime: Runtime,
    operation: Callable[[], Awaitable[None]],
) -> dict[str, float | int]:
    """Measure callback starvation and compact evidence updates without sleeping."""
    loop = asyncio.get_running_loop()
    previous = perf_counter()
    gaps: list[float] = []
    payload_sizes: list[int] = []
    handle: asyncio.Handle | None = None

    def probe() -> None:
        nonlocal previous, handle
        current = perf_counter()
        gaps.append(current - previous)
        previous = current
        handle = loop.call_soon(probe)

    @callback
    def dashboard_client() -> None:
        payload_sizes.append(len(json.dumps(hass.data[DATA_DASHBOARD].update).encode()))

    cancel = async_dispatcher_connect(hass, SIGNAL_DASHBOARD, dashboard_client)
    handle = loop.call_soon(probe)
    engine, policy = runtime.engine, runtime.policy
    assert engine is not None
    assert policy is not None
    started = perf_counter()
    try:
        with (
            patch.object(runtime, "_save", wraps=runtime._save) as saves,
            patch.object(runtime, "_discover", wraps=runtime._discover) as discoveries,
            patch.object(runtime, "_evaluate", wraps=runtime._evaluate) as evaluations,
            patch.object(
                type(engine),
                "ingest_many",
                autospec=True,
                side_effect=type(engine).ingest_many,
            ) as ingestions,
            patch.object(
                type(engine), "advance", autospec=True, side_effect=type(engine).advance
            ) as engine_advances,
            patch.object(
                type(policy), "advance", autospec=True, side_effect=type(policy).advance
            ) as policy_advances,
        ):
            await operation()
            await hass.async_block_till_done()
            elapsed = perf_counter() - started
            return {
                "seconds": round(elapsed, 6),
                "max_loop_gap_seconds": round(max(gaps, default=0), 6),
                "save_calls": saves.call_count,
                "inventory_scans": discoveries.call_count,
                "evaluation_calls": evaluations.call_count,
                "engine_ingestion_calls": ingestions.call_count,
                "engine_advance_calls": engine_advances.call_count,
                "policy_advance_calls": policy_advances.call_count,
                "dashboard_publications": len(payload_sizes),
                "dashboard_bytes": sum(payload_sizes),
                "max_dashboard_bytes": max(payload_sizes, default=0),
            }
    finally:
        cancel()
        if handle is not None:
            handle.cancel()


def save_profile(output: Path, scope: str, results: dict[str, Any]) -> None:
    """Write the opt-in report after the measured operations have finished."""
    output.mkdir(parents=True, exist_ok=True)
    (output / f"runtime-{scope}.json").write_text(json.dumps(results, indent=2))


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_RUNTIME_PROFILE") != "1",
    reason="Opt-in burst profiling for large installations",
)
@pytest.mark.parametrize("scope", ["device_group", "all_entities"])
async def test_registered_inventory_runtime_load(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    scope: str,
    record_property: Callable[[str, object], None],
    tmp_path: Path,
) -> None:
    """Measure normal traffic, outage, recovery, reconciliation and reload."""
    shape = populate(hass)
    matches = {
        "device_group": {"kind": ["entity"], "device": list(shape.devices[:3])},
        "all_entities": {"kind": ["entity"]},
    }
    config_data.update(
        monitoring_policies=[
            monitoring_policy("controllers", {"kind": ["integration"]}),
            monitoring_policy("capabilities", matches[scope]),
            monitoring_policy(
                "providers", {"kind": ["entity"]}, check="entity_not_provided"
            ),
        ],
        notifications=False,
    )
    config_data["timings"]["coalesce_count"] = 10000
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    started = perf_counter()
    runtime = await start_monitor(hass, entry)
    results: dict[str, Any] = {
        "scope": scope,
        "availability_scope": scope,
        "provider_scope": "all_registered_entities",
        "setup_seconds": perf_counter() - started,
    }
    results["watched_sources"] = len(runtime.sources)
    results["provider_sources"] = sum(
        source.kind == "entity_not_provided" for source in runtime.sources.values()
    )
    assert results["provider_sources"] == len(shape.entities)
    results["initial_payload_bytes"] = len(
        json.dumps(hass.data[DATA_DASHBOARD].value).encode()
    )
    assert runtime.readiness == "ready"
    results["ordinary_300_updates"] = await measure(
        hass,
        runtime,
        lambda: changes(hass, shape.entities[:300], "1"),
    )
    for counter in (
        "save_calls",
        "inventory_scans",
        "evaluation_calls",
        "engine_ingestion_calls",
        "engine_advance_calls",
        "policy_advance_calls",
        "dashboard_publications",
    ):
        assert results["ordinary_300_updates"][counter] == 0, counter
    results["outage_60_updates"] = await measure(
        hass,
        runtime,
        lambda: changes(hass, shape.entities[:60], "unavailable"),
    )
    assert runtime.readiness == "degraded"
    assert len(runtime.episodes) == 60
    results["recovery_60_updates"] = await measure(
        hass,
        runtime,
        lambda: changes(hass, shape.entities[:60], "2"),
    )
    assert runtime.readiness == "ready"
    assert not runtime.episodes
    results["unchanged_reconciliation"] = await measure(
        hass, runtime, runtime.async_refresh
    )
    shape.owners[0]._async_set_state(
        hass, ConfigEntryState.SETUP_ERROR, "Test controller lost"
    )
    await changes(hass, shape.entities[:60], "unavailable")
    assert len(runtime.episodes) == 1
    assert next(iter(runtime.episodes.values()))["anchor"] == bound_identity(
        config_data["monitoring_policies"][0], f"entry:{shape.owners[0].entry_id}"
    )
    episode_id = next(iter(runtime.episodes))
    started = perf_counter()
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    results["reload_seconds"] = perf_counter() - started
    assert list(entry.runtime_data.episodes) == [episode_id]
    assert entry.runtime_data.readiness == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)
    record_property("runtime_profile", json.dumps(results))
    output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))
    await hass.async_add_executor_job(save_profile, output, scope, results)


@pytest.mark.skipif(
    os.environ.get("HOMEOSTATIC_RUNTIME_PROFILE") != "1",
    reason="Opt-in burst profiling for large installations",
)
async def test_one_capability_per_device_runtime_load(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    record_property: Callable[[str, object], None],
    tmp_path: Path,
) -> None:
    """Measure a device-sized scope with independent outages."""
    shape = populate(hass)
    registry = er.async_get(hass)
    representatives = []
    for entity_id in shape.entities[::20]:
        registered = registry.async_get(entity_id)
        assert registered is not None
        representatives.append(f"registry:{registered.id}")
    config_data.update(
        monitoring_policies=[
            monitoring_policy("controllers", {"kind": ["integration"]}),
            monitoring_policy(
                "representatives", {"kind": ["entity"], "entity": representatives}
            ),
        ],
        notifications=False,
    )
    config_data["timings"]["coalesce_count"] = 10000
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    started = perf_counter()
    runtime = await start_monitor(hass, entry)
    results: dict[str, Any] = {
        "scope": "one_capability_per_device",
        "setup_seconds": perf_counter() - started,
        "watched_sources": len(runtime.sources),
        "initial_payload_bytes": len(
            json.dumps(hass.data[DATA_DASHBOARD].value).encode()
        ),
    }
    outage_entities = shape.entities[::20][:60]
    results["outage_60_devices"] = await measure(
        hass,
        runtime,
        lambda: changes(hass, outage_entities, "unavailable"),
    )
    assert len(runtime.episodes) == 60
    results["recovery_60_devices"] = await measure(
        hass,
        runtime,
        lambda: changes(hass, outage_entities, "1"),
    )
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
    record_property("runtime_profile", json.dumps(results))
    output = Path(os.environ.get("HOMEOSTATIC_PROFILE_DIR", str(tmp_path)))
    await hass.async_add_executor_job(
        save_profile, output, "one_capability_per_device", results
    )
