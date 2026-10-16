# Policy and notification editors

This page owns the target form layout for the accepted [product specification](product-specification.md) and [UI standards](ui-standards.md). The October 14, 2026 walkthroughs settled the interaction baseline. The [roadmap](roadmap.md#current-work) owns implementation and acceptance status. [The integration specification](spec.md) owns current behavior. Example thresholds and destinations illustrate the forms. The supplied notification names, times and policy assignments follow [ADR 0066](adr/0066-reusable-notifications-own-timing-and-delivery.md).

Policies supports adding, editing, duplicating, disabling and deleting named definitions. Each policy answers what to watch, when it is a problem, and when and how to notify. One complete policy draft includes its notification assignments and persists through navigation. Reusable notifications and delivery methods have their own shared save scopes. Save policy validates and applies that scope. Source details link to contributing policies. Supplied and user-created policies share one immediately visible list, editor and actions.

## Navigation

Keep Policies and Notifications as separate main pages. The Policies tab opens the Monitoring policies page, with monitoring definitions and their assigned notifications. Notifications opens with the reusable named notifications, each combining timing and delivery-method choices. Delivery methods, their saved tests and delivery status remain available there. Keep the global notification switch independent. Monitoring links to contributing policy editors. No additional top-level page or separate timing-only library is needed.

Use a compact list that opens a focused editor with a contextual return. An unsaved new method does not appear as a saved list entry. Apply the shared Home Assistant theme and controls. [Forms, saving and cancellation](ui-standards.md#forms-saving-and-cancellation) defines editor states, save and discard actions, and the return after saving. [Navigation and continuity](ui-standards.md#navigation-and-continuity) defines task and draft preservation.

## Policies

The list shows the policy name, monitoring type, watched sources, notifications and enabled state, with supplied policies visible immediately alongside user-created policies. Every policy supports Edit, Duplicate, Enable/Disable and Delete. Defaults are ordinary user-owned policies; supplied templates remain available through Add policy and selective Restore defaults. Updates preserve edits and deletions, and restoration must not overwrite unrelated policies. Duplicating opens an inactive copy. Avoid an empty Named policies section followed by a collapsed Built-in monitoring section. The [unified lifecycle decision](adr/0058-unified-policy-lifecycle.md) records immutable type, capability-based fields, allowed overlap, deletion and restoration. Supported inline notification rows remain Custom notification without automatic conversion; rejection of earlier pre-policy test schemas remains unchanged.

Choose the monitoring type when adding a policy. Once created, that type is fixed and appears as read-only text in its editor. Duplicates retain the same type. The name, source selection, supported detection settings, enabled state and notification entries remain editable. Use Add policy to monitor a different kind of problem. Use Monitoring type as the user-facing label.

Use the policy name as the editor heading, without an Edit policy prefix. Place Policy enabled beside the editor heading, with a reminder that changes apply when saved. Keep labels above nearby controls and use paired fields only where they express one choice. Temperature limits show Below (optional) and Above (optional) equally; either or both may be provided. Start duration in minutes, allow hours, and preserve an existing partial-minute value in seconds. Changing display units leaves the saved duration unchanged. Show the resulting rule in plain language, with a nearby explanation for invalid bounds or duration. Keep sensor selection at its current scroll position and retain focus after each choice. Explain a saved global notifications-off state beside the assigned notifications.

The editor has three groups:

1. Source selection: use the equipment type as the heading, such as Temperature sensors, with visible Include radio choices. Give each label a full-width touch target and put the selection action beside the selected option, below it on narrow screens. Preserve native keyboard navigation and focus after each choice. Show each selected source in its own row with the equipment name first and room and floor beneath it; use canonical source names rather than decorated policy-check labels. Keep name and read-only monitoring type above this section. Build the available choices from the selected type's capabilities. The supported patterns are all eligible sources, All except selected, selected sources, sources in areas, or sources with labels; show only those supported by that type. Allow multiple selected sources, areas or labels where supported by that type. The combined mockup with searchable multiple-selection checklists, areas grouped by floor, compact selection summaries and any-of matching within selected areas or labels was positively reviewed. Group summaries explain that future matches are included. Source rows show names and effective areas, with an identity only when the visible name and location remain ambiguous. Search includes area and floor names. Area and label rows show eligible-source counts and initially omit unselected empty groups; selected empty groups remain removable, and Show all areas or Show all labels permits future-source selection. Counts wait for a complete catalog and do not exclude temporarily unavailable readings. Keep search above compact full-row checkbox choices and one selection count beside Done below the scrolling list. Done or Escape returns focus to the picker trigger; Save policy applies the draft. All except selected retains broad selection and subtracts the chosen sources; missing saved exclusions remain visible and removable. Device exclusions offer whole devices and their entity members. Integration exclusions identify individual configured connections. Preserve existing API scopes that combine positive selections with exclusions without broadening them. Use type-specific picker labels, headings and help: Choose integrations, Choose devices, Choose entities or the corresponding supported type. Selected integrations are domain/family choices covering current and future configured connections, with account names only as supporting detail. Repairs and Broken automations have a fixed all-sources scope and show explanatory text instead of a dropdown.
2. When it is a problem: supported fields appropriate to that monitoring type, with units and duration beside their values. Omit this group when it contains no configurable setting, including Repairs and Broken automations.
3. Notifications: select a named reusable notification and show its timing and destination summary. Dashboard only remains an explicit choice. Preserve existing independent assignments and UPS conditions; selecting a named notification is an explicit row edit.

Automatic entity availability covers enabled operational entities, including those without devices. Diagnostic and configuration entities require exact entity selection. Device availability uses operational members only, with no diagnostic fallback. Disabled sources remain ineligible. An exclusion affects only its policy; independently configured checks retain their scope.

Example notification section in a temperature-limit policy:

```text
Notifications
Notification       [Immediate with acknowledgment]
Immediately, including overnight; repeat every 30 minutes until acknowledged
Destinations not configured
Edit notification

Unsaved changes
Discard changes                             Save policy
```

The assignment selector lists the saved named notifications with short timing and destination summaries. Opening Edit notification preserves the policy draft and provides a return route. Saving a shared notification applies to its saved uses; it does not save the policy assignment or another editor's draft. Show unconfigured delivery methods clearly without inventing recipients or enabling sending. Removing assignments leaves Dashboard only and monitoring continues.

Save captures and validates the exact complete draft, checks the saved revision and applies it under the existing save lock and rollback protection. A validation or apply error retains the draft and explains what needs attention. Shared-method uses remain visible in the editor. Optional deletion confirmations identify consequences without requiring a general review screen.

### Supplied policies and overlap

Use the same Notifications section in supplied and custom policies. Each policy owns its assignments; the chosen reusable notification owns timing and selected methods. Supported inline rows keep their effective timing and methods as Custom notification. Explicit profile selection preserves the row identity and UPS condition while applying the chosen notification. No legacy source-override editor returns.

Supplied policies can be deleted without special protection. Keep templates available for selective restoration. Restore selected adds missing defaults to an explicitly scoped restoration draft; its save applies those additions without saving other editors. Updates preserve edits and deletions and do not recreate removed defaults automatically. Deliberately overlapping policies operate independently. Identify their contributions so owners can adjust their monitoring. Keep detection and policy clocks independent. Compatible authorized notifications about one device share a continuing message; different complete instructions or resolved destinations remain separate. Do not add overlap prevention, priorities or forced replacement.

The global notification switch is available throughout the interface and applies only its own saved state. Turning it off does not remove policy entries or stop monitoring. Notifications retains request status and saved-method tests; viewing or editing a policy never sends a test. Start integration, device and entity availability, Repairs and broken automations enabled. Batteries and vacuums start off; temperature limits, thermostat deviation and UPS monitoring are templates requiring setup. Map integration, device and entity availability, Repairs, broken automations and battery to Morning; vacuum to Evening; temperature-limit templates to Immediate with acknowledgment; and thermostat templates to Urgent. Required source and detection setup still gates enabling templates. Global sending starts off and supplied notifications have no guessed destinations. The session-authorized assignment of existing dashboard-only supplied policies is not a future upgrade rule.

## UPS monitoring

The UPS UI direction and mains/backup reserve schedule split were accepted on October 12, 2026. The accepted contracts and implementation evidence are recorded in [the UPS decision record](adr/0051-monitor-ups-conditions-through-shared-mappings.md). These sketches are illustrative; readings and equipment names are examples.

Monitoring shows the UPS once, beneath its Home Assistant device. The Open issues page groups its active conditions into a compact card. Keep the most urgent condition visible even when the group is collapsed:

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

Policies owns reusable UPS configuration. Monitoring lists applicable policies and links to that editor. Supported conditions are offered before optional numeric fields; threshold inputs include units and separate raise/clear values. A UPS reserve policy may overlap a generic battery policy. Both retain their independent settings; the redesigned editor does not require a transfer of battery ownership.

The reserve notification editor shows both power modes together. Each assignment keeps its mode selector and chooses a reusable notification:

| When reserve is low | Notification |
| --- | --- |
| Mains power confirmed | Morning, or the existing equivalent notification |
| Backup power confirmed | Immediate with acknowledgment, or the existing equivalent notification |

Below the entries, state the currently applicable mode and timing. If power mode is unknown, show that uncertainty instead of selecting the mains entry. The editor shows the measurements establishing mode and the selected destinations, with pending changes retained until Save. Timing and destinations are edited in the selected reusable notification. Changing presentation preserves the existing mains/backup eligibility and renewed-attention behavior; the examples do not reassign an existing UPS policy.

Keep the card and details readable on a phone, with text labels accompanying status color. Actions must work by keyboard. Live updates preserve the selected condition, open Technical details and unsaved policy changes. Issue counts represent conditions consistently across Open issues and Monitoring; a UPS with two independent condition issues is one equipment group and two issues.

## Reusable notifications

Notifications starts with the six supplied named notifications: Immediate, Immediate with acknowledgment, Urgent, Morning, Evening and Weekly. Each is an ordinary editable definition with a stable identity, timing, selected delivery methods and visible uses. Display configured timing and destinations directly in the list, including an unconfigured destination state. Add, edit, duplicate and delete use the same lifecycle for supplied and custom definitions; future updates preserve edits and deletions.

The notification editor keeps timing and methods together. Immediate includes overnight; acknowledgment reminders initially repeat every 30 minutes. Urgent initially permits delivery from 08:00 to 22:00, holding eligible overnight attention until 08:00. Morning is 08:00 daily, Evening 18:00 daily and Weekly Sunday at 08:00. Show the Home Assistant time zone and next evaluated occurrence when available. Summaries include eligible open problems, including acknowledged ones, and omit ended problems and empty messages.

A profile may be saved without methods while destinations are being configured. Label it unconfigured and explain that it sends nothing. Reuse the existing delivery-method picker and method editor, including optional presence behavior. Keep each save scope explicit; changing a shared notification affects its listed uses, while changing a policy assignment affects only that policy. No separate Review changes screen is introduced.

## Delivery methods

Delivery methods is a secondary view within Notifications. Its list shows Name, Destinations, Presence behavior and Used by. Use readable summaries such as Two phones, Kitchen voice assistant or Household email. Shared uses include reusable notifications. Deleting an assigned method requires explicit replacement or removal of its references in the same saved scope; a notification left without methods is visibly unconfigured and sends nothing.

Use the shared Notifications switch and explicit On/Off state, with the explanation Monitoring continues when notifications are off. Apply this control independently of drafts. Place pending or error feedback beside or directly below it; routine success needs no banner.

The method editor starts with its name, its selected destinations and Add destination. Fixed destinations are the ordinary path. Optional presence controls stay collapsed until the owner chooses to change destinations based on who is home.

```text
Household phones

Name            [Household phones]

Send to
Michael's iPhone — App                        Remove
Marla's iPhone — App                          Remove

Add destination
Change destinations based on who's home       >

Unsaved changes
Discard changes                             Save delivery method
```

Add destination selects a supported delivery type, then offers a searchable list of its available configured targets. Each destination is a compact, left-aligned row with its friendly name and area where available. Tap the row to select it. If a speaker needs a speech provider, choose it on the next view; Back to speakers retains the search. Keep the title and one Close control together above a single scrolling body. Keep technical identifiers in optional details. Do not present every discovered service or every speech-provider/player combination as a form row.

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

Review selecting one of the six notifications on a policy, editing a shared notification and inspecting all affected uses, leaving a notification without destinations, choosing Dashboard only, and preserving a policy draft while editing a shared definition. Check the daytime window at 08:00 and 22:00, an overnight problem that resolves before morning, acknowledgment reminders, scheduled summaries, profile deletion/replacement and both UPS reserve modes. Existing inline assignments must retain their effective behavior through reading and restart. Explicit profile selection preserves the row identity and UPS condition.

Check keyboard focus after adding or removing an entry, weekday selection, narrow layouts, draft retention across navigation, and validation during Save. New delivery methods start with fixed destinations. Verify provider capabilities and friendly destination names, saved-only tests, unavailable-target handling and presence fallback. SMS recipient fields appear only for identified SMS providers.

## Implementation boundary

The accepted target follows the [reusable notification decision](adr/0066-reusable-notifications-own-timing-and-delivery.md), the [Issues-first workflow](adr/0061-issues-first-product-workflows.md), direct-save safeguards and the [unified policy lifecycle](adr/0058-unified-policy-lifecycle.md). Type is read-only after creation. Supplied policies use the same editor and lifecycle as user-created policies. Configurable battery thresholds and independent overlap remain part of the contract. Scoped actions, dirty-only footers and independent operational controls follow the shared UI standards.

The earlier test-schema rejection remains separate from this change. Supported inline notification rows retain their effective behavior and stable runtime identities without automatic conversion. Selecting a named notification deliberately changes only that assignment. Interface changes must preserve supported saved configuration. Normal saves, updates and restarts preserve configuration and runtime state. The installation guide describes the earlier testing transition and backup choices.

Validate immutable type, supported selectors, independent detection and notifications, duplication, deletion, selective restoration, shared methods, acknowledgment, scheduled summaries, exact-payload saves and restart persistence. Use isolated instances and mocked delivery actions. The integration specification owns fresh-setup defaults.

The generic health-tree scheduling and independent attention-route model remains in use. Isolated validation does not establish provider delivery or browser/device usability.

Maintainers: [single-save and delivery editor decision](adr/0059-save-directly-and-test-configured-methods.md), [unified policy lifecycle](adr/0058-unified-policy-lifecycle.md), [reusable notifications](adr/0066-reusable-notifications-own-timing-and-delivery.md), and [delivery methods](adr/0056-ha-delivery-methods-and-presence.md) own the decisions. This page owns form layout.
