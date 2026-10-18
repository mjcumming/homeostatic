# ADR 0066: Reuse named notifications with timing and delivery

**Status:** Accepted
**Date:** 2026-10-14

**Release exception:** [ADR 0102](0102-collect-requests-by-saved-notification.md) authorizes replacing the otherwise-valid earlier named-notification configuration with fresh defaults and sending off. This supersedes preservation for that release transition only.

**Later decision:** [ADR 0102](0102-collect-requests-by-saved-notification.md) adds a user-editable collection delay to when-eligible and delivery-hours notifications and groups requests by saved identity, recipient and destination, without requiring a shared issue. Supplied defaults are 5 seconds for Immediate with acknowledgment and 60 seconds for Immediate and Urgent. Scheduled reports have no additional collection delay or delay control.

**Later decision:** [ADR 0099](0099-two-supplied-entity-availability-policies.md) assigns Morning to General entity availability and Immediate to Important equipment availability at first installation. Global sending and destination safeguards remain unchanged.

**Later decision:** [ADR 0067](0067-save-delivery-methods-in-place.md) supersedes only the shared-method reload requirement below. Other notification, preservation and installation boundaries remain in force.

**Supersedes in part:** ADR 0057's policy-owned timing and removal of reusable timing choices; ADR 0026's prohibition on regular-hours delivery; ADR 0058 and ADR 0064's empty supplied notification assignments; ADR 0061's placement of timing controls; and ADR 0059/0061's compound inline-method drafts. Their monitoring, direct-save safeguards, delivery-method and global-activation boundaries remain in force. The earlier waiver for pre-policy test configurations does not permit discarding supported inline notification entries.

## Context

During the October 14 review, the owner requested six reusable named notifications that combine a schedule and destinations, selected by policies. Repeated timing fields inside individual policies made the agreed choices difficult to find and maintain. Urgent daytime delivery is now an explicit choice.

## Decision

Notifications owns each reusable notification's stable identity, name, timing and selected delivery methods. Policies assign these named notifications. Delivery methods retain destinations and optional presence rules. Editing one shared notification changes its saved uses; show those uses before saving. A policy assignment changes only that policy. Each policy, reusable notification and delivery method retains an independent draft and named save action; navigation between them preserves the originating draft. Shared edits apply to saved uses without silently saving a pending assignment. Rename preserves references; deleting an assigned notification requires replacement or explicit removal of its assignments in the same scoped save.

Supply six editable notifications using the Home Assistant installation time zone:

| Notification | Initial timing |
| --- | --- |
| Immediate | When eligible, including overnight |
| Immediate with acknowledgment | Immediately, then every 30 minutes until acknowledged or recovered |
| Urgent | From 08:00 inclusive to 22:00 exclusive each day; hold overnight until 08:00 |
| Morning | Daily at 08:00 |
| Evening | Daily at 18:00 |
| Weekly | Sunday at 08:00 |

Urgent uses the existing normal batching behavior inside its window. Only still-eligible problems send when the window opens; ending overnight does not create a morning message. Scheduled summaries retain eligible open problems, including acknowledged ones, and omit ended problems and empty messages. These are editable defaults, not six closed engine categories.

Map supplied integration, device and entity availability, Repairs, broken automations and battery policies to Morning; vacuum to Evening; temperature-limit templates to Immediate with acknowledgment; and thermostat templates to Urgent. Temperature-limit and thermostat templates remain disabled until their required sources and settings are configured. No notification default enrolls sources or changes existing enabled states. Global sending remains off. Supply no guessed destinations: a notification without delivery methods is visibly unconfigured and sends nothing.

The owner authorized applying these mappings to the existing dashboard-only supplied policies in this local session. That authorization is not an upgrade rule. Future updates preserve custom assignments, explicit dashboard-only choices, edited definitions and deletions. Selective restoration remains explicit.

## Representation and preservation

`notification_definitions.profiles` maps stable IDs to `{name, timing, methods}`. Initial IDs are `immediate`, `acknowledge`, `urgent`, `morning`, `evening` and `weekly`. Policy notification rows retain their own stable `id` and reference a `profile`; UPS reserve rows retain `when`. Existing inline `{id, timing, methods, when?}` rows remain accepted unchanged and appear as Custom notification with their current timing and methods. There is no automatic or background conversion. Explicitly selecting a named notification replaces that row with `{id, profile, when?}`, preserving its row identity and UPS condition. That deliberate assignment may change effective reporting; it does not collapse other independent rows.

Window timing uses `{mode: window, start: 08:00, end: 22:00}`. The adapter compiles it through public health-tree policy configuration with the corresponding quiet window. Existing non-window recipient identities remain unchanged; window-specific recipient aliases retain the existing delivery-method channels. No transport request is implied by reading or saving an unconfigured profile.

Reading, validation and restart preserve existing inline instructions and runtime identities without rewriting stored data. A deliberate profile assignment or shared timing/method change follows the existing changed-reporting behavior for each affected row. Preserve route identity through row edits and retain acknowledgment, report clocks and pending requests when effective instructions are unchanged. Keep supported inline compatibility; unsupported older test schemas do not acquire an automatic reset path. Apply the session-authorized defaults through an ordinary scoped configuration save, preserving unrelated settings and global sending off.

The named-notification profiles map applies in place when other installation settings are unchanged. In that transaction, accompanying policy edits may change notification assignments only; policy identities, order and all other fields must remain unchanged. Combined profile and source/detection edits, policy additions or deletions, or other policy-field changes use the normal reload path. Policy-only monitoring edits retain their existing in-place path. The corresponding generated-policy change belongs to the profile transaction. Keep the registered panel and subscriptions active, retain verified persistence and rollback, and use existing effective route signatures to reactivate only changed reporting. Name-only edits preserve clocks and delivered state. Shared method definitions, time zone, legacy default/Repair/automation assignment definitions, global sending and installation timings retain the existing reload boundary. This does not add a general configuration migration or an alternate runtime owner.

## Acceptance

Implementation status belongs in the roadmap. Verify all six choices, shared edits and deletion, policy assignment, initial mappings, unconfigured destinations, the 08:00/22:00 boundary, daylight-saving transitions, overnight recovery, acknowledgment reminders, UPS conditions, existing inline rows and restart preservation. Use isolated delivery tests. Publication and live installation remain separate actions.
