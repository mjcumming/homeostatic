"""Owner policy scenarios: routing, quiet reminders, activation, digests and replay."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import Loudness, Notification, ResolutionNotice
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ServiceValidationError
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic import async_setup_entry
from custom_components.homeostatic.attention import (
    DEFAULT_POLICY,
    build_policy,
    duration,
    policy_data,
)
from custom_components.homeostatic.config import Settings, data_from_input
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.delivery import DeliveryState
from tests.test_lifecycle import start_monitor


def owner_policy(*, quiet: bool = False) -> dict[str, Any]:
    """A normal reminder becomes urgent after two hours."""
    data = deepcopy(DEFAULT_POLICY)
    data["rules"] = [
        {
            "match": {},
            "loudness": "notify",
            "to": ["owner"],
            "remind_every": "1h",
            "escalate_after": "2h",
        }
    ]
    if quiet:
        data["recipients"]["owner"]["quiet_hours"] = {"start": "22:00", "end": "07:00"}
    return data


@pytest.mark.parametrize(
    "value", [True, -1, 1.5, "", "-1h", "2m1h", "1y", 31536001, None]
)
def test_invalid_duration(value: Any) -> None:
    """Malformed or unbounded duration input is rejected before saving."""
    with pytest.raises(vol.Invalid):
        duration(value)


@pytest.mark.parametrize(
    "field,value",
    [
        pytest.param("timezone", "Unknown/Place", id="zone"),
        pytest.param("timezone", "../UTC", id="zone-path"),
        pytest.param("extra", True, id="unknown-key"),
        pytest.param("recipients", {"owner": {"channels": []}}, id="empty-channels"),
        pytest.param(
            "recipients",
            {"owner": {"channels": ["phone", "phone"]}},
            id="duplicate-channel",
        ),
        pytest.param(
            "recipients",
            {
                "owner": {
                    "channels": ["phone"],
                    "quiet_hours": {"start": "22:00", "end": "22:00"},
                }
            },
            id="empty-quiet",
        ),
        pytest.param(
            "recipients",
            {
                "owner": {
                    "channels": ["phone"],
                    "quiet_hours": {"start": "25:00", "end": "07:00"},
                }
            },
            id="clock",
        ),
        pytest.param("rules", [], id="empty-rules"),
        pytest.param(
            "rules",
            [{"match": {}, "loudness": "notify", "to": "missing"}],
            id="recipient",
        ),
        pytest.param(
            "rules",
            [{"match": {}, "loudness": "digest", "digest": "missing"}],
            id="digest",
        ),
        pytest.param(
            "rules",
            [{"match": {}, "loudness": "urgent", "to": "owner", "remind_every": 0}],
            id="zero-reminder",
        ),
        pytest.param(
            "rules",
            [{"match": {"status": "broken"}, "loudness": "record"}],
            id="status",
        ),
        pytest.param(
            "rules",
            [{"match": {"importance": "important"}, "loudness": "record"}],
            id="importance",
        ),
        pytest.param("rules", [{"match": {}, "loudness": "loud"}], id="loudness"),
        pytest.param(
            "rules",
            [{"match": {}, "loudness": "notify", "to": ["owner", "owner"]}],
            id="duplicate-route",
        ),
    ],
)
def test_invalid_policy(field: str, value: Any) -> None:
    """Owner errors fail validation rather than changing routing silently."""
    data = deepcopy(DEFAULT_POLICY)
    data[field] = value
    with pytest.raises((ValueError, vol.Invalid)):
        Settings.from_data({"policy": data})


def test_all_match_fields_and_detached_settings() -> None:
    """Adapter parsing preserves every supported library match field."""
    data = owner_policy()
    data["timezone"] = "America/Chicago"
    data["rules"][0]["match"] = {
        "status": ["fail", "unknown"],
        "importance": "high",
        "reason": "unavailable",
        "category": "situation",
        "labels": {"site": "home"},
        "age": "1d2h3m4s",
        "due_within": 60,
    }
    saved = policy_data(data)
    data["rules"].clear()
    config = build_policy(saved, timedelta(seconds=5))
    assert config.rules[0].match.age == timedelta(days=1, hours=2, minutes=3, seconds=4)
    assert config.rules[0].match.due_within == timedelta(minutes=1)
    assert config.rules[0].match.reason == frozenset({"unavailable"})
    assert config.rules[0].match.category == frozenset({"situation"})
    assert len(config.rules[0].match.status or ()) == 2


async def test_policy_flow_preserves_owner_data(hass: HomeAssistant) -> None:
    """The native setup preview retains unsaved policy and validates errors."""
    data = owner_policy()
    assert data_from_input(hass, {"policy": data})["policy"] == data
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    preview = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"policy": data, "preview": True}
    )
    assert preview["type"] == "form"
    assert "Policy: 1 rules" in preview["description_placeholders"]["preview"]
    invalid = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"policy": {"unexpected": True}}
    )
    assert invalid["errors"] == {"base": "invalid_config"}
    saved = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"policy": data}
    )
    assert saved["data"]["policy"] == data


async def test_reminder_quiet_escalation_and_restart(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A quiet reminder waits; urgent escalation then repeats across restart."""
    freezer.move_to(datetime(2026, 9, 25, 21, tzinfo=UTC))
    config_data["policy"] = owner_policy(quiet=True)
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    assert [event.data["action"] for event in events] == ["open"]
    assert events[0].data["channels"] == ["event"]
    freezer.tick(timedelta(hours=1))
    await runtime.async_refresh()
    assert len(events) == 1
    detail = runtime.query("policy", {})
    assert detail["episodes"][0]["pending"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    freezer.tick(timedelta(hours=1))
    await entry.runtime_data.async_refresh()
    freezer.tick(timedelta(hours=1))
    await entry.runtime_data.async_refresh()
    freezer.tick(timedelta(hours=1))
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == [
        "open",
        "escalate",
        "remind",
        "remind",
    ]
    assert len({event.data["delivery_id"] for event in events}) == 4
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_activation_rebases_and_preview_does_not_mutate(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """An old problem keeps its age but gets a fresh attention period."""
    config_data.update(notifications=False, policy=owner_policy())
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    episode = next(iter(runtime.episodes.values()))
    freezer.tick(timedelta(hours=8))
    await runtime.async_refresh()
    before = deepcopy(runtime.snapshot())
    result = await hass.services.async_call(
        DOMAIN,
        "preview_policy",
        {"policy": owner_policy()},
        blocking=True,
        return_response=True,
    )
    assert result["episodes"][0]["loudness"] == "notify"
    assert result["episodes"][0]["opened_at"] == episode["opened_at"]
    assert runtime.snapshot() == before
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    preview = await hass.config_entries.options.async_configure(
        flow["flow_id"],
        {"policy": owner_policy(), "preview": True, "notifications": False},
    )
    assert "notify, recipients" in preview["description_placeholders"]["preview"]
    assert runtime.snapshot() == before
    assert not events
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "preview_policy",
            {"policy": {}},
            blocking=True,
            return_response=True,
        )
    hass.config_entries.async_update_entry(
        entry, options={**config_data, "notifications": True}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["summary"]
    assert events[0].data["loudness"] == "notify"
    freezer.tick(timedelta(hours=1))
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == [
        "summary",
        "resolve",
        "remind",
    ]
    freezer.tick(timedelta(hours=1))
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert events[-1].data["action"] == "escalate"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_digest_membership_and_resolution(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A scheduled digest remains accurate as its problems resolve across restart."""
    freezer.move_to(datetime(2026, 9, 25, 11, tzinfo=UTC))
    config_data["entities"] = ["entity_id:sensor.observed", "entity_id:sensor.other"]
    data = deepcopy(DEFAULT_POLICY)
    data["timezone"] = "America/Chicago"
    data["digests"] = {"morning": {"at": "08:00", "to": "owner"}}
    data["rules"] = [
        {"match": {}, "loudness": "digest", "digest": "morning", "remind_every": "1d"}
    ]
    config_data["policy"] = data
    hass.states.async_set("sensor.observed", "unavailable")
    hass.states.async_set("sensor.other", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    runtime = await start_monitor(hass, entry)
    assert not events
    freezer.tick(timedelta(hours=2))
    await runtime.async_refresh()
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["digest"]
    assert len(events[0].data["episodes"]) == 2
    tag = events[0].data["tag"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert events[-1].data["action"] == "update"
    assert len(events[-1].data["episodes"]) == 1
    hass.states.async_set("sensor.other", "42")
    await hass.async_block_till_done()
    assert events[-1].data["action"] == "resolve"
    assert all(event.data["tag"] == tag for event in events)
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_policy_change_withdraws_removed_route(
    hass: HomeAssistant,
    config_data: dict[str, Any],
) -> None:
    """Editing routing clears old tags and activates only the new recipient."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    await start_monitor(hass, entry)
    data = {
        "timezone": "UTC",
        "recipients": {"backup": {"channels": ["phone"]}},
        "rules": [{"match": {}, "loudness": "urgent", "to": "backup"}],
    }
    hass.config_entries.async_update_entry(
        entry, options={**config_data, "policy": data}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert [(event.data["recipient"], event.data["action"]) for event in events] == [
        ("owner", "open"),
        ("owner", "resolve"),
        ("backup", "summary"),
    ]
    assert events[-1].data["channels"] == ["phone"]
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_silent_deduplication_and_durable_summary_replay() -> None:
    """Only identical silent replacements are dropped; pending summaries retain ids."""
    state = DeliveryState("entry")
    content = {
        "schema_version": 1,
        "entry_id": "entry",
        "episode_id": "e",
        "title": "Fault",
        "message": "Unavailable",
        "tag": "test",
        "functions": [],
        "cause": "node",
    }
    initial = Notification(
        episode_id="e",
        recipient="backup",
        channels=("phone",),
        loudness=Loudness.NOTIFY,
    )
    state.record(initial, content)
    state.outbox.clear()
    update = Notification(
        episode_id="e",
        recipient="backup",
        channels=("phone",),
        loudness=Loudness.NOTIFY,
        silent=True,
        cause="update",
    )
    state.record(update, content)
    state.record(update, content)
    assert len(state.outbox) == 1
    assert state.outbox[0]["tag"] == "test_backup"
    activate = Notification(
        episode_id="e",
        recipient="backup",
        channels=("phone",),
        loudness=Loudness.URGENT,
        cause="activate",
    )
    state.record(activate, content)
    state.record(update, {**content, "message": "Other fault"})
    restored = DeliveryState("entry")
    restored.restore(deepcopy(state.snapshot()))
    assert restored.outbox == state.outbox
    restored.record(
        ResolutionNotice(
            episode_id="e",
            recipient="backup",
            channels=("phone",),
            resolution="cleared",
        ),
        {},
    )
    assert not restored.messages
    assert restored.outbox[-1]["action"] == "resolve"


def test_summary_alerts_only_for_authorized_members() -> None:
    """A later normal activation request cannot repeat an earlier urgent alert."""
    state = DeliveryState("entry")
    content = {
        "schema_version": 1,
        "entry_id": "entry",
        "episode_id": "urgent",
        "title": "Fault",
        "message": "Unavailable",
        "tag": "urgent",
        "functions": [],
        "cause": "node",
    }
    urgent = Notification(
        episode_id="urgent",
        recipient="owner",
        channels=("event",),
        loudness=Loudness.URGENT,
        cause="activate",
    )
    normal = Notification(
        episode_id="normal",
        recipient="owner",
        channels=("event",),
        loudness=Loudness.NOTIFY,
        cause="activate",
    )
    state.record(urgent, content)
    state.outbox.clear()
    state.record(normal, {**content, "episode_id": "normal", "tag": "normal"})
    assert state.outbox[-1]["loudness"] == "notify"
    state.record(
        ResolutionNotice(
            episode_id="normal",
            recipient="owner",
            channels=("event",),
            resolution="cleared",
        ),
        {},
    )
    assert state.outbox[-1]["silent"] is True
    state.outbox.clear()
    state.record(normal, {**content, "episode_id": "normal", "tag": "normal"})
    state.record(
        ResolutionNotice(
            episode_id="urgent",
            recipient="owner",
            channels=("event",),
            resolution="cleared",
        ),
        {},
    )
    assert state.outbox[-1]["action"] == "summary"
    assert state.outbox[-1]["silent"] is False
    assert state.outbox[-1]["episodes"] == ["normal"]


async def test_invalid_stored_policy_is_a_configuration_error(
    hass: HomeAssistant,
) -> None:
    """Malformed persisted YAML reports a configuration failure before monitoring."""
    entry = MockConfigEntry(domain=DOMAIN, data={"policy": {"unexpected": True}})
    with pytest.raises(ConfigEntryError, match="Invalid Homeostatic configuration"):
        await async_setup_entry(hass, entry)
