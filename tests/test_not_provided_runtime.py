"""Full policy runtime scenarios use isolated Home Assistant and explicit time."""

from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.policy_defaults import policy_templates
from tests.policy_helpers import immediate_notification, monitoring_policy
from tests.test_lifecycle import start_monitor


async def test_runtime_qualification_state_recovery_and_owner_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A missing provider qualifies, survives reload and clears on a live state."""
    owner = MockConfigEntry(
        domain="test", title="Robot provider", state=ConfigEntryState.LOADED
    )
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "leftover",
        config_entry=owner,
        original_name="Leftover reading",
    )
    hass.states.async_set(entity.entity_id, "unavailable", {"restored": True})
    policy = monitoring_policy(
        "not_provided",
        {"kind": ["entity"]},
        check="entity_not_provided",
        parameters={"duration_seconds": 60},
    )
    config_data.update(monitoring_policies=[policy], notifications=False)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source = next(
        source
        for source in runtime.sources.values()
        if source.kind == "entity_not_provided"
    )
    assert source.monitoring_source == f"entity:registry:{entity.id}"
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"]
        == "entity_not_provided"
    )
    freezer.tick(timedelta(seconds=61))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert any(
        row["anchor"] == source.node_id and row["status"] == "warn"
        for row in runtime.episodes.values()
    )
    assert not runtime.notifications.delivery.messages
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert any(row["anchor"] == source.node_id for row in runtime.episodes.values())
    owner._async_set_state(hass, ConfigEntryState.SETUP_RETRY, None)
    await hass.async_block_till_done()
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"]
        == "provider_not_loaded"
    )
    owner._async_set_state(hass, ConfigEntryState.LOADED, None)
    hass.states.async_set(entity.entity_id, "unknown")
    await hass.async_block_till_done()
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"] == "entity_provided"
    )
    assert not runtime.episodes
    assert er.async_get(hass).async_get(entity.entity_id) is not None
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_parser_and_supplied_template() -> None:
    """Saved policy parsing and the supplied template retain their actual scope."""
    template = next(
        row for row in policy_templates() if row["check"] == "entity_not_provided"
    )
    [parsed] = parse_policies([template])
    assert parsed.enabled
    assert parsed.match == {"kind": ("entity",)}
    assert parsed.parameters == {"duration_seconds": 86400}
    assert parsed.notifications == ({"id": "default", "profile": "morning"},)
    saved = parsed.data()
    saved["included_sources"] = ["entity:registry:explicit"]
    saved["excluded_sources"] = ["entity:registry:ignored"]
    [edited] = parse_policies([saved])
    assert edited.included_sources == ("entity:registry:explicit",)
    assert edited.excluded_sources == ("entity:registry:ignored",)


async def test_warning_requests_notification_but_unloaded_owner_does_not(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A qualified warning requests delivery; later unknown evidence stays quiet."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "notification", config_entry=owner
    )
    hass.states.async_set(entity.entity_id, "unavailable", {"restored": True})
    config_data["monitoring_policies"] = [
        monitoring_policy(
            "missing",
            {"kind": ["entity"]},
            check="entity_not_provided",
            parameters={"duration_seconds": 0},
            notifications=immediate_notification(),
        )
    ]
    requests = []
    cancel = hass.bus.async_listen(
        EVENT_NOTIFICATION, lambda event: requests.append(event.data)
    )
    with patch(
        "custom_components.homeostatic.notifications.async_send", new_callable=AsyncMock
    ) as transport:
        entry = MockConfigEntry(domain=DOMAIN, data=config_data)
        runtime = await start_monitor(hass, entry)
        assert len(requests) == 1
        assert requests[0]["action"] == "open"
        assert "not providing" in requests[0]["message"]
        assert transport.await_count == 1
        owner._async_set_state(hass, ConfigEntryState.SETUP_RETRY, None)
        await hass.async_block_till_done()
        freezer.tick(timedelta(seconds=31))
        async_fire_time_changed(hass, dt_util.utcnow())
        await hass.async_block_till_done()
        assert len(requests) == 1
        assert transport.await_count == 1
        assert runtime.episodes
        assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()
