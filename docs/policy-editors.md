# Policy and notification editors

The local implementation provides named monitoring policies and separate notification schedules and delivery methods. The designs below also retain the planned UPS screens, which are not implemented. Example thresholds and times illustrate the forms and are not supplied monitoring defaults.

Policies supports adding, editing, duplicating, disabling and deleting named definitions. Notifications provides Schedules and Delivery methods tabs. These editors preserve one complete draft across navigation and use Review changes followed by Save changes. Source details link to contributing policies. Existing broad monitoring controls remain under Built-in monitoring and enrollment. Schedule choices use a selector and delivery methods use checkboxes; source selection offers individual identifiers and supported group fields.

Scheduled reports show the next time from the backend's saved schedule, or from a reviewed draft after its timing changes. Delivery method tests start with Preview delivery method, which shows current destinations and presence. Send test to these destinations is a separate explicit action available for a saved method. Its result describes requests and failures, without claiming receipt. Editing a method requires saving before testing it.

These changes are local and unreleased. Independent notification rows need the local health-tree route implementation; the published integration dependency must be updated after that library API is released. Validation uses automated tests and a synthetic browser fixture, without live Home Assistant devices or real notification requests.

## Navigation

Keep Policies and Notifications as separate main pages. Policies contains monitoring definitions. Notifications has two tabs, Schedules and Delivery methods, plus the existing outgoing-notification control and delivery status. Sources shows which policies apply and links to the relevant editor.

Use a compact list with an editor beside it on a wide screen. On a phone, open that same editor as a full-width view with a Back action. Retain the current Home Assistant typography, colors and form controls. Opening an item is read-only until a field changes. Keep review and save at the bottom of the editor, with pending changes visible while navigating.

## Policies

The list shows Name, Check, Applies to, Notifications and On/Off. Add policy starts with a supported check or built-in template. Each item has Edit and an actions menu containing Duplicate and Delete. Duplicating opens an inactive copy. Existing broad checks remain easy to turn on or off.

The editor has three groups:

1. What to watch: name, check type and source selection. Choose individual sources or a supported group; the group summary explains that future matches are included.
2. When it is a problem: fields appropriate to that check, with units and duration beside their values.
3. Notifications: rows pairing one schedule with one or more delivery methods.

Example policy form:

```text
Garage freeze protection                       On [ ]

Check           Temperature limit
Sources         Garage temperature
Minimum         [40] °F
Maximum         [Not set]
For             [10] minutes

Notifications
Schedule                         Delivery methods
[Immediate with acknowledgment]  [Home or away ×]       Remove
[Morning report]                 [Household email ×]     Remove

Add notification

Review changes                              Cancel
```

Schedule and method fields select from separate reusable lists. Manage schedules and delivery methods opens Notifications while retaining the pending policy draft. Final review includes new definitions needed by that draft. Zero notification rows is described as Dashboard only.

The review states which sources will be watched, which existing alerts will end after a detection change, and which notification rows apply. The saved result follows that exact review.

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

Policies owns reusable UPS configuration. Sources lists applicable policies and links to that editor. Supported conditions are offered before optional numeric fields; threshold inputs include units and separate raise/clear values. The review shows any transfer from overlapping battery monitoring.

The reserve notification preview shows both power modes together, using saved schedule and delivery-method selectors:

| When reserve is low | Schedule | Delivery methods |
| --- | --- | --- |
| Mains power confirmed | Morning summary | Selected methods |
| Backup power confirmed | Immediate with acknowledgment | Selected methods |

Below the rows, state the currently applicable mode and schedule. If power mode is unknown, show that uncertainty instead of selecting the mains row. Review includes the measurements establishing mode, the selected destinations, pending changes and any effects on existing issues. Editing a reusable schedule remains in Notifications.

Keep the card and details readable on a phone, with text labels accompanying status color. Actions must work by keyboard. Live updates preserve the selected condition, open Technical details and unsaved policy changes. Issue counts represent conditions consistently across Overview, Issues and Sources; a UPS with two conditions is one equipment group and two issues.

## Schedules

The list shows Name, When, Repeats and Used by. Its Add, Edit, Duplicate and Delete actions match the other lists. Used by opens the referencing policies.

The schedule editor asks for a name and one reporting mode:

- Immediate: notify when the issue qualifies.
- Immediate with acknowledgment: notify and repeat at the chosen interval until acknowledged or resolved.
- Scheduled report: choose a time and weekdays in the installation's displayed time zone.

The form shows the next report time for a scheduled report. It contains no destination picker. The shipped timing choices can be used as starting definitions and renamed. Editing a shared schedule shows its affected policies in review. Deleting an assigned schedule asks for a replacement or explicit removal of the affected notification rows.

## Delivery methods

The list shows Name, Destinations, Presence behavior and Used by. Destinations use short readable summaries such as Two phones, Kitchen voice assistant or Household email.

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

## Points for UI review

Start with these concrete journeys: duplicate a temperature policy and change its sensor; pair an immediate schedule with several methods; reuse one method in a morning report; create a mixed voice/app method; inspect a home/away fallback; and replace an assigned method during deletion.

Notifications uses tabs and new delivery methods start with fixed destinations. Discovered phone, notification, Assist satellite, TTS and SMS targets appear in the appropriate form; SMS requires an explicit recipient number.

Maintainers: [monitoring policies](adr/0054-reusable-monitoring-policy-editor.md), [schedules and pairings](adr/0055-separate-notification-schedules-and-methods.md), and [delivery methods](adr/0056-ha-delivery-methods-and-presence.md) own the accepted direction. This page owns the form layout and its implementation boundary.
