"""Report Home Assistant Repairs as ordinary Homeostatic issues."""

from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
from typing import Any

import voluptuous as vol
from health_tree.types import Observation, Status
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.translation import async_get_translations
from homeassistant.loader import IntegrationNotFound, async_get_integration

from . import reporting
from .catalog import Source
from .const import DOMAIN

MAX_REPAIRS = 500
DEFAULT_PROFILE = "morning"
STATES = ("active", "cleared", "ignored")
RECORD = vol.Schema(
    {
        vol.Required("domain"): str,
        vol.Required("issue_id"): str,
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=300)),
        vol.Required("integration"): str,
        vol.Required("severity"): str,
        vol.Required("url"): vol.All(str, vol.Match(r"^/config/")),
        vol.Required("state"): vol.In(STATES),
    }
)


def node_id(domain: str, issue_id: str) -> str:
    """Name a Repair by its registry key, which HA keeps while it is reported."""
    return "repair:" + sha256(f"{domain}\0{issue_id}".encode()).hexdigest()


def profile(policy: dict[str, Any]) -> str | None:
    """Return the shared Repairs reporting choice, or None for a custom policy."""
    choices = reporting.choices(policy)
    if choices is None:
        return None
    return str(choices.get("repairs", DEFAULT_PROFILE))


def _render(template: str, placeholders: Mapping[str, str]) -> str:
    for key, value in placeholders.items():
        template = template.replace("{" + key + "}", str(value))
    return template


class Repairs:
    """Mirror HA's Repairs; HealthTree owns each issue's lifecycle."""

    def __init__(self) -> None:
        """Start with no known Repairs."""
        self.records: dict[str, dict[str, Any]] = {}

    def restore(self, value: Any) -> None:
        """Reject malformed stored Repairs instead of guessing their identity."""
        records = vol.Schema({str: RECORD})(value)
        if len(records) > MAX_REPAIRS or any(
            key != node_id(row["domain"], row["issue_id"])
            for key, row in records.items()
        ):
            raise ValueError("Invalid stored Repairs")
        self.records = deepcopy(records)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Return the records needed to present open Repair issues after a restart."""
        return deepcopy(self.records)

    async def async_read(self, hass: HomeAssistant) -> bool:
        """Read HA's current Repairs with their displayed titles."""
        issues = [
            issue
            for (domain, _), issue in ir.async_get(hass).issues.items()
            if domain != DOMAIN and issue.active
        ]
        domains = sorted({issue.domain for issue in issues})
        titles = (
            await async_get_translations(hass, hass.config.language, "issues", domains)
            if domains
            else {}
        )
        names: dict[str, str] = {}
        for domain in sorted({issue.issue_domain or issue.domain for issue in issues}):
            try:
                names[domain] = (await async_get_integration(hass, domain)).name
            except IntegrationNotFound:
                names[domain] = domain
        before = deepcopy(self.records)
        seen: set[str] = set()
        for issue in sorted(issues, key=lambda item: (item.domain, item.issue_id)):
            key = node_id(issue.domain, issue.issue_id)
            ignored = issue.dismissed_version is not None
            if key not in self.records and (
                ignored or len(self.records) >= MAX_REPAIRS
            ):
                continue
            seen.add(key)
            integration = names[issue.issue_domain or issue.domain]
            placeholders = issue.translation_placeholders or {}
            title = titles.get(
                f"component.{issue.domain}.issues.{issue.translation_key}.title"
            )
            edit = str(placeholders.get("edit", ""))
            self.records[key] = {
                "domain": issue.domain,
                "issue_id": issue.issue_id,
                "name": (
                    _render(title, placeholders).strip()
                    if title
                    else f"{integration} repair"
                )[:300]
                or f"{integration} repair",
                "integration": integration,
                "severity": issue.severity.value if issue.severity else "warning",
                "url": edit if edit.startswith("/config/") else "/config/repairs",
                "state": "ignored" if ignored else "active",
            }
        for key, row in self.records.items():
            if key not in seen and row["state"] == "active":
                row["state"] = "cleared"
        return self.records != before

    def prune(self, open_anchors: set[str]) -> bool:
        """Forget Repairs that HA no longer reports once their issues have ended."""
        kept = {
            key: row
            for key, row in self.records.items()
            if row["state"] == "active" or key in open_anchors
        }
        changed = len(kept) != len(self.records)
        self.records = kept
        return changed

    def sources(self, policy: dict[str, Any]) -> dict[str, Source]:
        """Present each known Repair as a source outside the dependency map."""
        chosen = profile(policy)
        return {
            key: Source(
                node_id=key,
                name=row["name"],
                kind="repair",
                alert_profile=chosen,
                fix_url=row["url"],
                check_id="repair",
            )
            for key, row in self.records.items()
        }

    def observation(
        self, key: str, now: datetime, *, holding: bool
    ) -> Observation | None:
        """Report the Repair's current state; hold while integrations re-raise it."""
        row = self.records[key]
        if row["state"] == "cleared" and holding:
            return None
        status, reason, message = {
            "active": (
                Status.FAIL,
                "reported",
                f"{row['integration']} reported this in Home Assistant Repairs ({row['severity']}).",
            ),
            "cleared": (
                Status.PASS,
                "cleared",
                "Home Assistant no longer reports this Repair.",
            ),
            "ignored": (
                Status.PASS,
                "ignored",
                "This Repair was ignored in Home Assistant.",
            ),
        }[row["state"]]
        return Observation(
            node_id=key,
            check_id="repair",
            status=status,
            reason=reason,
            observed_at=now,
            message=message,
            evidence={
                "reporter": "home_assistant_repairs",
                "domain": row["domain"],
                "issue_id": row["issue_id"],
                "severity": row["severity"],
            },
        )
