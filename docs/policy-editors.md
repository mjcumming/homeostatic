# Policy and notification editors

This page describes the policy editor: monitoring policies contain their own notification timing and select reusable delivery methods. [The specification](spec.md) owns the behavior contract. Example thresholds, times and destinations illustrate the forms and are not supplied monitoring defaults.

Policies supports adding, editing, duplicating, disabling and deleting named definitions. Each policy answers what to watch, when it is a problem, and when and how to notify. The editors preserve one complete draft across navigation and use one Save changes action, with validation and conflict protection handled during saving. Source details link to contributing policies. The coordinated policy-page direction uses one immediately visible list for supplied and user-created policies, with the same editor and actions for both.

## Navigation

Keep Policies and Notifications as separate main pages. Policies contains monitoring definitions and their notification choices. Notifications contains the reusable delivery-method list, global notification switch, delivery status and a Send test action inside each saved method's editor. Remove the Schedules tab and Default notification rows section. Sources shows which policies apply and links to the relevant editor. The Notifications page name and route can remain; this design does not require another top-level page.

Use a compact list that opens a focused editor with a Back action. An unsaved new delivery method does not also appear as a saved list entry beside the editor. Retain the current Home Assistant typography, colors and form controls. Opening an item is read-only until a field changes. Keep Save changes at the bottom of the editor, with pending changes visible while navigating. All configuration pages, retained legacy editors and maintenance forms apply their completed form without a separate review step.

## Policies

The list shows the policy name, monitoring type, watched sources, notifications and enabled state, with supplied policies visible immediately alongside user-created policies. Every policy supports Edit, Duplicate, Enable/Disable and Delete. Defaults are ordinary user-owned policies; supplied templates remain available through Add policy and selective Restore defaults. Updates preserve edits and deletions, and restoration must not overwrite unrelated policies. Duplicating opens an inactive copy. Avoid an empty Named policies section followed by a collapsed Built-in monitoring section. The [unified lifecycle decision](adr/0058-unified-policy-lifecycle.md) records immutable type, capability-based fields, allowed overlap, deletion and restoration. Migration of existing test settings is out of scope.

Choose the monitoring type when adding a policy. Once created, that type is fixed and appears as read-only text in its editor. Duplicates retain the same type. The name, source selection, supported detection settings, enabled state and notification entries remain editable. Use Add policy to monitor a different kind of problem. Use Monitoring type as the user-facing label.

The editor has three groups:

1. What to watch: name, read-only type for an existing policy, and source selection. Build the available choices from the selected type's capabilities. The reviewed patterns are all eligible sources, selected sources, sources in areas, or sources with labels; show only those supported by that type. Allow multiple selected sources, areas or labels where supported by that type. The combined mockup with searchable multiple-selection checklists, areas grouped by floor, compact selection summaries and any-of matching within selected areas or labels was positively reviewed. Group summaries explain that future matches are included. Use type-specific picker labels, headings and help: Choose integrations, Choose devices, Choose entities or the corresponding supported type. Selected integrations are domain/family choices covering current and future configured connections, with account names only as supporting detail. Repairs and Broken automations have a fixed all-sources scope and show explanatory text instead of a dropdown.
2. When it is a problem: supported fields appropriate to that monitoring type, with units and duration beside their values. Omit this group when it contains no configurable setting, including Repairs and Broken automations.
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

