"""Function capabilities, reviewed automation candidates and configuration previews."""

from copy import deepcopy
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.homeostatic.config import Settings, data_from_input
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.function_model import preview
from custom_components.homeostatic.rules import DEFAULT_RULES
from tests.test_lifecycle import start_monitor


def function(identity: str = "lighting", **fields: Any) -> dict[str, Any]:
    """Build a small function declaration with a stable name and identity."""
    return {"id": identity, "name": identity.replace("_", " ").title(), **fields}


@pytest.mark.parametrize(
    "functions",
    [
        [function(requires=["situation:door"])],
        [function(requires=["device:all_hardware"])],
        [function(requires=["function:lighting"])],
        [
            function("a", requires=["function:b"]),
            function("b", requires=["function:a"]),
        ],
        [
            function(
                accept=["entity:entity_id:sensor.a"],
                reject=["entity:entity_id:sensor.a"],
            )
        ],
        [
            function(
                entities=["entity_id:sensor.a"], reject=["entity:entity_id:sensor.a"]
            )
        ],
        [function(accept=["function:other"])],
        [function(automations=["entity_id:sensor.a"])],
        [function(requires="external:network")],
        [function(requires=[42])],
        [function(requires=["external:"])],
        [function(), function()],
    ],
    ids=[
        "situation-edge",
        "unsupported-device",
        "self-cycle",
        "cycle",
        "conflicting-decision",
        "rejected-requirement",
        "non-entity-candidate",
        "non-automation",
        "not-list",
        "not-string",
        "empty-id",
        "duplicate",
    ],
)
def test_invalid_function_graph(functions: list[dict[str, Any]]) -> None:
    """Invalid requirements are rejected before a running model is touched."""
    with pytest.raises(ValueError):
        Settings.from_data({"functions": functions})


@pytest.mark.parametrize(
    "value", [None, {}, [42], [{"id": "host", "name": "Host", "probe": "ping"}]]
)
def test_external_declarations_reject_invented_checks(value: Any) -> None:
    """External declarations do not imply an unsupported evidence producer."""
    with pytest.raises(ValueError):
        Settings.from_data({"external_capabilities": value})


@pytest.mark.parametrize(
    "row",
    [
        function(requires=["bad:id"]),
        function(automations=["sensor.a"]),
        function(requires={"entity": "sensor.a"}),
        function(accept=[42]),
    ],
)
def test_invalid_form_references(hass: HomeAssistant, row: dict[str, Any]) -> None:
    """Malformed or wrong-domain references stay on the configuration form."""
    with pytest.raises((ValueError, vol.Invalid)):
        data_from_input(hass, {"functions": [row]})


