# How Homeostatic works

Homeostatic tracks what goes wrong in Home Assistant: integrations, devices and entities, batteries and Repairs, plus the alerts you define about the house, like water on the basement floor or the garage open after dark.

This page explains how Homeostatic reaches its answers and when it tells you. For setup, see [Install and first run](install.md). For individual tasks, see the [user guide](guide.md).

## The dependency map

Homeostatic keeps a map of what depends on what, built from Home Assistant's own registries.

Each device and entity you watch depends on the integration that provides it, as long as you watch that integration too. A Zigbee motion sensor depends on the Zigbee integration. Batteries and alerts stand on their own, with no links.

The map comes only from Home Assistant's registry links. Names, areas, floors and labels help you find and select sources, but never decide what depends on what.

## How one failure becomes one issue

When something fails, Homeostatic works out which failure explains the others and keeps one issue for it.

Say the Zigbee integration fails to set up. Every Zigbee device and entity you watch goes unavailable with it. Homeostatic opens one issue on the integration and lists them on it, instead of opening one issue for each. The issue quotes what Home Assistant reported and suggests what to try.

Reports can arrive in any order. If a few devices report unavailable seconds before the integration reports its failure, they get issues of their own at first. When the integration's failure arrives within two minutes of theirs, those issues fold into the integration's issue, and **History** lists them as **Joined another problem**. And while an integration is still loading or its state is unknown, a device or entity on it that fails waits up to two minutes for the integration to settle before getting an issue of its own.

Recovery has rules of its own. When the integration comes back, its issue stays open while its devices and entities reconnect. Each one still unavailable gets another minute. After that, if three or more are still down they stay together on the integration's issue, and otherwise each one left opens its own issue.

### Several failures at once, with the integration still working

Sometimes the integration reports that it's fine while things behind it fail. A Zigbee router dies, and three sensors that route through it drop within a minute, but the Zigbee integration itself is still loaded.

When three or more watched devices or entities on the same integration fail within a 60-second window, Homeostatic groups them into one issue on the integration. Issues already opened for the first ones fold into it, and anything on that integration that fails afterwards joins it. The grouped issue ends when fewer than three are still failing. Any that are still unavailable a minute later get their own issues.

Grouping happens as the reports arrive. If the first sensors' issues are set to **Immediate**, their notifications can go out before the third sensor fails and the group forms.

You can change the count (**Group related problems**) and the window (**Grouping window**) under **Settings → Problem grouping**.

### What grouping does and doesn't tell you

A device or entity grouped under a failed integration still shows what Home Assistant reported for it. A device that becomes unavailable while its integration keeps working gets its own issue.

Grouping follows Home Assistant's registry, which says where each availability report comes from. It doesn't prove the integration caused every failure under it. If a device has a fault of its own at the same moment, that fault is grouped too, so check anything still failing once the integration recovers.

An entity can be part of a watched device and have its own check as well. The two checks stay independent, so one failure can show up on both.

## Alerts stay separate from equipment

The leak sensor in the basement shows why Homeostatic keeps equipment and alerts apart.

As equipment, the leak sensor is a source. If you watch it, Homeostatic reports when Home Assistant says it's unavailable. If you watch its battery too, that's a separate issue when the battery runs low.

As a message about the house, the *Basement water leak* alert is an automation built from the alert blueprint, with the leak sensor listed under **Required evidence**. The alert has three states:

- Active: the sensor reports water. One issue opens and follows the alert's reporting choice.
- Clear: the sensor reports dry. The issue ends.
- Unknown: the sensor is unavailable or has no value, so nobody can say whether the floor is wet.

A dead sensor makes the alert unknown, never clear. If the alert was active when the sensor died, its issue stays open until the sensor comes back and reports dry. If the alert was clear and stays unknown for 15 minutes, it opens an issue of its own saying its reading is out of date. Meanwhile, the sensor's own outage is a separate equipment issue.

Alerts have no place in the dependency map, for three reasons:

- A failed integration doesn't silence an alert that depends on its sensors. The alert goes unknown and stays visible.
- An active alert doesn't make equipment look broken. An open garage door says something about the house, and the door's own checks are unaffected.
- Starting **Working on this equipment** holds off new issues for the equipment you're working on. It never holds off alerts.

