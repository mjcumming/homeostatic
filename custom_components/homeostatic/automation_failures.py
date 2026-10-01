"""Show automation failures that Home Assistant has already reported."""

from health_tree.types import JSONValue
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir


def reported_automation_failures(hass: HomeAssistant) -> list[dict[str, JSONValue]]:
    """Read active automation validation and missing-action repair issues."""
    failures: list[dict[str, JSONValue]] = []
    for (domain, issue_id), issue in ir.async_get(hass).issues.items():
        if (
            domain != "automation"
            or not issue.active
            or issue.dismissed_version is not None
            or issue.severity != ir.IssueSeverity.ERROR
            or not (
                issue.translation_key == "service_not_found"
                or (issue.translation_key or "").startswith("validation_")
            )
        ):
            continue
        details = issue.translation_placeholders or {}
        edit = details.get("edit", "")
        failures.append(
            {
                "id": issue_id,
                "name": details.get("name") or details.get("entity_id") or "Automation",
                "reason": details.get("error")
                or (
                    f"Action {details['service']} is unavailable"
                    if "service" in details
                    else "Home Assistant reported an automation validation error"
                ),
                "url": edit
                if edit.startswith("/config/automation/edit/")
                else "/config/repairs",
            }
        )
    return sorted(failures, key=lambda item: str(item["name"]).casefold())
