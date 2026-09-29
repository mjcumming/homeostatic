# ADR 0034: Configure an alert once in its Home Assistant automation

**Status:** Accepted; implemented
**Date:** 2026-09-29
**Decision owner:** Michael Cumming
**Relationship:** Partially supersedes ADR 0032's separate declaration and
prohibition on registration through reports for new automation alerts; extends ADR 0033
with explicit notification acknowledgment. The existing ADR 0032 service remains supported for explicitly declared situations.

## Accepted user workflow

Create one HA automation using a Homeostatic alert blueprint. Define the condition,
notification text, and reporting preference together. Save and enable it. No
separate Situation alerts YAML entry or second Sources assignment is required.

Example form:

| Field | Basement water example |
| --- | --- |
| Alert name | Basement water leak |
| Message | Water detected near the basement water heater. |
| Active when | Basement water sensor is Wet |
| Required evidence | Basement water sensor |
| Reporting preference | Immediate with acknowledgment |

Messages may use HA templates. HA evaluates templates and conditions using current
evidence; rendered text is display content, never an identity or instruction.
Additional time-boundary triggers and evidence timeout belong under advanced
settings. Use a default timeout of 300 seconds with the existing
one-minute refresh. Timeout means evidence age, not delay before alerting.

Homeostatic's Notifications page continues to own shared schedules, profile
recipients, phone destinations, and the outgoing-request enable switch. Those
are household setup, performed once. A new automation cannot enable requests or
create recipients. Its selected preference is shown in Sources with a link back
to the automation. Configuration ownership: edit automation-owned name, message, and
preference in HA; avoid a competing editable copy in Sources.

Existing reporting choices are reused: Immediate, Immediate with acknowledgment,
Morning summary, Evening summary, Weekly summary, and Dashboard only. The form
requires an explicit choice, showing when requests are disabled or a profile has
no destination. Save/enable may evaluate an already-active condition and request
a real notification. Show that consequence before activation. No silent fallback
to another recipient or reporting preference.

## Why change the current workflow

The pilot currently requires a YAML declaration, a reporting automation, and a
separate notification preference assignment. This repeats information across
interfaces. A stable identity, evidence lifetime, and routing are necessary; a
separate manual declaration is not.

Generic reporting profiles can serve many alerts. A door left open after midnight
and a basement leak can share a profile and phone without sharing a problem.

## Decision

### Registration and identity

The first valid report, including a clear or unknown report, registers a durable
automation-owned source and records its metadata before requesting delivery.
Registration alone does not open a problem. Invalid metadata/profile references
fail visibly without partial registration or delivery. Reports from that owner
refresh the source; repeated active reports retain the existing episode.

Distinguish three identities:

| Identity | Purpose |
| --- | --- |
| Alert key | Stable condition, such as the basement leak rule |
| Episode ID | One occurrence, from active condition until its observed end |
| Delivery tag/action reference | A particular notification and its response target |

For a blueprint with one alert, derive a durable identity from its owning HA
automation's stable configuration identity, namespaced to the Homeostatic entry.
Do not use the editable title, rendered message, urgency, timestamp, or automation
run context ID. Renaming/restarting keeps identity; duplicating an automation
creates a different identity. Claiming another automation's key is rejected with
a correction path. Custom automations reporting multiple conditions use an
explicit stable key per condition. One owner reports each condition.

Implementation uses the saved automation entity registry's `unique_id`, which is
HA's configuration ID. The blueprint passes `this.entity_id`; the adapter resolves
it to that stable owner. A SHA-256 digest of owner plus condition key identifies the
source within this integration's runtime. Tests cover entity/alias rename, separate
owners, refresh, and reload. Blueprint input edits retain the owner; a newly saved
duplicate receives a different HA configuration ID.

The adapter persists declarations and retirement records in its existing runtime
store, capped at 1000 without automatic identity eviction. `manage_alert` retires
or resumes an owner/key. Retired owners cannot register themselves again until
explicitly resumed. Disabling/deleting a reporter alone lets evidence expire;
retire before deleting its owner automation. Explicit `adopt_situation_id` transfers
a report-only declaration while preserving its node and episode; entity-bound
declarations cannot be adopted. Converted declarations are shadowed even when
retired, and the old report action cannot overwrite them.

### Reporting and recovery

Keep HA in charge of arbitrary conditions, time windows, templates, and evidence
selection. Keep HealthTree as the sole owner of episodes, acknowledgment, and
attention policy. Automatic adapter registration uses public library APIs and
does not introduce another lifecycle or notification bypass.

The blueprint reports active when the condition holds, clear when current
evidence establishes it no longer holds, and unknown when evidence or condition
evaluation is unavailable. It refreshes on evidence changes, startup, and each
minute, with optional exact time triggers. Missing evidence, reporter expiry,
restart, or a template error never asserts recovery.

A timed rule concerns its whole condition: when a configured time window ends,
that condition can clear even if the door remains physically open. Wording must
not claim that someone closed the door unless the evidence establishes that.

Advanced users can use a native Report alert action with the same registration,
ownership, text, preference, and active/clear/unknown contract. They must implement
refresh and recovery themselves. The blueprint packages that work for the normal
workflow. The native actions are `homeostatic.report_alert` and `homeostatic.manage_alert`; their schema is documented in the alert workflow guide.

### Phone interaction and the return path