Save changes                                Cancel
```

Use the reviewed inline layout as the initial direction: show When to notify and Deliver using together for each entry. Immediately reveals an optional Remind until acknowledged checkbox and, when selected, a positive interval in minutes. Scheduled summary reveals a time and weekday selection. Show the installation time zone and the next report time from saved settings or the current validated draft. State that immediate delivery includes overnight, and scheduled summaries include eligible problems still open even if they were reported immediately.

Delivery methods use labeled checkboxes, allowing more than one selection per entry. Add another notification inserts an independent entry; Remove notification removes only that entry. Require at least one method per saved entry, at least one weekday and a time for a scheduled summary, and a positive interval for reminders. With no entries, show Dashboard only and explain that monitoring continues without notifications. Do not add a schedule name field or a schedule-management link.

Manage delivery methods opens Notifications while retaining the pending policy draft. Save validates new methods needed by that draft. Method names describe reusable destination choices. Changing timing here affects only this entry; the method itself remains shared. Compact summaries that expand for editing were also explored in the prototype, but are not required for the initial implementation.

Save captures and validates the exact complete draft, checks the saved revision and applies it under the existing save lock and rollback protection. A validation or apply error retains the draft and explains what needs attention. Shared-method uses remain visible in the editor. Optional deletion confirmations identify consequences without requiring a general review screen.

### Supplied policies and overlap

Use the same Notifications section in supplied policies, including Repairs and Broken automations, as in user-created policies. Each policy owns its choices directly. The test-phase redesign does not require a migration editor, inherited general defaults, or source-override compatibility controls. Remove those conversion tasks from the implementation plan.

Supplied policies can be deleted without special protection. Keep templates available for selective restoration. Restore selected adds missing defaults to the draft; Save changes applies them. Updates preserve edits and deletions, and do not automatically recreate removed defaults. Deliberately overlapping policies are allowed and operate independently. Identify their contributing policies so owners can adjust excessive notifications themselves; do not add overlap prevention, priorities, forced replacement or silent merging.

The global notification switch remains in Notifications. Turning it off does not remove policy entries or stop monitoring. The page retains delivery status and saved-method tests; viewing or editing a policy never sends a test. Start integration, device and entity availability, Repairs and broken automations enabled. Batteries and vacuums start off; temperature limits, thermostat deviation and UPS monitoring are templates requiring setup. All supplied policies start with no notification entries, and global notification sending starts off.

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

Show the actual triggering measurement and configured threshold in the condition details. Present a useful next step based on the reported condition. Other conditions on the UPS keep their own acknowledgment and alert controls. An equipment-wide pause is follow-up work; current controls act on the selected condition.

When mains returns, keep the reserve issue open until its own readings recover. Show charging as context. A missing runtime is labeled with its cause when known: Not supported, Enable the runtime entity, or Runtime reading unavailable. Missing measurements never become zero readings or a healthy indication. Technical details contains integration-specific flags, entity ids and evidence conflicts.

Policies owns reusable UPS configuration. Sources lists applicable policies and links to that editor. Supported conditions are offered before optional numeric fields; threshold inputs include units and separate raise/clear values. A UPS reserve policy may overlap a generic battery policy. Both retain their independent settings; the redesigned editor does not require a transfer of battery ownership.

The reserve notification editor shows both power modes together. Each entry keeps its mode selector and contains editable timing and selected delivery methods:

| When reserve is low | When to notify | Delivery methods |
| --- | --- | --- |
| Mains power confirmed | Scheduled summary; selected days at 08:00 | Selected methods |
| Backup power confirmed | Immediately; remind every 30 minutes until acknowledged | Selected methods |

Below the entries, state the currently applicable mode and timing. If power mode is unknown, show that uncertainty instead of selecting the mains entry. The editor shows the measurements establishing mode and the selected destinations, with pending changes retained until Save. Both timing choices are edited here. Changing their presentation preserves the existing mains/backup eligibility and renewed-attention behavior.

Keep the card and details readable on a phone, with text labels accompanying status color. Actions must work by keyboard. Live updates preserve the selected condition, open Technical details and unsaved policy changes. Issue counts represent conditions consistently across Overview, Issues and Sources; a UPS with two conditions is one equipment group and two issues.

## Delivery methods

Notifications shows the delivery-method list directly. The list shows Name, Destinations, Presence behavior and Used by. Destinations use short readable summaries such as Two phones, Kitchen voice assistant or Household email. Shared-method uses are visible in the editor. Deleting an assigned method requires replacement or explicit removal of the affected notification entries in the same save.

Place Enable notifications near the top, with the explanation Monitoring continues when notifications are off. Save changes applies this switch with the pending draft.

The method editor starts with its name, its selected destinations and Add destination. Fixed destinations are the ordinary path. Optional presence controls stay collapsed until the owner chooses to change destinations based on who is home.

```text
Household phones

