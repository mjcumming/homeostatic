"""Convert published device policies to entity coverage at the setup boundary."""

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .config import Settings
from .enrollment import inventory
from .policy_defaults import (
    LEGACY_POLICY_INTRODUCTIONS,
    SUPPLIED_POLICY_INTRODUCTIONS,
    policy_templates,
)
from .rules import CatalogRule, attributes


def introduce_supplied_policies(data: dict[str, Any]) -> dict[str, Any]:
    """Add newly offered policies disabled without restoring past deletions."""
    settings = Settings.from_data(data, functions_enabled=False)
    offered = list(settings.supplied_policy_introductions)
    for identity in LEGACY_POLICY_INTRODUCTIONS:
        if identity not in offered:
            offered.append(identity)
    templates = {row["id"]: row for row in policy_templates()}
    existing = {row.id for row in settings.monitoring_policies}
    profiles = settings.notification_definitions["profiles"]
    additions = []
    for identity in SUPPLIED_POLICY_INTRODUCTIONS:
        if identity in offered:
            continue
        offered.append(identity)
        if identity in existing or identity not in templates:
            continue
        policy = templates[identity]
        policy["enabled"] = False
        policy["notifications"] = [
            row for row in policy["notifications"] if row["profile"] in profiles
        ]
        additions.append(policy)
    if data.get("supplied_policy_introductions") == offered and not additions:
        return data
    candidate = deepcopy(data)
    candidate["monitoring_policies"] = [
        *candidate.get("monitoring_policies", []),
        *additions,
    ]
    candidate["supplied_policy_introductions"] = offered
    Settings.from_data(candidate, functions_enabled=False)
    return candidate


def migrate_device_policies(
    hass: HomeAssistant, data: dict[str, Any]
) -> dict[str, Any]:
    """Preserve saved choices and validate before writing converted settings."""
    candidate = deepcopy(data)
    retired = [
        row
        for row in candidate.get("monitoring_policies", [])
        if isinstance(row, dict)
        and row.get("check") == "availability"
        and row.get("match", {}).get("kind") in (["device"], "device")
    ]
    if not retired:
        return data
    scopes = {row["id"]: deepcopy(row["match"]) for row in retired}
    for row in retired:
        row["match"]["kind"] = ["entity"]
    settings = Settings.from_data(candidate, functions_enabled=False)
    devices = [
        source
        for source in inventory(hass, settings, {}).values()
        if source.kind == "device"
    ]
    for row in retired:
        scope = scopes[row["id"]]
        if "device" not in scope or scope.keys() - {"kind", "device"}:
            selector = CatalogRule(id=row["id"], match=attributes(scope))
            row["match"] = {
                "kind": ["entity"],
                "device": sorted(
                    {
                        device
                        for source in devices
                        if selector.matches(source.attributes)
                        for device in source.attributes.get("device", ())
                    }
                ),
            }
    Settings.from_data(candidate, functions_enabled=False)
    return candidate
