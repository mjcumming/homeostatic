"""Debug-level timing trace: refresh causes, evaluation phases, summaries and GC."""

import gc
import logging
from copy import deepcopy
from datetime import timedelta
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, SWEEP_INTERVAL
from tests.test_lifecycle import start_monitor

TIMING_LOGGER = "custom_components.homeostatic.save_timing"


def _lines(caplog: pytest.LogCaptureFixture, phase: str) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == TIMING_LOGGER
        and record.getMessage().startswith(f"phase={phase} ")
    ]


def _fields(line: str) -> dict[str, str]:
    return dict(item.split("=", 1) for item in line.split(" ") if "=" in item)


async def test_refreshes_name_their_cause_and_split_evaluation(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """Each refresh logs its cause, whether it discovered, and the evaluation phases."""
    caplog.set_level(logging.DEBUG, logger=TIMING_LOGGER)
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    startup = [_fields(line) for line in _lines(caplog, "refresh")]
    assert startup and startup[0]["cause"] == "start"
    assert startup[0]["discover"] == "True"
    caplog.clear()

    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    state = [_fields(line) for line in _lines(caplog, "refresh")]
    assert state and all(fields["cause"] == "state" for fields in state)
    assert state[-1]["discover"] == "False"
    evaluate = [_fields(line) for line in _lines(caplog, "evaluate")]
    assert (
        evaluate
        and {"discovery", "engine", "catalog", "policy", "rest", "total"}
        <= evaluate[-1].keys()
    )
    assert float(evaluate[-1]["discovery"]) < float(evaluate[-1]["total"]) + 1e-9
    caplog.clear()

    ar.async_get(hass).async_create("Workshop")
    await hass.async_block_till_done()
    registry = [_fields(line) for line in _lines(caplog, "refresh")]
    assert registry and registry[-1]["cause"] == "registry"
    assert registry[-1]["discover"] == "True"
    caplog.clear()

    async_fire_time_changed(hass, dt_util.utcnow() + SWEEP_INTERVAL)
    await hass.async_block_till_done()
    summary = [_fields(line) for line in _lines(caplog, "summary")]
    assert len(summary) == 1
    assert int(summary[0]["refreshes"]) >= 0 and int(summary[0]["saves"]) >= 0
    reconcile = [_fields(line) for line in _lines(caplog, "refresh")]
    assert reconcile and reconcile[-1]["cause"] == "sweep"
    assert reconcile[-1]["reconcile"] == "True"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_save_reports_the_lock_holder(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """A save names what held the runtime lock, and refreshes release it."""
    caplog.set_level(logging.DEBUG, logger=TIMING_LOGGER)
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime._lock_holder is None
    changed = deepcopy(config_data)
    changed["monitoring_policies"][0]["name"] = "Renamed policy"
    caplog.clear()
    await runtime.async_apply_settings(Settings.from_data(changed))
    lock = [_fields(line) for line in _lines(caplog, "runtime_lock")]
    assert lock and lock[0]["holder"] == "none"
    assert runtime._lock_holder is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_gc_pauses_are_timed_only_while_running(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """The collector callback is installed with the runtime and removed with it."""
    caplog.set_level(logging.DEBUG, logger=TIMING_LOGGER)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime._on_gc in gc.callbacks
    caplog.clear()
    gc.collect()
    lines = [_fields(line) for line in _lines(caplog, "gc")]
    assert lines and lines[-1]["generation"] == "2"
    assert float(lines[-1]["seconds"]) >= 0
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert runtime._on_gc not in gc.callbacks
    caplog.clear()
    gc.collect()
    assert not _lines(caplog, "gc")


async def test_deadline_refreshes_are_distinguished(
    hass: HomeAssistant, config_data: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """A scheduled deadline refresh is named separately from state-driven ones."""
    caplog.set_level(logging.DEBUG, logger=TIMING_LOGGER)
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    caplog.clear()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=30))
    await hass.async_block_till_done()
    causes = {_fields(line)["cause"] for line in _lines(caplog, "refresh")}
    assert causes & {"deadline", "sweep"}
    assert await hass.config_entries.async_unload(entry.entry_id)
