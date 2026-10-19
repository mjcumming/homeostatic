"""Provider policies ignore value churn while preserving relevant state changes."""

from typing import Any
from unittest.mock import Mock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.const import DOMAIN, EVENT_EPISODE
from custom_components.homeostatic.entity_not_provided import observe
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


def provider_policy() -> dict[str, Any]:
    """Watch every eligible registration with an immediate qualification boundary."""
    return monitoring_policy(
        "providers",
        {"kind": ["entity"]},
        check="entity_not_provided",
        parameters={"duration_seconds": 0},
    )


@pytest.fixture
def provider(hass: HomeAssistant) -> MockConfigEntry:
    """Supply a real registry owner whose lifecycle the runtime can watch."""
    owner = MockConfigEntry(
        domain="test", title="Test provider", state=ConfigEntryState.LOADED
    )
    owner.add_to_hass(hass)
    return owner


async def test_broad_provider_policy_does_no_work_for_ordinary_value_churn(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    provider: MockConfigEntry,
) -> None:
    """Broad provider and availability scopes leave normal sensor traffic idle."""
    entities = [
        er.async_get(hass).async_get_or_create(
            "sensor", "test", f"reading_{index}", config_entry=provider
        )
        for index in range(12)
    ]
    for entity in entities:
        hass.states.async_set(entity.entity_id, "1", {"sequence": 0})
    config_data.update(
        notifications=False,
        monitoring_policies=[
            provider_policy(),
            monitoring_policy("availability", {"kind": ["entity"]}),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    engine, policy = runtime.engine, runtime.policy
    assert engine is not None
    assert policy is not None
    assert sum(
        source.kind == "entity_not_provided" for source in runtime.sources.values()
    ) == len(entities)
    with (
        patch.object(runtime, "_evaluate", wraps=runtime._evaluate) as evaluate,
        patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
        patch.object(runtime, "_save", wraps=runtime._save) as save,
        patch.object(
            type(engine),
            "ingest_many",
            autospec=True,
            side_effect=type(engine).ingest_many,
        ) as ingest,
        patch.object(
            type(engine), "advance", autospec=True, side_effect=type(engine).advance
        ) as advance,
        patch.object(
            type(policy), "advance", autospec=True, side_effect=type(policy).advance
        ) as attention,
        patch("custom_components.homeostatic.runtime.async_dispatcher_send") as publish,
    ):
        for sequence in (1, 2):
            for entity in entities:
                hass.states.async_set(
                    entity.entity_id, str(sequence + 1), {"sequence": sequence}
                )
            await hass.async_block_till_done()
        # Also exercise attribute-only reports, which fire state_changed in HA.
        for entity in entities:
            hass.states.async_set(entity.entity_id, "3", {"sequence": 3})
        await hass.async_block_till_done()
        for operation in (
            evaluate,
            discover,
            save,
            ingest,
            advance,
            attention,
            publish,
        ):
            operation.assert_not_called()
        assert not runtime._pending
        assert not runtime._save_pending
        assert not runtime.episodes
    with patch.object(runtime, "_discover", wraps=runtime._discover) as discover:
        renamed = entities[0]
        hass.states.async_set(
            renamed.entity_id, "3", {"sequence": 3, "friendly_name": "Renamed reading"}
        )
        await hass.async_block_till_done()
        discover.assert_called_once()
        canonical = f"entity:registry:{renamed.id}"
        assert runtime.candidates[canonical].name == "Renamed reading"
        assert (
            next(
                source.name
                for source in runtime.sources.values()
                if source.kind == "entity_not_provided"
                and source.monitoring_source == canonical
            )
            == "Renamed reading"
        )
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("missing", ["absent", "restored"])
async def test_provider_transitions_keep_availability_and_owner_evidence_separate(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    provider: MockConfigEntry,
    missing: str,
) -> None:
    """Missing providers recover on any live state; loaded owners remain required."""
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "provider_transition", config_entry=provider
    )
    hass.states.async_set(entity.entity_id, "42")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            provider_policy(),
            monitoring_policy("availability", {"kind": ["entity"]}),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source = next(
        source
        for source in runtime.sources.values()
        if source.kind == "entity_not_provided"
    )
    if missing == "absent":
        hass.states.async_remove(entity.entity_id)
    else:
        hass.states.async_set(entity.entity_id, "unavailable", {"restored": True})
    await hass.async_block_till_done()
    assert {row["anchor"] for row in runtime.episodes.values()} == {source.node_id}
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"]
        == "entity_not_provided"
    )

    provider._async_set_state(hass, ConfigEntryState.SETUP_RETRY, None)
    await hass.async_block_till_done()
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"]
        == "provider_not_loaded"
    )
    assert {row["anchor"] for row in runtime.episodes.values()} == {source.node_id}
    provider._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"]
        == "entity_not_provided"
    )

    hass.states.async_set(entity.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert (
        runtime.entity_status(source.node_id)["current"]["reason"] == "entity_provided"
    )
    assert {
        runtime.sources[row["anchor"]].check_id for row in runtime.episodes.values()
    } == {"availability"}
    # All live values remain provided, even as their availability meaning changes.
    with patch(
        "custom_components.homeostatic.runtime.not_provided_observation", wraps=observe
    ) as observe_provider:
        for state in ("unknown", "off", "43"):
            hass.states.async_set(entity.entity_id, state)
            await hass.async_block_till_done()
        observe_provider.assert_not_called()
        assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_rapid_provider_transitions_preserve_each_episode_and_event(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    provider: MockConfigEntry,
) -> None:
    """Restored, live and restored events remain ordered before the worker drains."""
    entity = er.async_get(hass).async_get_or_create(
        "sensor", "test", "rapid_provider", config_entry=provider
    )
    hass.states.async_set(entity.entity_id, "42")
    config_data.update(notifications=False, monitoring_policies=[provider_policy()])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    facts = async_capture_events(hass, EVENT_EPISODE)
    causes = [Context(), Context(), Context()]
    hass.states.async_set(
        entity.entity_id, "unavailable", {"restored": True}, context=causes[0]
    )
    hass.states.async_set(entity.entity_id, "42", context=causes[1])
    hass.states.async_set(
        entity.entity_id, "unavailable", {"restored": True}, context=causes[2]
    )
    await hass.async_block_till_done()
    assert [fact.data["change"] for fact in facts] == ["opened", "resolved", "opened"]
    assert [fact.context.parent_id for fact in facts] == [cause.id for cause in causes]
    first, resolved, reopened = facts
    assert resolved.data["episode_id"] == first.data["episode_id"]
    assert resolved.data["resolution"] == "cleared"
    assert reopened.data["episode_id"] != first.data["episode_id"]
    assert set(runtime.episodes) == {reopened.data["episode_id"]}
    [historical] = runtime.query("resolved_history", {})["episodes"]
    assert historical["episode"]["episode_id"] == first.data["episode_id"]
    assert historical["resolution"] == "cleared"
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    ("check", "domain", "attributes", "parameters", "healthy", "failed"),
    [
        (
            "battery",
            "sensor",
            {"device_class": "battery", "unit_of_measurement": "%"},
            {},
            "80",
            "10",
        ),
        ("vacuum", "vacuum", {}, {}, "cleaning", "error"),
        (
            "temperature_limit",
            "sensor",
            {"device_class": "temperature", "unit_of_measurement": "°C"},
            {"unit": "°C", "minimum": 10, "duration_seconds": 0},
            "20",
            "0",
        ),
    ],
)
async def test_value_producer_does_not_reobserve_colocated_presence_checks(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    provider: MockConfigEntry,
    check: str,
    domain: str,
    attributes: dict[str, str],
    parameters: dict[str, Any],
    healthy: str,
    failed: str,
) -> None:
    """Value-based checks retain their updates without waking other source checks."""
    entity = er.async_get(hass).async_get_or_create(
        domain,
        "test",
        "mixed_producer",
        config_entry=provider,
        original_device_class=attributes.get("device_class"),
    )
    hass.states.async_set(entity.entity_id, healthy, attributes)
    config_data.update(
        notifications=False,
        monitoring_policies=[
            provider_policy(),
            monitoring_policy("availability", {"kind": ["entity"]}),
            monitoring_policy(
                "value",
                {"entity": [f"registry:{entity.id}"]},
                check=check,
                parameters=parameters,
            ),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    engine = runtime.engine
    assert engine is not None
    with (
        patch.object(
            type(engine),
            "ingest_many",
            autospec=True,
            side_effect=type(engine).ingest_many,
        ) as ingest,
        patch.object(runtime, "_discover", wraps=runtime._discover) as discover,
    ):
        hass.states.async_set(entity.entity_id, failed, attributes)
        await hass.async_block_till_done()
        assert {row["anchor"] for row in runtime.episodes.values()} == {
            source.node_id
            for source in runtime.sources.values()
            if source.check_id == check
        }
        assert runtime.episodes
        assert_observed_checks(ingest, {check})
        ingest.reset_mock()
        hass.states.async_set(entity.entity_id, healthy, attributes)
        await hass.async_block_till_done()
        assert not runtime.episodes
        assert_observed_checks(ingest, {check})
        discover.assert_not_called()
    assert await hass.config_entries.async_unload(entry.entry_id)


def assert_observed_checks(ingest: Mock, expected: set[str]) -> None:
    """Assert the actual public engine batches contain only relevant checks."""
    assert {
        observation.check_id
        for call in ingest.call_args_list
        for observation in call.args[1]
    } == expected
