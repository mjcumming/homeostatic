"""Regression scenarios and the first function/situation delivery workflow."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
import voluptuous as vol
from freezegun.api import FrozenDateTimeFactory
from health_tree.types import EpisodeOpened
from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.homeostatic.config import Settings, data_from_input
from custom_components.homeostatic.const import DOMAIN, EVENT_NOTIFICATION
from tests.test_lifecycle import start_monitor


async def test_retry_attempt_preserves_failure_duration(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A failed retry attempt must not restart the warning period."""
    source = MockConfigEntry(domain="test", state=ConfigEntryState.SETUP_RETRY)
    source.add_to_hass(hass)
    config_data.update(entities=[], config_entries=[source.entry_id])
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    onset = deepcopy(runtime.retry_since)
    freezer.tick(timedelta(seconds=15))
    source._async_set_state(hass, ConfigEntryState.SETUP_IN_PROGRESS, None)
    await hass.async_block_till_done()
    source._async_set_state(hass, ConfigEntryState.SETUP_RETRY, "still unavailable")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=6))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert runtime.retry_since == onset
    assert runtime.readiness == "blocked"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_source_transition_survives_storage_wait(
    hass: HomeAssistant, config_entry: MockConfigEntry, freezer: FrozenDateTimeFactory
) -> None:
    """An outage during a disk write remains an observed episode."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    storage_entered, storage_release = asyncio.Event(), asyncio.Event()
    failure_arrived, recovery_arrived = asyncio.Event(), asyncio.Event()
    original_save = runtime._save

    async def slow_save() -> None:
        storage_entered.set()
        await storage_release.wait()
        await original_save()

    @callback
    def saw_state(event: Event[Any]) -> None:
        if event.data["entity_id"] == "sensor.observed":
            signal = (
                failure_arrived
                if event.data["new_state"].state == "unavailable"
                else recovery_arrived
            )
            signal.set()

    cancel = hass.bus.async_listen(EVENT_STATE_CHANGED, saw_state)
    with (
        patch.object(runtime, "_save", side_effect=slow_save),
        patch.object(runtime, "_handle", wraps=runtime._handle) as handle,
    ):
        in_progress = hass.async_create_task(runtime.async_refresh())
        await storage_entered.wait()
        hass.states.async_set("sensor.observed", "unavailable")
        await failure_arrived.wait()
        freezer.tick(timedelta(seconds=10))
        hass.states.async_set("sensor.observed", "43")
        await recovery_arrived.wait()
        storage_release.set()
        await in_progress
        await hass.async_block_till_done()
    cancel()
    openings = [
        event
        for call in handle.call_args_list
        for event in call.args[0]
        if isinstance(event, EpisodeOpened)
    ]
    assert len(openings) == 1
    assert runtime.readiness == "ready"
    assert not runtime.episodes
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_unknown_preserves_requested_failure_content(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Unknown evidence must not erase a message without a policy delivery."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    before = deepcopy(runtime.delivery.messages)
    hass.states.async_set("sensor.observed", "unknown")
    await hass.async_block_till_done()
    assert runtime.delivery.messages == before
    assert len(runtime.episodes) == 1
    assert runtime.readiness == "unknown"
    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.runtime_data.delivery.messages == before
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_final_save_failure_completes_cleanup(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Storage failure is visible without retaining a stopped loaded runtime."""
    runtime = await start_monitor(hass, config_entry)
    with patch.object(
        runtime.store, "async_save", side_effect=OSError("disk unavailable")
    ):
        assert await hass.config_entries.async_unload(config_entry.entry_id)
    assert config_entry.state is ConfigEntryState.NOT_LOADED
    assert not runtime.running
    assert not hass.services.has_service(DOMAIN, "inventory")
    assert runtime._deadline_cancel is None
    assert (
        f"{DOMAIN}_{config_entry.entry_id}_error"
        in hass.data[persistent_notification.DOMAIN]
    )


async def test_function_readiness_and_named_delivery(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """A function enrolls its requirement and leads the notification text."""
    registered = er.async_get(hass).async_get_or_create("sensor", "test", "controller")
    config_data["entities"] = []
    config_data["functions"] = [
        {
            "id": "garage",
            "name": "Garage access",
            "importance": "critical",
            "entities": [f"registry:{registered.id}"],
        }
    ]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events: list[Event[Any]] = []
    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, events.append)
    hass.states.async_set(registered.entity_id, "42")
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "ready"
    assert runtime.evidence_gaps == 0
    assert hass.states.get("sensor.homeostatic_garage_access").state == "ready"
    hass.states.async_set(registered.entity_id, "unavailable")
    await hass.async_block_till_done()
    assert hass.states.get("sensor.homeostatic_garage_access").state == "blocked"
    assert events[-1].data["title"] == "Garage access: blocked"
    assert events[-1].data["loudness"] == "urgent"
    assert events[-1].data["functions"] == ["Garage access"]
    old_id = next(iter(runtime.episodes))
    er.async_get(hass).async_update_entity(
        registered.entity_id, new_entity_id="sensor.renamed_requirement"
    )
    hass.states.async_set("sensor.renamed_requirement", "unavailable")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [old_id]
    assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()


