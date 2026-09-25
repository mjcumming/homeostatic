"""Response-only actions using health-tree's public query contracts."""

from typing import Any

import voluptuous as vol
from health_tree.types import JSONValue
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN
from .runtime import Runtime

SERVICES = ("inventory", "explain", "readiness", "impact", "coverage", "rollup")


@callback
def async_register_services(hass: HomeAssistant, runtime: Runtime) -> None:
    """Register read queries once for the singleton installation."""

    async def handle(call: ServiceCall) -> dict[str, JSONValue]:
        try:
            return runtime.query(call.service, dict(call.data))
        except KeyError as err:
            raise ServiceValidationError(
                f"Unknown Homeostatic node: {err.args[0]}"
            ) from err

    for service in SERVICES:
        fields: dict[Any, Any] = {}
        if service in {"explain", "impact"}:
            fields = {vol.Required("node_id"): cv.string}
        elif service in {"readiness", "rollup"}:
            fields = {vol.Optional("node_ids"): vol.All(cv.ensure_list, [cv.string])}
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
