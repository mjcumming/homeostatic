"""Named notification saves retain the active panel and runtime transaction."""

import asyncio
import logging
import re
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from health_tree.policy import Policy
from health_tree.types import Delivery, PolicyContext
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic import notification_definitions
from custom_components.homeostatic.config import Settings
from custom_components.homeostatic.const import DOMAIN
from tests.test_lifecycle import start_monitor


@pytest.fixture
def named_config(config_data: dict[str, Any]) -> dict[str, Any]:
    """Keep independent immediate and overnight-held routes on one watched entity."""
    definitions = config_data["notification_definitions"]
    definitions["methods"]["other"] = {
        "name": "Other",
        "mode": "fixed",
        "destinations": ["service:other_test"],
    }
    definitions["profiles"]["acknowledge"]["methods"] = ["test"]
    definitions["profiles"]["urgent"]["methods"] = ["test"]
    now = dt_util.utcnow()
    definitions["profiles"]["urgent"]["timing"] = {
        "mode": "window",
        "start": (now + timedelta(hours=2)).strftime("%H:%M"),
        "end": (now + timedelta(hours=3)).strftime("%H:%M"),
    }
    config_data["monitoring_policies"][0]["notifications"] = [
        {"id": "edited", "profile": "acknowledge"},
        {"id": "retained", "profile": "urgent"},
    ]
    return config_data


@pytest.mark.parametrize("edit", ["name", "timing", "methods", "create", "delete"])
async def test_named_notification_saves_keep_panel_runtime_and_unaffected_clocks(
    hass: HomeAssistant,
    named_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
    edit: str,
) -> None:
    """Each named-editor operation saves without unloading or reenrolling sources."""
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    with patch("custom_components.homeostatic.runtime.async_send", new=AsyncMock()):
        runtime = await start_monitor(hass, entry)
        client = await hass_ws_client(hass)
        panel = hass.data[frontend.DATA_PANELS][DOMAIN]
        sources = deepcopy(runtime.sources)
        episodes = deepcopy(runtime.episodes)
        [episode] = runtime.episodes
        retained = deepcopy(
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
        )
        choices = deepcopy(named_config["notification_definitions"]["profiles"])
        changes = {
            "name": {
                **choices,
                "acknowledge": {**choices["acknowledge"], "name": "Renamed"},
            },
            "timing": {
                **choices,
                "acknowledge": {
                    **choices["acknowledge"],
                    "timing": {"mode": "acknowledge", "remind_every": 3600},
                },
            },
            "methods": {
                **choices,
                "acknowledge": {**choices["acknowledge"], "methods": ["other"]},
            },
            "create": {
                **choices,
                "new": {"name": "New", "timing": {"mode": "immediate"}, "methods": []},
            },
            "delete": {key: value for key, value in choices.items() if key != "weekly"},
        }
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        draft["notification_definitions"]["profiles"] = changes[edit]
        with patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("named notification save must not reload"),
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
        assert hass.data[frontend.DATA_PANELS][DOMAIN] is panel
        assert runtime.sources == sources
        assert runtime.episodes == episodes
        assert runtime.settings.notification_definitions["profiles"] == changes[edit]
        assert (
            runtime.policy.explain(episode)["routes"]["policy_observed_retained"]
            == retained
        )
        assert await runtime.store.async_load() == runtime.snapshot()
        assert await hass.config_entries.async_unload(entry.entry_id)
        await client.close()


