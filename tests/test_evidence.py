"""Scenarios for truthful integration explanations across retries and recovery."""

from datetime import timedelta
from typing import Any

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from custom_components.homeostatic.evidence import IntegrationEvidence
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    "state",
    [
        pytest.param(ConfigEntryState.SETUP_ERROR, id="setup-error"),
        pytest.param(ConfigEntryState.SETUP_RETRY, id="setup-retry"),
    ],
)
async def test_failure_retry_reload_and_confirmed_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
    state: ConfigEntryState,
) -> None:
    """An empty current finding does not erase a timestamped earlier failure."""
    source = MockConfigEntry(
        domain="test", title="Receiver", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data.update(
        entities=[], config_entries=[source.entry_id], notifications=False
    )
    config_data["timings"].update(clear_hold=10, retry_hold=0)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{source.entry_id}"
    client = await hass_ws_client(hass)
    source._async_set_state(hass, state, "Connection timed out")
    await hass.async_block_till_done()
    episode = next(iter(runtime.episodes.values()))
    original = runtime.integration_evidence.view(node_id)
    assert original is not None
    failure = original["last_failure"]
    assert isinstance(failure, dict)
    assert failure["message"] == "Connection timed out"
    freezer.tick(timedelta(seconds=2))
    source._async_set_state(hass, ConfigEntryState.SETUP_IN_PROGRESS, None)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.engine is not None
    before = runtime.engine.snapshot()
    await client.send_json({"id": 1, "type": "homeostatic/node", "node_id": node_id})
    detail = (await client.receive_json())["result"]
    assert detail["explanation"]["findings"] == []
    assert detail["readiness"]["answer"] == "unknown"
    assert detail["integration_evidence"]["current"]["reason"] == "setup_in_progress"
    assert detail["integration_evidence"]["last_failure"] == failure
    assert runtime.engine.snapshot() == before
    assert runtime.episodes[episode["episode_id"]]["opened_at"] == episode["opened_at"]
    assert (
        hass.data[DATA_DASHBOARD].value["inventory"]["integration_evidence"][node_id]
        == detail["integration_evidence"]
    )
    detail["integration_evidence"]["last_failure"]["message"] = "changed client copy"
    assert runtime.integration_evidence.view(node_id)["last_failure"] == failure
    source._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert runtime.integration_evidence.view(node_id)["last_failure"] is None
    assert runtime.episodes
    freezer.tick(timedelta(seconds=11))
    await runtime.async_refresh()
    assert runtime.episodes == {}
    assert runtime.readiness == "ready"
    assert runtime.desired_notifications == set()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_disabled_condition_survives_held_unknown_and_unenrollment(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Library stale findings preserve the distinct HA disabled condition."""
    source = MockConfigEntry(
        domain="test", title="Music", disabled_by=ConfigEntryDisabler.USER
    )
    source.add_to_hass(hass)
    config_data.update(
        entities=[], config_entries=[source.entry_id], notifications=False
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{source.entry_id}"
    freezer.tick(timedelta(seconds=31))
    await runtime.async_refresh()
    assert next(iter(runtime.episodes.values()))["reasons"][0]["reason"] == "stale"
    assert runtime.integration_evidence.view(node_id)["current"]["reason"] == "disabled"
    assert runtime.integration_evidence.view(node_id)["last_failure"] is None
    assert runtime.readiness == "unknown"
    hass.config_entries.async_update_entry(
        entry, data={**config_data, "config_entries": []}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.integration_evidence.view(node_id) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param([], id="wrong-shape"),
        pytest.param(
            {
                "entry:a": {
                    "current": {
                        "reason": "loaded",
                        "message": "",
                        "observed_at": "2026-09-25T10:00:00",
                    },
                    "last_failure": None,
                }
            },
            id="naive-time",
        ),
        pytest.param(
            {
                "entry:a": {
                    "current": {
                        "reason": "setup_in_progress",
                        "message": "",
                        "observed_at": "2026-09-25T10:00:00+00:00",
                    },
                    "last_failure": {
                        "reason": "setup_error",
                        "message": "error",
                        "observed_at": "2026-09-25T11:00:00+00:00",
                    },
                }
            },
            id="future-failure",
        ),
    ],
)
def test_invalid_presentation_does_not_become_current_evidence(value: Any) -> None:
    """Corrupt timestamped context cannot invent a valid earlier failure."""
    evidence = IntegrationEvidence()
    with pytest.raises((vol.Invalid, ValueError)):
        evidence.restore(value)
    assert evidence.snapshot() == {}
