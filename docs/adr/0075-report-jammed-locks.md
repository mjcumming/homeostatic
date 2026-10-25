# ADR 0075: Report a lock's jammed state as an issue

**Status:** Accepted
**Date:** 2026-10-15
**Accepted:** 2026-10-24

## Context

A reported lock jam needs the owner's attention. Home Assistant exposes the condition as the standard `lock` state `jammed`, allowing one policy to watch it across integrations.

The [lock entity documentation](https://developers.home-assistant.io/docs/core/entity/lock/) defines jammed as attempted movement that became stuck. Core's [LockEntity.state](https://github.com/home-assistant/core/blob/dev/homeassistant/components/lock/__init__.py) checks `is_jammed` first. The [cover documentation](https://developers.home-assistant.io/docs/core/entity/cover/) and [CoverEntity.state](https://github.com/home-assistant/core/blob/dev/homeassistant/components/cover/__init__.py) define open, opening, closed and closing, with no standard jammed state. These contracts were checked on October 15, 2026.

The vacuum error check establishes the condition-monitoring pattern. The current policy lifecycle and notifications follow [ADR 0058](0058-unified-policy-lifecycle.md) and [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md), including their supersessions of older defaults.

## Decision

Add a monitoring type named **Jammed lock** and a supplied **Jammed locks** policy with stable identity `default_jammed_locks`. It starts disabled on fresh installations and upgrades, selecting all eligible lock entities. Owners can select individual locks, areas or labels and apply policy-local exclusions through the existing editor. Disabled entities are not enrolled. An unavailable lock remains a selection candidate. Home Assistant exposes no separate supported-feature flag for jam reporting, so discovery cannot establish that every candidate integration reports jams.

Supplied and custom policies have the same editing, duplication, enable/disable, deletion and explicit restoration controls. Overlapping policies retain independent identities and findings. Updates preserve edits and deletions.

### State interpretation

Read each selected lock's current Home Assistant state:

| Reported state | Check result |
| --- | --- |
| `jammed` | `fail`, reason `lock_jammed` |
| `locked`, `unlocked`, `locking`, `unlocking`, `open`, `opening` | `pass` |
| `unknown`, `unavailable`, missing, restored, or any unrecognized value | `unknown` |

Missing or restored evidence takes precedence over state text. Unknown evidence cannot open a jam issue or clear an existing one. Use zero raise and clear holds. Repeated jam reports continue the same issue; a jam after recovery opens a new one. Acknowledgment changes attention without clearing the condition.

Passing means Home Assistant no longer reports a jam. A transitional state can end this issue without establishing that movement completed or the door is secured. The issue says **Home Assistant reports this lock is jammed** and identifies the lock through its existing name and location context. During an evidence gap, details distinguish the last jam report from the unavailable current reading.

### Policy and notification boundaries

Keep the jam condition independent of availability and battery checks. Use an edgeless condition check per policy and lock, following the vacuum pattern. A failed integration cannot resolve or absorb the jam condition. Existing device presentation and compatible message grouping may organize findings without merging their lifecycle or policy identity.

Use **Immediate** as the supplied notification assignment: a jam merits a prompt notice, including overnight, without repeated acknowledgment reminders by default. Owners can choose any existing named notification or leave the policy dashboard-only. Assignment never enables global sending or supplies a destination. If the named default was deleted, adding or restoring this policy leaves the assignment empty. Updates preserve existing notification choices.

Homeostatic owns HA observation, source selection, configuration and notification requests. health-tree retains lifecycle, unknown handling, readiness and attention through public APIs. Reuse the existing condition-check contract; identify any required library change in both repositories before implementation.

## Limits and alternatives

An integration that never reports `jammed` cannot produce this issue. The report establishes what Home Assistant says; it provides no independent evidence of physical freshness or successful command completion.

Cover obstruction, movement timeouts, vendor-specific fault attributes, unlocked-too-long checks and door-contact checks are outside this decision. Homeostatic sends no lock, unlock or retry commands. Owner-written automations remain available for other conditions. Inferring a jam from elapsed movement time needs a separate design and evidence from real devices.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns implementation status. Before shipping, update the owning specification sections, events reference where affected, user guide and changelog, with executable scenarios covering:

- Every state in the table, including restored `jammed` and an unrecognized value; jam followed by unknown remains unresolved, and each recognized non-jammed state ends it.
- Repeated reports, recovery and recurrence, startup and restart with fresh versus restored evidence, and acknowledgment without recovery.
- Selection, exclusions, disabled sources, future group members, independent overlaps, deletion and restoration without replacing saved choices. Ending monitoring records removal rather than recovery.
- Independent jam, availability and battery findings; integration failure and device message grouping preserve jam identity.
- Named-notification assignment and missing-default behavior, global sending off, no destination, mocked direct delivery and optional consumer events, with queued observations and stable replay delivery ids preserved.

The specification and executable scenarios define the implemented behavior; this decision records its rationale.
