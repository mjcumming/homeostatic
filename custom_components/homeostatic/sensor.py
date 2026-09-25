"""Health and evidence sensors backed by the public health-tree queries."""

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HomeostaticConfigEntry
from .const import DOMAIN, NAME
from .runtime import Runtime

DESCRIPTIONS = (
    SensorEntityDescription(
        key="readiness", translation_key="readiness", icon="mdi:home-heart"
    ),
    SensorEntityDescription(
        key="episodes",
        translation_key="episodes",
        icon="mdi:alert-circle-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SensorEntityDescription(
        key="evidence_gaps",
        translation_key="evidence_gaps",
        icon="mdi:help-circle-outline",
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomeostaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Expose one overall health answer and two diagnostic counts."""
    runtime = entry.runtime_data
    async_add_entities(
        [
            *(HealthSensor(runtime, description) for description in DESCRIPTIONS),
            *(
                HealthSensor(
                    runtime,
                    SensorEntityDescription(
                        key=f"function_{function.id}",
                        name=function.name,
                        icon="mdi:check-network-outline",
                    ),
                    function_node=f"function:{function.id}",
                )
                for function in runtime.settings.functions
            ),
        ]
    )


class HealthSensor(SensorEntity):
    """Remain available when a source fails; only adapter failure is unavailable."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        runtime: Runtime,
        description: SensorEntityDescription,
        *,
        function_node: str | None = None,
    ) -> None:
        """Use stable config-entry identity for the monitor device and entities."""
        self.runtime = runtime
        self.function_node = function_node
        self.entity_description = description
        self._attr_unique_id = f"{runtime.entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, runtime.entry.entry_id)},
            name=NAME,
            manufacturer="Homeostatic",
            model="Health monitor",
        )

    @property
    def available(self) -> bool:
        """Report whether the monitor can provide a current answer."""
        return self.runtime.available

    @property
    def native_value(self) -> str | int:
        """Read the appropriate public model result."""
        if self.function_node is not None:
            if self.runtime.engine is None:
                return "unknown"
            return self.runtime.engine.readiness([self.function_node]).answer
        if self.entity_description.key == "readiness":
            return self.runtime.readiness
        if self.entity_description.key == "episodes":
            return len(self.runtime.episodes)
        return self.runtime.evidence_gaps

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose scope and observation limits alongside the answer."""
        return {
            "function_node": self.function_node,
            "notification_consumer_missing": self.runtime.consumer_missing,
            "monitored_nodes": len(self.runtime.sources),
            "selected_capabilities": len(self.runtime.targets),
            "physical_freshness_verified": False,
            "updated_at": self.runtime.updated_at,
            "error": self.runtime.error,
        }

    async def async_added_to_hass(self) -> None:
        """Subscribe without creating an independent polling loop."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, self.runtime.signal, self.async_write_ha_state
            )
        )
