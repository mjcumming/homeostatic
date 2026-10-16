# ADR 0088: Show information that supports a decision

**Status:** Accepted
**Date:** 2026-10-16

**Partially supersedes:** The requirement to mark shared issue entries in ADR 0085. Device grouping, issue identity and complete action scope remain unchanged.

## Context

Repeating Shared issue and its device count beneath each affected device describes how Homeostatic stores and groups a problem. It does not help someone identify the reported condition or choose what to investigate. The owner requested removing these labels and retaining the complete scope where acknowledgment and notification pauses are offered.

## Decision

Display information when it helps someone identify a problem, assess its evidence, or choose and understand an action. Omit internal grouping labels and counts from a list when they do not help with a decision. Actual affected-source counts remain appropriate when they explain the extent of a problem.

Open issues keeps each device's findings, condition, opening time and importance. Omit the repeated Shared issue label and cross-device count. Each entry still opens the original complete issue.

The opened issue shows affected names and conditions directly. Explain the complete acknowledgment and notification-pause scope beside those controls, before the user acts. Preserve exact issue identity, recorded membership, recovery, notification behavior and control effects.

## Acceptance

Exercise one issue shown under multiple devices. Verify that list entries omit the shared label and cross-device count, retain their device-specific conditions and open the same complete issue. Verify that affected names and acknowledgment and pause scope remain visible beside the controls. Inspect desktop and narrow layouts using isolated fixtures without live notifications.
