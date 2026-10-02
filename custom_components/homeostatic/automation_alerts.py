"""Durable automation-owned declarations without a second setup interface."""

from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from typing import Any
from urllib.parse import quote

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from . import reporting
from .catalog import Source
from .config import Settings

LABEL = "homeostatic_alert_profile"
MAX_ALERTS = 1000
REPORT_FIELDS: dict[Any, Any] = {
    vol.Required("automation"): vol.All(str, vol.Match(r"^automation\..+$")),
    vol.Optional("alert_key", default="default"): vol.All(
        str, vol.Length(min=1, max=100)
    ),
    vol.Required("name"): vol.All(str, vol.Length(min=1, max=200)),
    vol.Required("message"): vol.All(str, vol.Length(max=2000)),
    vol.Required("profile"): vol.In(reporting.PROFILES),
    vol.Required("state"): vol.In(("active", "clear", "unknown")),
    vol.Optional("report_timeout", default=300): vol.All(
        int, vol.Range(min=60, max=86400)
    ),
    vol.Optional("adopt_situation_id"): vol.All(str, vol.Match(r"^[a-z][a-z0-9_]*$")),
}
RECORD = vol.Schema(
    {
        vol.Required("owner"): str,
        vol.Required("key"): str,
        vol.Required("node_id"): str,
        vol.Required("name"): str,
        vol.Required("profile"): vol.In(reporting.PROFILES),
        vol.Required("report_timeout"): vol.All(int, vol.Range(min=60, max=86400)),
        vol.Required("retired"): bool,
    }
)


def automation_owner(hass: HomeAssistant, entity_id: str) -> str:
    """Use HA's saved automation ID, which survives entity and alias renames."""
    entry = er.async_get(hass).async_get(entity_id)
    if entry is None or entry.platform != "automation" or not entry.unique_id:
        raise ValueError("Choose a saved HA automation with a stable ID")
    return entry.unique_id


def identity(owner: str, key: str) -> str:
    """Keep distinct configured conditions independent of changing content."""
    return "automation_" + sha256(f"{owner}\0{key}".encode()).hexdigest()


def profile_rule(policy: dict[str, Any], profile: str) -> dict[str, Any]:
    """Reuse configured profiles without creating recipients or fallback routes."""
    value = reporting.choices(policy)
    to = (
        []
        if value is None or profile == "dashboard"
        else [
            f"person:{person}"
            for person in value["profiles"][profile]["people"]
            if f"person:{person}" in policy["recipients"]
        ]
    )
    match = {"labels": {LABEL: profile}}
    if not to:
        return {"match": match, "loudness": "record"}
    result: dict[str, Any] = {"match": match, "to": to}
    if profile in {"acknowledge", "immediate"}:
        result["loudness"] = "urgent"
        if profile == "acknowledge":
            result.update(require_acknowledgment=True, remind_every="30m")
    else:
        result.update(loudness="digest", digest=profile)
    return result


