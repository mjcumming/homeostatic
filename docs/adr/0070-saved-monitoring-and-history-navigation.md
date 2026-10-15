# ADR 0070: Finish saved monitoring changes and restore History navigation

**Status:** Accepted
**Date:** 2026-10-15

**Partially supersedes:** History placement in ADR 0061 and saved-action Undo in ADRs 0068 and 0069. Monitoring semantics, guarded saves and policy ownership remain unchanged.

**Later decision:** [ADR 0072](0072-quiet-save-completion.md) supersedes persistent save-success messages.

**Later decision:** [ADR 0073](0073-entity-first-monitoring-details.md) supersedes the applicable entity-detail layout, contextual history placement and availability action wording; existing monitoring and issue semantics remain unchanged.

## Context

The owner reviewed the installed phone interface and requested that a completed policy change finish without Undo, that History return to the top navigation, and that controls follow the existing theme standards.

## Decision

A successful contextual monitoring save commits the policy exclusions. Show a concise result without retaining an Undo action or reversal record. Later adjustments use the saved policies. Cancellation before saving, conflict detection, uncertain-result reconciliation and preservation of unrelated drafts remain required.

Use Issues, Sources, Policies, Notifications and History as top-level destinations. History has its own heading, route and selected tab. Remove the History link and nested current/history navigation from Issues. Keep contextual source history and existing deep links.

Apply the accepted Home Assistant theme roles. Final Save actions use the shared accent, secondary actions stay neutral, and hover surfaces apply only when the input device supports hover. A phone tap must not leave a gray group header that resembles selection.

## Acceptance

Exercise saved removal after its group disappears, verify exact policy exclusions, and confirm that no Undo control remains. Cover cancel, conflicts and uncertain outcomes with no automatic retry. Check History navigation, browser Back and Forward, retained drafts and history details. Inspect phone-width light and dark themes, all five navigation entries, accent Save controls and touch-safe group surfaces.
