"""Not-provided evidence uses registry ownership and the real HA lifecycle."""

from dataclasses import replace
from datetime import timedelta

import pytest
from health_tree.engine import Engine
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.entity_not_provided import (
    node,
    observe,
    parameters,
    sources,
)
from custom_components.homeostatic.monitoring import MonitoringPolicy
from tests.policy_helpers import current_config


@pytest.fixture
def provided_source(hass: HomeAssistant) -> Source:
    """Register one enabled entity under a loaded synthetic integration."""
    owner = MockConfigEntry(
        domain="test", title="Test provider", state=ConfigEntryState.LOADED
    )
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "not-provided",
        config_entry=owner,
        suggested_object_id="not_provided",
        original_name="Test reading",
    )
    return Source(
        node_id="monitoring:missing:entity:test",
        name="Test reading",
        kind="entity_not_provided",
        check_id="entity_not_provided",
        entity_id=entity.entity_id,
        owner_id=owner.entry_id,
        attributes={"kind": ("entity",), "entity": (f"registry:{entity.id}",)},
    )


@pytest.mark.parametrize(
    ("state", "restored", "expected"),
    [
        (None, False, Status.WARN),
        ("unavailable", True, Status.WARN),
        ("unknown", True, Status.WARN),
        ("unavailable", False, Status.PASS),
        ("unknown", False, Status.PASS),
        ("off", False, Status.PASS),
        ("42", False, Status.PASS),
    ],
)
async def test_provided_evidence(
    hass: HomeAssistant,
    provided_source: Source,
    state: str | None,
    restored: bool,
    expected: Status,
) -> None:
    """Only absent or restored states establish the not-provided condition."""
    await hass.async_start()
    assert provided_source.entity_id is not None
    if state is not None:
        hass.states.async_set(provided_source.entity_id, state, {"restored": restored})
    result = observe(hass, provided_source, dt_util.utcnow())
    assert result.status is expected
    assert result.check_id == "entity_not_provided"
    assert result.evidence["integration"] == "Test provider"


@pytest.mark.parametrize(
    "owner_state",
    [
        ConfigEntryState.NOT_LOADED,
        ConfigEntryState.SETUP_IN_PROGRESS,
        ConfigEntryState.SETUP_RETRY,
        ConfigEntryState.SETUP_ERROR,
        ConfigEntryState.UNLOAD_IN_PROGRESS,
    ],
)
async def test_owner_not_loaded(
    hass: HomeAssistant,
    provided_source: Source,
    owner_state: ConfigEntryState,
) -> None:
    """Missing startup or owner evidence never supplies a maintenance warning."""
    await hass.async_start()
    assert provided_source.owner_id is not None
    owner = hass.config_entries.async_get_entry(provided_source.owner_id)
    assert owner is not None
    owner._async_set_state(hass, owner_state, None)
    assert observe(hass, provided_source, dt_util.utcnow()).status is Status.UNKNOWN


