# ADR 0102: Collect requests by saved notification before delivery

**Status:** Accepted
**Date:** 2026-10-18

**Extends:** [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md), whose reusable notifications own timing and delivery methods.

**Release transition:** The maintainer's explicit configuration-replacement instruction supersedes [ADR 0058](0058-unified-policy-lifecycle.md) and ADR 0066's preservation/no-reset requirements only for the otherwise-valid earlier named-notification format described below. Current-format settings keep their normal preservation rules.

**Supersedes in part:** [ADR 0064](0064-monitoring-coverage-and-device-evidence.md) for the device-based grouping requirement and compatibility-only identity of reusable notification messages. Requests selecting different saved notifications remain separate. Reusable notification collection uses the key below and preserves individual issues and controls. [ADR 0099](0099-two-supplied-entity-availability-policies.md) continues to own the two supplied availability policies and applicable attention through a confirmed integration failure.

## Context

An integration outage can make many monitored entities unavailable. Preserving each configured notification assignment is necessary, but sending a separate opening for every affected entity can produce a burst of phone alerts.

The availability review began with a camera policy and settled on two supplied entity-availability policies: General entity availability using Morning, and Important equipment availability using Immediate. Owners can edit those selections and assignments or create deliberate overlaps. These policies assess availability only; smoke detection, lock jams and other reported conditions remain separate work.

An integration's Morning assignment must not replace an affected lock or leak detector's Immediate assignment. Those are valid independent notification choices. A collection delay can reduce repeated messages among requests selecting the same saved notification without ranking notification names, choosing a winning policy or requiring a common cause.

## Decision

### Collection belongs to the saved notification

Add one numeric input labeled **Collection delay (seconds)** to reusable notifications that send when eligible, including notifications requiring acknowledgment and those limited to delivery hours. Accept whole seconds with a minimum of 0; zero sends without waiting for a collection window. Reject missing, negative, fractional or nonnumeric values when the field applies. Policies continue to select notifications through the existing policy editor; they gain no separate collection setting or priority control.

The setting answers how long Homeostatic may wait to combine requests that select that notification. Use the help text: "Wait this long to combine requests using this notification. Later requests don't extend the wait." Explain that 0 sends without waiting. Show the configured delay alongside timing in the notification's explanation, so Immediate does not imply delivery without that explicitly configured wait. The Notifications editor owns the field, and owners can change it for supplied and user-created notifications alike. Reuse the existing editor, shared-use explanation and Save action. The input needs no separate enable switch, unit selector, disclosure or grouping page.

Scheduled reports already collect eligible open issues for their scheduled send time. Hide the Collection delay field for fixed-time report mode and apply no additional collection delay. A nonzero delay retained from another timing mode must not silently postpone a report. This follows timing mode rather than the notification's name, so a user-created daily report behaves like Morning, Evening or Weekly.

Supply these editable defaults:

| Notification | Collection delay |
| --- | --- |
| Immediate with acknowledgment | 5 seconds |
| Immediate | 60 seconds |
| Urgent, within its configured delivery hours | 60 seconds |
| Morning, Evening and Weekly reports | No additional delay; the report schedule provides collection |

The values are starting settings, not fixed rules for those names. Shared edits apply to the saved uses shown by the existing editor. The maintainer authorized replacing the earlier configuration with fresh defaults for this release instead of converting its saved choices. Setup recognizes the otherwise-valid older notification format with missing collection delays, replaces its settings with the current defaults and leaves sending off. It retains compatible issue history. Other invalid settings still fail visibly; ordinary reloads of the current format preserve saved choices.

### Match the saved notification and delivery target

Collect requests together when they select the same saved notification identity, recipient and resolved delivery destination within its collection window. The effective instructions must remain compatible. Different devices, different issues and unrelated causes may share the collection. A shared integration, device or issue is not a grouping requirement.

