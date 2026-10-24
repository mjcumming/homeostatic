"""UPS inputs and retained state advance with the ordered engine worker."""

import asyncio
from datetime import timedelta
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_EPISODE
from custom_components.homeostatic.runtime import Runtime
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


async def ups_runtime(
    hass: HomeAssistant, config_data: dict[str, Any], *, charge_level: str
) -> tuple[Runtime, MockConfigEntry, str, str]:
    """Create an isolated NUT reserve check with a mocked notification route."""
    owner = MockConfigEntry(domain="nut", state=ConfigEntryState.NOT_LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("nut", "office")},
        name="Office UPS",
    )
    registry = er.async_get(hass)
    status = registry.async_get_or_create(
        "sensor", "nut", "office_ups.status", config_entry=owner, device_id=device.id
    )
    charge = registry.async_get_or_create(
        "sensor",
        "nut",
        "office_battery.charge",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
    )
    hass.states.async_set(status.entity_id, "OL")
    hass.states.async_set(charge.entity_id, charge_level, {"unit_of_measurement": "%"})
    config_data["monitoring_policies"] = [
        monitoring_policy(
            "reserve",
            {"kind": ["ups"]},
            check="ups_reserve",
            parameters={"charge_low": 20, "charge_clear": 30},
            notifications=[
                {
                    "id": "backup",
                    "timing": {"mode": "acknowledge", "remind_every": "1h"},
                    "methods": ["test"],
                    "when": "backup",
                }
            ],
        )
    ]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    return await start_monitor(hass, entry), entry, status.entity_id, charge.entity_id


async def test_save_before_queued_backup_transition_preserves_rearm_on_restore(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A save during captured evidence cannot consume an unprocessed power transition."""
    runtime, entry, status, _ = await ups_runtime(hass, config_data, charge_level="10")
    [issue] = runtime.episodes
    assert runtime.policy is not None
    runtime.policy.acknowledge(issue, dt_util.utcnow())
    received = asyncio.Event()

    @callback
    def captured(event: Event[Any]) -> None:
        if event.data["entity_id"] == status:
            received.set()

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, captured)
    async with runtime._lock:
        freezer.tick(timedelta(seconds=1))
        hass.states.async_set(status, "OB")
        await received.wait()
        assert runtime._pending
        node_id = str(runtime.episodes[issue]["anchor"])
        assert runtime.snapshot()["ups_monitors"][node_id]["mode"] == "mains"
        assert runtime.producers.ups_latest(node_id).reason == "ups_reserve_low"
        await runtime._save()
        restored = Runtime(hass, entry, Settings.from_data(dict(entry.data)))
        await restored.async_load()
        restored.running = True
        try:
            await restored.async_refresh(cause="restore")
            assert restored.error is None
            assert (
                restored.episodes[issue]["reasons"][0]["reason"]
                == "ups_reserve_critical"
            )
            assert restored.policy is not None
            assert restored.policy.acknowledgment(issue) is None
            assert (
                restored.policy.explain(issue)["routes"]["policy_reserve_backup"][
                    "loudness"
                ]
                == "urgent"
            )
        finally:
            await restored.async_stop()
    cancel()
    await hass.async_block_till_done()
    assert runtime.policy.acknowledgment(issue) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_queued_ups_inputs_keep_each_role_reading_and_hysteresis(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Later charge readings cannot replace an earlier captured status reading."""
    runtime, entry, status, charge = await ups_runtime(
        hass, config_data, charge_level="50"
    )
    facts = async_capture_events(hass, EVENT_EPISODE)
    received: asyncio.Queue[str] = asyncio.Queue()

    @callback
    def captured(event: Event[Any]) -> None:
        if event.data["entity_id"] in {status, charge}:
            received.put_nowait(event.data["entity_id"])

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, captured)
    async with runtime._lock:
        before = runtime.snapshot()
        for entity_id, value, attributes in (
            (charge, "10", {"unit_of_measurement": "%"}),
            (charge, "25", {"unit_of_measurement": "%"}),
            (status, "OB", {}),
            (charge, "35", {"unit_of_measurement": "%"}),
        ):
            hass.states.async_set(entity_id, value, attributes)
            assert await received.get() == entity_id
        assert runtime.snapshot() == before
    cancel()
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert [
        (event.data["change"], event.data["reasons"][0]["reason"]) for event in facts
    ] == [
        ("opened", "ups_reserve_low"),
        ("updated", "ups_reserve_critical"),
        ("resolved", "ups_reserve_critical"),
    ]
    assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)
