# Five reporting preferences

**Date:** 2026-09-28
**Status:** Owner-agreed product direction; detailed behavior and UI design remain in progress. Not implemented.
**Decision:** [ADR 0026](../adr/0026-fixed-reporting-preferences.md).
**Current behavior:** [Integration specification](../spec.md).

## Purpose

An owner must be able to say, "Tell me immediately when this device becomes unavailable, but put that device in the weekly report." Broad importance levels and per-person filters do not express that choice clearly.

Homeostatic will offer five built-in reporting preferences. Their behaviors are fixed product choices, not an owner-authored rule builder. Schedules and assignments are configuration.

## Agreed reporting choices

| Choice | Intended behavior |
| --- | --- |
| Immediate | Notify when the condition is confirmed, including during quiet hours. No acknowledgment requirement and no repeated reminders for the unchanged problem. |
| Immediate - acknowledgment required | Notify when confirmed, including during quiet hours. Repeat until acknowledged or resolved. |
| Morning summary | Include assigned problems in a report at the configured morning time. |
| Evening summary | Include assigned problems in a report at the configured evening time. |
| Weekly summary | Include assigned problems in a report on the configured weekday and time. |

Both immediate choices bypass quiet hours. There is no separate owner-facing "urgent" choice and no "immediate except overnight" choice. The library's existing loudness names need not appear in this interface.

The earlier suggestion to remove acknowledgment was reconsidered. The motivating distinction is:

- Leak monitoring becomes unavailable: tell the owner immediately.
- Water is detected in the basement: tell the owner immediately and keep asking until someone acknowledges it or it clears.

These are different observed conditions, potentially associated with the same physical device. Unavailability is evidence about the monitoring/control path, not proof that the detector hardware is dead. A water alert requires an actual supported situation source; choosing a reporting preference does not create a detector.

Acknowledgment means someone has seen the problem. It stops reminders; it does not change observations, restore monitoring, mark equipment repaired, or resolve a flood. The existing library acknowledgment remains the authoritative state.

"Immediate" starts after the condition is confirmed by the existing monitoring lifecycle. It does not remove detection holds, evidence requirements, startup protection, or dependency correlation. Homeostatic requests immediate delivery; a request does not prove that a phone sounded or a person received it.

## Configuration pattern

Configure schedules inside Homeostatic, running within Home Assistant. Owners do not need separate Home Assistant schedule helpers or automations for these built-in reports.

Notifications owns report times, the weekly weekday, household time zone, people, and destinations. It is also the proposed home for the acknowledgment reminder interval if that interval is editable.

Sources owns assignment of a reporting preference to a device or supported monitored condition. The same device can report loss of monitoring immediately and detected water with acknowledgment required.

Approved defaults: morning 08:00, evening 18:00, weekly Sunday 09:00, and acknowledgment reminders every 30 minutes. Newly monitored sources use the weekly household default.

The page responsibilities are agreed. The interface draft below describes the proposed layout and interactions; unresolved settings are labeled as proposals.

## Interface draft: Notifications and Sources

**Page responsibilities agreed 2026-09-28; layout and detailed interactions proposed.** Keep the top-level Notifications page and redesign its contents. Keep the existing Sources tree with Source, Settings, and History views. No additional top-level destination is needed.

### What changes

| Area | Draft change |
| --- | --- |
| Notifications page | Keep it as the central place for reporting choices, schedules, people, destinations, enablement, and delivery tests. |
| Everything / Important / Urgent only selectors | Remove from the new guided workflow. They must not compete with explicit reporting assignments. |
| Quiet-hours controls | Remove from the new five-choice workflow. Both immediate choices include overnight; summaries use their configured schedules. |
| Source Settings | Add reporting assignments alongside, but separate from, monitoring choices. |
| Source and problem details | Show the saved reporting outcome and a link to its configuration. |
| Existing custom policies | Preserve and explain them until an explicit migration is reviewed and saved. Removing a guided control does not delete its saved policy setting. |

Quiet hours and other advanced capabilities remain available to existing custom policies and in HealthTree. This redesign concerns the guided workflow; it does not remove generic library behavior. Existing policies remain active under their current semantics until migration.

### Notifications layout

Use five compact rows showing the reporting choice, timing, and recipients. Expand a row in place to edit it. Keep a single people/destinations section below the rows so phones are configured once.

This wireframe illustrates per-profile recipients and destinations shared per person. Names are examples.

