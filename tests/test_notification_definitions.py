"""Executable scenarios for policy-owned timing and presence-aware delivery."""

import json
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from health_tree.policy import Policy
from health_tree.types import (
    Episode,
    EpisodeOpened,
    Finding,
    Importance,
    Loudness,
    Notification,
    PolicyContext,
    ResolutionNotice,
    Status,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from custom_components.homeostatic import notification_definitions as definitions
from custom_components.homeostatic import notification_routes, reporting
from custom_components.homeostatic.attention import build_policy
from custom_components.homeostatic.delivery import DeliveryState


@pytest.fixture
def configured() -> dict[str, Any]:
    """Reuse a phone method for immediate and morning notifications."""
    data = definitions.defaults()
    data["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:one"]},
        "email": {"name": "Email", "mode": "fixed", "destinations": ["notify:mail"]},
    }
    data["default"] = [
        {
            "id": "urgent",
            "timing": {"mode": "acknowledge", "remind_every": "30m"},
            "methods": ["phone", "email"],
        },
        {
            "id": "morning_row",
            "timing": {"mode": "report", "at": "08:00", "weekdays": list(range(7))},
            "methods": ["phone"],
        },
    ]
    return data


def problem(
    now: datetime,
    *,
    node: str = "device:one",
    check: str = "availability",
    labels: dict[str, str] | None = None,
) -> EpisodeOpened:
    """Open a concrete failure in the public library API."""
    return EpisodeOpened(
        episode=Episode(
            episode_id="issue",
            form="root",
            anchor=node,
            status=Status.FAIL,
            importance=Importance.NORMAL,
            reasons=(
                Finding(
                    node_id=node,
                    check_id=check,
                    status=Status.FAIL,
                    reason="unavailable",
                    since=now,
                    labels=labels or {},
                ),
            ),
            recorded=frozenset({node}),
            impact=frozenset({node}),
            opened_at=now,
            updated_at=now,
        )
    )


def test_immediate_and_report_are_independent(configured: dict[str, Any]) -> None:
    """Two methods receive an immediate request and one receives the later report."""
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    opened = policy.handle(problem(now), now, PolicyContext())
    assert {(item.route, item.recipient) for item in opened} == {
        ("urgent", "method:phone"),
        ("urgent", "method:email"),
    }
    policy.acknowledge("issue", now + timedelta(minutes=1), actor_id="owner")
    assert policy.advance(now + timedelta(minutes=30), PolicyContext()) == []
    reports = policy.advance(now + timedelta(hours=1), PolicyContext())
    assert [(item.route, item.recipient) for item in reports] == [
        ("morning_row", "method:phone")
    ]


@pytest.mark.parametrize(
    "check,expected",
    [
        pytest.param("availability", [], id="source-dashboard-only"),
        pytest.param("battery", ["morning_row"], id="condition-report-only"),
    ],
)
def test_source_override_suppresses_global_routes(
    configured: dict[str, Any], check: str, expected: list[str]
) -> None:
    """An explicit source override cannot leak an inherited independent route."""
    configured["assignments"] = {
        "device:one": {"default": [], "checks": {"battery": [configured["default"][1]]}}
    }
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    assert policy.handle(problem(now, check=check), now, PolicyContext()) == []
    assert [
        item.route for item in policy.advance(now + timedelta(hours=1), PolicyContext())
    ] == expected


def test_legacy_conversion_preserves_automation_choices() -> None:
    """Conversion keeps recipient sets, clocks, and automation-owned selections."""
    legacy = reporting.defaults("America/Chicago")
    legacy["people"] = {"owner": ["phone:one"]}
    legacy["profiles"]["morning"]["people"] = ["owner"]
    legacy["profiles"]["morning"]["at"] = "07:15"
    converted = definitions.convert_legacy(legacy)
    assert converted["default"] == []
    assert converted["repairs"][0]["timing"]["at"] == "07:15"
    assert converted["automation_profiles"]["morning"] == converted["repairs"]
    assert converted["methods"]["person:owner"]["destinations"] == ["phone:one"]
    assert definitions.choices(definitions.generate(converted)) == converted


