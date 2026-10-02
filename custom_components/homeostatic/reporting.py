"""Compile the owner's fixed reporting choices into generic HealthTree rules."""

import hashlib
import json
from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .attention import policy_data
from .notification_routes import destinations

PROFILES = ("acknowledge", "immediate", "morning", "evening", "weekly", "dashboard")


def defaults(timezone: str = "UTC") -> dict[str, Any]:
    """Return fresh conservative choices without enabling requests."""
    return {
        "timezone": timezone,
        "default": "weekly",
        "repairs": "morning",
        "people": {},
        "profiles": {
            "acknowledge": {"people": []},
            "immediate": {"people": []},
            "morning": {"people": [], "at": "08:00"},
            "evening": {"people": [], "at": "18:00"},
            "weekly": {"people": [], "at": "09:00", "weekday": 6},
        },
        "assignments": {},
    }


def _hash(policy: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def choices(policy: dict[str, Any]) -> dict[str, Any] | None:
    """Read intact generated choices; never reinterpret a custom policy."""
    marker = policy.get("generated", {})
    plain = {key: value for key, value in policy.items() if key != "generated"}
    if (
        marker.get("version") != "reporting-v1"
        or marker.get("hash") != _hash(plain)
        or not isinstance(marker.get("choices"), dict)
    ):
        return None
    return dict(deepcopy(marker["choices"]))


def _recipients(
    hass: HomeAssistant, selected: dict[str, Any], people: list[dict[str, Any]]
) -> dict[str, Any]:
    catalog = {route.channel: route for route in destinations(hass)}
    known = {person["id"]: person for person in people}
    result = {}
    for person_id, channels in selected.items():
        if person_id not in known or not isinstance(channels, list):
            raise ValueError("Choose a currently linked person and their destinations")
        if len(channels) != len(set(channels)):
            raise ValueError("Choose each destination once")
        for channel in channels:
            route = catalog.get(channel)
            if route is None or not route.available:
                raise ValueError("A selected destination is unavailable")
            if (
                channel.startswith("phone:")
                and route.user_id != known[person_id]["user_id"]
            ):
                raise ValueError("This phone belongs to another person")
        if channels:
            result[f"person:{person_id}"] = {"channels": channels}
    return result


def _profile(value: object) -> str:
    if not isinstance(value, str) or value not in PROFILES:
        raise ValueError("Choose one of the six reporting preferences")
    return value


def generate(
    hass: HomeAssistant, value: dict[str, Any], people: list[dict[str, Any]]
) -> dict[str, Any]:
    """Validate destinations and compile an integrity-protected policy."""
    data = deepcopy(value)
    required = {"timezone", "default", "people", "profiles", "assignments"}
    if not required <= set(data) <= required | {"repairs"}:
        raise ValueError("Provide the complete reporting choices")
    if not all(
        isinstance(data[key], dict) for key in ("people", "profiles", "assignments")
    ):
        raise ValueError("Reporting choices must be mappings")
    household = _profile(data["default"])
    # Repairs are routed by label at runtime; the choice only needs to be valid.
    _profile(data.setdefault("repairs", "morning"))
    if set(data["profiles"]) != set(PROFILES[:-1]):
        raise ValueError("Provide all five reporting profiles")
    recipients = _recipients(hass, data["people"], people)
    digests: dict[str, Any] = {}
    targets: dict[str, list[str]] = {}
    for name, profile in data["profiles"].items():
        required = {"people"} | (
            {"at"} if name in {"morning", "evening", "weekly"} else set()
        )
        if name == "weekly":
            required.add("weekday")
        if not isinstance(profile, dict) or set(profile) != required:
            raise ValueError("Provide the supported profile settings")
        ids = profile["people"]
        if (
            not isinstance(ids, list)
            or len(ids) != len(set(ids))
            or any(person not in data["people"] for person in ids)
        ):
            raise ValueError("Select configured people once per profile")
        targets[name] = [
            f"person:{person}" for person in ids if f"person:{person}" in recipients
        ]
        if name == "weekly" and (
            type(profile["weekday"]) is not int or profile["weekday"] not in range(7)
        ):
            raise ValueError("Choose a weekday")
        if "at" in profile:
            from datetime import time

            try:
                clock = time.fromisoformat(profile["at"])
            except (ValueError, TypeError) as err:
                raise ValueError("Choose a report time") from err
            if clock.tzinfo is not None or len(profile["at"]) != 5:
                raise ValueError("Use a local HH:MM report time")
            if targets[name]:
                digests[name] = {
                    "at": profile["at"],
                    "to": targets[name][0],
                    "repeat_open": True,
                    "weekdays": [profile["weekday"]]
                    if name == "weekly"
                    else list(range(7)),
                }

    def rule(profile: str, match: dict[str, Any]) -> dict[str, Any]:
        to = targets.get(profile, [])
        if profile == "dashboard" or not to:
            return {"match": match, "loudness": "record"}
        result: dict[str, Any] = {"match": match, "to": to}
        if profile in {"acknowledge", "immediate"}:
            result["loudness"] = "urgent"
            if profile == "acknowledge":
                result.update(require_acknowledgment=True, remind_every="30m")
        else:
            result.update(loudness="digest", digest=profile)
        return result

    scoped: list[tuple[str, dict[str, Any]]] = []
    for node_id, assignment in data["assignments"].items():
        if (
            not isinstance(node_id, str)
            or not node_id
            or not isinstance(assignment, dict)
        ):
            raise ValueError("Choose a source for each reporting preference")
        if set(assignment) - {"default", "checks"}:
            raise ValueError("Unsupported source reporting preference")
        exceptions = assignment.get("checks", {})
        if not isinstance(exceptions, dict):
            raise ValueError("Condition preferences must be a mapping")
        for check_id, profile in exceptions.items():
            if check_id not in {"availability", "battery", "condition"}:
                raise ValueError("Choose a supported monitored condition")
            scoped.append(
                (_profile(profile), {"nodes": [node_id], "checks": [check_id]})
            )
        selected = assignment.get("default", household)
        scoped.append(
            (
                _profile(selected),
                {
                    "nodes": [node_id],
                    **({"excluded_checks": list(exceptions)} if exceptions else {}),
                },
            )
        )
    scoped.sort(key=lambda item: PROFILES.index(item[0]))
    policy = {
        "timezone": data["timezone"],
        "recipients": recipients,
        "digests": digests,
        "rules": [rule(profile, match) for profile, match in scoped]
        + [rule(household, {})],
    }
    policy_data(policy)
    policy["generated"] = {
        "version": "reporting-v1",
        "choices": data,
        "hash": _hash(policy),
    }
    return policy


def missing_profiles(value: dict[str, Any]) -> list[str]:
    """List used outgoing profiles whose chosen people lack destinations."""
    used = {value["default"]}
    for assignment in value["assignments"].values():
        used.add(assignment.get("default", value["default"]))
        used.update(assignment.get("checks", {}).values())
    return [
        name
        for name in PROFILES[:-1]
        if name in used
        and (
            not value["profiles"][name]["people"]
            or any(
                not value["people"].get(person)
                for person in value["profiles"][name]["people"]
            )
        )
    ]


def unavailable_destinations(hass: HomeAssistant, policy: dict[str, Any]) -> list[str]:
    """Report configured built-in destinations that no longer accept requests."""
    available = {route.channel for route in destinations(hass) if route.available}
    return sorted(
        {
            channel
            for recipient in policy["recipients"].values()
            for channel in recipient["channels"]
            if channel.startswith(("phone:", "notify:")) and channel not in available
        }
    )
