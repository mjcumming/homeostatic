"""Exercise the shipped consumer with Home Assistant's automation engine."""

from hashlib import sha256
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.blueprint import BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import yaml as yaml_util
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.homeostatic.const import EVENT_EPISODE, EVENT_NOTIFICATION


@pytest.mark.parametrize(
    "action,loudness,silent,expected_message,critical,expected_url",
    [
        pytest.param(
            "open",
            "notify",
            False,
            "Door open",
            0,
            "/homeostatic/episode/episode",
            id="ordinary",
        ),
        pytest.param(
            "open",
            "urgent",
            False,
            "Door open",
            1,
            "/homeostatic/episode/episode",
            id="urgent",
        ),
        pytest.param(
            "update",
            "urgent",
            True,
            "Door open",
            0,
            "/homeostatic/episode/episode",
            id="silent-update",
        ),
        pytest.param(
            "resolve", "notify", True, "clear_notification", None, None, id="resolution"
        ),
        pytest.param(
            "remind",
            "notify",
            False,
            "Door open",
            0,
            "/homeostatic/episode/episode",
            id="reminder",
        ),
        pytest.param(
            "escalate",
            "urgent",
            False,
            "Door open",
            1,
            "/homeostatic/episode/episode",
            id="escalation",
        ),
        pytest.param(
            "digest",
            "digest",
            False,
            "Door open",
            0,
            "/homeostatic/issues",
            id="digest",
        ),
        pytest.param(
            "summary",
            "notify",
            False,
            "Door open",
            0,
            "/homeostatic/issues",
            id="summary",
        ),
    ],
)
@pytest.mark.parametrize(
    "tag",
    [
        pytest.param("homeostatic_test_episode", id="short-tag"),
        pytest.param("a" * 64, id="64-byte-tag"),
        pytest.param(
            "homeostatic_" + "e" * 26 + "_" + "p" * 36 + "_person:owner", id="long-tag"
        ),
        pytest.param("é" * 33, id="multibyte-tag"),
    ],
)
async def test_companion_consumer(
    hass: HomeAssistant,
    action: str,
    loudness: str,
    silent: bool,
    expected_message: str,
    critical: int | None,
    expected_url: str | None,
    tag: str,
) -> None:
    """The real blueprint routes requests without contacting any device."""
    path = (
        Path(__file__).parents[1]
        / "blueprints/automation/homeostatic/companion_notification.yaml"
    )
    data = await hass.async_add_executor_job(yaml_util.load_yaml, str(path))
    blueprint = Blueprint(data, expected_domain="automation", schema=BLUEPRINT_SCHEMA)
    inputs = BlueprintInputs(
        blueprint,
        {
            "use_blueprint": {
                "path": "homeostatic/companion_notification.yaml",
                "input": {
                    "recipient": "owner",
                    "notify_service": "notify.mobile_app_test",
                },
            }
        },
    )
    inputs.validate()
    automation: dict[str, Any] = {
        **inputs.async_substitute(),
        "id": "homeostatic_blueprint_test",
        "alias": "Homeostatic blueprint test",
    }
    calls = async_mock_service(hass, "notify", "mobile_app_test")
    assert await async_setup_component(hass, "automation", {"automation": [automation]})
    await hass.async_block_till_done()
    hass.bus.async_fire(
        EVENT_NOTIFICATION,
        {
            "schema_version": 1,
            "entry_id": "test",
            "episode_id": "episode",
            "delivery_id": "test:1",
            "tag": tag,
            "action": action,
            "recipient": "owner",
            "channels": ["event"],
            "loudness": loudness,
            "silent": silent,
            "title": "Garage",
            "message": "Door open",
        },
    )
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["message"] == expected_message
    expected_tag = sha256(tag.encode()).hexdigest() if len(tag.encode()) > 64 else tag
    assert calls[0].data["data"]["tag"] == expected_tag
    assert len(calls[0].data["data"]["tag"].encode()) <= 64
    assert calls[0].data["data"].get("url") == expected_url
    assert calls[0].data["data"].get("clickAction") == expected_url
    assert (
        calls[0].data["data"].get("push", {}).get("sound", {}).get("critical")
        == critical
    )


async def test_consumer_ignores_other_channels(hass: HomeAssistant) -> None:
    """A configured channel routes only its own requests through the real blueprint."""
    path = (
        Path(__file__).parents[1]
        / "blueprints/automation/homeostatic/companion_notification.yaml"
    )
    data = await hass.async_add_executor_job(yaml_util.load_yaml, str(path))
    blueprint = Blueprint(data, expected_domain="automation", schema=BLUEPRINT_SCHEMA)
    inputs = BlueprintInputs(
        blueprint,
        {
            "use_blueprint": {
                "path": "homeostatic/companion_notification.yaml",
                "input": {
                    "recipient": "owner",
                    "channel": "phone",
                    "notify_service": "notify.mobile_app_test",
                },
            }
        },
    )
    inputs.validate()
    automation = {
        **inputs.async_substitute(),
        "id": "channel_test",
        "alias": "Channel test",
    }
    calls = async_mock_service(hass, "notify", "mobile_app_test")
    assert await async_setup_component(hass, "automation", {"automation": [automation]})
    await hass.async_block_till_done()
    hass.bus.async_fire(
        EVENT_NOTIFICATION,
        {"schema_version": 1, "recipient": "owner", "channels": ["speaker"]},
    )
    await hass.async_block_till_done()
    assert not calls


async def load_example(
    hass: HomeAssistant, name: str, values: dict[str, Any]
) -> dict[str, Any]:
    """Substitute a shipped example blueprint as an owner would configure it."""
    path = Path(__file__).parents[1] / f"blueprints/automation/homeostatic/{name}"
    data = await hass.async_add_executor_job(yaml_util.load_yaml, str(path))
    blueprint = Blueprint(data, expected_domain="automation", schema=BLUEPRINT_SCHEMA)
    inputs = BlueprintInputs(
        blueprint,
        {"use_blueprint": {"path": f"homeostatic/{name}", "input": values}},
    )
    inputs.validate()
    return {**inputs.async_substitute(), "id": name, "alias": name}


async def test_logbook_records_selected_changes(hass: HomeAssistant) -> None:
    """The logbook example reads the episode fact contract."""
    automation = await load_example(
        hass, "problem_logbook.yaml", {"changes": ["opened", "resolved"]}
    )
    calls = async_mock_service(hass, "logbook", "log")
    assert await async_setup_component(hass, "automation", {"automation": [automation]})
    await hass.async_block_till_done()
    for change, extra in (
        ("opened", {}),
        ("updated", {}),
        ("resolved", {"resolution": "cleared"}),
    ):
        hass.bus.async_fire(
            EVENT_EPISODE,
            {
                "schema_version": 1,
                "change": change,
                "anchor_name": "Hall sensor",
                "status": "fail",
                **extra,
            },
        )
        await hass.async_block_till_done()
    assert [call.data["message"] for call in calls] == [
        "Hall sensor: problem opened (fail)",
        "Hall sensor: problem resolved (cleared)",
    ]
