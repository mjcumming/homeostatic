"""Add supplied categories once while retaining household configuration and state."""

from contextlib import nullcontext
from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.dashboard import (
    _editable_settings,
    _settings_candidate,
)
from custom_components.homeostatic.policy_defaults import (
    CATEGORY_POLICY_INTRODUCTIONS,
    LEGACY_POLICY_INTRODUCTIONS,
    SUPPLIED_POLICY_INTRODUCTIONS,
    initial_settings,
)
from custom_components.homeostatic.policy_migration import introduce_supplied_policies
from custom_components.homeostatic.serialization import json_digest
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


def previous_settings() -> dict[str, Any]:
    """Represent the published General/Important split before introduction tracking."""
    data = initial_settings("UTC")
    data.pop("supplied_policy_introductions")
    data["monitoring_policies"] = [
        row
        for row in data["monitoring_policies"]
        if row["id"] not in {*CATEGORY_POLICY_INTRODUCTIONS, "default_batteries"}
    ]
    general = data["monitoring_policies"][1]
    general["parameters"] = {}
    general["name"] = "Household availability"
    general["excluded_sources"] = ["entity:entity_id:sensor.excluded"]
    important = monitoring_policy(
        "default_important_equipment",
        {"kind": ["entity"]},
        notifications=[{"id": "household", "profile": "immediate"}],
    )
    important.update(
        name="My important equipment",
        match_any=deepcopy(general["match_none"]),
    )
    data["monitoring_policies"].insert(2, important)
    return data


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("sending", [False, True])
async def test_categories_are_disabled_additions_and_never_recreated(
    hass: HomeAssistant, config_data: dict[str, Any], location: str, sending: bool
) -> None:
    """Upgrade appends disabled categories; subsequent edits and deletions survive."""
    data = previous_settings()
    data.update(notifications=sending, timings=config_data["timings"])
    before = deepcopy(data)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=data if location == "data" else initial_settings("UTC"),
        options=data if location == "options" else {},
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        runtime = await start_monitor(hass, entry)
        upgraded = deepcopy(dict(entry.data))
        original_count = len(before["monitoring_policies"])
        assert (
            upgraded["monitoring_policies"][:original_count]
            == before["monitoring_policies"]
        )
        added = upgraded["monitoring_policies"][original_count:]
        assert [row["id"] for row in added] == list(CATEGORY_POLICY_INTRODUCTIONS)
        assert all(row["enabled"] is False for row in added)
        assert upgraded["supplied_policy_introductions"] == list(
            SUPPLIED_POLICY_INTRODUCTIONS
        )
        assert {
            key: value
            for key, value in upgraded.items()
            if key not in {"monitoring_policies", "supplied_policy_introductions"}
        } == {
            key: value for key, value in before.items() if key != "monitoring_policies"
        }
        assert data == before
        assert not entry.options
        assert runtime.available
        assert not any(
            source.watched and source.monitoring_policy in CATEGORY_POLICY_INTRODUCTIONS
            for source in runtime.sources.values()
        )
        # Simulate ordinary owner changes after receiving the additions.
        draft = _editable_settings(runtime.settings)
        draft["monitoring_policies"] = [
            row
            for row in draft["monitoring_policies"]
            if row["id"] not in {"default_cameras", "default_important_equipment"}
        ]
        locks = next(
            row for row in draft["monitoring_policies"] if row["id"] == "default_locks"
        )
        locks.update(
            name="Back door locks", enabled=True, parameters={"duration_seconds": 47}
        )
        saved = await _settings_candidate(hass, upgraded, draft)
        hass.config_entries.async_update_entry(entry, options=saved)
        for _ in range(2):
            assert await hass.config_entries.async_reload(entry.entry_id)
            await hass.async_block_till_done()
            assert entry.runtime_data.available
            assert dict(entry.options) == saved
            assert dict(entry.data) == upgraded
            assert (
                entry.runtime_data.settings.supplied_policy_introductions
                == SUPPLIED_POLICY_INTRODUCTIONS
            )
        assert not events
        send.assert_not_awaited()
        assert await hass.config_entries.async_unload(entry.entry_id)


