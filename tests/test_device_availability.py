"""One HA device check summarizes entity availability without a hardware claim."""

from datetime import UTC, datetime
from typing import Any

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic.catalog import (
    Source,
    device_observation,
    entity_state_signature,
)
from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.enrollment import device_members
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_controls import action
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    ("states", "status", "reason"),
    [
        pytest.param((), Status.UNKNOWN, "source_missing", id="no-member-evidence"),
        pytest.param(
            (None,), Status.UNKNOWN, "incomplete_evidence", id="missing-state"
        ),
        pytest.param(
            (State("button.identify", "unknown"),),
            Status.PASS,
            "available",
            id="only-unknown-value",
        ),
        pytest.param(
            (State("button.identify", "unknown", {"restored": True}),),
            Status.UNKNOWN,
            "incomplete_evidence",
            id="restored-unknown-is-incomplete",
        ),
        pytest.param(
            (State("sensor.a", "off"), State("sensor.b", "unknown")),
            Status.PASS,
            "available",
            id="unknown-value-does-not-warn",
        ),
        pytest.param(
            (State("sensor.a", "unavailable"), State("sensor.b", "unknown")),
            Status.PASS,
            "available",
            id="unknown-value-is-a-current-state",
        ),
        pytest.param(
            (State("sensor.a", "unavailable"), State("sensor.b", "on")),
            Status.PASS,
            "available",
            id="one-unavailable-member-does-not-warn",
        ),
        pytest.param(
            (State("sensor.a", "unavailable"), State("sensor.b", "unavailable")),
            Status.WARN,
            "all_unavailable",
            id="all-unavailable-still-warns",
        ),
        pytest.param(
            (
                State("sensor.a", "off", {"restored": True}),
                State("sensor.b", "unavailable"),
            ),
            Status.UNKNOWN,
            "incomplete_evidence",
            id="restored-is-not-recovery",
        ),
    ],
)
def test_generic_summary_reports_selected_availability_expectations(
    states: tuple[State | None, ...],
    status: Status,
    reason: str,
) -> None:
    """A device summary warns only when every selected member is unavailable."""
    observation = device_observation(
        Source(node_id="device:generic", name="Generic", kind="device"),
        states,
        datetime(2026, 9, 26, tzinfo=UTC),
    )
    assert observation.status == status
    assert observation.reason == reason


def test_device_summary_accepts_current_connectivity_off() -> None:
    """A current off value is available even when its device class is connectivity."""
    state = State("binary_sensor.connection", "off", {"device_class": "connectivity"})
    observation = device_observation(
        Source(
            node_id="device:generic",
            name="Generic",
            kind="device",
        ),
        (state,),
        datetime(2026, 9, 30, tzinfo=UTC),
    )
    assert observation.status == Status.PASS
    assert observation.reason == "available"


def test_disabled_device_summary_does_not_warn_on_unavailable_member() -> None:
    """A disabled summary remains outside active availability monitoring."""
    observation = device_observation(
        Source(
            node_id="device:disabled", name="Disabled", kind="device", disabled=True
        ),
        (State("sensor.a", "unavailable"),),
        datetime(2026, 9, 26, tzinfo=UTC),
    )
    assert observation.status == Status.UNKNOWN
    assert observation.reason == "disabled"


@pytest.mark.parametrize(
    ("state", "status", "reason"),
    [
        pytest.param(
            State("button.identify", "unknown"),
            Status.PASS,
            "value_unknown",
            id="unknown-value",
        ),
        pytest.param(
            State("button.identify", "unavailable"),
            Status.WARN,
            "unavailable",
            id="unavailable",
        ),
        pytest.param(
            State("button.identify", "unknown", {"restored": True}),
            Status.UNKNOWN,
            "restored_state",
            id="restored",
        ),
        pytest.param(None, Status.UNKNOWN, "source_missing", id="missing"),
    ],
)
def test_entity_availability_distinguishes_unknown_value_from_lost_access(
    state: State | None, status: Status, reason: str
) -> None:
    """A missing value is not evidence that Home Assistant lost access."""
    assert entity_state_signature(state) == (status, reason)


