"""Bounded refresh work, ordered transitions and compact dashboard scenarios."""

import asyncio
from copy import deepcopy
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from tests.policy_helpers import (
    availability_policies,
    bound_identity,
    monitoring_policy,
)
from tests.test_lifecycle import start_monitor


async def test_burst_work_and_rearming(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Sixty independent failures and recoveries need one save per burst."""
    entities = [f"sensor.source_{index}" for index in range(60)]
    for entity in entities:
        hass.states.async_set(entity, "1")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("sensors", {"domain": ["sensor"]})],
    )
    config_data["timings"]["coalesce_count"] = 1000
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    catalog = runtime.inventory_static
    with (
        patch.object(runtime, "_save", wraps=runtime._save) as save,
        patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
    ):
        for entity in entities:
            hass.states.async_set(entity, "unavailable")
        await hass.async_block_till_done()
        assert len(runtime.episodes) == 60
        assert runtime.readiness == "degraded"
        assert save.call_count == 1
        assert discover.call_count == 0
        for entity in entities:
            hass.states.async_set(entity, "2")
        await hass.async_block_till_done()
        assert runtime.readiness == "ready"
        assert not runtime.episodes
        assert save.call_count == 2
        assert discover.call_count == 0
    assert runtime.inventory_static is catalog
    assert len(runtime.query("resolved_history", {})["episodes"]) == 60
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_coalescing_preserves_rapid_refailure(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A rapid failure, unknown, recovery and refailure retain both episodes."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    with patch.object(runtime, "_save", wraps=runtime._save) as save:
        for value in ("unavailable", "unknown", "2", "unavailable"):
            hass.states.async_set("sensor.observed", value)
        await hass.async_block_till_done()
    assert save.call_count == 1
    assert len(runtime.episodes) == 1
    assert runtime.readiness == "degraded"
    ended = runtime.query("resolved_history", {})["episodes"]
    assert len(ended) == 1
    assert ended[0]["resolution"] == "cleared"
    assert ended[0]["episode"]["episode_id"] not in runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_inventory_cache_refreshes_metadata_and_is_detached(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Registry moves and source-name edits replace metadata without losing identity."""
    area = ar.async_get(hass).async_create("Workshop")
    source = er.async_get(hass).async_get_or_create("sensor", "test", "observed")
    hass.states.async_set(source.entity_id, "1", {"friendly_name": "Original"})
    config_data.update(
        monitoring_policies=availability_policies(entities=[f"registry:{source.id}"]),
        notifications=False,
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    catalog = runtime.inventory_static
    await runtime.async_refresh()
    assert runtime.inventory_static is catalog
    er.async_get(hass).async_update_entity(source.entity_id, area_id=area.id)
    await hass.async_block_till_done()
    assert runtime.inventory_static is not catalog
    node_id = f"entity:registry:{source.id}"
    assert runtime.sources[node_id].attributes["area"] == (area.id,)
    hass.states.async_set(source.entity_id, "2", {"friendly_name": "Renamed"})
    await hass.async_block_till_done()
    assert runtime.sources[node_id].name == "Renamed"
    response = runtime.query("inventory", {})
    response["nodes"].clear()
    response["catalog"]["candidates"].clear()
    assert runtime.query("inventory", {})["nodes"]
    assert runtime.query("inventory", {})["catalog"]["candidates"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_noop_inventory_signal_keeps_catalog_revision(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A rediscovery with unchanged sources does not restart catalog browsing."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    catalog = runtime.inventory_static
    revision = dashboard.catalog_revision

    runtime._inventory_dirty = True
    await runtime.async_refresh(reconcile=False)

    assert runtime.inventory_static is catalog
    assert dashboard.catalog_revision == revision
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_location_change_advances_catalog_without_source_rebuild(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A new browsing location updates catalog pages even if sources are unchanged."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    catalog = runtime.inventory_static
    revision = dashboard.catalog_revision

    area = ar.async_get(hass).async_create("Workshop")
    await hass.async_block_till_done()

    assert runtime.inventory_static is catalog
    assert dashboard.catalog_revision > revision
    assert {
        "id": area.id,
        "name": "Workshop",
        "floor_id": None,
    } in dashboard.catalog_sections["areas"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_compact_subscription_baselines_deltas_and_reload(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """Small evidence updates merge only against the matching complete catalog."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe", "compact": True})
    assert (await client.receive_json())["success"]
    initial = (await client.receive_json())["event"]
    assert initial["schema_version"] == 2
    assert initial["inventory_changed"]
    assert initial["inventory"]["catalog"]["candidates"]
    hass.states.async_set("sensor.observed", "unavailable")
    await hass.async_block_till_done()
    update = (await client.receive_json())["event"]
    assert update["catalog_revision"] == initial["catalog_revision"]
    assert not update["inventory_changed"]
    assert "catalog" not in update["inventory"]
    assert "nodes" not in update["inventory"]
    assert "areas" not in update
    assert update["readiness"]["answer"] == "degraded"
    hass.states.async_set(
        "sensor.observed", "unavailable", {"friendly_name": "Renamed"}
    )
    await hass.async_block_till_done()
    replaced = (await client.receive_json())["event"]
    assert replaced["inventory_changed"]
    assert replaced["catalog_revision"] != initial["catalog_revision"]
    assert replaced["inventory"]["nodes"][0]["name"] == "Renamed · observed"
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert not (await client.receive_json())["event"]["available"]
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert not (await client.receive_json())["event"]["available"]
    restored = (await client.receive_json())["event"]
    assert restored["inventory_changed"]
    assert restored["catalog_revision"] > replaced["catalog_revision"]
    assert restored["inventory"]["nodes"]
    assert hass.data[DATA_DASHBOARD].runtime is not runtime
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "state",
    [ConfigEntryState.SETUP_RETRY, ConfigEntryState.SETUP_ERROR],
)
async def test_entry_lifecycle_preserves_evidence_without_catalog_rebuild(
    hass: HomeAssistant, config_data: dict[str, Any], state: ConfigEntryState
) -> None:
    """Failures and recovery remain observable without rediscovering unchanged metadata."""
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data.update(
        notifications=False,
        monitoring_policies=availability_policies(integrations=[source.entry_id]),
    )
    config_data["timings"]["retry_hold"] = 0
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    catalog = runtime.inventory_static
    node_id = bound_identity(
        config_data["monitoring_policies"][0], f"entry:{source.entry_id}"
    )
    with patch.object(
        runtime,
        "_discover",
        side_effect=AssertionError("Lifecycle does not change inventory"),
    ):
        source._async_set_state(hass, state, "Connection failed")
        await hass.async_block_till_done()
        assert len(runtime.episodes) == 1
        assert (
            runtime.integration_evidence.view(node_id)["last_failure"]["message"]
            == "Connection failed"
        )
        source._async_set_state(hass, ConfigEntryState.SETUP_IN_PROGRESS, None)
        await hass.async_block_till_done()
        assert (
            runtime.integration_evidence.view(node_id)["current"]["reason"]
            == "setup_in_progress"
        )
        source._async_set_state(hass, ConfigEntryState.LOADED, None)
        await hass.async_block_till_done()
    assert not runtime.episodes
    assert runtime.integration_evidence.view(node_id)["last_failure"] is None
    assert runtime.inventory_static is catalog
    assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("field", ["data", "options"])
async def test_entry_private_configuration_does_not_invalidate_catalog(
    hass: HomeAssistant, config_data: dict[str, Any], field: str
) -> None:
    """Integration credentials and options are not catalog metadata."""
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    catalog = runtime.inventory_static
    with patch.object(
        runtime,
        "_discover",
        side_effect=AssertionError("Private configuration does not change inventory"),
    ):
        hass.config_entries.async_update_entry(
            source, **{field: {"setting": "updated"}}
        )
        await hass.async_block_till_done()
    assert runtime.inventory_static is catalog
    assert not runtime._inventory_dirty
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_entry_metadata_changes_still_reconcile(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A rename and disablement replace catalog metadata through their real HA events."""
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.SETUP_ERROR
    )
    source.add_to_hass(hass)
    config_data.update(
        notifications=False,
        monitoring_policies=availability_policies(integrations=[source.entry_id]),
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    candidate_id = f"entry:{source.entry_id}"
    assert len(runtime.episodes) == 1
    hass.config_entries.async_update_entry(source, title="Renamed controller")
    await hass.async_block_till_done()
    assert runtime.candidates[candidate_id].name == "Renamed controller"

    async def unload_disabled_source(entry_id: str) -> bool:
        assert entry_id == source.entry_id
        source._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)
        return True

    with patch.object(
        hass.config_entries, "async_reload", side_effect=unload_disabled_source
    ):
        assert await hass.config_entries.async_set_disabled_by(
            source.entry_id, ConfigEntryDisabler.USER
        )
        await hass.async_block_till_done()
    assert runtime.candidates[candidate_id].disabled
    assert not runtime.candidates[candidate_id].watched
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_entry_lifecycle_queued_during_notification_save_is_durable(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A lifecycle event arriving under the save lock is drained without dirtying the catalog."""
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data.update(
        notifications=False,
        monitoring_policies=availability_policies(integrations=[source.entry_id]),
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    changed = deepcopy(config_data)
    changed["notification_definitions"]["profiles"]["immediate"]["name"] = "Renamed"
    drain_pending = runtime._drain_pending

    async def drain_with_entry_failure() -> None:
        source._async_set_state(
            hass, ConfigEntryState.SETUP_ERROR, "Connection failed during save"
        )
        processed = asyncio.Event()
        hass.loop.call_soon(processed.set)
        await processed.wait()
        await drain_pending()

    with (
        patch.object(runtime, "_drain_pending", side_effect=drain_with_entry_failure),
        patch.object(
            runtime,
            "_discover",
            side_effect=AssertionError("Lifecycle does not change inventory"),
        ),
    ):
        await runtime.async_apply_settings(Settings.from_data(changed))
    await hass.async_block_till_done()
    node_id = bound_identity(
        config_data["monitoring_policies"][0], f"entry:{source.entry_id}"
    )
    assert len(runtime.episodes) == 1
    assert (
        runtime.integration_evidence.view(node_id)["last_failure"]["message"]
        == "Connection failed during save"
    )
    assert await runtime.store.async_load() == runtime.snapshot()
    assert not runtime._pending
    assert not runtime._inventory_dirty
    assert not runtime.settings.notifications
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unwatched_owner_lifecycle_keeps_clean_refresh(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Owner state still refreshes runtime context when only its entity is monitored."""
    source = MockConfigEntry(
        domain="test", title="Controller", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "owner_entity", config_entry=source
    )
    hass.states.async_set(entity.entity_id, "1")
    config_data.update(
        notifications=False,
        monitoring_policies=availability_policies(entities=[f"registry:{entity.id}"]),
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert source.entry_id not in runtime._entries
    with (
        patch.object(
            runtime,
            "_discover",
            side_effect=AssertionError("Lifecycle does not change inventory"),
        ),
        patch.object(runtime, "_save", wraps=runtime._save) as save,
    ):
        source._async_set_state(hass, ConfigEntryState.SETUP_RETRY, "Retrying owner")
        await hass.async_block_till_done()
    assert save.call_count == 1
    assert not runtime._inventory_dirty
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)