def test_existing_identity_and_deleted_notification_take_precedence() -> None:
    """A collision retains its saved record and missing notifications stay deleted."""
    data = previous_settings()
    collision = monitoring_policy(
        "default_cameras", {"kind": ["entity"], "entity": ["entity_id:camera.gate"]}
    )
    collision.update(
        name="Edited camera selection", parameters={"duration_seconds": 13}
    )
    data["monitoring_policies"].insert(0, collision)
    del data["notification_definitions"]["profiles"]["immediate"]
    data["monitoring_policies"][3]["notifications"] = []
    before = deepcopy(data)
    candidate = introduce_supplied_policies(data)
    assert data == before
    assert (
        candidate["monitoring_policies"][: len(before["monitoring_policies"])]
        == before["monitoring_policies"]
    )
    added = candidate["monitoring_policies"][len(before["monitoring_policies"]) :]
    assert [row["id"] for row in added] == list(CATEGORY_POLICY_INTRODUCTIONS[1:])
    assert all(row["notifications"] == [] and not row["enabled"] for row in added)
    assert candidate["notification_definitions"] == before["notification_definitions"]
    assert introduce_supplied_policies(candidate) is candidate


def test_skipped_retired_introductions_are_recorded_without_restoration() -> None:
    """Known retired identities stay absent when an installation skipped a release."""
    data = initial_settings("UTC")
    data["supplied_policy_introductions"] = [
        *LEGACY_POLICY_INTRODUCTIONS[:-1],
        "future_reserved",
    ]
    data["monitoring_policies"] = []
    candidate = introduce_supplied_policies(data)
    assert {row["id"] for row in candidate["monitoring_policies"]} == set(
        CATEGORY_POLICY_INTRODUCTIONS
    )
    assert all(not row["enabled"] for row in candidate["monitoring_policies"])
    assert set(candidate["supplied_policy_introductions"]) == {
        *SUPPLIED_POLICY_INTRODUCTIONS,
        "future_reserved",
    }
    candidate["monitoring_policies"] = []
    assert introduce_supplied_policies(candidate) is candidate


@pytest.mark.parametrize(
    "invalid", [None, {}, "default_cameras", [True], [""], ["a", "a"]]
)
def test_invalid_introduction_metadata_is_rejected(invalid: Any) -> None:
    """Corrupt tracking cannot be mistaken for a reason to recreate policies."""
    data = initial_settings("UTC")
    data["supplied_policy_introductions"] = invalid
    with pytest.raises(ValueError, match="supplied policy introductions"):
        introduce_supplied_policies(data)


async def test_dashboard_saves_and_selective_restoration_preserve_metadata(
    hass: HomeAssistant,
) -> None:
    """Tracking stays installation metadata outside the editable policy draft."""
    current = initial_settings("UTC")
    current["supplied_policy_introductions"].append("retired_future")
    draft = _editable_settings(Settings.from_data(current))
    assert "supplied_policy_introductions" not in draft
    draft["monitoring_policies"] = []
    saved = await _settings_candidate(hass, current, draft)
    assert (
        saved["supplied_policy_introductions"]
        == current["supplied_policy_introductions"]
    )
    assert introduce_supplied_policies(saved) is saved
    draft["monitoring_policies"] = [initial_settings("UTC")["monitoring_policies"][2]]
    restored = await _settings_candidate(hass, saved, draft)
    assert (
        restored["supplied_policy_introductions"]
        == current["supplied_policy_introductions"]
    )
    assert [row["id"] for row in restored["monitoring_policies"]] == ["default_cameras"]


