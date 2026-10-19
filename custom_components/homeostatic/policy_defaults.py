"""Initial policies and restorable templates owned by the installation."""

from typing import Any

from .const import DEFAULTS
from .notification_definitions import defaults


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
                "default_important_equipment",
                "Important equipment availability",
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
                "Entities not provided",
                "entity_not_provided",
                "entity",
                True,
            ),
        )
    ]
    for policy in policies:
        if policy["id"] not in {"default_entities", "default_important_equipment"}:
            continue
        important = policy["id"] == "default_important_equipment"
        policy["match_any" if important else "match_none"] = [
            {"domain": ["camera", "lock", "alarm_control_panel"]},
            {
                "domain": ["binary_sensor"],
                "device_class": ["smoke", "carbon_monoxide", "gas", "moisture"],
            },
        ]
        if important:
            policy["notifications"][0]["profile"] = "immediate"
    return policies


def initial_settings(timezone: str) -> dict[str, Any]:
    """Start with basic monitoring and no notification destinations or sends."""
    return {
        "monitoring_policy_version": 1,
        "monitoring_policies": policy_templates(),
        "notification_definitions": defaults(timezone),
        "functions": [],
        "situations": [],
        "external_capabilities": [],
        "notifications": False,
        "consumer": None,
        "timings": dict(DEFAULTS),
    }