| User or system event | Intended result |
| --- | --- |
| Tap an individual notification | Open that episode's details, including retained ended history |
| Tap a summary | Open Issues; no bulk acknowledgment |
| Press Acknowledge on an active individual alert | Send an explicit Companion action event; Homeostatic acknowledges that episode |
| Swipe a notification away | Dismiss that phone item; do not acknowledge or resolve the episode |
| Condition reports clear | Resolve through the existing lifecycle and request the appropriate phone update |
| Evidence disappears | Report unknown; preserve the unresolved issue |

Add an Acknowledge action to active individual Companion notifications. Keep View
issue available through the main tap. Summary and resolution notifications have
no ambiguous Acknowledge-all action. Phone pause/snooze controls are outside this
increment; existing issue-page controls remain available.

One listener in Homeostatic handles mobile_app_notification_action events for all
its alerts. No per-rule response automation is needed. Correlate an opaque action
reference with the exact entry, episode, intended recipient, and delivery. Validate
the authenticated HA event origin and authorized recipient; arbitrary event data
or a guessed episode ID must not grant an acknowledgment. Record the verified
actor through the existing library acknowledgment API. Recipient permission scope:
an intended recipient can acknowledge their delivered alert without gaining
administrator configuration privileges. This requires explicit authorization
tests, not removal of existing administrator service protections.

Acknowledgment is shared across recipients, means awareness, and stops only the
attention behavior contingent on missing acknowledgment. It does not resolve the
condition. Persist it before requesting phone updates. Repeated callbacks are
idempotent. A delayed action for an ended occurrence cannot acknowledge a new
occurrence of the same condition. Correlation survives HA restart and is bounded
by an explicit retention policy; unknown/expired references have no side effect.

The listener must tolerate delayed or absent callbacks. A send request is not
proof of receipt, and a clear request is not confirmation of removal. Android's
notification-cleared event may provide dismissal telemetry but cannot serve as
the acknowledgment contract across platforms. There is no dependency on an
iPhone swipe-dismiss callback.

Keep current resolution delivery behavior initially: ordinary resolved messages
request removal, while urgent messages receive a quiet resolution message.
Companion/iOS restrictions can leave earlier critical notifications visible.
Homeostatic's issue state and retained detail remain authoritative.

## Scope and alternatives

This decision covers continuing conditions with observed clearing. One-shot
informational messages, a separate Send notification action, automatic extraction
of every template dependency, a Homeostatic condition editor, and physical-device
remediation are deferred. Do not manufacture recoveries for occurrence-only events.
Existing entity-bound and explicitly declared situations remain supported; an
explicit conversion must preserve open issue identity and saved configuration.

Alternatives considered:

- Keep YAML registration: explicit but duplicates setup and does not solve friction.
- Use one source per urgency: merges independent conditions and their acknowledgments.
- Use message text as identity: templated changes fragment one condition into many issues.
- Create a new issue for every report: periodic refresh produces duplicate problems.
- Treat phone dismissal as acknowledgment/recovery: ambiguous intent and inconsistent
  platform callbacks; never evidence that a condition ended.

## Acceptance scenarios required before implementation is complete

1. Create a leak rule entirely in HA's blueprint editor and receive the selected
   alert without editing Homeostatic YAML or Sources preferences.
2. Door-open and leak rules share a profile; acknowledgment and clearing affect
   only the intended episode. Text and title changes retain identity.
3. Repeated active reports produce one episode. Clear followed by active creates
   a new occurrence; a delayed old phone action cannot acknowledge it.
4. Required evidence loss, template failure, stopped reporter, and HA restart
   preserve the evidence boundary; fresh reports resume without duplicate issues.
5. Rename, duplicate, reload, and blueprint update preserve the identity rules;
   conflicting ownership is rejected visibly.
6. The phone callback is authenticated, recipient-scoped, durable, idempotent, and
   harmless for expired, foreign, forged, or ended targets. Test non-admin recipients.
7. Disabled requests, missing destinations, invalid configuration, and storage
   failure do not silently deliver or leave partially registered sources.
8. Test iOS and Android action payloads with mocked transports, retained-history
   links, summary navigation, and unavailable clear confirmations. Native phone
   interaction needs a separately owner-authorized pilot check.
9. Retirement and explicit conversion of existing situations preserve history,
   prevent accidental re-enrollment, and offer an understandable correction path.

## Review and implementation boundary

The owner approved this workflow on 2026-09-29: one form; automatic registration;
automation owns condition/text/preference; global profiles own recipients;
Acknowledge is an explicit phone action; recovery comes from condition evidence.

The integration spec, event contract, README, guide, and executable scenarios
describe this implementation. It uses public HealthTree APIs with no library
behavior changes. Registration and policy events share the existing durable
save-before-delivery boundary; storage failure makes the runtime unavailable until
recovery rather than issuing an unconfirmed notification.

Phone references survive restart, expire after 30 days, and are capped at 2000.
Authorization requires HA's remote authenticated user context, the recorded
recipient, current phone ownership and permitted route, and the exact live episode.
The callback uses the existing acknowledgment control and does not grant access to
administrator services. Mocked transports validate payloads; actual device behavior
still requires an owner-authorized pilot. Implementation does not imply deployment.

## References

- [ADR 0032: Automation reports](0032-automation-reported-situations.md)
- [ADR 0027: Reporting profiles](0027-reporting-defaults-and-delivery.md)
- [ADR 0033: Notification destinations](0033-notification-tap-destinations.md)
- [Companion action callbacks](https://companion.home-assistant.io/docs/notifications/actionable-notifications/)
- [Android dismissal callbacks](https://companion.home-assistant.io/docs/notifications/notification-cleared/)
- [Companion notification clearing and platform limits](https://companion.home-assistant.io/docs/notifications/notifications-basic/#clearing)
