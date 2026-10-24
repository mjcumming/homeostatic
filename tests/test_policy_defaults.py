"""Fresh setup and policy lifecycle scenarios through validated settings."""

from copy import deepcopy
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.dashboard import (
    _editable_settings,
    _settings_candidate,
)
from custom_components.homeostatic.policy_defaults import (
    SUPPLIED_POLICY_INTRODUCTIONS,
    initial_settings,
    policy_templates,
)


def test_defaults_are_independent_and_dashboard_only(hass: HomeAssistant) -> None:
    """Supplied records are editable copies and leave delivery unconfigured."""
    data = initial_settings("America/Chicago")
    assert not {"rules", "entities", "config_entries", "policy"} & data.keys()
    settings = Settings.from_data(data)
    assert settings.monitoring_policy_version == 1
    assert not settings.notifications
    assert settings.notification_definitions["methods"] == {}
    assert settings.notification_definitions["timezone"] == "America/Chicago"
    assert settings.supplied_policy_introductions == SUPPLIED_POLICY_INTRODUCTIONS
    assert {"default_devices", "default_important_equipment"} <= set(
        settings.supplied_policy_introductions
    )
    assert {policy.id: policy.enabled for policy in settings.monitoring_policies} == {
        "default_integrations": True,
        "default_entities": True,
        "default_cameras": True,
        "default_locks": True,
        "default_alarm_panels": True,
        "default_safety_sensors": True,
        "default_repairs": True,
        "default_broken_automations": True,
        "default_batteries": True,
        "default_vacuums": True,
        "default_entities_not_provided": True,
    }
    assert {
        policy.id: policy.parameters["duration_seconds"]
        for policy in settings.monitoring_policies
        if policy.check == "availability" and policy.match.get("kind") == ("entity",)
    } == {
        "default_entities": 0,
        "default_cameras": 300,
        "default_locks": 0,
        "default_alarm_panels": 0,
        "default_safety_sensors": 0,
    }
    data["monitoring_policies"][0]["name"] = "Changed"
    assert policy_templates()[0]["name"] == "Integrations"


