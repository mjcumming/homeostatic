"""Availability issues retain device scope through controls and regrouping."""

from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from health_tree.types import EngineSettings
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
from custom_components.homeostatic.const import (
    DOMAIN,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
)
from custom_components.homeostatic.policy_defaults import policy_templates
from custom_components.homeostatic.runtime import Runtime
from tests.policy_helpers import bound_identity
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor

# Captured from v1.8.2 ResolvedHistory.snapshot(), using the public terminal
# event in tests.test_history. Keep this literal independent of today's writer.
HISTORY_1_8_2: dict[str, Any] = {
    "schema_version": 1,
    "started_at": "2026-09-25T00:00:00+00:00",
    "episodes": [
        {
            "episode": {
                "episode_id": "retained-before-upgrade",
                "form": "root",
                "anchor": "entity:entity_id:sensor.observed",
                "status": "fail",
                "reasons": [
                    {
                        "node_id": "entity:entity_id:sensor.observed",
                        "check_id": "availability",
                        "status": "fail",
                        "reason": "unavailable",
                        "since": "2026-09-25T00:00:00+00:00",
                        "message": None,
                        "due_at": None,
                        "labels": {},
                        "annotations": {},
                    }
                ],
                "recorded": [],
                "impact": [],
                "importance": "normal",
                "opened_at": "2026-09-25T00:00:00+00:00",
                "updated_at": "2026-09-25T00:00:00+00:00",
                "due_at": None,
                "absorbed": [],
                "labels": {"name": "Original name"},
                "annotations": {},
            },
            "resolved_at": "2026-09-25T00:00:00+00:00",
            "resolution": "cleared",
            "absorbed_into": None,
            "source": None,
        }
    ],
}