Name            [Household phones]

Send to
Michael's iPhone — App                        Remove
Marla's iPhone — App                          Remove

Add destination
Change destinations based on who's home       >

Save changes                                 Cancel
```

Add destination selects a supported delivery type, then offers a searchable list of its available configured targets. Use friendly names, with area or provider context to distinguish similar destinations. Keep technical identifiers in optional details. Do not present every discovered service or every speech-provider/player combination as a form row.

| Destination type | Fields to show |
| --- | --- |
| App | Available Companion app devices, with linked people where known |
| Speaker announcement | An announcement-capable satellite or compatible speaker; choose a speech provider when needed |
| Email | Configured destinations whose provider identifies email support |
| SMS | A verified SMS provider and the recipient numbers required by its action |
| Generic notification | Configured notification targets whose delivery medium is not established |

Only supported capabilities appear as Email or SMS. Generic notification entities and actions do not establish either capability. Unavailable targets are hidden from new selections by default; unavailable saved targets remain visible for repair or removal. Missing-provider guidance links to Home Assistant setup instead of displaying irrelevant recipient fields.

Presence selection retains home/away destinations or selected people's destinations with an explicit fallback or Skip choice. The method summarizes its saved behavior. Current presence is resolved for a new request or test; merely arriving home sends nothing.

Send test is available only in the saved unchanged method's editor. Save further edits before testing again. One click resolves the method's current configured destinations and requests the test. There is no separate global test area, destination-test catalog, preview button or second test picker. Internal target validation preserves the authorization and saved-revision boundary. Results describe requests, per-destination failures or a presence Skip outcome without claiming receipt.

## Points for UI review

Start with these concrete journeys: add immediate delivery to two methods and a weekly summary to another method on one policy; change one entry's timing without affecting another policy; enable reminders; remove every entry and confirm Dashboard only; delete and selectively restore a supplied policy; edit notifications inside the ordinary Repairs policy; and configure both UPS reserve modes. Also review duplicate policies, shared-method changes, presence fallback and assigned-method deletion.

Check keyboard focus after adding or removing an entry, weekday selection, narrow layouts, draft retention across navigation, and validation during Save. New delivery methods start with fixed destinations. Verify provider capabilities and friendly destination names, saved-only tests, unavailable-target handling and presence fallback. SMS recipient fields appear only for identified SMS providers.

## Implementation boundary

The editor follows the [single-save and delivery editor decision](adr/0059-save-directly-and-test-configured-methods.md), [unified lifecycle](adr/0058-unified-policy-lifecycle.md) and [policy-owned timing](adr/0057-policy-owned-notification-timing.md). Type is read-only after creation. Supplied policies use the same editor and lifecycle as user-created policies. Configurable battery thresholds and independent overlapping policies are part of the runtime contract.

Existing test settings are not automatically converted or reset. Use fresh setup to try this redesign; older schedule-library settings may fail validation. Normal saves, updates and restarts of the new model preserve configuration and runtime state. The installation guide describes the testing transition and backup choices.

Validation covers immutable type, supported selectors, independent detection and notifications, duplication, deletion, selective restoration, shared methods, acknowledgment, scheduled summaries, exact-payload saves and restart persistence. Fresh setup enables basic availability, Repairs and broken automations while leaving every notification entry list empty and global sending off. Tests use isolated instances and mocked delivery actions.

The generic health-tree scheduling and independent attention-route model remains in use. Live-provider trials and browser/device-specific usability follow-up remain separate from isolated validation.

Maintainers: [single-save and delivery editor decision](adr/0059-save-directly-and-test-configured-methods.md), [unified policy lifecycle](adr/0058-unified-policy-lifecycle.md), [policy-owned timing](adr/0057-policy-owned-notification-timing.md), and [delivery methods](adr/0056-ha-delivery-methods-and-presence.md) own the decisions. This page owns form layout.
