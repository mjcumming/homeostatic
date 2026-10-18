"""Scenarios for truthful integration explanations across retries and recovery."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import Observation, Status
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.dashboard import DATA_DASHBOARD
from custom_components.homeostatic.evidence import ReportedEvidence
from tests.policy_helpers import (
    availability_policies,
    bound_identity,
    monitoring_policy,
)
from tests.test_lifecycle import start_monitor


@pytest.mark.parametrize(
    "state",
    [
        pytest.param(ConfigEntryState.SETUP_ERROR, id="setup-error"),
        pytest.param(ConfigEntryState.SETUP_RETRY, id="setup-retry"),
    ],
)
async def test_failure_retry_reload_and_confirmed_recovery(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
    state: ConfigEntryState,
) -> None:
    """An empty current finding does not erase a timestamped earlier failure."""
    source = MockConfigEntry(
        domain="test", title="Receiver", state=ConfigEntryState.LOADED
    )
    source.add_to_hass(hass)
    config_data.update(
        monitoring_policies=availability_policies(integrations=[source.entry_id]),
        notifications=False,
    )
    config_data["timings"].update(clear_hold=10, retry_hold=0)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = bound_identity(
        config_data["monitoring_policies"][0], f"entry:{source.entry_id}"
    )
    client = await hass_ws_client(hass)
    source._async_set_state(hass, state, "Connection timed out")
    await hass.async_block_till_done()
    episode = next(iter(runtime.episodes.values()))
    original = runtime.evidence.view(node_id)
    assert original is not None
    failure = original["last_failure"]
    assert isinstance(failure, dict)
    assert failure["message"] == "Connection timed out"
    freezer.tick(timedelta(seconds=2))
    source._async_set_state(hass, ConfigEntryState.SETUP_IN_PROGRESS, None)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.engine is not None
    before = runtime.engine.snapshot()
    await client.send_json({"id": 1, "type": "homeostatic/node", "node_id": node_id})
    detail = (await client.receive_json())["result"]
    assert detail["explanation"]["findings"] == []
    assert detail["readiness"]["answer"] == "unknown"
    assert detail["integration_evidence"]["current"]["reason"] == "setup_in_progress"
    assert detail["integration_evidence"]["last_failure"] == failure
    assert runtime.engine.snapshot() == before
    assert runtime.episodes[episode["episode_id"]]["opened_at"] == episode["opened_at"]
    assert (
        hass.data[DATA_DASHBOARD].value["inventory"]["integration_evidence"][node_id]
        == detail["integration_evidence"]
    )
    detail["integration_evidence"]["last_failure"]["message"] = "changed client copy"
    assert runtime.evidence.view(node_id)["last_failure"] == failure
    source._async_set_state(hass, ConfigEntryState.LOADED, None)
    await hass.async_block_till_done()
    assert runtime.evidence.view(node_id)["last_failure"] is None
    assert runtime.episodes
    freezer.tick(timedelta(seconds=11))
    await runtime.async_refresh()
    assert runtime.episodes == {}
    assert runtime.readiness == "ready"
    assert runtime.desired_notifications == set()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_disabled_source_stays_browsable_without_evidence_issue(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Disabled entries remain in Sources without a stale issue or evidence record."""
    source = MockConfigEntry(
        domain="test", title="Music", disabled_by=ConfigEntryDisabler.USER
    )
    source.add_to_hass(hass)
    config_data.update(
        monitoring_policies=availability_policies(integrations=[source.entry_id]),
        notifications=False,
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    node_id = f"entry:{source.entry_id}"
    freezer.tick(timedelta(seconds=31))
    await runtime.async_refresh()
    assert not runtime.episodes
    assert runtime.candidates[node_id].disabled
    assert not runtime.candidates[node_id].watched
    assert runtime.evidence.view(node_id) is None
    hass.config_entries.async_update_entry(
        entry, data={**config_data, "monitoring_policies": []}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.evidence.view(node_id) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param([], id="wrong-shape"),
        pytest.param(
            {
                "entry:a": {
                    "current": {
                        "reason": "loaded",
                        "message": "",
                        "observed_at": "2026-09-25T10:00:00",
                    },
                    "last_failure": None,
                }
            },
            id="naive-time",
        ),
        pytest.param(
            {
                "entry:a": {
                    "current": {
                        "reason": "setup_in_progress",
                        "message": "",
                        "observed_at": "2026-09-25T10:00:00+00:00",
                    },
                    "last_failure": {
                        "reason": "setup_error",
                        "message": "error",
                        "observed_at": "2026-09-25T11:00:00+00:00",
                    },
                }
            },
            id="future-failure",
        ),
    ],
)
def test_invalid_presentation_does_not_become_current_evidence(value: Any) -> None:
    """Corrupt timestamped context cannot invent a valid earlier failure."""
    evidence = ReportedEvidence()
    with pytest.raises((vol.Invalid, ValueError)):
        evidence.restore(value)
    assert evidence.snapshot() == {}


