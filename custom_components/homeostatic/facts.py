"""Detected facts published for owner automations (ADR 0014)."""

from dataclasses import dataclass
from typing import Literal

from health_tree.types import JSONValue
from homeassistant.core import Context

from .catalog import Source

FACT_SCHEMA_VERSION = 1

type FunctionChange = Literal["problem_opened", "problem_changed", "problem_resolved"]


@dataclass(frozen=True, slots=True, kw_only=True)
class Fact:
    """One event waiting for the durable save that makes it true."""

    event_type: str
    data: dict[str, JSONValue]
    context: Context
    functions_before: frozenset[str] = frozenset()
    functions_after: frozenset[str] = frozenset()

    def function_changes(self) -> dict[str, FunctionChange]:
        """Describe this episode fact from each affected function's view."""
        changes: dict[str, FunctionChange] = {}
        for function_id in self.functions_before | self.functions_after:
            if function_id not in self.functions_after:
                changes[function_id] = "problem_resolved"
            elif function_id in self.functions_before:
                changes[function_id] = "problem_changed"
            else:
                changes[function_id] = "problem_opened"
        return changes


def child_context(parent: Context | None) -> Context:
    """Link a fact to the single HA change that caused it, when there is one."""
    return Context(parent_id=parent.id) if parent is not None else Context()


def anchor_identity(anchor: str, source: Source | None) -> dict[str, JSONValue]:
    """HA identities a rule can act on without querying Homeostatic."""
    if source is None:
        return {
            "anchor": anchor,
            "anchor_name": anchor,
            "anchor_kind": None,
            "entity_ids": [],
            "device_id": None,
            "area_id": None,
            "floor_id": None,
        }
    entity_ids: list[JSONValue] = (
        [source.entity_id]
        if source.entity_id
        else list(source.availability_entities)
        if source.kind == "device"
        else []
    )

    def first(key: str) -> str | None:
        return next(iter(source.attributes.get(key, ())), None)

    return {
        "anchor": anchor,
        "anchor_name": source.name,
        "anchor_kind": source.kind,
        "entity_ids": entity_ids,
        "device_id": first("device"),
        "area_id": first("area"),
        "floor_id": first("floor"),
    }


def reasons(episode: dict[str, JSONValue]) -> list[JSONValue]:
    """Findings without timing fields, so equal conditions compare equal."""
    findings = episode["reasons"]
    assert isinstance(findings, list)
    return [
        {
            key: finding.get(key)
            for key in ("node_id", "check_id", "status", "reason", "message")
        }
        for finding in findings
        if isinstance(finding, dict)
    ]


def signature(
    episode: dict[str, JSONValue], functions: frozenset[str]
) -> tuple[object, ...]:
    """The fields whose change makes an update worth publishing."""
    # Messages carry display names, so a rename alone is not a new condition.
    conditions = tuple(
        (finding["node_id"], finding["check_id"], finding["status"], finding["reason"])
        for finding in reasons(episode)
        if isinstance(finding, dict)
    )
    return (episode["status"], episode["importance"], conditions, functions)
