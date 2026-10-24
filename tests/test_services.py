"""Response-only public queries and invalid request handling."""

from typing import Any

import pytest
from homeassistant.auth.models import User
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor

NODE = "entity:entity_id:sensor.observed"


async def test_notification_report_rejects_read_only_user(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    hass_read_only_user: User,
) -> None:
    """A known report reference cannot bypass administrator access via HA actions."""
    runtime = await start_monitor(hass, config_entry)
    report = runtime.notification_reports.present(
        {"episodes": [f"issue-{index:036d}" for index in range(8)]}, dt_util.utcnow()
    )
    reference = str(report["details_url"]).rsplit("/", 1)[1]
    before = runtime.notification_reports.snapshot()
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, client_id="http://test.local"
    )
    token = hass.auth.async_create_access_token(refresh)
    client = await hass_ws_client(hass, access_token=token)
    await client.send_json(
        {
            "id": 1,
            "type": "call_service",
            "domain": DOMAIN,
            "service": "notification_report",
            "service_data": {"reference": reference},
            "return_response": True,
        }
    )
    response = await client.receive_json()
    assert response["success"] is False
    assert response["error"] == {
        "code": "home_assistant_error",
        "message": "Unauthorized",
    }
    assert runtime.notification_reports.snapshot() == before
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "action,data,expected_key",
    [
        ("inventory", {}, "episodes"),
        ("explain", {"node_id": NODE}, "findings"),
        ("impact", {"node_id": NODE}, "importance"),
        ("coverage", {}, "never_observed"),
        ("readiness", {}, "answer"),
        ("readiness", {"node_ids": [NODE]}, "answer"),
        ("rollup", {}, "counts"),
        ("rollup", {"node_ids": [NODE]}, "counts"),
    ],
    ids=[
        "inventory",
        "explain",
        "impact",
        "coverage",
        "readiness-default",
        "readiness-explicit",
        "rollup-default",
        "rollup-explicit",
    ],
)
async def test_response_actions(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    action: str,
    data: dict[str, Any],
    expected_key: str,
) -> None:
    """HA exposes structured responses using public library records."""
    hass.states.async_set("sensor.observed", "unavailable")
    await start_monitor(hass, config_entry)
    response = await hass.services.async_call(
        DOMAIN, action, data, blocking=True, return_response=True
    )
    assert expected_key in response
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "action,data",
    [
        ("explain", {"node_id": "missing"}),
        ("impact", {"node_id": "missing"}),
        ("readiness", {"node_ids": ["missing"]}),
        ("rollup", {"node_ids": ["missing"]}),
    ],
)
async def test_unknown_node(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    action: str,
    data: dict[str, Any],
) -> None:
    """Invalid node ids are reported as action validation errors."""
    await start_monitor(hass, config_entry)
    with pytest.raises(ServiceValidationError, match="Unknown Homeostatic node"):
        await hass.services.async_call(
            DOMAIN, action, data, blocking=True, return_response=True
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_empty_readiness(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An explicitly empty request does not report readiness without evidence."""
    await start_monitor(hass, config_entry)
    response = await hass.services.async_call(
        DOMAIN, "readiness", {"node_ids": []}, blocking=True, return_response=True
    )
    assert response == {"answer": "unknown", "nodes": [], "blocked_by": None}
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_query_before_start(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An unloaded engine cannot return a cached all-clear."""
    hass.set_state(CoreState.not_running)
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    assert config_entry.runtime_data.evidence_gaps == 0
    with pytest.raises(HomeAssistantError, match="not ready"):
        await hass.services.async_call(
            DOMAIN, "inventory", {}, blocking=True, return_response=True
        )
    assert await hass.config_entries.async_unload(config_entry.entry_id)