async def test_startup_and_disabled_source(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """Startup and deliberate disablement are not missing-provider faults."""
    hass.set_state(CoreState.not_running)
    assert (
        observe(hass, provided_source, dt_util.utcnow()).reason == "provider_not_loaded"
    )
    await hass.async_start()
    result = observe(hass, replace(provided_source, disabled=True), dt_util.utcnow())
    assert result.status is Status.UNKNOWN
    assert result.reason == "disabled"


async def test_removed_and_mismatched_ownership(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """A missing or mismatched registry record cannot establish the condition."""
    await hass.async_start()
    other = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    other.add_to_hass(hass)
    assert (
        observe(
            hass, replace(provided_source, owner_id=other.entry_id), dt_util.utcnow()
        ).reason
        == "provider_not_confirmed"
    )
    assert provided_source.entity_id is not None
    er.async_get(hass).async_remove(provided_source.entity_id)
    assert (
        observe(hass, provided_source, dt_util.utcnow()).reason
        == "provider_not_confirmed"
    )


async def test_ordered_state_event(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """A queued state removal is observed even if HA already holds a newer state."""
    await hass.async_start()
    assert provided_source.entity_id is not None
    hass.states.async_set(provided_source.entity_id, "42")
    result = observe(
        hass,
        provided_source,
        dt_util.utcnow(),
        changed_entity_id=provided_source.entity_id,
        changed_state=None,
    )
    assert result.status is Status.WARN


@pytest.mark.parametrize("value", [True, -1, 0.5, 31536001, "24"])
def test_invalid_duration(value: object) -> None:
    """Reject invalid holds rather than silently changing the qualification."""
    with pytest.raises(ValueError):
        parameters({"duration_seconds": value})


def test_duration_defaults_and_unknown_fields() -> None:
    """The 24-hour default and explicit zero are deliberate saved settings."""
    assert parameters({}) == {"duration_seconds": 86400}
    assert parameters({"duration_seconds": 0}) == {"duration_seconds": 0}
    with pytest.raises(ValueError):
        parameters({"delete": True})


def missing_policy() -> MonitoringPolicy:
    """Build a separate editable policy before its parser wiring is handed off."""
    return MonitoringPolicy(
        id="missing",
        name="Entities not provided",
        check="entity_not_provided",
        match={"kind": ("entity",)},
        parameters={"duration_seconds": 60},
        enabled=True,
        notifications=(),
    )


async def test_continuous_qualification_and_recovery(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """A full hold is required, and a live unavailable state clears only this check."""
    await hass.async_start()
    settings = replace(
        Settings.from_data(current_config()), monitoring_policies=(missing_policy(),)
    )
    source = replace(provided_source, monitoring_policy="missing")
    engine = Engine(settings.engine_settings())
    now = dt_util.utcnow()
    engine.register_many([node(source, settings)], now)
    engine.ingest_many([observe(hass, source, now)], now)
    engine.advance(now + timedelta(seconds=59))
    assert all(
        finding.status is not Status.WARN
        for finding in engine.explain(source.node_id).findings
    )
    engine.advance(now + timedelta(seconds=60))
    assert engine.explain(source.node_id).findings[0].status is Status.WARN
    assert source.entity_id is not None
    hass.states.async_set(source.entity_id, "unavailable")
    later = now + timedelta(seconds=61)
    engine.ingest_many([observe(hass, source, later)], later)
    assert not engine.explain(source.node_id).findings
    assert er.async_get(hass).async_get(source.entity_id) is not None


async def test_unknown_interrupts_qualification(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """An unloaded owner breaks continuous qualification without claiming recovery."""
    await hass.async_start()
    settings = replace(
        Settings.from_data(current_config()), monitoring_policies=(missing_policy(),)
    )
    source = replace(provided_source, monitoring_policy="missing")
    engine = Engine(settings.engine_settings())
    now = dt_util.utcnow()
    engine.register_many([node(source, settings)], now)
    engine.ingest_many([observe(hass, source, now)], now)
    assert source.owner_id is not None
    owner = hass.config_entries.async_get_entry(source.owner_id)
    assert owner is not None
    owner._async_set_state(hass, ConfigEntryState.NOT_LOADED, None)
    interrupted = now + timedelta(seconds=50)
    engine.ingest_many([observe(hass, source, interrupted)], interrupted)
    owner._async_set_state(hass, ConfigEntryState.LOADED, None)
    resumed = now + timedelta(seconds=55)
    engine.ingest_many([observe(hass, source, resumed)], resumed)
    engine.advance(now + timedelta(seconds=114))
    assert all(
        finding.status is not Status.WARN
        for finding in engine.explain(source.node_id).findings
    )
    engine.advance(now + timedelta(seconds=115))
    assert engine.explain(source.node_id).findings[0].status is Status.WARN


def test_scope_is_independent_and_preserves_canonical_entity() -> None:
    """Broad missing-provider scope includes enabled diagnostics and honors exclusions."""
    candidate = Source(
        node_id="entity:registry:example",
        name="Reading",
        kind="entity",
        owner_id="provider",
        entity_id="sensor.example",
        watched=False,
        attributes={
            "kind": ("entity",),
            "entity": ("registry:example",),
            "entity_category": ("diagnostic",),
        },
    )
    policy = missing_policy()
    [bound] = sources((policy,), {candidate.node_id: candidate}).values()
    assert bound.monitoring_source == candidate.node_id
    assert bound.check_id == "entity_not_provided"
    assert not bound.requirements
    assert not candidate.watched
    assert not sources(
        (replace(policy, enabled=False),), {candidate.node_id: candidate}
    )
    assert not sources(
        (replace(policy, excluded_sources=(candidate.node_id,)),),
        {candidate.node_id: candidate},
    )
    assert not sources(
        (policy,), {candidate.node_id: replace(candidate, disabled=True)}
    )


async def test_entity_disabled_in_registry(
    hass: HomeAssistant, provided_source: Source
) -> None:
    """A just-disabled registry entry is ineligible before the next inventory refresh."""
    await hass.async_start()
    assert provided_source.entity_id is not None
    er.async_get(hass).async_update_entity(
        provided_source.entity_id, disabled_by=er.RegistryEntryDisabler.USER
    )
    assert observe(hass, provided_source, dt_util.utcnow()).reason == "disabled"
