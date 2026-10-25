# ADR 0082: Report gas detection as an issue

**Status:** Accepted
**Accepted:** 2026-10-25
**Date:** 2026-10-15

## Context and product scope

Household occupants and the person responsible for the property need to know when a gas detector activates so they can follow the detector's emergency instructions. This is a common household monitoring need.

Home Assistant defines the `gas` device class for `binary_sensor` entities. The stored state is `on` or `off`; display labels are not state values. Verified against the [official documentation](https://www.home-assistant.io/integrations/binary_sensor/#device-class) and [Core source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/binary_sensor/__init__.py) on October 15, 2026.

## Decision

Provide **Gas detected** as a separate monitoring type using explicitly selected gas sensors. Provide a disabled template that requires deliberate source selection before enabling. Support the existing entity, area and label selectors where meaningful, policy-local exclusions and independent overlapping policies. Match the exact `gas` device class, never entity names or vendor attributes. Enabled diagnostic sensors with this class remain eligible for this condition check; availability's operational-only selection rule does not exclude them. Disabled entities, devices and integration entries remain outside monitoring.

| Current HA report | Result |
| --- | --- |
| `on` | `fail` |
| `off` | `pass` |
| `unknown`, `unavailable`, missing, restored, or unrecognized | `unknown` |

Missing and restored evidence take precedence over state text. Use zero raise and clear holds. Unknown evidence neither opens this condition nor clears an existing issue. Repeated failing reports continue the issue; a new failure after recovery creates a new issue. Acknowledgment changes attention without changing the reported condition. Recovery means the specified report ended, without claiming the underlying situation is physically resolved.

Use the finding text **Home Assistant reports gas detected**, with the source's name and available location. When evidence becomes unknown, distinguish the last confirmed condition from the current evidence gap.

Use **Immediate** as the initial named-notification assignment. This remains editable, including dashboard-only monitoring. Assign only an existing definition; never recreate a deleted notification, choose a destination or enable global sending. Immediate requests a notice including overnight; it has no acknowledgment reminders. Owners can choose Immediate with acknowledgment when appropriate.

Use the unified lifecycle in [ADR 0058](0058-unified-policy-lifecycle.md), with the notification ownership supersession in [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). Preserve saved edits, deletions and independent policy identities. Disable, deletion or lost eligibility ends monitoring as removed, without recording recovery.

Each policy/source condition remains independent of availability and other condition checks. Do not add dependency edges from device membership or let integration failure absorb this condition. Existing presentation and compatible message grouping retain each finding. Homeostatic owns HA observations, configuration and requests; health-tree owns lifecycle, readiness and attention through public APIs.

## Limits and alternatives

The gas class does not identify the gas species or concentration. Keep the detector's identity visible and do not infer either. This supplements the detector's own alarm and does not provide a life-safety guarantee or operate shutoff valves.

Only entities that expose this standard signal are covered. HA reports do not prove physical freshness. Vendor-specific faults and household-specific detection sequences remain HA automation work. Existing availability monitoring covers inability to obtain a reading separately.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns implementation and validation status. Before shipping, update the owning specification, guide, changelog and events reference where affected, and add executable scenarios for:

- Every listed state, restored failing evidence, failure followed by unknown, recovery, recurrence and repeated reports.
- Fresh versus restored startup/restart evidence; acknowledgment without clearance; current evidence gaps without false recovery.
- Exact source eligibility, including diagnostic sensors, wrong or changed device classes, disabled sources, selection, exclusions, future group members and independent overlapping policies.
- Policy editing, deletion and selective restoration preserving saved choices; monitoring removal distinguished from recovery.
- Independent condition and availability findings, grouped presentation, notification defaults missing or edited, dashboard-only setup and global sending off.
- Mocked direct notification services and optional consumer events, queued observations during I/O and stable delivery ids through outbox replay.

Use existing condition-check APIs. Identify any required health-tree change in both repositories before implementation. Reuse the existing policy editor, flat source choices and named notifications; this decision adds no separate setup workflow.

