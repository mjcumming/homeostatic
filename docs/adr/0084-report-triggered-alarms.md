# ADR 0084: Report triggered alarm panels as issues

**Status:** Proposed
**Date:** 2026-10-15

## Context and product scope

The person responsible for household security needs to know when an alarm panel triggers so they can review the panel's information and follow their security response plan. This is a common household condition.

Home Assistant defines the relevant states in its standard `alarm_control_panel` entity contract. Verified against the [official documentation](https://developers.home-assistant.io/docs/core/entity/alarm-control-panel/) and [Core source](https://github.com/home-assistant/core/blob/dev/homeassistant/components/alarm_control_panel/__init__.py) on October 15, 2026.

## Decision

Provide **Triggered alarm** as a separate monitoring type using explicitly selected alarm control panels. Provide a disabled template that requires deliberate source selection before enabling. Support the existing entity, area and label selectors where meaningful, policy-local exclusions and independent overlapping policies. Selection eligibility does not depend on the current activity. Disabled entities, devices and integration entries remain outside monitoring.

| Current HA report | Result |
| --- | --- |
| `triggered` | `fail` |
| `disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `pending`, `arming`, `disarming` | `pass` |
| `unknown`, `unavailable`, missing, restored, or unrecognized | `unknown` |

Missing and restored evidence take precedence over state text. Use zero raise and clear holds. Unknown evidence neither opens this condition nor clears an existing issue. Repeated failing reports continue the issue; a new failure after recovery creates a new issue. Acknowledgment changes attention without changing the reported condition. Recovery means the specified report ended, without claiming the underlying situation is physically resolved.

Use the finding text **Home Assistant reports the alarm is triggered**, with the source's name and available location. When evidence becomes unknown, distinguish the last confirmed condition from the current evidence gap.

Propose **Immediate** as the initial named-notification assignment. This remains editable, including dashboard-only monitoring. Assign only an existing definition; never recreate a deleted notification, choose a destination or enable global sending. Immediate requests a notice including overnight; it does not repeat until acknowledgment. Owners can choose Immediate with acknowledgment when appropriate.

Use the unified lifecycle in [ADR 0058](0058-unified-policy-lifecycle.md), with the notification ownership supersession in [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). Preserve saved edits, deletions and independent policy identities. Disable, deletion or lost eligibility ends monitoring as removed, without recording recovery.

Each policy/source condition remains independent of availability and other condition checks. Do not add dependency edges from device membership or let integration failure absorb this condition. Existing presentation and compatible message grouping retain each finding. Homeostatic owns HA observations, configuration and requests; health-tree owns lifecycle, readiness and attention through public APIs.

## Limits and alternatives

Triggered reports an alarm event, not equipment failure or proof of an intrusion. Pending and arming are ordinary panel states. Do not interpret armed_custom_bypass as a broken sensor. Homeostatic never arms, disarms or resets the panel.

Only entities that expose this standard signal are covered. HA reports do not prove physical freshness. Vendor-specific faults and household-specific detection sequences remain HA automation work. Existing availability monitoring covers inability to obtain a reading separately.

## Implementation acceptance

Implementation is pending in the [roadmap](../roadmap.md#current-work). Before shipping, update the owning specification, guide, changelog and events reference where affected, and add executable scenarios for:

- Every listed state, restored failing evidence, failure followed by unknown, recovery, recurrence and repeated reports.
- Fresh versus restored startup/restart evidence; acknowledgment without clearance; current evidence gaps without false recovery.
- Exact source eligibility, disabled sources, selection, exclusions, future group members and independent overlapping policies.
- Policy editing, deletion and selective restoration preserving saved choices; monitoring removal distinguished from recovery.
- Independent condition and availability findings, grouped presentation, notification defaults missing or edited, dashboard-only setup and global sending off.
- Mocked direct notification services and optional consumer events, queued observations during I/O and stable delivery ids through outbox replay.

Use existing condition-check APIs. Identify any required health-tree change in both repositories before implementation. This decision draft changes no runtime behavior.