```text
Notifications                         Requests: Off

Reporting choice                    When
Immediate                           Any time
  Send to: Michael                           [Edit]

Immediate - acknowledgment required Any time
  Send to: Michael, Sarah                     [Edit]

Morning summary                     8:00 AM
  Send to: Michael                           [Edit]

Evening summary                     6:00 PM
  Send to: Michael                           [Edit]

Weekly summary                      Sunday, 9:00 AM
  Send to: Michael                           [Edit]

Both immediate choices include overnight.
Time zone: America/Chicago

People and destinations
Michael   iPhone                  [Edit] [Send test]
Sarah     Pixel                   [Edit] [Send test]

[ ] Enable notification requests

[Review changes]
```

Each editor contains only relevant controls:

- Immediate: recipients. No time or quiet-hours control.
- Immediate with acknowledgment: recipients and the reminder behavior. Reminders repeat every 30 minutes.
- Morning and evening: local report time and recipients.
- Weekly: weekday, local report time, and recipients.
- People: supported destinations and their availability. A destination test is an explicit action, separate from saving.

Show the time zone once beside schedules. In saved summaries, use plain outcomes such as "Sunday at 9:00 AM" rather than internal identifiers.

Keep request enablement visible and distinguish a draft toggle from saved status. A missing recipient or unavailable destination should explain the correction, for example "Choose a destination for Michael." Do not imply that a configured profile is delivering while requests are off.

Each profile selects people, and each person selects destinations once. HA role does not filter explicit profile recipients; phone ownership is validated.

### Sources layout

Reuse Sources -> Settings for assignments. Separate Monitoring and Reporting with headings, rather than mixing a notification choice into the monitoring on/off control.

Show a reporting row for each supported monitored condition. A device with only availability monitoring has one row. A water row appears only if a supported situation is configured and associated with that device. Do not infer that association from a reporting choice.

```text
Basement leak detector
Source     Settings     History

Monitoring
Availability: Monitored

Reporting
When monitoring becomes unavailable
[Immediate                                  v]
Michael. Includes overnight.

When water is detected
[Immediate - acknowledgment required        v]
Michael and Sarah. Repeats until acknowledged.

Change shared schedules and recipients in Notifications.

[Review changes]
```

Open the reporting selector with the six choices and short explanations. Show recipients and timing beneath the selected choice. For a weekly assignment, for example: "Michael will receive this in Sunday's 9:00 AM summary." When requests are off, replace that promise with "Weekly summary selected. Notification requests are off."

Show the origin of a default separately from the effective choice, for example "Uses household default: Morning summary." The order is household default, source preference, then condition exception. Provide "Use household default" to remove an override.

Changing reporting must not silently start or stop monitoring. If a source is unwatched, say it is not monitored and link to its monitoring control; do not imply a reporting assignment will detect faults.

Owner clarification, 2026-09-28: "Dashboard only" is a regular choice in the same reporting list, with the same presentation as the other choices and no separate proposal/off heading. The selector has six explicit choices plus its contextual default/inherit option. Dashboard only retains monitoring without outgoing notifications or reports, so it needs no shared schedule or recipients; Notifications still configures the five delivery choices.

### Shared edits, bulk assignment, and review

Changing a shared schedule or its recipients affects all assignments using that reporting choice. The draft review should show that scope, for example "Weekly summary: Sunday 9:00 AM -> Monday 8:00 AM; applies to 24 saved assignments." Counts must come from actual saved assignments and name the counted unit.

Bulk assignment uses the existing Sources tree. Show selected devices and affected conditions before saving. Preserve explicit condition exceptions by default; replacing them requires an explicit choice. Bulk changes retain check-specific exceptions.

Reuse the existing preview/revision-guarded save workflow:

- Review shows before/after timing, recipients, assignments, and any effect on current open problems that the implemented contract can establish.
- Save requires the exact reviewed draft and unchanged configuration revision.
- A stale review asks for a refreshed review without discarding the draft.
- Navigation between source views or selections does not silently discard edits.
- Following a shared-settings link must preserve or explicitly resolve the current draft.
- Browsing, editing, and previewing never send a test notification or enable requests.

Keep one authoritative saved configuration. The Notifications and Sources forms are different views over it, not separate competing policies.

### Migration and compatibility

Present a deliberate migration review for existing generated policies. It must identify changes to person levels, quiet-hour behavior, reminders, and current open problems; do not map old levels to new choices silently.

Retain custom YAML policies and existing consumers until an explicit compatible migration is designed. If a configuration cannot be represented by the five choices, show "Custom policy" with an explanation rather than an inaccurate editable profile.

Removing quiet-hour controls from the new form must not quietly strip quiet-hour settings from an unmigrated policy. No new permission to send notifications follows from saving this design.

### Visual and interaction direction

Use the existing Home Assistant theme, typography, and light/dark behavior. Prefer aligned rows, clear field labels, and one expanded editor over five large decorative cards.