@pytest.mark.parametrize("legacy", [False, True], ids=["new-monitor", "upgrade"])
@pytest.mark.parametrize("known", [Status.PASS, Status.WARN, Status.FAIL])
def test_unknown_history_stays_incomplete_until_a_known_report(
    legacy: bool, known: Status
) -> None:
    """An absent old history differs from a new monitor with no earlier problem."""
    evidence = ReportedEvidence()
    if legacy:
        evidence.restore({}, history_complete=False)
    now = datetime(2026, 10, 16, tzinfo=UTC)

    def observation(status: Status, seconds: int) -> Observation:
        return Observation(
            node_id="vacuum:robot",
            check_id="vacuum",
            status=status,
            reason=status.value,
            observed_at=now + timedelta(seconds=seconds),
        )

    evidence.observe(observation(Status.UNKNOWN, 0), "Robot")
    assert evidence.view("vacuum:robot")["history_complete"] is not legacy
    restored = ReportedEvidence()
    restored.restore(evidence.snapshot())
    restored.observe(observation(Status.UNKNOWN, 1), "Robot")
    assert restored.view("vacuum:robot")["history_complete"] is not legacy
    restored.observe(observation(known, 2), "Robot")
    record = restored.view("vacuum:robot")
    assert record["history_complete"] is True
    assert (record["last_failure"] is None) is (known is Status.PASS)
    restored.observe(observation(Status.UNKNOWN, 3), "Robot")
    assert restored.view("vacuum:robot")["history_complete"] is True
    assert restored.view("vacuum:robot")["last_failure"] == record["last_failure"]


@pytest.mark.parametrize(
    ("status", "failure", "complete"),
    [
        (None, False, False),
        ("unknown", False, False),
        ("pass", False, True),
        ("warn", True, True),
        ("fail", True, True),
        ("unknown", True, True),
    ],
)
def test_legacy_record_infers_only_established_history(
    status: str | None, failure: bool, complete: bool
) -> None:
    """Old unknown records without a retained problem cannot prove no history."""
    current = {
        "reason": "activity",
        "message": "",
        "observed_at": "2026-10-16T00:00:00+00:00",
        "status": status,
    }
    evidence = ReportedEvidence()
    evidence.restore(
        {
            "vacuum:robot": {
                "current": current,
                "last_failure": current if failure else None,
            }
        }
    )
    assert evidence.view("vacuum:robot")["history_complete"] is complete


async def test_legacy_open_issue_keeps_incomplete_history_through_unknown_reload(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
) -> None:
    """An upgrade cannot recast an unresolved vacuum error as a waiting check."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "vacuum", "test", "legacy_robot", config_entry=owner
    )
    policy = monitoring_policy("robot", {"kind": ["vacuum"]}, check="vacuum")
    config_data.update(monitoring_policies=[policy], notifications=False)
    hass.states.async_set(entity.entity_id, "error")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    [episode_id] = runtime.episodes
    node_id = bound_identity(policy, f"vacuum:registry:{entity.id}")
    assert runtime.entity_status(node_id)["last_failure"]["reason"] == "vacuum_error"
    assert await hass.config_entries.async_unload(entry.entry_id)
    hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"].pop("evidence")
    hass.states.async_set(entity.entity_id, "unavailable")
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    for reload in (False, True):
        if reload:
            assert await hass.config_entries.async_reload(entry.entry_id)
            await hass.async_block_till_done()
        runtime = entry.runtime_data
        assert list(runtime.episodes) == [episode_id]
        assert (
            runtime.entity_status(node_id)["current"]["reason"] == "vacuum_unavailable"
        )
        assert "last_failure" not in runtime.entity_status(node_id)
        assert runtime.evidence.view(node_id)["history_complete"] is False
        assert (
            "last_failure"
            not in hass.data[DATA_DASHBOARD].value["inventory"]["entity_status"][
                node_id
            ]
        )
        assert not runtime.desired_notifications
    hass.states.async_set(entity.entity_id, "docked")
    await hass.async_block_till_done()
    assert runtime.episodes == {}
    assert runtime.entity_status(node_id)["last_failure"] is None
    assert runtime.evidence.view(node_id)["history_complete"] is True
    assert await hass.config_entries.async_unload(entry.entry_id)
