"""Assign device subjects and compatible intents to authorized notifications."""

import json
from hashlib import sha256

from .catalog import Source
from .config import Settings
from .notification_definitions import resolve_rows


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
        "thermostat",
        "temperature_limit",
    }:
        references = source.attributes.get("entity", ())
        return f"entity:{references[0]}" if references else canonical
    return canonical if source.kind == "device" else None


def compatible_intents(settings: Settings) -> dict[str, str]:
    """Compare full delivery instructions while preserving independent routes."""
    result = {}
    for policy in settings.monitoring_policies:
        for row in resolve_rows(
            settings.notification_definitions, policy.notifications
        ):
            instructions = {key: value for key, value in row.items() if key != "id"}
            instructions["methods"] = sorted(row["methods"])
            identity = sha256(
                json.dumps(instructions, sort_keys=True).encode()
            ).hexdigest()
            result[f"policy_{policy.id}_{row['id']}"] = identity
    return result
