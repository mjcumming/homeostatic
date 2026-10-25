"""Standard condition reports reuse policy lifecycle, selection and delivery."""

import asyncio
from copy import deepcopy
from dataclasses import replace
from typing import Any

import pytest
from health_tree.types import Status
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED, EntityCategory
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
)

from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.const import (
    DOMAIN,
    EVENT_EPISODE,
    EVENT_NOTIFICATION,
)
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.policy_defaults import initial_settings
from custom_components.homeostatic.reported_conditions import CONDITIONS, observe
from tests.policy_helpers import (
    availability_policies,
    bound_identity,
    immediate_notification,
    monitoring_policy,
)
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import reload_policies

type ReportSource = tuple[str, str, str, MockConfigEntry, er.RegistryEntry]

CONTRACTS = [
    ("problem", "binary_sensor", "problem", "on", ("off",)),
    ("tamper", "binary_sensor", "tamper", "on", ("off",)),
    ("safety", "binary_sensor", "safety", "on", ("off",)),
    ("moisture", "binary_sensor", "moisture", "on", ("off",)),
    ("smoke", "binary_sensor", "smoke", "on", ("off",)),
    ("gas", "binary_sensor", "gas", "on", ("off",)),
    ("carbon_monoxide", "binary_sensor", "carbon_monoxide", "on", ("off",)),
    (
        "lawn_mower",
        "lawn_mower",
        None,
        "error",
        ("mowing", "docked", "paused", "returning", "idle"),
    ),
    (
        "alarm_triggered",
        "alarm_control_panel",
        None,
        "triggered",
        (
            "disarmed",
            "armed_home",
            "armed_away",
            "armed_night",
            "armed_vacation",
            "armed_custom_bypass",
            "pending",
            "arming",
            "disarming",
        ),
    ),
]


@pytest.fixture(params=CONTRACTS, ids=[row[0] for row in CONTRACTS])
def report_source(hass: HomeAssistant, request: pytest.FixtureRequest) -> ReportSource:
    """Register each condition on real HA devices, including diagnostic inputs."""
    check, domain, device_class, active, clear = request.param
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id, identifiers={("test", check)}
    )
    entity = er.async_get(hass).async_get_or_create(
        domain,
        "test",
        check,
        config_entry=owner,
        device_id=device.id,
        original_device_class=device_class,
        entity_category=EntityCategory.DIAGNOSTIC,
        original_name=check,
    )
    hass.states.async_set(entity.entity_id, clear[0])
    return check, active, clear[0], owner, entity


@pytest.mark.parametrize(
    ("check", "value", "expected"),
    [
        (check, value, expected)
        for check, _, _, active, clear in CONTRACTS
        for value, expected in [
            (active, Status.FAIL),
            *((value, Status.PASS) for value in clear),
            *(
                (value, Status.UNKNOWN)
                for value in (None, "unknown", "unavailable", "unexpected")
            ),
        ]
    ],
)
async def test_exact_ha_contract(
    hass: HomeAssistant, check: str, value: str | None, expected: Status
) -> None:
    """Every recognized activity and every evidence gap has an explicit meaning."""
    source = Source(
        node_id=f"{check}:entity_id:sensor.test",
        kind=check,
        name="Test equipment",
        entity_id="sensor.test",
        check_id=check,
    )
    if value is not None:
        hass.states.async_set("sensor.test", value)
    result = observe(hass, source, dt_util.utcnow())
    assert result.status == expected
    assert result.evidence["physical_freshness_verified"] is False
    assert set(CONDITIONS) == {row[0] for row in CONTRACTS}


