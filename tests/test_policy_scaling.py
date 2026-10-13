"""Household-sized policy compilation and refresh regression scenarios."""

import json
from collections.abc import Callable
from pathlib import Path
from time import perf_counter
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_definitions
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor
from tests.test_runtime_scaling import measure, save_profile
from tests.test_unified_monitoring import policy


@pytest.mark.parametrize(
    "model", [pytest.param(0, id="existing"), pytest.param(1, id="unified")]
)
async def test_household_policy_runtime(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    record_property: Callable[[str, object], None],
    tmp_path: Path,
    model: int,
) -> None:
    """Four policies and one notification entry stay small across 3,966 sources."""
    entities = tuple(f"sensor.scale_{index}" for index in range(3966))
    for entity in entities:
        hass.states.async_set(entity, "1")
    definitions = notification_definitions.defaults()
    definitions["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:test"]}
    }
    config_data.update(
        entities=[],
        rules=[],
        notifications=False,
        monitoring_policy_version=model,
        notification_definitions=definitions,
        monitoring_policies=[
            policy("integrations", "availability", {"kind": ["integration"]}),
            policy(
                "entities",
                "availability",
                {"kind": ["entity"]},
                notifications=[
                    {
                        "id": "immediate",
                        "timing": {"mode": "immediate"},
                        "methods": ["phone"],
                    }
                ],
            ),
            policy("repairs", "repair", {"kind": ["repair"]}),
            policy("automations", "broken_automation", {"kind": ["broken_automation"]}),
        ],
    )
    started = perf_counter()
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    profile: dict[str, Any] = {
        "model": model,
        "setup_seconds": perf_counter() - started,
        "sources": len(runtime.sources),
        "rules": len(runtime._policy_config().rules),
    }

    async def unchanged_refresh() -> None:
        await runtime.async_refresh(reconcile=False)
        runtime.snapshot()
        _ = runtime.consumer_missing
        _ = runtime.evidence_gaps
        runtime.query("coverage", {})

    async def outage() -> None:
        for entity in entities[:82]:
            hass.states.async_set(entity, "unavailable")

    with patch.object(
        notification_definitions, "generate", wraps=notification_definitions.generate
    ) as compile_policy:
        profile["unchanged_refresh"] = await measure(hass, runtime, unchanged_refresh)
        profile["unchanged_compilations"] = compile_policy.call_count
        compile_policy.reset_mock()
        profile["outage_82"] = await measure(hass, runtime, outage)
        profile["outage_compilations"] = compile_policy.call_count
        compile_policy.reset_mock()
        profile["reconciliation"] = await measure(hass, runtime, runtime.async_refresh)
        profile["reconcile_compilations"] = compile_policy.call_count
        compile_policy.reset_mock()
        hass.states.async_set("sensor.scale_added", "1")
        await hass.async_block_till_done()
        profile["enrollment_compilations"] = compile_policy.call_count

    profile["snapshot_bytes"] = len(json.dumps(runtime.snapshot()).encode())
    record_property("runtime_profile", json.dumps(profile))
    await hass.async_add_executor_job(
        save_profile, tmp_path, f"policy-{model}", profile
    )
    assert profile["rules"] <= 8, profile
    assert profile["unchanged_compilations"] == 0, profile
    assert profile["outage_compilations"] == 0, profile
    assert profile["reconcile_compilations"] == 0, profile
    assert profile["enrollment_compilations"] == 1, profile
    assert len(runtime.episodes) == 82
    assert runtime.available
    assert runtime.readiness == "degraded"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert len(entry.runtime_data.episodes) == 82
    assert entry.runtime_data.readiness == "degraded"
    assert await hass.config_entries.async_unload(entry.entry_id)
