"""Disabled integration eligibility through the real monitoring lifecycle."""

import json
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor

SCENARIOS = json.loads(
    (Path(__file__).parent / "fixtures/disabled-integrations.json").read_text()
)


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
async def test_disabled_integration_lifecycle(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    scenario: dict[str, Any],
) -> None:
    """Disablement removes checks, preserves Sources and resumes saved choices."""
    owner = MockConfigEntry(
        domain="test",
        title="Music Assistant",
        state=ConfigEntryState[scenario["state"]],
        disabled_by={True: ConfigEntryDisabler.USER, False: None}[scenario["disabled"]],
    )
    owner.add_to_hass(hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={
            **config_data,
            "monitoring_policies": [
                monitoring_policy("integrations", {"kind": ["integration"]})
            ],
            "notifications": False,
        },
    )
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{owner.entry_id}"
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    assert runtime.candidates[node_id].disabled is scenario["disabled"]
    assert len(runtime.episodes) == scenario["issues"]
    saved_data = dict(entry.data)

    with patch.object(
        hass.config_entries, "async_reload", AsyncMock(return_value=True)
    ):
        assert await hass.config_entries.async_set_disabled_by(owner.entry_id, None)
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    assert len(runtime.episodes) == 1

    with patch.object(
        hass.config_entries, "async_reload", AsyncMock(return_value=True)
    ):
        assert await hass.config_entries.async_set_disabled_by(
            owner.entry_id, ConfigEntryDisabler.USER
        )
    await runtime.async_refresh()
    assert not runtime.episodes
    assert runtime.candidates[node_id].disabled
    assert not runtime.candidates[node_id].watched
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert dict(entry.data) == saved_data

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    assert not runtime.episodes
    assert runtime.candidates[node_id].disabled
    assert dict(entry.data) == saved_data

    with patch.object(
        hass.config_entries, "async_reload", AsyncMock(return_value=True)
    ):
        assert await hass.config_entries.async_set_disabled_by(owner.entry_id, None)
    await runtime.async_refresh()
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    assert len(runtime.episodes) == 1
    assert not runtime.candidates[node_id].disabled
    assert await hass.config_entries.async_unload(entry.entry_id)
