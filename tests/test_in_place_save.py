"""In-place save scenarios using isolated HA storage and transport."""

import asyncio
from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import Event, HomeAssistant, callback
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import dashboard, notification_definitions
from custom_components.homeostatic.const import DOMAIN
from tests.policy_helpers import monitoring_policy
from tests.test_lifecycle import start_monitor


def policy(identity: str, entities: list[str]) -> dict[str, Any]:
    """Create independent availability expectations with a stable reporting row."""
    return {
        "id": identity,
        "name": identity,
        "check": "availability",
        "enabled": True,
        "match": {
            "kind": ["entity"],
            "entity": [f"entity_id:{entity}" for entity in entities],
        },
        "parameters": {},
        "notifications": [
            {
                "id": "urgent",
                "timing": {"mode": "acknowledge", "remind_every": "30m"},
                "methods": ["phone"],
            }
        ],
    }


async def test_monitoring_save_preserves_other_episodes_clocks_and_history(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Bulk removal retains an unrelated issue and its delivery and reminder identity."""
    definitions = notification_definitions.defaults()
    definitions["methods"] = {
        "phone": {"name": "Phone", "mode": "fixed", "destinations": ["phone:owner"]}
    }
    entities = ["sensor.observed", "sensor.second", "sensor.retained"]
    for entity in entities:
        hass.states.async_set(entity, "unavailable")
    config_data.update(
        monitoring_policy_version=1,
        monitoring_policies=[
            policy("edited", entities[:2]),
            policy("retained", entities[2:]),
        ],
        notification_definitions=definitions,
        policy=notification_definitions.generate(definitions),
    )
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with patch(
        "custom_components.homeostatic.notifications.async_send", new=AsyncMock()
    ):
        runtime = await start_monitor(hass, entry)
        client = await hass_ws_client(hass)
        retained_id = next(
            key
            for key, episode in runtime.episodes.items()
            if ":retained:" in str(episode["anchor"])
        )
        retained = deepcopy(runtime.episodes[retained_id])
        assert runtime.policy is not None
        before = deepcopy(runtime.policy.explain(retained_id))
        delivery = deepcopy(
            [
                row
                for row in runtime.notifications.delivery.messages.values()
                if row["episode_id"] == retained_id
            ]
        )
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        draft["monitoring_policies"][0]["enabled"] = False
        with patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("ordinary save must not reload"),
        ):
            await client.send_json(
                {
                    "id": 2,
                    "type": "homeostatic/save_settings",
                    "revision": configuration["revision"],
                    "settings": draft,
                }
            )
            assert (await client.receive_json())["result"] == {"saved": True}
        assert entry.runtime_data is runtime
        assert runtime.episodes == {retained_id: retained}
        after_delivery = [
            row
            for row in runtime.notifications.delivery.messages.values()
            if row["episode_id"] == retained_id
        ]
        assert {
            key: (delivery[0].get(key), after_delivery[0].get(key))
            for key in delivery[0].keys() | after_delivery[0].keys()
            if delivery[0].get(key) != after_delivery[0].get(key)
        } == {}
        clocks = (
            "opened_at",
            "attention_since",
            "pending",
            "last_sent",
            "sent_to",
            "acknowledgment",
        )
        retained_route = runtime.policy.explain(retained_id)["routes"][
            "policy_retained_urgent"
        ]
        before_route = before["routes"]["policy_retained_urgent"]
        assert {key: retained_route[key] for key in clocks} == {
            key: before_route[key] for key in clocks
        }
        assert len(runtime.history.snapshot()["episodes"]) == 2
        assert {
            row["resolution"] for row in runtime.history.snapshot()["episodes"]
        } == {"removed"}
        assert hass.data[dashboard.DATA_DASHBOARD].value["available"]
        assert await hass.config_entries.async_unload(entry.entry_id)
        await client.close()


@pytest.mark.parametrize("edit", ["monitoring", "profile", "method"])
@pytest.mark.parametrize("failure", ["write", "verification"])
async def test_failed_durable_save_reloads_from_the_store(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
    failure: str,
    edit: str,
) -> None:
    """A failed write or verification answers with an error and reloads the saved state (ADR 0100)."""
    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    # The last write is not known to be current, so this save writes (ADR 0097).
    runtime._stored_digest = None
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    before = deepcopy(runtime.snapshot())
    draft = configuration["settings"]
    targets = {
        "monitoring": draft["monitoring_policies"][0],
        "profile": draft["notification_definitions"]["profiles"]["morning"],
        "method": draft["notification_definitions"]["methods"]["test"],
    }
    targets[edit].update(
        {
            "monitoring": {"enabled": False},
            "profile": {"name": "Renamed"},
            "method": {"destinations": ["service:changed_test"]},
        }[edit]
    )
    save = runtime.store.async_save

    async def failing_save(data: dict[str, Any]) -> None:
        raise OSError("Test storage failure")

    load = runtime.store.async_load
    reads = 0

    async def failing_verification() -> dict[str, Any] | None:
        nonlocal reads
        reads += 1
        data = await load()
        return {} if reads == 1 else data

    with (
        patch.object(
            runtime.store,
            "async_save",
            side_effect=failing_save if failure == "write" else save,
        ),
        patch.object(
            runtime.store,
            "async_load",
            side_effect=failing_verification if failure == "verification" else load,
        ),
    ):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        response = await client.receive_json()
        assert response["error"]["code"] == "apply_failed"
        assert not config_entry.options
        # Until the reload completes, reads see the saved settings and no monitoring.
        assert runtime.settings.monitoring_policies[0].enabled
        assert not runtime.available
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    reloaded = config_entry.runtime_data
    assert reloaded is not runtime
    assert reloaded.available
    assert reloaded.settings.monitoring_policies[0].enabled
    assert reloaded.settings == runtime.settings
    if failure == "write":
        assert reloaded.snapshot()["episodes"] == before["episodes"]
        assert reloaded.snapshot()["delivery"] == before["delivery"]
    assert set(reloaded.snapshot()["monitoring_identities"]) == set(
        before["monitoring_identities"]
    )
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


@pytest.mark.parametrize("edit", ["monitoring", "profile", "method"])
async def test_save_keeps_observations_queued_during_io(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: str,
) -> None:
    """A transient outage captured during a save is observed before current recovery."""
    config_data.update(
        monitoring_policies=[
            monitoring_policy(
                identity,
                {"kind": ["entity"], "entity": [f"entity_id:sensor.{identity}"]},
            )
            for identity in ("observed", "other")
        ],
        notifications=False,
    )
    hass.states.async_set("sensor.observed", "1")
    hass.states.async_set("sensor.other", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    # The last write is not known to be current, so this save writes (ADR 0097).
    runtime._stored_digest = None
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    targets = {
        "monitoring": draft["monitoring_policies"][0],
        "profile": draft["notification_definitions"]["profiles"]["morning"],
        "method": draft["notification_definitions"]["methods"]["test"],
    }
    targets[edit].update(
        {
            "monitoring": {"enabled": False},
            "profile": {"name": "Renamed"},
            "method": {"destinations": ["service:changed_test"]},
        }[edit]
    )
    save = runtime.store.async_save
    calls = 0

    async def capture(data: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        await save(data)
        if calls == 1:
            hass.states.async_set("sensor.other", "unavailable")
            hass.states.async_set("sensor.other", "2")
            processed = asyncio.Event()
            hass.loop.call_soon(processed.set)
            await processed.wait()

    with patch.object(runtime.store, "async_save", side_effect=capture):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["result"] == {"saved": True}
        await hass.async_block_till_done()
    assert not runtime.episodes
    assert len(runtime.history.snapshot()["episodes"]) == 1
    assert not runtime._pending
    assert runtime.available
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_concurrent_saves_serialize_and_reject_the_later_stale_draft(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A second tab cannot apply its old revision during the first durable save."""
    hass.states.async_set("sensor.observed", "1")
    runtime = await start_monitor(hass, config_entry)
    first, second = await hass_ws_client(hass), await hass_ws_client(hass)
    await first.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await first.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["enabled"] = False
    saving, release = asyncio.Event(), asyncio.Event()
    save = runtime.store.async_save

    async def hold(data: dict[str, Any]) -> None:
        saving.set()
        await release.wait()
        await save(data)

    with patch.object(runtime.store, "async_save", side_effect=hold):
        await first.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        await saving.wait()
        await second.send_json(
            {
                "id": 1,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        release.set()
        assert (await first.receive_json())["result"] == {"saved": True}
        assert (await second.receive_json())["error"]["code"] == "stale_configuration"
    assert config_entry.runtime_data is runtime
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await first.close()
    await second.close()


async def test_validation_cannot_overwrite_an_external_revision_change(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A revision changed while people/routes are validated remains authoritative."""
    await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    validate = dashboard._settings_candidate

    async def changed(
        hass: HomeAssistant, current: dict[str, Any], proposed: dict[str, Any]
    ) -> dict[str, Any]:
        result = await validate(hass, current, proposed)
        hass.config_entries.async_update_entry(
            config_entry, options={**current, "external_marker": "preserved"}
        )
        return result

    with patch.object(dashboard, "_settings_candidate", side_effect=changed):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": configuration["settings"],
            }
        )
        assert (await client.receive_json())["error"]["code"] == "stale_configuration"
    assert config_entry.options["external_marker"] == "preserved"
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()


async def test_failed_outbox_cleanup_never_reuses_a_published_delivery_id(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A request already published before an I/O error keeps a unique identity.

    The store written before publishing holds the ids the outbox assigned, so
    the reload after the failed cleanup replays the same request under the same
    id and gives later requests new ones (ADR 0100).
    """
    from custom_components.homeostatic.const import EVENT_NOTIFICATION

    hass.states.async_set("sensor.observed", "unavailable")
    runtime = await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["enabled"] = False
    requested: list[tuple[str, str, str]] = []

    @callback
    def record_request(event: Event[Any]) -> None:
        requested.append(
            (event.data["delivery_id"], event.data["tag"], event.data["action"])
        )

    cancel = hass.bus.async_listen(EVENT_NOTIFICATION, record_request)
    save = runtime.store.async_save
    calls = 0

    async def fail_cleanup(data: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("Test outbox cleanup failure")
        await save(data)

    with patch.object(runtime.store, "async_save", side_effect=fail_cleanup):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["error"]["code"] == "apply_failed"
    assert not config_entry.options
    published_id = requested[0][0]
    # The reload restores the store written before publishing; the policy may
    # request the still-open issue again under a new id.
    await hass.async_block_till_done()
    reloaded = config_entry.runtime_data
    assert reloaded is not runtime and reloaded.available
    await client.send_json(
        {
            "id": 3,
            "type": "homeostatic/save_settings",
            "revision": configuration["revision"],
            "settings": draft,
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    await hass.async_block_till_done()
    by_id: dict[str, set[str]] = {}
    for delivery_id, tag, _action in requested:
        by_id.setdefault(delivery_id, set()).add(tag)
    # An id names one message: a replay or a later action on that message repeats
    # it, a request about another message gets a new id.
    assert all(len(messages) == 1 for messages in by_id.values())
    assert any(delivery_id != published_id for delivery_id, _, _ in requested[1:])
    assert reloaded.snapshot()["delivery"]["sequence"] >= max(
        int(delivery_id.rsplit(":", 1)[1]) for delivery_id, _, _ in requested
    )
    cancel()
    await client.close()


async def test_stopping_during_save_cannot_report_applied_or_leave_listeners(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Unload wins over a pending save and leaves the original options intact."""
    hass.states.async_set("sensor.observed", "1")
    runtime = await start_monitor(hass, config_entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["enabled"] = False
    save = runtime.store.async_save
    stops: list[asyncio.Task[None]] = []
    calls = 0

    async def stop_during_write(data: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        await save(data)
        if calls == 1:
            stops.append(hass.async_create_task(runtime.async_stop()))
            stopped = asyncio.Event()
            hass.loop.call_soon(stopped.set)
            await stopped.wait()

    with patch.object(runtime.store, "async_save", side_effect=stop_during_write):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["error"]["code"] == "apply_failed"
        await asyncio.gather(*stops)
    assert not config_entry.options
    assert not runtime.available
    assert not runtime._entries
    assert not runtime._subscriptions
    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await client.close()
