"""Executable UPS timelines and HA registry identity boundaries."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.homeostatic import notification_definitions
from custom_components.homeostatic.catalog import Source
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.enrollment import inventory
from custom_components.homeostatic.monitoring import parse_policies
from custom_components.homeostatic.monitoring_runtime import (
    transfer_batteries,
    ups_sources,
)
from custom_components.homeostatic.runtime import Runtime
from custom_components.homeostatic.ups import MAPPINGS, UpsMonitor, measurement
from custom_components.homeostatic.ups_parameters import ReserveParameters

NOW = datetime(2026, 10, 13, tzinfo=UTC)
SCENARIOS = yaml.safe_load(
    (Path(__file__).parent / "fixtures" / "ups.yaml").read_text(encoding="utf-8")
)
ROLES = ("status", "charge", "runtime", "charge_low", "runtime_low", "charging")


def _run_scenario(scenario: dict[str, Any]) -> None:
    source = Source(
        node_id="ups:test",
        name="Office UPS",
        kind="ups",
        check_id=scenario["check"],
        ups_platform=scenario.get("platform", "nut"),
        ups_entities=tuple((role, f"sensor.{role}") for role in ROLES),
    )
    parameters = ReserveParameters.from_data(scenario.get("parameters", {}))
    monitor = UpsMonitor(source=source, parameters=parameters)
    units = {
        "charge": "%",
        "charge_low": "%",
        "runtime": scenario.get("runtime_unit", "s"),
        "runtime_low": scenario.get("runtime_unit", "s"),
    }
    for step in scenario["steps"]:
        if step.get("restart"):
            saved = monitor.snapshot()
            monitor = UpsMonitor(source=source, parameters=parameters)
            monitor.restore(saved)
        states = {
            role: State(
                f"sensor.{role}", str(value), {"unit_of_measurement": units.get(role)}
            )
            for role, value in step["states"].items()
        }
        observation = monitor.evaluate(states, NOW + timedelta(seconds=step["at"]))
        assert observation.status.value == step["status"], step
        assert observation.reason == step["reason"], step


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[row["id"] for row in SCENARIOS])
def test_ups_scenarios(scenario: dict[str, Any]) -> None:
    """Use the same producer for every integration and condition timeline."""
    _run_scenario(scenario)


@pytest.mark.parametrize(
    "parameters",
    [
        pytest.param({"charge_low": 20}, id="unpaired"),
        pytest.param({"charge_low": 20, "charge_clear": 20}, id="no-hysteresis"),
        pytest.param({"charge_low": -1, "charge_clear": 30}, id="negative"),
        pytest.param({"charge_low": True, "charge_clear": 30}, id="boolean"),
        pytest.param({"charge_low": 20, "charge_clear": 101}, id="outside-percentage"),
        pytest.param({"charge_low": 20, "charge_clear": float("nan")}, id="nan"),
        pytest.param({"replace_battery_check": "yes"}, id="invalid-transfer"),
        pytest.param({"extra": 2}, id="unknown-field"),
    ],
)
def test_invalid_thresholds(parameters: dict[str, Any]) -> None:
    """Reject ambiguous thresholds before monitoring can be enabled."""
    with pytest.raises(ValueError):
        ReserveParameters.from_data(parameters)


@pytest.mark.parametrize(
    "value,unit,role,expected",
    [
        pytest.param("600", "s", "runtime", 10, id="seconds"),
        pytest.param("10", "min", "runtime", 10, id="minutes"),
        pytest.param("1", "h", "runtime", 60, id="hours"),
        pytest.param("600", None, "runtime", None, id="ambiguous-unit"),
        pytest.param("nan", "%", "charge", None, id="not-finite"),
        pytest.param("101", "%", "charge", None, id="invalid-percentage"),
        pytest.param("50", "V", "charge", None, id="wrong-role-unit"),
        pytest.param("unavailable", "%", "charge", None, id="unavailable"),
    ],
)
def test_measurements(
    value: str, unit: str | None, role: str, expected: float | None
) -> None:
    """Units establish the numeric shape of a verified role."""
    assert (
        measurement(State("sensor.signal", value, {"unit_of_measurement": unit}), role)
        == expected
    )


@pytest.mark.parametrize("platform", ["nut", "apcupsd"])
async def test_registry_mapping_and_pairing(hass: HomeAssistant, platform: str) -> None:
    """Two devices on one entry keep identities and pair only their own roles."""
    owner = MockConfigEntry(domain=platform, state=ConfigEntryState.NOT_LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    for identity in ("office", "network"):
        device = devices.async_get_or_create(
            config_entry_id=owner.entry_id,
            identifiers={(platform, identity)},
            name=f"{identity} UPS",
        )
        for role in ("status", "charge", "runtime"):
            entity = registry.async_get_or_create(
                "sensor",
                platform,
                f"{identity}_{MAPPINGS[platform][role]}",
                config_entry=owner,
                device_id=device.id,
                original_device_class="battery" if role == "charge" else None,
            )
            hass.states.async_set(entity.entity_id, "50", {"unit_of_measurement": "%"})
    sources = inventory(hass, Settings.from_data({}), {})
    ups = [source for source in sources.values() if source.kind == "ups"]
    assert len(ups) == 8
    assert {source.ups_name for source in ups} == {"office UPS", "network UPS"}
    assert all(source.watched is False for source in ups)
    assert all(len(source.ups_entities) == 3 for source in ups)
    assert all(source.node(Settings.from_data({})).depends_on == () for source in ups)


def test_reviewed_battery_transfer() -> None:
    """The same percentage needs an explicit ownership transfer before enrollment."""
    source = Source(
        node_id="ups:reserve",
        name="Office",
        kind="ups",
        check_id="ups_reserve",
        ups_entities=(("charge", "sensor.charge"),),
        attributes={"kind": ("ups",)},
        ups_name="Office",
    )
    battery = Source(
        node_id="battery:charge",
        name="Battery",
        kind="battery",
        battery_level_entity="sensor.charge",
    )
    definitions = [
        {
            "id": "reserve",
            "name": "Reserve",
            "check": "ups_reserve",
            "match": {"kind": "ups"},
            "enabled": True,
        }
    ]
    policies = parse_policies(definitions)
    candidates = {source.node_id: source, battery.node_id: battery}
    with pytest.raises(ValueError, match="transfer"):
        transfer_batteries(policies, candidates, ups_sources(policies, candidates))
    policies = parse_policies(
        [{**definitions[0], "parameters": {"replace_battery_check": True}}]
    )
    transferred = transfer_batteries(
        policies, candidates, ups_sources(policies, candidates)
    )
    assert transferred[battery.node_id].watched is False
    assert candidates[battery.node_id].watched is True
    disabled = parse_policies(
        [
            {
                **definitions[0],
                "enabled": False,
                "parameters": {"replace_battery_check": True},
            }
        ]
    )
    assert (
        transfer_batteries(disabled, candidates, {})[battery.node_id].watched is False
    )


async def test_runtime_reserve_escalation_and_restart(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """Mode escalation renews awareness without clearing low reserve on charging."""
    entry = config_entry
    owner = MockConfigEntry(domain="nut", state=ConfigEntryState.NOT_LOADED)
    owner.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=owner.entry_id,
        identifiers={("nut", "office")},
        name="Office UPS",
    )
    registry = er.async_get(hass)
    status = registry.async_get_or_create(
        "sensor", "nut", "office_ups.status", config_entry=owner, device_id=device.id
    )
    charge = registry.async_get_or_create(
        "sensor",
        "nut",
        "office_battery.charge",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
    )
    hass.states.async_set(status.entity_id, "OL")
    hass.states.async_set(charge.entity_id, "10", {"unit_of_measurement": "%"})
    definitions = notification_definitions.defaults()
    definitions["methods"]["phone"] = {
        "name": "Phone",
        "mode": "fixed",
        "destinations": ["phone:test"],
    }
    reserve = {
        "id": "reserve",
        "name": "UPS reserve",
        "check": "ups_reserve",
        "match": {"kind": "ups"},
        "enabled": True,
        "parameters": {"charge_low": 20, "charge_clear": 30},
        "notifications": [
            {
                "id": "mains",
                "schedule": "morning",
                "methods": ["phone"],
                "when": "mains",
            },
            {
                "id": "backup",
                "schedule": "acknowledge",
                "methods": ["phone"],
                "when": "backup",
            },
        ],
    }
    power = {
        "id": "power",
        "name": "UPS power",
        "check": "ups_power",
        "match": {"kind": "ups"},
        "enabled": True,
    }
    entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        entry,
        data={
            **entry.data,
            "entities": [],
            "rules": [],
            "monitoring_policies": [reserve, power],
            "notification_definitions": definitions,
        },
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    runtime: Runtime = entry.runtime_data
    assert runtime.policy is not None
    reserve_source = next(
        source
        for source in runtime.sources.values()
        if source.monitoring_policy == "reserve"
    )
    issue = next(
        identity
        for identity, episode in runtime.episodes.items()
        if episode["anchor"] == reserve_source.node_id
    )
    assert (
        runtime.policy.explain(issue)["routes"]["policy_reserve_mains"]["loudness"]
        == "digest"
    )
    runtime.policy.acknowledge(issue, dt_util.utcnow())
    freezer.tick(timedelta(seconds=1))
    hass.states.async_set(status.entity_id, "OB")
    await hass.async_block_till_done()
    assert issue in runtime.episodes
    assert runtime.policy.acknowledgment(issue) is None
    assert (
        runtime.policy.explain(issue)["routes"]["policy_reserve_backup"]["loudness"]
        == "urgent"
    )
    freezer.tick(timedelta(seconds=1))
    hass.states.async_set(status.entity_id, "OL CHRG")
    await hass.async_block_till_done()
    assert issue in runtime.episodes
    assert (
        runtime.policy.explain(issue)["routes"]["policy_reserve_backup"]["loudness"]
        == "record"
    )
    registry.async_remove(charge.entity_id)
    await hass.async_block_till_done()
    assert issue in runtime.episodes
    assert runtime.ups_monitors[reserve_source.node_id].latest.status.value == "unknown"
    hass.states.async_set(charge.entity_id, "100", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert issue in runtime.episodes
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert issue in runtime.episodes
    freezer.tick(timedelta(seconds=1))
    charge = registry.async_get_or_create(
        "sensor",
        "nut",
        "office_battery.charge",
        config_entry=owner,
        device_id=device.id,
        original_device_class="battery",
    )
    hass.states.async_set(charge.entity_id, "35", {"unit_of_measurement": "%"})
    await hass.async_block_till_done()
    assert issue not in runtime.episodes
