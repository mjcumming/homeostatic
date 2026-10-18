"""Named notification scheduling and preservation through the adapter compiler."""

from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from health_tree.policy import Policy
from health_tree.types import EpisodeResolved, PolicyConfig, PolicyContext, Status
from homeassistant.core import Event, HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_definitions as definitions
from custom_components.homeostatic import notification_grouping
from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.policy_defaults import initial_settings
from tests.policy_helpers import current_config, monitoring_policy
from tests.test_lifecycle import start_monitor
from tests.test_notification_definitions import problem


@pytest.fixture
def named() -> dict[str, Any]:
    """Use one explicit method for every supplied notification."""
    data = definitions.defaults("America/Chicago")
    data["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:one"]}
    }
    for profile in data["profiles"].values():
        profile["methods"] = ["phone"]
    data["default"] = [{"id": "window", "profile": "urgent"}]
    return data


def test_supplied_profiles_are_unconfigured_and_sending_stays_off() -> None:
    """Fresh defaults select useful timing without inventing a delivery destination."""
    data = initial_settings("America/Chicago")
    settings = Settings.from_data(data)
    assert settings.notifications is False
    assert settings.notification_definitions["methods"] == {}
    assert set(settings.notification_definitions["profiles"]) == {
        "immediate",
        "acknowledge",
        "urgent",
        "morning",
        "evening",
        "weekly",
    }
    assert {
        row["id"]: row["notifications"][0]["profile"]
        for row in data["monitoring_policies"]
    } == {
        "default_integrations": "morning",
        "default_devices": "morning",
        "default_entities": "morning",
        "default_important_equipment": "immediate",
        "default_repairs": "morning",
        "default_broken_automations": "morning",
        "default_batteries": "morning",
        "default_vacuums": "evening",
    }
    assert settings.notification_definitions["profiles"]["weekly"]["timing"] == {
        "mode": "report",
        "at": "08:00",
        "weekdays": [6],
    }


@pytest.mark.parametrize(
    "profile", ["immediate", "acknowledge", "urgent", "morning", "evening", "weekly"]
)
def test_unconfigured_profile_never_sends(profile: str) -> None:
    """A named choice with no methods remains valid and quiet."""
    data = definitions.defaults()
    data["default"] = [{"id": "selected", "profile": profile}]
    policy = Policy(build(data))
    now = datetime(2026, 10, 15, tzinfo=UTC)
    assert policy.handle(problem(now), now, PolicyContext()) == []
    assert policy.advance(now + timedelta(days=14), PolicyContext()) == []


def build(data: dict[str, Any]) -> PolicyConfig:
    """Compile with the installation's ordinary thirty-second batch."""
    return build_policy(definitions.generate(data), timedelta(seconds=30))


@pytest.mark.parametrize(
    ("opened_at", "eligible_at"),
    [
        pytest.param(
            "2026-10-15T02:59:00+00:00", "2026-10-15T02:59:00+00:00", id="inside-window"
        ),
        pytest.param(
            "2026-10-15T02:59:50+00:00",
            "2026-10-15T02:59:50+00:00",
            id="just-before-close",
        ),
        pytest.param(
            "2026-10-15T03:00:00+00:00", "2026-10-15T13:00:00+00:00", id="at-close"
        ),
        pytest.param(
            "2026-10-15T12:59:00+00:00", "2026-10-15T13:00:00+00:00", id="before-open"
        ),
        pytest.param(
            "2026-10-15T13:00:00+00:00", "2026-10-15T13:00:00+00:00", id="at-open"
        ),
        pytest.param(
            "2026-11-01T05:00:00+00:00",
            "2026-11-01T14:00:00+00:00",
            id="autumn-clock-change",
        ),
    ],
)
def test_regular_window_eligibility_has_no_second_batch_and_survives_restart(
    named: dict[str, Any], opened_at: str, eligible_at: str
) -> None:
    """Policy eligibility honors local hours before the separate collection step."""
    now, due = datetime.fromisoformat(opened_at), datetime.fromisoformat(eligible_at)
    policy = Policy(build(named))
    opening = policy.handle(problem(now), now, PolicyContext())
    assert opening == []
    if due == now:
        [notice] = policy.advance(now, PolicyContext())
        restored = Policy(build(named))
        restored.restore(policy.snapshot(), now)
        assert restored.advance(now, PolicyContext()) == []
    else:
        assert policy.advance(due - timedelta(seconds=1), PolicyContext()) == []
        restored = Policy(build(named))
        restored.restore(policy.snapshot(), due - timedelta(seconds=1))
        [notice] = restored.advance(due, PolicyContext())
    assert notice.route == "window"
    assert notice.channels == ("method:phone",)
    assert notice.recipient.startswith("window:")