Different saved notifications remain separate even if they have identical names or timing. The grouping key does not use a display name or infer importance from words such as Important, Immediate or Urgent. Requests to different recipients or destinations remain separate. Resolve presence through the existing delivery method behavior and retain the accepted targets for pending requests and replay; collection must not broaden the audience.

For example, thirty policies selecting the same saved Immediate notification and phone destination can produce one collected message. One policy selecting Immediate and another selecting Morning retain their separate sends. Intentionally overlapping assignments remain permitted; collection is message presentation and does not remove their policy identities or alter the conditions they monitor.

Use this collection boundary for reusable notification requests instead of first partitioning them into device messages. Do not add successive device, integration and notification collection delays or merge different saved notification identities afterward. Existing causal issue grouping remains independent of message collection.

### Use a fixed window after eligibility

The first eligible request for a collection key opens a window ending at that request's eligibility time plus the configured delay. Matching eligible requests join the window. New arrivals never move its deadline. At the deadline, issue one combined delivery request per resolved destination for the current eligible contents.

Qualification, startup holds, delivery hours, acknowledgment rules and notification pauses determine eligibility first. The collection delay does not make a request eligible sooner, turn Immediate into a scheduled summary or move a Morning request into an Immediate collection. Immediate with a nonzero collection delay permits overnight requests after that explicit wait. Scheduled reports select eligible open issues and request their report at the scheduled time, with no additional collection delay. Reports retain their existing membership and next-occurrence rules; they do not queue every event that occurred since the previous report.

For delivery-hours notifications such as Urgent, overnight issues remain subject to the existing policy hold. When hours open, only still-eligible issues enter the short collection window. An issue that ended overnight does not become a morning request. If a collection deadline falls after delivery hours close, retain the due collection until the next permitted opening, re-evaluate eligibility and apply no second collection delay. Collection never bypasses the saved delivery hours.

Repeated processing of the same issue and assignment must not duplicate a pending member. Issues that end or lose eligibility before delivery leave the pending collection. An empty collection sends nothing. Notifications remain requests to Home Assistant destinations; their creation does not establish provider delivery or phone sound behavior.

After a window closes, a newly eligible opening starts or joins a new window. Collection is not indefinite suppression for everything using that notification. Ordinary silent updates to already-presented issues remain silent, and reminders retain their policy-defined eligibility and timing. Internal absorption or splitting must not turn an already-requested opening into a new opening; distinct new issues and newly eligible assignments retain their right to request attention.

The bounded window reduces bursts that arrive within it. It cannot promise that requests arriving after its deadline will all fit in the first message. Tests and user explanations must state that boundary instead of promising one notification for every outage regardless of duration.

### Present several issues without combining their meaning

A collected message identifies its included issues. It can say "Homeostatic: 3 issues need attention" and list an unavailable leak detector, lock and camera even when they have different causes. Do not claim a common integration cause unless the issue evidence establishes it. Keep message contents concise and open the existing issue workflow for the complete included information.

Each issue retains its evidence, policy assignments, recovery and controls. Acknowledgment applies only to the exact issues shown in the delivered message under the existing acknowledgment rules. Later arrivals never inherit an earlier message's acknowledgment. Partial recovery cannot clear other included issues, and a collected message cannot create a synthetic issue or a new shared cause.

One issue may legitimately appear in an Immediate message and a later Morning summary. Several issues may appear in one Immediate message. The owner should be able to understand both results from the saved notification's timing, collection delay and policy uses.

### Preserve assignments through causal grouping

Retain ADR 0099's requirement that a confirmed integration outage preserves the configured availability assignments of its affected monitored equipment. An integration selecting Morning and an affected leak detector selecting Immediate produce independently eligible requests. This collection rule applies after that evaluation, regardless of whether the engine represents the failure as one integration issue or separate unresolved issues.

If an entity opening is absorbed into an integration issue before delivery, retain its authorized pending membership and deadline without making a second opening. If already requested, update the cause and scope silently under the existing notification history. Collection must not hide the equipment's configured assignment or replay attention merely because its issue anchor changes.

### Ownership and implementation boundary