@pytest.mark.parametrize("location", ["data", "options"])
@pytest.mark.parametrize("failure", ["validation", "restore", "settings_write"])
async def test_failed_addition_preserves_settings_tracking_and_snapshot(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    location: str,
    failure: str,
) -> None:
    """Validation, restore and settings-write errors leave no partial introduction."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    assert await hass.config_entries.async_unload(entry.entry_id)
    storage_key = f"{DOMAIN}.{entry.entry_id}"
    data = deepcopy(config_data)
    data.pop("supplied_policy_introductions")
    if failure == "validation":
        data["timings"]["settle"] = -1
    elif failure == "restore":
        hass_storage[storage_key]["data"]["engine"]["schema_version"] = 900
    hass.config_entries.async_update_entry(
        entry,
        data=data if location == "data" else config_data,
        options=data if location == "options" else {},
    )
    before = deepcopy(
        (dict(entry.data), dict(entry.options), hass_storage[storage_key])
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
        patch.object(
            hass.config_entries,
            "async_update_entry",
            side_effect=OSError("settings write failed"),
        )
        if failure == "settings_write"
        else nullcontext(),
    ):
        for attempt in range(2):
            setup = (
                await hass.config_entries.async_reload(entry.entry_id)
                if attempt and failure == "validation"
                else await hass.config_entries.async_setup(entry.entry_id)
            )
            await hass.async_block_till_done()
            if failure == "validation":
                assert not setup
            else:
                assert setup
                assert not entry.runtime_data.available
                await entry.runtime_data.async_refresh()
                assert await hass.config_entries.async_unload(entry.entry_id)
            assert (
                dict(entry.data),
                dict(entry.options),
                hass_storage[storage_key],
            ) == before
        assert not events
        send.assert_not_awaited()


@pytest.mark.parametrize("queued", [False, True], ids=["presented", "outbox"])
async def test_introductions_preserve_delivery_and_replay_identity(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    queued: bool,
) -> None:
    """Disabled additions neither reopen delivery nor change a queued request id."""
    hass.states.async_set("sensor.observed", "42")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
    ) as send:
        runtime = await start_monitor(hass, entry)
        with (
            patch.object(runtime, "_flush_events", new=AsyncMock())
            if queued
            else nullcontext()
        ):
            hass.states.async_set("sensor.observed", "unavailable")
            await hass.async_block_till_done()
            messages = deepcopy(runtime.delivery.messages)
            pending = deepcopy(runtime.delivery.outbox)
            assert messages
            assert bool(pending) is queued
            # Published Match records lacked the new optional qualification field.
            previous_signatures = deepcopy(runtime._route_signatures())
            for signature in previous_signatures.values():
                for rule in signature["rules"]:
                    rule["match"].pop("qualified_nodes", None)
            previous_routes = {
                route: json_digest(signature)
                for route, signature in previous_signatures.items()
            }
            assert runtime._route_digests() == previous_routes
            events.clear()
            send.reset_mock()
            old = deepcopy(config_data)
            old.pop("supplied_policy_introductions")
            hass.config_entries.async_update_entry(entry, options=old)
            with patch.object(runtime, "_route_digests", return_value=previous_routes):
                assert await hass.config_entries.async_unload(entry.entry_id)
                assert (
                    hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"][
                        "attention_routes"
                    ]
                    == previous_routes
                )
                assert await hass.config_entries.async_setup(entry.entry_id)
                await hass.async_block_till_done()
        assert entry.runtime_data.delivery.messages == messages
        assert entry.runtime_data._route_digests() == previous_routes
        assert [event.data["delivery_id"] for event in events] == [
            row["delivery_id"] for row in pending
        ]
        assert send.await_count == len(pending)
        assert not entry.runtime_data.delivery.outbox
        assert entry.data["supplied_policy_introductions"] == list(
            SUPPLIED_POLICY_INTRODUCTIONS
        )
        previous = list(events)
        for _ in range(2):
            assert await hass.config_entries.async_reload(entry.entry_id)
            await hass.async_block_till_done()
            assert events == previous
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_failed_first_introduction_write_does_not_create_runtime_storage(
    hass: HomeAssistant, config_data: dict[str, Any], hass_storage: dict[str, Any]
) -> None:
    """A failed conversion cannot save new runtime state when none existed before."""
    data = deepcopy(config_data)
    data.pop("supplied_policy_introductions")
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    storage_key = f"{DOMAIN}.{entry.entry_id}"
    before = deepcopy((dict(entry.data), dict(entry.options)))
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with (
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
        patch.object(
            hass.config_entries,
            "async_update_entry",
            side_effect=OSError("settings write failed"),
        ),
    ):
        runtime = await start_monitor(hass, entry)
        assert not runtime.available
        assert await hass.config_entries.async_unload(entry.entry_id)
        assert (dict(entry.data), dict(entry.options)) == before
        assert storage_key not in hass_storage
        assert not events
        send.assert_not_awaited()
