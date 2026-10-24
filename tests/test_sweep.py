"""Events update their subject; the installation is swept every 15 minutes (ADR 0098)."""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic import enrollment
from custom_components.homeostatic.const import DOMAIN, SWEEP_INTERVAL
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_startup_quiet import fresh_start


def _watched_integration(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> MockConfigEntry:
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data["monitoring_policies"].append(
        monitoring_policy(
            "entries", {"kind": ["integration"], "integration": [source.entry_id]}
        )
    )
    return source


async def test_state_refresh_observes_only_its_subject(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A state change refreshes without re-observing integration entries; a sweep observes all."""
    config_data["notifications"] = False
    _watched_integration(hass, config_data)
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with patch.object(
        runtime.producers, "observe_entry", wraps=runtime.producers.observe_entry
    ) as entries:
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        assert runtime.episodes
        entries.assert_not_called()
        await runtime.async_refresh(reconcile=True, cause="sweep")
        assert entries.call_count == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_neutral_entry_update_requests_no_refresh(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An entry update that changes nothing visible requests no refresh; a rename rediscovers."""
    config_data["notifications"] = False
    source = _watched_integration(hass, config_data)
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with patch.object(
        runtime, "_request_refresh", wraps=runtime._request_refresh
    ) as requests:
        hass.config_entries.async_update_entry(source, options={"poll": 30})
        await hass.async_block_till_done()
        requests.assert_not_called()
        hass.config_entries.async_update_entry(source, title="Renamed controller")
        await hass.async_block_till_done()
        requests.assert_called_with(reconcile=True, cause="config_entry")
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_sweep_rediscovers_every_fifteen_minutes(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """No refresh runs on a quiet minute; the sweep reads the registries again."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    scans: list[int] = []
    original = enrollment.inventory

    def counting(*args: Any, **kwargs: Any) -> Any:
        scans.append(1)
        return original(*args, **kwargs)

    with (
        patch("custom_components.homeostatic.runtime.inventory", side_effect=counting),
        patch.object(
            runtime, "async_refresh", wraps=runtime.async_refresh
        ) as refreshes,
    ):
        async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=60))
        await hass.async_block_till_done()
        refreshes.assert_not_called()
        assert scans == []
        async_fire_time_changed(hass, dt_util.utcnow() + SWEEP_INTERVAL)
        await hass.async_block_till_done()
        assert len(scans) == 1
        assert refreshes.call_args.kwargs == {"reconcile": True, "cause": "sweep"}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_startup_hold_ends_on_its_own_clock(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """With no events, the hold ends when the startup grace elapses."""
    config_data["notifications"] = False
    config_data["timings"] = {
        **config_data["timings"],
        "startup_grace": 30,
        "startup_quiet_max": 120,
    }
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await fresh_start(hass, entry)
    assert runtime.startup_quiet
    freezer.tick(timedelta(seconds=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert not runtime.startup_quiet
    assert await hass.config_entries.async_unload(entry.entry_id)
