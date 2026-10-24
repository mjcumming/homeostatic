"""Temperature reports preserve evidence while avoiding unrelated discovery work."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, SAVE_COALESCE_SECONDS
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


async def test_temperature_readings_use_existing_inventory_and_preserve_gaps(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Failure, missing evidence and recovery need no inventory scan or new check."""
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set("sensor.room", "20", attributes)
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy(
                "temperature",
                {"entity": ["entity_id:sensor.room"]},
                check="temperature_limit",
                parameters={"unit": "°C", "minimum": 10, "duration_seconds": 0},
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    inventory = runtime.inventory_static
    engine = runtime.engine
    assert engine is not None
    with (
        patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
        patch.object(runtime, "_save", wraps=runtime._save) as save,
        patch.object(
            type(engine),
            "register_many",
            autospec=True,
            side_effect=type(engine).register_many,
        ) as register,
    ):
        hass.states.async_set("sensor.room", "0", attributes)
        await hass.async_block_till_done()
        [episode] = runtime.episodes
        for value in ("unknown", "unavailable"):
            hass.states.async_set("sensor.room", value, attributes)
            await hass.async_block_till_done()
            assert set(runtime.episodes) == {episode}
        hass.states.async_set("sensor.room", "20", attributes)
        await hass.async_block_till_done()
        assert not runtime.episodes
        assert runtime.history.snapshot()["episodes"][0]["resolution"] == "cleared"
        assert runtime.inventory_static is inventory
        # Gap readings changed no episode; the resolving save flushed them.
        assert save.await_count == 3
        assert not runtime._save_pending
        discover.assert_not_called()
        register.assert_not_called()
        assert await runtime.store.async_load() == runtime.snapshot()
        hass.states.async_set(
            "sensor.room", "20", {**attributes, "friendly_name": "Renamed room"}
        )
        await hass.async_block_till_done()
        assert discover.call_count == 1
        assert runtime.inventory_static is not inventory
        assert any(
            source.name == "Renamed room" for source in runtime.candidates.values()
        )
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("registered", [False, True])
async def test_thermostat_refresh_follows_selected_enrollment_transitions(
    hass: HomeAssistant, config_data: dict[str, Any], registered: bool
) -> None:
    """Readings stay local; selected off/heat changes reconcile without losing gaps."""
    reference = "entity_id:climate.room"
    if registered:
        entity = er.async_get(hass).async_get_or_create(
            "climate", "test", "room", suggested_object_id="room"
        )
        reference = f"registry:{entity.id}"
    attributes = {"current_temperature": 20, "temperature": 22}
    hass.states.async_set("climate.room", "heat", attributes)
    hass.states.async_set("climate.other", "heat", attributes)
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy(
                "thermostat",
                {"entity": [reference]},
                check="thermostat",
                parameters={"unit": "°C", "worsening": 1},
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with (
        patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
        patch.object(runtime, "_save", wraps=runtime._save) as save,
    ):
        for mode in ("heat", "off", "heat"):
            hass.states.async_set(
                "climate.other", mode, {**attributes, "current_temperature": 18}
            )
            await hass.async_block_till_done()
        discover.assert_not_called()
        save.assert_not_awaited()
        hass.states.async_set(
            "climate.room", "heat", {**attributes, "current_temperature": 18}
        )
        await hass.async_block_till_done()
        [episode] = runtime.episodes
        for mode, additional in (
            ("unknown", {}),
            ("unavailable", {}),
            ("off", {"restored": True}),
        ):
            hass.states.async_set("climate.room", mode, {**attributes, **additional})
            await hass.async_block_till_done()
            assert set(runtime.episodes) == {episode}
        discover.assert_not_called()
        hass.states.async_set("climate.room", "off", attributes)
        await hass.async_block_till_done()
        assert not runtime.episodes
        assert not runtime.producers.temperature_monitors
        assert discover.call_count == 1
        assert runtime.history.snapshot()["episodes"][0]["resolution"] == "removed"
        hass.states.async_set("climate.room", "heat", attributes)
        await hass.async_block_till_done()
        assert len(runtime.producers.temperature_monitors) == 1
        assert discover.call_count == 2
        # Re-enrollment changed no episode; its save waits for the window.
        async_fire_time_changed(
            hass, dt_util.utcnow() + timedelta(seconds=SAVE_COALESCE_SECONDS + 1)
        )
        await hass.async_block_till_done()
        assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)