@pytest.mark.parametrize(
    "node,check,labels,expected",
    [
        pytest.param(
            "device:vacuum",
            "vacuum",
            {},
            ["legacy:immediate"],
            id="legacy-vacuum-immediate",
        ),
        pytest.param(
            "device:one", "availability", {}, [], id="legacy-household-weekly"
        ),
        pytest.param(
            "situation:water",
            "condition",
            {
                "homeostatic_alert_profile": "immediate",
                "homeostatic_source": "situation",
            },
            ["legacy:immediate"],
            id="automation-profile-preserved",
        ),
        pytest.param(
            "repair:test",
            "repair",
            {"homeostatic_alert_profile": "immediate", "homeostatic_source": "repair"},
            [],
            id="repair-independent-of-automation-profile",
        ),
    ],
)
def test_conversion_source_defaults(
    node: str, check: str, labels: dict[str, str], expected: list[str]
) -> None:
    """Migration preserves vacuum defaults without leaking automation-owned choices."""
    legacy = reporting.defaults()
    legacy["people"] = {"owner": ["phone:one"]}
    legacy["profiles"]["immediate"]["people"] = ["owner"]
    policy = Policy(
        build_policy(
            definitions.generate(definitions.convert_legacy(legacy)), timedelta(0)
        )
    )
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    assert [
        item.route
        for item in policy.handle(
            problem(now, node=node, check=check, labels=labels), now, PolicyContext()
        )
    ] == expected


def test_rename_preserves_effective_policy(configured: dict[str, Any]) -> None:
    """Names can change without restarting reporting or changing identities."""
    before = definitions.generate(configured)
    configured["methods"]["phone"]["name"] = "Renamed phone"
    after = definitions.generate(configured)
    assert {key: value for key, value in before.items() if key != "generated"} == {
        key: value for key, value in after.items() if key != "generated"
    }
    assert definitions.choices(after) == configured
    after["timezone"] = "America/Chicago"
    assert definitions.choices(after) is None


@pytest.mark.parametrize(
    "kind,identity,replacement",
    [
        pytest.param("methods", "phone", "email", id="shared-method"),
    ],
)
def test_delete_requires_reference_treatment(
    configured: dict[str, Any], kind: str, identity: str, replacement: str
) -> None:
    """Deleting a shared definition requires replacement or removal of whole rows."""
    with pytest.raises(ValueError, match="explicitly remove"):
        definitions.remove_definition(configured, kind, identity)
    changed = definitions.remove_definition(
        configured, kind, identity, replacement=replacement
    )
    assert identity not in changed[kind]
    assert len(changed["default"]) == 2
    removed = definitions.remove_definition(
        configured, kind, identity, remove_rows=True
    )
    assert len(removed["default"]) < 2
    assert identity in configured[kind]


