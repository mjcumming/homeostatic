"""Initial policies and restorable templates owned by the installation."""

from typing import Any

from .const import DEFAULTS
from .notification_definitions import defaults


def policy_templates() -> list[dict[str, Any]]:
    """Return fresh editable records for the supplied monitoring policies."""
    return [
        {
            "id": identity,
            "name": name,
            "check": check,
            "match": {"kind": [kind]} if kind else {},
            "parameters": {"threshold": 20} if check == "battery" else {},
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
            ("default_devices", "Devices", "availability", "device", True),
            ("default_entities", "Entities", "availability", "entity", True),
            ("default_repairs", "Repairs", "repair", None, True),
            (
                "default_broken_automations",
                "Broken automations",
                "broken_automation",
                None,
                True,
            ),
            ("default_batteries", "Batteries", "battery", None, False),
            ("default_vacuums", "Vacuums", "vacuum", None, False),
        )
    ]


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
