# ADR 0027: Implement fixed reporting with quiet defaults

**Status:** Accepted
**Date:** 2026-09-28
**Deciders:** Michael Cumming

## Context
ADR 0026 settled the interface but left summary membership, recipients and defaults
open. The owner has now approved implementation.

## Decision
The six reporting choices are Immediate, Immediate with acknowledgment, Morning,
Evening, Weekly, and Dashboard only. Both immediate choices use urgent delivery
through quiet hours; only acknowledgment delivery repeats, every 30 minutes.
Shared schedules default to 08:00, 18:00, and Sunday 09:00 in the selected zone.
The household default is weekly. Outgoing requests remain disabled until reviewed.

Profiles select people explicitly; their selected destinations are shared across
profiles. Administrator/household roles describe people, not hidden delivery filters.
Transport ownership validation still prevents assigning another person's phone.

Scheduled reports include still-open new problems first and still-outstanding
problems afterward. Omit resolved and empty reports. Immediate problems are not
also in a digest. Silent updates maintain existing message state without new alerts.
Device preferences follow the affected set to a shared root problem. Explicit
assignments beat the household fallback; conflicting explicit assignments use
acknowledgment, immediate, morning, evening, weekly, dashboard order. Condition
exceptions are check-specific and replace that source's default for that check.

Store versioned generated policy choices and hash with the actual policy. Existing
custom and simple policies remain intact until the owner explicitly switches and
reviews the replacement. All edits use the existing revision/preview/save guard.
No new engine, configuration store, or Home Assistant schedule helpers are needed.

Overview shows Reporting status, missing destination warnings, and the next report
with provisional open-problem count. Controls remain on Notifications and Sources.

## Consequences
HealthTree owns matching and scheduled recurrence. Homeostatic owns choices,
validation, presentation and transport. Notification requests are not receipt.
