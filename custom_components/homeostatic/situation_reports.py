"""Translate native automation reports into ordinary HealthTree observations."""

from datetime import datetime

from health_tree.types import Observation, Status

from .catalog import Source


def report_observation(source: Source, state: str, now: datetime) -> Observation:
    """Use acceptance time; only explicit clearing is evidence of recovery."""
    status = {"active": Status.FAIL, "clear": Status.PASS, "unknown": Status.UNKNOWN}[
        state
    ]
    return Observation(
        node_id=source.node_id,
        check_id="condition",
        status=status,
        reason=state,
        observed_at=now,
        message=f"{source.name}: {state}",
        evidence={"reporter": "automation", "physical_freshness_verified": False},
    )
