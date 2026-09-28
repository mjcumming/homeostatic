"""Homeostatic health monitoring using the health-tree library."""

from typing import Any

import voluptuous as vol
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store

from .config import Settings
from .const import DOMAIN, EVENT_NOTIFICATION, STORE_VERSION
from .dashboard import async_register_dashboard, async_remove_dashboard
from .runtime import Runtime
from .services import async_register_services, async_remove_services

type HomeostaticConfigEntry = ConfigEntry[Runtime]


PLATFORMS = [Platform.EVENT, Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: HomeostaticConfigEntry) -> bool:
    """Load presentation now and start monitoring after Home Assistant starts."""
    try:
        runtime = Runtime(hass, entry, Settings.from_data(entry.options or entry.data))
        # A reload while HA is running needs no startup hold.
        runtime.fresh_start = not hass.is_running
        await runtime.async_load()
    except (ValueError, TypeError, KeyError, vol.Invalid) as err:
        raise ConfigEntryError(
            f"Invalid Homeostatic configuration or snapshot: {err}"
        ) from err
    entry.runtime_data = runtime

    @callback
    def handle_notification(event: Event) -> None:
        hass.async_create_task(runtime.async_send_notification(dict(event.data)))

    entry.async_on_unload(
        hass.bus.async_listen(EVENT_NOTIFICATION, handle_notification)
    )
    await async_register_dashboard(hass, runtime)
    entry.async_on_unload(lambda: async_remove_dashboard(hass))
    async_register_services(hass, runtime)
    entry.async_on_unload(lambda: async_remove_services(hass))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(async_at_started(hass, runtime.async_start))
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: HomeostaticConfigEntry
) -> bool:
    """Stop subscriptions and timers when platforms unload successfully."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.async_stop()
    return True


async def async_remove_entry(
    hass: HomeAssistant, entry: HomeostaticConfigEntry
) -> None:
    """Remove this installation's snapshot and outstanding in-app messages."""
    store = Store[dict[str, Any]](hass, STORE_VERSION, f"{DOMAIN}.{entry.entry_id}")
    data = await store.async_load()
    if data is not None:
        if data.get("schema_version") == 2:
            for message in data["delivery"]["messages"].values():
                hass.bus.async_fire(
                    EVENT_NOTIFICATION,
                    {
                        **message,
                        "delivery_id": f"{entry.entry_id}:removed:{message['recipient']}:{message['episode_id']}",
                        "action": "resolve",
                        "resolution": "removed",
                        "silent": True,
                    },
                )
        else:
            for episode_id in data.get("notifications", []):
                persistent_notification.async_dismiss(
                    hass, f"{DOMAIN}_{entry.entry_id}_{episode_id}"
                )
    persistent_notification.async_dismiss(hass, f"{DOMAIN}_{entry.entry_id}_error")
    await store.async_remove()
