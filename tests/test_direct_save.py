"""Direct Save scenarios for restored policies and guarded persistence."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.policy_defaults import (
    initial_settings,
    policy_templates,
)
from tests.test_lifecycle import start_monitor


async def test_restore_defaults_save_without_simulating_policy(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Restored defaults save directly even when optional simulation is unavailable."""
    data = initial_settings("UTC")
    data["monitoring_policies"] = []
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"] = policy_templates()
    with patch.object(
        type(runtime),
        "preview_policy",
        side_effect=AssertionError("simulation must not block save"),
    ):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["success"]
    assert len(entry.runtime_data.settings.monitoring_policies) == 7
    assert not entry.runtime_data.settings.notifications
    assert not entry.runtime_data.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_direct_save_validates_type_revision_and_rollback(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """One-click Save retains immutability, stale checks and failed-reload recovery."""
    data = initial_settings("UTC")
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = deepcopy(configuration["settings"])
    draft["monitoring_policies"][0]["check"] = "vacuum"
    await client.send_json(
        {
            "id": 2,
            "type": "homeostatic/save_settings",
            "revision": configuration["revision"],
            "settings": draft,
        }
    )
    invalid = await client.receive_json()
    assert invalid["error"]["code"] == "invalid_settings"
    assert "Monitoring type" in invalid["error"]["message"]
    draft = deepcopy(configuration["settings"])
    draft["monitoring_policies"][0]["name"] = "Updated"
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/save_settings",
            "revision": "stale",
            "settings": draft,
        }
    )
    assert (await client.receive_json())["error"]["code"] == "stale_configuration"
    draft["timings"]["settle"] += 1
    with patch.object(
        hass.config_entries, "async_reload", AsyncMock(side_effect=[False, True])
    ):
        await client.send_json(
            {
                "id": 4,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["error"]["code"] == "reload_failed"
    assert not entry.options
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_integration_family_selection_includes_future_connections(
    hass: HomeAssistant,
) -> None:
    """A domain selection covers every matching connection and future additions."""
    from custom_components.homeostatic.config import Settings
    from custom_components.homeostatic.enrollment import evaluate, inventory
    from custom_components.homeostatic.monitoring_runtime import enrollment_rules

    data = initial_settings("UTC")
    data["monitoring_policies"] = [
        {
            **policy_templates()[0],
            "match": {"kind": ["integration"], "integration_domain": ["hue"]},
        }
    ]
    settings = Settings.from_data(data)
    first = MockConfigEntry(domain="hue", title="First bridge")
    first.add_to_hass(hass)
    other = MockConfigEntry(domain="mobile_app", title="Phone")
    other.add_to_hass(hass)
    before = evaluate(
        inventory(hass, settings, {}), enrollment_rules(settings.monitoring_policies)
    )
    assert before[f"entry:{first.entry_id}"].watched
    assert not before[f"entry:{other.entry_id}"].watched
    future = MockConfigEntry(domain="hue", title="Later bridge")
    future.add_to_hass(hass)
    after = evaluate(
        inventory(hass, settings, {}), enrollment_rules(settings.monitoring_policies)
    )
    assert after[f"entry:{first.entry_id}"].watched
    assert after[f"entry:{future.entry_id}"].watched
    assert not after[f"entry:{other.entry_id}"].watched