@pytest.mark.parametrize(
    "path,value",
    [
        pytest.param(("timezone",), "not/a/zone", id="timezone"),
        pytest.param(("methods",), [], id="definition-collection"),
        pytest.param(
            ("methods", "BAD"),
            {"name": "Bad", "mode": "fixed", "destinations": ["phone:one"]},
            id="unstable-id",
        ),
        pytest.param(("methods", "phone", "name"), " ", id="blank-name"),
        pytest.param(
            ("default", 0, "timing", "mode"), "other", id="unsupported-timing"
        ),
        pytest.param(("default", 0, "timing", "at"), "07:00", id="unexpected-setting"),
        pytest.param(("default", 0, "timing"), [], id="timing-object"),
        pytest.param(("default", 0, "timing"), {}, id="timing-mode-required"),
        pytest.param(("default", 0, "timing", "name"), "Urgent", id="no-named-timing"),
        pytest.param(("schedules",), {}, id="no-schedule-library"),
        pytest.param(
            ("methods", "phone", "skip"), True, id="fixed-fallback-not-allowed"
        ),
        pytest.param(("methods", "phone", "mode"), [], id="malformed-presence-mode"),
        pytest.param(("default",), {}, id="row-collection"),
        pytest.param(("default",), [{}], id="incomplete-row"),
        pytest.param(
            ("default",),
            [
                {
                    "id": "123",
                    "timing": {
                        "mode": "report",
                        "at": "08:00",
                        "weekdays": list(range(7)),
                    },
                    "methods": ["phone"],
                }
            ],
            id="unstable-row-id",
        ),
        pytest.param(
            ("repairs",),
            [
                {
                    "id": "urgent",
                    "timing": {
                        "mode": "report",
                        "at": "08:00",
                        "weekdays": list(range(7)),
                    },
                    "methods": ["phone"],
                }
            ],
            id="conflicting-shared-row",
        ),
        pytest.param(("automation_profiles",), [], id="automation-collection"),
        pytest.param(
            ("automation_profiles",), {"other": []}, id="unsupported-automation-profile"
        ),
        pytest.param(
            ("assignments",),
            {"source": {"unsupported": []}},
            id="unsupported-assignment-field",
        ),
        pytest.param(
            ("assignments",), {"source": {"checks": []}}, id="condition-collection"
        ),
        pytest.param(
            ("assignments",), {"source": {"checks": {"": []}}}, id="blank-check"
        ),
        pytest.param(("default", 1, "timing", "weekdays"), [], id="empty-days"),
        pytest.param(("default", 1, "timing", "weekdays"), [True], id="boolean-day"),
        pytest.param(("default", 1, "timing", "at"), "25:00", id="invalid-time"),
        pytest.param(("default", 0, "timing", "remind_every"), 0, id="zero-reminder"),
        pytest.param(("methods", "phone", "destinations"), [], id="empty-destinations"),
        pytest.param(
            ("methods", "phone", "destinations"),
            ["shell:execute"],
            id="arbitrary-action",
        ),
        pytest.param(
            ("default",),
            [{"id": "missing", "schedule": "gone", "methods": ["phone"]}],
            id="schedule-reference-rejected",
        ),
        pytest.param(
            ("default",),
            [
                {
                    "id": "missing",
                    "timing": {
                        "mode": "report",
                        "at": "08:00",
                        "weekdays": list(range(7)),
                    },
                    "methods": ["gone"],
                }
            ],
            id="dangling-method",
        ),
    ],
)
def test_invalid_definition_rejected(
    configured: dict[str, Any], path: tuple[str | int, ...], value: Any
) -> None:
    """Malformed editor drafts fail before they alter any reporting configuration."""
    target: Any = configured
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValueError):
        definitions.validate(configured)


@pytest.mark.parametrize(
    "state,expected",
    [
        pytest.param("home", ["satellite:kitchen"], id="home"),
        pytest.param("not_home", ["phone:away"], id="away"),
        pytest.param("Work", ["phone:away"], id="named-zone"),
        pytest.param("unknown", ["phone:fallback"], id="unknown"),
        pytest.param("unavailable", ["phone:fallback"], id="unavailable"),
    ],
)
def test_presence_mapping(hass: HomeAssistant, state: str, expected: list[str]) -> None:
    """Named zones count as away; absent evidence uses the explicit fallback."""
    data = definitions.defaults()
    data["methods"]["presence"] = {
        "name": "Home or away",
        "mode": "home_away",
        "people": ["person.owner"],
        "home": ["satellite:kitchen"],
        "away": ["phone:away"],
        "fallback": ["phone:fallback"],
        "skip": False,
    }
    definitions.validate(data)
    hass.states.async_set("person.owner", state)
    assert definitions.resolve_channels(hass, data, "presence") == expected


def test_people_home_skip_is_explicit(hass: HomeAssistant) -> None:
    """Known home people qualify while missing evidence never selects away people."""
    data = definitions.defaults()
    data["methods"]["presence"] = {
        "name": "Home people",
        "mode": "home_people",
        "people": ["person.owner", "person.other"],
        "person_destinations": {
            "person.owner": ["phone:owner"],
            "person.other": ["phone:other"],
        },
        "fallback": [],
        "skip": True,
    }
    definitions.validate(data)
    assert definitions.method_channels(data["methods"]["presence"]) == [
        "phone:owner",
        "phone:other",
    ]
    assert definitions.resolve_channels(hass, data, "presence") == []
    hass.states.async_set("person.owner", "home")
    assert definitions.resolve_channels(hass, data, "presence") == ["phone:owner"]
    hass.states.async_set("person.owner", "home", {"restored": True})
    assert definitions.resolve_channels(hass, data, "presence") == []
    data["methods"]["presence"]["skip"] = False
    with pytest.raises(ValueError, match="explicitly skip"):
        definitions.validate(data)