async def test_profile_rename_preserves_queued_request_and_all_policy_clocks(
    hass: HomeAssistant,
    named_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Presentation-only edits cannot withdraw or replace a pending durable request."""
    hass.states.async_set("sensor.observed", "1")
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    with patch.object(runtime, "_flush_events", new=AsyncMock()):
        hass.states.async_set("sensor.observed", "unavailable")
        await hass.async_block_till_done()
        assert runtime.delivery.outbox
        before = deepcopy(runtime.snapshot())
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        draft["notification_definitions"]["profiles"]["acknowledge"]["name"] = "Renamed"
        with patch.object(
            hass.config_entries,
            "async_reload",
            side_effect=AssertionError("rename must not reload"),
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
        assert after["policy"] == before["policy"]
        assert after["delivery"] == before["delivery"]
        assert after["engine"] == before["engine"]
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_profiles_and_assignments_can_be_saved_together_with_sending_off(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The explicit local defaults save needs no panel removal or source expansion."""
    config_data["notifications"] = False
    config_data["notification_definitions"]["profiles"] = {}
    config_data["monitoring_policies"][0]["notifications"] = []
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    sources = deepcopy(runtime.sources)
    episodes = deepcopy(runtime.episodes)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["notification_definitions"]["profiles"] = (
        notification_definitions.default_profiles()
    )
    draft["monitoring_policies"][0]["notifications"] = [
        {"id": "default", "profile": "morning"}
    ]
    with patch.object(
        hass.config_entries,
        "async_reload",
        side_effect=AssertionError("default assignment save must not reload"),
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
    assert runtime.sources == sources
    assert runtime.episodes == episodes
    assert not runtime.settings.notifications
    assert not runtime.delivery.outbox
    assert not runtime.delivery.messages
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize(
    "field", ["timezone", "assignments", "notifications", "timings"]
)
async def test_profile_fast_path_rejects_other_installation_changes(
    hass: HomeAssistant,
    named_config: dict[str, Any],
    field: str,
) -> None:
    """The narrow profile exception cannot bypass installation reload safeguards."""
    named_config["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    runtime = await start_monitor(hass, entry)
    definitions = named_config["notification_definitions"]
    changed = {
        "timezone": {
            **named_config,
            "notification_definitions": {**definitions, "timezone": "America/Chicago"},
        },
        "assignments": {
            **named_config,
            "notification_definitions": {
                **definitions,
                "assignments": {"situation:test": {"default": []}},
            },
        },
        "notifications": {**named_config, "notifications": True},
        "timings": {
            **named_config,
            "timings": {**named_config["timings"], "batch": 30},
        },
    }
    assert not runtime.can_apply_settings(Settings.from_data(changed[field]))
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_profile_edit_with_monitoring_scope_changes_keeps_reload_boundary(
    hass: HomeAssistant,
    named_config: dict[str, Any],
) -> None:
    """Combined scope and shared-profile changes cannot reset unrelated route clocks in place."""
    named_config["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    runtime = await start_monitor(hass, entry)
    changed = deepcopy(named_config)
    changed["notification_definitions"]["profiles"]["acknowledge"]["name"] = "Renamed"
    changed["monitoring_policies"][0]["match"]["entity"] = ["entity_id:sensor.other"]
    assert not runtime.can_apply_settings(Settings.from_data(changed))
    assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    ("edit", "expected_routes"),
    [
        pytest.param({"name": "Renamed"}, [], id="name-preserves-attention"),
        pytest.param(
            {"timing": {"mode": "acknowledge", "remind_every": 3600}},
            [{"policy_observed_edited"}],
            id="timing-reactivates-only-its-route",
        ),
    ],
)
async def test_incidental_enrollment_during_profile_save_does_not_reactivate_unchanged_routes(
    hass: HomeAssistant,
    named_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: dict[str, Any],
    expected_routes: list[set[str]],
) -> None:
    """A newly registered source is evaluated without resetting existing reporting clocks."""
    named_config["monitoring_policies"][0]["match"] = {"kind": ["entity"]}
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    with patch("custom_components.homeostatic.runtime.async_send", new=AsyncMock()):
        runtime = await start_monitor(hass, entry)
        client = await hass_ws_client(hass)
        await client.send_json({"id": 1, "type": "homeostatic/configuration"})
        configuration = (await client.receive_json())["result"]
        draft = configuration["settings"]
        draft["notification_definitions"]["profiles"]["acknowledge"].update(edit)
        assert all(
            source.entity_id != "sensor.joining" for source in runtime.sources.values()
        )
        drain_pending = runtime._drain_pending
        activate = Policy.activate
        activated: list[set[str] | None] = []

        async def drain_with_new_entity() -> None:
            await drain_pending()
            entity = er.async_get(hass).async_get_or_create(
                "sensor", "test", "joining", suggested_object_id="joining"
            )
            hass.states.async_set(entity.entity_id, "1")
            processed = asyncio.Event()
            hass.loop.call_soon(processed.set)
            await processed.wait()

        def capture_activation(
            policy: Policy,
            now: datetime,
            context: PolicyContext,
            *,
            routes: set[str] | None = None,
        ) -> list[Delivery]:
            activated.append(routes)
            return activate(policy, now, context, routes=routes)

        with (
            patch.object(runtime, "_drain_pending", side_effect=drain_with_new_entity),
            patch.object(Policy, "activate", new=capture_activation),
            patch.object(
                hass.config_entries,
                "async_reload",
                side_effect=AssertionError("profile edit must not reload"),
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
            assert (await client.receive_json())["result"] == {"saved": True}
            await hass.async_block_till_done()
        assert any(
            source.entity_id == "sensor.joining" and source.watched
            for source in runtime.sources.values()
        )
        assert activated == expected_routes
        assert entry.runtime_data is runtime
        assert await hass.config_entries.async_unload(entry.entry_id)
        await client.close()


@pytest.mark.parametrize("level", [logging.INFO, logging.DEBUG])
async def test_save_timing_logs_only_phase_durations_when_debug_enabled(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    caplog: pytest.LogCaptureFixture,
    level: int,
) -> None:
    """Diagnostics contain no configuration values and leave the save response unchanged."""
    config_data["notifications"] = False
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["notification_definitions"]["profiles"]["immediate"]["name"] = (
        "Private profile name"
    )
    logger = "custom_components.homeostatic.save_timing"
    caplog.clear()
    with caplog.at_level(level, logger=logger):
        await client.send_json(
            {
                "id": 2,
                "type": "homeostatic/save_settings",
                "revision": configuration["revision"],
                "settings": draft,
            }
        )
        assert (await client.receive_json())["result"] == {"saved": True}
    messages = [
        record.getMessage() for record in caplog.records if record.name == logger
    ]
    assert bool(messages) == (level == logging.DEBUG)
    assert all(
        re.fullmatch(r"phase=[a-z_]+ seconds=\d+\.\d{6}", message)
        for message in messages
    )
    assert "Private profile name" not in " ".join(messages)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


@pytest.mark.parametrize("edit", ["name", "timing", "methods", "assignment"])
async def test_notification_only_save_reuses_unchanged_source_inventory(
    hass: HomeAssistant,
    named_config: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    edit: str,
) -> None:
    """A notification edit does not rescan unchanged discovery or reobserve every source."""
    named_config["notifications"] = False
    hass.states.async_set("sensor.observed", "unavailable")
    entry = MockConfigEntry(domain=DOMAIN, data=named_config)
    runtime = await start_monitor(hass, entry)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 1, "type": "homeostatic/configuration", "section": "settings"}
    )
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    changes = {
        "name": {"name": "Renamed"},
        "timing": {"timing": {"mode": "acknowledge", "remind_every": 3600}},
        "methods": {"methods": ["other"]},
        "assignment": {},
    }
    draft["notification_definitions"]["profiles"]["acknowledge"].update(changes[edit])
    draft["monitoring_policies"][0]["notifications"][0]["profile"] = {
        "assignment": "morning"
    }.get(edit, "acknowledge")
    inventory = runtime.inventory_static
    episodes = deepcopy(runtime.episodes)
    assert not runtime._inventory_dirty
    with patch.object(
        runtime,
        "_discover",
        side_effect=AssertionError(
            "Notification choices do not change source discovery"
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
        assert (await client.receive_json())["result"] == {"saved": True}
    assert runtime.inventory_static is inventory
    assert runtime.episodes == episodes
    assert await runtime.store.async_load() == runtime.snapshot()
    assert not runtime.settings.notifications
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()