class AutomationAlerts:
    """Own only declarations and retirement; HealthTree owns issue lifecycles."""

    def __init__(self) -> None:
        """Prepare an empty adapter-owned registry."""
        self.records: dict[str, dict[str, Any]] = {}

    def restore(self, value: Any) -> None:
        """Reject malformed adapter-owned state rather than silently losing identity."""
        records = vol.Schema({str: RECORD})(value)
        if (
            sum(not row["retired"] for row in records.values()) > MAX_ALERTS
            or any(
                key != identity(row["owner"], row["key"])
                or not row["node_id"].startswith("situation:")
                for key, row in records.items()
            )
            or len({row["node_id"] for row in records.values()}) != len(records)
        ):
            raise ValueError("Invalid stored automation alerts")
        self.records = deepcopy(records)

    def prune_removed_owners(self, hass: HomeAssistant) -> bool:
        """Drop declarations whose owning automation HA has removed."""
        if not hass.is_running:
            return False
        owners = {
            entry.unique_id
            for entry in er.async_get(hass).entities.values()
            if entry.platform == "automation" and entry.unique_id
        }
        before = len(self.records)
        self.records = {
            key: row for key, row in self.records.items() if row["owner"] in owners
        }
        return len(self.records) != before

    def prepare(
        self, hass: HomeAssistant, settings: Settings, data: dict[str, Any]
    ) -> tuple[str, dict[str, Any]]:
        """Validate the complete report before changing the durable declaration."""
        data = vol.Schema(REPORT_FIELDS)(data)
        owner = automation_owner(hass, data["automation"])
        key = identity(owner, data["alert_key"])
        previous = self.records.get(key)
        if previous is not None and previous["retired"]:
            raise ValueError(
                "This alert is retired; explicitly resume it before reporting"
            )
        if (
            previous is None
            and sum(not row["retired"] for row in self.records.values()) >= MAX_ALERTS
        ):
            raise ValueError("Automation alert capacity reached")
        if not data["name"].strip():
            raise ValueError("Provide an alert name")
        if (
            data["profile"] != "dashboard"
            and reporting.choices(settings.policy) is None
        ):
            raise ValueError(
                "Configure shared reporting profiles in Homeostatic Notifications first"
            )
        node_id = previous["node_id"] if previous else f"situation:{key}"
        if adopted := data.get("adopt_situation_id"):
            node_id = f"situation:{adopted}"
            declared = next((s for s in settings.situations if s.id == adopted), None)
            if declared is None or declared.report_timeout is None:
                raise ValueError(
                    "Only a declared automation-reported situation can be adopted"
                )
            if previous is not None and previous["node_id"] != node_id:
                raise ValueError("An existing alert cannot change identity")
        if (
            previous is None
            and not data.get("adopt_situation_id")
            and any(f"situation:{s.id}" == node_id for s in settings.situations)
        ):
            raise ValueError("Explicit adoption is required for a declared situation")
        if any(k != key and r["node_id"] == node_id for k, r in self.records.items()):
            raise ValueError("Another automation owns this situation")
        return key, {
            "owner": owner,
            "key": data["alert_key"],
            "node_id": node_id,
            "name": data["name"],
            "profile": data["profile"],
            "report_timeout": data["report_timeout"],
            "retired": False,
        }

    def compose(self, settings: Settings) -> Settings:
        """Suppress declarations explicitly converted to automation ownership."""
        owned = {row["node_id"] for row in self.records.values()}
        return replace(
            settings,
            situations=tuple(
                s for s in settings.situations if f"situation:{s.id}" not in owned
            ),
        )

    def sources(self, settings: Settings) -> dict[str, Source]:
        """Present active registrations with their editor and profile ownership."""
        return {
            row["node_id"]: Source(
                node_id=row["node_id"],
                name=row["name"],
                kind="situation",
                report_timeout=row["report_timeout"],
                alert_profile=row["profile"],
                alert_reporting_status=self.status(settings, row),
                automation_url=f"/config/automation/edit/{quote(row['owner'], safe='')}",
            )
            for row in self.records.values()
            if not row["retired"]
        }

    def policy(self, settings: Settings) -> dict[str, Any]:
        """Compile generic profile rules once; source labels carry each selection.

        Alerts and Repairs both carry the profile label, and Repairs can appear
        at any time, so the label rules are always present. They match nothing
        until a labelled source exists.
        """
        policy = deepcopy(settings.policy)
        policy["rules"] = [
            profile_rule(policy, p) for p in reporting.PROFILES
        ] + policy["rules"]
        return policy

    def status(self, settings: Settings, row: dict[str, Any]) -> str:
        """Explain non-delivery without silently selecting another profile."""
        if row["profile"] == "dashboard":
            return "dashboard_only"
        if not settings.notifications:
            return "requests_disabled"
        if profile_rule(settings.policy, row["profile"])["loudness"] == "record":
            return "missing_destinations"
        return "configured"