@pytest.mark.parametrize(
    "people,mapping",
    [
        pytest.param(
            ["sensor.owner"],
            {"sensor.owner": ["phone:owner"]},
            id="wrong-person-domain",
        ),
        pytest.param(["person.owner"], {}, id="missing-person-destinations"),
    ],
)
def test_presence_requires_person_destinations(
    people: list[str], mapping: dict[str, list[str]]
) -> None:
    """Presence routing cannot infer missing people or their destinations."""
    data = definitions.defaults()
    data["methods"]["presence"] = {
        "name": "Home people",
        "mode": "home_people",
        "people": people,
        "person_destinations": mapping,
        "fallback": [],
        "skip": True,
    }
    with pytest.raises(ValueError):
        definitions.validate(data)


def test_deletion_traverses_condition_assignments(
    configured: dict[str, Any], hass: HomeAssistant
) -> None:
    """Deleting a shared method updates source and condition assignments together."""
    configured["assignments"] = {
        "source": {
            "default": deepcopy(configured["default"]),
            "checks": {"battery": deepcopy(configured["default"])},
        }
    }
    replaced = definitions.remove_definition(
        configured, "methods", "phone", replacement="email"
    )
    assert replaced["assignments"]["source"]["default"][0]["methods"] == ["email"]
    assert replaced["assignments"]["source"]["checks"]["battery"][1]["methods"] == [
        "email"
    ]
    assert definitions.resolve_channels(hass, configured, "phone") == ["phone:one"]
    with pytest.raises(ValueError, match="existing delivery method"):
        definitions.remove_definition(configured, "methods", "missing")
    with pytest.raises(ValueError, match="different existing"):
        definitions.remove_definition(
            configured, "methods", "phone", replacement="phone"
        )
    with pytest.raises(ValueError, match="complete notification"):
        definitions.validate({})


def content() -> dict[str, Any]:
    """Supply the adapter's durable issue content."""
    return {
        "schema_version": 1,
        "episode_id": "issue",
        "title": "Unavailable",
        "message": "Device unavailable",
        "tag": "homeostatic_issue",
        "functions": [],
    }


def test_pending_targets_survive_restart_and_presence_change() -> None:
    """Replays retain targets and cleanup reaches all previous destinations."""
    state = DeliveryState("entry")
    event = Notification(
        episode_id="issue",
        recipient="method:presence",
        channels=("method:presence",),
        loudness=Loudness.URGENT,
        route="row",
    )
    state.record(event, content(), resolve_channels=lambda _: ("phone:home",))
    pending = deepcopy(state.outbox)
    restored = DeliveryState("entry")
    restored.restore(state.snapshot())
    assert restored.outbox == pending
    restored.record(
        replace(event, cause="remind"),
        content(),
        resolve_channels=lambda _: ("phone:away",),
    )
    assert restored.outbox[-1]["channels"] == ["phone:away"]
    restored.record(
        ResolutionNotice(
            episode_id="issue",
            recipient="method:presence",
            channels=("method:presence",),
            resolution="resolved",
            route="row",
        ),
        content(),
    )
    assert restored.outbox[-1]["channels"] == ["phone:home", "phone:away"]


def test_route_identity_and_silent_history() -> None:
    """Independent rows retain independent tags and silent updates keep prior targets."""
    state = DeliveryState("entry")
    event = Notification(
        episode_id="issue",
        recipient="method:presence",
        channels=("method:presence",),
        loudness=Loudness.URGENT,
        route="one",
    )
    state.record(event, content(), resolve_channels=lambda _: ("phone:one",))
    state.record(
        replace(event, route="two"),
        content(),
        resolve_channels=lambda _: ("phone:two",),
    )
    assert len(state.messages) == 2
    assert len({item["tag"] for item in state.messages.values()}) == 2
    state.record(
        replace(event, silent=True),
        content(),
        resolve_channels=lambda _: ("phone:changed",),
    )
    assert state.outbox[-1]["channels"] == ["phone:one"]
    state.deactivate()
    assert {tuple(item["channels"]) for item in state.outbox} == {
        ("phone:one",),
        ("phone:two",),
    }


