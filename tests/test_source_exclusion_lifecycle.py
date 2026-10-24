"""Contextual availability edits retain unrelated monitoring and persisted identities."""

import hashlib
import json
from copy import deepcopy
from typing import Any
from unittest.mock import patch

from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.homeostatic.const import DOMAIN
from custom_components.homeostatic.monitoring import MonitoringPolicy
from tests.policy_helpers import bound_identity, monitoring_policy
from tests.test_controls import action, end
from tests.test_lifecycle import start_monitor
from tests.test_monitoring_policies import advance, reload_policies


def _legacy_detection_key(
    policy: MonitoringPolicy, *, member_exclusions: tuple[str, ...] = ()
) -> str:
    """Reproduce the persisted detector identities before source-scoped exclusions."""
    payload = {
        "check": policy.check,
        "match": dict(policy.match),
        "parameters": dict(policy.parameters),
    }
    if policy.excluded_sources:
        payload["excluded_sources"] = policy.excluded_sources
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


async def test_source_exclusion_preserves_sibling_attention_and_history(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Stopping and resuming two sources retains a same-policy acknowledged issue."""
    entities = ("sensor.first", "sensor.second", "sensor.retained")
    for entity in entities:
        hass.states.async_set(entity, "unavailable")
    policy = monitoring_policy(
        "entities",
        {"kind": ["entity"]},
        notifications=[
            {
                "id": "repeat",
                "timing": {"mode": "acknowledge", "remind_every": "30m"},
                "methods": ["test"],
            }
        ],
    )
    policy["excluded_sources"] = ["entity:registry:absent"]
    config_data["monitoring_policies"] = [policy]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    runtime = await start_monitor(hass, entry)
    anchors = {
        str(episode["anchor"]): episode_id
        for episode_id, episode in runtime.episodes.items()
    }
    retained_node = bound_identity(policy, "entity:entity_id:sensor.retained")
    retained_id = anchors[retained_node]
    await action(hass, "acknowledge", {"episode_id": retained_id})
    await action(hass, "shelve", {"episode_id": retained_id, "until": end(300)})
    retained = deepcopy(runtime.episodes[retained_id])
    assert runtime.policy is not None
    attention = deepcopy(runtime.policy.explain(retained_id))
    controls = deepcopy(runtime.controls)
    messages = deepcopy(
        {
            key: row
            for key, row in runtime.notifications.delivery.messages.items()
            if row["episode_id"] == retained_id
        }
    )
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["excluded_sources"].extend(
        f"entity:entity_id:{entity}" for entity in entities[:2]
    )
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
    assert runtime.policy.explain(retained_id) == attention
    assert runtime.controls == controls
    assert {
        key: row
        for key, row in runtime.notifications.delivery.messages.items()
        if row["episode_id"] == retained_id
    } == messages
    history = runtime.history.snapshot()["episodes"]
    assert {row["episode"]["episode_id"] for row in history} == set(
        anchors.values()
    ) - {retained_id}
    assert {row["resolution"] for row in history} == {"removed"}
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.episodes == {retained_id: retained}
    assert (
        runtime.policy.explain(retained_id)["acknowledgment"]
        == attention["acknowledgment"]
    )
    assert runtime.controls == controls
    await client.send_json({"id": 3, "type": "homeostatic/configuration"})
    configuration = (await client.receive_json())["result"]
    draft = configuration["settings"]
    draft["monitoring_policies"][0]["excluded_sources"] = ["entity:registry:absent"]
    await client.send_json(
        {
            "id": 4,
            "type": "homeostatic/save_settings",
            "revision": configuration["revision"],
            "settings": draft,
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True}
    assert len(runtime.episodes) == 3
    assert runtime.episodes[retained_id] == retained
    assert set(runtime.episodes) & set(anchors.values()) == {retained_id}
    assert (
        runtime.policy.explain(retained_id)["acknowledgment"]
        == attention["acknowledgment"]
    )
    assert [
        runtime.policy.explain(episode_id)["acknowledgment"]
        for episode_id in runtime.episodes
        if episode_id != retained_id
    ] == [None, None]
    assert runtime.history.snapshot()["episodes"] == history
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.close()


async def test_legacy_exclusions_preserve_issues_and_unknown_holds_on_upgrade(
    hass: HomeAssistant,
    config_data: dict[str, Any],
    hass_storage: dict[str, Any],
    freezer: FrozenDateTimeFactory,
) -> None:
    """Older global exclusion hashes survive migration, subsequent edits, and restart."""
    owner = MockConfigEntry(domain="test", state=ConfigEntryState.LOADED)
    owner.add_to_hass(hass)
    registry = er.async_get(hass)
    members = {
        name: registry.async_get_or_create("sensor", "test", name, config_entry=owner)
        for name in ("failed", "pending", "ignored")
    }
    hass.states.async_set(members["failed"].entity_id, "unavailable")
    hass.states.async_set(members["ignored"].entity_id, "unavailable")
    policy = monitoring_policy(
        "entities",
        {"kind": ["entity"]},
        notifications=[
            {
                "id": "repeat",
                "timing": {"mode": "acknowledge", "remind_every": "30m"},
                "methods": ["test"],
            }
        ],
    )
    policy["excluded_sources"] = [f"entity:registry:{members['ignored'].id}"]
    integration = monitoring_policy("integrations", {"kind": ["integration"]})
    integration["excluded_sources"] = ["entry:absent"]
    config_data["monitoring_policies"] = [policy, integration]
    entry = MockConfigEntry(domain=DOMAIN, data=config_data)
    with patch.object(MonitoringPolicy, "detection_key", _legacy_detection_key):
        runtime = await start_monitor(hass, entry)
        failed_node = bound_identity(policy, f"entity:registry:{members['failed'].id}")
        pending_node = bound_identity(
            policy, f"entity:registry:{members['pending'].id}"
        )
        integration_node = bound_identity(integration, f"entry:{owner.entry_id}")
        failed_id = next(iter(runtime.episodes))
        await action(hass, "acknowledge", {"episode_id": failed_id})
        assert runtime.policy is not None
        attention = deepcopy(runtime.policy.explain(failed_id))
        await advance(hass, freezer, 10)
        assert await hass.config_entries.async_unload(entry.entry_id)
    failed = deepcopy(runtime.episodes[failed_id])
    envelope = hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"]
    envelope["schema_version"] = 2
    envelope.pop("monitoring_identities")
    envelope.pop("monitoring_scopes", None)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.episodes == {failed_id: failed}
    assert failed_node in runtime.sources
    assert pending_node in runtime.sources
    assert runtime.sources[failed_node].requirements == (integration_node,)
    assert (
        runtime.policy.explain(failed_id)["acknowledgment"]
        == attention["acknowledgment"]
    )
    clocks = ("opened_at", "attention_since", "last_sent", "sent_to", "acknowledgment")
    assert {
        key: runtime.policy.explain(failed_id)["routes"]["policy_entities_repeat"][key]
        for key in clocks
    } == {key: attention["routes"]["policy_entities_repeat"][key] for key in clocks}
    assert not runtime.history.snapshot()["episodes"]
    assert runtime.preview_sources(runtime.settings) == runtime.sources
    await advance(hass, freezer, 19)
    assert runtime.episodes == {failed_id: failed}
    await advance(hass, freezer, 1)
    assert {episode["anchor"] for episode in runtime.episodes.values()} == {
        failed_node,
        pending_node,
    }
    before = deepcopy(runtime.episodes)
    await reload_policies(
        hass,
        entry,
        [
            {
                **policy,
                "excluded_sources": [
                    *policy["excluded_sources"],
                    "entity:registry:absent",
                ],
            },
            integration,
        ],
    )
    runtime = entry.runtime_data
    assert runtime.episodes == before
    assert not runtime.history.snapshot()["episodes"]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    runtime = entry.runtime_data
    assert runtime.episodes == before
    assert not runtime.history.snapshot()["episodes"]
    assert await hass.config_entries.async_unload(entry.entry_id)
