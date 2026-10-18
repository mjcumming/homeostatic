"""Match monitoring policies against current catalog metadata."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

FIELDS = frozenset(
    {
        "kind",
        "domain",
        "device_class",
        "entity_category",
        "integration",
        "integration_domain",
        "device",
        "entity",
        "area",
        "floor",
        "label",
    }
)
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


def alternatives(value: Any) -> tuple[Attributes, ...]:
    """Validate editable entity-type alternatives using domains and device classes."""
    if not isinstance(value, list) or not value:
        raise ValueError("Metadata alternatives must be a nonempty list")
    result = tuple(attributes(item) for item in value)
    if any(
        "domain" not in item or item.keys() - {"domain", "device_class"}
        for item in result
    ):
        raise ValueError(
            "Metadata alternatives need a domain and optional device class"
        )
    return result


def _matches(match: Mapping[str, tuple[str, ...]], metadata: Attributes) -> bool:
    return all(
        set(values).intersection(metadata.get(key, ())) for key, values in match.items()
    )


@dataclass(frozen=True, slots=True, kw_only=True)
class CatalogRule:
    """One compiled policy selector with a stable explanation id."""

    id: str
    match: Mapping[str, tuple[str, ...]]
    checks: tuple[str, ...] = ("availability",)
    enabled: bool = True
    excluded_sources: tuple[str, ...] = ()
    match_any: tuple[Attributes, ...] = ()
    match_none: tuple[Attributes, ...] = ()

    def matches(self, metadata: Attributes, *, source_id: str | None = None) -> bool:
        """Match every field, accepting any of its configured values."""
        if source_id in self.excluded_sources:
            return False
        if (
            "availability" in self.checks
            and metadata.get("kind") == ("entity",)
            and metadata.get("entity_category") in {("diagnostic",), ("config",)}
            and "entity" not in self.match
        ):
            return False
        if "device" in metadata.get("kind", ()) and "kind" not in self.match:
            return False
        return (
            self.enabled
            and _matches(self.match, metadata)
            and (
                not self.match_any
                or any(_matches(match, metadata) for match in self.match_any)
            )
            and not any(_matches(match, metadata) for match in self.match_none)
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Decision:
    """The policies that monitor a catalog source."""

    attached_by: tuple[str, ...]

    @property
    def watched(self) -> bool:
        """Whether at least one policy selected the check."""
        return bool(self.attached_by)


def decide(
    rules: tuple[CatalogRule, ...],
    metadata: Attributes,
    check_id: str = "availability",
    *,
    source_id: str | None = None,
) -> Decision:
    """Evaluate a source without rule-order precedence or side effects."""
    matching = [
        rule
        for rule in rules
        if check_id in rule.checks and rule.matches(metadata, source_id=source_id)
    ]
    return Decision(attached_by=tuple(sorted(rule.id for rule in matching)))