async def test_full_function_graph(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Function dependencies propagate readiness and importance through the library."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    source = er.async_get(hass).async_get_or_create(
        "light", "test", "light", config_entry=owner
    )
    hass.states.async_set(source.entity_id, "off")
    data = data_from_input(
        hass,
        {
            "rules": DEFAULT_RULES,
            "functions": [
                function("room", requires=["function:lighting"], importance="critical"),
                function(requires=[source.entity_id, f"entry:{owner.entry_id}"]),
            ],
        },
    )
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "ready"
    assert runtime.sources["function:lighting"].requirements == (
        f"entity:registry:{source.id}",
        f"entry:{owner.entry_id}",
    )
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "controller stopped")
    await hass.async_block_till_done()
    result = runtime.query("functions", {})["functions"]
    assert result[0]["readiness"]["answer"] == "blocked"
    assert result[0]["requirements"][0]["monitoring"] == "composite"
    assert result[1]["requirements"][0]["effective_importance"] == "critical"
    assert result[1]["requirements"][0]["affected_functions"] == [
        "function:lighting",
        "function:room",
    ]
    assert hass.states.get("sensor.homeostatic_room").state == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_excluded_owned_requirement_stays_unknown(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An excluded entity must not look ready through its healthy owning entry."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "excluded", config_entry=owner
    )
    hass.states.async_set(entity.entity_id, "1")
    reference = f"entity:registry:{entity.id}"
    config_data.update(
        entities=[],
        notifications=False,
        rules=[
            *DEFAULT_RULES,
            {
                "id": "exclude",
                "action": "exclude",
                "match": {"entity": f"registry:{entity.id}"},
            },
        ],
        functions=[function(requires=[reference])],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "unknown"
    assert runtime.sources[reference].node(runtime.settings).depends_on == ()
    report = runtime.query("functions", {})["functions"][0]["requirements"][0]
    assert report["monitoring"] == "excluded"
    assert report["present"] is True
    assert report["excluded_by"] == ["exclude"]
    assert runtime.evidence_gaps == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_external_missing_and_empty_requirements(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Declared external, missing, and draft capabilities are explicit unknowns."""
    config_data.update(
        entities=[],
        notifications=False,
        rules=[],
        external_capabilities=[
            {"id": "network", "name": "Backyard network", "importance": "high"}
        ],
        functions=[
            function(
                "music",
                requires=[
                    "external:network",
                    "external:missing",
                    "function:missing",
                    "entry:missing",
                    "entity:registry:missing",
                ],
            ),
            function("draft"),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "unknown"
    result = runtime.query("functions", {})["functions"]
    assert [row["present"] for row in result[0]["requirements"]] == [
        True,
        False,
        False,
        False,
        False,
    ]
    assert {row["monitoring"] for row in result[0]["requirements"]} == {"unwatched"}
    assert result[1]["readiness"]["answer"] == "unknown"
    assert runtime.evidence_gaps == 6
    assert not runtime.episodes
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.readiness == "unknown"
    assert entry.runtime_data.available
    assert await hass.config_entries.async_unload(entry.entry_id)


async def setup_automation(
    hass: HomeAssistant, target: dict[str, Any] | None = None
) -> None:
    """Load a real automation while leaving its trigger inactive."""
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "id": "room",
                    "alias": "Room automation",
                    "triggers": [
                        {
                            "trigger": "state",
                            "entity_id": "binary_sensor.motion",
                            "to": "on",
                        }
                    ],
                    "conditions": [
                        {
                            "condition": "state",
                            "entity_id": "input_boolean.optional",
                            "state": "on",
                        }
                    ],
                    "actions": [
                        {
                            "action": "light.turn_on",
                            "target": target or {"entity_id": "light.room"},
                        }
                    ],
                }
            ]
        },
    )
    await hass.async_block_till_done()


async def test_scoped_automation_candidates_and_persisted_decisions(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Only confirmed candidates become edges; rejection survives reload and rename."""
    entity = er.async_get(hass).async_get_or_create(
        "light", "test", "room", suggested_object_id="room"
    )
    hass.states.async_set(entity.entity_id, "off")
    calls = async_mock_service(hass, "light", "turn_on")
    await setup_automation(hass)
    data = data_from_input(
        hass,
        {
            "rules": DEFAULT_RULES,
            "functions": [
                function(
                    automations=["automation.room_automation"],
                    accept=[entity.entity_id],
                    reject=["input_boolean.optional"],
                ),
                function("independent"),
            ],
        },
    )
    data["timings"] = config_data["timings"]
    entry = MockConfigEntry(domain=DOMAIN, data=data)
    runtime = await start_monitor(hass, entry)
    result = runtime.query("functions", {})["functions"]
    candidates = {item["node_id"]: item for item in result[0]["candidates"]}
    assert candidates[f"entity:registry:{entity.id}"]["decision"] == "accepted"
    assert candidates[f"entity:registry:{entity.id}"]["currently_suggested"] is True
    assert (
        candidates["entity:entity_id:input_boolean.optional"]["decision"] == "rejected"
    )
    assert candidates["entity:entity_id:binary_sensor.motion"]["active"] is False
    assert result[1]["candidates"] == []
    assert runtime.sources["function:lighting"].requirements == (
        f"entity:registry:{entity.id}",
    )
    assert result[0]["requirements"][0]["provenance"] == "owner_confirmed_candidate"
    assert not result[0]["candidate_discovery_complete"]
    er.async_get(hass).async_update_entity(
        entity.entity_id, new_entity_id="light.renamed"
    )
    hass.states.async_remove(entity.entity_id)
    hass.states.async_set("light.renamed", "off")
    await hass.async_block_till_done()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert restored.sources["function:lighting"].requirements == (
        f"entity:registry:{entity.id}",
    )
    decisions = {
        item["node_id"]: item
        for item in restored.query("functions", {})["functions"][0]["candidates"]
    }
    assert decisions[f"entity:registry:{entity.id}"]["decision"] == "accepted"
    assert (
        decisions["entity:entity_id:input_boolean.optional"]["decision"] == "rejected"
    )
    assert calls == []
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("target_type", ["device", "area", "floor", "label"])
async def test_registry_targets_remain_suggestions(
    hass: HomeAssistant, config_data: dict[str, Any], target_type: str
) -> None:
    """Group targets offer current members without silently requiring the whole group."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    floor = fr.async_get(hass).async_create("Ground")
    area = ar.async_get(hass).async_create("Room")
    ar.async_get(hass).async_update(
        area.id, floor_id=floor.floor_id, labels={"lighting"}
    )
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "room")}
    )
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    entity = er.async_get(hass).async_get_or_create(
        "light", "test", "room", config_entry=owner, device_id=device.id
    )
    identities = {
        "device": device.id,
        "area": area.id,
        "floor": floor.floor_id,
        "label": "lighting",
    }
    await setup_automation(hass, {f"{target_type}_id": identities[target_type]})
    config_data.update(
        entities=[],
        notifications=False,
        functions=[function(automations=["entity_id:automation.room_automation"])],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    result = runtime.query("functions", {})["functions"][0]
    item = next(
        item
        for item in result["candidates"]
        if item["node_id"] == f"entity:registry:{entity.id}"
    )
    assert item["provenance"][0]["reason"] == f"{target_type}_target"
    assert not item["active"]
    assert runtime.sources["function:lighting"].requirements == ()
    assert result["readiness"]["answer"] == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_missing_automation_preserves_confirmation(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Removing an automation cannot silently remove a previously required capability."""
    config_data.update(
        entities=[],
        notifications=False,
        functions=[
            function(
                automations=["registry:missing"],
                accept=["entity:entity_id:light.required"],
                reject=["entity:registry:missing"],
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    result = runtime.query("functions", {})["functions"][0]
    assert result["automation_sources"] == [
        {"reference": "registry:missing", "present": False}
    ]
    assert {item["currently_suggested"] for item in result["candidates"]} == {False}
    assert runtime.sources["function:lighting"].requirements == (
        "entity:entity_id:light.required",
    )
    assert result["readiness"]["answer"] == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_preview_functions_is_read_only(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Preview exposes changed edges and coverage without changing live state."""
    hass.states.async_set("sensor.observed", "unavailable")
    config_data.update(
        functions=[function(requires=["entity:entity_id:sensor.observed"])]
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    before = deepcopy(runtime.snapshot())
    proposed = {
        "functions": [function(requires=["external:network"])],
        "external_capabilities": [{"id": "network", "name": "Network"}],
        "rules": [],
    }
    result = await hass.services.async_call(
        DOMAIN, "preview_functions", proposed, blocking=True, return_response=True
    )
    assert result["functions"][0]["readiness"]["answer"] == "unknown"
    assert result["edges_added"] == [
        {"from": "function:lighting", "to": "external:network"}
    ]
    assert result["edges_removed"] == [
        {"from": "function:lighting", "to": "entity:entity_id:sensor.observed"}
    ]
    assert result["preview_kind"] == "current_evidence_without_history"
    assert runtime.snapshot() == before
    with pytest.raises(ServiceValidationError, match="cycle"):
        await hass.services.async_call(
            DOMAIN,
            "preview_functions",
            {
                "functions": [
                    function("a", requires=["function:b"]),
                    function("b", requires=["function:a"]),
                ]
            },
            blocking=True,
            return_response=True,
        )
    assert runtime.snapshot() == before
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_native_function_preview_and_cycle_error(hass: HomeAssistant) -> None:
    """Native previews explain gaps and graph errors before creating an entry."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {
            "functions": [function(requires=["external:network"])],
            "external_capabilities": [{"id": "network", "name": "Network"}],
            "preview": True,
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert "Lighting: unknown" in result["description_placeholders"]["preview"]
    assert "external:network" in result["description_placeholders"]["preview"]
    assert not hass.config_entries.async_entries(DOMAIN)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"functions": [function(requires=["function:lighting"])]}
    )
    assert result["errors"] == {"base": "invalid_config"}
    assert "Lighting" in result["description_placeholders"]["error_detail"]
    assert not hass.config_entries.async_entries(DOMAIN)


async def test_reject_own_integration_requirement(hass: HomeAssistant) -> None:
    """A function cannot use its monitor as health evidence."""
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)
    with pytest.raises(vol.Invalid, match="itself"):
        data_from_input(
            hass, {"functions": [function(requires=[f"entry:{entry.entry_id}"])]}
        )


async def test_unmatched_entry_preview(hass: HomeAssistant) -> None:
    """Present but unmatched integration requirements remain unwatched."""
    entry = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    entry.add_to_hass(hass)
    settings = Settings.from_data(
        {"rules": [], "functions": [function(requires=[f"entry:{entry.entry_id}"])]}
    )
    result = preview(hass, settings, {})
    assert result["functions"][0]["requirements"][0]["present"] is True
    assert result["functions"][0]["requirements"][0]["monitoring"] == "unwatched"
    assert result["functions"][0]["readiness"]["answer"] == "unknown"


@pytest.mark.parametrize(
    "state,reauth,answer",
    [
        pytest.param(ConfigEntryState.LOADED, False, "ready", id="loaded"),
        pytest.param(ConfigEntryState.SETUP_ERROR, False, "blocked", id="setup-failed"),
        pytest.param(ConfigEntryState.LOADED, True, "blocked", id="reauth"),
    ],
)
async def test_preview_observes_integration_state(
    hass: HomeAssistant, state: ConfigEntryState, reauth: bool, answer: str
) -> None:
    """Function previews include actual owning-entry and authentication evidence."""
    owner = MockConfigEntry(domain="test", state=state)
    owner.add_to_hass(hass)
    flows = [{"context": {"source": "reauth", "entry_id": owner.entry_id}}] * int(
        reauth
    )
    settings = Settings.from_data(
        {
            "rules": DEFAULT_RULES,
            "functions": [function(requires=[f"entry:{owner.entry_id}"])],
        }
    )
    with patch.object(hass.config_entries.flow, "async_progress", return_value=flows):
        result = preview(hass, settings, {})
    assert result["functions"][0]["readiness"]["answer"] == answer
    assert result["functions"][0]["requirements"][0]["monitoring"] == "watched"


async def test_stored_self_requirement_is_visible_error(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A forged stored requirement cannot silently omit the monitor from its graph."""
    config_data.update(functions=[function(requires=["entry:monitor"])])
    entry = MockConfigEntry(domain=DOMAIN, entry_id="monitor", data=config_data)
    runtime = await start_monitor(hass, entry)
    assert not runtime.available
    assert "cannot be a function requirement" in runtime.error
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_own_health_suggestion_is_filtered(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Reading a monitor sensor in an automation does not suggest circular evidence."""
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "own", suggested_object_id="own"
    )
    await setup_automation(hass, {"entity_id": "sensor.own"})
    config_data.update(
        notifications=False,
        functions=[
            function(
                automations=["entity_id:automation.room_automation"],
                requires=["entity:entity_id:binary_sensor.motion"],
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    candidates = runtime.query("functions", {})["functions"][0]["candidates"]
    assert len(candidates) == 2
    assert {item["decision"] for item in candidates} == {"required", "suggested"}
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_options_cycle_keeps_live_configuration(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Rejecting a cyclic options edit preserves monitoring and stored decisions."""
    config_data.update(
        functions=[function(requires=["entity:entity_id:sensor.observed"])]
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    before = deepcopy(runtime.snapshot())
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "functions": [
                function("a", requires=["function:b"]),
                function("b", requires=["function:a"]),
            ],
            "notifications": False,
        },
    )
    assert result["errors"] == {"base": "invalid_config"}
    assert "cycle" in result["description_placeholders"]["error_detail"]
    assert not entry.options
    assert runtime.snapshot() == before
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_form_retains_missing_automation_identity(hass: HomeAssistant) -> None:
    """Missing registry-backed automation identities remain editable after removal."""
    data = data_from_input(
        hass,
        {
            "functions": [
                function(
                    automations=["registry:missing"], reject=["registry:missing_target"]
                )
            ]
        },
    )
    settings = Settings.from_data(data)
    assert settings.functions[0].automations == ("registry:missing",)
    assert settings.functions[0].reject == ("entity:registry:missing_target",)
