"""Executable reporting scenarios using isolated Home Assistant routes."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from health_tree.policy import Policy
from health_tree.types import (
    Episode,
    EpisodeOpened,
    Finding,
    Importance,
    PolicyContext,
    Status,
)
from homeassistant.core import HomeAssistant

from custom_components.homeostatic import reporting
from custom_components.homeostatic.attention import DEFAULT_POLICY, build_policy
from custom_components.homeostatic.notification_routes import Destination

PEOPLE = [{"id": "owner", "name": "Owner", "user_id": "owner", "administrator": False}]


@pytest.fixture
def configured(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Choose one household person without role-based filtering."""
    monkeypatch.setattr(
        reporting,
        "destinations",
        lambda _: [
            Destination(
                channel="phone:owner", name="Phone", user_id="owner", available=True
            ),
            Destination(
                channel="phone:other", name="Other", user_id="other", available=True
            ),
        ],
    )
    value = reporting.defaults()
    value["people"] = {"owner": ["phone:owner"]}
    for profile in value["profiles"].values():
        profile["people"] = ["owner"]
    return value


@pytest.mark.parametrize(
    ("profile", "loudness", "ack", "digest"),
    [
        pytest.param("immediate", "urgent", False, None, id="immediate-overnight"),
        pytest.param("acknowledge", "urgent", True, None, id="acknowledge-overnight"),
        pytest.param("morning", "digest", False, "morning", id="morning"),
        pytest.param("evening", "digest", False, "evening", id="evening"),
        pytest.param("weekly", "digest", False, "weekly", id="weekly"),
        pytest.param("dashboard", "record", False, None, id="dashboard"),
    ],
)
def test_each_profile(
    hass: HomeAssistant,
    configured: dict[str, Any],
    profile: str,
    loudness: str,
    ack: bool,
    digest: str | None,
) -> None:
    """Each UI choice compiles to an explicit library outcome."""
    configured["default"] = profile
    data = reporting.generate(hass, configured, PEOPLE)
    policy = build_policy(data, timedelta(seconds=30))
    rule = policy.rules[-1]
    assert rule.loudness.value == loudness
    assert rule.require_acknowledgment is ack
    assert rule.digest == digest
    assert reporting.choices(data) == configured
    assert reporting.missing_profiles(configured) == []


def test_preferences_follow_group_root_and_exception(
    hass: HomeAssistant,
    configured: dict[str, Any],
) -> None:
    """A device's immediate setting follows a shared root without extra episodes."""
    configured["assignments"] = {
        "device:leak": {"default": "acknowledge", "checks": {"condition": "dashboard"}},
        "device:lamp": {"default": "weekly"},
    }
    data = reporting.generate(hass, configured, PEOPLE)
    now = datetime(2026, 9, 28, 23, tzinfo=UTC)
    policy = Policy(build_policy(data, timedelta(seconds=30)))
    problem = Episode(
        episode_id="root",
        form="root",
        anchor="entry:hub",
        status=Status.FAIL,
        importance=Importance.NORMAL,
        reasons=(
            Finding(
                node_id="entry:hub",
                check_id="availability",
                status=Status.FAIL,
                reason="unavailable",
                since=now,
            ),
        ),
        recorded=frozenset({"device:leak", "device:lamp"}),
        impact=frozenset({"device:leak", "device:lamp"}),
        opened_at=now,
        updated_at=now,
    )
    deliveries = policy.handle(EpisodeOpened(episode=problem), now, PolicyContext())
    assert len(deliveries) == 1
    assert policy.explain("root")["require_acknowledgment"] is True
    assert len(policy.advance(now + timedelta(minutes=30), PolicyContext())) == 1
    policy.acknowledge("root", now + timedelta(minutes=31), actor_id="owner")
    assert policy.advance(now + timedelta(hours=1), PolicyContext()) == []


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        pytest.param(("default",), "urgent", "six reporting", id="unknown-profile"),
        pytest.param(("people",), [], "mappings", id="invalid-people"),
        pytest.param(("profiles",), {}, "all five", id="missing-profile"),
        pytest.param(("people", "missing"), [], "linked person", id="unknown-person"),
        pytest.param(
            ("people", "owner"), ["phone:missing"], "unavailable", id="missing-route"
        ),
        pytest.param(
            ("people", "owner"), ["phone:other"], "another person", id="other-phone"
        ),
        pytest.param(
            ("people", "owner"),
            ["phone:owner", "phone:owner"],
            "once",
            id="duplicate-route",
        ),
        pytest.param(("profiles", "weekly", "weekday"), 7, "weekday", id="bad-weekday"),
        pytest.param(
            ("profiles", "weekly", "at"), "bad", "report time", id="bad-clock"
        ),
        pytest.param(
            ("profiles", "weekly", "at"), "09:00:00", "HH:MM", id="clock-seconds"
        ),
        pytest.param(
            ("profiles", "weekly", "people"),
            ["missing"],
            "configured people",
            id="missing-recipient",
        ),
        pytest.param(
            ("profiles", "immediate", "at"),
            "08:00",
            "supported profile",
            id="extra-profile-option",
        ),
        pytest.param(
            ("assignments",), {"device:a": "weekly"}, "source", id="bad-assignment"
        ),
        pytest.param(
            ("assignments",),
            {"device:a": {"other": "weekly"}},
            "Unsupported",
            id="extra-assignment",
        ),
        pytest.param(
            ("assignments",), {"device:a": {"checks": []}}, "mapping", id="bad-checks"
        ),
        pytest.param(
            ("assignments",),
            {"device:a": {"checks": {"water": "immediate"}}},
            "supported monitored",
            id="invented-check",
        ),
    ],
)
def test_invalid_choices(
    hass: HomeAssistant,
    configured: dict[str, Any],
    path: tuple[str, ...],
    value: Any,
    message: str,
) -> None:
    """Invalid preferences cannot be silently downgraded or redirected."""
    target = configured
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value
    with pytest.raises(ValueError, match=message):
        reporting.generate(hass, configured, PEOPLE)


