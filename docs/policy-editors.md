# Policy and notification editors

This page describes the policy editor: monitoring policies contain their own notification timing and select reusable delivery methods. [The specification](spec.md) owns the behavior contract. Example thresholds, times and destinations illustrate the forms and are not supplied monitoring defaults.

Policies supports adding, editing, duplicating, disabling and deleting named definitions. Each policy answers what to watch, when it is a problem, and when and how to notify. The editors preserve one complete draft across navigation and use Review changes followed by Save changes. Source details link to contributing policies. The coordinated policy-page direction uses one immediately visible list for supplied and user-created policies, with the same editor and actions for both.

## Navigation

Keep Policies and Notifications as separate main pages. Policies contains monitoring definitions and their notification choices. Notifications contains the reusable delivery-method list, global notification switch, delivery status and explicit delivery tests. Remove the Schedules tab and Default notification rows section. Sources shows which policies apply and links to the relevant editor. The Notifications page name and route can remain; this design does not require another top-level page.

Use a compact list with an editor beside it on a wide screen. On a phone, open that same editor as a full-width view with a Back action. Retain the current Home Assistant typography, colors and form controls. Opening an item is read-only until a field changes. Keep review and save at the bottom of the editor, with pending changes visible while navigating.

## Policies

The list shows the policy name, monitoring type, watched sources, notifications and enabled state, with supplied policies visible immediately alongside user-created policies. Every policy supports Edit, Duplicate, Enable/Disable and Delete. Defaults are ordinary user-owned policies; supplied templates remain available through Add policy and selective Restore defaults. Updates preserve edits and deletions, and restoration must not overwrite unrelated policies. Duplicating opens an inactive copy. Avoid an empty Named policies section followed by a collapsed Built-in monitoring section. The [unified lifecycle decision](adr/0058-unified-policy-lifecycle.md) records immutable type, capability-based fields, allowed overlap, deletion and restoration. Migration of existing test settings is out of scope.

Choose the monitoring type when adding a policy. Once created, that type is fixed and appears as read-only text in its editor. Duplicates retain the same type. The name, source selection, supported detection settings, enabled state and notification entries remain editable. Use Add policy to monitor a different kind of problem. Use Monitoring type as the user-facing label.

The editor has three groups:

1. What to watch: name, read-only type for an existing policy, and source selection. Build the available choices from the selected type's capabilities. The reviewed patterns are all eligible sources, selected sources, sources in areas, or sources with labels; show only those supported by that type. Allow multiple selected sources, areas or labels where supported by that type. The combined mockup with searchable multiple-selection checklists, areas grouped by floor, compact selection summaries and any-of matching within selected areas or labels was positively reviewed. Group summaries explain that future matches are included. The runtime capability and matching contract still needs validation for each monitoring type.
2. When it is a problem: supported fields appropriate to that monitoring type, with units and duration beside their values.
3. Notifications: independent entries, each with its own timing and one or more selected delivery methods.

Example policy form:

```text
Garage freeze protection                       On [ ]

Type            Temperature limit (read-only)
Sources         Garage temperature
Minimum         [40] °F
Maximum         [Not set]
For             [10] minutes

Notifications

When to notify       [Immediately]
Remind until acknowledged [x]  Every [30] minutes
Deliver using        [x] Home or away  [ ] Household email
Remove notification

When to notify       [Scheduled summary]
On these days        [Mon Tue Wed Thu Fri Sat Sun]
Time                 [08:00]  America/Chicago
Deliver using        [ ] Home or away  [x] Household email
Remove notification

Add another notification

Review changes                              Cancel
```

Use the reviewed inline layout as the initial direction: show When to notify and Deliver using together for each entry. Immediately reveals an optional Remind until acknowledged checkbox and, when selected, a positive interval in minutes. Scheduled summary reveals a time and weekday selection. Show the installation time zone and the next report time from saved settings or a reviewed draft. State that immediate delivery includes overnight, and scheduled summaries include eligible problems still open even if they were reported immediately.