async def test_1_8_2_history_survives_upgrade_and_reload(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Read genuine older history without inventing separation or new notifications."""
    freezer.move_to("2026-09-26T00:00:00+00:00")
    hass.states.async_set("sensor.observed", "42")
    await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    key = f"{DOMAIN}.{config_entry.entry_id}"
    # Only adapter-owned history is replaced; engine persistence stays opaque.
    hass_storage[key]["data"]["resolved_history"] = deepcopy(HISTORY_1_8_2)
    notifications = async_capture_events(hass, EVENT_NOTIFICATION)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    expected = deepcopy(HISTORY_1_8_2)
    expected["episodes"][0]["split_into"] = []
    runtime = config_entry.runtime_data
    assert runtime.available
    assert runtime.history.snapshot() == expected
    assert not runtime.episodes
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.runtime_data.history.snapshot() == expected
    assert not notifications
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert hass_storage[key]["data"]["resolved_history"] == expected


@dataclass(frozen=True, slots=True, kw_only=True)
class AvailabilitySources:
    """Four affected devices and one working sibling on a loaded Matter entry."""

    owner: MockConfigEntry
    devices: tuple[dr.DeviceEntry, ...]
    members: tuple[tuple[er.RegistryEntry, ...], ...]


def availability_sources(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> AvailabilitySources:
    """Exercise the supplied integration, device and entity policy scopes."""
    owner = MockConfigEntry(
        domain="matter", title="Matter", state=ConfigEntryState.LOADED
    )
    owner.add_to_hass(hass)
    devices = []
    members = []
    for index, count in enumerate((1, 2, 2, 1, 1)):
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={("matter", f"availability_{index}")},
            name=f"Matter device {index}",
        )
        devices.append(device)
        device_members = []
        for member in range(count):
            entity = er.async_get(hass).async_get_or_create(
                "sensor",
                "matter",
                f"availability_{index}_{member}",
                config_entry=owner,
                device_id=device.id,
                original_name=f"Matter device {index} reading {member}",
            )
            device_members.append(entity)
            hass.states.async_set(entity.entity_id, "42")
        members.append(tuple(device_members))
    policies = [row for row in policy_templates() if row["check"] == "availability"]
    for policy in policies:
        policy["notifications"] = [
            {
                "id": "reminder",
                "timing": {"mode": "acknowledge", "remind_every": "10s"},
                "methods": ["test"],
            }
        ]
    config_data["monitoring_policies"] = policies
    return AvailabilitySources(
        owner=owner, devices=tuple(devices), members=tuple(members)
    )


def unavailable(hass: HomeAssistant, sources: AvailabilitySources) -> None:
    """Report six unavailable entities while their fifth device sibling works."""
    for members in sources.members[:4]:
        for entity in members:
            hass.states.async_set(entity.entity_id, "unavailable")


def isolated_issues(
    runtime: Runtime, sources: AvailabilitySources, config_data: dict[str, Any]
) -> dict[str, str]:
    """Assert six independent findings and return their source-to-issue map."""
    policies = {row["id"]: row for row in config_data["monitoring_policies"]}
    expected = {
        bound_identity(policies["default_entities"], f"entity:registry:{entity.id}")
        for members in sources.members[:4]
        for entity in members
    }
    episodes = {
        str(episode["anchor"]): identity
        for identity, episode in runtime.episodes.items()
    }
    assert set(episodes) == expected
    assert len(episodes) == 6
    assert sources.owner.state is ConfigEntryState.LOADED
    for episode in runtime.episodes.values():
        assert episode["form"] == "root"
        assert episode["recorded"] == []
        source = runtime.sources[str(episode["anchor"])]
        assert len(source.attributes["device"]) == 1
    return episodes


async def test_four_unavailable_devices_keep_independent_issues_and_device_messages(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A working Matter entry never combines its unavailable device findings."""
    sources = availability_sources(hass, config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.episodes
    unavailable(hass, sources)
    await hass.async_block_till_done()
    isolated_issues(runtime, sources, config_data)
    assert {event.data["notification_subject"] for event in events} == {
        f"device:{device.id}" for device in sources.devices[:4]
    }
    for event in events:
        assert {
            f"device:{runtime.sources[str(runtime.episodes[identity]['anchor'])].attributes['device'][0]}"
            for identity in event.data["episodes"]
        } == {event.data["notification_subject"]}
    assert await hass.config_entries.async_unload(entry.entry_id)
    sources.owner._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)


async def test_acknowledge_and_pause_one_finding_preserve_other_devices_on_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    hass_admin_user: User,
) -> None:
    """Exact issue controls survive reload without silencing sibling devices."""
    sources = availability_sources(hass, config_data)
    unavailable(hass, sources)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    episodes = isolated_issues(runtime, sources, config_data)
    policy = next(
        row
        for row in config_data["monitoring_policies"]
        if row["id"] == "default_entities"
    )
    acknowledged, paused = (
        episodes[bound_identity(policy, f"entity:registry:{members[0].id}")]
        for members in sources.members[:2]
    )
    await action(hass, "acknowledge", {"episode_id": acknowledged}, hass_admin_user.id)
    shelf = await action(
        hass,
        "shelve",
        {"episode_id": paused, "until": end(60), "reason": "Investigating device"},
        hass_admin_user.id,
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert isolated_issues(runtime, sources, config_data) == episodes
    assert runtime.policy is not None
    assert {
        identity
        for identity in runtime.episodes
        if runtime.policy.acknowledgment(identity) is not None
    } == {acknowledged}
    assert (await action(hass, "operator_controls", {}))["controls"] == [
        shelf["control"]
    ]
    assert shelf["control"]["target"] == paused
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert {f"device:{device.id}" for device in sources.devices[2:4]} <= {
        event.data["notification_subject"]
        for event in events
        if not event.data["silent"]
    }
    assert await hass.config_entries.async_unload(entry.entry_id)
    sources.owner._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)