async def test_device_summary_ignores_partial_and_tracks_total_outage(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """One unavailable member is not an outage; losing every member is one issue."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "bridge")},
        name="Test bridge",
    )
    registry = er.async_get(hass)
    entities = []
    for index in range(41):
        entity = registry.async_get_or_create(
            "binary_sensor",
            "test",
            f"zone_{index}",
            config_entry=owner,
            device_id=device.id,
        )
        entities.append(entity.entity_id)
        hass.states.async_set(entity.entity_id, "off")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert [
        source.node_id for source in runtime.sources.values() if source.watched
    ] == [node_id]
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes

    hass.states.async_set(entities[0], "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes

    for entity_id in entities[1:]:
        hass.states.async_set(entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    assert len(runtime.episodes) == 1
    episode_id = next(iter(runtime.episodes))
    assert runtime.episodes[episode_id]["reasons"][0]["reason"] == "all_unavailable"

    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [episode_id]
    assert runtime.engine is not None

    for entity_id in entities:
        hass.states.async_set(entity_id, "unknown")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes

    for entity_id in entities:
        hass.states.async_set(entity_id, "off")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_auto_device_summary_ends_when_last_member_is_deleted(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A remaining HA device record does not keep a broad summary in scope."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "retired")}
    )
    registry = er.async_get(hass)
    member = registry.async_get_or_create(
        "sensor", "test", "retired", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(member.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    episode_id = next(iter(runtime.episodes))

    hass.states.async_remove(member.entity_id)
    registry.async_remove(member.entity_id)
    await hass.async_block_till_done()
    assert dr.async_get(hass).async_get(device.id) is not None
    assert node_id not in runtime.sources
    assert source_id in runtime.candidates
    assert not runtime.candidates[source_id].watched
    assert not runtime.candidates[source_id].availability_entities
    assert not runtime.episodes
    assert (
        runtime.history.view(datetime.now(UTC))["episodes"][0]["resolution"]
        == "removed"
    )
    assert runtime.enrollment_changes[-1]["reason"] == "source_removed"

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert node_id not in restored.sources
    assert (
        restored.history.view(datetime.now(UTC))["episodes"][0]["episode"]["episode_id"]
        == episode_id
    )

    replacement = registry.async_get_or_create(
        "sensor", "test", "replacement", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(replacement.entity_id, "18")
    await hass.async_block_till_done()
    assert node_id in restored.sources
    assert restored.sources[node_id].availability_entities == (replacement.entity_id,)
    assert not restored.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_exact_device_selection_stays_saved_without_members(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An exact device choice remains visible without a device check."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "selected")}
    )
    registry = er.async_get(hass)
    member = registry.async_get_or_create(
        "sensor", "test", "selected", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(member.entity_id, "17")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy(
                "selected_device", {"kind": ["device"], "device": [device.id]}
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)

    hass.states.async_remove(member.entity_id)
    registry.async_remove(member.entity_id)
    await hass.async_block_till_done()
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert runtime.readiness == "unknown"

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert node_id not in restored.sources
    assert not restored.episodes
    assert restored.readiness == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_exact_empty_device_choice_starts_without_availability_check(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A saved choice without members is visible from the first evaluation."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "empty_selected")}
    )
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy(
                "empty_device", {"kind": ["device"], "device": [device.id]}
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert source_id in runtime.candidates
    assert not runtime.candidates[source_id].availability_entities
    assert not runtime.candidates[source_id].watched
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert runtime.readiness == "unknown"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_summary_uses_operational_entities_before_diagnostics(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An optional diagnostic cannot fail a device with usable main evidence."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "one")},
    )
    registry = er.async_get(hass)
    ordinary = registry.async_get_or_create(
        "switch", "test", "power", config_entry=owner, device_id=device.id
    )
    diagnostic = registry.async_get_or_create(
        "sensor",
        "test",
        "voltage",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    configuration = registry.async_get_or_create(
        "number",
        "test",
        "level",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.CONFIG,
    )
    hass.states.async_set(ordinary.entity_id, "on")
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    hass.states.async_set(configuration.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.engine is not None
    assert (
        runtime.engine.readiness(
            [
                bound_identity(
                    config_data["monitoring_policies"][0], f"device:{device.id}"
                )
            ]
        ).answer
        == "ready"
    )
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_policy_tracks_hidden_entities_but_not_disabled_devices(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Hidden evidence remains usable; disabling a device ends its check."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", "hidden")}
    )
    registry = er.async_get(hass)
    hidden = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "hidden",
        config_entry=owner,
        device_id=device.id,
        hidden_by=er.RegistryEntryHider.USER,
    )
    disabled = registry.async_get_or_create(
        "binary_sensor",
        "test",
        "disabled",
        config_entry=owner,
        device_id=device.id,
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    hass.states.async_set(hidden.entity_id, "unavailable")
    hass.states.async_set(disabled.entity_id, "off")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert device_members(hass)[device.id] == (hidden.entity_id,)
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    assert runtime.episodes

    devices.async_update_device(device.id, disabled_by=dr.DeviceEntryDisabler.USER)
    await hass.async_block_till_done()
    assert device.id not in device_members(hass)
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert runtime.history.snapshot()["episodes"][-1]["resolution"] == "removed"
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert node_id not in runtime.sources
    assert not runtime.episodes

    devices.async_update_device(device.id, disabled_by=None)
    await hass.async_block_till_done()
    assert device_members(hass)[device.id] == (hidden.entity_id,)
    assert runtime.sources[node_id].watched
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unpressed_identify_button_is_not_device_availability_evidence(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A button's unknown last-pressed state does not open a device issue."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "button_only")},
        name="Button-only hub",
    )
    identify = er.async_get(hass).async_get_or_create(
        "button",
        "test",
        "identify",
        config_entry=owner,
        device_id=device.id,
    )
    hass.states.async_set(identify.entity_id, "unknown")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy("hub", {"kind": ["device"], "device": [device.id]})
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert device_members(hass)[device.id] == (identify.entity_id,)
    assert runtime.sources[node_id].availability_entities == (identify.entity_id,)
    assert runtime.sources[node_id].watched
    assert not runtime.episodes

    hass.states.async_set(identify.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.engine is not None
    assert runtime.engine.readiness([node_id]).answer == "degraded"
    assert runtime.episodes

    hass.states.async_set(identify.entity_id, "unknown")
    await hass.async_block_till_done()
    assert runtime.engine.readiness([node_id]).answer == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unknown_button_value_keeps_device_available(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A button's unknown last-pressed value counts as a current state."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "mixed")},
    )
    registry = er.async_get(hass)
    reporting = registry.async_get_or_create(
        "sensor", "test", "reporting", config_entry=owner, device_id=device.id
    )
    identify = registry.async_get_or_create(
        "button", "test", "identify", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(reporting.entity_id, "unavailable")
    hass.states.async_set(identify.entity_id, "unknown")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy("mixed", {"kind": ["device"], "device": [device.id]})
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert runtime.sources[node_id].availability_entities == tuple(
        sorted((reporting.entity_id, identify.entity_id))
    )
    assert not runtime.episodes

    hass.states.async_set(identify.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert runtime.episodes
    hass.states.async_set(identify.entity_id, "unknown")
    await hass.async_block_till_done()
    assert not runtime.episodes
    history = await action(hass, "resolved_history", {})
    assert history["episodes"][0]["resolution"] == "cleared"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_restore_retires_issue_when_only_identify_button_remains(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A saved device episode does not become a false recovery on reload."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "restored_button")},
    )
    registry = er.async_get(hass)
    reporting = registry.async_get_or_create(
        "sensor", "test", "reporting", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(reporting.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy(
                "restored_hub", {"kind": ["device"], "device": [device.id]}
            )
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)

    hass.states.async_remove(reporting.entity_id)
    registry.async_remove(reporting.entity_id)
    identify = registry.async_get_or_create(
        "button", "test", "identify", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(identify.entity_id, "unknown")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data
    assert restored.sources[
        bound_identity(config_data["monitoring_policies"][0], f"device:{device.id}")
    ].watched
    assert not restored.episodes
    history = await action(hass, "resolved_history", {})
    assert history["episodes"][0]["resolution"] == "cleared"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_restore_keeps_current_issue_open(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """An ongoing device outage keeps its episode through restart."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "outage")},
        name="Outage device",
    )
    sensor = er.async_get(hass).async_get_or_create(
        "sensor", "test", "only", config_entry=owner, device_id=device.id
    )
    hass.states.async_set(sensor.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy("outage", {"kind": ["device"], "device": [device.id]})
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    saved_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_unload(entry.entry_id)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert list(entry.runtime_data.episodes) == [saved_id]
    history = await action(hass, "resolved_history", {})
    assert not history["episodes"]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_device_summary_does_not_fall_back_to_diagnostic_evidence(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A diagnostic-only device remains browsable without automatic availability checks."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("test", "diagnostic_only")},
    )
    diagnostic = er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "connection",
        config_entry=owner,
        device_id=device.id,
        entity_category=EntityCategory.DIAGNOSTIC,
    )
    hass.states.async_set(diagnostic.entity_id, "unavailable")
    config_data.update(
        notifications=False,
        monitoring_policies=[monitoring_policy("devices", {"kind": ["device"]})],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    source_id = f"device:{device.id}"
    node_id = bound_identity(config_data["monitoring_policies"][0], source_id)
    assert runtime.engine is not None
    assert source_id in runtime.candidates
    assert node_id not in runtime.sources
    assert not runtime.episodes
    hass.states.async_set(diagnostic.entity_id, "ok")
    await hass.async_block_till_done()
    assert node_id not in runtime.sources
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)