The [alert guide](automation-situations.md) covers writing alerts, and the decision record on [alerts from automations](adr/0034-create-alerts-from-ha-automations.md) explains why the condition lives in a Home Assistant automation.

## Repairs

Home Assistant raises a Repair when it needs you to do something: an automation calls an action that no longer exists, a setting is going away, an integration needs attention before an upgrade. Homeostatic turns each Repair into an issue, named with the Repair's own title. The issue ends when Home Assistant stops reporting the Repair, or when you ignore it in Home Assistant.

Like alerts, Repairs stay out of the dependency map. A failed integration doesn't fold its Repairs into its own issue, and **Working on this equipment** never holds them off.

Home Assistant keeps only some Repairs across a restart, and integrations raise the rest again while they load. So after a restart, Homeostatic keeps a Repair's issue open until your watched integrations have finished loading, and ends it only if the Repair still hasn't come back by then. The decision record on [Repairs as issues](adr/0044-report-home-assistant-repairs-as-issues.md) explains the choices.

## Timing

Homeostatic waits in a few places so that brief blips and slow starts don't become issues. You can change each wait under **Settings → Timing**. The [reference](reference.md) lists every setting with its default.

Opening an issue:

- An entity that Home Assistant reports unavailable, or a device whose selected entities are all unavailable, gets an issue straight away. The one exception is a device or entity whose integration is still loading or unknown: it waits up to two minutes for the integration to settle (**Wait for related failures**). The same two minutes decide whether its issue folds into the integration's.
- An integration that's retrying gets an issue straight away, as a warning. If it's still retrying after two minutes (**Wait before reporting setup retries**), the warning becomes a failure.
- A watched source with no current reading, such as an entity Home Assistant still lists but isn't providing, gets an issue after 15 minutes (**Wait for unknown evidence**). An entity whose state is `unknown` is different: Home Assistant can reach it but has no value yet, so it gets no issue.
- A battery gets an issue as soon as it reads 20% or less, or the device reports a low warning.
- A vacuum gets an issue as soon as Home Assistant reports its activity as error.

Ending an issue:

- An availability issue ends after the source has been working for two minutes (**Confirm recovery**). Until then, the issue says it's confirming recovery.
- Alerts and batteries end as soon as the condition clears. A charging report clears a low battery, even while the reading is still low.
- A vacuum error ends as soon as the activity is cleaning, docked, idle, paused, or returning. Unavailable, unknown, and restored states leave it open.
- When an integration recovers, devices and entities that are still reconnecting get a minute (**Allow reconnecting devices**) before they count as failures of their own.

Sending notifications: Immediate choices go out as soon as the issue opens. Summaries go out at their scheduled times and include only issues that are still open. **Standard alert batching** applies only to custom notification policies.

## Restarts

Homeostatic saves its state, including open issues, history, paused alerts, equipment work and reminder timers, and picks up where it left off after a restart. An issue that was open before the restart continues as the same issue. It isn't reported again as new.

While Home Assistant starts, states it restores from before the restart count as unknown, neither working nor failed. For the first two minutes (**Wait after startup**), Homeostatic opens no new issues. After that, anything still failing opens an issue as usual.

Notifications wait longer, until your watched integrations have finished loading. That's at least two minutes and at most ten (**Maximum startup wait**). An integration that's retrying or has failed counts as finished, so one broken integration can't hold everything up. Then each person gets a single summary of what needs telling, instead of a burst of messages.

Alerts need a fresh report after a restart. The alert blueprint reports when Home Assistant starts and every minute after that, and until the first report arrives, the alert reads unknown. An alert that was active stays open through the gap.

Homeostatic also reloads when you save a change in its panel. That save takes effect without another two-minute wait. A full Home Assistant restart still has the startup wait. [Events](events.md#restart-and-activation) describes what Homeostatic publishes around restarts.

## What Homeostatic can and can't know

Everything Homeostatic knows comes from Home Assistant: whether each integration loaded, whether each entity is available, battery readings, vacuum activity, and the reports your alert automations send. It has no other way to reach your devices, so it can never know more about a device than Home Assistant does.

[Known limitations](troubleshooting.md#known-limitations) lists what that leaves out, along with the rest of what Homeostatic doesn't do yet. [Home Assistant states](home-assistant-states.md) explains how Home Assistant reports these signals and how Homeostatic reads them.