def test_overnight_recovery_drops_the_unsent_window_request(
    named: dict[str, Any],
) -> None:
    """A problem that clears overnight does not appear as an urgent morning request."""
    now = datetime(2026, 10, 15, 4, tzinfo=UTC)
    event = problem(now)
    policy = Policy(build(named))
    assert policy.handle(event, now, PolicyContext()) == []
    assert (
        policy.handle(
            EpisodeResolved(episode=event.episode, resolution="cleared"),
            now + timedelta(minutes=1),
            PolicyContext(),
        )
        == []
    )
    assert policy.advance(now + timedelta(hours=10), PolicyContext()) == []


def test_shared_method_keeps_immediate_and_different_windows_independent(
    named: dict[str, Any],
) -> None:
    """One method can receive overnight immediate requests and two distinct windows."""
    named["profiles"]["early"] = {
        "name": "Early",
        "timing": {
            "mode": "window",
            "start": "06:00",
            "end": "18:00",
            "collection_delay_seconds": 0,
        },
        "methods": ["phone"],
    }
    named["default"] += [
        {"id": "now", "profile": "immediate"},
        {"id": "early", "profile": "early"},
    ]
    now = datetime(2026, 10, 15, 9, tzinfo=UTC)
    policy = Policy(build(named))
    assert [
        item.route for item in policy.handle(problem(now), now, PolicyContext())
    ] == ["now"]
    assert [
        item.route for item in policy.advance(now + timedelta(hours=2), PolicyContext())
    ] == ["early"]
    assert [
        item.route for item in policy.advance(now + timedelta(hours=4), PolicyContext())
    ] == ["window"]


def test_named_acknowledgment_uses_thirty_minutes_and_stops_when_acknowledged(
    named: dict[str, Any],
) -> None:
    """The supplied acknowledgment choice repeats only until acknowledgment."""
    named["default"] = [{"id": "ack", "profile": "acknowledge"}]
    now = datetime(2026, 10, 15, 4, tzinfo=UTC)
    policy = Policy(build(named))
    assert len(policy.handle(problem(now), now, PolicyContext())) == 1
    assert policy.advance(now + timedelta(minutes=29), PolicyContext()) == []
    assert len(policy.advance(now + timedelta(minutes=30), PolicyContext())) == 1
    policy.acknowledge("issue", now + timedelta(minutes=31), actor_id="owner")
    assert policy.advance(now + timedelta(hours=1), PolicyContext()) == []


def test_named_weekly_report_uses_sunday_eight_in_ha_timezone(
    named: dict[str, Any],
) -> None:
    """The weekly default retains open problems for the specified local Sunday time."""
    named["default"] = [{"id": "weekly", "profile": "weekly"}]
    now = datetime(2026, 10, 16, 15, tzinfo=UTC)
    policy = Policy(build(named))
    assert policy.handle(problem(now), now, PolicyContext()) == []
    assert (
        policy.advance(datetime(2026, 10, 18, 12, 59, tzinfo=UTC), PolicyContext())
        == []
    )
    assert [
        item.route
        for item in policy.advance(
            datetime(2026, 10, 18, 13, tzinfo=UTC), PolicyContext()
        )
    ] == ["weekly"]


@pytest.mark.parametrize(
    "edit",
    [
        pytest.param({"name": ""}, id="empty-name"),
        pytest.param({"methods": ["missing"]}, id="missing-method"),
        pytest.param(
            {
                "timing": {
                    "mode": "window",
                    "start": "08:00",
                    "end": "08:00",
                    "collection_delay_seconds": 0,
                }
            },
            id="empty-window",
        ),
        pytest.param(
            {
                "timing": {
                    "mode": "window",
                    "start": "24:00",
                    "end": "22:00",
                    "collection_delay_seconds": 0,
                }
            },
            id="invalid-window-time",
        ),
    ],
)
def test_invalid_named_notifications_are_rejected(
    named: dict[str, Any], edit: dict[str, Any]
) -> None:
    """Incomplete shared instructions cannot become saved delivery behavior."""
    named["profiles"]["urgent"].update(edit)
    with pytest.raises(ValueError):
        definitions.validate(named)


