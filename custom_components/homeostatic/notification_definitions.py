"""Reusable named notifications, delivery methods, and attention routes."""

import hashlib
import json
import re
from copy import deepcopy
from datetime import time
from itertools import groupby
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.core import HomeAssistant
from voluptuous import Invalid

from .attention import duration, policy_data

_ID = re.compile(r"^[a-z][a-z0-9_:-]*$")
_CHANNEL = re.compile(
    r"^(?:phone|notify|satellite):[^:]+$|^tts:[^:]+:[^:]+$|^sms:[a-z0-9_]+:[^:]+$|^service:[a-z0-9_]+$"
)


def default_profiles() -> dict[str, dict[str, Any]]:
    """Provide editable notification choices without selecting destinations."""
    return {
        "immediate": {
            "name": "Immediate",
            "timing": {"mode": "immediate", "collection_delay_seconds": 60},
            "methods": [],
        },
        "acknowledge": {
            "name": "Immediate with acknowledgment",
            "timing": {
                "mode": "acknowledge",
                "remind_every": 1800,
                "collection_delay_seconds": 5,
            },
            "methods": [],
        },
        "urgent": {
            "name": "Urgent",
            "timing": {
                "mode": "window",
                "start": "08:00",
                "end": "22:00",
                "collection_delay_seconds": 60,
            },
            "methods": [],
        },
        **{
            identity: {
                "name": name,
                "timing": {"mode": "report", "at": at, "weekdays": weekdays},
                "methods": [],
            }
            for identity, name, at, weekdays in (
                ("morning", "Morning summary", "08:00", list(range(7))),
                ("evening", "Evening summary", "18:00", list(range(7))),
                ("weekly", "Weekly summary", "08:00", [6]),
            )
        },
    }


def defaults(timezone: str = "UTC") -> dict[str, Any]:
    """Provide named choices without adding destinations or enabling sends."""
    return {
        "timezone": timezone,
        "methods": {},
        "profiles": default_profiles(),
        "default": [],
        "repairs": [],
        "broken_automations": [],
        "assignments": {},
        "automation_profiles": {},
    }


def _strings(value: object, *, empty: bool = True) -> list[str]:
    if (
        not isinstance(value, list)
        or (not value and not empty)
        or any(not isinstance(item, str) or not item for item in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError("Choose each item once in a list")
    return value


def _channels(value: object, *, empty: bool = True) -> list[str]:
    result = _strings(value, empty=empty)
    if any(_CHANNEL.fullmatch(channel) is None for channel in result):
        raise ValueError("Choose a supported notification destination")
    return result


def _named(key: object, value: object) -> dict[str, Any]:
    if not isinstance(key, str) or _ID.fullmatch(key) is None:
        raise ValueError("Use a stable definition id beginning with a letter")
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("name"), str)
        or not value["name"].strip()
    ):
        raise ValueError("Give each definition a name")
    return value


def _method(key: str, value: object) -> None:
    item = _named(key, value)
    mode = item.get("mode")
    if mode == "fixed":
        if set(item) != {"name", "mode", "destinations"}:
            raise ValueError("Provide fixed destinations")
        _channels(item["destinations"], empty=False)
        return
    required = {"name", "mode", "people", "fallback", "skip"}
    required |= {"home", "away"} if mode == "home_away" else {"person_destinations"}
    if (
        not isinstance(mode, str)
        or mode not in {"home_away", "home_people"}
        or set(item) != required
    ):
        raise ValueError("Choose fixed, home/away, or people currently home")
    people = _strings(item["people"], empty=False)
    if any(not re.fullmatch(r"person\.[a-z0-9_]+", person) for person in people):
        raise ValueError("Choose Home Assistant person entities")
    fallback = _channels(item["fallback"])
    if type(item["skip"]) is not bool or bool(fallback) == item["skip"]:
        raise ValueError("Choose fallback destinations or explicitly skip")
    if mode == "home_away":
        _channels(item["home"], empty=False)
        _channels(item["away"], empty=False)
    else:
        mapping = item["person_destinations"]
        if not isinstance(mapping, dict) or set(mapping) != set(people):
            raise ValueError("Configure destinations for every selected person")
        for channels in mapping.values():
            _channels(channels, empty=False)