Homeostatic owns the setting, saved notification identity, configuration validation, display, target resolution and transport. health-tree owns generic eligibility, deadlines, pending collection, exact membership and delivery reduction through public APIs. Pass notification identities as opaque grouping data; the library must not recognize Home Assistant domains or supplied policy names.

Reuse the existing independent attention routes and delivery reduction where they fit. Current Immediate routes bypass ordinary policy batching, so the existing batch setting cannot be assumed to implement this collection delay. Identify the required public library contract in both repositories and update health-tree's governing decision, RFP and executable scenarios before implementation. Homeostatic must not implement a second attention scheduler or read snapshot internals to assemble collections.

Persist pending membership, the fixed deadline, accepted instructions and resolved targets with notification delivery state. Restart and outbox replay must not restart the window, reinterpret targets or duplicate an already-requested collection. Changes to a saved notification must not mix incompatible instructions into an existing pending collection. Preserve queued observations during I/O and existing global sending safeguards.

## Alternatives

- Require a shared issue or integration. This misses bursts of unrelated issues selecting the same saved notification and unnecessarily ties message presentation to cause detection.
- Choose the highest-priority notification. Notification names confer no rank, and choosing a winner can discard configured timing or recipients.
- Send every opening separately. This preserves assignments but creates avoidable bursts.
- Extend the deadline after every arrival. A steady stream could postpone the first notification indefinitely.
- Match different saved notifications by similar names or identical settings. This blurs the owner's independent choices and adds conflict handling beyond the agreed scope.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns implementation status. Completion requires the public library contract, owning specification sections, events reference where affected, guide and changelog updates, and executable scenarios covering:

- Thirty eligible openings using one saved notification, recipient and destination within the window produce one combined outbound request. Include different devices, unrelated issues and a confirmed integration outage.
- Distinct saved identities with identical names/settings, different recipients/destinations and incompatible effective instructions remain separate. Immediate and Morning preserve their independent eligibility; no priority ranking or shared-issue requirement is introduced.
- Zero delay, fixed-deadline boundaries, late arrivals starting a new window, sustained arrivals without deadline extension, repeated member input, and an empty collection after recovery or lost eligibility. Use time fixtures without sleeps.
- Supplied defaults of 5 seconds for Immediate with acknowledgment and 60 seconds for Immediate and Urgent remain editable. Fixed-time reports expose no additional-delay control and send at their scheduled time, including after a timing-mode change that previously had a nonzero collection delay.
- Initial requests, reminders, delivery hours, startup, acknowledgment and pauses retain their policy semantics. Overnight Urgent issues collect only when delivery hours open; ended issues stay out. A deadline crossing closing time waits for the next allowed opening without a second collection delay. Changing collection settings does not create a second delay at device or integration level.
- Integration-first and entity-first observations, absorption before/after delivery, integration recovery and unresolved equipment. Preserve applicable availability assignments, pending deadlines and prior opening history.
- Exact included issue membership in text, links and acknowledgment; no effects on unseen later arrivals or unrelated issues. Partial recovery and updates preserve independent issue controls.
- One seconds input with the agreed label/help, whole-number validation, minimum 0 and no extra switch or unit selector; reject empty, negative, fractional and nonnumeric entries. Cover shared uses, timing-dependent field visibility, explanatory timing, save/reopen, cancellation and failure, including keyboard and narrow-screen rendered review. Both supplied and user-created notifications support user edits under the same timing-mode rules.
- Restart, save changes during a pending window, stable replay IDs, accepted target preservation, global sending off, no destination, queued observations during I/O, and isolated mocked direct-delivery and optional consumer-event paths.
- Replacing valid earlier settings from either config-entry storage location installs fresh defaults once, clears options, retains compatible history and sends no alert. Current-format choices remain unchanged, and malformed or mixed-format settings fail without reset.

This ADR records the accepted collection model. The local implementation uses the sibling health-tree collection contract; [Current work](../roadmap.md#current-work) records acceptance and publication prerequisites.
