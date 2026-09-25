"""Validated, order-independent catalog attach and exclusion rules."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

FIELDS = frozenset(
    {
        "kind",
        "domain",
        "device_class",
        "integration",
        "device",
        "entity",
        "area",
        "floor",
        "label",
    }
)
DEFAULT_RULES: list[dict[str, Any]] = [
    {
        "id": "passive_availability",
        "action": "attach",
        "match": {},
        "checks": ["availability"],
    }
]
type Attributes = dict[str, tuple[str, ...]]


def attributes(value: Any) -> Attributes:
    """Validate exact match fields and normalize scalar/list values."""
    if not isinstance(value, dict) or value.keys() - FIELDS:
        raise ValueError("Unknown catalog match field")
    result: Attributes = {}
    for key, raw in value.items():
        values = [raw] if isinstance(raw, str) else raw
        if (
            not isinstance(values, list)
            or not values
            or not all(isinstance(item, str) and item for item in values)
        ):
            raise ValueError("Match values must be nonempty strings or lists")
        result[key] = tuple(sorted(set(values)))
    return result


@dataclass(frozen=True, slots=True, kw_only=True)
class CatalogRule:
    """One owner-editable catalog rule with a stable explanation id."""

    id: str
    action: str
    match: Mapping[str, tuple[str, ...]]
    enabled: bool = True

    def matches(self, metadata: Attributes) -> bool:
        """Match every field, accepting any of its configured values."""
        return self.enabled and all(
            set(values).intersection(metadata.get(key, ()))
            for key, values in self.match.items()
        )


def parse_rules(value: Any) -> tuple[CatalogRule, ...]:
    """Reject ambiguous or unsupported rules before applying any configuration."""
    if not isinstance(value, list):
        raise ValueError("Rules must be a list")
    result = []
    ids: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or row.keys() - {
            "id",
            "action",
            "match",
            "checks",
            "enabled",
        }:
            raise ValueError("Unknown catalog rule field")
        rule_id = row.get("id")
        if (
            not isinstance(rule_id, str)
            or not re.fullmatch(r"[a-z][a-z0-9_]*", rule_id)
            or rule_id in ids
        ):
            raise ValueError("Rule ids must be unique slugs")
        action = row.get("action")
        if action not in ("attach", "exclude"):
            raise ValueError("Rule action must be attach or exclude")
        if row.get("checks", ["availability"]) != ["availability"]:
            raise ValueError("The passive catalog supports only availability")
        enabled = row.get("enabled", True)
        if type(enabled) is not bool:
            raise ValueError("Rule enabled must be boolean")
        result.append(
            CatalogRule(
                id=rule_id,
                action=action,
                match=attributes(row.get("match", {})),
                enabled=enabled,
            )
        )
        ids.add(rule_id)
    return tuple(result)


@dataclass(frozen=True, slots=True, kw_only=True)
class Decision:
    """All contributing rules, including exclusions that defeat attachments."""

    attached_by: tuple[str, ...]
    excluded_by: tuple[str, ...]

    @property
    def watched(self) -> bool:
        """Whether the availability check is effective after exclusions."""
        return bool(self.attached_by) and not self.excluded_by


def decide(rules: tuple[CatalogRule, ...], metadata: Attributes) -> Decision:
    """Evaluate a source without rule-order precedence or side effects."""
    matching = [rule for rule in rules if rule.matches(metadata)]
    return Decision(
        attached_by=tuple(
            sorted(rule.id for rule in matching if rule.action == "attach")
        ),
        excluded_by=tuple(
            sorted(rule.id for rule in matching if rule.action == "exclude")
        ),
    )
