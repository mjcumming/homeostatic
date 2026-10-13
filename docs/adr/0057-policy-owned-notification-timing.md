# ADR 0057: Configure notification timing inside each policy

**Status:** Accepted; test-setting migration requirements superseded by [ADR 0058](0058-unified-policy-lifecycle.md)
**Date:** 2026-10-13

**Later decision:** Required review-before-save UI is superseded by [ADR 0059](0059-save-directly-and-test-configured-methods.md). The historical decision below is retained; validation and persistence safeguards still apply.

**Partially supersedes:** the reusable schedule library, schedule references and schedule-management UI in [ADR 0055](0055-separate-notification-schedules-and-methods.md), and the corresponding notification-selection fields in [ADR 0054](0054-reusable-monitoring-policy-editor.md). Independent reporting, issue controls, delivery methods and reviewed-save safeguards remain in effect.

**Later decision:** ADR 0058 removes migration of existing test settings from this redesign. The preservation and conversion requirements in Existing notification owners, Editing and conversion, and the implementation checklist below are historical; they no longer block implementation or require legacy override controls. Policy-owned timing, shared delivery methods, normal reviewed edits and persistence of the new model remain required. This waiver does not authorize a live reset or deployment.

## Context

The separate schedule list requires an owner to create or select a named timing definition before completing a monitoring policy. The Notifications page also mixes reusable definitions with default reporting assignments. Reviewing that page and an interactive policy-editor mockup showed that the owner wants to answer when and how to notify while editing the problem being monitored.

Delivery methods still justify a reusable editor: a method can combine destinations and select them using presence. Ordinary timing choices fit directly into a policy. Reusing a named schedule adds more administration than this workflow needs.

## Decision

A monitoring policy owns zero or more notification entries. Each entry stores its timing and references one or more reusable delivery methods. An entry offers two timing choices:

- Immediately: request notification when the problem begins, including overnight. An optional Remind until acknowledged control exposes a positive reminder interval. Reminders end on acknowledgment or recovery.
- Scheduled summary: choose one local time and one or more weekdays in the installation's displayed time zone. Reports include eligible problems still open, including problems already reported immediately or acknowledged. Empty reports and resolved problems are omitted.

Add another notification creates another independent entry. It can use different timing and methods, or reuse a method already selected elsewhere. Only the methods selected in each entry apply to that entry. Deliberately overlapping entries remain allowed; conversion must not merge them. Removing every entry leaves monitoring active and explicitly shows Dashboard only.

Use the inline editor reviewed with the owner as the initial implementation direction. Keep the timing controls and method selection together. An entry requires no schedule name and has no link to a schedule library. Delivery methods retain their own names, stable identities, destinations and optional presence behavior under [ADR 0056](0056-ha-delivery-methods-and-presence.md).

Policies owns monitoring and its notification choices. Notifications retains delivery-method management, the installation-wide notification switch, delivery status, read-only target previews and explicit tests. Remove its Schedules tab and Default notification rows section. This decision does not require renaming the Notifications destination or changing its route.

## Existing notification owners

Moving the controls must preserve the scope of their settings:

| Existing choice | Editor location and retained scope |
| --- | --- |
| Named monitoring policy | Notifications within that policy; its choices remain independent of general defaults. |
| General monitoring default | Carry effective notification choices into the corresponding supplied policies in the unified Policies list. Preserve existing inheritance until the coordinated policy conversion explicitly replaces it. |
| Repairs | Notifications in the ordinary Repairs policy editor, preserving the existing collective reporting scope. |
| Broken automations | Notifications in the ordinary Broken automations policy editor, preserving the existing collective reporting scope. |
| Source preference or condition exception | Existing source settings, using inline timing and method selection. Retain explicit overrides, inheritance and dashboard-only choices. Source details continue to link to named policies that apply. |
| Automation-owned alert | Remains owned by the automation with its existing reporting selection. Retain its compatibility mapping; do not require automation edits as part of this UI change. |

Vacuum Immediate fallback, existing default times and destinations, group selection and exclusion behavior remain unchanged. Converting notification settings must not enroll additional sources, duplicate monitoring or automatically turn every source override into a new policy. UPS reserve entries retain their mains/backup condition selector and the existing renewed-attention behavior; timing is edited inside each entry.

The coordinated policy-list design presents supplied and custom policies together as ordinary editable policies. Apply this notification editor to both. Do not preserve a separate Built-in monitoring section to house notification defaults. The full conversion of built-in enrollment and inherited general defaults to that unified policy model needs its own lifecycle and migration contract before legacy editors are retired. In particular, the implementation must identify which policy owns each inherited setting and how source exceptions remain reachable without changing effective monitoring or reporting. This decision fixes notification timing ownership without claiming that broader conversion is already specified or implemented.

## Editing and conversion

Timing edits affect only their owning entry. Changing a shared delivery method can affect several policies; review continues to show those uses. Deleting an assigned method requires a replacement or explicit removal of affected entries in the same reviewed save. Duplicating a policy copies its timing into the independent inactive copy while retaining references to the selected methods.

Convert each existing schedule reference to equivalent timing in its owning notification entry. Preserve weekday selection, local time, time zone, reminder interval, methods, conditional eligibility and explicit empty assignments. A shared schedule becomes independent timing in each referencing entry. Later timing edits no longer propagate to other policies. Preserve unassigned schedule definitions in retained compatibility data until reviewed migration removes them; they must not become notification entries or gain destinations automatically.

Conversion alone must preserve effective reporting and existing independent entry identities, report grouping, acknowledgment, pauses, next deadlines and pending request identity across restart. It must not restart reminders, activate immediate delivery again or turn one existing summary into several messages solely because timing storage changed. Never silently discard an unsupported custom configuration; retain it until an explicit reviewed replacement. Do not remove compatibility data still used by source, condition or automation assignments.

Reading and editing send nothing. Preserve one complete draft across navigation, preview invalidation, exact reviewed saves and rollback. A deliberate timing or method change follows the existing reporting-change behavior: review identifies affected open issues, superseded requests are canceled or withdrawn where supported, immediate entries can notify again and scheduled entries wait for their next occurrence. Removing notifications never clears the underlying issue. The global notification switch remains independent of whether a policy monitors for problems. Delivery tests remain separate explicit actions.

## Library boundary

Homeostatic owns timing configuration and compiles each entry into a stable opaque attention route. health-tree continues to evaluate schedules, reminders, acknowledgment and persistence. The independent-route model remains necessary for immediate and scheduled reporting of the same issue. Removing the user-facing schedule library does not require an engine behavior change.

## Consequences and implementation work

Owners finish notification setup in the policy editor and reuse delivery methods where their configuration warrants it. Moving several policies from one report time to another requires editing each policy; that tradeoff is accepted. A shared schedule editor can be reconsidered if actual use demonstrates a need.

The [editor design](../policy-editors.md) owns the forms and example journeys. The [roadmap](../roadmap.md) tracks implementation. Keep the current runtime contract in [the specification](../spec.md) until implementation, then update its existing configuration, ownership and conversion sections together with the user guide, README, reference, event wording and screenshots. The prototype demonstrates interaction only; it does not establish runtime or migration correctness.

Implementation requires executable scenarios for multiple methods per entry, several entries per policy, immediate plus scheduled reporting, acknowledgment with continuing summaries, dashboard-only monitoring, independent timing edits, shared-method edits and deletion, duplicate policies, UPS mode selection, and conversion of every owner above. Include unchanged open issues and restart state during conversion. Browser validation covers conditional fields, adding and removing entries, validation, draft retention, review, keyboard operation and narrow layouts. Use isolated instances and mocked delivery actions.
