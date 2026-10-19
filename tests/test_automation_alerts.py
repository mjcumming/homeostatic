"""Single-form registration, independent lifecycles, ownership, and phone responses."""

from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import Context, CoreState, Event, EventOrigin, HomeAssistant
from homeassistant.exceptions import (
    HomeAssistantError,
    ServiceValidationError,
    Unauthorized,
)
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)

from custom_components.homeostatic import automation_alerts, phone_actions
from custom_components.homeostatic import runtime as runtime_module
from custom_components.homeostatic.automation_alerts import (
    AutomationAlerts,
    automation_owner,
    identity,
)
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.notification_routes import Destination
from custom_components.homeostatic.phone_actions import PhoneActions
from tests.policy_helpers import (
    current_config,
    immediate_notification,
    notification_definitions_data,
)
from tests.test_lifecycle import start_monitor


@pytest.fixture
def owner(hass: HomeAssistant) -> str:
    """A saved automation has a stable configuration ID independent of its name."""
    entry = er.async_get(hass).async_get_or_create(
        "automation", "automation", "owner-a", suggested_object_id="alert_a"
    )
    hass.states.async_set(entry.entity_id, "on", {"id": "owner-a"})
    hass.states.async_set("sensor.observed", "42")
    return entry.entity_id


async def report(
    hass: HomeAssistant, owner: str, state: str = "active", **extra: Any
) -> dict[str, Any]:
    """Exercise the public action rather than directly enrolling engine checks."""
    return await hass.services.async_call(
        DOMAIN,
        "report_alert",
        {
            "automation": owner,
            "name": "Basement water",
            "message": "Water by heater",
            "profile": "dashboard",
            "state": state,
            **extra,
        },
        blocking=True,
        return_response=True,
    )


async def manage(hass: HomeAssistant, owner: str, operation: str, **extra: Any) -> None:
    """Retire/resume through the protected service."""
    await hass.services.async_call(
        DOMAIN,
        "manage_alert",
        {"automation": owner, "operation": operation, **extra},
        blocking=True,
    )


