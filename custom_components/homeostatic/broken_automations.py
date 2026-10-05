"""Flag automations that name an entity id which no longer exists."""

from collections.abc import Iterable
from copy import deepcopy
from datetime import datetime
from typing import Any

import voluptuous as vol
from health_tree.types import Observation, Status
from homeassistant.components import automation
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from . import reporting
from .catalog import Source
from .rules import CatalogRule

CHECK = "broken_automation"
DEFAULT_PROFILE = "morning"
ENTITY_ID = vol.All(str, vol.Match(r"^[a-z_]+[.][a-z0-9_]+$"))
RECORD = vol.Schema(
    {
        vol.Required("entity_id"): ENTITY_ID,
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=300)),
        vol.Required("missing"): [ENTITY_ID],
        vol.Required("url"): vol.All(
            str, vol.Match(r"^/config/automation(/edit/[^/\s]+)?$")
        ),
        vol.Required("state"): vol.In(("active", "cleared")),
    }
)


def node_id(entity_id: str) -> str:
    """Name the issue after the automation entity, which stays while it is loaded."""
    return f"broken:{entity_id}"


def loaded(hass: HomeAssistant) -> bool:
    """Whether the automation component is currently loaded."""
    return automation.DATA_COMPONENT in hass.data


def suppressed(rules: tuple[CatalogRule, ...]) -> bool:
    """Whether a broad exclusion turns every broken automation off."""
    return any(
        rule.enabled
        and rule.action == "exclude"
        and rule.checks == (CHECK,)
        and dict(rule.match) == {"kind": (CHECK,)}
        for rule in rules
    )


def profile(policy: dict[str, Any]) -> str | None:
    """Return the shared reporting choice, or None for a custom policy."""
    choices = reporting.choices(policy)
    if choices is None:
        return None
    return str(choices.get("broken_automations", DEFAULT_PROFILE))


def _absent(hass: HomeAssistant, entity_ids: Iterable[str]) -> list[str]:
    """Entity ids in neither the registry nor the state machine."""
    registry = er.async_get(hass)
    return sorted(
        {
            entity_id
            for entity_id in entity_ids
            if registry.async_get(entity_id) is None
            and hass.states.get(entity_id) is None
        }
    )


def _message(missing: list[str]) -> str:
    if len(missing) == 1:
        return f"This automation names {missing[0]}, which no longer exists."
    listed = f"{', '.join(missing[:-1])} and {missing[-1]}"
    return f"This automation names {listed}, which no longer exist."


class BrokenAutomations:
    """Track automations whose saved entity ids are gone."""

    def __init__(self) -> None:
        """Start with no known automations."""
        self.records: dict[str, dict[str, Any]] = {}

    def restore(self, value: Any) -> None:
        """Reject malformed stored rows instead of guessing which automation they are."""
        records = vol.Schema({str: RECORD})(value)
        if any(
            key != node_id(row["entity_id"])
            or (row["state"] == "active" and not row["missing"])
            for key, row in records.items()
        ):
            raise ValueError("Invalid stored broken automations")
        self.records = deepcopy(records)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Return the records needed to present open issues after a restart."""
        return deepcopy(self.records)

    def scan(
        self,
        hass: HomeAssistant,
        *,
        full: bool,
        named: set[str],
        created: set[str],
    ) -> bool:
        """Read explicit entity ids from loaded automations.

        The automation helpers return nothing while that component is unloaded.
        Treating that as an empty catalog would end issues that are still open.
        """
        if not loaded(hass):
            return False
        before = deepcopy(self.records)
        if full:
            self._scan_all(hass)
        else:
            self._scan_some(hass, named, created)
        return self.records != before

    def _scan_all(self, hass: HomeAssistant) -> None:
        component = hass.data[automation.DATA_COMPONENT]
        seen = set()
        for entity in component.entities:
            seen.add(node_id(entity.entity_id))
            self._sync(hass, entity.entity_id)
        for key, row in self.records.items():
            if key not in seen and row["state"] == "active":
                row["state"] = "cleared"
                row["missing"] = []

    def _scan_some(
        self, hass: HomeAssistant, named: set[str], created: set[str]
    ) -> None:
        targets = set()
        for entity_id in named:
            targets.update(automation.automations_with_entity(hass, entity_id))
        if created:
            targets.update(
                row["entity_id"]
                for row in self.records.values()
                if row["state"] == "active" and created.intersection(row["missing"])
            )
        for entity_id in targets:
            self._sync(hass, entity_id)

    def _sync(self, hass: HomeAssistant, entity_id: str) -> None:
        component = hass.data[automation.DATA_COMPONENT]
        entity = component.get_entity(entity_id)
        key = node_id(entity_id)
        row = self.records.get(key)
        if entity is None:
            if row is not None and row["state"] == "active":
                row["state"] = "cleared"
                row["missing"] = []
            return
        missing = _absent(hass, automation.entities_in_automation(hass, entity_id))
        if not missing:
            if row is not None and row["state"] == "active":
                row["state"] = "cleared"
                row["missing"] = []
            return
        unique_id = entity.unique_id
        url = (
            f"/config/automation/edit/{unique_id}"
            if isinstance(unique_id, str) and unique_id and "/" not in unique_id
            else "/config/automation"
        )
        raw_name = entity.name
        name = raw_name.strip()[:300] if isinstance(raw_name, str) else ""
        if not name:
            name = entity_id
        self.records[key] = {
            "entity_id": entity_id,
            "name": name,
            "missing": missing,
            "url": url,
            "state": "active",
        }

    def prune(self, open_anchors: set[str]) -> bool:
        """Forget ended automations once their issues have ended."""
        kept = {
            key: row
            for key, row in self.records.items()
            if row["state"] == "active" or key in open_anchors
        }
        changed = len(kept) != len(self.records)
        self.records = kept
        return changed

    def sources(
        self, policy: dict[str, Any], rules: tuple[CatalogRule, ...] = ()
    ) -> dict[str, Source]:
        """Present each known automation as a source outside the dependency map."""
        if suppressed(rules):
            return {}
        chosen = profile(policy)
        return {
            key: Source(
                node_id=key,
                name=row["name"],
                kind=CHECK,
                alert_profile=chosen,
                fix_url=row["url"],
                check_id=CHECK,
            )
            for key, row in self.records.items()
        }

    def observation(self, key: str, now: datetime) -> Observation:
        """Report whether the automation still names a missing entity id."""
        row = self.records[key]
        active = row["state"] == "active"
        return Observation(
            node_id=key,
            check_id=CHECK,
            status=Status.FAIL if active else Status.PASS,
            reason="missing" if active else "clear",
            observed_at=now,
            message=_message(row["missing"])
            if active
            else "This automation no longer names a missing entity.",
            evidence={
                "reporter": "broken_automations",
                "automation": row["entity_id"],
                "missing": list(row["missing"]),
            },
        )