async def test_fresh_setup_reports_batteries_and_vacuums_without_sending(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Fresh defaults detect both equipment problems without a delivery request."""
    from unittest.mock import AsyncMock, patch

    from pytest_homeassistant_custom_component.common import (
        MockConfigEntry,
        async_capture_events,
    )

    from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
    from tests.test_battery import battery_device
    from tests.test_lifecycle import start_monitor

    level, warning, charging, _ = await battery_device(hass)
    hass.states.async_set(level, "12", {"unit_of_measurement": "%"})
    hass.states.async_set(warning, "off")
    hass.states.async_set(charging, "off")
    hass.states.async_set("vacuum.robot", "error")
    data = initial_settings("UTC")
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    with patch(
        "custom_components.homeostatic.notifications.async_send", new=AsyncMock()
    ) as send:
        runtime = await start_monitor(hass, entry)
        assert {
            runtime.sources[str(episode["anchor"])].monitoring_policy
            for episode in runtime.episodes.values()
        } >= {"default_batteries", "default_vacuums"}
        assert not runtime.settings.notifications
        assert not events
        send.assert_not_awaited()
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_delete_all_defaults_and_restore_one(hass: HomeAssistant) -> None:
    """An empty policy list survives validation; restore adds only selected records."""
    current = initial_settings("UTC")
    current["policy"] = {"obsolete": "ignored"}
    draft = _editable_settings(Settings.from_data(current))
    assert "policy" not in draft
    draft["monitoring_policies"] = []
    saved = await _settings_candidate(hass, current, draft)
    assert Settings.from_data(saved).monitoring_policies == ()
    assert saved["monitoring_policy_version"] == 1
    assert "policy" not in saved
    restored = _editable_settings(Settings.from_data(saved))
    restored["monitoring_policies"] = [policy_templates()[0]]
    result = await _settings_candidate(hass, saved, restored)
    assert [item.id for item in Settings.from_data(result).monitoring_policies] == [
        "default_integrations"
    ]


@pytest.mark.parametrize(
    "change",
    [
        pytest.param(
            {"check": "battery", "parameters": {"threshold": 20}}, id="different-type"
        ),
        pytest.param({"match": {"kind": ["entity"]}}, id="different-availability-type"),
    ],
)
async def test_monitoring_type_cannot_change(
    hass: HomeAssistant, change: dict[str, Any]
) -> None:
    """The server enforces the same fixed monitoring type as the editor."""
    current = initial_settings("UTC")
    draft = deepcopy(_editable_settings(Settings.from_data(current)))
    draft["monitoring_policies"][0].update(change)
    with pytest.raises(ValueError, match="Monitoring type cannot change"):
        await _settings_candidate(hass, current, draft)


async def test_policy_scope_and_name_remain_editable(hass: HomeAssistant) -> None:
    """Changing scope retains the chosen monitoring type and policy identity."""
    current = initial_settings("UTC")
    draft = deepcopy(_editable_settings(Settings.from_data(current)))
    draft["monitoring_policies"][1].update(
        name="Upstairs entities", match={"kind": ["entity"], "area": ["upstairs"]}
    )
    saved = await _settings_candidate(hass, current, draft)
    policy = Settings.from_data(saved).monitoring_policies[1]
    assert policy.name == "Upstairs entities"
    assert policy.match == {"kind": ("entity",), "area": ("upstairs",)}


@pytest.mark.parametrize("version", [None, True, -1, 0, 2, "1"])
def test_unknown_policy_format_is_rejected(version: object) -> None:
    """A malformed model marker cannot silently select a different runtime."""
    with pytest.raises(ValueError, match="monitoring policy version"):
        Settings.from_data({"monitoring_policy_version": version})


async def test_fresh_setup_preview_and_delete(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The real editor previews removal of an active supplied policy finding."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.homeostatic.const import DOMAIN
    from tests.test_lifecycle import start_monitor

    data = initial_settings("UTC")
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    hass.states.async_set("sensor.offline", "unavailable")
    runtime = await start_monitor(hass, entry)
    assert any(
        runtime.sources[str(episode["anchor"])].monitoring_policy == "default_entities"
        for episode in runtime.episodes.values()
    )
    client = await hass_ws_client(hass)
    cloned = next(
        source
        for source in runtime.sources.values()
        if source.monitoring_policy == "default_entities"
        and source.entity_id == "sensor.offline"
    )
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": cloned.node_id}
    )
    assert (await client.receive_json())["success"]
    await client.send_json(
        {"id": 2, "type": "homeostatic/node", "node_id": cloned.node_id}
    )
    details = (await client.receive_json())["result"]
    assert details["source"]["monitoring_source"] == cloned.monitoring_source
    await client.send_json({"id": 3, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    assert len(configuration["monitoring_policy_templates"]) == 11
    draft = configuration["settings"]
    draft["monitoring_policies"] = []
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/preview_settings",
            "revision": configuration["revision"],
            "settings": draft,
        }
    )
    response = await client.receive_json()
    assert response["success"], response
    preview = response["result"]
    assert preview["monitoring"]["watched"] == 0
    assert preview["monitoring"]["ended_issues"]
    assert runtime.episodes
    await client.send_json(
        {
            "id": 5,
            "type": "homeostatic/save_settings",
            "revision": configuration["revision"],
            "settings": draft,
            "preview_token": preview["preview_token"],
        }
    )
    assert (await client.receive_json())["success"]
    assert not entry.runtime_data.episodes
    assert entry.runtime_data.settings.monitoring_policies == ()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_source_battery_conditions_keep_policy_thresholds(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """Source readings retain both policy verdicts when their thresholds differ."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.homeostatic.const import DOMAIN
    from tests.test_battery import battery_device
    from tests.test_lifecycle import start_monitor

    level, warning, charging, _ = await battery_device(hass)
    hass.states.async_set(level, "25", {"unit_of_measurement": "%"})
    hass.states.async_set(warning, "off")
    hass.states.async_set(charging, "off")
    data = initial_settings("UTC")
    data["timings"] = config_data["timings"]
    battery = next(
        item for item in data["monitoring_policies"] if item["check"] == "battery"
    )
    battery["enabled"] = True
    data["monitoring_policies"].append(
        {
            **battery,
            "id": "early",
            "name": "Early warning",
            "parameters": {"threshold": 30},
        }
    )
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    source = next(
        item for item in runtime.candidates.values() if item.kind == "battery"
    )
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/source", "node_id": source.node_id}
    )
    result = (await client.receive_json())["result"]
    assert "battery_condition" not in result
    assert {
        item["policy_id"]: item["condition"]["reason"]
        for item in result["battery_conditions"]
    } == {"default_batteries": "battery_ok", "early": "battery_low"}
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
