# ADR 0077: Report lawn mower errors as issues

**Status:** Accepted
**Accepted:** 2026-10-25
**Date:** 2026-10-15

## Context and product scope

The person responsible for the mower needs to know when mowing stops because the equipment needs assistance. They can inspect the mower and follow its manufacturer's recovery instructions. This is core equipment monitoring.

Home Assistant defines the relevant states in its standard `lawn_mower` entity contract. Verified against the [official documentation](https://developers.home-assistant.io/docs/core/entity/lawn-mower/) and [Core source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/lawn_mower/__init__.py) on October 15, 2026.

## Decision

Provide **Lawn mower errors** as a separate monitoring type using all eligible lawn mower entities. Supply an ordinary policy that starts disabled. Support the existing entity, area and label selectors where meaningful, policy-local exclusions and independent overlapping policies. Selection eligibility does not depend on the current activity. Disabled entities, devices and integration entries remain outside monitoring.

| Current HA report | Result |
| --- | --- |
| `error` | `fail` |
| `mowing`, `docked`, `paused`, `returning`, `idle` | `pass` |
| `unknown`, `unavailable`, missing, restored, or unrecognized | `unknown` |

Missing and restored evidence take precedence over state text. Use zero raise and clear holds. Unknown evidence neither opens this condition nor clears an existing issue. Repeated failing reports continue the issue; a new failure after recovery creates a new issue. Acknowledgment changes attention without changing the reported condition. Recovery means the specified report ended, without claiming the underlying situation is physically resolved.

Use the finding text **Home Assistant reports the mower is in error**, with the source's name and available location. When evidence becomes unknown, distinguish the last confirmed condition from the current evidence gap.

Use **Immediate** as the initial named-notification assignment. This remains editable, including dashboard-only monitoring. Assign only an existing definition; never recreate a deleted notification, choose a destination or enable global sending. Immediate requests a notice including overnight; it has no acknowledgment reminders. Owners can choose Immediate with acknowledgment when appropriate.

Use the unified lifecycle in [ADR 0058](0058-unified-policy-lifecycle.md), with the notification ownership supersession in [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). Preserve saved edits, deletions and independent policy identities. Disable, deletion or lost eligibility ends monitoring as removed, without recording recovery.

Each policy/source condition remains independent of availability and other condition checks. Do not add dependency edges from device membership or let integration failure absorb this condition. Existing presentation and compatible message grouping retain each finding. Homeostatic owns HA observations, configuration and requests; health-tree owns lifecycle, readiness and attention through public APIs.

## Limits and alternatives

A mower that stays idle or paused has not necessarily failed. Do not infer missed mowing, a stuck mower or a failed return command from duration or position.

Only entities that expose this standard signal are covered. HA reports do not prove physical freshness. Vendor-specific faults and household-specific detection sequences remain HA automation work. Existing availability monitoring covers inability to obtain a reading separately.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns implementation and validation status. Before shipping, update the owning specification, guide, changelog and events reference where affected, and add executable scenarios for:

- Every listed state, restored failing evidence, failure followed by unknown, recovery, recurrence and repeated reports.
- Fresh versus restored startup/restart evidence; acknowledgment without clearance; current evidence gaps without false recovery.
- Exact source eligibility, disabled sources, selection, exclusions, future group members and independent overlapping policies.
- Policy editing, deletion and selective restoration preserving saved choices; monitoring removal distinguished from recovery.
- Independent condition and availability findings, grouped presentation, notification defaults missing or edited, dashboard-only setup and global sending off.
- Mocked direct notification services and optional consumer events, queued observations during I/O and stable delivery ids through outbox replay.

Use existing condition-check APIs. Identify any required health-tree change in both repositories before implementation. Reuse the existing policy editor, flat source choices and named notifications; this decision adds no separate setup workflow.

