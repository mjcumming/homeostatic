"""Physical notification audiences retain only their authorized device members."""

import json
from copy import deepcopy
from dataclasses import replace

import pytest
from health_tree.types import (
    Delivery,
    JSONValue,
    Loudness,
    Notification,
    ResolutionNotice,
)

from custom_components.homeostatic.delivery import DeliveryState


def notice(identity: str, channel: str) -> Notification:
    """Create an authorized immediate request after resolving presence."""
    return Notification(
        episode_id=identity,
        recipient="method:who_is_home",
        channels=(channel,),
        loudness=Loudness.URGENT,
        route="policy_entities_immediate",
    )


def payload(member: Notification) -> dict[str, JSONValue]:
    """Provide the ordinary adapter content needed for a grouped message."""
    return {
        "schema_version": 1,
        "entry_id": "entry",
        "episode_id": member.episode_id,
        "title": member.episode_id,
        "message": f"Problem {member.episode_id}",
        "functions": [],
        "tag": f"individual_{member.episode_id}",
        "notification_subject": "device:shared",
        "notification_subject_name": "Shared device",
    }


def record(state: DeliveryState, deliveries: list[Delivery]) -> None:
    """Apply one complete authorized batch before rendering its final groups."""
    notifications = [item for item in deliveries if isinstance(item, Notification)]
    updates = state.groups.apply(
        deliveries,
        {
            (item.episode_id, item.route): "device:shared:intent"
            for item in notifications
        },
    )
    contents = {(item.episode_id, item.route): payload(item) for item in notifications}
    for update in sorted(updates, key=lambda item: not item.closed):
        state.record_group(update, contents)


def cleared(member: Notification) -> ResolutionNotice:
    """Retain the policy's recipient and route when one problem recovers."""
    return ResolutionNotice(
        episode_id=member.episode_id,
        recipient=member.recipient,
        channels=member.channels,
        route=member.route,
        resolution="cleared",
    )


@pytest.mark.parametrize("grouped", [False, True])
def test_split_withdrawal_never_announces_recovery(grouped: bool) -> None:
    """Replacing an old grouped issue cancels queued messages truthfully."""
    state = DeliveryState("entry")
    member = notice("old-group", "phone:alice")
    if grouped:
        record(state, [member])
    else:
        state.record(member, payload(member))
    resolution = replace(cleared(member), resolution="split")
    if grouped:
        record(state, [resolution])
    else:
        state.record(resolution, payload(member))
    assert len(state.outbox) == 1
    assert state.outbox[0]["action"] == "resolve"
    assert state.outbox[0]["resolution"] == "split"
    assert state.outbox[0]["message"] == "Monitoring continues as separate issues."
    assert state.outbox[0]["silent"] is True


def test_presence_change_does_not_send_new_member_to_previous_person() -> None:
    """Alice's message cannot acquire Bob's later, separately authorized problem."""
    state = DeliveryState("entry")
    first = notice("first", "phone:alice")
    second = notice("second", "phone:bob")
    record(state, [first])
    alice_tag = state.outbox[-1]["tag"]
    state.outbox.clear()
    record(state, [second])
    assert len(state.outbox) == 1
    assert state.outbox[0]["channels"] == ["phone:bob"]
    assert state.outbox[0]["episodes"] == ["second"]
    assert state.outbox[0]["tag"] != alice_tag
    restored = DeliveryState("entry")
    restored.restore(json.loads(json.dumps(state.snapshot())))
    restored.outbox.clear()
    record(restored, [cleared(first)])
    assert len(restored.outbox) == 1
    assert restored.outbox[0]["tag"] == alice_tag
    assert restored.outbox[0]["action"] == "resolve"
    assert restored.outbox[0]["channels"] == ["phone:alice"]
    assert restored.outbox[0]["episodes"] == []
    remaining = next(iter(restored.messages.values()))
    assert remaining["episode_id"] == "second"
    assert remaining["_target_channels"] == ["phone:bob"]


def test_same_problem_moves_without_importing_previous_audience() -> None:
    """A later authorized delivery clears its old target and uses only the new one."""
    state = DeliveryState("entry")
    initial = notice("first", "phone:alice")
    record(state, [initial])
    alice_tag = state.outbox[-1]["tag"]
    state.outbox.clear()
    moved = replace(initial, channels=("phone:bob",), cause="remind")
    record(state, [moved])
    assert len(state.outbox) == 2
    assert state.outbox[0]["tag"] == alice_tag
    assert state.outbox[0]["channels"] == ["phone:alice"]
    assert state.outbox[0]["action"] == "resolve"
    assert state.outbox[1]["channels"] == ["phone:bob"]
    assert state.outbox[1]["_target_channels"] == ["phone:bob"]
    bob_tag = state.outbox[1]["tag"]
    record(state, [notice("second", "phone:bob")])
    record(state, [cleared(moved)])
    remaining = [item for item in state.outbox if item["tag"] == bob_tag]
    assert len(remaining) == 1
    assert remaining[0]["episodes"] == ["second"]
    assert remaining[0]["channels"] == ["phone:bob"]
    assert remaining[0]["action"] != "resolve"
    assert "first" not in str(remaining[0]["message"])


def test_malformed_group_snapshot_does_not_partly_replace_delivery_state() -> None:
    """Validation covers the reducer before any existing outbox state changes."""
    state = DeliveryState("entry")
    record(state, [notice("first", "phone:alice")])
    before = deepcopy(state.snapshot())
    malformed = deepcopy(before)
    malformed["sequence"] = 100
    malformed["messages"] = {}
    malformed["delivery_groups"]["schema_version"] = 999
    with pytest.raises(ValueError, match="snapshot"):
        state.restore(malformed)
    assert state.snapshot() == before
