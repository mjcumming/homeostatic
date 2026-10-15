# ADR 0051: Monitor UPS conditions through shared integration mappings

**Status:** Accepted; mandatory battery-ownership transfer superseded for the unified policy redesign by [ADR 0058](0058-unified-policy-lifecycle.md)
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Date:** 2026-10-05
**Updated:** 2026-10-13

**Later decision:** ADR 0058 permits deliberately overlapping UPS reserve and battery policies without required ownership transfer or automatic replacement. The evidence, power-mode selection and renewed-attention decisions remain in effect. The earlier transfer contract is retained below as history and still describes the current implementation.

## Context

A UPS can remain reachable and supply equipment while mains input is lost, reserve is low, or its battery needs replacement. Availability cannot describe those conditions. Home Assistant exposes battery and electrical measurements, but UPS integrations use different status reports. Charging alone cannot establish recovered capacity.

## Decision

Homeostatic uses one producer with small verified mappings for Network UPS Tools and APC UPS Daemon. Mappings identify entity roles, parse flags and normalize units. Entity registry identifiers must belong to the same device and integration. Names and device classes cannot establish a role. Ambiguous roles are excluded. Candidates require status and charge or runtime evidence. Disabled entities remain discoverable without being enabled automatically.

health-tree receives ordinary observations and owns lifecycle, holds, acknowledgment and scheduling. It never interprets UPS metadata. No plugin framework, direct UPS connection or runtime dependency is added.

### Independent conditions

Each condition has an edgeless node and independent issue. Identities include device, check, policy and detection settings. Multiple UPS devices on a server remain separate. Renames preserve monitoring. Loss of an enrolled entity becomes unknown; removal of its device or policy ends monitoring as removed.

| Check | Active evidence | Recovery | Generated schedule |
| --- | --- | --- | --- |
| `ups_power` | Explicit backup operation | Explicit mains operation | Immediate |
| `ups_reserve` | Low warning or monitored numeric threshold | Every monitored numeric signal reaches its recovery threshold and the low warning clears | Morning summary on mains; Immediate with acknowledgment on backup |
| `ups_battery_replacement` | Replacement warning | Valid current status clears the warning | Morning summary |
| `ups_fault` | Mapped fault or loss of protection | Valid current status clears mapped fault flags | Immediate with acknowledgment |

NUT maps OL, OB, LB and RB to mains, backup, low reserve and replacement. OVER, OFF, FSD and ALARM are faults; BYPASS warns of lost protection. TRIM and BOOST describe regulation. Test and calibration flags remain context. APC UPS Daemon maps ONLINE, ONBATT, LOWBATT and REPLACEBATT, with OVERLOAD and NOBATT as faults. Its online binary sensor alone cannot establish backup operation.

Known faults or low warnings can establish a problem despite contradictory mode evidence. Unrecognized flags cannot establish recovery. COMMLOST makes cached status and readings unusable. Valid current status can clear a flag-based condition by omission under its mapped contract. Input reports do not prove power to connected equipment.

Charge and estimated remaining runtime can supply numeric checks; runtime normalizes to minutes. Use owner-selected thresholds or readable device low setpoints. No universal cutoff is invented. Recovery thresholds exceed raise thresholds. If an enrolled setpoint disappears, retain its known threshold and require current evidence to clear. Explicit low warnings override adequate percentages. Charging never clears reserve, replacement or faults by itself.

Checks have zero raise hold, configured clear and unknown holds, and no observation TTL. Missing, invalid, disabled, restored, unknown or unavailable evidence cannot clear them. Capture transitions in order. Persist hysteresis, last confirmed mode and issue identity across restart, and wait for current reports before recovery.

### Reserve schedules and renewed attention

Every reserve notification row selects mains or backup. The editor shows both rows together. Preserve the last confirmed reporting mode through missing or contradictory evidence. Before the first confirmed mode, neither row is eligible and reserve remains visible on the dashboard. Charging and percentage cannot select mode.

A confirmed transition to backup while reserve stays low retains the issue and selects backup reporting. If reserve was acknowledged on mains, call public generic `Policy.rearm` after processing the change. It clears acknowledgment and reevaluates attention across routes while preserving pauses. health-tree never branches on UPS reasons. Mains restoration selects summary reporting; reserve needs its own recovery evidence to clear.

### Enrollment and battery ownership

Conditions begin off and are selected through named monitoring policies. Review shows signals, thresholds, reporting rows and membership changes. Broad selectors can include future supported devices. Enrollment never enables notifications automatically.

Reserve and a generic battery check using the same charge entity cannot both own reporting. The reserve policy offers an explicit transfer preference; review shows the battery checks leaving monitoring. Persist the preference and project exclusions during enrollment, preserving original battery rules and source preferences. Disabling UPS monitoring retains transfer. Clearing transfer or deleting the policy restores prior enrollment only through reviewed save, whose preview shows additions. Reviewed UPS rows own the new condition's reporting; battery reporting settings remain stored for restoration.

### Presentation

Sources groups conditions under the HA device and shows policy ownership. Issues groups open conditions under one UPS card with urgent conditions first, an issue count, useful readings and View issues. Each condition retains its own details, acknowledgment and Pause alerts action. Grouping merges no identities or graph edges.

Details explain reported condition, recovery evidence and next step. Runtime is an estimate; missing runtime is never zero. Wording distinguishes current from last confirmed mode. Partial recovery retains remaining issues and recovery holds. Missing evidence, unsupported measurements, disabled entities and Not monitored have distinct descriptions and native HA links. Numeric editors appear for supported measurements or retained settings. Raw bindings, flags, thresholds and conflicts remain technical evidence.

Condition-specific controls are implemented. A future equipment-wide maintenance action needs its own coverage and end-time preview.

## Scope and validation

No household power dependencies or shutdown, outlet-control or test commands are added. Monitoring outside HA requires the separately planned watchdog. HA reports are the evidence boundary; physical freshness and command success are not inferred.

Fixtures cover both mappings, simultaneous faults, explicit low warnings, hysteresis, units, charging, conflicts, initial missing mode, restart and disappearing setpoints. Isolated HA tests verify registry identity, multiple devices, battery transfer, removed bindings with orphaned states, retained issues and acknowledged reserve escalation. Browser fixtures verify grouping, partial recovery, scoped controls, both schedules and mobile layout. Physical-device traces and provider delivery trials remain separate work.

## Alternatives and consequences

Separate producers duplicate recovery rules. Device classes cannot distinguish remaining runtime or input/output voltage. One issue for every condition could hide new risks behind earlier acknowledgment. Independent conditions preserve those boundaries at the cost of several notices for one UPS. Integration identifiers and status contracts need maintenance as HA changes.

## Sources checked

Checked against HA 2026.9.3 and upstream contracts on October 13, 2026:

- [NUT entity identity](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/nut/entity.py), [constants](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/nut/const.py) and [sensors](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/nut/sensor.py).
- [NUT variables](https://networkupstools.org/docs/developer-guide.chunked/apas02.html) and [status semantics](https://networkupstools.org/docs/developer-guide.chunked/new-drivers.html#_status_data).
- [APC entity identity](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/apcupsd/entity.py) and [sensors](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/apcupsd/sensor.py).
- [APC status mapping in NUT](https://sources.debian.org/src/nut/2.8.1-5/drivers/apcupsd-ups.c/) and [apcaccess fields](https://github.com/therealbstern/apcupsd/blob/master/doc/apcaccess.8).
