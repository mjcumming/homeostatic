"""One-step Homeostatic enrollment; settings live in the dashboard."""

from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant

from .config import Settings, data_from_input, rule_data
from .const import DOMAIN, NAME
from .enrollment import inventory, report
from .function_model import preview as preview_functions
from .rules import DEFAULT_RULES, Attributes, parse_rules


class HomeostaticConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create one health monitor for the installation."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Start with the default integration-availability policy."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        data = data_from_input(self.hass, {"rules": DEFAULT_RULES})
        return self.async_create_entry(title=NAME, data=data)


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
    watched = [source for source in result["candidates"] if source["watched"]]
    integrations = sum(source["kind"] == "integration" for source in watched)
    devices = sum(source["kind"] == "device" for source in watched)
    device_entities = sum(
        source["kind"] == "entity" and bool(source["attributes"].get("device"))
        for source in watched
    )
    area_signals = sum(
        source["kind"] == "entity" and not source["attributes"].get("device")
        for source in watched
    )
    scope = (
        f"{integrations} integration instance{'s' if integrations != 1 else ''}, "
        f"{devices} HA device availability check{'s' if devices != 1 else ''}, "
        f"{device_entities} device-associated "
        f"{'entities' if device_entities != 1 else 'entity'}, "
        f"{area_signals} {'entities' if area_signals != 1 else 'entity'} "
        "without an HA device. "
        "Device association does not prove physical hardware."
    )
    functions = preview_functions(hass, settings, known or {})["functions"]
    descriptions = []
    for function in functions:
        gaps = [
            item["node_id"]
            for item in function["requirements"]
            if not item["present"] or item["monitoring"] in {"excluded", "unwatched"}
        ]
        candidates = "; ".join(
            f"{item['node_id']} ({item['decision']})" for item in function["candidates"]
        )
        descriptions.append(
            f"{function['name']}: {function['readiness']['answer']}. Gaps: {', '.join(gaps) or 'none'}. Candidates: {candidates or 'none'}. Static discovery is incomplete."
        )
    routes = sum(
        len(recipient.channels)
        for recipient in settings.policy_config().recipients.values()
    )
    descriptions.append(
        f"Policy: {len(settings.policy_config().rules)} rules, {routes} recipient/channel routes. Use preview_policy to inspect current episodes."
    )
    return (
        f"Preview: {result['watched']} watched sources. {scope} {counts}\n"
        + "\n".join(descriptions)
    )