@pytest.mark.parametrize(
    "state,attributes,episodes",
    [
        pytest.param("on", {}, 1, id="active"),
        pytest.param("off", {}, 0, id="clear"),
        pytest.param("unavailable", {}, 0, id="unavailable"),
        pytest.param("unknown", {}, 0, id="unknown"),
        pytest.param("unexpected", {}, 0, id="invalid-state"),
        pytest.param("on", {"restored": True}, 0, id="restored"),
    ],
)
async def test_situation_does_not_block_function(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    state: str,
    attributes: dict[str, Any],
    episodes: int,
) -> None:
    """An independently reported situation never becomes a function dependency."""
    config_data["functions"] = [
        {
            "id": "lighting",
            "name": "Lighting",
            "entities": ["entity_id:sensor.observed"],
        }
    ]
    config_data["situations"] = [
        {
            "id": "door",
            "name": "Door open",
            "entity": "entity_id:binary_sensor.door_rule",
        }
    ]
    hass.states.async_set("sensor.observed", "42")
    hass.states.async_set("binary_sensor.door_rule", state, attributes)
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    assert runtime.readiness == "ready"
    assert len(runtime.episodes) == episodes
    assert runtime.engine.impact("situation:door").nodes == ()
    assert "situation:door" not in runtime.targets
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_situation_unknown_restart_and_clear(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Loss of the reporting entity cannot clear an active situation."""
    config_data.update(
        entities=[],
        situations=[
            {
                "id": "door",
                "name": "Door open",
                "entity": "entity_id:binary_sensor.door_rule",
            }
        ],
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events: list[Event[Any]] = []
    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, events.append)
    hass.states.async_set("binary_sensor.door_rule", "on")
    runtime = await start_monitor(hass, entry)
    episode_id = next(iter(runtime.episodes))
    hass.states.async_set("binary_sensor.door_rule", "unavailable")
    await hass.async_block_till_done()
    assert list(runtime.episodes) == [episode_id]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert list(entry.runtime_data.episodes) == [episode_id]
    hass.states.async_set("binary_sensor.door_rule", "off")
    await hass.async_block_till_done()
    assert not entry.runtime_data.episodes
    assert [event.data["action"] for event in events] == ["open", "resolve"]
    assert events[-1].data["episode_id"] == episode_id
    assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()


async def test_notification_activation_is_one_summary(
    hass: HomeAssistant, config_data: dict[str, Any]
) -> None:
    """Activating existing problems sends one summary, then live changes."""
    config_data["notifications"] = False
    config_data["entities"] = ["entity_id:sensor.observed", "entity_id:sensor.other"]
    hass.states.async_set("sensor.observed", "unavailable")
    hass.states.async_set("sensor.other", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    events: list[Event[Any]] = []
    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, events.append)
    runtime = await start_monitor(hass, entry)
    assert len(runtime.episodes) == 2
    assert not events
    options = {**config_data, "notifications": True}
    hass.config_entries.async_update_entry(entry, options=options)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["summary"]
    assert len(events[0].data["episodes"]) == 2
    hass.states.async_set("sensor.observed", "42")
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["summary", "update"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["summary", "update"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()


async def test_disabled_consumer_is_a_visible_gap(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A disabled consumer must not leave notification coverage looking complete."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    assert not runtime.consumer_missing
    hass.states.async_set("automation.homeostatic_test_consumer", "off")
    await hass.async_block_till_done()
    assert runtime.consumer_missing
    assert runtime.evidence_gaps == 1
    assert runtime.query("coverage", {})["notification_consumer_missing"] is True
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_form_binds_stable_definitions(hass: HomeAssistant) -> None:
    """Native structured input stores stable source ids and defaults to quiet."""
    registered = er.async_get(hass).async_get_or_create("binary_sensor", "test", "door")
    data = data_from_input(
        hass,
        {
            "functions": [
                {
                    "id": "door_hardware",
                    "name": "Door sensor",
                    "entities": [registered.entity_id],
                }
            ],
            "situations": [
                {"id": "open_door", "name": "Door open", "entity": registered.entity_id}
            ],
        },
    )
    settings = Settings.from_data(data)
    assert settings.functions[0].entities == (f"registry:{registered.id}",)
    assert settings.situations[0].entity == f"registry:{registered.id}"
    assert not settings.notifications


@pytest.mark.parametrize(
    "data",
    [
        pytest.param({"functions": {}}, id="not-list"),
        pytest.param({"functions": [42]}, id="not-object"),
        pytest.param(
            {
                "functions": [
                    {"id": "bad id", "name": "Bad", "entities": ["entity_id:sensor.a"]}
                ]
            },
            id="invalid-id",
        ),
        pytest.param(
            {"situations": [{"id": "a", "name": "", "entity": "entity_id:sensor.a"}]},
            id="missing-name",
        ),
        pytest.param(
            {"situations": [{"id": "a", "name": "A", "entity": "function:a"}]},
            id="situation-edge",
        ),
        pytest.param(
            {
                "situations": [
                    {
                        "id": "a",
                        "name": "A",
                        "entity": "entity_id:sensor.a",
                        "depends_on": [],
                    }
                ]
            },
            id="arbitrary-edges",
        ),
        pytest.param(
            {
                "functions": [
                    {
                        "id": "a",
                        "name": "A",
                        "importance": "invalid",
                        "entities": ["entity_id:sensor.a"],
                    }
                ]
            },
            id="importance",
        ),
        pytest.param({"consumer": "sensor.a"}, id="consumer-domain"),
    ],
)
def test_invalid_definitions(data: dict[str, Any]) -> None:
    """Reject invalid graph/configuration inputs at the boundary."""
    with pytest.raises(ValueError):
        Settings.from_data(data)


@pytest.mark.parametrize(
    "data",
    [
        pytest.param({"functions": {}}, id="object-not-list"),
        pytest.param({"functions": [42]}, id="row-not-object"),
        pytest.param(
            {"functions": [{"id": "a", "name": "A", "entities": "sensor.a"}]},
            id="entities-not-list",
        ),
        pytest.param(
            {
                "situations": [
                    {"id": "a", "name": "A", "entity": "sensor.homeostatic_owned"}
                ]
            },
            id="self-reference",
        ),
        pytest.param({"notifications": True}, id="no-consumer"),
        pytest.param(
            {"notifications": True, "consumer": "sensor.a"}, id="invalid-consumer"
        ),
    ],
)
async def test_bad_form_input_is_rejected(
    hass: HomeAssistant, data: dict[str, Any]
) -> None:
    """Invalid structured input cannot create an unusable integration entry."""
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "owned", suggested_object_id="homeostatic_owned"
    )
    with pytest.raises((ValueError, vol.Invalid)):
        data_from_input(hass, data)


async def test_pending_openings_are_summarized_once(
    hass: HomeAssistant, config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> None:
    """A pre-activation batch timer must not replay a summarized opening."""
    config_data["notifications"] = False
    config_data["timings"]["batch"] = 10
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    events: list[Event[Any]] = []
    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, events.append)
    hass.config_entries.async_update_entry(
        entry, options={**config_data, "notifications": True}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=11))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert [event.data["action"] for event in events] == ["summary"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    cancel()


@pytest.mark.parametrize(
    "next_state,actions,same_id",
    [
        pytest.param("unavailable", ["open", "open"], True, id="retry"),
        pytest.param(
            "42", ["open", "resolve"], False, id="recovered-after-publication"
        ),
    ],
)
async def test_outbox_replays_same_id_after_ack_failure(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    next_state: str,
    actions: list[str],
    same_id: bool,
) -> None:
    """Publication without a durable acknowledgement can retry or clear safely."""
    hass.states.async_set("sensor.observed", "42")
    runtime = await start_monitor(hass, config_entry)
    events: list[Event[Any]] = []
    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, events.append)
    original_save = runtime._save

    async def fail_acknowledgement() -> None:
        raise OSError("acknowledgement failed")

    saves = iter((original_save, fail_acknowledgement))

    async def save_once() -> None:
        await next(saves)()

    with patch.object(runtime, "_save", side_effect=save_once):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
    assert not runtime.available
    assert len(events) == 1
    assert len(runtime.delivery.outbox) == 1
    hass.states.async_set("sensor.observed", next_state)
    await hass.async_block_till_done()
    await runtime.async_refresh()
    await hass.async_block_till_done()
    assert runtime.available
    assert len(events) == 2
    assert [event.data["action"] for event in events] == actions
    assert (events[0].data["delivery_id"] == events[1].data["delivery_id"]) is same_id
    assert not runtime.delivery.outbox
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    cancel()


async def test_original_store_migrates_without_new_episode(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """The initial development store upgrades and withdraws legacy native messages."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    data["schema_version"] = 1
    del data["delivery"], data["notifications_enabled"]
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    restored = config_entry.runtime_data
    assert list(restored.episodes) == [episode_id]
    assert restored.snapshot()["schema_version"] == 2
    assert (
        runtime.notification_id(episode_id)
        not in hass.data[persistent_notification.DOMAIN]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)


@pytest.mark.parametrize(
    "override",
    [
        pytest.param({"sequence": -1}, id="sequence"),
        pytest.param({"messages": []}, id="message-collection"),
        pytest.param({"outbox": [{}]}, id="payload"),
        pytest.param(
            {
                "outbox": [
                    {
                        "schema_version": 1,
                        "episode_id": "a",
                        "recipient": "owner",
                        "action": "open",
                        "title": "A",
                        "message": "failed",
                        "tag": "a",
                    }
                ]
            },
            id="missing-delivery-id",
        ),
    ],
)
async def test_invalid_delivery_store_is_preserved(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    override: dict[str, Any],
) -> None:
    """Bad delivery state cannot silently drop outstanding requests."""
    await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    data["delivery"].update(override)
    original = deepcopy(data)
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"] == original


@pytest.mark.parametrize(
    "override",
    [
        pytest.param({"schema_version": 999}, id="unknown-schema"),
        pytest.param({"notifications_enabled": "yes"}, id="invalid-activation"),
    ],
)
async def test_invalid_current_envelope_is_preserved(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_storage: dict[str, Any],
    override: dict[str, Any],
) -> None:
    """Current storage metadata is validated before runtime startup."""
    await start_monitor(hass, config_entry)
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    data.update(override)
    original = deepcopy(data)
    assert not await hass.config_entries.async_setup(config_entry.entry_id)
    assert hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"] == original


@pytest.mark.parametrize(
    "selection",
    [
        pytest.param({"entities": ["registry:SELF"]}, id="entity"),
        pytest.param({"config_entries": ["monitor"]}, id="integration"),
        pytest.param(
            {
                "situations": [
                    {"id": "bad", "name": "Self alert", "entity": "registry:SELF"}
                ]
            },
            id="situation",
        ),
    ],
)
async def test_stored_self_bindings_cannot_start(
    hass: HomeAssistant, config_data: dict[str, Any], selection: dict[str, Any]
) -> None:
    """Externally edited storage cannot bypass self-monitoring validation."""
    import json

    entry = MockConfigEntry(domain=DOMAIN, entry_id="monitor", data=config_data)
    entry.add_to_hass(hass)
    registered = er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "owned", config_entry=entry
    )
    invalid = {
        **config_data,
        **json.loads(json.dumps(selection).replace("SELF", registered.id)),
    }
    hass.config_entries.async_update_entry(entry, data=invalid)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_start()
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert not runtime.available
    assert "own" in runtime.error or "itself" in runtime.error
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_remove_original_store_cleans_legacy_message(
    hass: HomeAssistant, config_entry: MockConfigEntry, hass_storage: dict[str, Any]
) -> None:
    """Removing an unloaded original development entry cleans its native message."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    episode_id = next(iter(runtime.episodes))
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    data = hass_storage[f"{DOMAIN}.{config_entry.entry_id}"]["data"]
    data["schema_version"] = 1
    assert await hass.config_entries.async_remove(config_entry.entry_id)
    assert (
        runtime.notification_id(episode_id)
        not in hass.data[persistent_notification.DOMAIN]
    )


async def test_stop_during_save_cannot_rearm_timer(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """An in-flight refresh cannot schedule work after shutdown begins."""
    runtime = await start_monitor(hass, config_entry)
    entered, release = asyncio.Event(), asyncio.Event()
    original_save = runtime._save

    async def wait_for_storage() -> None:
        entered.set()
        await release.wait()
        await original_save()

    with patch.object(runtime, "_save", side_effect=wait_for_storage):
        refresh = hass.async_create_task(runtime.async_refresh())
        await entered.wait()
        stopping = hass.async_create_task(runtime.async_stop())
        hass.loop.call_soon(release.set)
        await asyncio.gather(refresh, stopping)
    assert not runtime.running
    assert runtime._deadline_cancel is None
    assert not runtime._subscriptions
    assert await hass.config_entries.async_unload(config_entry.entry_id)
