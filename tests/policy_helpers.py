"""Build explicit unified monitoring configurations for integration tests."""

from typing import Any

from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.notification_definitions import defaults


def monitoring_policy(
    identity: str,
    match: dict[str, list[str]],
    *,
    check: str = "availability",
    enabled: bool = True,
    parameters: dict[str, Any] | None = None,
    notifications: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Describe one current policy without inherited source settings."""
    return {
        "id": identity,
        "name": identity,
        "check": check,
        "match": match,
        "parameters": parameters or {},
        "enabled": enabled,
        "notifications": notifications or [],
    }


def current_config(
    policies: list[dict[str, Any]] | None = None, **settings: Any
) -> dict[str, Any]:
    """Build a complete current-schema configuration with explicit policy scope."""
    return {
        "monitoring_policy_version": 1,
        "monitoring_policies": policies or [],
        "notification_definitions": defaults(),
        **settings,
    }


def bound_identity(
    policy: dict[str, Any],
    source_id: str,
    *,
    member_exclusions: tuple[str, ...] = (),
) -> str:
    """Identify the public policy condition for one catalog source."""
    [parsed] = parse_policies([policy])
    return f"monitoring:{parsed.id}:{parsed.detection_key(member_exclusions=member_exclusions)}:{source_id}"


def availability_policies(
    *, entities: list[str] | None = None, integrations: list[str] | None = None
) -> list[dict[str, Any]]:
    """Select explicit entity and integration expectations for a lifecycle test."""
    selections = (
        ("entities", "entity", entities),
        ("integrations", "integration", integrations),
    )
    return [
        monitoring_policy(identity, {"kind": [kind], kind: selected})
        for identity, kind, selected in selections
        if selected
    ]


def immediate_notification() -> list[dict[str, Any]]:
    """Use the isolated test notification service through one explicit method."""
    return [{"id": "now", "timing": {"mode": "immediate"}, "methods": ["test"]}]


def notification_definitions_data() -> dict[str, Any]:
    """Configure the in-memory notification test service without live targets."""
    return {
        **defaults(),
        "methods": {
            "test": {
                "name": "Test consumer",
                "mode": "fixed",
                "destinations": ["service:homeostatic_test"],
            }
        },
    }
