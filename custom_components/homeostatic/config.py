"""Validated source selection and timing configuration."""

from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime, timedelta
from typing import Any

import voluptuous as vol
from health_tree.engine import Engine
from health_tree.types import (
    Edge,
    EngineSettings,
    Node,
    PolicyConfig,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er

from .attention import build_policy
from .const import DEFAULTS, DOMAIN
from .definitions import (
    ExternalCapability,
    Function,
    Situation,
    definitions,
    external_capabilities,
)
from .monitoring import MonitoringPolicy, parse_policies
from .notification_definitions import defaults as notification_defaults
from .notification_definitions import generate as notification_policy
from .notification_definitions import validate as validate_notification_definitions


@dataclass(frozen=True, slots=True, kw_only=True)
class Settings:
    """Validated adapter settings stored by setup or the dashboard."""

    policy: dict[str, Any]
    notifications: bool
    timings: Mapping[str, int]
    functions: tuple[Function, ...] = ()
    situations: tuple[Situation, ...] = ()
    consumer: str | None = None
    external_capabilities: tuple[ExternalCapability, ...] = ()
    monitoring_policy_version: int = 1
    monitoring_policies: tuple[MonitoringPolicy, ...] = ()
    notification_definitions: dict[str, Any] = dataclass_field(
        default_factory=notification_defaults
    )

    @classmethod
    def from_data(
        cls, data: Mapping[str, Any], *, functions_enabled: bool = True
    ) -> Settings:
        """Validate stored data, optionally leaving dormant functions inactive."""
        timings = {**DEFAULTS, **data.get("timings", {})}
        for key, value in timings.items():
            if key not in DEFAULTS or type(value) is not int or value < 0:
                raise ValueError(f"Invalid timing: {key}")
        if timings["coalesce_count"] < 2:
            raise ValueError("coalesce_count must be at least two")
        enabled = data.get("notifications", False)
        if type(enabled) is not bool:
            raise ValueError("notifications must be boolean")
        functions, situations = definitions(
            data if functions_enabled else {**data, "functions": []}
        )
        consumer = data.get("consumer")
        if consumer is not None and (
            not isinstance(consumer, str) or not consumer.startswith("automation.")
        ):
            raise ValueError("consumer must be an automation entity id")
        version = data.get("monitoring_policy_version")
        if type(version) is not int or version != 1:
            raise ValueError(
                "Unsupported monitoring policy version; configure the unified policy model"
            )
        notification_definitions = validate_notification_definitions(
            data["notification_definitions"]
        )
        settings = cls(
            monitoring_policy_version=version,
            policy=notification_policy(notification_definitions),
            notifications=enabled,
            timings=timings,
            functions=functions,
            situations=situations,
            consumer=consumer,
            monitoring_policies=parse_policies(data.get("monitoring_policies", [])),
            notification_definitions=notification_definitions,
            external_capabilities=external_capabilities(
                data if functions_enabled else {**data, "external_capabilities": []}
            ),
        )
        validation = dict(settings.notification_definitions)
        for item in settings.monitoring_policies:
            validate_notification_definitions(
                {
                    **validation,
                    "default": list(item.notifications),
                    "repairs": [],
                    "broken_automations": [],
                    "assignments": {},
                    "automation_profiles": {},
                }
            )
        validation["assignments"] = {
            **validation["assignments"],
            **{
                f"policy:{item.id}": {
                    "default": [
                        {**row, "id": f"policy_{item.id}_{row['id']}"}
                        for row in item.notifications
                    ],
                    "checks": {},
                }
                for item in settings.monitoring_policies
            },
        }
        validate_notification_definitions(validation)
        nodes = []
        for function in functions:
            try:
                node = Node(
                    node_id=f"function:{function.id}",
                    depends_on=tuple(
                        Edge(to=node_id) for node_id in function.requirements
                    ),
                )
            except ValueError as err:
                raise ValueError(f"{function.name}: {err}") from err
            nodes.append(node)
        if nodes:
            # Graph validation has no observations or history; its time is fixed.
            Engine(settings.engine_settings()).register_many(
                nodes, datetime(2000, 1, 1, tzinfo=UTC)
            )
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
        """Translate owner settings into the library's attention contract."""
        return build_policy(self.policy, self.duration("batch"))

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
                if (
                    field == "entity"
                    and "report_timeout" in item
                    and "entity" not in item
                ):
                    continue
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
