"""Named monitoring definitions and their independent detection identities."""

import hashlib
import json
import math
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from .entity_not_provided import parameters as not_provided_parameters
from .rules import Attributes, CatalogRule, alternatives, attributes
from .temperature import TemperatureLimitParameters, ThermostatParameters
from .ups_parameters import UPS_CHECKS, ReserveParameters

CHECKS = frozenset(
    {
        "availability",
        "entity_not_provided",
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
    excluded_sources: tuple[str, ...] = ()
    included_sources: tuple[str, ...] = ()
    match_any: tuple[Attributes, ...] = ()
    match_none: tuple[Attributes, ...] = ()

    def matches(self, metadata: Attributes, *, source_id: str | None = None) -> bool:
        """Apply positive scope, registry eligibility, and exact source exclusions."""
        return CatalogRule(
            id=self.id,
            match=self.match,
            checks=(self.check,),
            enabled=self.enabled,
            excluded_sources=self.excluded_sources,
            included_sources=self.included_sources,
            match_any=self.match_any,
            match_none=self.match_none,
        ).matches(metadata, source_id=source_id)

    def detection_key(self) -> str:
        """Identify detection edits affecting this check's selected evidence."""
        payload: dict[str, Any] = {
            "check": self.check,
            "match": dict(self.match),
            "parameters": dict(self.parameters),
        }
        if self.match_any:
            payload["match_any"] = self.match_any
        if self.match_none:
            payload["match_none"] = self.match_none
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
            **(
                {"excluded_sources": list(self.excluded_sources)}
                if self.excluded_sources
                else {}
            ),
            **(
                {"included_sources": list(self.included_sources)}
                if self.included_sources
                else {}
            ),
            **{
                key: [
                    {field: list(values) for field, values in match.items()}
                    for match in matches
                ]
                for key, matches in (
                    ("match_any", self.match_any),
                    ("match_none", self.match_none),
                )
                if matches
            },
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
            "excluded_sources",
            "included_sources",
            "match_any",
            "match_none",
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
        if "match_any" in row and "match_none" in row:
            raise ValueError("Choose matching entity types or excluded entity types")
        match = attributes(row.get("match", {}))
        if check == "availability" and match.get("kind") not in {
            None,
            ("integration",),
            ("entity",),
        }:
            raise ValueError("Availability policies monitor integrations or entities")
        if ("match_any" in row or "match_none" in row) and (
            check != "availability" or match.get("kind") != ("entity",)
        ):
            raise ValueError("Entity type alternatives belong to entity availability")
        parameters = row.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("Detection parameters must be an object")
        if check == "entity_not_provided":
            if match.get("kind") != ("entity",):
                raise ValueError("Entities not provided policies select entities")
            parameters = not_provided_parameters(parameters)
        elif check == "temperature_limit":
            parameters = asdict(TemperatureLimitParameters.from_data(parameters))
        elif check == "thermostat":
            parameters = asdict(ThermostatParameters.from_data(parameters))
        elif check == "ups_reserve":
            parameters = ReserveParameters.from_data(parameters).data()
        elif check == "battery":
            threshold = parameters.get("threshold", 20)
            if (
                parameters.keys() - {"threshold"}
                or isinstance(threshold, bool)
                or not isinstance(threshold, (int, float))
                or not math.isfinite(threshold)
                or not 0 <= threshold <= 100
            ):
                raise ValueError("Battery threshold must be a percentage from 0 to 100")
            parameters = {"threshold": float(threshold)}
        elif parameters:
            raise ValueError("This check has no configurable detection parameters")
        excluded = parse_excluded_sources(row.get("excluded_sources", []))
        included = parse_excluded_sources(row.get("included_sources", []))
        if included and (
            check not in {"availability", "entity_not_provided"}
            or match.get("kind") != ("entity",)
            or any(not identity.startswith("entity:") for identity in included)
        ):
            raise ValueError("Explicit inclusions belong to entity availability")
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
                match=match,
                parameters=parameters,
                enabled=enabled,
                notifications=tuple(notifications),
                excluded_sources=excluded,
                included_sources=included,
                match_any=alternatives(row["match_any"]) if "match_any" in row else (),
                match_none=alternatives(row["match_none"])
                if "match_none" in row
                else (),
            )
        )
        ids.add(identity)
    return tuple(result)


def parse_excluded_sources(value: object) -> tuple[str, ...]:
    """Validate and normalize canonical policy exclusion identities."""
    if not isinstance(value, list) or any(
        not isinstance(source, str)
        or not source.startswith(
            (
                "entry:",
                "device:",
                "entity:registry:",
                "entity:entity_id:",
                "battery:registry:",
                "battery:entity_id:",
                "vacuum:registry:",
                "vacuum:entity_id:",
                "ups:",
                "repair:",
                "broken_automation:",
            )
        )
        or not source.rsplit(":", 1)[-1]
        or any(character.isspace() for character in source)
        for source in value
    ):
        raise ValueError("Choose canonical source identities to exclude")
    return tuple(sorted(set(value)))