def test_deleting_a_referenced_profile_is_rejected(named: dict[str, Any]) -> None:
    """A policy reference must be replaced before its shared definition is removed."""
    del named["profiles"]["urgent"]
    with pytest.raises(ValueError, match="missing named notification"):
        definitions.validate(named)


def test_named_reference_preserves_inline_compilation_and_pending_report(
    named: dict[str, Any],
) -> None:
    """Explicit equivalent replacement retains the existing row, recipient and clock."""
    legacy = deepcopy(named)
    legacy.pop("profiles")
    legacy["default"] = [
        {
            "id": "existing",
            "timing": named["profiles"]["morning"]["timing"],
            "methods": ["phone"],
        }
    ]
    named["default"] = [{"id": "existing", "profile": "morning"}]
    assert definitions.validate(legacy)["default"] == legacy["default"]
    assert definitions.validate(legacy)["profiles"] == {}
    assert build(legacy) == build(named)
    now = datetime(2026, 10, 15, 12, tzinfo=UTC)
    policy = Policy(build(legacy))
    policy.handle(problem(now), now, PolicyContext())
    restored = Policy(build(named))
    restored.restore(policy.snapshot(), now)
    [notice] = restored.advance(now + timedelta(hours=1), PolicyContext())
    assert (notice.route, notice.recipient) == ("existing", "method:phone")


def test_named_identity_stays_out_of_legacy_instruction_grouping(
    named: dict[str, Any],
) -> None:
    """Only equivalent inline rows use compatibility grouping; named IDs stay separate."""
    rows = [{"id": "row", "profile": "morning"}]
    policies = [
        monitoring_policy("named", {}, notifications=rows),
        monitoring_policy(
            "inline", {}, notifications=definitions.resolve_rows(named, rows)
        ),
        monitoring_policy(
            "inline_copy", {}, notifications=definitions.resolve_rows(named, rows)
        ),
    ]
    settings = Settings.from_data(
        current_config(policies, notification_definitions=named)
    )
    result = notification_grouping.compatible_intents(settings)
    assert set(result) == {"policy_inline_row", "policy_inline_copy_row"}
    assert result["policy_inline_row"] == result["policy_inline_copy_row"]


