"""Reusable delivery methods use the durable transaction without runtime reload."""

from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.components import frontend
from homeassistant.core import Event, HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


@pytest.fixture
def method_config(
    config_data: dict[str, Any], freezer: FrozenDateTimeFactory
) -> dict[str, Any]:
    """Two independent methods serve one finding through named and inline rows."""
    config_data["consumer"] = None
    definitions = config_data["notification_definitions"]
    definitions["methods"] = {
        "test": {"name": "Edited", "mode": "fixed", "destinations": ["notify:old"]},
        "other": {"name": "Other", "mode": "fixed", "destinations": ["notify:other"]},
        "unused": {
            "name": "Unused",
            "mode": "fixed",
            "destinations": ["notify:unused"],
        },
    }
    definitions["profiles"]["acknowledge"]["methods"] = ["test"]
    # These scenarios edit already-authorized outbox requests, before transport.
    definitions["profiles"]["acknowledge"]["timing"]["collection_delay_seconds"] = 0
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "edited", "profile": "acknowledge"},
        {
            "id": "retained",
            "timing": {"mode": "acknowledge", "remind_every": 1800},
            "methods": ["other"],
        },
    ]
    return config_data


@pytest.mark.parametrize("edit", ["name", "destination", "presence", "add", "delete"])
async def test_method_save_keeps_runtime_panel_and_inventory_with_sending_off(
    hass: HomeAssistant,
    method_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: str,
) -> None:
    """Ordinary method operations and their explicit references need no reload."""
    method_config["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    panel = hass.data[frontend.DATA_PANELS][DOMAIN]
    inventory = runtime.inventory_static
    episodes = deepcopy(runtime.episodes)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    methods = draft["notification_definitions"]["methods"]
    changed = {
        "name": {**methods, "test": {**methods["test"], "name": "Renamed"}},
        "destination": {
            **methods,
            "test": {**methods["test"], "destinations": ["notify:new"]},
        },
        "presence": {
            **methods,
            "test": {
                "name": "Edited",
                "mode": "home_away",
                "people": ["person.owner"],
                "home": ["notify:home"],
                "away": ["notify:away"],
                "fallback": ["notify:fallback"],
                "skip": False,
            },
        },
        "add": {
            **methods,
            "new": {"name": "New", "mode": "fixed", "destinations": ["notify:new"]},
        },
        "delete": {key: value for key, value in methods.items() if key != "test"},
    }
    draft["notification_definitions"]["methods"] = changed[edit]
    draft["notification_definitions"]["profiles"]["acknowledge"]["methods"] = {
        "add": ["new"],
        "delete": ["other"],
    }.get(edit, ["test"])
    with (
        patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("Method save must not reload"),
        ),
        patch.object(
            runtime,
            "_discover",
            side_effect=AssertionError("Method save does not change discovery"),
        ),
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
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
        await hass.async_block_till_done()
        send.assert_not_awaited()
    assert entry.runtime_data is runtime
    assert hass.data[frontend.DATA_PANELS][DOMAIN] is panel
    assert runtime.inventory_static is inventory
    assert runtime.episodes == episodes
    assert runtime.settings.notification_definitions["methods"] == changed[edit]
    assert [
        row["id"] for row in runtime.settings.monitoring_policies[0].notifications
    ] == ["edited", "retained"]
    assert not runtime.settings.notifications
    assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize("edit", ["name", "unused_destination", "add", "delete_unused"])
@pytest.mark.parametrize("acknowledge", [False, True])
async def test_nonreporting_method_edits_preserve_policy_and_delivery_state(
    hass: HomeAssistant,
    method_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    acknowledge: bool,
    edit: str,
) -> None:
    """Names preserve exact pending IDs and acknowledged reporting clocks."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    with patch.object(runtime, "_flush_events", new=AsyncMock()):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        [episode] = runtime.episodes
        operations = {False: AsyncMock(), True: runtime.async_control}
        await operations[acknowledge]("acknowledge", {"episode_id": episode}, None)
        before = deepcopy(runtime.snapshot())
        assert before["delivery"]["outbox"]
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        methods = draft["notification_definitions"]["methods"]
        draft["notification_definitions"]["methods"] = {
            "name": {**methods, "test": {**methods["test"], "name": "Renamed"}},
            "unused_destination": {
                **methods,
                "unused": {**methods["unused"], "destinations": ["notify:new"]},
            },
            "add": {
                **methods,
                "added": {
                    "name": "Added",
                    "mode": "fixed",
                    "destinations": ["notify:new"],
                },
            },
            "delete_unused": {
                key: value for key, value in methods.items() if key != "unused"
            },
        }[edit]
        with patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("Rename must not reload"),
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
        after = runtime.snapshot()
        assert after["engine"] == before["engine"]
        assert after["policy"] == before["policy"]
        assert after["delivery"] == before["delivery"]
        assert after["operator_controls"] == before["operator_controls"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize("other_channel", ["notify:other", "notify:old"])
@pytest.mark.parametrize("edit", ["destination", "presence", "remove", "replace"])
async def test_method_change_retires_only_its_pending_original_targets(
    hass: HomeAssistant,
    method_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: str,
    other_channel: str,
) -> None:
    """Changed routes cancel obsolete alerts while independent target/tag state survives."""
    method_config["notification_definitions"]["methods"]["other"]["destinations"] = [
        other_channel
    ]
    hass.states.async_set("person.owner", "home")
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    with patch.object(runtime, "_flush_events", new=AsyncMock()):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        [episode] = runtime.episodes
        retained = deepcopy(
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
        )
        pending = deepcopy(runtime.delivery.outbox)
        old = next(row for row in pending if row["route"] == "policy_observed_edited")
        other = next(
            row for row in pending if row["route"] == "policy_observed_retained"
        )
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        methods = draft["notification_definitions"]["methods"]
        definitions = {
            "destination": {
                **methods,
                "test": {**methods["test"], "destinations": ["notify:new"]},
            },
            "presence": {
                **methods,
                "test": {
                    "name": "Edited",
                    "mode": "home_away",
                    "people": ["person.owner"],
                    "home": ["notify:new"],
                    "away": ["notify:away"],
                    "fallback": ["notify:fallback"],
                    "skip": False,
                },
            },
            "remove": {key: value for key, value in methods.items() if key != "test"},
            "replace": {key: value for key, value in methods.items() if key != "test"},
        }
        draft["notification_definitions"]["methods"] = definitions[edit]
        draft["notification_definitions"]["profiles"]["acknowledge"]["methods"] = {
            "remove": [],
            "replace": ["unused"],
        }.get(edit, ["test"])
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
        assert (
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
            == retained
        )
        assert other in runtime.delivery.outbox
        assert old not in runtime.delivery.outbox
        cleanup = [row for row in runtime.delivery.outbox if row["action"] == "resolve"]
        assert cleanup
        assert all(
            row["channels"] == ["notify:old"] and row["tag"] == old["tag"]
            for row in cleanup
        )
        targets = [
            row["channels"]
            for row in runtime.delivery.outbox
            if row["action"] != "resolve" and row["route"] == "policy_observed_edited"
        ]
        assert (
            targets
            == {
                "destination": [["notify:new"]],
                "presence": [["notify:new"]],
                "remove": [],
                "replace": [["notify:unused"]],
            }[edit]
        )
        assert await runtime.store.async_load() == runtime.snapshot()
        with patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send:
            await runtime.async_send_notification(old)
            send.assert_not_awaited()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "change", ["scope", "add_policy", "timings", "legacy", "timezone", "activation"]
)
async def test_method_changes_cannot_bypass_other_reload_boundaries(
    hass: HomeAssistant, method_config: dict[str, Any], change: str
) -> None:
    """A shared-method edit cannot smuggle source or installation changes into this path."""
    method_config["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    changed = deepcopy(method_config)
    changed["notification_definitions"]["methods"]["test"]["name"] = "Renamed"
    definitions = changed["notification_definitions"]
    policy = changed["monitoring_policies"][0]
    variants = {
        "scope": {
            **changed,
            "monitoring_policies": [{**policy, "match": {"kind": ["device"]}}],
        },
        "add_policy": {
            **changed,
            "monitoring_policies": [policy, {**policy, "id": "added"}],
        },
        "timings": {**changed, "timings": {**changed["timings"], "batch": 30}},
        "legacy": {
            **changed,
            "notification_definitions": {
                **definitions,
                "assignments": {"situation:test": {"default": []}},
            },
        },
        "timezone": {
            **changed,
            "notification_definitions": {**definitions, "timezone": "America/Chicago"},
        },
        "activation": {**changed, "notifications": True},
    }
    assert not runtime.can_apply_settings(Settings.from_data(variants[change]))
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_removed_method_destination_cannot_authorize_old_phone_action(
    hass: HomeAssistant, method_config: dict[str, Any]
) -> None:
    """Even a previously authenticated phone button rechecks saved method targets."""
    hass.states.async_set("sensor.observed", "unavailable")
    method_config["notification_definitions"]["methods"]["test"]["destinations"] = [
        "phone:old"
    ]
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    with patch("custom_components.homeostatic.runtime.async_send", new=AsyncMock()):
        runtime = await start_monitor(hass, entry)
        [episode] = runtime.episodes
        changed = deepcopy(method_config)
        changed["notification_definitions"]["methods"]["test"]["destinations"] = [
            "phone:new"
        ]
        await runtime.async_apply_settings(Settings.from_data(changed))
        row = {
            "episode_id": episode,
            "recipient": "method:test",
            "channel": "phone:old",
            "user_id": "owner",
        }
        with (
            patch.object(
                runtime.phone_actions, "authorize", new=AsyncMock(return_value=row)
            ),
            patch.object(runtime, "async_control", new=AsyncMock()) as control,
        ):
            await runtime.async_phone_action(
                Event("mobile_app_notification_action", {"action": "old-token"})
            )
            control.assert_not_awaited()
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("replacement", [[], ["other"]], ids=["remove", "replace"])
async def test_method_deletion_updates_inline_references_without_changing_row_identity(
    hass: HomeAssistant,
    method_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    replacement: list[str],
) -> None:
    """An explicit compound delete preserves supported inline IDs and UPS conditions."""
    method_config["notifications"] = False
    original = {
        "id": "edited",
        "timing": {"mode": "immediate"},
        "methods": ["test"],
        "when": "backup",
    }
    method_config["monitoring_policies"][0].update(check="ups_reserve", enabled=False)
    method_config["monitoring_policies"][0]["notifications"][1]["when"] = "mains"
    method_config["monitoring_policies"][0]["notifications"][0] = original
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    del draft["notification_definitions"]["methods"]["test"]
    draft["notification_definitions"]["profiles"]["acknowledge"]["methods"] = (
        replacement
    )
    retained = draft["monitoring_policies"][0]["notifications"][1]
    expected = {
        (): [retained],
        ("other",): [{**original, "methods": replacement}, retained],
    }[tuple(replacement)]
    draft["monitoring_policies"][0]["notifications"] = expected
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
    assert list(runtime.settings.monitoring_policies[0].notifications) == expected
    assert await runtime.store.async_load() == runtime.snapshot()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_method_edit_preserves_independent_window_pending_clock(
    hass: HomeAssistant,
    method_config: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """A different method's quiet-window request keeps its existing due state."""
    freezer.move_to("2026-10-15T04:00:00+00:00")
    method_config["monitoring_policies"][0]["notifications"][1]["timing"] = {
        "mode": "window",
        "start": "08:00",
        "end": "22:00",
    }
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    with patch("custom_components.homeostatic.runtime.async_send", new=AsyncMock()):
        runtime = await start_monitor(hass, entry)
        [episode] = runtime.episodes
        pending = deepcopy(
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
        )
        assert pending["pending"]
        changed = deepcopy(method_config)
        changed["notification_definitions"]["methods"]["test"]["destinations"] = [
            "notify:new"
        ]
        await runtime.async_apply_settings(Settings.from_data(changed))
        assert (
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
            == pending
        )
        assert not any(
            row.get("route") == "policy_observed_retained"
            for row in runtime.delivery.messages.values()
        )
        assert await runtime.store.async_load() == runtime.snapshot()
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("mode", ["home_away", "home_people"])
async def test_presence_catalog_identity_saves_without_reload(
    hass: HomeAssistant,
    hass_admin_user: User,
    method_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    mode: str,
) -> None:
    """Actual catalog entity IDs survive method save and presence resolution."""
    method_config["notifications"] = False
    hass.states.async_set("sensor.observed", "1")
    hass.states.async_set(
        "person.renamed_owner",
        "home",
        {
            "id": "owner-internal",
            "user_id": hass_admin_user.id,
            "friendly_name": "Owner",
        },
    )
    entry = MockConfigEntry(domain=DOMAIN, data=method_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    assert configuration["notification_people"] == [
        {
            "id": "owner-internal",
            "entity_id": "person.renamed_owner",
            "name": "Owner",
            "user_id": hass_admin_user.id,
            "administrator": True,
        }
    ]
    person = configuration["notification_people"][0]["entity_id"]
    method = {
        "name": "Presence",
        "mode": mode,
        "people": [person],
        "fallback": [],
        "skip": True,
        **{
            "home_away": {"home": ["notify:home"], "away": ["notify:away"]},
            "home_people": {"person_destinations": {person: ["notify:home"]}},
        }[mode],
    }
    draft = configuration["settings"]
    draft["notification_definitions"]["methods"]["test"] = method
    with (
        patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("Presence save must not reload"),
        ),
        patch(
            "custom_components.homeostatic.runtime.async_send", new=AsyncMock()
        ) as send,
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
        await hass.async_block_till_done()
        send.assert_not_awaited()
    assert entry.runtime_data is runtime
    assert runtime.settings.notification_definitions["methods"]["test"] == method
    assert not runtime.settings.notifications
    assert await runtime.store.async_load() == runtime.snapshot()
    await client.send_json({"id": 3, "type": "homeostatic/configuration"})
    confirmed = (await client.receive_json())["result"]
    assert (
        confirmed["settings"]["notification_definitions"]["methods"]["test"] == method
    )
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/preview_delivery_method",
            "method_id": "test",
            "revision": confirmed["revision"],
        }
    )
    preview = (await client.receive_json())["result"]
    assert preview["presence"] == {person: {"state": "home", "restored": False}}
    assert [target["channel"] for target in preview["targets"]] == ["notify:home"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
