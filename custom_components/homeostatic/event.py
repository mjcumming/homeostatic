"""One event entity per function, mirroring episode facts that affect it."""

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HomeostaticConfigEntry
from .const import DOMAIN, NAME
from .facts import Fact
from .runtime import Runtime

EVENT_TYPES = ["problem_opened", "problem_changed", "problem_resolved"]
ATTRIBUTES = (
    "episode_id",
    "anchor",
    "anchor_name",
    "status",
    "importance",
    "resolution",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomeostaticConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Expose function problems where the automation editor can find them."""
    runtime = entry.runtime_data
    async_add_entities(
        FunctionProblems(runtime, function.id, function.name)
        for function in runtime.settings.functions
    )


class FunctionProblems(EventEntity):
    """Problems opening, changing and resolving for one declared function."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_icon = "mdi:alert-decagram-outline"
    _attr_event_types = EVENT_TYPES

    def __init__(self, runtime: Runtime, function_id: str, name: str) -> None:
        """Bind to one function node; the runtime owns every health decision."""
        self.runtime = runtime
        self.function_node = f"function:{function_id}"
        self._attr_name = name
        self._attr_unique_id = (
            f"{runtime.entry.entry_id}_function_{function_id}_problems"
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, runtime.entry.entry_id)},
            name=NAME,
            manufacturer="Homeostatic",
            model="Health monitor",
        )

    @property
    def available(self) -> bool:
        """Match the monitor's sensors: only adapter failure is unavailable."""
        return self.runtime.available

    async def async_added_to_hass(self) -> None:
        """Listen for saved facts rather than engine events."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, self.runtime.fact_signal, self._fact_published
            )
        )

    @callback
    def _fact_published(self, fact: Fact) -> None:
        change = fact.function_changes().get(self.function_node)
        if change is None:
            return
        self._trigger_event(change, {key: fact.data.get(key) for key in ATTRIBUTES})
        self.async_write_ha_state()
