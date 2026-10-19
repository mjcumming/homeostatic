# ADR 0055: Pair reusable notification schedules and delivery methods on policies

**Status:** Accepted; reusable schedule ownership and editor partially superseded by [ADR 0057](0057-policy-owned-notification-timing.md); test-setting migration requirements superseded by [ADR 0058](0058-unified-policy-lifecycle.md)
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Date:** 2026-10-12

**Partially supersedes:** the fixed, combined profile model and single-choice assignment in [ADR 0026](0026-fixed-reporting-preferences.md) and [ADR 0027](0027-reporting-defaults-and-delivery.md), and the notification-profile assignment terminology in [ADR 0052](0052-thermostat-setpoint-deviation-alerts.md) and [ADR 0053](0053-configurable-temperature-limit-checks.md). Existing defaults and delivery safeguards remain unless changed here.

**Later decision:** ADR 0057 moves timing into each policy notification entry. This record retains the rationale for the separate schedule library. Its independent reporting, issue controls, delivery-method lifecycle and reviewed-save safeguards continue to apply. ADR 0058 waives migration of existing test settings for the redesign; the earlier conversion requirements below remain as history.

## Context

A household can reuse the same morning schedule for different destinations, and the same destinations for immediate and scheduled reporting. Presence can change where a notification goes without changing when it is due. A combined profile couples those independent choices.

## Decision

Maintain three reusable lists: monitoring policies, notification schedules, and delivery methods. Policies owns monitoring definitions. Notifications owns separate Schedules and Delivery methods lists, along with outgoing-request controls and delivery tests. There is no additional notification-policy list.

A monitoring policy contains zero or more notification rows. Each row explicitly pairs one schedule with one or more delivery methods. Zero rows means dashboard-only monitoring. Rows apply independently: a problem can be sent immediately to phones and included in a later report to email. Independent lists of schedules and methods on a policy must not imply every possible combination.

Schedules own timing. Start with immediate once, immediate with acknowledgment and an editable reminder interval, and reports at one local time on selected weekdays. Immediate includes overnight. Scheduled reports contain eligible open problems and omit empty reports and resolved problems. Schedules do not store recipients or transport details. Existing Immediate, acknowledgment, Morning, Evening and Weekly choices provide starting definitions in the installation's time zone.

Methods own destinations and optional presence selection, as defined in [ADR 0056](0056-ha-delivery-methods-and-presence.md). A schedule can serve several methods, and a method can serve several schedules. Each policy row makes the pairing visible.

## Editing and lifecycle

Schedules and methods support Add, Rename, Edit, Duplicate and Delete with stable identities. A copy gets a new identity and no assignments. Renaming preserves references. Editing a shared definition affects every referencing row; review shows those uses before saving.

Deleting a schedule or method in use requires a replacement, or explicit removal of the affected notification rows in the same reviewed save. References never silently disappear. Removing the final row leaves the policy monitoring without outgoing requests.

Reporting changes apply to already-open problems when saved. Cancel superseded pending requests, withdraw replaceable messages where supported, and activate the affected notification rows under the new configuration. Immediate rows may notify again; scheduled rows wait for their next occurrence. A reporting edit does not clear the underlying problem. A name-only edit does not restart reporting.

Acknowledgment belongs to the issue. It stops acknowledgment-based reminders across its notification rows. Scheduled reports continue to include eligible open problems after acknowledgment. Acknowledgment is not recovery.

## Library boundary and migration

health-tree ADR 0037 adds independent attention routes, with separate reminder and report state per route and shared issue acknowledgment. Homeostatic compiles each notification row to a stable opaque route. Rules within that route retain ordered matching, including explicit record-only barriers for overridden source defaults. Scheduling, reminders, acknowledgment and attention persistence remain in health-tree; Homeostatic supplies definitions, presence evidence and transport.

This working-tree implementation requires the corresponding local health-tree changes. The published library dependency has not been advanced, and this record does not claim a release or deployment.

Existing generated profiles convert for editing into schedules, methods and equivalent explicit pairings without enabling outgoing requests or changing destinations on page load. Custom configurations remain active until a reviewed replacement. Conversion preserves source defaults, condition exceptions, grouped issues, Repairs, broken automations, the vacuum Immediate default and automation-owned reporting selections. Automation selections have separate retained profile mappings and cannot override Repairs or broken-automation assignments. An automation's definition remains owned by its automation.

## Alternatives and validation

Combined profiles are convenient for a single schedule and destination set, but require copies when either side is reused independently. Separate lists with explicit pairings support that reuse and make the added selection visible in the policy editor.

Executable scenarios cover one schedule with several methods, one method with several schedules, immediate plus scheduled reporting of the same issue, shared-definition edits, deletion and replacement, acknowledgment, restart, review invalidation and conversion from existing assignments. Selective withdrawal and reactivation preserve unchanged routes when a shared definition affects only some rows. Deliberately overlapping custom policies remain allowed; ordinary outbox replay preserves request identities.

The [editor design](../spec.md#policies) describes the forms. The runtime contract is maintained in [the specification](../spec.md). Validation uses isolated Home Assistant instances and mocked delivery actions; no live destination trial is claimed.