def test_only_changed_routes_are_withdrawn() -> None:
    """Editing one shared definition leaves unrelated pending requests intact."""
    state = DeliveryState("entry")
    event = Notification(
        episode_id="issue",
        recipient="method:phone",
        channels=("phone:owner",),
        loudness=Loudness.URGENT,
        route="edited",
    )
    state.record(event, content())
    state.record(replace(event, route="untouched"), content())
    unchanged = deepcopy(state.outbox[-1])
    state.summarized.update(state.messages)
    state.deactivate(routes={"edited"})
    assert state.outbox[0] == unchanged
    assert state.outbox[1]["action"] == "resolve"
    assert state.outbox[1]["route"] == "edited"
    assert {item["route"] for item in state.messages.values()} == {"untouched"}
    assert state.summarized == set(state.messages)
    snapshot = deepcopy(state.snapshot())
    state.deactivate(routes=set())
    assert state.snapshot() == snapshot


@pytest.mark.parametrize(
    "kind,domain,action",
    [
        pytest.param("satellite", "assist_satellite", "announce", id="satellite"),
        pytest.param("tts", "tts", "speak", id="tts"),
        pytest.param("sms", "notify", "twilio", id="sms"),
        pytest.param("notify", "notify", "send_message", id="email"),
    ],
)
async def test_supported_transport_requests(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    domain: str,
    action: str,
) -> None:
    """Supported transports request HA actions and omit silent/clear operations."""
    registry = er.async_get(hass)
    voice = registry.async_get_or_create(
        "assist_satellite", "test", "voice", supported_features=1
    )
    tts = registry.async_get_or_create("tts", "test", "tts")
    player = registry.async_get_or_create(
        "media_player", "test", "speaker", supported_features=512
    )
    notify = registry.async_get_or_create("notify", "test", "email")
    for entity in (voice, tts, player, notify):
        hass.states.async_set(entity.entity_id, "idle")
    channels = {
        "satellite": f"satellite:{voice.id}",
        "tts": f"tts:{tts.id}:{player.id}",
        "sms": "sms:twilio:%2B15551234567",
        "notify": f"notify:{notify.id}",
    }
    call = AsyncMock()
    monkeypatch.setattr(type(hass.services), "async_call", call)
    await notification_routes.async_send(
        hass, channels[kind], title="Issue", message="A problem", tag="tag"
    )
    assert call.await_args.args[:2] == (domain, action)
    assert call.await_args.args[2]["message"] == "A problem"
    call.reset_mock()
    await notification_routes.async_send(
        hass, channels[kind], title="Issue", message="Changed", tag="tag", silent=True
    )
    await notification_routes.async_send(
        hass, channels[kind], title="Issue", message="Gone", tag="tag", clear=True
    )
    call.assert_not_awaited()


async def test_missing_voice_target_fails_separately(hass: HomeAssistant) -> None:
    """Missing destination setup is a delivery failure, not a presence fallback."""
    with pytest.raises(HomeAssistantError, match="unavailable"):
        await notification_routes.async_send(
            hass, "satellite:missing", title="Issue", message="A problem", tag="tag"
        )


def test_discovery_reports_capabilities_without_calls(hass: HomeAssistant) -> None:
    """Discovery keeps unavailable targets visible without guessing SMS capability."""
    registry = er.async_get(hass)
    voice = registry.async_get_or_create(
        "assist_satellite", "test", "voice", supported_features=1
    )
    provider = registry.async_get_or_create("tts", "test", "tts")
    player = registry.async_get_or_create(
        "media_player", "test", "player", supported_features=512
    )
    email = registry.async_get_or_create("notify", "smtp", "mail")
    for entity in (voice, provider, player, email):
        hass.states.async_set(entity.entity_id, "idle")
    announce = AsyncMock()
    speak = AsyncMock()
    sms = AsyncMock()
    hass.services.async_register("assist_satellite", "announce", announce)
    hass.services.async_register("tts", "speak", speak)
    hass.services.async_register("notify", "twilio", sms)
    known = {
        item["channel"]: item for item in notification_routes.delivery_targets(hass)
    }
    assert known[f"satellite:{voice.id}"]["available"] is True
    assert known[f"tts:{provider.id}:{player.id}"]["replace"] is False
    assert known[f"notify:{email.id}"]["acknowledgment"] is False
    assert known["service:twilio"]["requires_target"] is False
    assert known["service:twilio"]["type"] == "notification"
    hass.states.async_set(voice.entity_id, "unavailable")
    unavailable = {
        item["channel"]: item for item in notification_routes.delivery_targets(hass)
    }
    assert unavailable[f"satellite:{voice.id}"]["available"] is False
    announce.assert_not_called()
    speak.assert_not_called()
    sms.assert_not_called()


