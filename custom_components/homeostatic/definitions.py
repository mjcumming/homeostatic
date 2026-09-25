"""Owner-defined capabilities, functions and independent situations."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from health_tree.types import Importance


@dataclass(frozen=True, slots=True, kw_only=True)
class Function:
    """A named capability with reviewed requirements and scoped suggestions."""

    id: str
    name: str
    importance: Importance
    entities: tuple[str, ...] = ()
    requires: tuple[str, ...] = ()
    automations: tuple[str, ...] = ()
    accept: tuple[str, ...] = ()
    reject: tuple[str, ...] = ()

    @property
    def requirements(self) -> tuple[str, ...]:
        """Return declared and confirmed edges, preserving stable identities."""
        return tuple(
            dict.fromkeys(
                (
                    *self.requires,
                    *(f"entity:{ref}" for ref in self.entities),
                    *self.accept,
                )
            )
        )

    @property
    def entity_references(self) -> tuple[str, ...]:
        """Return entity requirements needed even when catalog rules exclude them."""
        return tuple(
            node_id[7:]
            for node_id in self.requirements
            if node_id.startswith("entity:")
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalCapability:
    """One declared external capability without an evidence producer."""

    id: str
    name: str
    importance: Importance


@dataclass(frozen=True, slots=True, kw_only=True)
class Situation:
    """An independent alert reported by a stateful Home Assistant entity."""

    id: str
    name: str
    importance: Importance
    entity: str


def rows(data: Mapping[str, Any], kind: str, fields: set[str]) -> list[dict[str, Any]]:
    """Validate named records before resolving their graph references."""
    value = data.get(kind, [])
    if not isinstance(value, list):
        raise ValueError(f"{kind} must be a list")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict) or row.keys() - (
            fields | {"id", "name", "importance"}
        ):
            raise ValueError(f"Invalid {kind} definition")
        identity, name = row.get("id"), row.get("name")
        if (
            not isinstance(identity, str)
            or not re.fullmatch(r"[a-z][a-z0-9_]*", identity)
            or identity in seen
        ):
            raise ValueError(f"Invalid or repeated {kind} id")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"{kind} needs a name")
        seen.add(identity)
        result.append(row)
    return result


def references(value: Any, prefixes: tuple[str, ...]) -> tuple[str, ...]:
    """Reject unsupported graph references, including every situation edge."""
    if not isinstance(value, list) or not all(
        isinstance(item, str)
        and any(item.startswith(prefix) and item[len(prefix) :] for prefix in prefixes)
        for item in value
    ):
        raise ValueError(
            "Choose entity, integration, function or external capability references; situations cannot be dependencies"
        )
    return tuple(dict.fromkeys(value))


def definitions(
    data: Mapping[str, Any],
) -> tuple[tuple[Function, ...], tuple[Situation, ...]]:
    """Validate function decisions and situation bindings from stored data."""
    functions = []
    for row in rows(
        data, "functions", {"entities", "requires", "automations", "accept", "reject"}
    ):
        function = Function(
            id=row["id"],
            name=row["name"],
            importance=Importance(row.get("importance", "normal")),
            entities=references(row.get("entities", []), ("registry:", "entity_id:")),
            requires=references(
                row.get("requires", []),
                (
                    "entity:registry:",
                    "entity:entity_id:",
                    "entry:",
                    "function:",
                    "external:",
                ),
            ),
            automations=references(
                row.get("automations", []), ("registry:", "entity_id:automation.")
            ),
            accept=references(
                row.get("accept", []), ("entity:registry:", "entity:entity_id:")
            ),
            reject=references(
                row.get("reject", []), ("entity:registry:", "entity:entity_id:")
            ),
        )
        if set(function.requirements).intersection(function.reject):
            raise ValueError(
                f"{function.name}: a required capability cannot also be rejected"
            )
        functions.append(function)
    situations = []
    for row in rows(data, "situations", {"entity"}):
        entity = references([row.get("entity")], ("registry:", "entity_id:"))[0]
        situations.append(
            Situation(
                id=row["id"],
                name=row["name"],
                importance=Importance(row.get("importance", "normal")),
                entity=entity,
            )
        )
    return tuple(functions), tuple(situations)


def external_capabilities(data: Mapping[str, Any]) -> tuple[ExternalCapability, ...]:
    """Declare unknown external capabilities without inventing observations."""
    return tuple(
        ExternalCapability(
            id=row["id"],
            name=row["name"],
            importance=Importance(row.get("importance", "normal")),
        )
        for row in rows(data, "external_capabilities", set())
    )
