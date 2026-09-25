"""Native enrollment and timing options for Homeostatic."""

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import selector

from .config import Settings, data_from_input, resolve_entity
from .const import DOMAIN, NAME


def form_schema(hass: HomeAssistant, data: dict[str, Any]) -> vol.Schema:
    """Offer existing source identities and editable adapter defaults."""
    settings = Settings.from_data(data)
    choices: list[selector.SelectOptionDict] = [
        {"value": entry.entry_id, "label": f"{entry.title} ({entry.domain})"}
        for entry in hass.config_entries.async_entries(
            include_ignore=False, include_disabled=False
        )
        if entry.domain != DOMAIN
    ]
    known = {choice["value"] for choice in choices}
    choices.extend(
        {"value": entry_id, "label": f"Unavailable entry ({entry_id})"}
        for entry_id in settings.config_entries
        if entry_id not in known
    )
    entities = [
        entity_id
        for reference in settings.entities
        if (entity_id := resolve_entity(hass, reference)) is not None
    ]
    fields: dict[Any, Any] = {
        vol.Optional("entity_ids", default=entities): selector.EntitySelector(
            selector.EntitySelectorConfig(multiple=True)
        ),
        vol.Optional(
            "config_entries", default=list(settings.config_entries)
        ): selector.SelectSelector(
            selector.SelectSelectorConfig(
                options=choices,
                multiple=True,
                mode=selector.SelectSelectorMode.DROPDOWN,
            )
        ),
        vol.Optional(
            "functions", default=data.get("functions", [])
        ): selector.ObjectSelector(),
        vol.Optional(
            "situations", default=data.get("situations", [])
        ): selector.ObjectSelector(),
        vol.Optional(
            "consumer", description={"suggested_value": settings.consumer}
        ): selector.EntitySelector(selector.EntitySelectorConfig(domain="automation")),
        vol.Required(
            "notifications", default=settings.notifications
        ): selector.BooleanSelector(),
    }
    if any(resolve_entity(hass, reference) is None for reference in settings.entities):
        fields[vol.Optional("forget_missing", default=False)] = (
            selector.BooleanSelector()
        )
    fields.update(
        {
            vol.Required(key, default=value): vol.All(
                vol.Coerce(int),
                vol.Range(min=2 if key == "coalesce_count" else 0, max=86400),
            )
            for key, value in settings.timings.items()
        }
    )
    return vol.Schema(fields)


class HomeostaticConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create one health monitor for the installation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Enroll selected sources using native HA controls."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = data_from_input(self.hass, user_input)
            except ValueError, vol.Invalid:
                errors["base"] = "invalid_config"
            else:
                await self.async_set_unique_id(DOMAIN)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=NAME, data=data)
        return self.async_show_form(
            step_id="user", data_schema=form_schema(self.hass, {}), errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> HomeostaticOptionsFlow:
        """Open native options and reload after valid changes."""
        return HomeostaticOptionsFlow()


class HomeostaticOptionsFlow(config_entries.OptionsFlowWithReload):
    """Update enrollment and timings while retaining unresolved requirements."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Validate the replacement settings and retain missing selections."""
        current = dict(self.config_entry.options or self.config_entry.data)
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = data_from_input(self.hass, user_input)
                if not user_input.get("forget_missing", False):
                    data["entities"].extend(
                        reference
                        for reference in current.get("entities", [])
                        if resolve_entity(self.hass, reference) is None
                    )
            except ValueError, vol.Invalid:
                errors["base"] = "invalid_config"
            else:
                return self.async_create_entry(title="", data=data)
        return self.async_show_form(
            step_id="init", data_schema=form_schema(self.hass, current), errors=errors
        )
