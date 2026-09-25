"""Native enrollment and timing options for Homeostatic."""

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import selector

from .config import Settings, data_from_input, rule_data
from .const import DOMAIN, NAME
from .enrollment import inventory, report
from .rules import DEFAULT_RULES, Attributes, parse_rules


def form_schema(hass: HomeAssistant, data: dict[str, Any]) -> vol.Schema:
    """Offer existing source identities and editable adapter defaults."""
    settings = Settings.from_data(data)
    fields: dict[Any, Any] = {
        vol.Optional(
            "rules", default=rule_data(hass, settings) if data else DEFAULT_RULES
        ): selector.ObjectSelector(),
        vol.Optional("preview", default=False): selector.BooleanSelector(),
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
        preview = ""
        form_data: dict[str, Any] = {}
        if user_input is not None:
            try:
                data = data_from_input(self.hass, user_input)
            except ValueError, vol.Invalid:
                errors["base"] = "invalid_config"
            else:
                if user_input.get("preview"):
                    preview = preview_summary(self.hass, data)
                    form_data = data
                else:
                    await self.async_set_unique_id(DOMAIN)
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(title=NAME, data=data)
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(
                form_schema(self.hass, form_data), user_input if errors else None
            ),
            errors=errors,
            description_placeholders={"preview": preview},
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
        preview = ""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                data = data_from_input(self.hass, user_input)
            except ValueError, vol.Invalid:
                errors["base"] = "invalid_config"
            else:
                if user_input.get("preview"):
                    runtime = getattr(self.config_entry, "runtime_data", None)
                    preview = preview_summary(
                        self.hass, data, runtime.enrolled if runtime else {}
                    )
                    current = data
                else:
                    return self.async_create_entry(title="", data=data)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                form_schema(self.hass, current), user_input if errors else None
            ),
            errors=errors,
            description_placeholders={"preview": preview},
        )


def preview_summary(
    hass: HomeAssistant,
    data: dict[str, Any],
    known: dict[str, Attributes] | None = None,
) -> str:
    """Describe current rule matches without saving or starting a monitor."""
    settings = Settings.from_data(data)
    result = report(
        inventory(hass, settings, known or {}), parse_rules(rule_data(hass, settings))
    )
    counts = "; ".join(
        f"{rule['id']}: {rule['matches']} matches" for rule in result["rules"]
    )
    return f"Preview: {result['watched']} watched sources. {counts}"
