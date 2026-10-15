# ADR 0065: Keep availability evidence gaps in Sources

**Status:** Accepted
**Date:** 2026-10-14

**Partially supersedes:** [ADR 0060](0060-hide-recovery-confirmation-from-issue-lists.md), solely its requirement to retain missing-evidence conditions in Issues. Preserves the state meanings and monitoring behavior in ADR 0025 and ADR 0064.

## Context

During the October 14 interface review, the owner requested that Issues show reported abnormal conditions rather than waiting-for-a-reading messages. A restored button registration appeared as an issue even though no current device failure was established. A button's ordinary unknown last-pressed value is already passing availability evidence; missing or restored evidence is a different condition.

## Decision

Issues and its counts omit passive availability episodes when their complete current findings are unknown evidence gaps. Availability episodes with passing current evidence awaiting recovery confirmation remain omitted under ADR 0060. Any current warning or failure keeps the issue visible, including in a group whose integration is loaded. Assess all contributing findings, not just the grouping anchor. Incomplete information must not be assumed to contain only evidence gaps. Condition-specific battery, temperature, UPS and other checks retain their own semantics.

Sources continues to show the actual missing, restored or stale evidence and any unresolved episode. A previously reported failure followed by unknown evidence remains unresolved there; omitting it from Issues does not claim current availability, recovery or resolution. No new history classification is needed to decide whether the current findings establish a warning or failure.

A current HA unknown value, including an unpressed button, remains available under ADR 0025. An availability episode awaiting confirmation after that passing observation is omitted consistently with other passing values. The interface never requires pressing a button to establish availability.

When only hidden availability entries remain, Issues says No current issues and provides a route to Sources. It does not relabel hidden evidence gaps as Confirming recovery, list those entries as current failures, or imply that every source is healthy. Readable source details remain the place to investigate those gaps.

The same current-evidence boundary applies to notification attention: passive availability findings with status unknown compile to record-only attention before notification routes. Current warnings and failures retain their configured delivery behavior; an unknown finding does not suppress another actionable finding in a mixed issue. Condition-specific checks keep their existing rules.

Health-tree retains its observations, unknown and recovery holds, episode lifecycle and readiness. Presentation filtering and record-only attention do not acknowledge, close or manufacture a passing observation.

## Consequences

Issues focuses on current reported problems; Sources retains the broader monitoring evidence. The visible issue count can be lower than the engine's open-episode count. Acceptance covers gap-only, passing-after-unknown, failed-then-unknown, mixed warning/failure, grouped and incomplete-evidence cases without changing their underlying monitoring state.
