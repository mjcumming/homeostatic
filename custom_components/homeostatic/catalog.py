"""HA control-path checks, deliberately distinct from physical freshness."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from health_tree.types import Check, Edge, Importance, Node, Observation, Status
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import State

from .config import Settings
from .rules import Attributes


@dataclass(frozen=True, slots=True, kw_only=True)
class Source:
    """A stable capability and the HA object currently supplying its evidence."""

    node_id: str
    name: str
    kind: str
    entity_id: str | None = None
    entry_id: str | None = None
    owner_id: str | None = None
    disabled: bool = False
    requirements: tuple[str, ...] = ()
    importance: Importance = Importance.NORMAL
    watched: bool = True
    attributes: Attributes = field(default_factory=dict)
    attached_by: tuple[str, ...] = ()
    excluded_by: tuple[str, ...] = ()

    def node(self, settings: Settings) -> Node:
        """Declare a check for the observed HA control-path capability."""
        if self.kind == "function":
            return Node(
                node_id=self.node_id,
                kind=self.kind,
                importance=self.importance,
                labels={"name": self.name},
                depends_on=tuple(Edge(to=target) for target in self.requirements),
            )
        situation = self.kind == "situation"
        return Node(
            node_id=self.node_id,
            kind=self.kind,
            importance=self.importance,
            depends_on=(Edge(to=f"entry:{self.owner_id}"),)
            if self.owner_id and self.watched
            else (),
            labels={
                "name": self.name,
                "source": "owner_declared"
                if self.kind == "external"
                else "home_assistant",
            },
            checks=(
                Check(
                    check_id="condition" if situation else "availability",
                    raise_hold=timedelta(0),
                    clear_hold=timedelta(0)
                    if situation
                    else settings.duration("clear_hold"),
                    ttl=None,
                    unknown_hold=settings.duration("unknown_hold"),
                    labels={"category": "situation" if situation else "fault"},
                ),
            )
            if self.watched
            else (),
        )


def entity_observation(
    source: Source, state: State | None, now: datetime
) -> Observation:
    """Observe HA availability without asserting a physical-device heartbeat."""
    status, reason = entity_state_signature(state)
    if (
        source.kind == "situation"
        and state is not None
        and not state.attributes.get("restored")
    ):
        status, reason = {
            "on": (Status.FAIL, "active"),
            "off": (Status.PASS, "clear"),
            STATE_UNAVAILABLE: (Status.UNKNOWN, "source_unavailable"),
            STATE_UNKNOWN: (Status.UNKNOWN, "state_unknown"),
        }.get(state.state, (Status.UNKNOWN, "invalid_situation_state"))
    if source.disabled:
        status, reason = Status.UNKNOWN, "disabled"
    return Observation(
        node_id=source.node_id,
        check_id="condition" if source.kind == "situation" else "availability",
        status=status,
        reason=reason,
        observed_at=now,
        message=f"{source.name}: {reason.replace('_', ' ')}",
        evidence={
            "entity_id": source.entity_id,
            "state": state.state if state is not None else None,
            "physical_freshness_verified": False,
        },
    )


def entity_state_signature(state: State | None) -> tuple[Status, str]:
    """Compare health evidence independently of a sensor's ordinary value changes."""
    if state is None:
        return Status.UNKNOWN, "source_missing"
    if state.attributes.get("restored"):
        return Status.UNKNOWN, "restored_state"
    if state.state == STATE_UNKNOWN:
        return Status.UNKNOWN, "state_unknown"
    if state.state == STATE_UNAVAILABLE:
        return Status.FAIL, "unavailable"
    return Status.PASS, "available"


def entry_observation(
    source: Source,
    entry: ConfigEntry | None,
    now: datetime,
    retry_since: datetime | None,
    settings: Settings,
    reauth: bool,
) -> Observation:
    """Preserve HA's setup and authentication states as structured evidence."""
    status, reason = Status.UNKNOWN, "source_missing"
    if entry is not None:
        reason = entry.state.value
        if entry.disabled_by is not None:
            reason = "disabled"
        elif reauth:
            status, reason = Status.FAIL, "auth_required"
        elif entry.state is ConfigEntryState.LOADED:
            status = Status.PASS
        elif entry.state is ConfigEntryState.SETUP_RETRY:
            status = Status.WARN
            if retry_since is not None and now >= retry_since + settings.duration(
                "retry_hold"
            ):
                status = Status.FAIL
        elif entry.state in {
            ConfigEntryState.SETUP_ERROR,
            ConfigEntryState.MIGRATION_ERROR,
            ConfigEntryState.FAILED_UNLOAD,
        }:
            status = Status.FAIL
    return Observation(
        node_id=source.node_id,
        check_id="availability",
        status=status,
        reason=reason,
        observed_at=now,
        message=f"{source.name}: {reason.replace('_', ' ')}",
        evidence={"config_entry_id": source.entry_id, "reauth_pending": reauth},
    )