def test_summary_cleanup_retains_past_targets_after_member_removal() -> None:
    """A report's oldest phone remains a cleanup target after membership changes."""
    state = DeliveryState("entry")
    event = Notification(
        episode_id="issue",
        recipient="method:presence",
        channels=("method:presence",),
        loudness=Loudness.DIGEST,
        route="report",
        digest="morning",
        cause="digest",
    )
    state.record(event, content(), resolve_channels=lambda _: ("phone:old",))
    state.outbox.clear()
    other = replace(event, episode_id="other")
    state.record(
        other,
        {**content(), "episode_id": "other"},
        resolve_channels=lambda _: ("phone:new",),
    )
    state.outbox.clear()
    state.record(
        ResolutionNotice(
            episode_id="issue",
            recipient="method:presence",
            channels=("method:presence",),
            resolution="resolved",
            route="report",
        ),
        content(),
    )
    state.outbox.clear()
    state.record(
        ResolutionNotice(
            episode_id="other",
            recipient="method:presence",
            channels=("method:presence",),
            resolution="resolved",
            route="report",
        ),
        {**content(), "episode_id": "other"},
    )
    assert set(state.outbox[-1]["channels"]) == {"phone:old", "phone:new"}


def test_inline_timing_is_owned_and_round_trips(configured: dict[str, Any]) -> None:
    """Editing one timing preserves the other entry and the saved JSON shape."""
    configured["default"].append(
        {
            "id": "evening",
            "timing": {"mode": "report", "at": "18:00", "weekdays": [0, 2, 4]},
            "methods": ["email"],
        }
    )
    before = definitions.generate(configured)
    configured["default"][1]["timing"]["at"] = "07:30"
    after = definitions.generate(configured)
    assert before["digests"]["entry:morning_row"]["at"] == "08:00"
    assert after["digests"]["entry:morning_row"]["at"] == "07:30"
    assert before["digests"]["entry:evening"] == after["digests"]["entry:evening"]
    saved = definitions.choices(json.loads(json.dumps(after)))
    assert saved == configured
    assert "schedules" not in saved
    assert before["generated"]["version"] == "notifications-v3"


def test_empty_entries_remain_dashboard_only() -> None:
    """Fresh definitions contain no schedule library, routes or destinations."""
    now = datetime(2026, 10, 13, 7, tzinfo=UTC)
    data = definitions.defaults()
    assert "schedules" not in data
    policy = Policy(build_policy(definitions.generate(data), timedelta(0)))
    assert policy.handle(problem(now), now, PolicyContext()) == []
    assert policy.advance(now + timedelta(days=7), PolicyContext()) == []


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(-1, id="negative"),
        pytest.param(True, id="boolean"),
        pytest.param("never", id="malformed"),
        pytest.param(None, id="missing"),
    ],
)
def test_invalid_reminder_interval(configured: dict[str, Any], bad: object) -> None:
    """Reject unusable reminder settings before generating a route."""
    configured["default"][0]["timing"]["remind_every"] = bad
    with pytest.raises(ValueError, match="reminder"):
        definitions.validate(configured)


def test_report_reaches_multiple_methods(configured: dict[str, Any]) -> None:
    """One scheduled entry sends to every explicitly selected method."""
    now = datetime(2026, 10, 13, 7, tzinfo=UTC)
    row = configured["default"][1]
    row["methods"] = ["phone", "email"]
    configured["default"] = [row]
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    assert policy.handle(problem(now), now, PolicyContext()) == []
    assert {
        (item.route, item.recipient)
        for item in policy.advance(now + timedelta(hours=1), PolicyContext())
    } == {("morning_row", "method:phone"), ("morning_row", "method:email")}


@pytest.mark.parametrize(
    "owner",
    [
        pytest.param("default", id="general"),
        pytest.param("repairs", id="repairs"),
        pytest.param("broken_automations", id="automations"),
        pytest.param("assignments", id="source"),
        pytest.param("automation_profiles", id="alert-profile"),
    ],
)
def test_all_owners_validate_inline_timing(
    configured: dict[str, Any], owner: str
) -> None:
    """Every supported scope rejects malformed entry timing before save."""
    row = {
        "id": "invalid",
        "timing": {"mode": "report", "at": "08:00", "weekdays": []},
        "methods": ["phone"],
    }
    owners: dict[str, Any] = {
        "default": [row],
        "repairs": [row],
        "broken_automations": [row],
        "assignments": {"source": {"checks": {"battery": [row]}}},
        "automation_profiles": {"morning": [row]},
    }
    configured[owner] = owners[owner]
    with pytest.raises(ValueError, match="weekdays"):
        definitions.validate(configured)


