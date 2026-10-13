# ADR 0049: Turn Repairs on or off like the other checks

**Status:** Accepted
**Date:** 2026-10-04

**Later decision:** The required review-before-save UI is superseded by [ADR 0059](0059-save-directly-and-test-configured-methods.md). The historical decision below is retained; validation and persistence safeguards still apply.

**Supersedes:** the Repairs row in [ADR 0048](0048-policy-checks.md) that stayed always on and linked to Notifications. [ADR 0044](0044-report-home-assistant-repairs-as-issues.md) still reports every Repair while this check is on.

## Context

Integrations, Devices, Batteries, and Vacuums are each on or off. Repairs used a different control, a link to the reporting choice. Reporting for every check already lives in Notifications.

## Decision

Repairs uses the same on or off row. It is on when no broad exclusion is saved. **Turn off** drafts that exclusion. **Monitor all repairs** removes it. Review and save stay on the shared guarded path. The match-field editor does not open for this check. Reporting stays in Notifications.

An installation that has not saved the exclusion keeps every Home Assistant Repair as an issue.

## Consequences

Turning Repairs off and saving ends current Repair issues. They return when the exclusion is removed and saved. A fresh installation still watches Repairs.
