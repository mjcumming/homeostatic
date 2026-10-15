"""One-step Homeostatic enrollment; settings live in the dashboard."""

from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult

from .const import DOMAIN, NAME
from .policy_defaults import initial_settings


class HomeostaticConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create one health monitor for the installation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Start with editable basic monitoring policies."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        data = initial_settings(self.hass.config.time_zone)
        return self.async_create_entry(title=NAME, data=data)
