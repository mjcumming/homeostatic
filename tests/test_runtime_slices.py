"""Observation slicing preserves rapid transitions and later arrivals."""

import asyncio
from datetime import timedelta
from itertools import count
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant, callback
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("step", "yields"), [(0.0, 2), (0.021, 19)], ids=["batch-limit", "time-limit"]
)
async def test_observation_slice_budget(
    hass: HomeAssistant, config_data: dict[str, Any], step: float, yields: int
) -> None:
    """Elapsed work can yield before eight batches without losing transitions."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with (
        patch(
            "custom_components.homeostatic.runtime.perf_counter",
            side_effect=count(0, step),
        ),
        patch.object(
            runtime, "_yield_observations", wraps=runtime._yield_observations
        ) as pause,
    ):
        for _ in range(10):
            hass.states.async_set("sensor.observed", "unavailable")
            hass.states.async_set("sensor.observed", "42")
        await hass.async_block_till_done()
    assert pause.call_count == yields
    assert len(runtime.history.snapshot()["episodes"]) == 10
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_burst_yields_and_retains_later_evidence(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A callback runs mid-drain and a newer observation is applied in order."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    progressed: list[int] = []
    injected = asyncio.Event()

    @callback
    def later_evidence() -> None:
        progressed.append(len(runtime.history.snapshot()["episodes"]))
        freezer.tick(timedelta(seconds=1))
        hass.states.async_set("sensor.observed", "unavailable")
        injected.set()

    async def yield_with_evidence() -> None:
        future = hass.loop.create_future()
        hass.loop.call_soon(later_evidence)
        hass.loop.call_soon(future.set_result, None)
        await future

    with patch.object(
        runtime,
        "_yield_observations",
        side_effect=yield_with_evidence,
    ):
        for _ in range(10):
            hass.states.async_set("sensor.observed", "unavailable")
            hass.states.async_set("sensor.observed", "42")
        await hass.async_block_till_done()

    assert injected.is_set()
    assert 0 < progressed[0] < 10
    assert len(runtime.history.snapshot()["episodes"]) == 10
    assert len(runtime.episodes) == 1
    assert runtime.readiness == "degraded"
    assert runtime.available
    assert not runtime.delivery.outbox
    episode = next(iter(runtime.episodes))
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert list(entry.runtime_data.episodes) == [episode]
    assert await hass.config_entries.async_unload(entry.entry_id)