Reporting choice is not health status. Do not color Weekly green or Immediate red as if those choices described a device's current health. Use text to explain timing; reserve status colors for supported conditions and configuration errors.

On phones, stack each reporting row's timing and recipients beneath its name; keep edit actions reachable without a horizontally scrolling table. Preserve the existing single-source detail navigation. All controls need visible keyboard focus, associated labels, and accessible expansion state; explanations must not require hover.

### Prototype and acceptance draft

The first [interactive prototype](../prototypes/reporting/index.html) is built for Notifications and Sources -> Settings with synthetic data. See its [walkthrough and limitations](../prototypes/reporting/README.md). Browser checks cover schedule edits, source assignments, bulk exception preservation, draft review/save, missing destinations, stale review, and custom-policy states. Desktop and narrow light/dark layouts were inspected. Owner review remains; production configuration and delivery are not connected.

The prototype should demonstrate:

- All five choices; both immediate descriptions explicitly include overnight.
- Editing morning/evening times and the weekly weekday/time.
- No old importance-level filters or quiet-hour controls in the new workflow.
- Configuring a person's destinations once and reusing them in the proposed recipient model.
- A single-condition device and a device with a separately configured situation.
- Clear saved/default/override wording and an unsaved draft.
- Bulk assignment review and a shared-schedule change with visible scope.
- Requests off, missing destinations, custom policy, and stale-review states.
- A link from source reporting to shared settings without lost edits.

The implementation and executable scenarios are governed by ADR 0027 and the specification.

## Approved summary behavior and defaults

Reports contain only still-open problems: new entries first, then still-outstanding
entries with age. Repeat ongoing problems only at their assigned report time.
Omit resolved entries and empty reports. Immediate problems do not also enter a
digest. A recovered problem disappears from pending reports and silently updates
an existing notification where the destination supports replacement.

The household default is weekly, Sunday at 09:00. Morning is 08:00 and evening
18:00. Acknowledgment reminders are fixed at 30 minutes. Requests begin off.
Profiles select people; destinations are configured once per person. Their HA
role does not silently override the explicit profile selection.

Source preferences override the household fallback, with check-specific exceptions.
Bulk edits preserve exceptions. Correlated problems retain one episode: conflicting
explicit preferences favor acknowledgment, immediate, morning, evening, weekly,
then dashboard. Preferences do not change observed status or importance.

Existing policies remain intact until an explicit migration is reviewed and saved.
The new workflow has no quiet-hours or broad person-level filters. Both immediate
choices include overnight. This refines ADR 0026 through ADR 0027.

## Library and adapter boundary

The five named choices belong to Homeostatic. They are adapter configuration identifiers, not new closed library enums. HealthTree continues to own generic attention decisions, matching, acknowledgment, and deadlines. Home Assistant owns timers, persistence, configuration, and transport.

Both immediate choices should use the library behavior that bypasses quiet hours. They differ in acknowledgment/reminder behavior, not whether they may wake the owner. Evidence and observed status remain independent of reporting preference.

HealthTree 0.5.0 supplies weekday schedules, recurring open-problem digests,
multiple explicit recipients, affected-node/check matching, and report forecasts.
Homeostatic compiles the choices into that public policy. It does not independently
schedule messages or inspect policy snapshots for display. Report history is not
required because resolved incidents are excluded.

## Design examples for future executable scenarios

These are discussion cases, not new numbered RFP scenarios or claims of passing tests.

| Case | Required or proposed result |
| --- | --- |
| Confirmed loss of leak monitoring at 02:00; Immediate selected | Request notification at confirmation despite quiet hours; no acknowledgment reminder. |
| Water detected at 02:00; acknowledgment-required selected | Request notification despite quiet hours; repeat at the chosen interval until acknowledgment or observed resolution. |
| Water remains detected after acknowledgment | Stop reminders; keep the situation active until observed clearing. |
| A distinct water incident occurs after recovery | Open a new episode with a new acknowledgment requirement. |
| Morning summary selected | Report at the configured morning schedule rather than at fault onset. |
| Evening summary selected | Report at the configured evening schedule. |
| Weekly summary selected | Report on the configured weekday and time, not every morning. |
| Device recovers before its weekly report | Awaits the content decision; proposed inclusion under Happened and recovered. |
| One hub outage affects Immediate and Weekly devices | Grouping and membership need an explicit contract; the Immediate assignment must not wait for the weekly report. |
| Reporting preference selected for an unwatched source | Do not claim monitoring was enabled or that the source is healthy. |

Implementation acceptance also needs restart continuity, no duplicate openings, authorized acknowledgment, preview/save, migration, and report-history completeness. This document does not authorize live notification tests.
