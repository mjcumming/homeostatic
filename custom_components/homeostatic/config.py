"""Validated source selection and timing configuration."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import voluptuous as vol
from health_tree.engine import Engine
from health_tree.types import (
    Edge,
    EngineSettings,
    Importance,
    Loudness,
    Match,
    Node,
    PolicyConfig,
    Recipient,
    Rule,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er

from .const import DEFAULTS, DOMAIN
from .definitions import (
    ExternalCapability,
    Function,
    Situation,
    definitions,
    external_capabilities,
)
from .rules import DEFAULT_RULES, CatalogRule, parse_rules


@dataclass(frozen=True, slots=True, kw_only=True)
class Settings:
    """Adapter settings after a config or options flow."""

    entities: tuple[str, ...]
    config_entries: tuple[str, ...]
    notifications: bool
    timings: Mapping[str, int]
    functions: tuple[Function, ...] = ()
    situations: tuple[Situation, ...] = ()
    consumer: str | None = None
    rules: tuple[CatalogRule, ...] | None = None
    external_capabilities: tuple[ExternalCapability, ...] = ()

    @classmethod
    def from_data(cls, data: Mapping[str, Any]) -> Settings:
        """Validate stored data, including data created before defaults changed."""
        timings = {**DEFAULTS, **data.get("timings", {})}
        for key, value in timings.items():
            if key not in DEFAULTS or type(value) is not int or value < 0:
                raise ValueError(f"Invalid timing: {key}")
        if timings["coalesce_count"] < 2:
            raise ValueError("coalesce_count must be at least two")
        entities = data.get("entities", [])
        entries = data.get("config_entries", [])
        if not isinstance(entities, list) or not all(
            isinstance(item, str) for item in entities
        ):
            raise ValueError("entities must be a list of source references")
        if not isinstance(entries, list) or not all(
            isinstance(item, str) for item in entries
        ):
            raise ValueError("config_entries must be a list of entry ids")
        enabled = data.get("notifications", False)
        if type(enabled) is not bool:
            raise ValueError("notifications must be boolean")
        functions, situations = definitions(data)
        consumer = data.get("consumer")
        if consumer is not None and (
            not isinstance(consumer, str) or not consumer.startswith("automation.")
        ):
            raise ValueError("consumer must be an automation entity id")
        settings = cls(
            entities=tuple(dict.fromkeys(entities)),
            config_entries=tuple(dict.fromkeys(entries)),
            notifications=enabled,
            timings=timings,
            functions=functions,
            situations=situations,
            consumer=consumer,
            rules=parse_rules(data["rules"]) if "rules" in data else None,
            external_capabilities=external_capabilities(data),
        )
        validator = Engine(settings.engine_settings())
        # Graph validation has no observations or history; its time is fixed.
        validation_time = datetime(2000, 1, 1, tzinfo=UTC)
        for function in functions:
            try:
                validator.register(
                    Node(
                        node_id=f"function:{function.id}",
                        depends_on=tuple(
                            Edge(to=node_id) for node_id in function.requirements
                        ),
                    ),
                    validation_time,
                )
            except ValueError as err:
                raise ValueError(f"{function.name}: {err}") from err
        return settings

    def engine_settings(self) -> EngineSettings:
        """Translate adapter defaults to required engine durations."""
        return EngineSettings(
            settle=self.duration("settle"),
            rejoin_grace=self.duration("rejoin_grace"),
            startup_grace=self.duration("startup_grace"),
            coalesce_count=self.timings["coalesce_count"],
            coalesce_window=self.duration("coalesce_window"),
        )

    def policy_config(self) -> PolicyConfig:
        """Use one local recipient for the first in-app transport."""
        return PolicyConfig(
            batch=self.duration("batch"),
            timezone=UTC,
            recipients={"owner": Recipient(channels=("event",))},
            digests={},
            rules=(
                Rule(
                    match=Match(importance=frozenset({Importance.CRITICAL})),
                    loudness=Loudness.URGENT,
                    to=("owner",),
                ),
                Rule(match=Match(), loudness=Loudness.NOTIFY, to=("owner",)),
            ),
        )

    def duration(self, key: str) -> timedelta:
        """Return a configured duration in seconds."""
        return timedelta(seconds=self.timings[key])


def entity_reference(hass: HomeAssistant, entity_id: str) -> str:
    """Prefer registry identity to a changeable entity id."""
    registered = er.async_get(hass).async_get(entity_id)
    if registered is not None:
        return f"registry:{registered.id}"
    return f"entity_id:{entity_id}"


def resolve_entity(hass: HomeAssistant, reference: str) -> str | None:
    """Resolve the current entity id, leaving missing registry entries unknown."""
    if reference.startswith("registry:"):
        registered = er.async_get(hass).entities.get_entry(reference[9:])
        return registered.entity_id if registered is not None else None
    if reference.startswith("entity_id:"):
        return reference[10:]
    raise ValueError("Invalid entity source reference")


def data_from_input(
    hass: HomeAssistant, user_input: Mapping[str, Any]
) -> dict[str, Any]:
    """Convert form fields to stable source selections."""
    entity_ids = user_input.get("entity_ids", [])
    own_entities = er.async_get(hass)
    for entity_id in entity_ids:
        registered = own_entities.async_get(entity_id)
        if registered is not None and registered.platform == DOMAIN:
            raise vol.Invalid("Homeostatic cannot monitor its own entities")
    entry_ids = user_input.get("config_entries", [])
    for entry_id in entry_ids:
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is not None and entry.domain == DOMAIN:
            raise vol.Invalid("Homeostatic cannot monitor itself")
    data = {
        "entities": [entity_reference(hass, entity_id) for entity_id in entity_ids],
        "config_entries": entry_ids,
        "notifications": user_input.get("notifications", False),
        "timings": {key: user_input.get(key, value) for key, value in DEFAULTS.items()},
    }
    data.update(normalize_definitions(hass, user_input))
    consumer = user_input.get("consumer")
    data["consumer"] = consumer
    if data["notifications"]:
        state = hass.states.get(consumer) if isinstance(consumer, str) else None
        if (
            state is None
            or state.state != "on"
            or not isinstance(consumer, str)
            or not consumer.startswith("automation.")
        ):
            raise vol.Invalid("Enable a notification consumer automation first")
    if "rules" in user_input:
        data["rules"] = normalize_rules(hass, user_input["rules"])
    elif not {"entity_ids", "config_entries"}.intersection(user_input):
        data["rules"] = normalize_rules(hass, DEFAULT_RULES)
    Settings.from_data(data)
    return data


def normalize_rules(hass: HomeAssistant, value: Any) -> list[dict[str, Any]]:
    """Resolve friendly entity input once; retain stable ids in saved rules."""
    rules = parse_rules(value)
    result = []
    for rule in rules:
        match = {key: list(values) for key, values in rule.match.items()}
        if "entity" in match:
            match["entity"] = [
                value
                if value.startswith(("registry:", "entity_id:"))
                else entity_reference(hass, value)
                for value in match["entity"]
            ]
        for reference in match.get("entity", []):
            entity_id = resolve_entity(hass, reference)
            registered = er.async_get(hass).async_get(entity_id) if entity_id else None
            if registered is not None and registered.platform == DOMAIN:
                raise vol.Invalid("Homeostatic cannot monitor its own entities")
        for entry_id in match.get("integration", []):
            entry = hass.config_entries.async_get_entry(entry_id)
            if entry is not None and entry.domain == DOMAIN:
                raise vol.Invalid("Homeostatic cannot monitor itself")
        result.append(
            {
                "id": rule.id,
                "enabled": rule.enabled,
                "action": rule.action,
                "match": match,
                "checks": ["availability"],
            }
        )
    return result


def rule_data(hass: HomeAssistant, settings: Settings) -> list[dict[str, Any]]:
    """Translate legacy selections into the same editable rule catalog."""
    if settings.rules is not None:
        return [
            {
                "id": rule.id,
                "action": rule.action,
                "enabled": rule.enabled,
                "match": {key: list(values) for key, values in rule.match.items()},
                "checks": ["availability"],
            }
            for rule in settings.rules
        ]
    references = set(settings.entities) | {
        reference
        for function in settings.functions
        for reference in function.entity_references
    }
    entries = set(settings.config_entries)
    registry = er.async_get(hass)
    for reference in references:
        entity_id = resolve_entity(hass, reference)
        registered = registry.async_get(entity_id) if entity_id else None
        if registered is not None and registered.config_entry_id:
            entries.add(registered.config_entry_id)
    rules: list[dict[str, Any]] = []
    if references:
        rules.append(
            {
                "id": "selected_entities",
                "action": "attach",
                "match": {"entity": sorted(references)},
            }
        )
    if entries:
        rules.append(
            {
                "id": "selected_integrations",
                "action": "attach",
                "match": {"kind": "integration", "integration": sorted(entries)},
            }
        )
    return rules


def normalize_definitions(
    hass: HomeAssistant, data: Mapping[str, Any]
) -> dict[str, Any]:
    """Normalize entity inputs while preserving explicit capability ids."""
    result: dict[str, Any] = {
        "external_capabilities": data.get("external_capabilities", [])
    }
    for kind in ("functions", "situations"):
        items = data.get(kind, [])
        if not isinstance(items, list):
            raise vol.Invalid(f"{kind} must be a list")
        converted = []
        for row in items:
            if not isinstance(row, dict):
                raise vol.Invalid(f"Invalid {kind} definition")
            item = dict(row)
            fields = (
                ("entities", "requires", "automations", "accept", "reject")
                if kind == "functions"
                else ("entity",)
            )
            for field in fields:
                values = [item.get(field)] if field == "entity" else item.get(field, [])
                if not isinstance(values, list) or not all(
                    isinstance(value, str) for value in values
                ):
                    raise vol.Invalid("Choose capability references")
                refs = [
                    normalize_requirement(
                        hass, value, node=field in {"requires", "accept", "reject"}
                    )
                    for value in values
                ]
                if field == "automations":
                    for ref in refs:
                        entity_id = resolve_entity(hass, ref)
                        if entity_id is not None and not entity_id.startswith(
                            "automation."
                        ):
                            raise vol.Invalid(
                                "Choose automation entities for suggestions"
                            )
                item[field] = refs[0] if field == "entity" else refs
            converted.append(item)
        result[kind] = converted
    return result


def normalize_requirement(hass: HomeAssistant, value: str, *, node: bool) -> str:
    """Resolve entity inputs and reject self-derived or situation requirements."""
    if node and value.startswith(("entry:", "function:", "external:", "situation:")):
        if value.startswith("entry:"):
            entry = hass.config_entries.async_get_entry(value[6:])
            if entry is not None and entry.domain == DOMAIN:
                raise vol.Invalid("Homeostatic cannot require itself")
        return value
    reference = value.removeprefix("entity:")
    if not reference.startswith(("registry:", "entity_id:")):
        reference = entity_reference(hass, cv.entity_id(reference))
    if reference.startswith("entity_id:"):
        cv.entity_id(reference[10:])
    entity_id = resolve_entity(hass, reference)
    registered = er.async_get(hass).async_get(entity_id) if entity_id else None
    if registered is not None and registered.platform == DOMAIN:
        raise vol.Invalid("Homeostatic cannot use its own entities")
    return f"entity:{reference}" if node else reference
