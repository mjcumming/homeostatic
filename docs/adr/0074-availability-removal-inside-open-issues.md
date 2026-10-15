# ADR 0074: Review availability removal inside an opened issue

**Status:** Accepted

**Date:** 2026-10-15

**Supersedes:** ADR 0069's group-wide action placement and selection scope.

## Context

The owner found the availability count and removal footer visually disconnected from the device and findings above it. A collapsed integration also exposed removal before the owner had inspected an issue. Device grouping makes the integration a browsing boundary, while monitoring exclusions still apply to specific entities.

## Decision

Keep the Open issues queue focused on integrations, affected devices and their findings. Remove the separate unavailable-entity count, removal footer and queue-level confirmation.

Offer Remove from availability monitoring only inside an opened current issue with eligible availability findings, after its acknowledgment and pause controls. Select the current unavailable entities represented by that issue at the time removal is requested. Shared issues may cover several devices and standalone entities. Deduplicate canonical identities and exclude healthy siblings, dependency impact and historical findings.

Use the existing confirmation to identify the exact entities and applicable availability policies. Exclusions can end other availability issues for those same entities. Other check types remain enabled. Keep the guarded save and saved-setting reconciliation.

Tie the review and any failure to the opened issue. Closing the dialog or opening another issue discards an unsaved review. Changed evidence requires a fresh review. Successful removal closes the dialog quietly; failure keeps the current review available without moving feedback into the queue.

## Acceptance

Verify no removal control appears in collapsed or expanded groups. Exercise the opened-issue path for individual, device and shared findings, including deduplication, exact exclusions, cancellation, stale evidence, failed saves and dialog changes during an in-flight save. Confirm unrelated policies and settings remain intact. Inspect the list and dialog at desktop and phone widths.
