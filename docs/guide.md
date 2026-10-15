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

A new install watches integration, device and entity availability, Home Assistant's Repairs, and automations that name an entity that no longer exists. Batteries and vacuums start off. Temperature limits, thermostat progress and UPS checks are available when you add a policy and configure its sources and settings. Supplied policies select appropriate named notifications, which start without delivery methods. Notifications are off until you configure delivery and turn sending on.

Each editor saves its own changes: **Save policy**, **Save notification**, **Save delivery method**, or **Save settings**. Homeostatic checks the settings as it saves them. If a setting is invalid or saving fails, your pending edits stay available with an explanation. Other editors keep their drafts. Visiting another Home Assistant page and returning in the same tab also keeps pending edits; reloading or closing the tab ends that draft session. Routine monitoring updates retain your place, focused field and open menu. During a connection interruption, the last view stays visible with a stale warning and actions become read-only until fresh data arrives.

### Watch a device or an entity

Open **Monitoring** to inspect equipment. Use **Search** to find a source. **Monitoring status** shows **All**, **Monitored** or **Not monitored**; it starts at All and changes only the displayed list. **More filters** opens the additional browsing choices. Above the tree, **Group by** selects integration, Home Assistant location or [TopoMation](https://github.com/mjcumming/topomation) location; **Collapse groups** closes the tree branches. Selecting an entity shows its name, location, current condition and what Homeostatic monitors. Policy links and availability controls stay visible. **View issue** opens a related issue, including its complete scope and notification controls. Links beside the source name take you to the named Home Assistant page.

An **Issues** badge marks a source or group with related open issues. Select it to see the issues. A shared problem can appear under several rooms or devices; each selected list includes it once.

To stop unwanted availability checks, open the finding under its device in **Open issues**, then choose **Remove from availability monitoring…**. Confirm the count; **Details** shows the currently unavailable entities from that issue and the affected policies. Choose **Cancel** or close the issue to leave monitoring unchanged. Removal applies to those entities across the named availability policies, which can also end other availability issues for the same entities. Other checks and Home Assistant entities stay enabled.

For one entity, open its source and choose **Remove this entity from availability monitoring…**. To choose particular members of a device, open the device, choose **Select entities…**, then **Remove selected entities from availability monitoring…**.

Saving changes the policies and finishes the action. To change monitoring later, edit the affected policies. The **Availability exclusions** filter in Monitoring helps you find excluded entities and their policies. Existing policy selections still apply. If a save's result cannot be confirmed, **Refresh saved monitoring** reads the saved scope before another action.

Changing exclusions that alter a device's monitored evidence ends its previous issue as monitoring ended; the revised selection may open another issue. Home Assistant removing, disabling or restoring an already excluded entity preserves the continuing device issue, its acknowledgment and any pause.

In **Policies**, edit the device or entity availability policy. Under **Watch**, choose all eligible sources, **All except these**, or selected sources. Where supported, you can also select areas or labels. The **Choose devices** or **Choose entities** picker accepts several selections. Names include their area and floor where available. Search by name, area, floor or entity ID; selections stay in place when you filter. Area and label choices show how many matching sources they contain and initially hide empty choices. A selected area or label stays visible if its matching sources disappear. Use **Show all areas** or **Show all labels** to select an empty group for future equipment. Select **Done** to return to the policy, then **Save policy** to apply your choices. Policies loads its choices when you open it. If loading fails, use **Retry loading sources**; your selections remain in the draft. Broad, area and label selections include future matching sources.

Automatic availability monitoring watches enabled operational entities, including those without a device. Diagnostic and configuration entities are left out. To monitor one of those individually, use **Selected entities** and choose it explicitly. A device check uses enabled operational entities together; it does not fall back to diagnostics when none exist. Buttons and hidden operational entities remain eligible. Disabled entities, devices and integrations do not acquire availability checks. Saved monitoring choices resume when they are enabled again.

### Watch integrations

Edit the integration availability policy to watch all integrations or selected integrations. Choose integration names such as Mobile App or Matter. A selected integration includes all its current and future configured connections; account and phone names are supporting details. It watches setup failures, retries and sign-in problems. Integration availability has no area or label selection. Device and entity policies separately choose the equipment they watch.

### Add or edit a monitoring policy

Supplied policies and policies you create appear together in **Policies**. Each row shows its saved state and offers **Edit**. Change **Policy enabled** beside the editor heading; it takes effect when you save. Open **More actions** (the three-dot button) for **Duplicate** and **Delete**.

1. Select **Add policy**, choose its **Monitoring type**, then select **Continue**.
2. Give the policy a name and choose what to **Watch**. The available source choices and detection fields depend on its monitoring type.
3. Set the supported detection parameters and choose whether **Policy enabled** is on.
4. Choose the [named notification](#choose-when-each-policy-reports), or **Dashboard only** for monitoring without requests.
5. Select **Save policy**.

The monitoring type stays fixed after creation. To watch a different kind of problem, add a policy. **Duplicate** retains the type and copies the settings into an independent disabled policy. Names, sources, detection settings and notification assignments remain editable. Pending edits stay available while you move between Policies and Notifications. **Save policy** applies only that policy. Edit shared timing and delivery choices in **Notifications**, where **Save notification** or **Save delivery method** applies only the named definition to its saved uses and returns you to its list. Unrelated drafts stay unsaved.

Renaming keeps current issues. Changing source selection or detection settings ends the affected monitoring and begins fresh evaluation. Disabling or deleting a policy ends its monitoring; History records **Monitoring ended**, without claiming that the problem cleared.

Policies may overlap. Each keeps its own detection and notification settings, so two battery policies can use different thresholds for the same battery. Check the contributing policies when the result is more monitoring or notifications than you want.

### Restore a supplied policy

Deleting a supplied policy leaves it deleted through restarts and updates. Updates also preserve edits to surviving policies. To bring back a deleted default, select **Restore defaults**, choose the policies to restore, then select **Restore selected**. This creates drafts. Open each restored policy, review its settings, and select **Save policy** to apply it. Other policies keep their settings. Restored policies use their supplied notification choice when that definition still exists. Restoration does not recreate deleted notifications or turn on global sending.

### Exclude something

Some sources go unavailable as a matter of course, such as a TV's media player while the TV is off at the wall. Open a contributing policy from **Monitoring**, choose **All except these** under **Watch**, select the sources to leave out, then select **Save policy**. New eligible sources still join automatically. Excluded sources stay in the saved list if they disappear, so they remain excluded if they return. Remove an exclusion to include that source again.

An integration policy can exclude an individual configured connection. A device policy can exclude a whole device or particular entity members; excluding all eligible members leaves that device without an availability check. Each exclusion belongs to that policy. Other policies keep their own scope, including any individual entity checks. Disable a policy if you no longer want any of its checks.

To quiet an existing issue temporarily while keeping monitoring, use [Pause notifications](#pause-notifications).

### Helpers and groups

**Change device type of a switch** helpers aren't listed as sources, because they only wrap another switch. Watch the converted light or fan entity instead. **Group** helpers are listed. A group entity can stay available while some of its members are unavailable, so watch the members you care about directly.

How long Homeostatic waits before opening or clearing an issue is set under **Settings → Timing** and **Settings → Problem grouping**. Select **Save settings** to apply timing or grouping edits. Each setting is described in the [reference](reference.md#timings).

## Watch batteries

Batteries are watched separately from device availability. A device can be available with its battery at 5%, and a battery reading can sit at 80% on a device that dropped off the network an hour ago.

Homeostatic finds battery level sensors, low-battery binary sensors and charging sensors by their Home Assistant device class, and lists each battery in **Monitoring**. None are watched until you choose them.

Open the battery policy in **Policies**, choose selected batteries under **Watch**, and enable it. Check the entities paired with each battery in **Monitoring** first. When a device has more than one battery signal, Homeostatic lists them as separate batteries.

To watch every battery, now and in future, choose **All batteries**. Set **Battery level at or below (%)**, add any notifications, then select **Save policy**. The starting threshold is 20%.

A watched battery opens an issue when its level is at or below the policy's threshold, or when its low-battery sensor reports low. A current charging report clears the issue even if the level is still low, and the issue comes back if charging stops before the level recovers. Homeostatic can't tell whether a battery was replaced or recharged.

## Watch UPS conditions

Homeostatic can watch UPS devices supplied by Home Assistant's NUT or APC UPS Daemon integrations. In **Policies**, select **Add policy**, choose a UPS monitoring type, then choose its sources and enable it. Backup power, low reserve, battery replacement and faults have separate checks and notification choices. Groups can include UPS devices added later.

For low reserve, configure both power modes together: select **Morning summary** while mains power is confirmed and **Immediate with acknowledgment** while running on backup power. Edit those notifications in **Notifications** to change their shared timing or delivery methods. Optional charge and runtime thresholds have separate raise and clear values. A current UPS low warning remains authoritative even if another measurement appears adequate.

A UPS reserve policy can overlap a battery policy. Each continues to use its own detection and notifications. Disable or edit either policy if that overlap is unwanted.

The **Open issues** page groups open conditions under the UPS, newest first by default. Open **View issues** to acknowledge or pause one condition. Mains restoration can leave reserve low; charging does not clear a replacement warning or fault. If reserve becomes critical on backup power after an earlier acknowledgment, Homeostatic requests acknowledgment again and keeps any existing alert pause.

Runtime is an estimate supplied by the UPS. Missing readings remain visible, and a disabled diagnostic entity must be enabled in Home Assistant before it can supply evidence. Homeostatic does not shut down equipment or control UPS outlets. UPS availability and physical power wiring remain separate from these reported conditions.

## Watch vacuums

A vacuum is watched separately from whether Home Assistant can reach it. Homeostatic lists each vacuum entity in **Monitoring**. None are watched until you choose them.

In **Policies**, edit the vacuum policy, choose selected vacuums or **All vacuums**, then enable it. Add any notification entries, then select **Save policy**. All vacuums includes matching sources added later.

A watched vacuum opens an issue when Home Assistant reports its activity as error. Cleaning, docked, idle, paused, or returning ends the issue. Unavailable, unknown, missing, and restored states leave an open issue open.

The supplied vacuum policy selects **Evening summary**. Choose **Immediate** if you want to hear when an error begins, including overnight. The message names the vacuum and, when Home Assistant has an area assigned, that area. The area is often the room where the vacuum docks.

A fault that never becomes the error activity stays an alert you write yourself.

## Watch temperature limits

In **Policies**, select **Add policy** and choose **Temperature limits**. Select a temperature sensor or a group of temperature sensors and choose the **Temperature unit**. Enter **Below (optional)**, **Above (optional)**, or both; leave a limit blank when it does not apply. Enter how long the condition must last in **For at least**. The duration starts in minutes, with hours and seconds also available. Zero means no waiting period. Review the rule shown below the fields, set **Policy enabled** beside the heading, then select **Save policy**.

A reading below the minimum or above the maximum must stay outside the range for the chosen duration before opening an issue. Equality is allowed. A reading back within the range clears the issue. A direct jump from below the minimum to above the maximum keeps the same issue because no in-range reading was seen. To monitor cold and warm conditions separately, create two policies with separate notification entries.

For example, a garage policy could watch a chosen sensor below an owner-selected minimum for ten minutes. Duplicate that policy to watch another space, then change the sensor and settings before enabling the copy. Sensor placement and the limits you choose determine what the check means.

## Watch thermostat progress

In **Policies**, select **Add policy** and choose **Thermostat progress**. Select the thermostat, review its temperature differences and **Progress window (seconds)**, then choose its notification and enable the policy. The template selects **Urgent** when that notification exists; choose **Immediate** if worsening conditions should request delivery overnight too.

The starting policy allows 2 °F of deviation from the thermostat's target. Outside that margin, it expects at least 2 °F of progress toward the target within an hour. Useful progress starts another hour. Moving 2 °F away from the best temperature reached opens an issue immediately. Repeatedly moving back and forth over the same temperatures doesn't count as new progress. You can change these settings for the system being watched.

Heating uses the heating target; cooling uses the cooling target. A thermostat set to Heat/Cool uses the applicable end of its target range. With a heating target of 70 °F and the starting margin, 68 °F is within range. Once an issue opens, progress alone doesn't clear it; the reading must enter the permitted margin. Changing the target to an already-satisfied value can end the condition. Turning conditioning off ends monitoring until a supported heating or cooling mode returns.

### Temperature monitoring limits

Both temperature checks use Home Assistant's reported readings. They do not establish physical freshness, equipment damage, freeze risk or food safety. Thermostat checks use the thermostat's own temperature and do not interpret Auto mode, which can mean different things on different systems. Temperature-limit policies remain independent of thermostat modes and targets.

Missing or invalid readings leave an existing issue open. They interrupt an uncompleted qualification period; monitoring starts a new period when usable evidence returns. Restart also starts a new period for a condition that had not yet qualified, while preserving an already-open issue until current readings establish recovery. Acknowledgment affects notifications and never changes the temperature finding.

## What an availability problem means

When an issue lists unavailable entities on one device, **Open device in Home Assistant** takes you to that device. Expand **Affected entities** to see their names; select a name to inspect it in Monitoring. **Monitoring details** contains check counts and policy controls. **Connection details** contains the integration status and links. An issue spanning several devices lists each device by name.

**Open issues** groups findings by integration, then shows each affected device once with its individual findings indented beneath it. Open a finding to inspect or act on that issue. Entities without a device stay under their integration. Integration problems and shared problems affecting several devices also stay at that level. The newest finding puts its device group first by default; you can change the sort order. Search also matches device names. Show more issues reveals remaining findings without repeating a device heading. It hides availability entries that currently contain only missing evidence, or available states awaiting recovery confirmation. Monitoring retains those gaps and any unresolved problem; a missing reading does not establish recovery. Groups with a current warning or failure remain visible. If an integration is loaded but related devices or entities still need attention, the issue leads with their reported condition and shows the integration's loaded state as context. Its details count devices, entities and checks separately. Each device appears once, with its affected entity readings beneath it; several checks on the same source remain visible without repeating the source. Start with the affected source or device links to investigate. The integration connection remains available as a secondary link. Disabled entities stay browsable without availability checks.

Home Assistant has no single health status that runs from an integration down to its devices and entities. It has separate signals, and Homeostatic reads each one for what it says:

- An *integration* connects Home Assistant to a service or a hub. Its setup state says whether it loaded, is retrying, failed, or needs you to sign in again.
- A *device* groups related entities, like a smart plug with a switch, a power sensor and a signal-strength sensor.
- An *entity* is one feature or reading. Its state is a value (`on`, `off`, `21.5`), `unknown` or `unavailable`.

`unavailable` means Home Assistant can't supply that entity right now. It usually goes with a lost connection, but some integrations also mark a feature unavailable when it doesn't apply in the current mode. `unknown` means Home Assistant has no value for the entity, and Homeostatic counts it as available. `off` and `idle` are ordinary states.

Watching a source tells Homeostatic you expect it to stay available. Availability monitoring tracks:

- a watched integration fails to set up, is retrying setup, or needs you to sign in again
- a watched entity is unavailable, or every selected entity in a watched device is unavailable
- a watched source lacking usable evidence for longer than **Wait for unknown evidence**, retained in Monitoring even when no current warning or failure appears in Open issues

Issue details explain what Home Assistant reported and list the entities involved, with relevant source, device or log links. They do not contain raw diagnostic data or copy controls. They do not name a physical cause, because Home Assistant does not report one. [Known limitations](troubleshooting.md#known-limitations) lists what Homeostatic can't see.

Device details in Monitoring also show Homeostatic's availability assessment using enabled operational entities:

| Status | When |
| --- | --- |
| Available | At least one enabled operational entity has a current state, including `unknown` or `off` |
| Unavailable | Every enabled operational entity is unavailable |
| Unknown | There are no eligible entities, or none has a current state and they aren't all unavailable, for example while states are still restoring after a restart |
| Disabled | The device is disabled in Home Assistant |

The device assessment uses enabled operational entities. Diagnostic and configuration entities do not determine it, and current `off` values remain available. A policy may exclude some operational entities; its evidence and counts honor those choices. An unavailable individual entity keeps its own issue even when a sibling makes the device check pass. Browsing a source does not enroll it in monitoring.

If an unavailable feature is normal in your house, exclude it (see [Exclude something](#exclude-something)). To quiet an issue without changing what's watched, use the [operator controls](#operator-controls). [Home Assistant states](home-assistant-states.md) explains how Home Assistant reports these signals and why Homeostatic reads them this way.

## Home Assistant Repairs

The Repairs policy watches all Home Assistant Repairs. Its editor has no scope dropdown; you can change its name, notifications and enabled state.

Every Repair Home Assistant raises becomes an issue, whichever integration raised it. That includes an automation that fails to set up or calls an action that doesn't exist, a YAML setting that's going away, and an integration asking you to do something before an upgrade. The issue uses the Repair's own title and says which integration raised it and how serious Home Assistant considers it. **Fix in Home Assistant** opens the automation when Home Assistant links one, and the Repairs page otherwise.

The issue ends when Home Assistant stops reporting the Repair, or when you select **Ignore** on it in Home Assistant. Ended Repairs go into History like any other issue, and Acknowledge issue and Pause notifications work on them. **Working on this equipment** doesn't apply, because a Repair isn't equipment.

Edit the **Repairs** policy to change its monitoring or notification assignment. It starts enabled with **Morning summary**; delivery remains unconfigured until you select a method and enable sending.

An error that shows up only in an automation's trace still won't appear as a Repair. Check those in the automation's traces. An automation that names an entity that no longer exists is a [broken automation](#broken-automations).

## Broken automations

An automation stays on when a trigger, condition, or action names an entity that no longer exists. That part never runs, and Home Assistant does not raise a Repair for it.

Homeostatic opens one issue for that automation. The issue uses the automation's name, lists the missing entity ids, and **Fix in Home Assistant** opens the automation in the editor. The issue ends when the automation no longer names a missing entity, the automation is removed, or the entity exists again. If the automation has other triggers, those can still run.

The **Broken automations** policy checks all automations for references to missing entities, including automations added later. Its editor has no scope dropdown. The policy starts enabled. Change **Policy enabled** in the policy editor, then select **Save policy**. Turning Repairs off leaves this policy on.

The **Broken automations** policy selects **Morning summary**. Change its notification assignment in the policy; configure the shared timing and delivery in **Notifications**.

An entity that is unavailable, unknown, or disabled is still an entity, so it does not open this issue. An entity id written only inside a template is not seen. Scripts are not checked.

## Activate notifications

Notifications are off on a new install, and issues still appear in the panel. Leave them off for a day or two while you settle what to watch, then set up who hears about what and turn them on.

Homeostatic requests delivery through configured Home Assistant destinations. A notification automation is optional.

Use **Notifications** to manage named timing and delivery choices. Its **Delivery methods** view manages destinations. A policy selects a named notification; shared timing and methods are saved in their own editors. Opening a page or editing a definition does not send a test or enable notifications.

### Choose delivery methods

Open **Notifications → Delivery methods**, select **Add delivery method** and give it a name. The method controls destinations and optional presence rules. Select it under **Send using** in a named notification to give it a schedule. To change an existing method, select **Edit**; **More actions** contains **Duplicate** and **Delete**. Select **Add destination**, choose the delivery type, then choose a configured destination. The editor lists only the destinations selected for this method. For speech, choose the speaker and, when needed, its speech provider. A method can combine several supported destination types. Home Assistant owns the provider accounts and credentials. Unavailable destinations are hidden from new choices by default; an unavailable saved destination stays visible until you replace or remove it.

After you edit a method, its footer offers **Save delivery method** and **Discard changes**. **Delivery methods** returns to the list and retains your pending edits. Saving returns you to the delivery-method list. Open its Edit action to make another change or send a test. Saving or discarding affects only this method. Other notification and policy drafts remain pending.

Fixed methods always use the selected destinations. Open the optional presence settings to choose separate home and away destinations, or the destinations of selected people currently home. Choose fallback destinations or explicitly choose to skip when nobody qualifies or presence is unknown. A current home report qualifies; a named zone counts as away. Missing, restored, unknown and unavailable person states use the fallback when nobody is known to be home. Presence changes alone send nothing. Each new request or reminder uses the evidence available at that time.

Only destinations with identified email or SMS support appear as those types. Unclassified notification routes use a generic notification label. Phone-number fields are offered only for supported SMS providers. Voice requires a satellite that supports announcements or a media player that supports playback with the chosen TTS provider.

### Choose when each policy reports

Open a policy in **Policies** and find **Notifications**. Use **Add notification** to choose a saved notification. Each entry groups its timing under **When** and its delivery methods under **Send to**; **No delivery method selected** means it cannot send yet. Add more entries for independent reporting, such as an immediate phone request and a daily summary. Use **Remove** beside any entry, including the last one. **No notifications** keeps issues visible in Open issues without sending notifications for this policy. **Save policy** saves your choices.

Open **Notifications** to edit a shared choice or select **Add notification**. The supplied choices are **Immediate**, **Immediate with acknowledgment**, **Urgent**, **Morning summary**, **Evening summary** and **Weekly summary**. Their starting times and policy assignments are listed in the [reference](reference.md#policy-notifications). Set **When to notify**, choose the required time or reminder interval, and select saved delivery methods under **Send using**. **Save notification** applies to its listed saved policy uses. Other drafts remain pending.

Immediate delivery includes overnight. **Urgent** starts with daily hours of 08:00–22:00; outside those hours requests wait until the next opening. A problem that ends overnight does not create a morning alert. Scheduled summaries include eligible open problems, even after immediate delivery or acknowledgment, and omit ended problems and empty summaries. Acknowledgment stops applicable reminders. Voice follows the selected notification's timing too.

The policy shows the running schedule's next summary when its saved assignment, timing and time zone still match the draft. New or edited schedules explain the save needed for a forecast. Disabled policies and policies without an applicable saved summary say that none is currently scheduled.

An older assignment may appear as **Custom notification — keep current settings**. Its timing and methods stay unchanged until you deliberately select a named notification or remove that assignment. Selecting a name changes only that assignment and preserves any UPS power-mode condition.

Deleting a shared notification or method identifies its uses and requires replacement or explicit removal of references. A notification left without methods remains saved and assigned, but sends nothing. If removal leaves an older custom assignment without any method, that assignment is removed. **Dashboard only** leaves monitoring active with no notification assignments.

Alerts made from automations keep their reporting selection in the automation; see [Alerts from automations](automation-situations.md).

### Send a test notification

Save the delivery method, then select **Send test** in its editor. The test uses only that method's configured destinations, resolving any presence rules at the time of the test. There is no separate test area or destination picker. Save further edits before testing again.

A test works while normal notifications are off and does not create an issue. An explicit Skip fallback sends nothing; provider failures are reported for each destination. The result confirms a request, not receipt or speech heard. Opening, editing or saving the method does not send a test. If nothing arrives, see [Troubleshooting](troubleshooting.md).

### Turn notifications on

After saving the methods and policy entries you want, turn on the **Notifications** switch near the top of the panel. The switch applies immediately and leaves other pending edits unsaved. Monitoring continues when notifications are off.

Problems already open follow their saved notification entries when notifications are enabled. Immediate requests about the same device combine when their complete delivery instructions and destinations match. Other immediate requests can join summaries per entry and method; scheduled entries wait for their next occurrence. Problems already cleared are left out. A reporting edit cancels superseded pending requests and withdraws replaceable messages without clearing the issue. A name-only edit does not restart reporting.

After a Home Assistant restart, Homeostatic holds notifications until your integrations have finished loading, for at least **Wait after startup** and at most **Maximum startup wait**. Messages stay combined under their device or standalone entity during this hold. Other source kinds, such as integrations and Repairs, join summaries per entry and method. A reminder due during the restart updates its message once. Pending requests keep their selected destinations even if presence changes during the restart. [Restart and activation](events.md#restart-and-activation) has the details.

### When a notification arrives

Problems on the same device share one continuing message when their notification instructions and destinations match. The findings remain separate issues with their own history and controls. As one clears, the message silently updates to show the others; it is withdrawn when the last one ends. Different schedules, repeat settings, conditions or destinations remain separate. Scheduled reports keep their own timing and contents.

Tapping a notification about one issue opens that issue in the panel. If it has ended, you see its entry in History. Tapping a device message or summary opens **Open issues**. You need to be signed in to the Home Assistant server that sent it, and the panel is for administrators only.

A Companion app notification about an open issue or device has an **Acknowledge** button where supported. It acknowledges exactly the issues shown in that request and stops their acknowledgment reminders. A later problem on the device is not acknowledged by that earlier button and can request attention. Issues remain open until their evidence clears. On an iPhone, the phone asks to be unlocked first. Only the phone's linked user can acknowledge with it. Dismissing a notification does not acknowledge it.

When an issue clears, Homeostatic updates or withdraws its phone notification using the destinations of previous requests, even when people have since left home. Voice, email and SMS receive new messages and reminders, with no silent updates, cleanup sends or implied reply-based acknowledgment. The panel's acknowledgment control remains available.

## Operator controls

Temperature issue details show the sensor, reported reading and observed duration. Use **Edit policy** to change its monitoring settings. **Details** holds the complete limits and optional links to the temperature reading and Monitoring.

Administrators can acknowledge an issue or pause its notifications from the full issue view. From an entity, use **View issue** to see the complete scope first. Equipment maintenance is available in supported source details.

### Acknowledge issue

**Acknowledge issue…** on an open issue records that someone has seen it, for everyone who gets its notifications. It stops acknowledgment reminders, and the issue shows when it was acknowledged. The issue stays open until the problem clears. You can also acknowledge from the phone notification (see [When a notification arrives](#when-a-notification-arrives)).

### Pause notifications

**Pause notifications…** on an open issue holds new notifications for that issue until an end time you choose, up to seven days ahead. It holds them for everyone, including immediate notifications, reminders and escalations. Other issues on the same equipment still notify. The issue stays open and visible, its existing notification stays on the phone, and it still clears as usual. You can extend a pause but not shorten it; to end it early, use **Resume notifications…**.

### Working on this equipment

For planned work, like replacing a Zigbee coordinator or rewiring the garage, open **Monitoring**, select the integration or entity you're working on, and select **Working on this equipment…**. Devices don't have the button. To cover a device, choose its integration and tick **Also cover equipment that depends on this**.

1. Choose **30 minutes**, **2 hours** or **4 hours**, or open **Choose an end time…** for a custom time up to seven days ahead.
2. Open **More options** to add a reason or tick **Also cover equipment that depends on this** if the work takes down what's behind it too. For an integration, that's the devices and entities you watch on it.
3. Select **Start maintenance** to apply the window. The result shows the covered equipment and expiry.

Until the end time, Homeostatic doesn't open new issues for that equipment. Issues that were already open stay open and keep notifying, and alerts from automations carry on as usual. If something is still broken when the window ends, its issue opens then. If it recovered during the window, nothing opens.

### End a control early

Active controls are listed in the issue or source details, with their end times. Use **Resume notifications…** to end a pause or **End maintenance…** to end equipment maintenance. Due notifications can proceed under the issue’s notification rules and quiet hours. Ending maintenance lets issues open for anything still broken.

### From an automation

Each control is also an action: `homeostatic.acknowledge`, `homeostatic.shelve` (Pause notifications), `homeostatic.preview_maintenance`, `homeostatic.start_maintenance` and `homeostatic.cancel_control`. For example, a script could put an irrigation controller's integration into maintenance while it winterizes the system:

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

Use **History** to find ended problems by source name, or follow a retained issue link. A source's **View history** also includes removed equipment when its original ownership was recorded. Older records without that information remain available in global History. Existing links to source history still work. `homeostatic.resolved_history` returns the same retained issues for automations.

## Remove Homeostatic

1. Go to **Settings → Devices & services**, open **Homeostatic** and delete it. This deletes its settings, open issues, history and active controls.
2. Remove it in HACS, or delete `<config>/custom_components/homeostatic` if you installed it by hand.
3. Restart Home Assistant.

Then tidy up what lives outside the integration:

- Automations made from the Homeostatic blueprints are ordinary automations. Delete or turn them off, because their `homeostatic.*` actions fail once the integration is gone.
- Delete any dashboard made from the Homeostatic dashboard strategy, and any `custom:homeostatic-card` cards on other dashboards.
- If you used the diagnostic state blueprint, delete the template entities made from it.
- Delete the blueprint files under `blueprints/automation/homeostatic/` and `blueprints/template/homeostatic/` if you imported them.