def _timing(value: object, *, named: bool = False) -> None:
    """Validate timing for a named notification or a saved inline entry."""
    if not isinstance(value, dict):
        raise ValueError("Provide timing settings on each notification entry")
    mode = value.get("mode")
    fields = {"mode"}
    if mode == "acknowledge":
        fields.add("remind_every")
    elif mode == "report":
        fields.update(("at", "weekdays"))
    elif mode == "window":
        fields.update(("start", "end"))
    elif mode != "immediate":
        raise ValueError(
            "Choose immediate, acknowledgment, window, or scheduled reporting"
        )
    if named and mode != "report":
        fields.add("collection_delay_seconds")
        delay = value.get("collection_delay_seconds")
        if type(delay) is not int or delay < 0:
            raise ValueError("Collection delay must be whole seconds, 0 or greater")
    if set(value) != fields:
        raise ValueError("Provide the settings for the selected timing")
    if mode == "acknowledge":
        try:
            interval = duration(value["remind_every"])
        except Invalid as err:
            raise ValueError("Use a positive reminder interval") from err
        if interval.total_seconds() <= 0:
            raise ValueError("Reminders must have a positive interval")
    for field in (
        ("at",) if mode == "report" else ("start", "end") if mode == "window" else ()
    ):
        if not isinstance(value[field], str) or not re.fullmatch(
            r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value[field]
        ):
            raise ValueError("Use a local HH:MM notification time")
        time.fromisoformat(value[field])
    if mode == "window" and value["start"] == value["end"]:
        raise ValueError("Choose different start and end times for the delivery window")
    if mode == "report":
        days = value["weekdays"]
        if (
            not isinstance(days, list)
            or not days
            or any(type(day) is not int or day not in range(7) for day in days)
            or len(set(days)) != len(days)
        ):
            raise ValueError("Choose weekdays once, from Monday through Sunday")


def validate(value: object) -> dict[str, Any]:
    """Copy a complete definition set and reject dangling or ambiguous references."""
    if not isinstance(value, dict) or set(value) - {
        "automation_profiles",
        "profiles",
    } != {
        "timezone",
        "methods",
        "default",
        "repairs",
        "broken_automations",
        "assignments",
    }:
        raise ValueError("Provide the complete notification definitions")
    data = deepcopy(value)
    data.setdefault("automation_profiles", {})
    data.setdefault("profiles", {})
    try:
        ZoneInfo(data["timezone"])
    except (ZoneInfoNotFoundError, TypeError, ValueError) as err:
        raise ValueError("Choose an IANA timezone") from err
    if any(
        not isinstance(data[key], dict)
        for key in ("methods", "profiles", "assignments")
    ):
        raise ValueError("Definitions and source assignments must be mappings")
    for key, value in data["methods"].items():
        _method(key, value)
    for key, value in data["profiles"].items():
        profile = _named(key, value)
        if set(profile) != {"name", "timing", "methods"}:
            raise ValueError(
                "Provide a name, timing, and delivery methods for each notification"
            )
        _timing(profile["timing"], named=True)
        if any(
            method not in data["methods"] for method in _strings(profile["methods"])
        ):
            raise ValueError("A notification references a missing delivery method")
    identities: dict[str, dict[str, Any]] = {}

    def rows(items: object) -> None:
        if not isinstance(items, list):
            raise ValueError("Notification rows must be a list")
        seen: set[str] = set()
        for row in items:
            if not isinstance(row, dict) or set(row) - {"when"} not in (
                {"id", "profile"},
                {"id", "timing", "methods"},
            ):
                raise ValueError(
                    "Pair timing with delivery methods on each notification entry"
                )
            identity = row["id"]
            if (
                not isinstance(identity, str)
                or _ID.fullmatch(identity) is None
                or identity in seen
            ):
                raise ValueError("Give notification rows distinct stable ids")
            seen.add(identity)
            if "profile" in row:
                if (
                    not isinstance(row["profile"], str)
                    or row["profile"] not in data["profiles"]
                ):
                    raise ValueError(
                        "A notification row references a missing named notification"
                    )
                methods = data["profiles"][row["profile"]]["methods"]
            else:
                _timing(row["timing"])
                methods = _strings(row["methods"], empty=False)
            if "when" in row and (
                not isinstance(row["when"], str)
                or row["when"] not in {"mains", "backup"}
            ):
                raise ValueError(
                    "Choose confirmed mains or backup power for reserve reporting"
                )
            if any(method not in data["methods"] for method in methods):
                raise ValueError(
                    "A notification row references a missing delivery method"
                )
            if identity in identities and identities[identity] != row:
                raise ValueError(
                    "A shared notification row must retain the same pairing"
                )
            identities[identity] = row

    for key in ("default", "repairs", "broken_automations"):
        rows(data[key])
    if not isinstance(data["automation_profiles"], dict):
        raise ValueError("Automation reporting choices must be a mapping")
    for profile, items in data["automation_profiles"].items():
        if profile not in {
            "immediate",
            "acknowledge",
            "morning",
            "evening",
            "weekly",
            "dashboard",
        }:
            raise ValueError("Choose a supported automation reporting preference")
        rows(items)
    for node, assignment in data["assignments"].items():
        if (
            not isinstance(node, str)
            or not node
            or not isinstance(assignment, dict)
            or set(assignment) - {"default", "checks"}
        ):
            raise ValueError("Choose source defaults and condition exceptions")
        if "default" in assignment:
            rows(assignment["default"])
        checks = assignment.get("checks", {})
        if not isinstance(checks, dict):
            raise ValueError("Condition exceptions must be a mapping")
        for check, items in checks.items():
            if not isinstance(check, str) or not check:
                raise ValueError("Choose a condition for each exception")
            rows(items)
    return data


