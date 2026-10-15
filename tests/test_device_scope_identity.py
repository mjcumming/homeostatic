"""Registry churn preserves device issues while deliberate evidence edits replace them."""

from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.monitoring import MonitoringPolicy
from custom_components.homeostatic.runtime import Runtime
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies
from tests.test_source_exclusion_lifecycle import _legacy_detection_key


@dataclass(frozen=True, slots=True, kw_only=True)
class Equipment:
    """One failing device with two selected members and one excluded member."""

    owner: MockConfigEntry
    device: dr.DeviceEntry
    selected: er.RegistryEntry
    other: er.RegistryEntry
    excluded: er.RegistryEntry
    policy: dict[str, Any]
    entry: MockConfigEntry


def equipment(hass: HomeAssistant, config_data: dict[str, Any]) -> Equipment:
    """Create real registry records and an isolated acknowledgment notification route."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "device")}
    )
    selected, other, excluded = (
        er.async_get(hass).async_get_or_create(
            "sensor", "test", name, config_entry=owner, device_id=device.id
        )
        for name in ("selected", "other", "excluded")
    )
    for member in (selected, other, excluded):
        hass.states.async_set(member.entity_id, "unavailable")
    policy = monitoring_policy(
        "devices",
        {"kind": ["device"]},
        notifications=[
            {
                "id": "repeat",
                "timing": {"mode": "acknowledge", "remind_every": "30m"},
                "methods": ["test"],
            }
        ],
    )
    policy["excluded_sources"] = [
        f"entity:registry:{excluded.id}",
        "entity:registry:absent",
    ]
    config_data["monitoring_policies"] = [policy]
    return Equipment(
        owner=owner,
        device=device,
        selected=selected,
        other=other,
        excluded=excluded,
        policy=policy,
        entry=MockConfigEntry(domain=DOMAIN, data=config_data),
    )


def disable_excluded(hass: HomeAssistant, item: Equipment) -> None:
    """Make the excluded member ineligible without changing its identity."""
    er.async_get(hass).async_update_entity(
        item.excluded.entity_id, disabled_by=er.RegistryEntryDisabler.USER
    )


def enable_excluded(hass: HomeAssistant, item: Equipment) -> None:
    """Make the same excluded registry member eligible again."""
    er.async_get(hass).async_update_entity(item.excluded.entity_id, disabled_by=None)
    hass.states.async_set(item.excluded.entity_id, "unavailable")


def remove_excluded(hass: HomeAssistant, item: Equipment) -> None:
    """Remove both registry and live state evidence for the excluded member."""
    er.async_get(hass).async_remove(item.excluded.entity_id)
    hass.states.async_remove(item.excluded.entity_id)


def restore_excluded(hass: HomeAssistant, item: Equipment) -> None:
    """Restore the same integration identity through HA's deleted-entry support."""
    restored = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        item.excluded.unique_id,
        config_entry=item.owner,
        device_id=item.device.id,
    )
    assert restored.id == item.excluded.id
    hass.states.async_set(restored.entity_id, "unavailable")


