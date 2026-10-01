"""Public queries and administrator operator actions."""

from typing import Any

import voluptuous as vol
from health_tree.types import JSONValue
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_register_admin_service

from .automation_alerts import REPORT_FIELDS
from .const import DOMAIN
from .runtime import Runtime

MUTATIONS = (
    "shelve",
    "start_maintenance",
    "acknowledge",
    "cancel_control",
    "report_situation",
    "report_alert",
    "manage_alert",
)
SERVICES = (
    *MUTATIONS,
    "operator_controls",
    "resolved_history",
    "preview_maintenance",
    "policy",
    "preview_policy",
    "inventory",
    "explain",
    "readiness",
    "impact",
    "coverage",
    "rollup",
    "preview_rules",
)


@callback
def async_register_services(hass: HomeAssistant, runtime: Runtime) -> None:
    """Register queries and protected mutations once for the singleton installation."""

    async def handle(call: ServiceCall) -> dict[str, JSONValue]:
        try:
            if call.service in MUTATIONS:
                return await runtime.async_control(
                    call.service, dict(call.data), call.context.user_id, call.context
                )
            return runtime.query(call.service, dict(call.data))
        except (ValueError, vol.Invalid) as err:
            raise ServiceValidationError(str(err)) from err
        except KeyError as err:
            raise ServiceValidationError(
                f"Unknown Homeostatic node: {err.args[0]}"
            ) from err

    for service in SERVICES:
        fields: dict[Any, Any] = {}
        if service == "report_alert":
            fields = REPORT_FIELDS
        elif service == "manage_alert":
            fields = {
                vol.Required("automation"): cv.entity_id,
                vol.Optional("alert_key", default="default"): cv.string,
                vol.Required("operation"): vol.In(("retire", "resume")),
            }
        elif service == "report_situation":
            fields = {
                vol.Required("situation_id"): vol.All(
                    cv.string, vol.Match(r"^[a-z][a-z0-9_]*$")
                ),
                vol.Required("state"): vol.In(("active", "clear", "unknown")),
            }
        elif service in {"acknowledge", "cancel_control"}:
            fields = {
                vol.Required(
                    "episode_id" if service == "acknowledge" else "control_id"
                ): cv.string
            }
        elif service in (*MUTATIONS, "preview_maintenance"):
            fields = {
                vol.Required("until"): cv.string,
                vol.Required(
                    "episode_id" if service == "shelve" else "node_id"
                ): cv.string,
            }
            if service != "shelve":
                fields[vol.Optional("include_dependents", default=False)] = cv.boolean
            if service in MUTATIONS:
                fields[vol.Optional("reason", default="")] = vol.All(
                    cv.string, vol.Length(max=500)
                )
        elif service == "preview_policy":
            fields = {vol.Required("policy"): dict}
        elif service == "preview_rules":
            fields = {vol.Required("rules"): list}
        elif service in {"explain", "impact"}:
            fields = {vol.Required("node_id"): cv.string}
        elif service in {"readiness", "rollup"}:
            fields = {vol.Optional("node_ids"): vol.All(cv.ensure_list, [cv.string])}
        if service in MUTATIONS:
            async_register_admin_service(
                hass,
                DOMAIN,
                service,
                handle,
                schema=vol.Schema(fields),
                supports_response=SupportsResponse.OPTIONAL,
            )
            continue
        hass.services.async_register(
            DOMAIN,
            service,
            handle,
            schema=vol.Schema(fields),
            supports_response=SupportsResponse.ONLY,
        )


@callback
def async_remove_services(hass: HomeAssistant) -> None:
    """Remove singleton queries on unload."""
    for service in SERVICES:
        hass.services.async_remove(DOMAIN, service)