def resolve_rows(
    definitions: dict[str, Any], rows: list[dict[str, Any]] | tuple[dict[str, Any], ...]
) -> list[dict[str, Any]]:
    """Resolve validated references without changing saved row identities or conditions."""
    return [
        {
            **{key: value for key, value in row.items() if key != "profile"},
            **{
                key: deepcopy(definitions["profiles"][row["profile"]][key])
                for key in ("timing", "methods")
            },
        }
        if "profile" in row
        else deepcopy(row)
        for row in rows
    ]


def _hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def choices(policy: dict[str, Any]) -> dict[str, Any] | None:
    """Read intact generated definitions without reinterpreting custom rules."""
    marker = policy.get("generated", {})
    plain = {key: value for key, value in policy.items() if key != "generated"}
    if (
        not isinstance(marker, dict)
        or marker.get("version") != "notifications-v3"
        or marker.get("hash") != _hash(plain)
    ):
        return None
    value = marker.get("choices")
    return deepcopy(value) if isinstance(value, dict) else None


def generate(value: dict[str, Any]) -> dict[str, Any]:
    """Compile explicit pairings into independently evaluated generic routes."""
    data = validate(value)
    scopes: list[tuple[dict[str, Any], list[dict[str, Any]]]] = [
        (
            {
                "labels": {
                    "homeostatic_alert_profile": profile,
                    "homeostatic_source": "situation",
                }
            },
            rows,
        )
        for profile, rows in data["automation_profiles"].items()
    ]
    # Only adjacent assignments can combine without changing first-match precedence.
    for assignment, members in groupby(
        data["assignments"].items(), key=lambda item: item[1]
    ):
        nodes = [node for node, _ in members]
        checks = assignment.get("checks", {})
        for check, rows in checks.items():
            scopes.append(({"nodes": nodes, "checks": [check]}, rows))
        scopes.append(
            (
                {
                    "nodes": nodes,
                    **({"excluded_checks": list(checks)} if checks else {}),
                },
                assignment.get("default", data["default"]),
            )
        )
    scopes.extend(
        [
            ({"labels": {"homeostatic_source": "repair"}}, data["repairs"]),
            (
                {"labels": {"homeostatic_source": "broken_automation"}},
                data["broken_automations"],
            ),
        ]
    )
    scopes.append(({}, data["default"]))
    identities = {row["id"]: row for _, rows in scopes for row in rows}
    assignment_routes = {
        row["id"]
        for assignment in data["assignments"].values()
        for rows in (
            assignment.get("default", []),
            *assignment.get("checks", {}).values(),
        )
        for row in rows
    }
    recipients: dict[str, Any] = {
        f"method:{key}": {"channels": [f"method:{key}"]} for key in data["methods"]
    }
    digests: dict[str, Any] = {}
    rules: list[dict[str, Any]] = []
    for identity, row in identities.items():
        rules.append(
            {
                "route": identity,
                "match": {
                    "checks": ["availability", "entity_not_provided"],
                    "status": ["unknown"],
                },
                "loudness": "record",
            }
        )
        rules.append(
            {
                "route": identity,
                "match": {"category": ["temperature"], "status": ["unknown"]},
                "loudness": "record",
            }
        )
        effective = resolve_rows(data, [row])[0]
        schedule = effective["timing"]
        targets = [f"method:{method}" for method in effective["methods"]]
        if schedule["mode"] == "window":
            targets = []
            owner = (
                ["profile", row["profile"]]
                if "profile" in row
                else ["inline", identity]
            )
            for method in effective["methods"]:
                recipient = f"window:{_hash([*owner, method])}"
                recipients[recipient] = {
                    "channels": [f"method:{method}"],
                    "quiet_hours": {"start": schedule["end"], "end": schedule["start"]},
                }
                targets.append(recipient)
        loudness = {"report": "digest", "window": "notify"}.get(
            schedule["mode"], "urgent"
        )
        digest_id = f"entry:{identity}"
        if targets and schedule["mode"] == "report":
            digests[digest_id] = {
                "at": schedule["at"],
                "weekdays": schedule["weekdays"],
                "to": targets[0],
                "repeat_open": True,
            }
        route_scopes = (
            sorted(
                scopes,
                key=lambda scope: (
                    not any(item["id"] == identity for item in scope[1])
                    if scope[0]
                    else True
                ),
            )
            if identity in assignment_routes
            else scopes
        )
        for match, rows in route_scopes:
            selected_row = next((item for item in rows if item["id"] == identity), None)
            # Granting scopes come first for independent source routes. A matching
            # integration with another assignment cannot mask affected equipment.
            rule: dict[str, Any] = {
                "route": identity,
                "match": match,
                "loudness": "record",
                **(
                    {"batch": 0}
                    if "profile" in row and schedule["mode"] != "report"
                    else {}
                ),
            }
            if selected_row is not None and targets:
                when = selected_row.get("when")
                if when is not None:
                    rules.append(
                        {
                            **rule,
                            "match": {
                                **match,
                                "checks": ["ups_reserve"],
                                "reason": [
                                    "ups_reserve_low"
                                    if when == "mains"
                                    else "ups_reserve_critical"
                                ],
                            },
                            "to": targets,
                            "loudness": loudness,
                            **(
                                {
                                    "require_acknowledgment": True,
                                    "remind_every": schedule["remind_every"],
                                }
                                if schedule["mode"] == "acknowledge"
                                else {}
                            ),
                            **(
                                {"digest": digest_id}
                                if schedule["mode"] == "report"
                                else {}
                            ),
                        }
                    )
                    rules.append(rule)
                    continue
                rule.update(to=targets, loudness=loudness)
                if schedule["mode"] == "acknowledge":
                    rule.update(
                        require_acknowledgment=True,
                        remind_every=schedule["remind_every"],
                    )
                elif schedule["mode"] == "report":
                    rule.update(loudness="digest", digest=digest_id)
            rules.append(rule)
    policy = {
        "timezone": data["timezone"],
        "recipients": recipients,
        "digests": digests,
        "rules": rules or [{"match": {}, "loudness": "record"}],
    }
    policy_data(policy)
    policy["generated"] = {
        "version": "notifications-v3",
        "choices": data,
        "hash": _hash(policy),
    }
    return policy


