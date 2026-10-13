"""Named policy scenarios through real Home Assistant enrollment and reload."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from typing import Any

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.util import dt as dt_util
from homeassistant.util.unit_system import US_CUSTOMARY_SYSTEM
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic import notification_definitions
from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.dashboard import _settings_review_token
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.monitoring_runtime import contributing_policies
from custom_components.homeostatic.runtime import Runtime


def test_source_policy_links_follow_real_checks_and_independent_ownership() -> None:
    """Matching a broad selector alone does not make an unsupported check apply."""
    policies = parse_policies(
        [
            {**limit_policy("freeze"), "match": {}},
            {
                **limit_policy("heat"),
                "match": {},
                "check": "thermostat",
                "parameters": {},
            },
            {
                **limit_policy("battery"),
                "match": {},
                "check": "battery",
                "parameters": {},
            },
        ]
    )
    sensor = Source(
        node_id="sensor",
        name="Temperature",
        kind="entity",
        entity_id="sensor.temperature",
    )
    unrelated = Source(
        node_id="other", name="Humidity", kind="entity", entity_id="sensor.humidity"
    )
    condition = Source(
        node_id="freeze",
        name="Freeze",
        kind="temperature_limit",
        check_id="temperature_limit",
        entity_id="sensor.temperature",
        monitoring_policy="freeze",
    )
    sources = {item.node_id: item for item in (sensor, unrelated, condition)}
    assert [item.id for item in contributing_policies(policies, sensor, sources)] == [
        "freeze"
    ]
    assert contributing_policies(policies, unrelated, sources) == ()
    assert [
        item.id for item in contributing_policies(policies, condition, sources)
    ] == ["freeze"]


async def start_monitor(hass: HomeAssistant, entry: MockConfigEntry) -> Runtime:
    """Load the already configured entry and complete Home Assistant startup."""
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


def configure(
    hass: HomeAssistant, entry: MockConfigEntry, policies: list[dict[str, Any]]
) -> None:
    """Install independent detection policies with outgoing requests disabled."""
    entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        entry,
        data={
            **entry.data,
            "entities": [],
            "notifications": False,
            "rules": [],
            "monitoring_policies": policies,
        },
    )


async def reload_policies(
    hass: HomeAssistant, entry: MockConfigEntry, policies: list[dict[str, Any]]
) -> None:
    """Apply changed definitions through the adapter's normal persisted reload."""
    hass.config_entries.async_update_entry(
        entry,
        options={**(entry.options or entry.data), "monitoring_policies": policies},
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()


async def advance(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, seconds: int
) -> None:
    """Deliver scheduled deadlines using Home Assistant's clock helper."""
    freezer.tick(timedelta(seconds=seconds))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()


def limit_policy(identity: str = "freeze") -> dict[str, Any]:
    """Select one sensor with an explicit immediate low-temperature threshold."""
    return {
        "id": identity,
        "name": "Freeze protection",
        "check": "temperature_limit",
        "match": {"entity": ["entity_id:sensor.temperature"]},
        "parameters": {"unit": "°C", "minimum": 5, "duration_seconds": 0},
        "enabled": True,
        "notifications": [],
    }


@pytest.mark.parametrize(
    "edit",
    [
        pytest.param({"name": "Renamed"}, id="rename"),
        pytest.param(
            {
                "notifications": [
                    {
                        "id": "row",
                        "timing": {
                            "mode": "report",
                            "at": "08:00",
                            "weekdays": [0, 1, 2, 3, 4, 5, 6],
                        },
                        "methods": ["phone"],
                    }
                ]
            },
            id="notifications",
        ),
    ],
)
def test_detection_identity_ignores_presentation(edit: dict[str, Any]) -> None:
    """Names and reporting changes retain the configured condition identity."""
    original = limit_policy()
    assert (
        parse_policies([original])[0].detection_key()
        == parse_policies([{**original, **edit}])[0].detection_key()
    )


def test_notification_rows_are_local_to_each_policy() -> None:
    """Independent copied policies can edit the same local row id differently."""
    definitions = notification_definitions.defaults()
    definitions["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:owner"]}
    }
    definitions["default"] = [
        {
            "id": "row",
            "timing": {"mode": "report", "at": "08:00", "weekdays": [0]},
            "methods": ["phone"],
        }
    ]
    policies = [
        {
            **limit_policy(identity),
            "notifications": [{"id": "row", "timing": timing, "methods": ["phone"]}],
        }
        for identity, timing in (
            ("freeze", {"mode": "immediate"}),
            ("backup", {"mode": "report", "at": "08:00", "weekdays": [0]}),
        )
    ]
    settings = Settings.from_data(
        {"monitoring_policies": policies, "notification_definitions": definitions}
    )
    assert [
        item.notifications[0]["timing"]["mode"] for item in settings.monitoring_policies
    ] == ["immediate", "report"]
    policies[0]["notifications"][0]["id"] = 1
    with pytest.raises(ValueError, match="stable ids"):
        Settings.from_data(
            {"monitoring_policies": policies, "notification_definitions": definitions}
        )


