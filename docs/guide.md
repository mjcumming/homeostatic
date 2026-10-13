# User guide

This guide covers the jobs you do in Homeostatic once it's installed.

## Contents

- [Choose what to watch](#choose-what-to-watch)
- [Watch batteries](#watch-batteries)
- [Watch UPS conditions](#watch-ups-conditions)
- [Watch vacuums](#watch-vacuums)
- [Watch temperature limits](#watch-temperature-limits)
- [Watch thermostat progress](#watch-thermostat-progress)
- [What an availability problem means](#what-an-availability-problem-means)
- [Home Assistant Repairs](#home-assistant-repairs)
- [Broken automations](#broken-automations)
- [Activate notifications](#activate-notifications)
- [Operator controls](#operator-controls)
- [Find ended problems in History](#find-ended-problems-in-history)
- [Remove Homeostatic](#remove-homeostatic)

If you haven't installed Homeostatic yet, start with [Install and first run](install.md). Alerts about the house itself, like water on the floor, are made from automations and have their own guide, [Alerts from automations](automation-situations.md). The [reference](reference.md) lists current settings and actions, and [How it works](how-it-works.md) explains how issues are worked out.

## Choose what to watch

A new install watches the connection of every integration, Home Assistant's Repairs, and automations that name an entity that no longer exists. Devices, entities, batteries, and vacuums stay off until you choose them in **Sources** or turn that check on under **Policies**. Start with a few things that matter, like the Zigbee integration and the devices on it you rely on, and widen from there.

Every monitoring change goes through a review. Make your choices, select **Review changes** to see which sources start or stop being watched, then save. Nothing changes until you save.

### Watch a device or an entity

1. Open **Sources** and find the device. Use **Find a source** to search, or **Group by** to browse by integration, by Home Assistant location, or by [TopoMation](https://github.com/mjcumming/topomation) location if you use it.
2. Select the device and open its **Settings** tab.
3. Under **Device availability**, choose **Always monitor this device**.
4. Select **Review changes**, check the result, then select **Save changes**.

A watched device gets one check across its selected entities. Homeostatic selects the device's ordinary entities, including buttons and hidden entities, and falls back to its diagnostic entities only when it has no ordinary ones. Configuration entities and disabled entities are left out, and so is anything you [exclude](#exclude-something). Expand the device in the tree to see which entities its check covers.

To watch a single entity, select it in the tree and open **Settings**. **Follow device monitoring** includes the entity in its device's check whenever the device is watched. **Monitor this entity** gives it a check of its own. If its device already includes it, that choice is under **More monitoring choices** as **Monitor this entity separately**.

### Watch a whole integration

Open the integration in **Sources** and open **Settings**. **What to monitor** shows how many of its connections and devices are watched now. Select **Change** to choose:

- Under **Integration problems**, **Monitor the connection** watches for setup failures and sign-in problems. A new install already does this for every integration.
- Under **Device availability**, **All devices, including new devices** watches every current device and any the integration adds later. **Only devices I choose** leaves new devices unwatched until you pick them one by one.

A choice on one device wins over the integration's device default, so you can choose **Only devices I choose** and still watch the two devices that matter.

**When to notify**, on the same page, sets the reporting choice for all the integration's current devices at once. See [Choose when each source reports](#choose-when-each-source-reports).

### Named monitoring policies

Use a named policy for a reusable check with its own source selection and notifications. On **Policies**, choose a **Starting template** under **Named monitoring policies**, then select **Add monitoring policy**. Give it a name, choose its sources under **Sources and groups**, set any detection parameters, and select **Enable monitoring**. Each filled source condition must match; comma-separated values within one condition are alternatives. Area, label and integration groups include future matching sources.

The **Notifications** rows pair schedules with delivery methods. Leaving the rows empty means Dashboard only. Review changes and save when the complete policy is ready. Sources shows the named policies that apply and links back to their editors.

**Duplicate** makes an independent disabled copy. Rename keeps its current issues. Changing its check, sources or detection parameters ends its current issues as **Monitoring ended** and begins fresh evaluation. Disable or Delete ends its monitoring. Copies can overlap, so two temperature policies can produce separate issues for the same sensor. Pending edits remain available when you move between Policies and Notifications.

### Other policies

Some choices work better as a policy, such as watching every device in the garage area or leaving everything with a `test` label alone. A policy like this applies to current sources and to any that appear later. Turn Integrations, Devices, Batteries, Vacuums, Repairs, and Broken automations on or off from the top of Policies. Repairs and broken automations stay on until you turn them off. Turning one off leaves the other on.

1. Open **Policies** and select **Add policy**.
2. Under **Edit policy**, set **Action** to **Watch** or **Leave unmonitored**, and **Check** to **HA availability**, **Battery condition**, or **Vacuum error**.
3. Fill in the conditions you need: source type, domain, device class, integration type, area ID, floor ID or label ID. A new policy starts paused and limited to devices, so set the conditions and enable it before you review. Every filled condition has to match. Separate alternative values within one condition with commas. To cover devices, set the source type to `device`; a policy without a source type matches integrations and entities only.
4. Select **Review changes** to see which sources the policy picks up, then **Save choices**.

**Leave unmonitored** policies are listed under **Leave unmonitored policies**. One source is changed in Sources. The fields are listed in the [reference](reference.md#monitoring-rules).

### Exclude something

Some sources go unavailable as a matter of course: a TV's media player while the TV is off at the wall, or a feature an integration only offers in some modes. To stop watching one:

- For an entity, choose **Exclude this entity** in its **Settings**. This also removes it from its device's check.
- For a device, choose **Do not monitor this device**.
- From an open device issue, select **Stop checking…** beside the entity under **Monitoring choices**. An entity's own issue offers **Stop checking this entity…**. Both open a draft in Sources; review and save the change there.

Then review and save. An exclusion wins over any rule that would watch the source, and it follows the entity through renames. If an issue was open for it, the issue ends in History as **Monitoring ended**, which records that you stopped watching rather than that the problem cleared. To watch the source again, open its **Settings** and pick a watch choice.

### Turn an integration off

To stop every check for one integration, open it in **Sources**, open **Settings** and turn off **Allow monitoring for this integration**. That stops its connection check, its device checks and its separate entity checks, including those for devices it adds later. Your individual choices are kept, and they apply again when you turn the switch back on.

### Helpers and groups

**Change device type of a switch** helpers aren't listed as sources, because they only wrap another switch. Watch the converted light or fan entity instead. **Group** helpers are listed. A group entity can stay available while some of its members are unavailable, so watch the members you care about directly.

How long Homeostatic waits before opening or clearing an issue is set under **Settings → Timing** and **Settings → Problem grouping**. Each setting is described in the [reference](reference.md#timings).

## Watch batteries

Batteries are watched separately from device availability. A device can be available with its battery at 5%, and a battery reading can sit at 80% on a device that dropped off the network an hour ago.

Homeostatic finds battery level sensors, low-battery binary sensors and charging sensors by their Home Assistant device class, and lists each battery in **Sources**. None are watched until you choose them.

To watch one battery, select it in **Sources**, open **Settings**, choose **Monitor this battery**, then review and save. Check the entities paired with it first. When a device has more than one battery signal, Homeostatic lists them as separate batteries.

To watch every battery, now and in future, open **Policies**, select **Monitor all batteries**, review the result and select **Save choices**. Batteries you've excluded one by one stay excluded.

A watched battery opens an issue when its level is at or below 20%, or when its low-battery sensor reports low. A current charging report clears the issue even if the level is still low, and the issue comes back if charging stops before the level recovers. Homeostatic can't tell whether a battery was replaced or recharged.

## Watch UPS conditions

Homeostatic can watch UPS devices supplied by Home Assistant's NUT or APC UPS Daemon integrations. In **Policies**, add a UPS starting template, choose its sources and enable it. Backup power, low reserve, battery replacement and faults have separate checks and notification choices. Groups can include UPS devices added later.

For low reserve, choose both power modes together: a morning report while mains power is confirmed, and immediate notification with acknowledgment while running on backup power. Select the delivery methods for each row. Optional charge and runtime thresholds have separate raise and clear values. A current UPS low warning remains authoritative even if another measurement appears adequate.

If the same battery is already monitored, choose **Transfer overlapping battery monitoring to this reserve policy** and review which checks will end. Disabling the reserve policy keeps that transfer. Clearing the transfer choice or deleting its policy shows any original battery checks that would resume in the review.

Issues groups open conditions under the UPS, with the most urgent first. Open **View issues** to acknowledge or pause one condition. Mains restoration can leave reserve low; charging does not clear a replacement warning or fault. If reserve becomes critical on backup power after an earlier acknowledgment, Homeostatic requests acknowledgment again and keeps any existing alert pause.

Runtime is an estimate supplied by the UPS. Missing readings remain visible, and a disabled diagnostic entity must be enabled in Home Assistant before it can supply evidence. Homeostatic does not shut down equipment or control UPS outlets. UPS availability and physical power wiring remain separate from these reported conditions.

## Watch vacuums

A vacuum is watched separately from whether Home Assistant can reach it. Homeostatic lists each vacuum entity in **Sources**. None are watched until you choose them.

To watch one vacuum, select it in **Sources**, open **Settings**, choose **Monitor this vacuum**, then review and save.

To watch every vacuum, now and in future, open **Policies**, select **Monitor all vacuums**, review the result and select **Save choices**. Vacuums you've excluded one by one stay excluded.

A watched vacuum opens an issue when Home Assistant reports its activity as error. Cleaning, docked, idle, paused, or returning ends the issue. Unavailable, unknown, missing, and restored states leave an open issue open.

The notice uses Immediate, including overnight, unless you set a **Source preference** for that vacuum. Immediate sends once. The message names the vacuum and, when Home Assistant has an area assigned to it, that area. The area is often the room where the vacuum docks.

A fault that never becomes the error activity stays an alert you write yourself.

## Watch temperature limits

Choose the **Temperature limits** starting template in Policies and select **Add monitoring policy**. Select a temperature sensor or a group of temperature sensors, then enter a **Minimum**, a **Maximum**, or both, with the **Temperature unit**. Enter **Must persist for (seconds)** before enabling the policy. Zero means an immediate issue; no duration or temperature limit is selected for you.

A reading below the minimum or above the maximum must stay outside the range for the chosen duration before opening an issue. Equality is allowed. A reading back within the range clears the issue. A direct jump from below the minimum to above the maximum keeps the same issue because no in-range reading was seen. To monitor cold and warm conditions separately, create two policies with separate notification rows.

For example, a garage policy could watch a chosen sensor below an owner-selected minimum for ten minutes. Duplicate that policy to watch another space, then change the sensor and settings before enabling the copy. Sensor placement and the limits you choose determine what the check means.

## Watch thermostat progress

Choose the **Thermostat progress** starting template in Policies and select **Add monitoring policy**. Select the thermostat, review its temperature differences and **Progress window (seconds)**, then choose notification rows and enable the policy. An immediate schedule is useful when you want to hear about worsening conditions as they qualify.

The starting policy allows 2 °F of deviation from the thermostat's target. Outside that margin, it expects at least 2 °F of progress toward the target within an hour. Useful progress starts another hour. Moving 2 °F away from the best temperature reached opens an issue immediately. Repeatedly moving back and forth over the same temperatures doesn't count as new progress. You can change these settings for the system being watched.

Heating uses the heating target; cooling uses the cooling target. A thermostat set to Heat/Cool uses the applicable end of its target range. With a heating target of 70 °F and the starting margin, 68 °F is within range. Once an issue opens, progress alone doesn't clear it; the reading must enter the permitted margin. Changing the target to an already-satisfied value can end the condition. Turning conditioning off ends monitoring until a supported heating or cooling mode returns.

### Temperature monitoring limits

Both temperature checks use Home Assistant's reported readings. They do not establish physical freshness, equipment damage, freeze risk or food safety. Thermostat checks use the thermostat's own temperature and do not interpret Auto mode, which can mean different things on different systems. Temperature-limit policies remain independent of thermostat modes and targets.

Missing or invalid readings leave an existing issue open. They interrupt an uncompleted qualification period; monitoring starts a new period when usable evidence returns. Restart also starts a new period for a condition that had not yet qualified, while preserving an already-open issue until current readings establish recovery. Acknowledgment affects notifications and never changes the temperature finding.

## What an availability problem means

Home Assistant has no single health status that runs from an integration down to its devices and entities. It has separate signals, and Homeostatic reads each one for what it says:

- An *integration* connects Home Assistant to a service or a hub. Its setup state says whether it loaded, is retrying, failed, or needs you to sign in again.
- A *device* groups related entities, like a smart plug with a switch, a power sensor and a signal-strength sensor.
- An *entity* is one feature or reading. Its state is a value (`on`, `off`, `21.5`), `unknown` or `unavailable`.

`unavailable` means Home Assistant can't supply that entity right now. It usually goes with a lost connection, but some integrations also mark a feature unavailable when it doesn't apply in the current mode. `unknown` means Home Assistant has no value for the entity, and Homeostatic counts it as available. `off` and `idle` are ordinary states.

Watching a source tells Homeostatic you expect it to stay available. It opens an issue when:

- a watched integration fails to set up, is retrying setup, or needs you to sign in again
- a watched entity is unavailable, or every selected entity in a watched device is unavailable
- a selected connectivity sensor on a watched device (a binary sensor with the `connectivity` device class) reports `off`
- a watched source has lacked usable evidence for longer than **Wait for unknown evidence**

The issue quotes what Home Assistant reported and lists the entities involved. It doesn't name a physical cause, because Home Assistant doesn't report one. [Known limitations](troubleshooting.md#known-limitations) lists what Homeostatic can't see.

Device details in Sources also show Home Assistant's own view of the whole device. It follows Home Assistant's [proposed device availability rules](https://github.com/home-assistant/architecture/discussions/1400):

| Status | When |
| --- | --- |
| Available | At least one enabled entity has a current state, and no connectivity sensor reports `off` |
| Unavailable | Every enabled entity is unavailable, or a connectivity sensor reports `off` |
| Unknown | No enabled entity has a current state and they aren't all unavailable, for example while states are still restoring after a restart |
| Disabled | The device is disabled in Home Assistant |

A device issue uses the same rule, but only over the device's [selected entities](#watch-a-device-or-an-entity). The status counts every enabled entity, so the two can differ even when you haven't excluded anything. A device reads Available while its issue is open when the only entities still reporting are ones the check leaves out, such as a configuration entity, and the issue details explain this under **Why does Home Assistant say Available?** It reads Unavailable with no issue when a connectivity sensor that isn't selected reports `off`. A device can also read Available while an entity on it that you watch separately has an issue of its own.

If an unavailable feature is normal in your house, exclude it (see [Exclude something](#exclude-something)). To quiet an issue without changing what's watched, use the [operator controls](#operator-controls). [Home Assistant states](home-assistant-states.md) explains how Home Assistant reports these signals and why Homeostatic reads them this way.

## Home Assistant Repairs

Every Repair Home Assistant raises becomes an issue, whichever integration raised it. That includes an automation that fails to set up or calls an action that doesn't exist, a YAML setting that's going away, and an integration asking you to do something before an upgrade. The issue uses the Repair's own title and says which integration raised it and how serious Home Assistant considers it. **Fix in Home Assistant** opens the automation when Home Assistant links one, and the Repairs page otherwise.

The issue ends when Home Assistant stops reporting the Repair, or when you select **Ignore** on it in Home Assistant. Ended Repairs go into History like any other issue, and Acknowledge and Pause alerts work on them. **Working on this equipment** doesn't apply, because a Repair isn't equipment.

Repairs use the rows under **Notifications → Default notification rows → Repairs**. Existing Morning summary assignments are retained when settings are converted. With no notification rows, Repairs show only in the panel.

An error that shows up only in an automation's trace still won't appear as a Repair. Check those in the automation's traces. An automation that names an entity that no longer exists is a [broken automation](#broken-automations).

## Broken automations

An automation stays on when a trigger, condition, or action names an entity that no longer exists. That part never runs, and Home Assistant does not raise a Repair for it.

Homeostatic opens one issue for that automation. The issue uses the automation's name, lists the missing entity ids, and **Fix in Home Assistant** opens the automation in the editor. The issue ends when the automation no longer names a missing entity, the automation is removed, or the entity exists again. If the automation has other triggers, those can still run.

The check is on until you turn it off under **Policies → Broken automations**. **Turn off** opens a draft you review and save, and **Monitor all automations** turns the check back on. Turning Repairs off leaves this check on.

These issues use **Notifications → Default notification rows → Broken automations**. Existing Morning summary assignments are retained when settings are converted. With no notification rows, the issue shows only in the panel.

An entity that is unavailable, unknown, or disabled is still an entity, so it does not open this issue. An entity id written only inside a template is not seen. Scripts are not checked.

## Activate notifications

Notifications are off on a new install, and issues still appear in the panel. Leave them off for a day or two while you settle what to watch, then set up who hears about what and turn them on.

Homeostatic requests delivery through configured Home Assistant destinations. A notification automation is optional.

Use **Notifications → Schedules** to decide when to report and **Delivery methods** to choose destinations. Changes wait for **Review changes** and **Save settings**. Opening the page doesn't change reporting or enable requests. Existing generated reporting choices are converted for editing with their destinations and assignments intact. A custom notification policy stays active until you explicitly start, review and save its replacement.

### Choose delivery methods

Select **Add delivery method**, give it a name and choose its destinations. A method can combine Companion app phones, configured notification entities such as email, Assist satellite announcements, a TTS provider with a media player, and a named notification action with an SMS recipient. Home Assistant owns the provider accounts and credentials. An unavailable saved target remains visible until you replace or remove it.

Fixed methods always use the selected destinations. Presence methods can choose separate home and away destinations, or the destinations of selected people currently home. Choose fallback destinations or explicitly choose to skip when nobody qualifies or presence is unknown. A current home report qualifies; a named zone counts as away. Missing, restored, unknown and unavailable person states use the fallback when nobody is known to be home. Presence changes alone send nothing. Each new request or reminder uses the evidence available at that time.

Home Assistant's generic notification listings don't identify every provider's delivery medium. Select a configured email or SMS provider appropriate to the field; a generic notification entity or action alone doesn't establish email or SMS support. Voice requires a satellite that supports announcements or a media player that supports playback with the chosen TTS provider.

### Set up schedules

Select **Add schedule** or edit one of the starting definitions:

| Schedule | What happens |
| --- | --- |
| Immediate | Sent right away, overnight included |
| Immediate with acknowledgment | Sent right away, then repeated at your chosen interval until someone acknowledges it or the problem clears; the starting interval is 30 minutes |
| Morning summary | Listed in the morning summary, 08:00 by default |
| Evening summary | Listed in the evening summary, 18:00 by default |
| Weekly summary | Listed in the weekly summary, Sunday 09:00 by default |

Scheduled reports use one local time on the weekdays you select, in the displayed time zone. A schedule contains no destinations. Rename preserves every assignment, while Duplicate creates a new definition without assignments. Editing a shared definition affects its listed uses. Deleting one in use requires a replacement or explicit removal of its notification rows.

A summary lists new problems and those still open, with how long each has been open. Problems that have already cleared aren't listed, and an empty summary isn't sent.

Both immediate schedules include overnight delivery. Companion app requests use critical alerts on iPhone and the **Homeostatic urgent** notification channel on Android. Voice follows the schedule too, including reminders and overnight delivery.

### Choose when each source reports

Open a named monitoring policy in **Policies**. Its **Notifications** rows each pair one schedule with one or more delivery methods. Add an immediate row for phones and a morning row for email to report the same problem both ways. Reuse a method across schedules or a schedule across methods. With no rows, the policy monitors for the dashboard only.

**Notifications → Default notification rows** sets the rows for existing monitoring without a source override, Repairs and broken automations. Converted settings preserve existing source and condition choices: the household starting choice is Weekly summary, Repairs and broken automations start at Morning summary, and vacuum errors start at Immediate unless overridden. Conversion doesn't add destinations to an unconfigured choice.

Independent notification rows remain independent when issues are grouped. Acknowledgment applies to the issue across its rows: it stops acknowledgment reminders while scheduled reports continue to include eligible open problems.

Alerts made from automations carry their reporting choice in the automation; see [Alerts from automations](automation-situations.md).

### Send a test notification

Under **Test a destination**, **Send test** requests a fixed message for the displayed destination. It doesn't create an issue, and works while notifications are off. Previewing or editing a method sends nothing. The result records a request, not confirmed receipt or speech heard. If nothing arrives, see [Troubleshooting](troubleshooting.md).

For a saved method, select **Preview delivery method** to see its exact current targets and presence evidence. Then select **Send test to these destinations** to request a message through that set, including configured SMS recipient numbers. Save an edited method before testing it. A change to its settings, presence evidence or target availability requires a new preview. An explicit Skip fallback requests nothing; a provider failure is reported for that destination.

### Turn notifications on

1. Under **Outgoing requests**, tick **Enable notification requests** after configuring the methods and rows you want.
2. Select **Review changes**. The review says how many notifications the problems open right now would produce.
3. Select **Save settings**.

Problems already open follow their notification rows when you save. Immediate rows can request new messages, combined into summaries per row and method, while report rows wait for their next occurrence. Problems already cleared are left out. A reporting edit cancels superseded pending requests and withdraws replaceable messages without clearing the issue. A name-only edit doesn't restart reporting.

After a Home Assistant restart, Homeostatic holds notifications until your integrations have finished loading, for at least **Wait after startup** and at most **Maximum startup wait**. Alerting requests join summaries per row and method. Pending requests keep their already selected destinations even if presence changes during the restart. [Restart and activation](events.md#restart-and-activation) has the details.

### When a notification arrives

Tapping a notification about one issue opens that issue in the panel. If the issue has ended by then, you see its entry in History. Tapping a summary opens **Issues**. You need to be signed in to the Home Assistant server that sent it, and the panel is for administrators only.

A Companion app notification about a single open issue has an **Acknowledge** button where supported. Tapping it records that someone has seen the issue, the same as **Acknowledge** in the panel, and stops its acknowledgment reminders. The issue stays open until the problem clears. On an iPhone, the phone asks to be unlocked first. Only the phone's linked user can acknowledge with it. Dismissing a notification doesn't acknowledge it.

When an issue clears, Homeostatic updates or withdraws its phone notification using the destinations of previous requests, even when people have since left home. Voice, email and SMS receive new messages and reminders, with no silent updates, cleanup sends or implied reply-based acknowledgment. The panel's acknowledgment control remains available.

## Operator controls

Three controls handle problems you already know about. They're in the issue and source details in the panel, for administrators.

### Acknowledge

**Acknowledge…** on an open issue records that someone has seen it, for everyone who gets its notifications. It stops the repeats for **Immediate with acknowledgment**, and the issue shows when it was acknowledged. The issue stays open until the problem clears. You can also acknowledge from the phone notification (see [When a notification arrives](#when-a-notification-arrives)).

### Pause alerts

**Pause alerts…** on an open issue holds new notifications for that issue until an end time you choose, up to seven days ahead. It holds them for everyone, including immediate notifications, reminders and escalations. Other issues on the same equipment still notify. The issue stays open and visible, its existing notification stays on the phone, and it still clears as usual. You can extend a pause but not shorten it; to end it early, use **End now…**.

### Working on this equipment

For planned work, like replacing a Zigbee coordinator or rewiring the garage, open **Sources**, select the integration or entity you're working on, and select **Working on this equipment…**. Devices don't have the button. To cover a device, choose its integration and tick **Also cover equipment that depends on this**.

1. Choose **30 minutes**, **2 hours** or **4 hours**, or enter an end time up to seven days ahead.
2. Tick **Also cover equipment that depends on this** if the work takes down what's behind it too. For an integration, that's the devices and entities you watch on it.
3. Select **Review what will be covered**. The review lists the equipment and any issues already open.
4. Select **Start maintenance**.

Until the end time, Homeostatic doesn't open new issues for that equipment. Issues that were already open stay open and keep notifying, and alerts from automations carry on as usual. If something is still broken when the window ends, its issue opens then. If it recovered during the window, nothing opens.

### End a control early

Active controls are listed on the Overview and in the issue or source details, with their end times. **End now…** ends one. Ending a pause lets any notifications that fell due go out straight away. Ending maintenance lets issues open for anything still broken.

### From an automation

Each control is also an action: `homeostatic.acknowledge`, `homeostatic.shelve` (Pause alerts), `homeostatic.preview_maintenance`, `homeostatic.start_maintenance` and `homeostatic.cancel_control`. For example, a script could put an irrigation controller's integration into maintenance while it winterizes the system:

```yaml
action: homeostatic.start_maintenance
data:
  node_id: entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
  include_dependents: true
  until: "{{ (now() + timedelta(hours=4)).isoformat() }}"
  reason: Winterizing irrigation
```

Get source, issue and control ids from `homeostatic.inventory` and `homeostatic.operator_controls`. Every field is listed in the [reference](reference.md#actions). If an action reports a storage error, check the active controls before you retry, because the control may already have been saved.

## Find ended problems in History

**History** keeps issues that ended in the last 30 days, up to 100 of them, 20 to a page. Search by name, filter by outcome, and open an entry to see what Home Assistant reported and when Homeostatic saw the problem start and end. The outcomes are:

| Outcome | Meaning |
| --- | --- |
| Cleared | Homeostatic saw the problem recover |
| Monitoring ended | You stopped watching the source, or it was removed from Home Assistant. Recovery wasn't seen. |
| Joined another problem | The issue became part of a larger one, such as a failure of the integration behind it. The entry links to that issue while it's still available. |

Times are when Homeostatic saw each change. If Home Assistant was down when a device came back, the end time is when Homeostatic noticed after starting. History begins when Homeostatic is installed.

A single source's history is on its **History** tab in **Sources**. `homeostatic.resolved_history` returns the same list for automations.

## Remove Homeostatic

1. Go to **Settings → Devices & services**, open **Homeostatic** and delete it. This deletes its settings, open issues, history and active controls.
2. Remove it in HACS, or delete `<config>/custom_components/homeostatic` if you installed it by hand.
3. Restart Home Assistant.

Then tidy up what lives outside the integration:

- Automations made from the Homeostatic blueprints are ordinary automations. Delete or turn them off, because their `homeostatic.*` actions fail once the integration is gone.
- Delete any dashboard made from the Homeostatic dashboard strategy, and any `custom:homeostatic-card` cards on other dashboards.
- If you used the diagnostic state blueprint, delete the template entities made from it.
- Delete the blueprint files under `blueprints/automation/homeostatic/` and `blueprints/template/homeostatic/` if you imported them.