Delivery methods use labeled checkboxes, allowing more than one selection per entry. Add another notification inserts an independent entry; Remove notification removes only that entry. Require at least one method per saved entry, at least one weekday and a time for a scheduled summary, and a positive interval for reminders. With no entries, show Dashboard only and explain that monitoring continues without notifications. Do not add a schedule name field or a schedule-management link.

Manage delivery methods opens Notifications while retaining the pending policy draft. Final review includes new methods needed by that draft. Method names describe reusable destination choices. Changing timing here affects only this entry; the method itself remains shared. Compact summaries that expand for editing were also explored in the prototype, but are not required for the initial implementation.

The review states which sources will be watched, which existing alerts will end after a detection change, and each notification entry's timing and selected methods. It identifies affected open issues and the uses of changed shared methods. The saved result follows that exact review.

### Supplied policies and overlap

Use the same Notifications section in supplied policies, including Repairs and Broken automations, as in user-created policies. Each policy owns its choices directly. The test-phase redesign does not require a migration editor, inherited general defaults, or source-override compatibility controls. Remove those conversion tasks from the implementation plan.

Supplied policies can be deleted without special protection. Keep templates available for selective restoration. Updates preserve edits and deletions, and do not automatically recreate removed defaults. Deliberately overlapping policies are allowed and operate independently. Identify their contributing policies so owners can adjust excessive notifications themselves; do not add overlap prevention, priorities, forced replacement or silent merging.

The global notification switch remains in Notifications. Turning it off does not remove policy entries or stop monitoring. The page retains delivery status and explicit tests; viewing or editing a policy never sends a test. Start integration, device and entity availability, Repairs and broken automations enabled. Batteries and vacuums start off; temperature limits, thermostat deviation and UPS monitoring are templates requiring setup. All supplied policies start with no notification entries, and global notification sending starts off.

## UPS monitoring

The UPS UI direction and mains/backup reserve schedule split were accepted on October 12, 2026. The accepted contracts and implementation evidence are recorded in [the UPS decision record](adr/0051-monitor-ups-conditions-through-shared-mappings.md). These sketches are illustrative; readings and equipment names are examples.

Sources shows the UPS once, beneath its Home Assistant device. Issues groups its active conditions into a compact card. Keep the most urgent condition visible even when the group is collapsed:

```text
Office UPS                                      2 open issues

Low reserve
8% battery · estimated runtime 3 minutes
Running on backup power

View issues
```

View issues opens the individual conditions for that UPS, with the most urgent first. A condition opens its own details:

```text
Office UPS · Low reserve

Running on backup power
8% battery · estimated runtime 3 minutes

Reserve is below the monitored threshold.
It clears when the monitored reserve readings recover.

Acknowledge low reserve       Pause low reserve alerts
Open in Home Assistant        View monitoring policy

Technical details                                      >
```

Show the actual triggering measurement and configured threshold in the condition details. Present a useful next step based on the reported condition. Other conditions on the UPS keep their own acknowledgment and alert controls. An equipment-wide pause with a scope preview is follow-up work; current controls act on the selected condition.

When mains returns, keep the reserve issue open until its own readings recover. Show charging as context. A missing runtime is labeled with its cause when known: Not supported, Enable the runtime entity, or Runtime reading unavailable. Missing measurements never become zero readings or a healthy indication. Technical details contains integration-specific flags, entity ids and evidence conflicts.

Policies owns reusable UPS configuration. Sources lists applicable policies and links to that editor. Supported conditions are offered before optional numeric fields; threshold inputs include units and separate raise/clear values. A UPS reserve policy may overlap a generic battery policy. Both retain their independent settings; the redesigned editor does not require a transfer of battery ownership.

The reserve notification preview shows both power modes together. Each entry keeps its mode selector and contains editable timing and selected delivery methods:

| When reserve is low | When to notify | Delivery methods |
| --- | --- | --- |
| Mains power confirmed | Scheduled summary; selected days at 08:00 | Selected methods |
| Backup power confirmed | Immediately; remind every 30 minutes until acknowledged | Selected methods |

Below the entries, state the currently applicable mode and timing. If power mode is unknown, show that uncertainty instead of selecting the mains entry. Review includes the measurements establishing mode, the selected destinations, pending changes and any effects on existing issues. Both timing choices are edited here. Changing their presentation preserves the existing mains/backup eligibility and renewed-attention behavior.

