"""Policy-owned notification timing, reusable methods, and attention routes."""

import hashlib
import json
import re
from copy import deepcopy
from datetime import time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.core import HomeAssistant
from voluptuous import Invalid

from .attention import duration, policy_data

_ID = re.compile(r"^[a-z][a-z0-9_:-]*$")
_CHANNEL = re.compile(
    r"^(?:phone|notify|satellite):[^:]+$|^tts:[^:]+:[^:]+$|^sms:[a-z0-9_]+:[^:]+$|^service:[a-z0-9_]+$"
)


def defaults(timezone: str = "UTC") -> dict[str, Any]:
    """Provide empty notification choices without adding destinations or sends."""
    return {
        "timezone": timezone,
        "methods": {},
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


def _timing(value: object) -> None:
    """Validate the timing owned by one notification entry."""
    if not isinstance(value, dict):
        raise ValueError("Provide timing settings on each notification entry")
    mode = value.get("mode")
    fields = {"mode"}
    if mode == "acknowledge":
        fields.add("remind_every")
    elif mode == "report":
        fields.update(("at", "weekdays"))
    elif mode != "immediate":
        raise ValueError("Choose immediate, acknowledgment, or scheduled reporting")
    if set(value) != fields:
        raise ValueError("Provide the settings for the selected timing")
    if mode == "acknowledge":
        try:
            interval = duration(value["remind_every"])
        except Invalid as err:
            raise ValueError("Use a positive reminder interval") from err
        if interval.total_seconds() <= 0:
            raise ValueError("Reminders must have a positive interval")
    if mode == "report":
        if not isinstance(value["at"], str) or not re.fullmatch(
            r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value["at"]
        ):
            raise ValueError("Use a local HH:MM report time")
        time.fromisoformat(value["at"])
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
    if not isinstance(value, dict) or set(value) - {"automation_profiles"} != {
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
    try:
        ZoneInfo(data["timezone"])
    except (ZoneInfoNotFoundError, TypeError, ValueError) as err:
        raise ValueError("Choose an IANA timezone") from err
    if any(not isinstance(data[key], dict) for key in ("methods", "assignments")):
        raise ValueError("Definitions and source assignments must be mappings")
    for key, value in data["methods"].items():
        _method(key, value)
    identities: dict[str, dict[str, Any]] = {}

    def rows(items: object) -> None:
        if not isinstance(items, list):
            raise ValueError("Notification rows must be a list")
        seen: set[str] = set()
        for row in items:
            if (
                not isinstance(row, dict)
                or set(row) - {"id", "timing", "methods", "when"}
                or not {"id", "timing", "methods"} <= set(row)
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
    for node, assignment in data["assignments"].items():
        checks = assignment.get("checks", {})
        for check, rows in checks.items():
            scopes.append(({"nodes": [node], "checks": [check]}, rows))
        scopes.append(
            (
                {
                    "nodes": [node],
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
    if "immediate" in data["automation_profiles"]:
        scopes.append(
            ({"checks": ["vacuum"]}, data["automation_profiles"]["immediate"])
        )
    scopes.append(({}, data["default"]))
    identities = {row["id"]: row for _, rows in scopes for row in rows}
    recipients = {
        f"method:{key}": {"channels": [f"method:{key}"]} for key in data["methods"]
    }
    digests: dict[str, Any] = {}
    rules: list[dict[str, Any]] = []
    for identity, row in identities.items():
        rules.append(
            {
                "route": identity,
                "match": {"category": ["temperature"], "status": ["unknown"]},
                "loudness": "record",
            }
        )
        schedule = row["timing"]
        targets = [f"method:{method}" for method in row["methods"]]
        digest_id = f"entry:{identity}"
        if schedule["mode"] == "report":
            digests[digest_id] = {
                "at": schedule["at"],
                "weekdays": schedule["weekdays"],
                "to": targets[0],
                "repeat_open": True,
            }
        for match, rows in scopes:
            rule: dict[str, Any] = {
                "route": identity,
                "match": match,
                "loudness": "record",
            }
            selected_row = next((item for item in rows if item["id"] == identity), None)
            if selected_row is not None:
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
                            "loudness": "urgent"
                            if schedule["mode"] != "report"
                            else "digest",
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
                rule.update(to=targets, loudness="urgent")
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


def convert_legacy(value: dict[str, Any]) -> dict[str, Any]:
    """Convert intact legacy choices without changing destinations or enabling sends."""
    result = defaults(value["timezone"])
    for person, channels in value["people"].items():
        if channels:
            result["methods"][f"person:{person}"] = {
                "name": person,
                "mode": "fixed",
                "destinations": list(channels),
            }

    def timing(profile: str) -> dict[str, Any]:
        settings = value["profiles"][profile]
        if profile == "immediate":
            return {"mode": "immediate"}
        if profile == "acknowledge":
            return {"mode": "acknowledge", "remind_every": "30m"}
        return {
            "mode": "report",
            "at": settings["at"],
            "weekdays": [settings["weekday"]]
            if "weekday" in settings
            else list(range(7)),
        }

    def rows(profile: str) -> list[dict[str, Any]]:
        if profile == "dashboard":
            return []
        methods = [
            f"person:{person}"
            for person in value["profiles"][profile]["people"]
            if f"person:{person}" in result["methods"]
        ]
        return (
            [{"id": f"legacy:{profile}", "timing": timing(profile), "methods": methods}]
            if methods
            else []
        )

    for key in ("default", "repairs", "broken_automations"):
        result[key] = rows(value.get(key, "morning"))
    result["automation_profiles"] = {
        profile: rows(profile) for profile in (*value["profiles"], "dashboard")
    }
    result["assignments"] = {
        node: {
            "default": rows(assignment.get("default", value["default"])),
            "checks": {
                check: rows(profile)
                for check, profile in assignment.get("checks", {}).items()
            },
        }
        for node, assignment in value["assignments"].items()
    }
    return validate(result)


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


def remove_definition(
    value: dict[str, Any],
    kind: str,
    identity: str,
    *,
    replacement: str | None = None,
    remove_rows: bool = False,
) -> dict[str, Any]:
    """Delete a shared definition only with explicit treatment of every reference."""
    data = validate(value)
    if kind != "methods" or identity not in data[kind]:
        raise ValueError("Choose an existing delivery method")
    if replacement is not None and (
        replacement == identity or replacement not in data[kind]
    ):
        raise ValueError("Choose a different existing replacement")
    collections = [data[key] for key in ("default", "repairs", "broken_automations")]
    collections.extend(data["automation_profiles"].values())
    for assignment in data["assignments"].values():
        collections.extend(assignment.get("checks", {}).values())
        if "default" in assignment:
            collections.append(assignment["default"])
    for rows in collections:
        for row in list(rows):
            used = identity in row["methods"]
            if not used:
                continue
            if replacement is None:
                if not remove_rows:
                    raise ValueError(
                        "Replace the definition or explicitly remove affected notification rows"
                    )
                rows.remove(row)
            else:
                row["methods"] = list(
                    dict.fromkeys(
                        replacement if item == identity else item
                        for item in row["methods"]
                    )
                )
    del data[kind][identity]
    return validate(data)
