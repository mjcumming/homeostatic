# ADR 0109: Compact notification presentation with exact local links

**Status:** Accepted
**Date:** 2026-10-23

**Refines:** [ADR 0033](0033-notification-tap-destinations.md) tap routing and [ADR 0102](0102-collect-requests-by-saved-notification.md) message presentation. Collection, attention, issue identity and delivery instructions remain unchanged.

## Context

The [verification](../performance/recorder-event-size-2026-10-23.json) confirms Recorder size warnings for notification and service events. The [research](../performance/notification-payload-research-2026-10-23.json) reproduces unbounded human text and issue IDs duplicated into both phone URL fields. Shortening only the text leaves large phone requests. A reported mobile-app failure is not proven to share this cause.

## Decision

Homeostatic bounds the encoded JSON string for notification messages to 1,400 bytes and titles to 200 bytes, preserving Unicode characters. Shortened message text ends with an instruction to open Homeostatic. `message_summarized` marks title or message shortening. Full current findings remain in the existing issue workflow and query interfaces; the preview is never evidence that the reader has seen every included issue.

Keep event schema 1 and every existing machine-readable field, including complete `episodes`, `routes`, replacement tags, resolved targets and delivery IDs. Add optional `details_url`, `issue_count` and `message_summarized`. Consumers must treat human text as presentation. This preserves existing version-filtered automations. It fixes the observed report, but cannot guarantee Recorder retention when complete membership or other machine fields alone exceed its limit. A universally bounded event would require a separately approved contract change. Detected-fact events are outside this change.

When the encoded legacy link exceeds 256 bytes, use `/homeostatic/notification/<reference>`. The reference hashes the installation identity and ordered exact issue IDs. The authenticated administrator reader returns at most 200 IDs per page. It neither advances monitoring nor extends retention. Links grant no access. The panel resolves every page before displaying the included current issues, preserves scope through issue detail, reload and Back, and never substitutes all current issues for an unavailable reference. Read errors offer retry; unknown or expired references explain the missing scope and offer explicit navigation to all open issues.

Retain only issue IDs and expiry in an additive, validated adapter-owned store section. Existing schema-three stores without this section load as empty; existing configuration, issue state, delivery attempts, pending outbox IDs and targets remain intact. Save new references before event publication. A failed save emits nothing and preserves the raw outbox for retry. Replay regenerates the same reference and delivery ID. Reject malformed stored scopes without resetting user data. Retain scopes for 30 days from their latest request, with at most 1,000 records and 20,000 total membership references; retire the earliest expiry when a cap is reached. A single report above the membership capacity is rejected before publication. These limits do not alter issue-history retention.

Both the built-in phone sender and the Companion consumer blueprint prefer the short local link and keep their legacy fallback. iOS `url` and Android `clickAction` open the sending Home Assistant server in the Companion app. Shortened multi-issue previews omit the phone Acknowledge action, so unseen issues cannot be acknowledged together; existing explicit issue controls remain available. Urgency, silent replacement and clearing retain their existing behavior.

The built-in sender checks the complete encoded service request against a 3,000-byte budget before calling Home Assistant, reserving space for provider wrapping. It rejects a larger request with a Home Assistant error, which existing runtime and delivery-test handlers report. The transport does not shorten membership or replace an exact destination with a general page. Core's rich mobile-app service can catch provider errors and return normally, so preflight validation avoids this size failure without treating successful service completion as confirmed delivery. A scenario registers the real Core mobile-app service and mocks only its HTTP client: the old report receives a simulated payload rejection and logs an error; the compact request passes through the same service and reaches the mocked gateway within budget. The household provider's original response remains unavailable without a new authorized delivery check.

## Acceptance

Executable scenarios cover multibyte and escaped text, a 221-member real HA collection and mocked phone request, blueprint delivery, complete schema-one membership beyond Recorder's bound, bounded paging, exact scope through later arrivals, repeat reload, prepublication save failure, reference validation, expiry and read errors. Existing collection, storage, sender and dashboard tests guard preserved behavior. Rendered desktop and narrow-screen acceptance uses the existing Issues inventory path and isolated HA; provider receipt and native physical-phone use remain separate checks.
