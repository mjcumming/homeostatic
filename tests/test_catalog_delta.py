"""One-step catalog deltas and content-based catalog revisions (ADR 0095)."""

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import (
    CATALOG_PAGE_ROWS,
    DATA_DASHBOARD,
    catalog_changes,
)
from tests.test_lifecycle import start_monitor

SECTIONS = (
    "nodes",
    "candidates",
    "targets",
    "enrollment_changes",
    "areas",
    "devices",
    "floors",
)
KEYS = {
    "nodes": "node_id",
    "candidates": "node_id",
    "areas": "id",
    "devices": "id",
    "floors": "id",
}


def _identity(section: str, row: Any) -> Any:
    key = KEYS.get(section)
    return row[key] if key else row


def _by_key(section: str, rows: list[Any]) -> Any:
    if section == "enrollment_changes":
        return rows
    return {_identity(section, row): row for row in rows}


def _apply(section: str, rows: list[Any], change: dict[str, Any]) -> list[Any]:
    if section == "enrollment_changes":
        return [*rows, *change.get("append", [])]
    index = {_identity(section, row): row for row in rows}
    for removed in change.get("remove", []):
        index.pop(removed, None)
    for row in change.get("upsert", []):
        index[_identity(section, row)] = row
    return list(index.values())


def _rows(delta: dict[str, Any]) -> int:
    return sum(
        len(items) for change in delta["sections"].values() for items in change.values()
    )


async def _complete_catalog(
    client: Any, revision: int, counts: dict[str, int], request_id: int
) -> tuple[dict[str, list[Any]], int]:
    sections: dict[str, list[Any]] = {}
    for section in SECTIONS:
        rows: list[Any] = []
        for offset in range(0, counts[section], 200):
            await client.send_json(
                {
                    "id": request_id,
                    "type": "homeostatic/catalog",
                    "revision": revision,
                    "section": section,
                    "offset": offset,
                }
            )
            result = (await client.receive_json())["result"]
            assert result["revision"] == revision
            rows.extend(result["items"])
            request_id += 1
        sections[section] = rows
    return sections, request_id


async def _next_revision(client: Any, revision: int) -> dict[str, Any]:
    while True:
        event = (await client.receive_json())["event"]
        if event["catalog_revision"] != revision:
            return event


async def test_small_catalog_change_travels_as_a_one_step_delta(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """A rename reaches a loaded client as the changed rows, not 63 pages."""
    config_data["notifications"] = False
    for index in range(3):
        hass.states.async_set(f"sensor.candidate_{index}", "42")
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/subscribe", "paged": True, "panel": True}
    )
    assert (await client.receive_json())["success"]
    summary = (await client.receive_json())["event"]
    assert "catalog_delta" not in summary
    revision = summary["catalog_revision"]
    loaded, request_id = await _complete_catalog(
        client, revision, summary["catalog_sections"], 2
    )

    hass.states.async_set("sensor.observed", "1", {"friendly_name": "Renamed"})
    await hass.async_block_till_done()
    event = await _next_revision(client, revision)
    assert event["catalog_revision"] == revision + 1
    delta = event["catalog_delta"]
    assert delta["from_revision"] == revision
    assert 0 < _rows(delta) <= CATALOG_PAGE_ROWS
    assert any("Renamed" in row["name"] for row in delta["sections"]["nodes"]["upsert"])
    patched = {
        section: _apply(section, loaded[section], delta["sections"].get(section, {}))
        for section in SECTIONS
    }
    assert {section: len(rows) for section, rows in patched.items()} == event[
        "catalog_sections"
    ]
    fresh, request_id = await _complete_catalog(
        client, revision + 1, event["catalog_sections"], request_id
    )
    for section in SECTIONS:
        assert _by_key(section, patched[section]) == _by_key(section, fresh[section])

    hass.states.async_set("sensor.observed", "2", {"friendly_name": "Renamed"})
    await hass.async_block_till_done()
    evidence = (await client.receive_json())["event"]
    assert evidence["catalog_revision"] == revision + 1
    assert "catalog_delta" not in evidence

    compact = await hass_ws_client(hass)
    await compact.send_json({"id": 1, "type": "homeostatic/subscribe", "compact": True})
    assert (await compact.receive_json())["success"]
    baseline = (await compact.receive_json())["event"]
    assert baseline["schema_version"] == 2
    assert "catalog_delta" not in baseline
    await compact.close()
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_equal_content_keeps_the_catalog_revision(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Republishing an equal static inventory invalidates no client catalog."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    dashboard = hass.data[DATA_DASHBOARD]
    revision = dashboard.catalog_revision
    sections = dashboard.catalog_sections

    runtime.inventory_static = deepcopy(runtime.inventory_static)
    dashboard.publish()

    assert dashboard.catalog_revision == revision
    assert dashboard.catalog_delta is None
    assert dashboard.catalog_sections == sections
    assert "catalog_delta" not in dashboard.summary
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_a_change_larger_than_one_page_sends_no_delta(
    hass: HomeAssistant, config_data: dict[str, Any], hass_ws_client: WebSocketGenerator
) -> None:
    """Clients reload the pages when more than one page of rows changed."""
    config_data["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/subscribe", "paged": True})
    assert (await client.receive_json())["success"]
    revision = (await client.receive_json())["event"]["catalog_revision"]

    for index in range(CATALOG_PAGE_ROWS + 50):
        hass.states.async_set(f"sensor.arrival_{index}", "42")
    await hass.async_block_till_done()
    event = await _next_revision(client, revision)

    assert event["catalog_revision"] > revision
    assert "catalog_delta" not in event
    assert event["catalog_sections"]["candidates"] >= CATALOG_PAGE_ROWS + 50
    await client.close()
    assert await hass.config_entries.async_unload(entry.entry_id)


def test_catalog_changes_describe_rows_by_identity() -> None:
    """Keyed rows, target values and appended records each have one shape."""
    previous = {
        "nodes": [{"node_id": "a", "name": "A"}, {"node_id": "b", "name": "B"}],
        "targets": ["a", "b"],
        "areas": [{"id": "kitchen", "name": "Kitchen"}],
        "enrollment_changes": [{"batch": "1", "node_id": "a"}],
    }
    assert catalog_changes(previous, deepcopy(previous)) == {}
    current = {
        "nodes": [{"node_id": "a", "name": "Renamed"}, {"node_id": "c", "name": "C"}],
        "targets": ["a", "c"],
        "areas": [{"id": "kitchen", "name": "Kitchen"}],
        "enrollment_changes": [
            {"batch": "1", "node_id": "a"},
            {"batch": "2", "node_id": "c"},
        ],
    }
    assert catalog_changes(previous, current) == {
        "nodes": {
            "upsert": [
                {"node_id": "a", "name": "Renamed"},
                {"node_id": "c", "name": "C"},
            ],
            "remove": ["b"],
        },
        "targets": {"upsert": ["c"], "remove": ["b"]},
        "enrollment_changes": {"append": [{"batch": "2", "node_id": "c"}]},
    }
    rewritten = {**current, "enrollment_changes": [{"batch": "9", "node_id": "z"}]}
    assert catalog_changes(previous, rewritten) is None
