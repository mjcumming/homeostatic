# ADR 0112: Monitor selected doors and windows left open

**Status:** Accepted
**Date:** 2026-10-24
**Accepted:** 2026-10-24

## Context

A door or window left open can need attention because of security, heating or cooling loss, or an overnight household expectation. The useful response is to inspect and close the selected opening. This is a common household monitoring need under the [product scope](../spec.md#product-scope). Deliberate source selection and an allowed duration avoid treating ordinary ventilation as a problem.

This decision defines a Left open monitoring type. It follows the ordinary [policy lifecycle](0058-unified-policy-lifecycle.md), [shared notifications](0066-reusable-notifications-own-timing-and-delivery.md) and [preserved introductions](0107-add-new-supplied-policies-disabled-on-upgrade.md). Review an interactive UI/UX mockup before implementing the editor.

## Confirmed rules

- Temperature can qualify a new left-open problem. A later temperature change cannot resolve an established issue. A current report that the opening is closed supplies recovery evidence.
- Monitoring qualification starts within the configured monitoring window. An opening already open at the window's start receives a fresh allowed interval from that boundary; earlier open time receives no credit. If it opens later, qualification starts then, subject to any temperature requirement.
- The end of monitoring hours finishes that monitoring occurrence and stops its notifications. History records that the monitoring window ended, without claiming the opening was closed. The next window starts fresh qualification.
- Existing named notifications own notification timing, destinations and reminders within the monitoring window. A notification schedule cannot extend this policy's monitoring window.

## Decision

### Selection and temperature

Start with explicitly selected contact sensors having Home Assistant device class `door`, `window`, `garage_door` or `opening`. Core defines `on` as open and `off` as closed for these classes ([documentation](https://www.home-assistant.io/integrations/binary_sensor/#device-class), [Core 2026.9.3](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/binary_sensor/__init__.py)). Disabled entities cannot be enrolled. Missing or unavailable saved selections remain visible for correction. Cover entities are outside the initial source scope; supporting them would require explicit treatment of movement and partial position.

Outdoor temperature is optional. A policy using it explicitly selects one temperature-class sensor or one weather entity providing current `temperature` and `temperature_unit` attributes ([weather documentation](https://www.home-assistant.io/integrations/weather/#state-attributes), [Core 2026.9.3](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/weather/__init__.py)). Use current temperature rather than apparent temperature or a forecast. Names and discovery order do not establish outdoor placement. Normalize reported units using the existing temperature conversion contract.

Configure a below threshold, an above threshold, or both; a value exactly on a threshold does not meet that temperature condition. With both thresholds, temperature qualifies below the lower value or above the higher value. Require finite, ordered bounds and a supported unit. Missing, restored, unavailable, unknown, nonnumeric, nonfinite or unitless required temperature evidence cannot qualify a new issue. There is no automatic fallback to a different temperature source.

### Qualification and recovery

Configure an explicit allowed open duration, including zero for immediate qualification. Without a monitoring window, monitoring is continuous. A daily monitoring window uses the Home Assistant installation time zone, includes its start and excludes its end; it can span midnight. Elapsed qualification uses UTC time. Local clock changes must not count repeated wall-clock time twice or invent a nonexistent window boundary.

Before an issue opens, require a continuous interval with the opening reported open, monitoring hours active and any configured temperature condition satisfied. Closing, a required evidence gap, the end of monitoring hours, or temperature returning inside the selected limits cancels pending qualification. Later eligibility starts a full new interval.

Within the current monitoring window, retain an established issue until a current, usable closed report arrives or the window ends. Temperature returning to a comfortable value cannot clear it. A missing, restored, unknown, unavailable or unrecognized contact reading preserves the unresolved issue without establishing its present physical state. Temperature evidence is no longer required to establish recovery.

At the end of monitoring hours, cancel pending qualification and end an established occurrence through the monitoring-ended lifecycle. History explains that the monitoring window ended; it does not record observed closure. Stop new alerts, reminders, scheduled summaries and recovery announcements for that occurrence. Remove its pending collection and report membership and cancel its unsent or retrying notification work without disturbing unrelated issues sharing a message or queue. Existing silent message cleanup may withdraw or update an earlier phone message without requesting new attention. The boundary governs new notification requests; it cannot retract a request already sent to a transport.

The next monitoring window starts a fresh allowed interval from current qualifying evidence, even if the opening remained open throughout the gap. A new qualified occurrence has its own issue and acknowledgment state. An acknowledgment in the preceding window cannot silence it. Acknowledgment during an active window changes attention and never supplies recovery evidence. Without a configured window, monitoring remains continuous until observed closure or an ordinary monitoring-scope change.

Restart or reload discards unqualified elapsed time and requires a fresh interval from current usable evidence within active hours. Preserve established issue identities, acknowledgment and eligible pending delivery identities within their monitoring window. End a restored occurrence whose window expired before authorizing any pending notification work; do not replay requests from a previous window. Fresh closed evidence may resolve an occurrence restored within its window; restored or missing readings cannot. Detection edits, source removal, disabling or deleting a policy follow the existing monitoring-removal lifecycle without recording observed closure. Renaming preserves identity. Overlapping policies remain independent.

### Configuration and ownership

Policies owns source selection, allowed duration, monitoring hours and optional outdoor-temperature limits. Reuse its existing editor and notification assignments. Notifications owns shared sending schedules and delivery methods. The later mockup must make the difference between monitoring hours and notification hours understandable without creating a second notification editor.

Offer an opt-in template requiring explicit sources and duration before enabling. Do not automatically monitor every door or window. Preserve existing policies, destinations, sending choices and historical deletions under the normal upgrade contract.

Homeostatic owns Home Assistant inputs, their interpretation, boundary clocks, configuration and persistence. Use public health-tree APIs for issue lifecycle and attention; snapshots remain opaque. Identify any required library extension in both repositories before implementation. Homeostatic sends no opening or closing commands. The report describes Home Assistant evidence and does not establish physical freshness. Presence rules, forecasts and arbitrary combinations of conditions remain available through automation-owned alerts.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns progress. Before implementation is complete, update current-behavior documentation, user guidance and the changelog together with executable scenarios covering:

- An opening already open at the monitoring start, an opening later in the window, duration zero and exact deadline boundaries; no credit from earlier hours.
- Continuous, overnight and daylight-saving windows; an unfinished countdown and an established issue end at the monitoring boundary, with a fresh interval and independent acknowledgment at the next start. A deadline exactly at the excluded end cannot open an issue or authorize a notification.
- Below-only, above-only and two-sided temperature conditions, exact threshold equality, unit conversion and changes before versus after qualification.
- Every contact and required-temperature evidence gap during qualification and an open issue; a usable closed report within the window clears despite missing temperature. Window expiry records monitoring ended without claiming closure.
- Pending restart, established-issue restore within the window, expiry during downtime without replaying old requests, acknowledgment, closure and recurrence, detection edits, renames, overlaps and monitoring removal.
- Explicit selection, disabled and unavailable sources, template setup, repeated reload, edited and deleted policies and unchanged sending choices on upgrade.
- Existing named notification choices, global sending off, mocked direct service and optional consumer paths, ordered evidence during I/O and stable delivery identifiers on eligible replay. The window end cancels delayed, queued and retrying requests for the expired occurrence, excludes it from later summaries and leaves unrelated grouped findings intact. No new attention or recovery announcement is requested at or after the boundary.

Complete the agreed UI/UX mockup and its rendered review after this ADR is decided, before implementing the editor.
