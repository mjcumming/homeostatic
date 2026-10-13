"""Direct Save scenarios for restored policies and guarded persistence."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.policy_defaults import (
    initial_settings,
    policy_templates,
)
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize("version", [0, 1])
async def test_restore_defaults_save_without_simulating_policy(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    version: int,
) -> None:
    """Restored defaults save directly even when optional simulation is unavailable."""
    data = initial_settings("UTC")
    data["monitoring_policy_version"] = version
    data["monitoring_policies"] = []
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"] = policy_templates()
    draft["rules"] = configuration["rules"]
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


@pytest.mark.parametrize(
    ("endpoint", "proposal", "option", "expected"),
    [
        pytest.param("save_configuration", {"rules": []}, "rules", [], id="monitoring"),
        pytest.param(
            "save_alerts",
            {"notifications": False, "consumer": None},
            "notifications",
            False,
            id="alerts",
        ),
    ],
)
async def test_legacy_editors_save_without_preview(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    endpoint: str,
    proposal: dict[str, Any],
    option: str,
    expected: Any,
) -> None:
    """Retained editors also apply a validated proposal with one Save request."""
    runtime = await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    current = (await client.receive_json())["result"]
    with patch.object(
        type(runtime), "preview_policy", side_effect=AssertionError("no preview")
    ):
        await client.send_json(
            {
                "id": 2,
                "type": f"homeostatic/{endpoint}",
                "revision": current["revision"],
                **proposal,
            }
        )
        assert (await client.receive_json())["result"] == {"saved": True}
    assert config_entry.options[option] == expected
    assert config_entry.options["timings"] == config_entry.data["timings"]
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()