async def test_identity_refresh_recovery_restart_retirement(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    owner: str,
    freezer: FrozenDateTimeFactory,
) -> None:
    """One condition remains identifiable across renames, restarts and recurrence."""
    runtime = await start_monitor(hass, config_entry)
    result = await report(hass, owner, "clear")
    node = result["node_id"]
    assert not runtime.episodes
    await report(hass, owner)
    episode = next(iter(runtime.episodes))
    await report(hass, owner, name="Renamed leak", message="Still wet")
    assert list(runtime.episodes) == [episode]
    assert runtime.sources[node].name == "Renamed leak"
    renamed = er.async_get(hass).async_update_entity(
        owner, new_entity_id="automation.renamed"
    )
    assert automation_owner(hass, renamed.entity_id) == "owner-a"
    await report(hass, renamed.entity_id)
    assert list(runtime.episodes) == [episode]
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert list(runtime.episodes) == [episode]
    assert runtime.engine.readiness([node]).answer == "unknown"
    await report(hass, renamed.entity_id)
    freezer.tick(timedelta(seconds=301))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node]).answer == "unknown"
    assert list(runtime.episodes) == [episode]
    await report(hass, renamed.entity_id, "clear")
    assert not runtime.episodes
    await report(hass, renamed.entity_id)
    assert next(iter(runtime.episodes)) != episode
    await manage(hass, renamed.entity_id, "retire")
    assert not runtime.episodes
    with pytest.raises(ServiceValidationError, match="retired"):
        await report(hass, renamed.entity_id)
    await manage(hass, renamed.entity_id, "resume")
    assert not runtime.episodes
    await report(hass, renamed.entity_id)
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_current_default_delivers_dynamic_alert_through_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry, owner: str
) -> None:
    """A saved current default retains delivery for an automation-created situation."""
    config_entry.data["notification_definitions"]["default"] = immediate_notification()
    assert config_entry.data["notification_definitions"]["automation_profiles"] == {}
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, config_entry)
    result = await report(hass, owner, profile="immediate")
    await hass.async_block_till_done()
    episode_id = next(iter(runtime.episodes))
    assert [event.data["action"] for event in events] == ["open"]
    assert events[0].data["cause"] == result["node_id"]
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert list(config_entry.runtime_data.episodes) == [episode_id]
    assert [event.data["action"] for event in events] == ["open"]
    await report(hass, owner, "clear", profile="immediate")
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["open", "resolve"]
    assert events[-1].data["episode_id"] == episode_id
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_retired_alert_blocks_reports_without_using_active_capacity(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    owner: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retired declaration remains blocked while its automation exists."""
    runtime = await start_monitor(hass, config_entry)
    await report(hass, owner, "clear")
    await manage(hass, owner, "retire")
    key = identity("owner-a", "default")
    assert runtime.automation_alerts.records[key]["retired"]
    monkeypatch.setattr(automation_alerts, "MAX_ALERTS", 1)
    await report(hass, owner, "clear", alert_key="new")
    assert len(runtime.automation_alerts.records) == 2
    with pytest.raises(ServiceValidationError, match="retired"):
        await report(hass, owner, alert_key="default")
    monkeypatch.setattr(runtime_module, "MAX_ALERTS", 1)
    with pytest.raises(ServiceValidationError, match="capacity"):
        await manage(hass, owner, "resume")
    assert runtime.automation_alerts.records[key]["retired"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_deleted_automation_removes_its_alert_definition(
    hass: HomeAssistant, config_entry: MockConfigEntry, owner: str
) -> None:
    """Deleting the HA automation retires its issue as removed and frees storage."""
    runtime = await start_monitor(hass, config_entry)
    result = await report(hass, owner)
    assert runtime.episodes
    er.async_get(hass).async_remove(owner)
    await runtime.async_refresh()
    assert not runtime.automation_alerts.records
    assert result["node_id"] not in runtime.sources
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_distinct_conditions_and_owners(
    hass: HomeAssistant, config_entry: MockConfigEntry, owner: str
) -> None:
    """Door and leak may share a profile without sharing acknowledgment or recovery."""
    other = (
        er.async_get(hass)
        .async_get_or_create(
            "automation", "automation", "owner-b", suggested_object_id="alert_b"
        )
        .entity_id
    )
    runtime = await start_monitor(hass, config_entry)
    await report(hass, owner)
    leak = next(iter(runtime.episodes))
    await report(hass, owner, alert_key="door", name="Door open")
    await report(hass, other)
    assert len(runtime.episodes) == 3
    await runtime.async_control("acknowledge", {"episode_id": leak}, None)
    await report(hass, owner, "clear")
    assert len(runtime.episodes) == 2
    assert all(runtime.policy.acknowledgment(e) is None for e in runtime.episodes)
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "extra,error",
    [
        pytest.param(
            {"automation": "automation.unsaved"}, "saved HA automation", id="unsaved"
        ),
        pytest.param({"name": " "}, "alert name", id="blank-name"),
        pytest.param(
            {"profile": "urgent"}, "value must be one of", id="invalid-profile"
        ),
        pytest.param(
            {"adopt_situation_id": "missing"},
            "declared automation",
            id="missing-adoption",
        ),
    ],
)
async def test_invalid_reports_do_not_register(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    owner: str,
    extra: dict[str, Any],
    error: str,
) -> None:
    """Rejected reports cannot leave partial declarations or enable requests."""
    runtime = await start_monitor(hass, config_entry)
    with pytest.raises((ServiceValidationError, vol.Invalid), match=error):
        await report(hass, owner, **extra)
    assert runtime.automation_alerts.records == {}
    assert not runtime.episodes
    with pytest.raises(ServiceValidationError, match="existing"):
        await manage(hass, owner, "retire")
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_explicit_adoption_preserves_episode(
    hass: HomeAssistant, config_data: dict[str, Any], owner: str
) -> None:
    """Conversion transfers ownership without resetting a currently open episode."""
    config_data["situations"] = [
        {"id": "old_leak", "name": "Old leak", "report_timeout": 300}
    ]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    await hass.services.async_call(
        DOMAIN,
        "report_situation",
        {"situation_id": "old_leak", "state": "active"},
        blocking=True,
    )
    episode = next(iter(runtime.episodes))
    await report(hass, owner, adopt_situation_id="old_leak")
    assert list(runtime.episodes) == [episode]
    with pytest.raises(ServiceValidationError, match="owns"):
        await report(hass, owner, alert_key="conflict", adopt_situation_id="old_leak")
    with pytest.raises(ServiceValidationError, match="now owned"):
        await hass.services.async_call(
            DOMAIN,
            "report_situation",
            {"situation_id": "old_leak", "state": "clear"},
            blocking=True,
        )
    await manage(hass, owner, "retire")
    await runtime.async_refresh()
    assert "situation:old_leak" not in runtime.sources
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.fixture
def phone_policy(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_read_only_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Any]:
    """Existing owner-selected profiles with a mocked registered phone transport."""
    route = Destination(
        channel="phone:mine",
        name="Phone",
        user_id=hass_read_only_user.id,
        available=True,
    )
    monkeypatch.setattr(phone_actions, "destinations", lambda _h: [route])
    value = notification_definitions_data()
    value["methods"]["mine"] = {
        "name": "Phone",
        "mode": "fixed",
        "destinations": ["phone:mine"],
    }
    value["automation_profiles"] = {
        profile: [{"id": profile, "timing": timing, "methods": ["mine"]}]
        for profile, timing in {
            "acknowledge": {"mode": "acknowledge", "remind_every": 3600},
            "immediate": {"mode": "immediate"},
            "morning": {"mode": "report", "at": "08:00", "weekdays": list(range(7))},
            "evening": {"mode": "report", "at": "20:00", "weekdays": list(range(7))},
            "weekly": {"mode": "report", "at": "09:00", "weekdays": [6]},
        }.items()
    }
    config_data["notification_definitions"] = value
    monkeypatch.setattr(runtime_module, "async_send", AsyncMock())
    return config_data


@pytest.mark.parametrize(
    "profile,loudness",
    [
        ("acknowledge", "urgent"),
        ("immediate", "urgent"),
        ("morning", "digest"),
        ("evening", "digest"),
        ("weekly", "digest"),
        ("dashboard", "record"),
    ],
)
async def test_profile_selection(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    profile: str,
    loudness: str,
) -> None:
    """Source labels select the shared profile without rewriting household settings."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    before = deepcopy(runtime.settings.policy)
    result = await report(hass, owner, profile=profile)
    episode = next(iter(runtime.episodes))
    assert runtime.policy.explain(episode)["loudness"] == loudness
    assert runtime.settings.policy == before
    assert result["reporting_status"] in {"configured", "dashboard_only"}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_phone_ack_callback_and_old_occurrence(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
) -> None:
    """An authenticated non-admin recipient can acknowledge only the delivered episode."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner, profile="acknowledge")
    await hass.async_block_till_done()
    episode = next(iter(runtime.episodes))
    token = next(iter(runtime.phone_actions.records))
    assert runtime_module.async_send.call_args.kwargs["acknowledgment"] == token
    assert not hass_read_only_user.is_admin
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": token},
        EventOrigin.remote,
        context=Context(user_id=hass_read_only_user.id),
    )
    await hass.async_block_till_done()
    assert runtime.policy.acknowledgment(episode).actor_id == hass_read_only_user.id
    assert episode in runtime.episodes
    original = runtime.policy.acknowledgment(episode)
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": token},
        EventOrigin.remote,
        context=Context(user_id=hass_read_only_user.id),
    )
    await hass.async_block_till_done()
    assert runtime.policy.acknowledgment(episode) == original
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert token in runtime.phone_actions.records
    await report(hass, owner, "clear", profile="acknowledge")
    await report(hass, owner, profile="acknowledge")
    fresh = next(iter(runtime.episodes))
    assert fresh != episode
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": token},
        EventOrigin.remote,
        context=Context(user_id=hass_read_only_user.id),
    )
    await hass.async_block_till_done()
    assert runtime.policy.acknowledgment(fresh) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "origin,actor,token",
    [
        (EventOrigin.local, "owner", "valid"),
        (EventOrigin.remote, "other", "valid"),
        (EventOrigin.remote, None, "valid"),
        (EventOrigin.remote, "owner", "unknown"),
        (EventOrigin.remote, "owner", None),
    ],
)
async def test_phone_rejects_forged_callbacks(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
    origin: EventOrigin,
    actor: str | None,
    token: str | None,
) -> None:
    """Client-supplied actor fields cannot override HA's authenticated context."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner, profile="immediate")
    await hass.async_block_till_done()
    actual = next(iter(runtime.phone_actions.records))
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {
                "action": {"valid": actual, "unknown": "unknown", None: None}[token],
                "user_id": hass_read_only_user.id,
            },
            origin,
            context=Context(
                user_id={
                    "owner": hass_read_only_user.id,
                    "other": "stranger",
                    None: None,
                }[actor]
            ),
        )
    )
    assert runtime.policy.acknowledgment(next(iter(runtime.episodes))) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_registration_storage_failure_and_authorization(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    owner: str,
    hass_read_only_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Existing admin protection and persistence-before-delivery remain in force."""
    runtime = await start_monitor(hass, config_entry)
    with pytest.raises(Unauthorized):
        await hass.services.async_call(
            DOMAIN,
            "report_alert",
            {
                "automation": owner,
                "name": "Leak",
                "message": "wet",
                "profile": "dashboard",
                "state": "active",
            },
            blocking=True,
            context=Context(user_id=hass_read_only_user.id),
        )
    original = runtime.store.async_save
    monkeypatch.setattr(
        runtime.store, "async_save", AsyncMock(side_effect=OSError("disk"))
    )
    with pytest.raises(HomeAssistantError):
        await report(hass, owner)
    assert not runtime.available
    monkeypatch.setattr(runtime.store, "async_save", original)
    await runtime.async_refresh()
    assert runtime.available
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def test_registry_roundtrip_and_caps(
    hass: HomeAssistant, owner: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Declaration bounds and ownership survive serialization."""
    from custom_components.homeostatic.config import Settings

    registry = AutomationAlerts()
    payload = {
        "automation": owner,
        "name": "Leak",
        "message": "Wet",
        "profile": "dashboard",
        "state": "active",
    }
    key, row = registry.prepare(hass, Settings.from_data(current_config()), payload)
    registry.restore({key: row})
    assert registry.records[key] == row
    assert identity("owner-a", "door") != key
    with pytest.raises(ValueError, match="stored"):
        registry.restore({"wrong": row})
    monkeypatch.setattr(automation_alerts, "MAX_ALERTS", 1)
    with pytest.raises(ValueError, match="capacity"):
        registry.prepare(
            hass,
            Settings.from_data(current_config()),
            {**payload, "alert_key": "other"},
        )
    hass.set_state(CoreState.not_running)
    assert not registry.prune_removed_owners(hass)
    assert registry.records == {key: row}
    hass.set_state(CoreState.running)


def test_phone_references_bounded_and_expiring(
    hass: HomeAssistant, phone_policy: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Old phone references expire without being reassigned to another occurrence."""
    actions = PhoneActions()
    now = dt_util.utcnow()
    payload = {
        "episode_id": "episode",
        "recipient": "method:mine",
        "delivery_id": "delivery",
        "action": "open",
    }
    token = actions.prepare(hass, payload, "phone:mine", now)
    saved = deepcopy(actions.records)
    actions.restore(saved)
    assert token in actions.records
    monkeypatch.setattr(phone_actions, "MAX_ACTIONS", 1)
    next_token = actions.prepare(
        hass, payload, "phone:mine", now + timedelta(seconds=1)
    )
    assert list(actions.records) == [next_token]
    assert actions.prepare(hass, {**payload, "episodes": []}, "phone:mine", now) is None
    assert actions.prepare(hass, payload, "notify:any", now) is None
    with pytest.raises(ValueError, match="stored"):
        actions.restore({"wrong": next(iter(saved.values()))})
    actions.prune(now + timedelta(days=31))
    assert not actions.records


@pytest.mark.parametrize(
    "group",
    [
        pytest.param({"episodes": ["first"]}, id="summary-without-device"),
        pytest.param({"notification_subject": "device:one"}, id="missing-issues"),
        pytest.param(
            {"notification_subject": "device:one", "episodes": []}, id="empty"
        ),
        pytest.param(
            {"notification_subject": "device:one", "episodes": "first"},
            id="not-a-list",
        ),
        pytest.param(
            {"notification_subject": "device:one", "episodes": ["first", 2]},
            id="invalid-issue",
        ),
        pytest.param(
            {"notification_subject": "device:one", "episodes": [""]},
            id="empty-identity",
        ),
        pytest.param(
            {"notification_subject": "device:one", "episodes": ["first", "first"]},
            id="duplicate-identity",
        ),
        pytest.param(
            {"notification_subject": "entry:one", "episodes": ["first"]},
            id="not-a-device",
        ),
        pytest.param(
            {
                "notification_subject": "device:one",
                "episodes": ["first"],
                "action": "digest",
            },
            id="digest",
        ),
        pytest.param(
            {
                "notification_subject": "device:one",
                "episodes": ["first"],
                "action": "summary",
            },
            id="startup-summary",
        ),
        pytest.param(
            {
                "notification_subject": "device:one",
                "episodes": ["first"],
                "action": "resolve",
            },
            id="resolved",
        ),
    ],
)
def test_phone_group_requires_exact_active_device_issues(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    group: dict[str, Any],
) -> None:
    """General summaries and malformed device lists do not acquire acknowledgment."""
    actions = PhoneActions()
    payload = {
        "episode_id": "device-group",
        "recipient": "method:mine",
        "delivery_id": "delivery",
        "action": "open",
        **group,
    }
    assert actions.prepare(hass, payload, "phone:mine", dt_util.utcnow()) is None
    assert not actions.records


@pytest.mark.parametrize(
    "group",
    [
        {"notification_subject": "device:one"},
        {"notification_id": "acknowledge", "group": "collection_one"},
    ],
)
def test_grouped_phone_reference_freezes_shown_issues(
    hass: HomeAssistant, phone_policy: dict[str, Any], group: dict[str, str]
) -> None:
    """Later changes to a message cannot expand an already-issued button's authority."""
    actions = PhoneActions()
    payload = {
        "episode_id": "device-group",
        **group,
        "episodes": ["first", "second"],
        "recipient": "method:mine",
        "delivery_id": "delivery",
        "action": "open",
    }
    token = actions.prepare(hass, payload, "phone:mine", dt_util.utcnow())
    assert token is not None
    payload["episodes"].append("later")
    assert actions.records[token]["episodes"] == ["first", "second"]
    saved = deepcopy(actions.records)
    actions.restore(saved)
    assert actions.records == saved
    with pytest.raises(vol.Invalid):
        actions.restore({token: {**saved[token], "episodes": []}})


@pytest.mark.parametrize(
    "group",
    [
        {"notification_subject": "device:one"},
        {"notification_id": "acknowledge", "group": "collection_one"},
    ],
)
async def test_grouped_phone_ack_survives_partial_recovery_without_clearing_later_issues(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
    group: dict[str, str],
) -> None:
    """A saved device button acknowledges remaining shown issues, never later failures."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner, alert_key="first", profile="acknowledge")
    first = next(iter(runtime.episodes))
    await report(hass, owner, alert_key="second", profile="acknowledge")
    second = next(episode for episode in runtime.episodes if episode != first)
    token = runtime.phone_actions.prepare(
        hass,
        {
            "episode_id": "device-group",
            **group,
            "episodes": [first, second],
            "recipient": "method:mine",
            "delivery_id": "group-delivery",
            "action": "open",
        },
        "phone:mine",
        dt_util.utcnow(),
    )
    assert token is not None
    await report(hass, owner, "clear", alert_key="first", profile="acknowledge")
    assert first not in runtime.episodes
    await report(hass, owner, alert_key="first", profile="acknowledge")
    later = next(episode for episode in runtime.episodes if episode != second)
    assert later != first
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.phone_actions.records[token]["episodes"] == [first, second]
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert runtime.policy.acknowledgment(second).actor_id == hass_read_only_user.id
    assert runtime.policy.acknowledgment(later) is None
    assert set(runtime.episodes) == {second, later}
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "channel,unacknowledged",
    [
        pytest.param("phone:mine", False, id="current-route"),
        pytest.param("phone:other", True, id="removed-route"),
    ],
)
async def test_grouped_phone_ack_applies_to_each_shown_issue_with_current_permission(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
    channel: str,
    unacknowledged: bool,
) -> None:
    """A grouped action retains the same destination permission checks as one issue."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner, alert_key="first", profile="acknowledge")
    await report(hass, owner, alert_key="second", profile="acknowledge")
    shown = list(runtime.episodes)
    assert len(shown) == 2
    token = runtime.phone_actions.prepare(
        hass,
        {
            "episode_id": "device-group",
            "notification_subject": "device:one",
            "episodes": shown,
            "recipient": "method:mine",
            "delivery_id": "group-delivery",
            "action": "open",
        },
        "phone:mine",
        dt_util.utcnow(),
    )
    assert token is not None
    runtime.settings.notification_definitions["methods"]["mine"]["destinations"] = [
        channel
    ]
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert [runtime.policy.acknowledgment(episode) is None for episode in shown] == [
        unacknowledged,
        unacknowledged,
    ]
    assert list(runtime.episodes) == shown
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_profile_update_and_preview(
    hass: HomeAssistant, phone_policy: dict[str, Any], owner: str
) -> None:
    """Changing a profile keeps the episode and previews the effective source policy."""
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner)
    episode = next(iter(runtime.episodes))
    await report(hass, owner, profile="acknowledge")
    assert list(runtime.episodes) == [episode]
    assert runtime.policy.explain(episode)["loudness"] == "urgent"
    preview = runtime.preview_policy(runtime.settings.policy)
    assert preview["episodes"][0]["loudness"] == "urgent"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "notifications,rows,status",
    [
        (
            False,
            [{"id": "now", "timing": {"mode": "immediate"}, "methods": ["mine"]}],
            "requests_disabled",
        ),
        (True, [], "missing_destinations"),
    ],
)
async def test_unready_reporting_does_not_send(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
    notifications: bool,
    rows: list[dict[str, Any]],
    status: str,
) -> None:
    """An unsendable preference stays visible without choosing another recipient."""
    phone_policy["notification_definitions"]["automation_profiles"]["immediate"] = rows
    phone_policy["notifications"] = notifications
    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    result = await report(hass, owner, profile="immediate")
    await hass.async_block_till_done()
    assert result["reporting_status"] == status
    assert len(runtime.episodes) == 1
    runtime_module.async_send.assert_not_called()
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "change",
    [
        "expired",
        "inactive",
        "missing-user",
        "removed-phone",
        "changed-owner",
        "disabled-requests",
        "removed-recipient",
        "removed-channel",
        "storage-failure",
    ],
)
async def test_callback_rechecks_authority(
    hass: HomeAssistant,
    phone_policy: dict[str, Any],
    owner: str,
    hass_read_only_user: User,
    change: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A delivered button loses authority when its identity, route, or storage is invalid."""
    from dataclasses import replace

    entry = MockConfigEntry(domain=DOMAIN, data=phone_policy)
    runtime = await start_monitor(hass, entry)
    await report(hass, owner, profile="acknowledge")
    await hass.async_block_till_done()
    token = next(iter(runtime.phone_actions.records))
    episode = next(iter(runtime.episodes))

    def expired() -> None:
        runtime.phone_actions.records[token]["expires_at"] = (
            dt_util.utcnow() - timedelta(seconds=1)
        ).isoformat()

    def inactive() -> None:
        monkeypatch.setattr(hass_read_only_user, "is_active", False)

    def missing_user() -> None:
        monkeypatch.setattr(hass.auth, "async_get_user", AsyncMock(return_value=None))

    def removed_phone() -> None:
        monkeypatch.setattr(phone_actions, "destinations", lambda _: [])

    def changed_owner() -> None:
        monkeypatch.setattr(
            phone_actions,
            "destinations",
            lambda _: [
                Destination(
                    channel="phone:mine",
                    name="Reassigned",
                    user_id="new-user",
                    available=True,
                )
            ],
        )

    def disabled() -> None:
        runtime.settings = replace(runtime.settings, notifications=False)

    def removed_recipient() -> None:
        runtime.settings = replace(
            runtime.settings, notification_definitions=notification_definitions_data()
        )

    def removed_channel() -> None:
        runtime.settings.notification_definitions["methods"]["mine"]["destinations"] = [
            "phone:other"
        ]

    original_save = runtime.store.async_save

    def storage_failure() -> None:
        monkeypatch.setattr(
            runtime.store, "async_save", AsyncMock(side_effect=OSError("disk"))
        )

    {
        "expired": expired,
        "inactive": inactive,
        "missing-user": missing_user,
        "removed-phone": removed_phone,
        "changed-owner": changed_owner,
        "disabled-requests": disabled,
        "removed-recipient": removed_recipient,
        "removed-channel": removed_channel,
        "storage-failure": storage_failure,
    }[change]()
    await runtime.async_phone_action(
        Event(
            "mobile_app_notification_action",
            {"action": token},
            EventOrigin.remote,
            context=Context(user_id=hass_read_only_user.id),
        )
    )
    assert (runtime.policy.acknowledgment(episode) is None, runtime.available) == {
        "storage-failure": (False, False)
    }.get(change, (True, True))
    monkeypatch.setattr(runtime.store, "async_save", original_save)
    assert await hass.config_entries.async_unload(entry.entry_id)
