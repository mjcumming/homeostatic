# ADR 0080: Report moisture from selected leak sensors

**Status:** Proposed
**Date:** 2026-10-15

## Context and product scope

Household members responsible for the property need prompt notice of a leak so they can locate the source and arrange intervention. Leak detection is a common household need with a simple reported wet/dry condition.

Home Assistant defines the `moisture` device class for `binary_sensor` entities. The stored state is `on` or `off`; display labels are not state values. Verified against the [official documentation](https://www.home-assistant.io/integrations/binary_sensor/#device-class) and [Core source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/binary_sensor/__init__.py) on October 15, 2026.

## Decision

Provide **Water leak** as a separate monitoring type using explicitly selected moisture sensors used for leak detection. Provide a disabled template that requires deliberate source selection before enabling. Support the existing entity, area and label selectors where meaningful, policy-local exclusions and independent overlapping policies. Match the exact `moisture` device class, never entity names or vendor attributes. Enabled diagnostic sensors with this class remain eligible for this condition check; availability's operational-only selection rule does not exclude them. Disabled entities, devices and integration entries remain outside monitoring.

| Current HA report | Result |
| --- | --- |
| `on` | `fail` |
| `off` | `pass` |
| `unknown`, `unavailable`, missing, restored, or unrecognized | `unknown` |

Missing and restored evidence take precedence over state text. Use zero raise and clear holds. Unknown evidence neither opens this condition nor clears an existing issue. Repeated failing reports continue the issue; a new failure after recovery creates a new issue. Acknowledgment changes attention without changing the reported condition. Recovery means the specified report ended, without claiming the underlying situation is physically resolved.

Use the finding text **Home Assistant reports moisture at the selected leak sensor**, with the source's name and available location. When evidence becomes unknown, distinguish the last confirmed condition from the current evidence gap.

Propose **Immediate** as the initial named-notification assignment. This remains editable, including dashboard-only monitoring. Assign only an existing definition; never recreate a deleted notification, choose a destination or enable global sending. Immediate requests a notice including overnight; it does not repeat until acknowledgment. Owners can choose Immediate with acknowledgment when appropriate.

Use the unified lifecycle in [ADR 0058](0058-unified-policy-lifecycle.md), with the notification ownership supersession in [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). Preserve saved edits, deletions and independent policy identities. Disable, deletion or lost eligibility ends monitoring as removed, without recording recovery.

Each policy/source condition remains independent of availability and other condition checks. Do not add dependency edges from device membership or let integration failure absorb this condition. Existing presentation and compatible message grouping retain each finding. Homeostatic owns HA observations, configuration and requests; health-tree owns lifecycle, readiness and attention through public APIs.

## Limits and alternatives

Moisture includes uses other than leaks. Require owners to select sensors used for leak detection; never enroll every moisture sensor automatically. Dry means the sensor reports dry, not that damage has been repaired.

Only entities that expose this standard signal are covered. HA reports do not prove physical freshness. Vendor-specific faults and household-specific detection sequences remain HA automation work. Existing availability monitoring covers inability to obtain a reading separately.

## Implementation acceptance

Implementation is pending in the [roadmap](../roadmap.md#current-work). Before shipping, update the owning specification, guide, changelog and events reference where affected, and add executable scenarios for:

- Every listed state, restored failing evidence, failure followed by unknown, recovery, recurrence and repeated reports.
- Fresh versus restored startup/restart evidence; acknowledgment without clearance; current evidence gaps without false recovery.
- Exact source eligibility, including diagnostic sensors, wrong or changed device classes, disabled sources, selection, exclusions, future group members and independent overlapping policies.
- Policy editing, deletion and selective restoration preserving saved choices; monitoring removal distinguished from recovery.
- Independent condition and availability findings, grouped presentation, notification defaults missing or edited, dashboard-only setup and global sending off.
- Mocked direct notification services and optional consumer events, queued observations during I/O and stable delivery ids through outbox replay.

Use existing condition-check APIs. Identify any required health-tree change in both repositories before implementation. This decision draft changes no runtime behavior.

