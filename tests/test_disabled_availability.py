"""Disabled registry entities never create availability expectations."""

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor

SCENARIOS = json.loads(
    (Path(__file__).parent / "fixtures/disabled-availability.json").read_text()
)


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
async def test_disabled_availability_scenario(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
    scenario: dict[str, Any],
) -> None:
    """Disabled sensors stay browsable beyond the stale hold with named policies."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    entity = registry.async_get_or_create(
        "sensor",
        "test",
        "solar_azimuth",
        suggested_object_id="solar_azimuth",
        config_entry=owner,
        disabled_by={
            None: None,
            "integration": er.RegistryEntryDisabler.INTEGRATION,
            "user": er.RegistryEntryDisabler.USER,
        }[scenario["disabled_by"]],
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={
            **config_data,
            "monitoring_policies": [
                monitoring_policy("entities", {"kind": ["entity"]})
            ],
            "notifications": False,
        },
    )
    runtime = await start_monitor(hass, entry)
    watched = [
        source
        for source in runtime.sources.values()
        if source.entity_id == entity.entity_id and source.watched
    ]
    assert len(watched) == int(scenario["disabled_by"] is None)
    freezer.tick(timedelta(minutes=1))
    await runtime.async_refresh()
    assert len(runtime.episodes) == int(scenario["disabled_by"] is None)
    assert f"entity:registry:{entity.id}" in runtime.candidates
    registry.async_update_entity(entity.entity_id, disabled_by=None)
    hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    await runtime.async_refresh()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)
