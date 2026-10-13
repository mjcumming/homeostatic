"""Named monitoring definitions and their independent detection identities."""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from .rules import Attributes, CatalogRule, attributes
from .temperature import TemperatureLimitParameters, ThermostatParameters
from .ups_parameters import UPS_CHECKS, ReserveParameters

CHECKS = frozenset(
    {
        "availability",
        "battery",
        "vacuum",
        "repair",
        "broken_automation",
        "thermostat",
        "temperature_limit",
        *UPS_CHECKS,
    }
)
TEMPERATURE_CHECKS = frozenset({"thermostat", "temperature_limit"})


@dataclass(frozen=True, slots=True, kw_only=True)
class MonitoringPolicy:
    """One independently editable expectation with stable notification rows."""

    id: str
    name: str
    check: str
    match: Mapping[str, tuple[str, ...]]
    parameters: Mapping[str, Any]
    enabled: bool
    notifications: tuple[dict[str, Any], ...]

    def matches(self, metadata: Attributes) -> bool:
        """Apply the same exact group selection semantics as catalog rules."""
        return CatalogRule(
            id=self.id, action="attach", match=self.match, enabled=self.enabled
        ).matches(metadata)

    def detection_key(self) -> str:
        """Identify detection edits without including names or delivery choices."""
        payload = {
            "check": self.check,
            "match": dict(self.match),
            "parameters": dict(self.parameters),
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[
            :16
        ]

    def data(self) -> dict[str, Any]:
        """Return the editable, serializable definition."""
        return {
            "id": self.id,
            "name": self.name,
            "check": self.check,
            "match": {key: list(value) for key, value in self.match.items()},
            "parameters": dict(self.parameters),
            "enabled": self.enabled,
            "notifications": [dict(row) for row in self.notifications],
        }


def parse_policies(value: Any) -> tuple[MonitoringPolicy, ...]:
    """Reject unsupported detection settings and duplicate identities."""
    if not isinstance(value, list):
        raise ValueError("Monitoring policies must be a list")
    result = []
    ids: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or set(row) - {
            "id",
            "name",
            "check",
            "match",
            "parameters",
            "enabled",
            "notifications",
        }:
            raise ValueError("Unknown monitoring policy field")
        identity, name, check = row.get("id"), row.get("name"), row.get("check")
        if (
            not isinstance(identity, str)
            or not re.fullmatch(r"[a-z][a-z0-9_-]*", identity)
            or identity in ids
        ):
            raise ValueError("Monitoring policy ids must be unique slugs")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Choose a monitoring policy name")
        if not isinstance(check, str) or check not in CHECKS:
            raise ValueError("Choose a supported monitoring check")
        parameters = row.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("Detection parameters must be an object")
        if check == "temperature_limit":
            parameters = asdict(TemperatureLimitParameters.from_data(parameters))
        elif check == "thermostat":
            parameters = asdict(ThermostatParameters.from_data(parameters))
        elif check == "ups_reserve":
            parameters = ReserveParameters.from_data(parameters).data()
        elif parameters:
            raise ValueError("This check has no configurable detection parameters")
        enabled = row.get("enabled", False)
        if type(enabled) is not bool:
            raise ValueError("Monitoring enabled must be boolean")
        notifications = row.get("notifications", [])
        if not isinstance(notifications, list) or not all(
            isinstance(item, dict) for item in notifications
        ):
            raise ValueError("Choose notification schedule and method rows")
        if check != "ups_reserve" and any("when" in item for item in notifications):
            raise ValueError("Power-mode schedules belong to the UPS reserve check")
        if check == "ups_reserve" and any(
            item.get("when") not in {"mains", "backup"} for item in notifications
        ):
            raise ValueError(
                "Select mains or backup power for every reserve notification row"
            )
        result.append(
            MonitoringPolicy(
                id=identity,
                name=name.strip(),
                check=check,
                match=attributes(row.get("match", {})),
                parameters=parameters,
                enabled=enabled,
                notifications=tuple(notifications),
            )
        )
        ids.add(identity)
    return tuple(result)
