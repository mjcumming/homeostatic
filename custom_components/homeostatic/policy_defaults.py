"""Initial policies and restorable templates owned by the installation."""

from typing import Any

from .const import DEFAULTS
from .notification_definitions import defaults

# Retired identities stay reserved so deletion and skipped releases stay final.
LEGACY_POLICY_INTRODUCTIONS = (
    "default_integrations",
    "default_devices",
    "default_entities",
    "default_important_equipment",
    "default_repairs",
    "default_broken_automations",
    "default_batteries",
    "default_vacuums",
    "default_entities_not_provided",
)
CATEGORY_POLICY_INTRODUCTIONS = (
    "default_cameras",
    "default_locks",
    "default_alarm_panels",
    "default_safety_sensors",
)
SUPPLIED_POLICY_INTRODUCTIONS = (
    *LEGACY_POLICY_INTRODUCTIONS,
    *CATEGORY_POLICY_INTRODUCTIONS,
)


def policy_templates() -> list[dict[str, Any]]:
    """Return fresh editable records for the supplied monitoring policies."""
    policies: list[dict[str, Any]] = [
        {
            "id": identity,
            "name": name,
            "check": check,
            "match": {"kind": [kind]} if kind else {},
            "parameters": {"threshold": 20}
            if check == "battery"
            else {"duration_seconds": 86400}
            if check == "entity_not_provided"
            else {},
            "enabled": enabled,
            "notifications": [
                {
                    "id": "default",
                    "profile": "evening" if check == "vacuum" else "morning",
                }
            ],
        }
        for identity, name, check, kind, enabled in (
            (
                "default_integrations",
                "Integrations",
                "availability",
                "integration",
                True,
            ),
            (
                "default_entities",
                "General entity availability",
                "availability",
                "entity",
                True,
            ),
            (
                "default_cameras",
                "Cameras",
                "availability",
                "entity",
                True,
            ),
            (
                "default_locks",
                "Locks",
                "availability",
                "entity",
                True,
            ),
            (
                "default_alarm_panels",
                "Alarm panels",
                "availability",
                "entity",
                True,
            ),
            (
                "default_safety_sensors",
                "Safety sensors",
                "availability",
                "entity",
                True,
            ),
            ("default_repairs", "Repairs", "repair", None, True),
            (
                "default_broken_automations",
                "Broken automations",
                "broken_automation",
                None,
                True,
            ),
            ("default_batteries", "Batteries", "battery", None, True),
            ("default_vacuums", "Vacuums", "vacuum", None, True),
            (
                "default_entities_not_provided",
                "Missing entities",
                "entity_not_provided",
                "entity",
                True,
            ),
        )
    ]
    category_scopes = {
        "default_cameras": {"domain": ["camera"]},
        "default_locks": {"domain": ["lock"]},
        "default_alarm_panels": {"domain": ["alarm_control_panel"]},
        "default_safety_sensors": {
            "domain": ["binary_sensor"],
            "device_class": ["smoke", "carbon_monoxide", "gas", "moisture"],
        },
    }
    for policy in policies:
        if policy["id"] == "default_entities":
            policy["parameters"] = {"duration_seconds": 0}
            policy["match_none"] = [
                {"domain": ["camera", "lock", "alarm_control_panel"]},
                {
                    "domain": ["binary_sensor"],
                    "device_class": ["smoke", "carbon_monoxide", "gas", "moisture"],
                },
            ]
        elif policy["id"] in category_scopes:
            policy["match_any"] = [category_scopes[policy["id"]]]
            policy["parameters"] = {
                "duration_seconds": 300 if policy["id"] == "default_cameras" else 0
            }
            policy["notifications"][0]["profile"] = "immediate"
    return policies


def initial_settings(timezone: str) -> dict[str, Any]:
    """Start with basic monitoring and no notification destinations or sends."""
    return {
        "monitoring_policy_version": 1,
        "supplied_policy_introductions": list(SUPPLIED_POLICY_INTRODUCTIONS),
        "monitoring_policies": policy_templates(),
        "notification_definitions": defaults(timezone),
        "functions": [],
        "situations": [],
        "external_capabilities": [],
        "notifications": False,
        "consumer": None,
        "timings": dict(DEFAULTS),
    }
