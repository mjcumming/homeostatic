"""Generate a bounded person-based policy from owner notification choices."""

import hashlib
import json
from typing import Any

from homeassistant.core import HomeAssistant

from .attention import DEFAULT_POLICY, policy_data
from .notification_routes import Destination, destinations


async def available_people(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return linked Home Assistant people and their current roles."""
    result = []
    for state in hass.states.async_all("person"):
        person_id = state.attributes.get("id")
        user_id = state.attributes.get("user_id")
        if not isinstance(person_id, str) or not isinstance(user_id, str):
            continue
        user = await hass.auth.async_get_user(user_id)
        if user is None:
            continue
        result.append(
            {
                "id": person_id,
                "name": state.name,
                "user_id": user_id,
                "administrator": user.is_admin,
            }
        )
    return sorted(result, key=lambda item: item["name"].casefold())


def _hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def simple_choices(policy: dict[str, Any]) -> dict[str, Any] | None:
    """Return the editable choices only when the generated policy is intact."""
    generated = policy.get("generated")
    if policy == DEFAULT_POLICY:
        return {"people": {}, "timezone": "UTC"}
    if not isinstance(generated, dict) or generated.get("version") != "simple-v1":
        return None
    choices = generated.get("choices")
    plain = {key: value for key, value in policy.items() if key != "generated"}
    if (
        not isinstance(choices, dict)
        or not isinstance(choices.get("people"), dict)
        or not isinstance(choices.get("timezone"), str)
        or generated.get("hash") != _hash(plain)
    ):
        return None
    return choices


def generate_policy(
    hass: HomeAssistant, choices: dict[str, Any], people: list[dict[str, Any]]
) -> dict[str, Any]:
    """Validate routes against current HA ownership and build ordered rules."""
    if set(choices) != {"people", "timezone"} or not isinstance(
        choices["people"], dict
    ):
        raise ValueError("Provide people and a time zone")
    catalog: dict[str, Destination] = {
        item.channel: item for item in destinations(hass)
    }
    known = {person["id"]: person for person in people}
    recipients: dict[str, dict[str, Any]] = {}
    admins: dict[str, str] = {}
    household: dict[str, str] = {}
    for person_id, choice in choices["people"].items():
        if person_id not in known or not isinstance(choice, dict):
            raise ValueError("Selected person is no longer available")
        level = choice.get("level")
        allowed = (
            {"Everything", "Important", "Urgent only", "Off"}
            if known[person_id]["administrator"]
            else {"All", "Urgent only", "Off"}
        )
        if level not in allowed:
            raise ValueError("Choose a valid notification level")
        channels = choice.get("channels")
        if (
            not isinstance(channels, list)
            or not all(isinstance(channel, str) for channel in channels)
            or len(channels) != len(set(channels))
        ):
            raise ValueError("Choose distinct notification destinations")
        for channel in channels:
            route = catalog.get(channel)
            if (
                route is None
                or not route.available
                or (
                    route.user_id is not None
                    and route.user_id != known[person_id]["user_id"]
                )
            ):
                raise ValueError(
                    "A selected destination is unavailable or belongs to another person"
                )
        if level == "Off":
            continue
        if not channels:
            raise ValueError("Choose a destination for each enabled person")
        recipient_id = f"person:{person_id}"
        recipient: dict[str, Any] = {"channels": channels}
        quiet = choice.get("quiet_hours")
        if quiet is not None:
            recipient["quiet_hours"] = quiet
        recipients[recipient_id] = recipient
        (admins if known[person_id]["administrator"] else household)[recipient_id] = (
            level
        )

    def rule(
        match: dict[str, Any], loudness: str, to: list[str], **extra: Any
    ) -> dict[str, Any]:
        return (
            {"match": match, "loudness": loudness, "to": to, **extra}
            if to
            else {"match": match, "loudness": "record"}
        )

    admin_on = list(admins)
    all_on = [*admins, *household]
    important_admins = [
        key for key, level in admins.items() if level in {"Everything", "Important"}
    ]
    all_household = [key for key, level in household.items() if level == "All"]
    everything_admins = [key for key, level in admins.items() if level == "Everything"]
    rules = [
        rule({"status": ["unknown"], "importance": ["critical"]}, "notify", admin_on),
        {"match": {"status": ["unknown"]}, "loudness": "record"},
        rule(
            {"importance": ["critical"], "category": ["situation"]},
            "urgent",
            all_on,
            remind_every="30m",
            require_acknowledgment=True,
        ),
        rule(
            {"importance": ["critical"]},
            "urgent",
            admin_on,
            remind_every="30m",
            require_acknowledgment=True,
        ),
        rule(
            {"importance": ["high"], "category": ["situation"]},
            "notify",
            [*important_admins, *all_household],
        ),
        rule({"importance": ["high"]}, "notify", important_admins),
        rule(
            {"category": ["situation"]}, "notify", [*everything_admins, *all_household]
        ),
        rule({}, "notify", everything_admins),
    ]
    plain = {
        "timezone": choices["timezone"],
        "recipients": recipients,
        "digests": {},
        "rules": rules,
    }
    result = {
        **plain,
        "generated": {"version": "simple-v1", "choices": choices, "hash": _hash(plain)},
    }
    return policy_data(result)
