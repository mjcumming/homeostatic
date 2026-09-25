"""Validated source selection and timing configuration."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, timedelta
from typing import Any

import voluptuous as vol
from health_tree.types import (
    EngineSettings,
    Importance,
    Loudness,
    Match,
    PolicyConfig,
    Recipient,
    Rule,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import DEFAULTS, DOMAIN
from .definitions import Function, Situation, definitions


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
            not isinstance(consumer, str)
            or not isinstance(consumer, str)
            or not consumer.startswith("automation.")
        ):
            raise ValueError("consumer must be an automation entity id")
        return cls(
            entities=tuple(dict.fromkeys(entities)),
            config_entries=tuple(dict.fromkeys(entries)),
            notifications=enabled,
            timings=timings,
            functions=functions,
            situations=situations,
            consumer=consumer,
        )

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
    for kind in ("functions", "situations"):
        rows = user_input.get(kind, [])
        if not isinstance(rows, list):
            raise vol.Invalid(f"{kind} must be a list")
        converted = []
        for row in rows:
            if not isinstance(row, dict):
                raise vol.Invalid(f"Invalid {kind} definition")
            item = dict(row)
            field = "entities" if kind == "functions" else "entity"
            values = item.get(field) if kind == "functions" else [item.get(field)]
            if not isinstance(values, list) or not all(
                isinstance(value, str) for value in values
            ):
                raise vol.Invalid("Choose entity requirements")
            references = []
            for value in values:
                reference = (
                    value
                    if value.startswith(("registry:", "entity_id:"))
                    else entity_reference(hass, value)
                )
                entity_id = resolve_entity(hass, reference)
                registered = own_entities.async_get(entity_id) if entity_id else None
                if registered is not None and registered.platform == DOMAIN:
                    raise vol.Invalid("Homeostatic cannot use its own entities")
                references.append(reference)
            item[field] = references if kind == "functions" else references[0]
            converted.append(item)
        data[kind] = converted
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
    Settings.from_data(data)
    return data