async def test_independent_temperature_policies_and_removed_history(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Overlapping policies are independent; deleting one does not clear the other."""
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    configure(hass, config_entry, [limit_policy(), limit_policy("backup")])
    runtime = await start_monitor(hass, config_entry)
    assert len(runtime.episodes) == 2
    before = set(runtime.episodes)
    options = {**config_entry.data, "monitoring_policies": [limit_policy("backup")]}
    hass.config_entries.async_update_entry(config_entry, options=options)
    await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert len(runtime.episodes) == 1
    assert set(runtime.episodes) < before
    hass.states.async_set(
        "sensor.temperature",
        "5",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_thermostat_off_and_resume(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Off ends a finding and a later heat selection starts a new expectation."""
    policy = {
        **limit_policy(),
        "check": "thermostat",
        "match": {"entity": ["entity_id:climate.room"]},
        "parameters": {"unit": "°C", "worsening": 1},
    }
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 15, "temperature": 21}
    )
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    hass.states.async_set(
        "climate.room", "off", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert len(runtime.temperature_monitors) == 1
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 11, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def test_missing_delivery_method_configuration_rejected() -> None:
    """Policies cannot activate dangling reporting references."""
    policy = deepcopy(limit_policy())
    policy["notifications"] = [
        {"id": "row", "timing": {"mode": "immediate"}, "methods": ["phone"]}
    ]
    with pytest.raises(ValueError, match="Create delivery methods"):
        Settings.from_data({"monitoring_policies": [policy]})


async def test_rename_and_detection_edit_have_distinct_lifecycles(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Renaming preserves the issue; a threshold edit retires it as removed."""
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    original = limit_policy()
    configure(hass, config_entry, [original])
    runtime = await start_monitor(hass, config_entry)
    before = set(runtime.episodes)
    assert len(before) == 1
    renamed = {**original, "name": "Garage freeze"}
    await reload_policies(hass, config_entry, [renamed])
    assert set(config_entry.runtime_data.episodes) == before
    changed = {
        **renamed,
        "parameters": {"unit": "°C", "minimum": 6, "duration_seconds": 0},
    }
    await reload_policies(hass, config_entry, [changed])
    runtime = config_entry.runtime_data
    assert len(runtime.episodes) == 1
    assert not before.intersection(runtime.episodes)
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_active_limit_survives_gap_and_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """An active issue stays open through unusable evidence and restarts."""
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set("sensor.temperature", "0", attributes)
    configure(hass, config_entry, [limit_policy()])
    runtime = await start_monitor(hass, config_entry)
    before = set(runtime.episodes)
    hass.states.async_set("sensor.temperature", "unavailable", attributes)
    await hass.async_block_till_done()
    await advance(hass, freezer, 60)
    assert set(runtime.episodes) == before
    await reload_policies(hass, config_entry, [limit_policy()])
    runtime = config_entry.runtime_data
    assert set(runtime.episodes) == before
    hass.states.async_set("sensor.temperature", "0", attributes)
    await hass.async_block_till_done()
    assert set(runtime.episodes) == before
    hass.states.async_set("sensor.temperature", "5", attributes)
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_pending_limit_resets_across_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Downtime never completes an unobserved continuous qualification interval."""
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    policy = {
        **limit_policy(),
        "parameters": {"unit": "°C", "minimum": 5, "duration_seconds": 120},
    }
    configure(hass, config_entry, [policy])
    await start_monitor(hass, config_entry)
    await advance(hass, freezer, 100)
    assert not config_entry.runtime_data.episodes
    await reload_policies(hass, config_entry, [policy])
    await advance(hass, freezer, 119)
    assert not config_entry.runtime_data.episodes
    await advance(hass, freezer, 1)
    assert len(config_entry.runtime_data.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_registered_sensor_rename_retains_policy_and_issue(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Registry identity keeps a renamed sensor in its saved policy."""
    registry = er.async_get(hass)
    entity = registry.async_get_or_create(
        "sensor", "test", "temperature", suggested_object_id="temperature"
    )
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set(entity.entity_id, "0", attributes)
    policy = {**limit_policy(), "match": {"entity": [f"registry:{entity.id}"]}}
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    before = set(runtime.episodes)
    assert len(before) == 1
    registry.async_update_entity(entity.entity_id, new_entity_id="sensor.renamed")
    hass.states.async_set("sensor.renamed", "0", attributes)
    await hass.async_block_till_done()
    assert set(runtime.episodes) == before
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def test_effective_defaults_retain_detection_identity() -> None:
    """Explicit saved defaults do not manufacture a new expectation."""
    policy = {**limit_policy(), "check": "thermostat", "parameters": {}}
    implicit = parse_policies([policy])[0]
    explicit = parse_policies(
        [
            {
                **policy,
                "parameters": {
                    "unit": "°F",
                    "margin": 2.0,
                    "progress": 2.0,
                    "worsening": 2.0,
                    "progress_seconds": 3600,
                },
            }
        ]
    )[0]
    assert implicit.detection_key() == explicit.detection_key()


async def test_group_membership_adds_and_retires_only_affected_source(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Future group matches enroll and departing members end their own issues."""
    label = lr.async_get(hass).async_create("Cold spaces")
    registry = er.async_get(hass)
    first = registry.async_get_or_create(
        "sensor", "test", "first", suggested_object_id="first"
    )
    second = registry.async_get_or_create(
        "sensor", "test", "second", suggested_object_id="second"
    )
    registry.async_update_entity(first.entity_id, labels={label.label_id})
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set(first.entity_id, "0", attributes)
    hass.states.async_set(second.entity_id, "0", attributes)
    policy = {**limit_policy(), "match": {"label": [label.label_id]}}
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    first_ids = set(runtime.episodes)
    assert len(first_ids) == 1
    draft = {"monitoring_policies": [policy]}
    reviewed = _settings_review_token(runtime, "unchanged-options", draft)
    registry.async_update_entity(second.entity_id, labels={label.label_id})
    await hass.async_block_till_done()
    second_ids = set(runtime.episodes) - first_ids
    assert len(second_ids) == 1
    assert _settings_review_token(runtime, "unchanged-options", draft) != reviewed
    registry.async_update_entity(first.entity_id, labels=set())
    await hass.async_block_till_done()
    assert set(runtime.episodes) == second_ids
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_sensor_removed_during_shutdown_is_retired_on_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A saved issue for a removed registry entity ends as monitoring removed."""
    registry = er.async_get(hass)
    entity = registry.async_get_or_create(
        "sensor", "test", "temperature", suggested_object_id="temperature"
    )
    hass.states.async_set(
        entity.entity_id,
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    policy = {**limit_policy(), "match": {"entity": [f"registry:{entity.id}"]}}
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    hass.states.async_remove(entity.entity_id)
    registry.async_remove(entity.entity_id)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert not runtime.episodes
    assert not runtime.temperature_monitors
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_sensor_unit_change_preserves_active_condition(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Changing the displayed unit does not reset the configured expectation."""
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    configure(hass, config_entry, [limit_policy()])
    runtime = await start_monitor(hass, config_entry)
    before = set(runtime.episodes)
    hass.states.async_set(
        "sensor.temperature",
        "32",
        {"device_class": "temperature", "unit_of_measurement": "°F"},
    )
    await hass.async_block_till_done()
    assert set(runtime.episodes) == before
    hass.states.async_set(
        "sensor.temperature",
        "41",
        {"device_class": "temperature", "unit_of_measurement": "°F"},
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_thermostat_uses_installation_temperature_unit(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Fahrenheit climate attributes are not interpreted as Celsius."""
    hass.config.units = US_CUSTOMARY_SYSTEM
    policy = {
        **limit_policy(),
        "check": "thermostat",
        "match": {"entity": ["entity_id:climate.room"]},
        "parameters": {},
    }
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 65, "temperature": 70}
    )
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 63, "temperature": 70}
    )
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 68, "temperature": 70}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_disabled_policy_preview_does_not_report_retired_issue(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The reporting review must not count issues the same save will retire."""
    data = notification_definitions.defaults()
    data["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:one"]}
    }
    policy = {
        **limit_policy(),
        "notifications": [
            {"id": "now", "timing": {"mode": "immediate"}, "methods": ["phone"]}
        ],
    }
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    configure(hass, config_entry, [policy])
    hass.config_entries.async_update_entry(
        config_entry, data={**config_entry.data, "notification_definitions": data}
    )
    runtime = await start_monitor(hass, config_entry)
    candidate = Settings.from_data(
        {**config_entry.data, "monitoring_policies": [{**policy, "enabled": False}]}
    )
    review = runtime.preview_policy(candidate.policy, settings=candidate)
    assert review["deliveries"] == []
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_temperature_policy_respects_explicit_source_exclusion(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An explicit excluded source cannot be silently re-enrolled by a policy."""
    hass.states.async_set(
        "sensor.temperature",
        "0",
        {"device_class": "temperature", "unit_of_measurement": "°C"},
    )
    configure(hass, config_entry, [limit_policy()])
    hass.config_entries.async_update_entry(
        config_entry,
        data={
            **config_entry.data,
            "rules": [
                {
                    "id": "excluded",
                    "action": "exclude",
                    "match": {"entity": ["entity_id:sensor.temperature"]},
                    "checks": ["availability"],
                }
            ],
        },
    )
    runtime = await start_monitor(hass, config_entry)
    assert not runtime.temperature_monitors
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param({}, id="not-list"),
        pytest.param([None], id="not-object"),
        pytest.param([{**limit_policy(), "bogus": True}], id="unknown-field"),
        pytest.param([limit_policy(), limit_policy()], id="duplicate-id"),
        pytest.param([{**limit_policy(), "id": "unsafe id"}], id="invalid-id"),
        pytest.param([{**limit_policy(), "name": " "}], id="empty-name"),
        pytest.param([{**limit_policy(), "check": "unknown"}], id="unknown-check"),
        pytest.param([{**limit_policy(), "parameters": []}], id="invalid-parameters"),
        pytest.param(
            [{**limit_policy(), "check": "battery"}], id="unsupported-parameters"
        ),
        pytest.param([{**limit_policy(), "enabled": "yes"}], id="invalid-enabled"),
        pytest.param([{**limit_policy(), "notifications": {}}], id="invalid-rows"),
        pytest.param([{**limit_policy(), "notifications": [None]}], id="invalid-row"),
    ],
)
def test_invalid_monitoring_definition_rejected(value: Any) -> None:
    """Malformed policies cannot become active monitoring or notification scope."""
    with pytest.raises(ValueError):
        parse_policies(value)


def test_policy_serialization_retains_hyphen_identity() -> None:
    """UI-generated identities survive a complete validated round trip."""
    policy = parse_policies([limit_policy("policy-1")])[0]
    restored = parse_policies([policy.data()])[0]
    assert restored == policy


async def test_rapid_off_heat_transition_records_monitoring_end(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Queued off/heat transitions cannot turn scope removal into recovery."""
    policy = {
        **limit_policy(),
        "check": "thermostat",
        "match": {"entity": ["entity_id:climate.room"]},
        "parameters": {"unit": "°C", "worsening": 1},
    }
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 15, "temperature": 21}
    )
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    hass.states.async_set(
        "climate.room", "off", {"current_temperature": 13, "temperature": 21}
    )
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    ended = runtime.history.view(dt_util.utcnow())["episodes"]
    assert isinstance(ended, list)
    assert len(ended) == 1
    assert isinstance(ended[0], dict)
    assert ended[0]["resolution"] == "removed"
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_thermostat_off_at_restart_does_not_resurrect_old_qualification(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An off mode observed after downtime ends the saved expectation."""
    policy = {
        **limit_policy(),
        "check": "thermostat",
        "match": {"entity": ["entity_id:climate.room"]},
        "parameters": {"unit": "°C", "worsening": 1},
    }
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 15, "temperature": 21}
    )
    configure(hass, config_entry, [policy])
    runtime = await start_monitor(hass, config_entry)
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)

    hass.states.async_set(
        "climate.room", "off", {"current_temperature": 13, "temperature": 21}
    )
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    runtime = config_entry.runtime_data
    assert not runtime.episodes
    hass.states.async_set(
        "climate.room", "heat", {"current_temperature": 13, "temperature": 21}
    )
    await hass.async_block_till_done()
    assert not runtime.episodes
    assert len(runtime.temperature_monitors) == 1
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_captured_temperature_does_not_advance_persisted_producer_before_engine(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A callback arriving during locked I/O stays pending in both state owners."""
    attributes = {"device_class": "temperature", "unit_of_measurement": "°C"}
    hass.states.async_set("sensor.temperature", "10", attributes)
    configure(hass, config_entry, [limit_policy()])
    runtime = await start_monitor(hass, config_entry)
    node_id = next(iter(runtime.temperature_monitors))
    received = asyncio.Event()

    @callback
    def captured(event: Event[Any]) -> None:
        if event.data["entity_id"] == "sensor.temperature":
            received.set()

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, captured)
    async with runtime._lock:
        hass.states.async_set("sensor.temperature", "0", attributes)
        await received.wait()
        snapshot = runtime.snapshot()
        assert snapshot["temperature_monitors"][node_id] == {"active_reason": None}
        assert snapshot["episodes"] == {}
    cancel()
    await hass.async_block_till_done()
    assert len(runtime.episodes) == 1
    assert runtime.temperature_monitors[node_id].snapshot() == {
        "active_reason": "temperature_low"
    }
    assert await hass.config_entries.async_unload(config_entry.entry_id)
