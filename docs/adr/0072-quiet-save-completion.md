# ADR 0072: Complete saves without persistent success messages

**Status:** Accepted
**Date:** 2026-10-15

**Partially supersedes:** the persistent confirmed-result presentation in [ADR 0061](0061-issues-first-product-workflows.md) and [ADR 0070](0070-saved-monitoring-and-history-navigation.md). Save scopes, navigation, validation and rollback remain unchanged.

## Context

The owner requested removal of Changes saved from the policy editor and equivalent routine success messages throughout the application. The saved form or updated list already shows the result.

## Decision

A confirmed save removes the dirty controls when no newer edits remain. Notification and delivery-method editors retain their return to the matching list and focus the saved row's Edit action. Contextual monitoring updates show the resulting scope without a retained success notice. Do not replace these messages with persistent banners elsewhere.

Saving and Finishing update remain visible while work is pending. Failed, uncertain or disconnected saves retain explicit feedback and the exact draft. Newer edits stay marked unsaved. A successful persistence response alone does not unlock an editor still waiting for its runtime to reconnect. Test-request outcomes remain visible because they report an explicit diagnostic action.

## Acceptance

Exercise clean saves, newer drafts, rejected saves, uncertain responses, runtime reconnection and navigation during saving. Verify that completion removes routine success messages while preserving failures, pending states, focus and unrelated drafts.
