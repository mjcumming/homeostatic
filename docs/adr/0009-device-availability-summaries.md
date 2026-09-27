# ADR 0009: Use eligible HA entity evidence for one device availability summary

**Status:** Partially superseded by [ADR 0011](0011-device-availability-requires-meaningful-evidence.md) for evidence selection and partial-unavailability semantics. The remaining decisions are accepted.

**Date:** 2026-09-26

**Deciders:** Michael Cumming

## Context

A Home Assistant device record is an association of entities, not proof that a physical device is connected. Watching every entity separately makes a large installation noisy and expensive, but selecting one arbitrary representative can miss an outage. Integration state alone missed the unavailable OmniLink entities while the integration remained loaded. Some enabled evidence entities are hidden in Home Assistant, and some registered devices have no usable availability entity at all.

The health-tree engine owns node and episode semantics. Homeostatic must decide which HA observations justify a device-level availability check without inventing physical connectivity or causing an existing broad rule to acquire new checks silently.

## Decision

- Homeostatic offers one adapter-owned `device:<registry id>` source and `availability` check for an enabled HA device with at least one eligible registered entity. It is a summary of HA entity availability, not a hardware-health verdict. It creates no automatic dependency edge to its member entities. Individual entity checks remain available when a specific capability matters.
- Use every enabled operational entity associated with the device. If there are none, use enabled diagnostic entities. Configuration entities are not availability evidence. Hidden but enabled entities remain eligible; disabled entities do not count.
- All eligible entities available means `pass`; all unavailable means `fail`; a mix containing unavailable means `warn`; any unknown member with no unavailable member means `unknown`, even if another member is available. Unknown evidence cannot establish recovery. The finding describes HA's observed control path and does not assert a physical cause.
- An HA device disabled in its registry is outside automatic device monitoring. Disabling an enrolled device ends its check and resolves its episode as removed, not recovered; re-enabling allows an applicable rule to enroll it again. A registry record with no eligible entity is a coverage gap, not a fault episode. Coverage counts enabled records separately from disabled ones.
- Device summaries require an explicit `kind: device` catalog match. New installations default to integration-state and device-summary rules with notifications off. Existing saved rules keep their previous scope until edited. Function requirements and entity checks remain explicit owner decisions.

## Options considered

- **Watch every entity by default.** This creates thousands of checks, duplicate problems and an unqualified runtime burden for a large installation.
- **Pick one representative entity per device.** The selected entity could stay available while another relevant path is unavailable; there is no general HA rule that identifies a trustworthy representative.
- **Use integration loaded state or device-registry presence as device health.** Neither establishes whether the device's entity paths are available.
- **Exclude hidden entities or count disabled entities.** Visibility is a presentation choice, while disablement removes an entity from active HA operation. Treating them alike would either miss evidence or create misleading problems.

## Consequences

One device summary bounds the default check count and makes partial and total HA unavailability visible. It cannot identify which capability failed without opening detail or opting into entity checks. Enabled devices without eligible evidence remain explicit coverage work; a future physical-freshness or command-result producer needs its own contract and real traces. This decision changes only the Home Assistant adapter, not health-tree's status, episode or policy rules.
