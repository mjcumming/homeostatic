"""Time zones are resolved before synchronous policy and monitoring work."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.config import Settings, migrate_notification_settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import (
    _editable_settings,
    _settings_candidate,
)
from tests.test_attention import owner_policy
from tests.test_left_open import opening_policy
from tests.test_lifecycle import start_monitor


async def test_saved_zone_is_resolved_for_setup_settings_and_policy_preview(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A stored zone different from HA's remains valid without synchronous loading."""
    await hass.config.async_set_time_zone("UTC")
    config_data["notifications"] = False
    config_data["notification_definitions"]["timezone"] = "America/New_York"
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with patch.object(
        dt_util, "async_get_time_zone", wraps=dt_util.async_get_time_zone
    ) as resolve:
        runtime = await start_monitor(hass, entry)
        assert str(runtime._policy_config().timezone) == "America/New_York"
        assert any(
            call.args == ("America/New_York",) for call in resolve.await_args_list
        )

        current = dict(entry.options or entry.data)
        draft = _editable_settings(runtime.settings)
        candidate = await _settings_candidate(hass, current, draft)
        assert candidate["notification_definitions"]["timezone"] == "America/New_York"
        assert (
            str((await Settings.async_from_data(candidate)).policy_config().timezone)
            == "America/New_York"
        )

        policy = owner_policy()
        policy["timezone"] = "America/Chicago"
        await hass.services.async_call(
            DOMAIN,
            "preview_policy",
            {"policy": policy},
            blocking=True,
            return_response=True,
        )
        assert any(
            call.args == ("America/Chicago",) for call in resolve.await_args_list
        )
        policy["timezone"] = "not/a/zone"
        with pytest.raises(ServiceValidationError):
            await hass.services.async_call(
                DOMAIN,
                "preview_policy",
                {"policy": policy},
                blocking=True,
                return_response=True,
            )

        invalid = deepcopy(draft)
        invalid["notification_definitions"]["timezone"] = "../UTC"
        with pytest.raises(ValueError, match="IANA timezone"):
            await _settings_candidate(hass, current, invalid)
        assert dict(entry.options or entry.data) == current
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_left_open_uses_current_home_assistant_zone(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A changed HA zone applies to monitoring even when the saved zone is unchanged."""
    freezer.move_to(datetime(2026, 10, 15, 22, 30, tzinfo=UTC))
    await hass.config.async_set_time_zone("UTC")
    config_data.update(
        notifications=False, monitoring_policies=[opening_policy(duration_seconds=0)]
    )
    hass.states.async_set("binary_sensor.patio", "on", {"device_class": "door"})
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.episodes
    await hass.config.async_set_time_zone("America/Chicago")
    await runtime.async_refresh()
    assert not runtime.episodes
    assert runtime.settings.notification_definitions["timezone"] == "UTC"
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.config.async_set_time_zone("UTC")


async def test_settings_preview_and_save_resolve_changed_zone(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Settings preview, save and reload retain the chosen zone and other options."""
    config_data["notifications"] = False
    config_data["notification_definitions"]["timezone"] = "America/New_York"
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = deepcopy(configuration["settings"])
    draft["notification_definitions"]["timezone"] = "America/Chicago"
    for request_id, command in ((2, "preview_settings"), (3, "save_settings")):
        await client.send_json(
            {
                "id": request_id,
                "type": f"homeostatic/{command}",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["success"]
    assert entry.options["notification_definitions"]["timezone"] == "America/Chicago"
    assert str(entry.runtime_data._policy_config().timezone) == "America/Chicago"
    assert entry.options["monitoring_policies"] == config_data["monitoring_policies"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_preview_rejects_configuration_changed_during_timezone_resolution(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """An async lookup cannot make a stale settings preview look current."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    started, resume = asyncio.Event(), asyncio.Event()
    original = dt_util.async_get_time_zone

    async def resolve(name: str) -> Any:
        started.set()
        await resume.wait()
        return await original(name)

    with patch.object(dt_util, "async_get_time_zone", side_effect=resolve):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/preview_settings",
                "revision": configuration["revision"],
                "settings": configuration["settings"],
            }
        )
        await started.wait()
        current = dict(entry.options or entry.data)
        hass.config_entries.async_update_entry(
            entry, options={**current, "timings": {**current["timings"], "batch": 7}}
        )
        resume.set()
        response = await client.receive_json()
        assert response["error"]["code"] == "stale_configuration"
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_settings_resolution_rejects_incomplete_definitions() -> None:
    """Zone lookup does not start when notification definitions are absent."""
    with pytest.raises(ValueError, match="complete notification definitions"):
        await Settings.async_from_data({})


def test_notification_migration_leaves_settings_without_definitions() -> None:
    """Older stored settings with no notification definitions stay unchanged."""
    data = {"timings": {}}
    assert migrate_notification_settings(data) is data