async def test_restored_disabled_and_captured_reports(
    hass: HomeAssistant, report_source: ReportSource
) -> None:
    """A restored alarm cannot open an issue, and a captured gap cannot clear one."""
    check, active, clear, _, entity = report_source
    source = Source(
        node_id=f"{check}:registry:{entity.id}",
        kind=check,
        name="Equipment",
        entity_id=entity.entity_id,
        check_id=check,
    )
    hass.states.async_set(entity.entity_id, active, {"restored": True})
    assert observe(hass, source, dt_util.utcnow()).status == Status.UNKNOWN
    hass.states.async_set(entity.entity_id, active)
    assert (
        observe(hass, replace(source, disabled=True), dt_util.utcnow()).status
        == Status.UNKNOWN
    )
    captured = hass.states.get(entity.entity_id)
    hass.states.async_set(entity.entity_id, clear)
    assert (
        observe(
            hass,
            source,
            dt_util.utcnow(),
            changed_entity_id=entity.entity_id,
            changed_state=captured,
        ).status
        == Status.FAIL
    )
    assert (
        observe(
            hass,
            source,
            dt_util.utcnow(),
            changed_entity_id=entity.entity_id,
            changed_state=None,
        ).status
        == Status.UNKNOWN
    )


async def test_recovery_recurrence_restart_and_independent_owner(
    hass: HomeAssistant, config_data: dict[str, Any], report_source: ReportSource
) -> None:
    """Only the matching clear report ends an issue; owner failure preserves it."""
    check, active, clear, owner, entity = report_source
    selected = monitoring_policy("condition", {"kind": [check]}, check=check)
    config_data.update(
        notifications=False,
        monitoring_policies=[
            selected,
            *availability_policies(integrations=[owner.entry_id]),
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    identity = bound_identity(selected, f"{check}:registry:{entity.id}")
    assert runtime.sources[identity].node(runtime.settings).depends_on == ()
    assert not runtime.episodes
    hass.states.async_set(entity.entity_id, active)
    await hass.async_block_till_done()
    [first] = runtime.episodes
    for value, attrs in [
        (active, {"updated": 1}),
        ("unknown", {}),
        ("unavailable", {}),
        (clear, {"restored": True}),
        ("unexpected", {}),
    ]:
        hass.states.async_set(entity.entity_id, value, attrs)
        await hass.async_block_till_done()
        assert list(runtime.episodes) == [first]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert list(runtime.episodes) == [first]
    assert (
        runtime.entity_status(identity)["last_failure"]["reason"] == f"{check}_reported"
    )
    owner._async_set_state(hass, ConfigEntryState.SETUP_ERROR, "offline")
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    assert first in runtime.episodes
    hass.states.async_set(entity.entity_id, clear)
    await hass.async_block_till_done()
    assert first not in runtime.episodes
    hass.states.async_set(entity.entity_id, active)
    await hass.async_block_till_done()
    assert any(row["anchor"] == identity for row in runtime.episodes.values())
    assert first not in runtime.episodes
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("sending", [False, True])
async def test_overlapping_policies_and_both_notification_paths(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    report_source: ReportSource,
    sending: bool,
) -> None:
    """Independent findings use direct notify requests and optional consumer events."""
    check, active, _, _, entity = report_source
    destination = er.async_get(hass).async_get_or_create("notify", "test", "messages")
    calls: list[ServiceCall] = []

    @callback
    def receive(call: ServiceCall) -> None:
        calls.append(call)

    hass.services.async_register("notify", "send_message", receive)
    config_data["notification_definitions"]["methods"]["test"]["destinations"] = [
        f"notify:{destination.id}"
    ]
    policies = [
        monitoring_policy(
            name, {"kind": [check]}, check=check, notifications=immediate_notification()
        )
        for name in ("first", "second")
    ]
    config_data.update(notifications=sending, monitoring_policies=policies)
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    hass.states.async_set(entity.entity_id, active)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 2
    assert len(calls) == len(events) == int(sending)
    if sending:
        assert set(events[0].data["episodes"]) == set(runtime.episodes)
        assert calls[0].data["entity_id"] == destination.entity_id
    first, second = runtime.episodes
    await runtime.async_control("acknowledge", {"episode_id": first}, None)
    assert runtime.policy is not None
    assert runtime.policy.acknowledgment(first) is not None
    assert runtime.policy.acknowledgment(second) is None
    assert len(runtime.episodes) == 2
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_queued_transitions_keep_order_and_restart_identity(
    hass: HomeAssistant, config_data: dict[str, Any], report_source: ReportSource
) -> None:
    """A busy worker preserves a report, gap, clearance and recurrence in order."""
    check, active, clear, _, entity = report_source
    config_data.update(
        notifications=False,
        monitoring_policies=[
            monitoring_policy("condition", {"kind": [check]}, check=check)
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    events = async_capture_events(hass, EVENT_EPISODE)
    captured: asyncio.Queue[str] = asyncio.Queue()

    @callback
    def received(event: Event[Any]) -> None:
        if event.data["entity_id"] == entity.entity_id:
            captured.put_nowait(entity.entity_id)

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, received)
    async with runtime._lock:
        for value in (active, "unknown", clear, active):
            hass.states.async_set(entity.entity_id, value)
            await captured.get()
        assert len(runtime._pending) == 4
    cancel()
    await hass.async_block_till_done()
    assert [event.data["change"] for event in events] == [
        "opened",
        "updated",
        "resolved",
        "opened",
    ]
    [current] = runtime.episodes
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert list(runtime.episodes) == [current]
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_selection_exclusion_and_removed_class(
    hass: HomeAssistant, config_data: dict[str, Any], report_source: ReportSource
) -> None:
    """Diagnostic inputs are eligible; exclusions and changed classes end monitoring."""
    check, active, _, owner, entity = report_source
    selected = monitoring_policy(
        "selected", {"kind": [check], "entity": [f"registry:{entity.id}"]}, check=check
    )
    config_data.update(notifications=False, monitoring_policies=[selected])
    hass.states.async_set(entity.entity_id, active)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    draft = deepcopy(selected)
    draft["excluded_sources"] = [f"{check}:registry:{entity.id}"]
    await reload_policies(hass, entry, [draft])
    runtime = entry.runtime_data
    assert not runtime.episodes
    await reload_policies(hass, entry, [selected])
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    er.async_get(hass).async_update_entity(
        entity.entity_id, disabled_by=er.RegistryEntryDisabler.USER
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    er.async_get(hass).async_update_entity(entity.entity_id, disabled_by=None)
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    if entity.domain == "binary_sensor":
        er.async_get(hass).async_update_entity(entity.entity_id, device_class="motion")
        await hass.async_block_till_done()
        assert not runtime.episodes
    else:
        await hass.config_entries.async_set_disabled_by(
            owner.entry_id, ConfigEntryDisabler.USER
        )
        await hass.async_block_till_done()
        assert not any(
            source.watched and source.kind == check
            for source in runtime.sources.values()
        )
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("location", ["data", "options"])
async def test_batch_upgrade_is_disabled_add_once_and_preserves_deletions(
    hass: HomeAssistant, config_data: dict[str, Any], location: str
) -> None:
    """Upgrade preserves prior policies, sending choices and deliberate deletions."""
    previous = initial_settings("UTC")
    new_ids = {f"default_{check}" for check in CONDITIONS}
    previous["supplied_policy_introductions"] = [
        identity
        for identity in previous["supplied_policy_introductions"]
        if identity not in new_ids
    ]
    previous["monitoring_policies"] = [
        row
        for row in previous["monitoring_policies"]
        if row["id"] not in new_ids | {"default_batteries"}
    ]
    previous["monitoring_policies"][0]["name"] = "Edited integration policy"
    previous["notification_definitions"]["profiles"].pop("immediate")
    for row in previous["monitoring_policies"]:
        row["notifications"] = [
            item for item in row["notifications"] if item["profile"] != "immediate"
        ]
    previous.update(notifications=True, timings=config_data["timings"])
    before = deepcopy(previous)
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=previous if location == "data" else {},
        options=previous if location == "options" else {},
    )
    events = async_capture_events(hass, EVENT_NOTIFICATION)
    await start_monitor(hass, entry)
    saved = deepcopy(dict(entry.data))
    assert (
        saved["monitoring_policies"][: len(before["monitoring_policies"])]
        == before["monitoring_policies"]
    )
    additions = saved["monitoring_policies"][len(before["monitoring_policies"]) :]
    assert {row["id"] for row in additions} == new_ids
    assert all(not row["enabled"] for row in additions)
    assert all(
        row["notifications"]
        == (
            []
            if row["check"] != "problem"
            else [{"id": "default", "profile": "morning"}]
        )
        for row in additions
    )
    assert saved["notification_definitions"] == before["notification_definitions"]
    assert saved["notifications"] is True
    saved["monitoring_policies"] = [
        row for row in saved["monitoring_policies"] if row["id"] not in new_ids
    ]
    hass.config_entries.async_update_entry(entry, options=saved)
    for _ in range(2):
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert not new_ids.intersection(
            row.id for row in entry.runtime_data.settings.monitoring_policies
        )
    assert not events
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("check", [row[0] for row in CONTRACTS])
def test_empty_disabled_templates_require_selection_before_enabling(check: str) -> None:
    """Restorable disabled templates are valid; empty enabled selections are not."""
    template = monitoring_policy(
        "empty", {"kind": [check], "entity": []}, check=check, enabled=False
    )
    assert parse_policies([template])[0].enabled is False
    template["enabled"] = True
    with pytest.raises(ValueError, match="Choose at least one source"):
        parse_policies([template])
    template["match"] = {"kind": ["entity"]}
    with pytest.raises(ValueError, match="Choose sources for this reported condition"):
        parse_policies([template])


@pytest.mark.parametrize("check", [row[0] for row in CONTRACTS])
@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"match_any": [{"domain": ["binary_sensor"]}]}, "Entity type alternatives"),
        ({"included_sources": ["entity:registry:other"]}, "Explicit inclusions"),
        (
            {
                "notifications": [
                    {"id": "power", "profile": "immediate", "when": "mains"}
                ]
            },
            "Power-mode schedules",
        ),
    ],
)
def test_reported_policy_rejects_other_check_controls(
    check: str, patch: dict[str, Any], message: str
) -> None:
    """API edits cannot attach availability overrides or UPS timing to a condition."""
    selected = monitoring_policy("condition", {"kind": [check]}, check=check)
    selected.update(patch)
    with pytest.raises(ValueError, match=message):
        parse_policies([selected])


