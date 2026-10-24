"""Producer ownership preserves ordered evidence and the shared storage boundary."""

import asyncio
from copy import deepcopy
from typing import Any

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_EPISODE
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


async def test_mixed_producers_keep_queued_transitions_and_flat_state_on_reload(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A held worker retains fail/clear transitions across both capture paths."""
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set("sensor.observed", "1")
    hass.states.async_set("sensor.room", "20", attributes)
    config_data.update(notifications=False)
    config_data["monitoring_policies"].append(
        monitoring_policy(
            "room",
            {"entity": ["entity_id:sensor.room"]},
            check="temperature_limit",
            parameters={"unit": "°C", "minimum": 10, "duration_seconds": 0},
        )
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    settings = deepcopy(dict(entry.data))
    before = runtime.snapshot()
    facts = async_capture_events(hass, EVENT_EPISODE)
    captured: asyncio.Queue[str] = asyncio.Queue()

    @callback
    def received(event: Event[Any]) -> None:
        if event.data["entity_id"] in {"sensor.observed", "sensor.room"}:
            captured.put_nowait(event.data["entity_id"])

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, received)
    async with runtime._lock:
        for entity_id, state, attrs in (
            ("sensor.observed", "unavailable", {}),
            ("sensor.room", "0", attributes),
            ("sensor.observed", "1", {}),
            ("sensor.room", "20", attributes),
        ):
            hass.states.async_set(entity_id, state, attrs)
            assert await captured.get() == entity_id
        assert len(runtime._pending) == 4
        assert runtime.snapshot() == before
    cancel()
    await hass.async_block_till_done()

    assert not runtime.episodes
    assert [(event.data["change"], event.data["anchor_kind"]) for event in facts] == [
        ("opened", "entity"),
        ("opened", "temperature_limit"),
        ("resolved", "entity"),
        ("resolved", "temperature_limit"),
    ]
    history = runtime.history.snapshot()
    assert len(history["episodes"]) == 2
    assert {episode["resolution"] for episode in history["episodes"]} == {"cleared"}
    stored = await runtime.store.async_load()
    assert stored == runtime.snapshot()
    assert "producers" not in stored
    assert stored["temperature_monitors"]
    assert stored["ups_monitors"] == {}
    assert stored["retry_since"] == {}
    assert stored["delivery"] == before["delivery"]

    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert not runtime.episodes
        assert runtime.history.snapshot() == history
        assert entry.data == settings
        assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)
