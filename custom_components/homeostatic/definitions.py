"""Owner-defined functions and entity-bound situations."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from health_tree.types import Importance


@dataclass(frozen=True, slots=True, kw_only=True)
class Function:
    """A named capability with explicitly required source identities."""

    id: str
    name: str
    importance: Importance
    entities: tuple[str, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class Situation:
    """An independent alert reported by a stateful Home Assistant entity."""

    id: str
    name: str
    importance: Importance
    entity: str


def definitions(
    data: Mapping[str, Any],
) -> tuple[tuple[Function, ...], tuple[Situation, ...]]:
    """Validate stored definitions without accepting arbitrary graph edges."""
    functions: list[Function] = []
    situations: list[Situation] = []
    for kind in ("functions", "situations"):
        rows = data.get(kind, [])
        if not isinstance(rows, list):
            raise ValueError(f"{kind} must be a list")
        seen: set[str] = set()
        for row in rows:
            allowed = {
                "id",
                "name",
                "importance",
                "entities" if kind == "functions" else "entity",
            }
            if not isinstance(row, dict) or set(row) - allowed:
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
            importance = Importance(row.get("importance", "normal"))
            seen.add(identity)
            sources = (
                row.get("entities") if kind == "functions" else [row.get("entity")]
            )
            if (
                not isinstance(sources, list)
                or not sources
                or not all(
                    isinstance(source, str)
                    and source.startswith(("registry:", "entity_id:"))
                    and source.partition(":")[2]
                    for source in sources
                )
            ):
                raise ValueError(f"{kind} needs entity source references")
            if kind == "functions":
                functions.append(
                    Function(
                        id=identity,
                        name=name,
                        importance=importance,
                        entities=tuple(dict.fromkeys(sources)),
                    )
                )
            else:
                situations.append(
                    Situation(
                        id=identity, name=name, importance=importance, entity=sources[0]
                    )
                )
    return tuple(functions), tuple(situations)
