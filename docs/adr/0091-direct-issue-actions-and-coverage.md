# ADR 0091: Show issue actions and coverage directly

**Status:** Accepted
**Date:** 2026-10-17

**Later decisions:** [ADR 0093](0093-explicit-device-availability-issue-selection.md) adds explicit issue selection. [ADR 0094](0094-one-device-issue-workflow.md) uses one combined device workflow from Open issues and Monitoring, makes Open device secondary, omits a combined opening date and places policy and notification labels beside their buttons. Exact episode links and the separate Stop Monitoring confirmation remain supported.

**Partially supersedes:** Availability action wording in ADRs 0073 and 0074, and opened-issue disclosures and navigation in ADR 0086. ADR 0089 continues to govern the separate entity inspector in Monitoring. Existing confirmation scope, saved-setting safeguards and monitoring semantics remain unchanged.

## Context

The opened entity issue separated related destinations, hid useful context behind Details and used a text link for ending availability monitoring. Its generic Monitoring link repeated a route through the same information. The owner approved direct destination buttons, visible policy and notification access, and Stop Monitoring as the consistent name for an action that ends monitoring without deleting equipment.

## Decision

Opened issues show the source, reported condition, opening time and relevant evidence directly. Remove the Details expander and generic View in Monitoring action. Keep essential diagnostic evidence, current action scope and earlier recorded members when they add context, using ordinary headings and lists without repeating the brief. Useful integration, log and distinct source destinations remain available once each.

For an entity issue, place the primary Open Entity button beside an outlined Open Device button. Omit Open Device when no registry device is known. Keep acknowledgment and notification-pause controls next, followed by an outlined Stop Monitoring button when the issue has eligible availability findings. Buttons wrap without clipping their names on narrow screens.

Use Stop Monitoring for all contextual actions that stop monitoring, including entity, selected-device-member and opened-issue controls and their confirmations. Explain the exact availability scope in the confirmation, naming affected entities and policies. The action still adds exclusions to the applicable availability policies; other check types continue. Resume availability monitoring keeps its existing meaning. Deleting policies or removing notification assignments remains a separate operation with its own accurate label.

Below the issue actions, show Policies: with named buttons for every saved policy covering the entity, including device contributions and independent condition checks. For a wider issue, use its affected sources' applicable policies. Deduplicate policy identities. Each button opens the authoritative policy editor and preserves Back to issue.

Show Notifications: with the saved named notifications assigned through those policies. Deduplicate by notification identity, never by display name or evaluated timing status. Each button opens that notification's editor with Back to issue. Keep independent editor drafts and shared-save scope intact. An older Custom notification belongs to its policy, so its button opens that policy. Explicitly show absent assignments, disabled sending or unconfigured delivery where applicable. A displayed assignment describes configured coverage; it does not assert that a message is currently due or has been delivered.

## Acceptance

Exercise entity and device-linked issues, missing ownership, independent and overlapping policy coverage, shared named notifications, Custom assignments, no assignments, disabled sending and unconfigured delivery. Open each policy and notification editor and return to the original issue, preserving drafts and unrelated saved settings. Verify essential evidence remains visible, duplicate and circular navigation is absent, and non-entity issues retain useful diagnostic destinations.

Cover Stop Monitoring from the opened issue, entity inspector and selected device members, including exact exclusions, cancellation, stale evidence and failed saves. Confirm other checks continue and no Home Assistant entity is deleted. Inspect desktop and phone layouts, keyboard paths, enlarged text and live updates. Use isolated Home Assistant and mocked notification services.
