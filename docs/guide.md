# User guide

This guide covers the jobs you do in Homeostatic once it's installed.

## Contents

- [Choose what to watch](#choose-what-to-watch)
- [Watch batteries](#watch-batteries)
- [What an availability problem means](#what-an-availability-problem-means)
- [Home Assistant Repairs](#home-assistant-repairs)
- [Activate notifications](#activate-notifications)
- [Operator controls](#operator-controls)
- [Find ended problems in History](#find-ended-problems-in-history)
- [Remove Homeostatic](#remove-homeostatic)

If you haven't installed Homeostatic yet, start with [Install and first run](install.md). Alerts about the house itself, like water on the floor, are made from automations and have their own guide, [Alerts from automations](automation-situations.md). The [reference](reference.md) lists current settings and actions, and [How it works](how-it-works.md) explains how issues are worked out.

## Choose what to watch

A new install watches the connection of every integration and nothing else. Everything Home Assistant knows about is listed in **Sources**, but a source is only checked once you choose to watch it. Start with a few things that matter, like the Zigbee integration and the devices on it you rely on, and widen from there.

Every monitoring change goes through a review. Make your choices, select **Review changes** to see which sources start or stop being watched, then save. Nothing changes until you save.

### Watch a device or an entity

1. Open **Sources** and find the device. Use **Find a source** to search, or **Group by** to browse by integration, by Home Assistant location, or by [TopoMation](https://github.com/mjcumming/topomation) location if you use it.
2. Select the device and open its **Settings** tab.
3. Under **Device availability**, choose **Always monitor this device**.
4. Select **Review changes**, check the result, then select **Save changes**.

A watched device gets one check across its enabled entities. Homeostatic uses the device's ordinary entities, including buttons and hidden entities, and falls back to its diagnostic entities only when it has no ordinary ones. Configuration entities and disabled entities are left out. Expand the device in the tree to see which entities its check covers.

To watch a single entity, select it in the tree and open **Settings**. **Follow device monitoring** includes the entity in its device's check whenever the device is watched. **Monitor this entity** gives it a check of its own. If its device already includes it, that choice is under **More monitoring choices** as **Monitor this entity separately**.

### Watch a whole integration

Open the integration in **Sources** and open **Settings**. **What to monitor** shows how many of its connections and devices are watched now. Select **Change** to choose:

- Under **Integration problems**, **Monitor the connection** watches for setup failures and sign-in problems. A new install already does this for every integration.
- Under **Device availability**, **All devices, including new devices** watches every current device and any the integration adds later. **Only devices I choose** leaves new devices unwatched until you pick them one by one.

A choice on one device wins over the integration's device default, so you can choose **Only devices I choose** and still watch the two devices that matter.

**When to notify**, on the same page, sets the reporting choice for all the integration's current devices at once. See [Choose when each source reports](#choose-when-each-source-reports).

### Rules for groups and future sources

Some choices work better as a rule, such as watching every device in the garage area or leaving everything with a `test` label alone. A rule like this is a group policy, and it applies to current sources and to any that appear later.

1. Open **Settings → Monitoring policies** and select **Add group policy**.
2. Under **Edit group policy**, set **Action** to **Watch** or **Leave unmonitored**, and **Check** to **HA availability** or **Battery condition**.
3. Fill in the conditions you need: source type, domain, device class, integration type, area ID, floor ID or label ID. A new policy starts with none, which would watch every integration and entity, so fill these in before you review. Every filled condition has to match. Separate alternative values within one condition with commas. To cover devices, set the source type to `device`; a policy without a source type matches integrations and entities only.
4. Select **Review changes** to see which sources the policy picks up, then **Save choices**.

**Leave unmonitored** policies are listed under **Leave unmonitored policies**.

**Advanced rule details**, at the bottom of the page, shows every saved rule with its exact conditions, including the rules Sources creates for individual choices. Use it when two rules overlap. The fields are listed in the [reference](reference.md#monitoring-rules).

### Exclude something

Some sources go unavailable as a matter of course: a TV's media player while the TV is off at the wall, or a feature an integration only offers in some modes. To stop watching one:

- For an entity, choose **Exclude this entity** in its **Settings**. This also removes it from its device's check.
- For a device, choose **Do not monitor this device**.
- From an open device issue, select **Ignore availability…** next to the entity under the issue's monitoring choices. An entity's own issue offers **Ignore this availability check…**.

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

To watch every battery, now and in future, open **Settings → Monitoring policies**, select **Monitor all batteries**, review the result and select **Save choices**. Batteries you've excluded one by one stay excluded.

A watched battery opens an issue when its level is at or below 20%, or when its low-battery sensor reports low. A current charging report clears the issue even if the level is still low, and the issue comes back if charging stops before the level recovers. Homeostatic can't tell whether a battery was replaced or recharged.

## What an availability problem means

Home Assistant has no single health status that runs from an integration down to its devices and entities. It has separate signals, and Homeostatic reads each one for what it says:

- An *integration* connects Home Assistant to a service or a hub. Its setup state says whether it loaded, is retrying, failed, or needs you to sign in again.
- A *device* groups related entities, like a smart plug with a switch, a power sensor and a signal-strength sensor.
- An *entity* is one feature or reading. Its state is a value (`on`, `off`, `21.5`), `unknown` or `unavailable`.

`unavailable` means Home Assistant can't supply that entity right now. It usually goes with a lost connection, but some integrations also mark a feature unavailable when it doesn't apply in the current mode. `unknown` means Home Assistant has no value for the entity, and Homeostatic counts it as available. `off` and `idle` are ordinary states.

Watching a source tells Homeostatic you expect it to stay available. It opens an issue when:

- a watched integration fails to set up, is retrying setup, or needs you to sign in again
- a watched entity, or any selected entity in a watched device, is unavailable
- a watched device's connectivity sensor (a binary sensor with the `connectivity` device class) reports `off`
- a watched source has lacked usable evidence for longer than **Wait for unknown evidence**

The issue quotes what Home Assistant reported and lists the entities involved. It doesn't name a physical cause, because Home Assistant doesn't report one. [Known limitations](troubleshooting.md#known-limitations) lists what Homeostatic can't see.

Device details in Sources also show Home Assistant's own view of the whole device. It follows Home Assistant's [proposed device availability rules](https://github.com/home-assistant/architecture/discussions/1400):

| Status | When |
| --- | --- |
| Available | At least one enabled entity has a current state, and no connectivity sensor reports `off` |
| Unavailable | Every enabled entity is unavailable, or a connectivity sensor reports `off` |
| Unknown | No enabled entity has a current state and they aren't all unavailable, for example while states are still restoring after a restart |
| Disabled | The device is disabled in Home Assistant |

This status counts every enabled entity on the device, including ones you've excluded, while an issue only looks at the entities you selected. A device can therefore show Available while an issue for one of its entities is open. The issue details explain the difference under **Why does Home Assistant say Available?**

If an unavailable feature is normal in your house, exclude it (see [Exclude something](#exclude-something)). To quiet an issue without changing what's watched, use the [operator controls](#operator-controls). The reasoning behind these rules is in the decision record on [following Home Assistant's availability rules](adr/0025-follow-home-assistant-availability-semantics.md).

## Home Assistant Repairs

Every Repair Home Assistant raises becomes an issue, whichever integration raised it. That includes an automation that fails to set up or calls an action that doesn't exist, a YAML setting that's going away, and an integration asking you to do something before an upgrade. The issue uses the Repair's own title and says which integration raised it and how serious Home Assistant considers it. **Fix in Home Assistant** opens the automation when Home Assistant links one, and the Repairs page otherwise.

The issue ends when Home Assistant stops reporting the Repair, or when you select **Ignore** on it in Home Assistant. Ended Repairs go into History like any other issue, and Acknowledge and Pause alerts work on them. **Working on this equipment** doesn't apply, because a Repair isn't equipment.

All Repairs share one reporting choice, which starts at **Morning summary**. Change it under **Notifications → Household default → Home Assistant Repairs**. If nobody receives the choice you pick, Repairs show only in the panel.

Homeostatic only shows what Home Assistant reports. It doesn't read your automations to guess whether they'll work, so an automation that never runs, or an error that shows up only in its trace, won't appear here. Check those in the automation's traces.

## Activate notifications

Notifications are off on a new install, and issues still appear in the panel. Leave them off for a day or two while you settle what to watch, then set up who hears about what and turn them on.

Homeostatic sends to phones through the Home Assistant Companion app by itself, so you don't need a notification automation.

All of this happens on the **Notifications** page, and changes there wait for review too. When you're done, select **Review changes**, check the list, then select **Save settings**. Until you've saved reporting choices once, the page shows the defaults, the button reads **Review reporting setup**, and the existing notification policy stays in effect.

### Add people and their phones

Under **People and destinations**, use **Add person** to pick someone. The list shows Home Assistant people who are linked to a user account. Their Companion app phones appear under their name: tick the ones to use. Other `notify` entities, such as an email or messaging integration, are listed as destinations too.

A person doesn't need to be an administrator to receive notifications or to acknowledge one from their phone.

### Set up the reporting choices

Every source and alert has one of six reporting choices:

| Choice | What happens |
| --- | --- |
| Immediate | Sent right away, overnight included |
| Immediate with acknowledgment | Sent right away, then repeated every 30 minutes until someone acknowledges it or the problem clears |
| Morning summary | Listed in the morning summary, 08:00 by default |
| Evening summary | Listed in the evening summary, 18:00 by default |
| Weekly summary | Listed in the weekly summary, Sunday 09:00 by default |
| Dashboard only | Never sent. It shows in the panel. |

Under **Reporting profiles**, open each of the five sending choices and tick the people who should get it. The summaries also have a **Report time**, and **Weekly summary** has a **Weekday**. Report times use the **Time zone** under **Household default**.

A summary lists new problems and those still open, with how long each has been open. Problems that have already cleared aren't listed, and an empty summary isn't sent.

Both immediate choices are sent as urgent notifications. On an iPhone they're sent as critical alerts, and on Android they use the **Homeostatic urgent** notification channel. If a choice is in use but nobody picked for it has a destination, problems with that choice are recorded without being sent, and the Overview shows **Reporting needs attention**.

### Choose when each source reports

Under **Household default**, **Newly monitored sources** sets the choice for every source that hasn't got one of its own. It starts at **Weekly summary**. **Home Assistant Repairs** sets the choice for every Repair, and starts at **Morning summary**.

To give one source its own choice, open it in **Sources**, open **Settings**, and pick a **Source preference** under **Reporting**. **Condition exceptions** sets a different choice for one kind of check on that source. For a whole integration, use **When to notify** in its **Settings**: **Device default** applies one choice to all its current devices, and devices it adds later use the household default.

When one issue covers several sources with different choices, the most urgent choice wins: Immediate with acknowledgment, then Immediate, Morning summary, Evening summary, Weekly summary and Dashboard only.

Alerts made from automations carry their reporting choice in the automation; see [Alerts from automations](automation-situations.md).

### Send a test notification

Next to each available destination, **Send test** sends a fixed test message straight to it. It doesn't create an issue, and it works while notifications are off. Tapping the test notification opens the Notifications page. If nothing arrives, see [Troubleshooting](troubleshooting.md).

### Turn notifications on

1. Under **Outgoing requests**, tick **Enable notification requests**. It stays greyed out until at least one person has a destination.
2. Select **Review changes**. The review says how many notifications the problems open right now would produce.
3. Select **Save settings**.

Problems that are already open are reported by their reporting choice as soon as you save. Those set to an immediate choice go out straight away, combined into one summary per person, and the rest wait for their next scheduled summary. Problems that have already cleared are left out.

After a Home Assistant restart, Homeostatic holds notifications until your integrations have finished loading, for at least **Wait after startup** and at most **Maximum startup wait**. Then it sends one summary per person instead of a burst. [Restart and activation](events.md#restart-and-activation) has the details.

### When a notification arrives

Tapping a notification about one issue opens that issue in the panel. If the issue has ended by then, you see its entry in History. Tapping a summary opens **Issues**. You need to be signed in to the Home Assistant server that sent it, and the panel is for administrators only.

A notification about a single open issue has an **Acknowledge** button. Tapping it records that someone has seen the issue, the same as **Acknowledge** in the panel, and stops the 30-minute repeats. The issue stays open until the problem clears. On an iPhone, the phone asks to be unlocked first. Only the person the notification was sent to can acknowledge with it. Dismissing a notification doesn't acknowledge it.

When an issue clears, Homeostatic replaces its phone notification with a quiet *Problem cleared* message. Destinations other than Companion phones get each new message and reminder, but no silent updates, no **Acknowledge** button and nothing when the problem clears.

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