def test_missing_recipient_remains_a_draft(hass: HomeAssistant) -> None:
    """Conservative empty defaults can be saved off but are not send-ready."""
    value = reporting.defaults()
    assert reporting.missing_profiles(value) == ["weekly"]
    policy = reporting.generate(hass, value, [])
    assert policy["rules"] == [{"match": {}, "loudness": "record"}]
    assert reporting.choices(DEFAULT_POLICY) is None
    assert reporting.choices({"rules": []}) is None
    broken = deepcopy(policy)
    broken["rules"][0]["match"] = {"reason": ["changed"]}
    assert reporting.choices(broken) is None
    value["extra"] = True
    with pytest.raises(ValueError, match="complete"):
        reporting.generate(hass, value, [])


def test_missing_destination_is_visible(
    hass: HomeAssistant,
    configured: dict[str, Any],
) -> None:
    """A selected person without a destination leaves a profile unready."""
    configured["people"]["owner"] = []
    policy = reporting.generate(hass, configured, PEOPLE)
    assert reporting.missing_profiles(configured) == ["weekly"]
    assert policy["recipients"] == {}


def test_report_replaces_only_current_members() -> None:
    """A shelved prior member cannot reappear when a new digest is assembled."""
    from health_tree.types import JSONValue, Loudness, Notification

    from custom_components.homeostatic.delivery import DeliveryState

    state = DeliveryState("test")
    first = Notification(
        episode_id="first",
        recipient="owner",
        channels=("phone",),
        loudness=Loudness.DIGEST,
        digest="weekly",
        cause="digest",
    )
    content: dict[str, JSONValue] = {
        "schema_version": 1,
        "episode_id": "first",
        "title": "Leak detector",
        "message": "Unavailable",
        "tag": "first",
        "functions": [],
        "age": "48h",
    }
    state.record(first, content)
    state.outbox.clear()
    second = Notification(
        episode_id="second",
        recipient="owner",
        channels=("phone",),
        loudness=Loudness.DIGEST,
        digest="weekly",
        cause="digest",
    )
    state.prepare_reports([second])
    state.record(second, {**content, "episode_id": "second", "title": "Lamp"})
    assert len(state.outbox) == 1
    assert state.outbox[0]["episodes"] == ["second"]
    assert "New: Lamp" in str(state.outbox[0]["message"])
    state.outbox.clear()
    from dataclasses import replace

    repeat = replace(second, previously_reported=True)
    state.prepare_reports([repeat])
    state.record(repeat, {**content, "episode_id": "second", "title": "Lamp"})
    assert len(state.outbox) == 1
    assert state.outbox[0]["action"] == "digest"
    assert "Still outstanding: Lamp" in str(state.outbox[0]["message"])


async def test_reporting_settings_generate_without_enabling(
    hass: HomeAssistant,
    configured: dict[str, Any],
    config_data: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Preview compiles reviewed choices while preserving monitoring and request state."""
    from unittest.mock import AsyncMock

    from custom_components.homeostatic import dashboard
    from custom_components.homeostatic.config import Settings

    config_data.update(notifications=False, consumer=None)
    monkeypatch.setattr(dashboard, "available_people", AsyncMock(return_value=PEOPLE))
    draft = dashboard._editable_settings(Settings.from_data(config_data))
    draft["reporting"] = configured
    draft["simple_notifications"] = None
    candidate = await dashboard._settings_candidate(hass, config_data, draft)
    assert candidate["notifications"] is False
    assert candidate["entities"] == config_data["entities"]
    assert reporting.choices(candidate["policy"]) == configured
    draft["notifications"] = True
    enabled = await dashboard._settings_candidate(hass, config_data, draft)
    assert enabled["notifications"] is True
    draft["reporting"]["profiles"]["weekly"]["people"] = []
    with pytest.raises(ValueError, match="every used reporting"):
        await dashboard._settings_candidate(hass, config_data, draft)


async def test_reporting_migration_preserves_automation_until_cleared(
    hass: HomeAssistant,
    configured: dict[str, Any],
    config_data: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Switching policy cannot silently bypass the owner's legacy consumer."""
    from unittest.mock import AsyncMock

    from custom_components.homeostatic import dashboard
    from custom_components.homeostatic.config import Settings

    monkeypatch.setattr(dashboard, "available_people", AsyncMock(return_value=PEOPLE))
    config_data.update(notifications=False, consumer="automation.old")
    draft = dashboard._editable_settings(Settings.from_data(config_data))
    draft["reporting"] = configured
    draft["simple_notifications"] = None
    with pytest.raises(ValueError, match="Clear the existing"):
        await dashboard._settings_candidate(hass, config_data, draft)


def test_missing_destination_forecast(
    hass: HomeAssistant,
    configured: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Overview detects a lost route before the next attempted delivery."""
    policy = reporting.generate(hass, configured, PEOPLE)
    assert reporting.unavailable_destinations(hass, policy) == []
    monkeypatch.setattr(reporting, "destinations", lambda _: [])
    assert reporting.unavailable_destinations(hass, policy) == ["phone:owner"]
