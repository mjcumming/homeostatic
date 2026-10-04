# ADR 0048: Show the four policy checks as on or off

**Status:** Accepted
**Date:** 2026-10-04

**Supersedes:** the Policies presentation in [ADR 0047](0047-policies-page.md) that edited a saved broad rule in place and kept other group policies, individual source choices, and Advanced rule details on the page. The collapsed complete catalog editor in [ADR 0030](0030-separate-group-policies-from-source-choices.md) is also superseded. The Policies page, and the split that keeps one source in Sources, remain.

**Repairs row superseded by:** [ADR 0049](0049-repairs-check.md). Repairs uses the same on or off control. The other decisions remain.

## Context

Each of the four checks opened the same rule form as a narrower policy: action, check, free-text match fields, and Remove rule. The Review button on a saved check only opened that form. A second editor listed every source rule and its stored JSON. The owner needs to see whether a check is on, and to turn it off, without rewriting the rule that defines it.

## Decision

The page lists Integrations, Devices, Batteries, and Vacuums, then Repairs. Each of the first four shows whether it is on or off, and one description. Off, with no saved rule, offers the existing Monitor all action. That action drafts the broad rule and does not save it. On offers Turn off, which removes that rule from the draft. A paused broad rule shows Off, with Turn on to enable it and Turn off to remove it. Review and save stay on the shared guarded path.

Devices is the device summary. Its evidence is the entities selected on each device. A separate check for one entity, including an entity attached to a device, stays a choice in Sources.

Repairs is shown always on. Every Home Assistant Repair already becomes an issue, so the row has no off switch. It links to the reporting choice in Notifications. Repairs is not a catalog rule.

Other policies remain for a match such as an area or a label, including Add policy. The match-field editor stays there. The page does not list individual source rules or the stored rule JSON.

## Consequences

A built-in check cannot be narrowed by editing its match fields on this page. A narrower choice is another policy, or a choice in Sources. A rule that combines a condition with one named source is still changed in Sources. Repairs cannot be turned off from Policies.
