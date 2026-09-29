# ADR 0030: Show group policies separately from individual source choices

**Status:** Accepted
**Date:** 2026-09-29

**Partially supersedes:** ADR 0028's placement of the complete catalog editor
as the normal Monitoring policies view. Its navigation and reporting decisions
remain in force.

## Context

The owner found individual device and entity rules mixed with installation-wide
policies. Anonymous selection counts and technical match fields obscured what
was watched and duplicated the guided choices in Sources.

## Decision

Settings → Monitoring policies leads with group policies: rules without explicit
integration-instance, device, or entity selectors. Their summaries describe the
source types and all matching conditions, including future matching sources.
Rules with any explicit source selector belong to Sources, even when they select
several sources or combine identities with broader conditions.

Keep the complete catalog editor in a collapsed Advanced rule details disclosure
for inspection and correction of overlapping or unusual rules. Group policy
condition editing is also disclosed explicitly. Ordinary source choices remain
in Sources. Counts describe rules, not devices or monitored inventory totals.

This is a presentation split of the existing catalog, not a migration or a second
store. Preserve every rule, its order, identity, enabled state and matching
semantics. All edits use the complete draft and existing exact preview/save path.

## Consequences

Normal Settings use no longer requires navigating individual source rules.
Advanced access remains available when guided source controls cannot represent
multiple direct policies. Viewing either surface changes no saved choices.