def test_reordered_inline_entries_retain_route_identity(
    configured: dict[str, Any],
) -> None:
    """A report restored from a snapshot retains its route when entries reorder."""
    now = datetime(2026, 10, 13, 7, tzinfo=UTC)
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    policy.handle(problem(now), now, PolicyContext())
    policy.acknowledge("issue", now, actor_id="owner")
    snapshot = policy.snapshot()
    configured["default"].reverse()
    restored = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    restored.restore(snapshot, now)
    assert [
        (item.route, item.recipient)
        for item in restored.advance(now + timedelta(hours=1), PolicyContext())
    ] == [("morning_row", "method:phone")]


@pytest.mark.parametrize(
    "check,expected",
    [
        pytest.param("availability", [], id="shared-dashboard-only"),
        pytest.param("battery", ["morning_row"], id="shared-condition-exception"),
    ],
)
def test_grouped_source_condition_exceptions(
    configured: dict[str, Any], check: str, expected: list[str]
) -> None:
    """Grouping retains dashboard-only defaults and inherited condition exceptions."""
    configured["assignments"] = {
        node: {"default": [], "checks": {"battery": [configured["default"][1]]}}
        for node in ("device:one", "device:two")
    }
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    assert (
        policy.handle(
            problem(now, node="device:two", check=check), now, PolicyContext()
        )
        == []
    )
    assert [
        item.route for item in policy.advance(now + timedelta(hours=1), PolicyContext())
    ] == expected


def test_nonadjacent_source_choices_retain_precedence(
    configured: dict[str, Any],
) -> None:
    """A group issue retains the first matching explicit source override."""
    immediate = [configured["default"][0]]
    configured["assignments"] = {
        "device:one": {"default": immediate},
        "device:two": {"default": []},
        "device:three": {"default": immediate},
        "device:four": {"default": immediate},
    }
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    opened = problem(now, node="device:two")
    opened = replace(
        opened,
        episode=replace(
            opened.episode, recorded=frozenset({"device:two", "device:three"})
        ),
    )
    policy = Policy(build_policy(definitions.generate(configured), timedelta(0)))
    assert policy.handle(opened, now, PolicyContext()) == []
    assert policy.advance(now + timedelta(hours=1), PolicyContext()) == []


def test_expanded_rule_snapshot_restores_into_grouped_policy(
    configured: dict[str, Any],
) -> None:
    """Grouping keeps delivered reminders, acknowledgment and report clocks on restore."""
    now = datetime(2026, 10, 12, 7, tzinfo=UTC)
    rows = configured["default"]
    configured["default"] = []
    configured["assignments"] = {
        node: {"default": rows, "checks": {}} for node in ("device:one", "device:two")
    }
    grouped = definitions.generate(configured)
    expanded = {
        **grouped,
        "rules": [
            {
                "route": "urgent",
                "match": {"nodes": [node]},
                "loudness": "urgent",
                "to": ["method:phone", "method:email"],
                "require_acknowledgment": True,
                "remind_every": "30m",
            }
            for node in ("device:one", "device:two")
        ]
        + [
            {
                "route": "morning_row",
                "match": {"nodes": [node]},
                "loudness": "digest",
                "to": ["method:phone"],
                "digest": "entry:morning_row",
            }
            for node in ("device:one", "device:two")
        ],
    }
    prior = Policy(build_policy(expanded, timedelta(0)))
    assert len(prior.handle(problem(now), now, PolicyContext())) == 2
    prior.acknowledge("issue", now + timedelta(minutes=1), actor_id="owner")
    restored = Policy(build_policy(grouped, timedelta(0)))
    restored.restore(prior.snapshot(), now + timedelta(minutes=1))
    assert restored.advance(now + timedelta(minutes=30), PolicyContext()) == []
    assert [
        (item.route, item.recipient)
        for item in restored.advance(now + timedelta(hours=1), PolicyContext())
    ] == [("morning_row", "method:phone")]
