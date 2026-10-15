# ADR 0069: Remove unwanted availability monitoring from Issues

**Status:** Accepted
**Later decision:** [ADR 0074](0074-availability-removal-inside-open-issues.md) supersedes group-wide action placement and selection scope. Availability removal is reviewed inside the opened issue.
**Later decision:** [ADR 0070](0070-saved-monitoring-and-history-navigation.md) supersedes the saved-action Undo and History placement provisions where applicable.

**Date:** 2026-10-14

**Extends:** ADR 0068's contextual availability controls to Issues. Policies remain the configuration owner and Home Assistant state meanings are unchanged.

**Later decision:** [ADR 0073](0073-entity-first-monitoring-details.md) supersedes the applicable entity-detail layout, contextual history placement and availability action wording; existing monitoring and issue semantics remain unchanged.

## Context

An installation can begin with many availability issues the owner does not want to watch. Requiring a separate source visit, entity selection and policy explanation for each one makes routine cleanup impractical. The owner requested one obvious action that removes the affected entities together.

## Decision

Offer Remove these entities from monitoring beside each applicable Issues group. Its scope is the currently unavailable monitored entities represented by the matching group, including issues beyond the visible page. Deduplicate canonical entity identities across overlapping findings and policies. Do not expand selection to healthy siblings, unrelated integration members, dependency impact or historical findings that no longer report unavailability.

Use the existing availability exclusion operation across applicable entity and device policies. Keep other checks and Home Assistant entities enabled. Show one short confirmation with the exact entity count and availability scope. Entity names, IDs and affected policy names remain available under a collapsed Details disclosure. Source details use Remove this entity from monitoring with the same confirmation. Explicit device-member selection and resumption remain available.

Preserve the existing guarded save, saved-setting reconciliation and Undo. Place the Issues result and Undo above the queue so that removing the last issue in a group does not remove the result. Success reports the number removed from availability monitoring. It does not assert recovery or change Home Assistant evidence.

## Acceptance

Exercise grouped removal beyond the visible issue page, overlapping policies, device-only findings, mixed checks, search scope, cancellation, stale or failed saves, reconnect and Undo after the group disappears. Confirm unchanged unrelated settings and state meanings. A large batch must index the inventory once when preparing the saved change.
