"""Entity availability waits qualify independently through public engine behavior."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.monitoring import parse_policies
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies
from tests.test_notification_collection import advance, configure


@pytest.mark.parametrize("duration", [-1, True, 1.5, "60", None, 31536001])
def test_invalid_availability_wait(duration: Any) -> None:
    """Invalid waits cannot turn into a different monitoring expectation."""
    row = monitoring_policy(
        "camera", {"kind": ["entity"]}, parameters={"duration_seconds": duration}
    )
    with pytest.raises(ValueError, match="whole-number duration"):
        parse_policies([row])


def test_zero_wait_retains_published_detection_identity() -> None:
    """Opening and saving the effective old default retains issue identities."""
    row = monitoring_policy("camera", {"kind": ["entity"]})
    [implicit] = parse_policies([row])
    [explicit] = parse_policies([{**row, "parameters": {"duration_seconds": 0}}])
    assert implicit.data()["parameters"] == {}
    assert implicit.detection_key() == explicit.detection_key()
    with pytest.raises(ValueError, match="no configurable detection"):
        parse_policies(
            [
                {
                    **row,
                    "match": {"kind": ["integration"]},
                    "parameters": {"duration_seconds": 60},
                }
            ]
        )
    with pytest.raises(ValueError):
        parse_policies([{**row, "parameters": {"extra": 60}}])


def wait_config(config: dict[str, Any], seconds: int = 60) -> dict[str, Any]:
    """Use one isolated explicit route with collection disabled after qualification."""
    configure(config, delay=0)
    row = config["monitoring_policies"][0]
    row["parameters"] = {"duration_seconds": seconds}
    return row


@pytest.mark.parametrize("interruption", ["idle", "unknown", "restored", "missing"])
async def test_outages_require_one_continuous_interval(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    interruption: str,
) -> None:
    """Brief outages and evidence gaps cannot borrow time from an earlier outage."""
    wait_config(config_data)
    hass.states.async_set("camera.porch", "idle")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("camera.porch", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 20)
    assert not runtime.episodes
    if interruption == "missing":
        hass.states.async_remove("camera.porch")
    else:
        hass.states.async_set(
            "camera.porch",
            "unavailable" if interruption == "restored" else interruption,
            {"restored": True} if interruption == "restored" else {},
        )
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    hass.states.async_set("camera.porch", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 59)
    assert not runtime.episodes
    assert not events
    assert direct.await_count == 0
    await advance(hass, freezer, 1)
    assert len(runtime.episodes) == 1
    assert len([event for event in events if not event.data["silent"]]) == 1
    assert direct.await_count == 1
    hass.states.async_set("camera.porch", "idle")
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_pending_wait_restarts_on_reload_and_detection_edit(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Restart and changed detection require fresh continuous evidence."""
    row = wait_config(config_data)
    hass.states.async_set("camera.porch", "idle")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("camera.porch", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 30)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    await advance(hass, freezer, 59)
    assert not runtime.episodes
    changed = deepcopy(row)
    changed["parameters"]["duration_seconds"] = 120
    await reload_policies(hass, entry, [changed])
    runtime = entry.runtime_data
    await advance(hass, freezer, 119)
    assert not runtime.episodes
    await advance(hass, freezer, 1)
    assert len(runtime.episodes) == 1
    episode_ids = set(runtime.episodes)
    await reload_policies(hass, entry, [{**changed, "name": "Renamed camera"}])
    assert set(entry.runtime_data.episodes) == episode_ids
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("arrival", ["integration_first", "entity_first"])
async def test_shared_integration_issue_waits_for_camera_qualification(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    monkeypatch: pytest.MonkeyPatch,
    arrival: str,
) -> None:
    """Grouping never grants a held camera assignment before its own deadline."""
    wait_config(config_data)
    config_data["monitoring_policies"].append(
        monitoring_policy("integrations", {"kind": ["integration"]})
    )
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    camera = er.async_get(hass).async_get_or_create(
        "camera", "test", "porch", config_entry=owner
    )
    hass.states.async_set(camera.entity_id, "idle")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    direct = AsyncMock()
    monkeypatch.setattr(runtime_module, "async_send", direct)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    if arrival == "integration_first":
        owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
        await hass.async_block_till_done()
    hass.states.async_set(camera.entity_id, "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 20)
    if arrival == "entity_first":
        owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, None)
        await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert not events
    await advance(hass, freezer, 39)
    assert not events
    await advance(hass, freezer, 1)
    assert len(runtime.episodes) == 1
    assert len([event for event in events if not event.data["silent"]]) == 1
    assert direct.await_count == 1
    hass.states.async_set(camera.entity_id, "unavailable", {"restored": True})
    await hass.async_block_till_done()
    await advance(hass, freezer, 5)
    hass.states.async_set(camera.entity_id, "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    assert len([event for event in events if not event.data["silent"]]) == 1
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    assert len([event for event in events if not event.data["silent"]]) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_overlapping_waits_and_sending_off_are_independent(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Each check opens at its own wait even when all sending is off."""
    row = wait_config(config_data)
    other = deepcopy(row)
    other.update(id="longer", parameters={"duration_seconds": 120})
    config_data["monitoring_policies"].append(other)
    config_data["notifications"] = False
    hass.states.async_set("camera.porch", "idle")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("camera.porch", "unavailable")
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    assert len(runtime.episodes) == 1
    await advance(hass, freezer, 60)
    assert len(runtime.episodes) == 2
    assert not events
    assert await hass.config_entries.async_unload(entry.entry_id)
