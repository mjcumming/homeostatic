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

A new install watches integration, device and entity availability, Home Assistant's Repairs, and automations that name an entity that no longer exists. Batteries and vacuums start off. Temperature limits, thermostat progress and UPS checks are available when you add a policy and configure its sources and settings. All supplied policies start with no notification entries, and notifications are off.

Make your choices, then select **Save changes**. Homeostatic checks the settings as it saves them. If a setting is invalid or saving fails, your pending edits stay available with an explanation. Nothing changes until you save.

### Watch a device or an entity

Open **Sources** to inspect equipment. Use **Find a source** to search, or **Group by** to browse by integration, Home Assistant location, or [TopoMation](https://github.com/mjcumming/topomation) location. The source details show the policies that apply and link to their editors.

In **Policies**, edit the device or entity availability policy. Under **Watch**, choose all eligible sources or selected sources. Where supported, you can also select areas or labels. The **Choose devices** or **Choose entities** picker accepts several selections and keeps them when you filter the list. Area and label selections include future matching sources.

A watched device checks its selected entities together. Homeostatic selects ordinary entities, including buttons and hidden entities, and falls back to diagnostic entities only when it has no ordinary ones. Configuration entities and disabled entities are left out. An entity availability policy can also watch an entity independently.

### Watch integrations

Edit the integration availability policy to watch all integrations or selected integrations. Choose integration names such as Mobile App or Matter. A selected integration includes all its current and future configured connections; account and phone names are supporting details. It watches setup failures, retries and sign-in problems. Integration availability has no area or label selection. Device and entity policies separately choose the equipment they watch.

### Add or edit a monitoring policy

Supplied policies and policies you create appear together in **Policies**. Each supports **Edit**, **Duplicate**, **Turn on** or **Turn off**, and **Delete**.

1. Select **Add policy**, choose its **Monitoring type**, then select **Continue**.
2. Give the policy a name and choose what to **Watch**. The available source choices and detection fields depend on its monitoring type.
3. Set the supported detection parameters and choose whether the policy is **Enabled**.
4. Add any [notification entries](#choose-when-each-policy-reports). Leave them empty for dashboard-only monitoring.
5. Select **Save changes**.

The monitoring type stays fixed after creation. To watch a different kind of problem, add a policy. **Duplicate** retains the type and copies the settings into an independent disabled policy. Names, sources, detection settings and notifications remain editable. Pending edits stay available while you move between Policies and Notifications.

Renaming keeps current issues. Changing source selection or detection settings ends the affected monitoring and begins fresh evaluation. Disabling or deleting a policy ends its monitoring; History records **Monitoring ended**, without claiming that the problem cleared.

Policies may overlap. Each keeps its own detection and notification settings, so two battery policies can use different thresholds for the same battery. Check the contributing policies when the result is more monitoring or notifications than you want.

### Restore a supplied policy

Deleting a supplied policy leaves it deleted through restarts and updates. Updates also preserve edits to surviving policies. To bring back a deleted default, select **Restore defaults**, choose the policies to restore, then select **Restore selected**. This adds them to your pending edits; select **Save changes** to apply them. Other policies keep their settings. Restored policies have no notification entries and do not turn on global notification sending.

### Exclude something

Some sources go unavailable as a matter of course, such as a TV's media player while the TV is off at the wall. Open its contributing policies from **Sources** and narrow their selections, or disable a policy you no longer want. A source selected by another enabled policy continues to be watched. Select **Save changes** to apply the new selection.

To quiet an existing issue temporarily while keeping monitoring, use [Pause alerts](#pause-alerts).

### Helpers and groups

**Change device type of a switch** helpers aren't listed as sources, because they only wrap another switch. Watch the converted light or fan entity instead. **Group** helpers are listed. A group entity can stay available while some of its members are unavailable, so watch the members you care about directly.

How long Homeostatic waits before opening or clearing an issue is set under **Settings → Timing** and **Settings → Problem grouping**. Each setting is described in the [reference](reference.md#timings).

## Watch batteries

Batteries are watched separately from device availability. A device can be available with its battery at 5%, and a battery reading can sit at 80% on a device that dropped off the network an hour ago.

Homeostatic finds battery level sensors, low-battery binary sensors and charging sensors by their Home Assistant device class, and lists each battery in **Sources**. None are watched until you choose them.

Open the battery policy in **Policies**, choose selected batteries under **Watch**, and enable it. Check the entities paired with each battery in **Sources** first. When a device has more than one battery signal, Homeostatic lists them as separate batteries.

To watch every battery, now and in future, choose **All batteries**. Set **Battery level at or below (%)**, add any notifications, then select **Save changes**. The starting threshold is 20%.

A watched battery opens an issue when its level is at or below the policy's threshold, or when its low-battery sensor reports low. A current charging report clears the issue even if the level is still low, and the issue comes back if charging stops before the level recovers. Homeostatic can't tell whether a battery was replaced or recharged.

## Watch UPS conditions

Homeostatic can watch UPS devices supplied by Home Assistant's NUT or APC UPS Daemon integrations. In **Policies**, select **Add policy**, choose a UPS monitoring type, then choose its sources and enable it. Backup power, low reserve, battery replacement and faults have separate checks and notification choices. Groups can include UPS devices added later.

For low reserve, choose both power modes together: a morning report while mains power is confirmed, and immediate notification with acknowledgment while running on backup power. Set the timing and delivery methods in each notification entry. Optional charge and runtime thresholds have separate raise and clear values. A current UPS low warning remains authoritative even if another measurement appears adequate.

A UPS reserve policy can overlap a battery policy. Each continues to use its own detection and notifications. Disable or edit either policy if that overlap is unwanted.

Issues groups open conditions under the UPS, with the most urgent first. Open **View issues** to acknowledge or pause one condition. Mains restoration can leave reserve low; charging does not clear a replacement warning or fault. If reserve becomes critical on backup power after an earlier acknowledgment, Homeostatic requests acknowledgment again and keeps any existing alert pause.

Runtime is an estimate supplied by the UPS. Missing readings remain visible, and a disabled diagnostic entity must be enabled in Home Assistant before it can supply evidence. Homeostatic does not shut down equipment or control UPS outlets. UPS availability and physical power wiring remain separate from these reported conditions.

## Watch vacuums

A vacuum is watched separately from whether Home Assistant can reach it. Homeostatic lists each vacuum entity in **Sources**. None are watched until you choose them.

In **Policies**, edit the vacuum policy, choose selected vacuums or **All vacuums**, then enable it. Add any notification entries, then select **Save changes**. All vacuums includes matching sources added later.

A watched vacuum opens an issue when Home Assistant reports its activity as error. Cleaning, docked, idle, paused, or returning ends the issue. Unavailable, unknown, missing, and restored states leave an open issue open.

The policy starts without notifications. Add an immediate entry if you want to hear when an error begins, including overnight. The message names the vacuum and, when Home Assistant has an area assigned, that area. The area is often the room where the vacuum docks.

A fault that never becomes the error activity stays an alert you write yourself.

## Watch temperature limits

In **Policies**, select **Add policy** and choose **Temperature limits**. Select a temperature sensor or a group of temperature sensors, then enter a **Minimum**, a **Maximum**, or both, with the **Temperature unit**. Enter **Must persist for (seconds)** before enabling the policy. Zero means an immediate issue. Choose at least one temperature limit and review the duration before enabling the policy.

A reading below the minimum or above the maximum must stay outside the range for the chosen duration before opening an issue. Equality is allowed. A reading back within the range clears the issue. A direct jump from below the minimum to above the maximum keeps the same issue because no in-range reading was seen. To monitor cold and warm conditions separately, create two policies with separate notification entries.

For example, a garage policy could watch a chosen sensor below an owner-selected minimum for ten minutes. Duplicate that policy to watch another space, then change the sensor and settings before enabling the copy. Sensor placement and the limits you choose determine what the check means.

## Watch thermostat progress

In **Policies**, select **Add policy** and choose **Thermostat progress**. Select the thermostat, review its temperature differences and **Progress window (seconds)**, then choose notification entries and enable the policy. An immediate notification is useful when you want to hear about worsening conditions as they qualify.

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

The Repairs policy watches all Home Assistant Repairs. Its editor has no scope dropdown; you can change its name, notifications and enabled state.

Every Repair Home Assistant raises becomes an issue, whichever integration raised it. That includes an automation that fails to set up or calls an action that doesn't exist, a YAML setting that's going away, and an integration asking you to do something before an upgrade. The issue uses the Repair's own title and says which integration raised it and how serious Home Assistant considers it. **Fix in Home Assistant** opens the automation when Home Assistant links one, and the Repairs page otherwise.

The issue ends when Home Assistant stops reporting the Repair, or when you select **Ignore** on it in Home Assistant. Ended Repairs go into History like any other issue, and Acknowledge and Pause alerts work on them. **Working on this equipment** doesn't apply, because a Repair isn't equipment.

Edit the **Repairs** policy to change its monitoring or add notification entries. It starts enabled with no entries, so Repairs initially show only in the panel.

An error that shows up only in an automation's trace still won't appear as a Repair. Check those in the automation's traces. An automation that names an entity that no longer exists is a [broken automation](#broken-automations).

## Broken automations

An automation stays on when a trigger, condition, or action names an entity that no longer exists. That part never runs, and Home Assistant does not raise a Repair for it.

Homeostatic opens one issue for that automation. The issue uses the automation's name, lists the missing entity ids, and **Fix in Home Assistant** opens the automation in the editor. The issue ends when the automation no longer names a missing entity, the automation is removed, or the entity exists again. If the automation has other triggers, those can still run.

The **Broken automations** policy checks all automations for references to missing entities, including automations added later. Its editor has no scope dropdown. The policy starts enabled. Use **Turn off** or **Turn on**, then select **Save changes**. Turning Repairs off leaves this policy on.

Add notification entries in the **Broken automations** policy. It starts with no entries, so these issues initially show only in the panel.

An entity that is unavailable, unknown, or disabled is still an entity, so it does not open this issue. An entity id written only inside a template is not seen. Scripts are not checked.

## Activate notifications

Notifications are off on a new install, and issues still appear in the panel. Leave them off for a day or two while you settle what to watch, then set up who hears about what and turn them on.

Homeostatic requests delivery through configured Home Assistant destinations. A notification automation is optional.

Use **Notifications** to create reusable delivery methods, then set timing and choose methods inside each policy. Changes wait for **Save changes**. Opening a page or editing a method does not send a test or enable notifications.

### Choose delivery methods

Select **Add delivery method** and give it a name. Select **Add destination**, choose the delivery type, then choose a configured destination. The editor lists only the destinations selected for this method. For speech, choose the speaker and, when needed, its speech provider. A method can combine several supported destination types. Home Assistant owns the provider accounts and credentials. Unavailable destinations are hidden from new choices by default; an unavailable saved destination stays visible until you replace or remove it.

Fixed methods always use the selected destinations. Open the optional presence settings to choose separate home and away destinations, or the destinations of selected people currently home. Choose fallback destinations or explicitly choose to skip when nobody qualifies or presence is unknown. A current home report qualifies; a named zone counts as away. Missing, restored, unknown and unavailable person states use the fallback when nobody is known to be home. Presence changes alone send nothing. Each new request or reminder uses the evidence available at that time.

Only destinations with identified email or SMS support appear as those types. Unclassified notification routes use a generic notification label. Phone-number fields are offered only for supported SMS providers. Voice requires a satellite that supports announcements or a media player that supports playback with the chosen TTS provider.

### Choose when each policy reports

Open a policy in **Policies** and find **Notifications**. Select **Add another notification**, choose **When to notify**, then select one or more **Delivery methods** for that entry.

| Timing | Settings |
| --- | --- |
| Immediately | Sent when the problem begins, including overnight. Optionally select **Remind until acknowledged** and enter a positive interval in minutes. |
| Scheduled summary | Choose a local time and one or more weekdays in the displayed installation time zone. |

Add another entry to report the same problem in a different way: for example, immediately to phones and at 08:00 on weekdays to email. Each entry owns its timing, so editing it doesn't change another policy. A method may be shared by several entries or policies. **Manage delivery methods** opens Notifications while keeping your policy draft.

Every saved entry needs at least one method. **Remove notification** removes only that entry. With no entries, the policy shows **Dashboard only** and continues monitoring.

A scheduled summary lists eligible new problems and problems still open, including ones already reported immediately or acknowledged. It shows how long each has been open. Cleared problems and empty summaries are omitted. Acknowledgment stops reminders across the issue's entries; it doesn't remove an open problem from later summaries.

Immediate delivery includes overnight. Companion app requests use critical alerts on iPhone and the **Homeostatic urgent** notification channel on Android. Voice follows the entry's timing too, including reminders and overnight delivery.

Delivery methods are shared. The editor identifies which policies use a method. Deleting one in use requires choosing a replacement or removing its affected notification entries in the same save.

Alerts made from automations keep their reporting selection in the automation; see [Alerts from automations](automation-situations.md).

### Send a test notification

Save the delivery method, then select **Send test** in its editor. The test uses only that method's configured destinations, resolving any presence rules at the time of the test. There is no separate test area or destination picker. Save further edits before testing again.

A test works while normal notifications are off and does not create an issue. An explicit Skip fallback sends nothing; provider failures are reported for each destination. The result confirms a request, not receipt or speech heard. Opening, editing or saving the method does not send a test. If nothing arrives, see [Troubleshooting](troubleshooting.md).

### Turn notifications on

1. Near the top of **Notifications**, select **Enable notifications** after configuring the methods and entries you want.
2. Select **Save changes**.

Monitoring continues when notifications are off.

Problems already open follow their notification entries when you save. Immediate entries can request new messages, combined into summaries per entry and method, while scheduled entries wait for their next occurrence. Problems already cleared are left out. A reporting edit cancels superseded pending requests and withdraws replaceable messages without clearing the issue. A name-only edit doesn't restart reporting.

After a Home Assistant restart, Homeostatic holds notifications until your integrations have finished loading, for at least **Wait after startup** and at most **Maximum startup wait**. Alerting requests join summaries per entry and method. Pending requests keep their already selected destinations even if presence changes during the restart. [Restart and activation](events.md#restart-and-activation) has the details.

### When a notification arrives

Tapping a notification about one issue opens that issue in the panel. If the issue has ended by then, you see its entry in History. Tapping a summary opens **Issues**. You need to be signed in to the Home Assistant server that sent it, and the panel is for administrators only.

A Companion app notification about a single open issue has an **Acknowledge** button where supported. Tapping it records that someone has seen the issue, the same as **Acknowledge** in the panel, and stops its acknowledgment reminders. The issue stays open until the problem clears. On an iPhone, the phone asks to be unlocked first. Only the phone's linked user can acknowledge with it. Dismissing a notification doesn't acknowledge it.

When an issue clears, Homeostatic updates or withdraws its phone notification using the destinations of previous requests, even when people have since left home. Voice, email and SMS receive new messages and reminders, with no silent updates, cleanup sends or implied reply-based acknowledgment. The panel's acknowledgment control remains available.

## Operator controls

Three controls handle problems you already know about. They're in the issue and source details in the panel, for administrators.

### Acknowledge

**Acknowledge…** on an open issue records that someone has seen it, for everyone who gets its notifications. It stops the repeats for **Remind until acknowledged**, and the issue shows when it was acknowledged. The issue stays open until the problem clears. You can also acknowledge from the phone notification (see [When a notification arrives](#when-a-notification-arrives)).

### Pause alerts

**Pause alerts…** on an open issue holds new notifications for that issue until an end time you choose, up to seven days ahead. It holds them for everyone, including immediate notifications, reminders and escalations. Other issues on the same equipment still notify. The issue stays open and visible, its existing notification stays on the phone, and it still clears as usual. You can extend a pause but not shorten it; to end it early, use **End now…**.

### Working on this equipment

For planned work, like replacing a Zigbee coordinator or rewiring the garage, open **Sources**, select the integration or entity you're working on, and select **Working on this equipment…**. Devices don't have the button. To cover a device, choose its integration and tick **Also cover equipment that depends on this**.

1. Choose **30 minutes**, **2 hours** or **4 hours**, or enter an end time up to seven days ahead.
2. Tick **Also cover equipment that depends on this** if the work takes down what's behind it too. For an integration, that's the devices and entities you watch on it.
3. Select **Start maintenance** to apply the window. The result shows the covered equipment and expiry.

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
