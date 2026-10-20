"""Existing installations retain saved choices and issue controls through setup."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.policy_defaults import initial_settings
from tests.policy_helpers import monitoring_policy
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("field", ["temperature_monitors", "ups_monitors"])
@pytest.mark.parametrize("invalid", [[], {"retained": None}, {"retained": []}])
async def test_malformed_source_state_never_starts_conversion(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    field: str,
    invalid: Any,
) -> None:
    """Malformed source state is rejected before startup can discard its records."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    hass_storage[key]["data"][field] = invalid
    legacy = deepcopy(config_data)
    for profile in legacy["notification_definitions"]["profiles"].values():
        profile["timing"].pop("collection_delay_seconds", None)
    hass.config_entries.async_update_entry(entry, options=legacy)
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        assert not await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.SETUP_ERROR
        assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before
        assert not events
        send.assert_not_awaited()


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("legacy", [False, True], ids=["current", "conversion"])
@pytest.mark.parametrize("detector", ["temperature", "ups"])
async def test_corrupt_source_restore_survives_retry_and_unload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    location: str,
    legacy: bool,
    detector: str,
) -> None:
    """A late source restore failure never becomes an empty successful restart."""
    if detector == "temperature":
        hass.states.async_set(
            "sensor.room",
            "0",
            {"device_class": "temperature", "unit_of_measurement": "°C"},
        )
        policy = monitoring_policy(
            "temperature",
            {"entity": ["entity_id:sensor.room"]},
            check="temperature_limit",
            parameters={"unit": "°C", "minimum": 10, "duration_seconds": 0},
        )
    else:
        owner = MockConfigEntry(domain="nut", state=ConfigEntryState.NOT_LOADED)
        owner.add_to_hass(hass)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("nut", "office")},
            name="Office UPS",
        )
        status = er.async_get(hass).async_get_or_create(
            "sensor",
            "nut",
            "office_ups.status",
            config_entry=owner,
            device_id=device.id,
        )
        charge = er.async_get(hass).async_get_or_create(
            "sensor",
            "nut",
            "office_battery.charge",
            config_entry=owner,
            device_id=device.id,
        )
        hass.states.async_set(status.entity_id, "OB")
        hass.states.async_set(charge.entity_id, "50", {"unit_of_measurement": "%"})
        policy = monitoring_policy("power", {"kind": ["ups"]}, check="ups_power")
    config_data.update(notifications=False, monitoring_policies=[policy])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    key = f"{DOMAIN}.{entry.entry_id}"
    saved = hass_storage[key]["data"]
    monitors = saved[f"{detector}_monitors"]
    [node_id] = monitors
    monitors[node_id] = (
        {"active_reason": "corrupt"} if detector == "temperature" else {"mode": {}}
    )
    settings = deepcopy(config_data)
    if legacy:
        for profile in settings["notification_definitions"]["profiles"].values():
            profile["timing"].pop("collection_delay_seconds", None)
    hass.config_entries.async_update_entry(
        entry,
        data=settings if location == "data" else config_data,
        options=settings if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options), hass_storage[key]))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        for retry in (False, True):
            assert await hass.config_entries.async_setup(entry.entry_id)
            await hass.async_block_till_done()
            runtime = entry.runtime_data
            assert not runtime.available
            failure = runtime.error
            assert failure
            if retry:
                await runtime.async_refresh()
                freezer.tick(timedelta(minutes=16))
                async_fire_time_changed(hass, dt_util.utcnow())
                await hass.async_block_till_done()
                assert not runtime.available
                assert runtime.error == failure
            assert await hass.config_entries.async_unload(entry.entry_id)
            assert (dict(entry.data), dict(entry.options), hass_storage[key]) == before
        assert not events
        send.assert_not_awaited()


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("choice", ["disabled", "deleted"])
@pytest.mark.parametrize("sending", [False, True])
async def test_new_defaults_preserve_battery_and_vacuum_choices(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    location: str,
    choice: str,
    sending: bool,
) -> None:
    """An upgrade never enables disabled checks or recreates deleted policies."""
    from tests.test_battery import battery_device

    level, warning, charging, _ = await battery_device(hass)
    hass.states.async_set(level, "12", {"unit_of_measurement": "%"})
    hass.states.async_set(warning, "off")
    hass.states.async_set(charging, "off")
    hass.states.async_set("vacuum.robot", "error")
    data = initial_settings("UTC")
    data["timings"] = config_data["timings"]
    data["notifications"] = sending
    identities = {"default_batteries", "default_vacuums"}
    for policy in data["monitoring_policies"]:
        if policy["id"] in identities:
            policy["enabled"] = False
    if choice == "deleted":
        data["monitoring_policies"] = [
            policy
            for policy in data["monitoring_policies"]
            if policy["id"] not in identities
        ]
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=data if location == "data" else initial_settings("UTC"),
        options=data if location == "options" else {},
    )
    before = deepcopy((dict(entry.data), dict(entry.options)))
    expected = Settings.from_data(data, functions_enabled=False)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        runtime = await start_monitor(hass, entry)
        for reload in range(3):
            if reload:
                assert await hass.config_entries.async_reload(entry.entry_id)
                await hass.async_block_till_done()
                runtime = entry.runtime_data
            assert runtime.settings == expected
            assert (dict(entry.data), dict(entry.options)) == before
            assert not any(
                source.watched and source.monitoring_policy in identities
                for source in runtime.sources.values()
            )
            assert not events
            send.assert_not_awaited()
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("sending", [False, True])
async def test_current_setup_and_reload_preserve_every_saved_choice(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    location: str,
    sending: bool,
) -> None:
    """Edited and deleted defaults, scopes, destinations and sending stay exact."""
    data = initial_settings("America/New_York")
    data["timings"] = config_data["timings"]
    data["notifications"] = sending
    important = monitoring_policy(
        "default_important_equipment",
        {"kind": ["entity"]},
        notifications=[{"id": "default", "profile": "immediate"}],
    )
    important["match_any"] = deepcopy(data["monitoring_policies"][1]["match_none"])
    important["name"] = "Owner's chosen equipment"
    important["enabled"] = False
    important["excluded_sources"] = ["device:ignored", "entity:registry:ignored"]
    chosen = monitoring_policy(
        "chosen",
        {
            "kind": ["entity"],
            "entity": ["entity_id:sensor.observed", "registry:missing"],
        },
        notifications=[{"id": "existing_assignment", "profile": "immediate"}],
    )
    chosen["included_sources"] = ["entity:registry:remembered"]
    chosen["excluded_sources"] = ["entity:entity_id:sensor.ignored"]
    data["monitoring_policies"] = [important, chosen]
    definitions = data["notification_definitions"]
    definitions["methods"] = {
        "existing_phone": {
            "name": "Owner's phone",
            "mode": "fixed",
            "destinations": ["service:homeostatic_test"],
        }
    }
    definitions["profiles"]["immediate"].update(
        name="Owner's timing",
        timing={"mode": "immediate", "collection_delay_seconds": 17},
        methods=["existing_phone"],
    )
    definitions["profiles"]["morning"]["timing"] = {
        "mode": "report",
        "at": "09:15",
        "weekdays": [1, 3, 5],
    }
    del definitions["profiles"]["weekly"]
    del definitions["profiles"]["evening"]
    before_data = deepcopy(data)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=data if location == "data" else initial_settings("UTC"),
        options=data if location == "options" else {},
    )
    saved = deepcopy((dict(entry.data), dict(entry.options)))
    hass.states.async_set("sensor.observed", "42")
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    expected = Settings.from_data(data, functions_enabled=False)
    assert runtime.settings == expected
    assert (dict(entry.data), dict(entry.options)) == saved
    assert data == before_data
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.runtime_data.settings == expected
        assert (dict(entry.data), dict(entry.options)) == saved
    assert not events
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_current_upgrade_retains_history_acknowledgment_and_pause(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_admin_user: User,
) -> None:
    """An unchanged installation keeps issue identity and independently saved controls."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    history = deepcopy(runtime.history.snapshot())
    assert len(history["episodes"]) == 1
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    [episode] = runtime.episodes
    acknowledgment = await action(
        hass, "acknowledge", {"episode_id": episode}, hass_admin_user.id
    )
    paused = await action(
        hass,
        "shelve",
        {"episode_id": episode, "until": end(3600), "reason": "Waiting for a part"},
        hass_admin_user.id,
    )
    saved = deepcopy(dict(entry.data))
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        restored = entry.runtime_data
        assert dict(entry.data) == saved
        assert not entry.options
        assert restored.history.snapshot() == history
        assert list(restored.episodes) == [episode]
        assert (await action(hass, "policy", {}))["episodes"][0][
            "acknowledgment"
        ] == acknowledgment["acknowledgment"]
        assert (await action(hass, "operator_controls", {}))["controls"] == [
            paused["control"]
        ]
    assert await hass.config_entries.async_unload(entry.entry_id)