async def test_profile_edits_track_effective_window_and_current_phone_permissions(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    named: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Window aliases retain method authorization and only semantic edits rearm routes."""
    named["default"] = []
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "window", "profile": "urgent"}
    ]
    config_data.update(notifications=False, notification_definitions=named)
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    before = runtime._route_signatures()
    renamed = deepcopy(config_data)
    renamed["notification_definitions"]["profiles"]["urgent"]["name"] = "Daytime"
    assert runtime._route_signatures(Settings.from_data(renamed)) == before
    previous_settings = runtime.settings
    previous_policy_settings = runtime._policy_settings()
    runtime.settings = Settings.from_data(renamed)
    assert runtime._policy_settings() == previous_policy_settings
    runtime.settings = previous_settings
    renamed["notification_definitions"]["profiles"]["urgent"]["timing"]["start"] = (
        "09:00"
    )
    assert runtime._route_signatures(Settings.from_data(renamed)) != before
    runtime.settings = replace(runtime.settings, notifications=True)
    [episode] = runtime.episodes
    recipient = next(
        key
        for key in runtime._policy_config(runtime.settings).recipients
        if key.startswith("window:")
    )
    record = {
        "recipient": recipient,
        "channel": "phone:one",
        "episode_id": episode,
        "user_id": "owner",
    }
    monkeypatch.setattr(
        runtime.phone_actions, "authorize", AsyncMock(return_value=record)
    )
    control = AsyncMock()
    monkeypatch.setattr(runtime, "async_control", control)
    await runtime.async_phone_action(Event("mobile_app_notification_action"))
    control.assert_awaited_once()
    runtime.settings.notification_definitions["methods"]["phone"]["destinations"] = [
        "phone:other"
    ]
    await runtime.async_phone_action(Event("mobile_app_notification_action"))
    control.assert_awaited_once()
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_window_recipient_ids_cannot_collide_at_id_separators(
    named: dict[str, Any],
) -> None:
    """Valid punctuation in profile and method IDs cannot redirect another window."""
    named["methods"] = {
        "c": {"name": "First", "mode": "fixed", "destinations": ["phone:first"]},
        "b:method:c": {
            "name": "Second",
            "mode": "fixed",
            "destinations": ["phone:second"],
        },
    }
    named["profiles"] = {
        "a:method:b": {**named["profiles"]["urgent"], "methods": ["c"]},
        "a": {**named["profiles"]["urgent"], "methods": ["b:method:c"]},
    }
    named["default"] = [
        {"id": "first", "profile": "a:method:b"},
        {"id": "second", "profile": "a"},
    ]
    config = build(named)
    recipients = [
        recipient
        for key, recipient in config.recipients.items()
        if key.startswith("window:")
    ]
    assert len(recipients) == 2
    assert {recipient.channels for recipient in recipients} == {
        ("method:c",),
        ("method:b:method:c",),
    }


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [
        pytest.param((Status.UNKNOWN,), [], id="gap-only"),
        pytest.param(
            (Status.UNKNOWN, Status.WARN), ["immediate"], id="mixed-confirmed-warning"
        ),
        pytest.param(
            (Status.UNKNOWN, Status.FAIL), ["immediate"], id="mixed-confirmed-failure"
        ),
    ],
)
def test_passive_availability_gaps_do_not_send_but_confirmed_failure_does(
    named: dict[str, Any], statuses: tuple[Status, ...], expected: list[str]
) -> None:
    """Suppress only missing passive availability evidence without changing the issue."""
    named["default"] = [{"id": "immediate", "profile": "immediate"}]
    now = datetime(2026, 10, 15, 4, tzinfo=UTC)
    event = problem(now)
    event = replace(
        event,
        episode=replace(
            event.episode,
            reasons=tuple(
                replace(
                    event.episode.reasons[0], node_id=f"entity:{index}", status=status
                )
                for index, status in enumerate(statuses)
            ),
        ),
    )
    policy = Policy(build(named))
    assert [
        item.route for item in policy.handle(event, now, PolicyContext())
    ] == expected
    assert tuple(finding.status for finding in event.episode.reasons) == statuses


@pytest.mark.parametrize(
    ("reason", "expected"),
    [
        pytest.param("ups_reserve_low", [], id="mains-summary-later"),
        pytest.param(
            "ups_reserve_critical", ["backup"], id="backup-immediate-acknowledgment"
        ),
    ],
)
def test_named_ups_reserve_choices_keep_their_power_conditions(
    named: dict[str, Any], reason: str, expected: list[str]
) -> None:
    """Referencing shared timing does not broaden mains or backup eligibility."""
    named["default"] = [
        {"id": "mains", "profile": "morning", "when": "mains"},
        {"id": "backup", "profile": "acknowledge", "when": "backup"},
    ]
    now = datetime(2026, 10, 15, 4, tzinfo=UTC)
    event = problem(now, check="ups_reserve")
    event = replace(
        event,
        episode=replace(
            event.episode, reasons=(replace(event.episode.reasons[0], reason=reason),)
        ),
    )
    policy = Policy(build(named))
    assert [
        item.route for item in policy.handle(event, now, PolicyContext())
    ] == expected
    assert [
        row["when"] for row in definitions.resolve_rows(named, named["default"])
    ] == ["mains", "backup"]


def test_named_and_inline_windows_with_the_same_id_keep_distinct_recipients(
    named: dict[str, Any],
) -> None:
    """A legacy row ID cannot replace a named profile's different delivery window."""
    named["default"] = [
        {"id": "selected", "profile": "urgent"},
        {
            "id": "urgent",
            "timing": {"mode": "window", "start": "06:00", "end": "18:00"},
            "methods": ["phone"],
        },
    ]
    config = build(named)
    assert len([key for key in config.recipients if key.startswith("window:")]) == 2
    now = datetime(2026, 10, 15, 9, tzinfo=UTC)
    policy = Policy(config)
    assert policy.handle(problem(now), now, PolicyContext()) == []
    assert [
        item.route for item in policy.advance(now + timedelta(hours=2), PolicyContext())
    ] == ["urgent"]
    assert [
        item.route for item in policy.advance(now + timedelta(hours=4), PolicyContext())
    ] == ["selected"]