@pytest.mark.parametrize(
    ("match", "message"),
    [
        ({"kind": ["lock"]}, "require selected opening sensors"),
        ({"kind": ["entity"], "entity": []}, "Select at least one door or window"),
    ],
)
def test_reported_templates_do_not_relax_left_open_selection(
    match: dict[str, list[str]], message: str
) -> None:
    """The shared editor's empty-template support preserves contact prerequisites."""
    selected = monitoring_policy(
        "opening", match, check="left_open", parameters={"duration_seconds": 60}
    )
    with pytest.raises(ValueError, match=message):
        parse_policies([selected])


@pytest.mark.parametrize("scope", ["area", "label"])
async def test_group_scope_enrolls_future_matches(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    report_source: ReportSource,
    scope: str,
) -> None:
    """Saved group choices enroll future exact-class matches and retain exclusions."""
    check, active, _, owner, entity = report_source
    area = ar.async_get(hass).async_create("Plant room")
    label = lr.async_get(hass).async_create("Watched equipment")
    metadata = {"area_id": area.id} if scope == "area" else {"labels": {label.label_id}}
    er.async_get(hass).async_update_entity(entity.entity_id, **metadata)
    selected = monitoring_policy(
        "group",
        {"kind": [check], scope: [area.id if scope == "area" else label.label_id]},
        check=check,
    )
    config_data.update(notifications=False, monitoring_policies=[selected])
    hass.states.async_set(entity.entity_id, active)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 1
    future = er.async_get(hass).async_get_or_create(
        entity.domain,
        "test",
        f"future_{check}",
        config_entry=owner,
        original_device_class=entity.original_device_class,
        original_name="Future equipment",
    )
    er.async_get(hass).async_update_entity(future.entity_id, **metadata)
    hass.states.async_set(future.entity_id, active)
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 2
    if scope == "area":
        identity = bound_identity(selected, f"{check}:registry:{entity.id}")
        assert "Plant room" in runtime.entity_status(identity)["current"]["message"]
    selected["excluded_sources"] = [f"{check}:registry:{future.id}"]
    await reload_policies(hass, entry, [selected])
    runtime = entry.runtime_data
    assert len(runtime.episodes) == 1
    assert not any(
        source.watched and source.entity_id == future.entity_id
        for source in runtime.sources.values()
    )
    assert await hass.config_entries.async_unload(entry.entry_id)