async def keep_running(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """Let registry callbacks reconcile the running integration."""
    await hass.async_block_till_done()


async def stop_monitor(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """Persist the runtime before a registry change occurs while it is stopped."""
    assert await hass.config_entries.async_unload(entry.entry_id)


async def resume_monitor(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """Load persisted identities after an unobserved registry change."""
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


def attention_clocks(runtime: Runtime, episode_id: str) -> dict[str, Any]:
    """Read public acknowledgment and route clocks without inspecting snapshots."""
    assert runtime.policy is not None
    routes = runtime.policy.explain(episode_id)["routes"]
    assert isinstance(routes, dict)
    route = routes["policy_devices_repeat"]
    assert isinstance(route, dict)
    return {
        key: deepcopy(route[key])
        for key in (
            "opened_at",
            "attention_since",
            "last_sent",
            "sent_to",
            "acknowledgment",
        )
    }


@pytest.mark.parametrize(
    ("withdraw", "restore"),
    [
        pytest.param(disable_excluded, enable_excluded, id="disabled"),
        pytest.param(remove_excluded, restore_excluded, id="removed"),
    ],
)
@pytest.mark.parametrize(
    ("before_change", "after_change"),
    [
        pytest.param(keep_running, keep_running, id="running"),
        pytest.param(stop_monitor, resume_monitor, id="stopped"),
    ],
)
async def test_excluded_registry_changes_retain_device_issue(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    withdraw: Callable[[HomeAssistant, Equipment], None],
    restore: Callable[[HomeAssistant, Equipment], None],
    before_change: Callable[[HomeAssistant, MockConfigEntry], Awaitable[None]],
    after_change: Callable[[HomeAssistant, MockConfigEntry], Awaitable[None]],
) -> None:
    """Excluded-member churn preserves the issue, acknowledgment, pause and clocks."""
    item = equipment(hass, config_data)
    runtime = await start_monitor(hass, item.entry)
    episode_id = next(iter(runtime.episodes))
    await action(hass, "acknowledge", {"episode_id": episode_id})
    await action(hass, "shelve", {"episode_id": episode_id, "until": end(300)})
    episode = deepcopy(runtime.episodes[episode_id])
    anchor = episode["anchor"]
    assert isinstance(anchor, str)
    clocks = attention_clocks(runtime, episode_id)
    controls = deepcopy(runtime.controls)
    selected = runtime.sources[anchor].availability_entities

    await before_change(hass, item.entry)
    withdraw(hass, item)
    await after_change(hass, item.entry)
    runtime = item.entry.runtime_data
    assert runtime.episodes == {episode_id: episode}
    assert attention_clocks(runtime, episode_id) == clocks
    assert runtime.controls == controls
    assert runtime.sources[anchor].availability_entities == selected
    assert not runtime.history.snapshot()["episodes"]

    unrelated = {
        **item.policy,
        "excluded_sources": [
            *item.policy["excluded_sources"],
            "entity:registry:unrelated",
        ],
    }
    await reload_policies(hass, item.entry, [unrelated])
    runtime = item.entry.runtime_data
    assert runtime.episodes == {episode_id: episode}
    assert attention_clocks(runtime, episode_id) == clocks
    assert runtime.controls == controls

    await before_change(hass, item.entry)
    restore(hass, item)
    await after_change(hass, item.entry)
    runtime = item.entry.runtime_data
    assert runtime.episodes == {episode_id: episode}
    assert attention_clocks(runtime, episode_id) == clocks
    assert runtime.controls == controls
    assert runtime.sources[anchor].availability_entities == selected
    assert not runtime.history.snapshot()["episodes"]
    assert runtime.preview_sources(runtime.settings) == runtime.sources
    assert await hass.config_entries.async_unload(item.entry.entry_id)


async def test_legacy_device_alias_survives_automatic_membership_changes(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
) -> None:
    """Upgrade, offline membership changes and live growth keep the old detector ID."""
    item = equipment(hass, config_data)
    with patch.object(MonitoringPolicy, "detection_key", _legacy_detection_key):
        runtime = await start_monitor(hass, item.entry)
        legacy_id = bound_identity(item.policy, f"device:{item.device.id}")
        episode_id = next(iter(runtime.episodes))
        await action(hass, "acknowledge", {"episode_id": episode_id})
        episode = deepcopy(runtime.episodes[episode_id])
        clocks = attention_clocks(runtime, episode_id)
        assert await hass.config_entries.async_unload(item.entry.entry_id)
    envelope = hass_storage[f"{DOMAIN}.{item.entry.entry_id}"]["data"]
    envelope["schema_version"] = 2
    envelope.pop("monitoring_identities")
    envelope.pop("monitoring_scopes", None)
    disable_excluded(hass, item)
    await resume_monitor(hass, item.entry)
    runtime = item.entry.runtime_data
    assert episode["anchor"] == legacy_id
    assert runtime.episodes == {episode_id: episode}
    assert attention_clocks(runtime, episode_id) == clocks

    added = er.async_get(hass).async_get_or_create(
        "sensor", "test", "added", config_entry=item.owner, device_id=item.device.id
    )
    hass.states.async_set(added.entity_id, "unavailable")
    enable_excluded(hass, item)
    await hass.async_block_till_done()
    assert runtime.episodes == {episode_id: episode}
    assert added.entity_id in runtime.sources[legacy_id].availability_entities
    assert (
        item.excluded.entity_id not in runtime.sources[legacy_id].availability_entities
    )
    assert attention_clocks(runtime, episode_id) == clocks

    await stop_monitor(hass, item.entry)
    er.async_get(hass).async_remove(added.entity_id)
    hass.states.async_remove(added.entity_id)
    await resume_monitor(hass, item.entry)
    runtime = item.entry.runtime_data
    assert runtime.episodes == {episode_id: episode}
    assert added.entity_id not in runtime.sources[legacy_id].availability_entities
    assert attention_clocks(runtime, episode_id) == clocks
    assert not runtime.history.snapshot()["episodes"]
    assert runtime.preview_sources(runtime.settings) == runtime.sources
    assert await hass.config_entries.async_unload(item.entry.entry_id)


async def test_repeated_exclusion_replaces_retained_id_and_matches_preview(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A real exclusion cannot reuse a still-live ID retained through earlier churn."""
    item = equipment(hass, config_data)
    runtime = await start_monitor(hass, item.entry)
    episode_id = next(iter(runtime.episodes))
    await action(hass, "acknowledge", {"episode_id": episode_id})
    await action(hass, "shelve", {"episode_id": episode_id, "until": end(300)})
    original = deepcopy(runtime.episodes[episode_id])
    original_id = original["anchor"]
    disable_excluded(hass, item)
    await hass.async_block_till_done()
    resumed = {**item.policy, "excluded_sources": ["entity:registry:absent"]}
    await reload_policies(hass, item.entry, [resumed])
    runtime = item.entry.runtime_data
    assert runtime.episodes == {episode_id: original}
    enable_excluded(hass, item)
    await hass.async_block_till_done()
    assert runtime.episodes == {episode_id: original}
    assert item.excluded.entity_id in runtime.sources[original_id].availability_entities

    before = deepcopy(runtime.snapshot())
    settings = Settings.from_data(
        {**item.entry.options, "monitoring_policies": [item.policy]}
    )
    preview = runtime.preview_sources(settings)
    assert original_id not in preview
    assert runtime.snapshot() == before
    await reload_policies(hass, item.entry, [item.policy])
    runtime = item.entry.runtime_data
    assert runtime.sources == preview
    replacement_id = next(iter(runtime.episodes))
    assert replacement_id != episode_id
    assert runtime.episodes[replacement_id]["anchor"] != original_id
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(replacement_id) is None
    assert not runtime.controls
    assert [
        (row["episode"]["episode_id"], row["resolution"])
        for row in runtime.history.snapshot()["episodes"]
    ] == [(episode_id, "removed")]
    assert runtime.preview_sources(runtime.settings) == runtime.sources
    assert await hass.config_entries.async_unload(item.entry.entry_id)


async def test_failed_device_exclusion_restores_identity_scope_and_controls(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A failed durable scope change restores the original issue and binding metadata."""
    item = equipment(hass, config_data)
    runtime = await start_monitor(hass, item.entry)
    episode_id = next(iter(runtime.episodes))
    await action(hass, "acknowledge", {"episode_id": episode_id})
    await action(hass, "shelve", {"episode_id": episode_id, "until": end(300)})
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    before = deepcopy(runtime.snapshot())
    clocks = attention_clocks(runtime, episode_id)
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["excluded_sources"].append(
        f"entity:registry:{item.selected.id}"
    )
    save = runtime.store.async_save
    calls = 0

    async def failing_save(data: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        await save(data)
        if calls == 1:
            raise OSError("Test device scope storage failure")

    with patch.object(runtime.store, "async_save", side_effect=failing_save):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        response = await client.receive_json()
    assert response["error"]["code"] == "apply_failed"
    assert not item.entry.options
    assert runtime.available
    restored = runtime.snapshot()
    for key in (
        "monitoring_identities",
        "monitoring_scopes",
        "episodes",
        "operator_controls",
        "resolved_history",
    ):
        assert restored[key] == before[key]
    assert attention_clocks(runtime, episode_id) == clocks
    assert runtime.preview_sources(runtime.settings) == runtime.sources
    assert await hass.config_entries.async_unload(item.entry.entry_id)
    await client.close()
