"""Bounded refresh work, ordered transitions and compact dashboard scenarios."""

from typing import Any
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from tests.test_lifecycle import start_monitor


async def test_burst_work_and_rearming(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Sixty independent failures and recoveries need one save per burst."""
    entities = [f"sensor.source_{index}" for index in range(60)]
    for entity in entities:
        hass.states.async_set(entity, "1")
    config_data.update(
        entities=[],
        notifications=False,
        rules=[{"id": "sensors", "action": "attach", "match": {"domain": "sensor"}}],
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
        assert runtime.readiness == "blocked"
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
    assert runtime.readiness == "blocked"
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
    config_data.update(entities=[f"registry:{source.id}"], notifications=False)
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
    assert update["readiness"]["answer"] == "blocked"
    hass.states.async_set(
        "sensor.observed", "unavailable", {"friendly_name": "Renamed"}
    )
    await hass.async_block_till_done()
    replaced = (await client.receive_json())["event"]
    assert replaced["inventory_changed"]
    assert replaced["catalog_revision"] != initial["catalog_revision"]
    assert replaced["inventory"]["nodes"][0]["name"] == "Renamed"
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