def method_channels(method: dict[str, Any]) -> list[str]:
    """List all explicitly authorized destinations, independent of current presence."""
    channels = [
        channel
        for key in ("destinations", "home", "away", "fallback")
        for channel in method.get(key, [])
    ]
    channels.extend(
        channel
        for values in method.get("person_destinations", {}).values()
        for channel in values
    )
    return list(dict.fromkeys(channels))


def resolve_channels(
    hass: HomeAssistant, value: dict[str, Any], method_id: str
) -> list[str]:
    """Select targets from current person evidence for one new request only."""
    method = value["methods"][method_id]
    if method["mode"] == "fixed":
        return list(method["destinations"])
    states = {person: hass.states.get(person) for person in method["people"]}
    home = [
        person
        for person, state in states.items()
        if state is not None
        and state.state == "home"
        and not state.attributes.get("restored", False)
    ]
    unknown = any(
        state is None
        or state.state in {"unknown", "unavailable", ""}
        or state.attributes.get("restored", False)
        for state in states.values()
    )
    if method["mode"] == "home_away":
        if home:
            return list(method["home"])
        if not unknown:
            return list(method["away"])
    elif home:
        return list(
            dict.fromkeys(
                channel
                for person in home
                for channel in method["person_destinations"][person]
            )
        )
    return list(method["fallback"])
