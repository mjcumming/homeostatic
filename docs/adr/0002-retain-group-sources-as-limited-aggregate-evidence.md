# ADR 0002: Retain Group sources as limited aggregate evidence

**Status:** Proposed
**Date:** 2026-09-26
**Decider:** Michael Cumming (pending)

## Context

A Home Assistant Group can be a control target used by an automation, so its helper setup and aggregate entity have some value as monitored sources. It is also easy to mistake a healthy-looking Group row for proof that every member device works. In Home Assistant 2026.9.3, light and binary-sensor groups can remain available while one member is unavailable. The owner has questioned whether Group sources belong in the list at all.

## Proposed decision

Keep Group config entries and group entities eligible in the pilot as HA aggregate sources. A config-entry check says whether HA loaded the helper; an entity-availability check says whether HA exposes the aggregate. Neither is a member-health rollup. The Group row's source count is not a device count. Group membership adds no dependency edges, and a passing Group check never clears or mutes a member's problem. Monitor important members separately.

## Options considered

- **Remove all Group sources.** This keeps the list closer to physical equipment but loses visibility into a group control target that an automation may require.
- **Keep only the Group config entry.** This retains setup evidence but loses the aggregate entity's HA availability evidence.
- **Treat Group health as member health.** HA's aggregate state can mask an unavailable member, so this would make a false health claim.

## Consequences and review point

The Group remains visible, with a deliberately narrow meaning. Its presence can still be confusing in a device-oriented list. Before accepting this decision, review whether the dashboard explains the limitation where the Group row appears, and whether Group sources should be selected by default or only when a declared function uses them. Do not infer member health from Group state without a separate, tested member-level rule.