async def test_integration_outage_releases_remaining_device_problems_after_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A real integration outage groups dependents only while it explains them."""
    sources = availability_sources(hass, config_data)
    config_data["timings"].update(clear_hold=5, rejoin_grace=7)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    sources.owner._async_set_state(
        hass, ConfigEntryState.SETUP_ERROR, "Connection lost"
    )
    unavailable(hass, sources)
    await hass.async_block_till_done()
    [outage_id] = runtime.episodes
    assert (
        runtime.sources[str(runtime.episodes[outage_id]["anchor"])].kind
        == "integration"
    )
    sources.owner._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert outage_id in runtime.episodes
    freezer.tick(timedelta(seconds=6))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert outage_id in runtime.episodes
    freezer.tick(timedelta(seconds=8))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    isolated_issues(runtime, sources, config_data)
    assert outage_id not in runtime.episodes
    history = runtime.history.view(dt_util.utcnow())["episodes"]
    assert isinstance(history, list)
    [ended] = [
        row
        for row in history
        if isinstance(row, dict) and row["episode"]["episode_id"] == outage_id
    ]
    assert ended["resolution"] == "split"
    assert set(ended["split_into"]) == set(runtime.episodes)
    assert await hass.config_entries.async_unload(entry.entry_id)
    sources.owner._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)


async def test_restored_common_parent_group_splits_without_claiming_recovery(
    hass: HomeAssistant, config_data: dict[str, Any], hass_admin_user: User
) -> None:
    """Normal storage restores old grouping as independent current problems."""
    sources = availability_sources(hass, config_data)
    unavailable(hass, sources)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    original_settings = Settings.engine_settings

    def old_grouping(settings: Settings) -> EngineSettings:
        """Construct the previous engine configuration without editing its snapshot."""
        return replace(original_settings(settings), coalesce_count=3)

    with patch.object(Settings, "engine_settings", old_grouping):
        runtime = await start_monitor(hass, entry)
        [old_id] = runtime.episodes
        assert runtime.episodes[old_id]["form"] == "group"
        await action(hass, "acknowledge", {"episode_id": old_id}, hass_admin_user.id)
        old_shelf = await action(
            hass,
            "shelve",
            {"episode_id": old_id, "until": end(120), "reason": "Investigating outage"},
            hass_admin_user.id,
        )
        assert runtime.policy is not None
        old_acknowledgment = runtime.policy.acknowledgment(old_id)
        assert old_acknowledgment is not None
        assert await hass.config_entries.async_unload(entry.entry_id)
    episode_events = async_capture_events(hass, EVENT_EPISODE)
    notification_events = async_capture_events(hass, EVENT_NOTIFICATION)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    isolated_issues(runtime, sources, config_data)
    assert old_id not in runtime.episodes
    [split] = [
        event.data
        for event in episode_events
        if event.data["episode_id"] == old_id and event.data["change"] == "resolved"
    ]
    assert split["resolution"] == "split"
    assert set(split["split_into"]) == set(runtime.episodes)
    assert {
        event.data["episode_id"]
        for event in episode_events
        if event.data.get("split_from") == old_id
    } == set(runtime.episodes)
    assert runtime.policy is not None
    for identity in runtime.episodes:
        assert runtime.policy.acknowledgment(identity) == replace(
            old_acknowledgment, episode_id=identity
        )
    controls = (await action(hass, "operator_controls", {}))["controls"]
    assert {control["target"] for control in controls} == set(runtime.episodes)
    for control in controls:
        assert {
            key: control[key] for key in ("started_at", "until", "user_id", "reason")
        } == {
            key: old_shelf["control"][key]
            for key in ("started_at", "until", "user_id", "reason")
        }
    cancelled = controls[0]
    await action(
        hass,
        "cancel_control",
        {"control_id": cancelled["control_id"]},
        hass_admin_user.id,
    )
    assert {
        control["target"]
        for control in (await action(hass, "operator_controls", {}))["controls"]
    } == set(runtime.episodes) - {cancelled["target"]}
    assert not any(
        event.data.get("resolution") == "cleared" for event in notification_events
    )
    assert any(event.data.get("resolution") == "split" for event in notification_events)
    restored_ids = set(runtime.episodes)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert set(runtime.episodes) == restored_ids
    for entity in sources.members[4]:
        hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    later_ids = set(runtime.episodes) - restored_ids
    assert len(later_ids) == 1
    assert runtime.policy is not None
    assert all(
        runtime.policy.acknowledgment(identity) is None for identity in later_ids
    )
    assert not later_ids & {
        control["target"]
        for control in (await action(hass, "operator_controls", {}))["controls"]
    }
    assert await hass.config_entries.async_unload(entry.entry_id)
    sources.owner._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)
