"""Map saved notification choices to opaque public delivery instructions."""

import json
from copy import deepcopy
from hashlib import sha256
from typing import Any

from .catalog import Source
from .config import Settings
from .notification_definitions import resolve_rows
from .reported_conditions import CONDITIONS


def subject(source: Source) -> str | None:
    """Use device ownership, or the stable entity behind a standalone condition."""
    device = source.attributes.get("device", ())
    if device:
        return f"device:{device[0]}"
    canonical = source.monitoring_source or source.node_id
    if source.kind in {
        "entity",
        "battery",
        "vacuum",
        "lock",
        "thermostat",
        "temperature_limit",
        "left_open",
        *CONDITIONS,
    }:
        references = source.attributes.get("entity", ())
        return f"entity:{references[0]}" if references else canonical
    return canonical if source.kind == "device" else None


def compatible_intents(settings: Settings) -> dict[str, str]:
    """Retain device presentation for supported inline Custom assignments."""
    result = {}
    for policy in settings.monitoring_policies:
        for row in resolve_rows(
            settings.notification_definitions,
            [item for item in policy.notifications if "profile" not in item],
        ):
            instructions = {key: value for key, value in row.items() if key != "id"}
            instructions["methods"] = sorted(row["methods"])
            identity = sha256(
                json.dumps(instructions, sort_keys=True).encode()
            ).hexdigest()
            result[f"policy_{policy.id}_{row['id']}"] = identity
    return result


def collection_settings(settings: Settings) -> dict[str, dict[str, Any]]:
    """Keep saved identity and accepted instructions independent of issue subjects."""
    definitions = settings.notification_definitions
    rows = [
        {**row, "id": f"policy_{policy.id}_{row['id']}"}
        for policy in settings.monitoring_policies
        if policy.enabled
        for row in policy.notifications
    ]
    rows.extend(definitions["default"])
    rows.extend(definitions["repairs"])
    rows.extend(definitions["broken_automations"])
    for items in definitions["automation_profiles"].values():
        rows.extend(items)
    for assignment in definitions["assignments"].values():
        rows.extend(assignment.get("default", []))
        for items in assignment.get("checks", {}).values():
            rows.extend(items)
    result = {}
    for row in rows:
        if "profile" not in row:
            continue
        identity = row["profile"]
        profile = definitions["profiles"][identity]
        if profile["timing"]["mode"] == "report":
            continue
        instructions = {
            "notification_id": identity,
            "timing": deepcopy(profile["timing"]),
            "methods": {
                key: {
                    field: deepcopy(value)
                    for field, value in definitions["methods"][key].items()
                    if field != "name"
                }
                for key in sorted(profile["methods"])
            },
            "timezone": definitions["timezone"],
        }
        compatibility = sha256(
            json.dumps(instructions, sort_keys=True).encode()
        ).hexdigest()
        result[row["id"]] = {
            "group_id": f"{identity}:{compatibility}",
            "instructions": instructions,
        }
    return result