Keep the card and details readable on a phone, with text labels accompanying status color. Actions must work by keyboard. Live updates preserve the selected condition, open Technical details and unsaved policy changes. Issue counts represent conditions consistently across Overview, Issues and Sources; a UPS with two conditions is one equipment group and two issues.

## Delivery methods

Notifications shows the delivery-method list directly. The list shows Name, Destinations, Presence behavior and Used by. Destinations use short readable summaries such as Two phones, Kitchen voice assistant or Household email. Shared edits show affected uses in review. Deleting an assigned method requires replacement or explicit removal of the affected notification entries.

The editor starts with a name and a Fixed / Based on presence choice. Fixed is the ordinary path. Add destination offers App, Voice, Email and SMS, then shows the appropriate installed targets and required fields.

| Destination type | Fields to show |
| --- | --- |
| App | Available Companion app devices, with their linked people where known |
| Voice | Assist satellite, or TTS provider and speaker targets |
| Email | Configured email notification destinations |
| SMS | Configured SMS notifier and recipient numbers where its action requires them |

One method can contain several destination rows, including different types. Setup links explain a missing provider. Unavailable saved targets remain visible so the owner can fix or replace them.

Presence controls open only when selected. A home/away method could look like:

```text
Home or away

Delivery        [Based on presence]
People          [Selected household members]

When someone is home
  Voice         [Kitchen assistant]

When everyone is away
  App           [Owner's phone]
  SMS           [Configured SMS destination]

When presence is unknown
  App           [Owner's phone]

Preview current destinations
Review changes                              Cancel
```

The alternate presence option, People currently home, lists selected people and their configured destinations, followed by a fallback or an explicit Skip choice. Both forms summarize what happens when nobody qualifies. Preview current destinations is read-only and states that the next send will use presence at that time. Send test is a separate explicit action showing the destinations it will contact.

Saved methods support Preview delivery method, showing the current destinations and presence evidence, followed by the separate Send test to these destinations action. Its result describes requests and failures without claiming receipt. Editing a method requires saving before testing it.

## Points for UI review

Start with these concrete journeys: add immediate delivery to two methods and a weekly summary to another method on one policy; change one entry's timing without affecting another policy; enable reminders; remove every entry and confirm Dashboard only; delete and selectively restore a supplied policy; edit notifications inside the ordinary Repairs policy; and configure both UPS reserve modes. Also review duplicate policies, shared-method changes, presence fallback and assigned-method deletion.

Check keyboard focus after adding or removing an entry, weekday selection, narrow layouts, draft retention across navigation, and validation before review. New delivery methods start with fixed destinations. Discovered phone, notification, Assist satellite, TTS and SMS targets appear in the appropriate form; SMS requires an explicit recipient number.

## Implementation boundary

The editor follows the [unified lifecycle](adr/0058-unified-policy-lifecycle.md) and [policy-owned timing](adr/0057-policy-owned-notification-timing.md). Type is read-only after creation. Supplied policies use the same editor and lifecycle as user-created policies. Configurable battery thresholds and independent overlapping policies are part of the runtime contract.

Existing test settings are not automatically converted or reset. Use fresh setup to try this redesign; older schedule-library settings may fail validation. Normal saves, updates and restarts of the new model preserve configuration and runtime state. The installation guide describes the testing transition and backup choices.

Validation covers immutable type, supported selectors, independent detection and notifications, duplication, deletion, selective restoration, shared methods, acknowledgment, scheduled summaries, exact reviewed saves and restart persistence. Fresh setup enables basic availability, Repairs and broken automations while leaving every notification entry list empty and global sending off. Tests use isolated instances and mocked delivery actions.

The generic health-tree scheduling and independent attention-route model remains in use. Live-provider trials and browser/device-specific usability follow-up remain separate from isolated validation.

Maintainers: [unified policy lifecycle](adr/0058-unified-policy-lifecycle.md), [policy-owned timing](adr/0057-policy-owned-notification-timing.md), and [delivery methods](adr/0056-ha-delivery-methods-and-presence.md) own the decisions. This page owns form layout.
