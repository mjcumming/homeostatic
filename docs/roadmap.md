# Roadmap

What Homeostatic does today, what's being worked on next, and what's further out. Last updated October 3, 2026.

## What works now

- Watching integrations, devices, entities and batteries. A new install watches integrations and Home Assistant's Repairs. You add more in Sources, one at a time or with rules that cover a whole integration, area, floor, label or device class, including sources added later. An exclusion always wins over a rule.
- Device availability that follows what Home Assistant reports. When a device has a connectivity sensor and it reports disconnected, Homeostatic treats the device as disconnected.
- Battery checks. A battery at 20% or less, or one that reports a low warning, raises an issue. A charging report clears it.
- Vacuum errors. When Home Assistant reports a vacuum's activity as error, that opens an issue. Cleaning, docked, idle, paused, or returning ends it. The notice is Immediate unless you choose otherwise for that vacuum.
- One issue per failure. When an integration fails, the devices and entities you watch on it are listed on that one issue.
- Every Home Assistant Repair as an issue, in the morning summary unless you choose otherwise.
- Alerts made from Home Assistant automations with the alert blueprint, with required evidence and an Acknowledge button on the phone.
- Notifications to people's phones through the Companion app, with the six reporting choices, summary times you set, a test notification, and taps that open the issue.
- The controls Acknowledge, Pause alerts and Working on this equipment. Pauses and maintenance last up to seven days.
- History of ended issues: the last 100, from the past 30 days.
- Events for your own automations, a card for each panel page, and a ready-made dashboard.
- Optional grouping of Sources by TopoMation locations.

The [user guide](guide.md) and the [alert guide](automation-situations.md) cover all of this. What Homeostatic can't detect is listed under [known limitations](troubleshooting.md#known-limitations).

## Next

- Clearer next steps on each issue. An issue should say what to do and link to where you do it. It may also list supplies, like the battery a device takes.
- Battery checks tested against real devices. The checks are released. The next step is to compare them with real battery and charging reports and refine what a battery issue tells you to do.
- Counts that agree. Overview, Issues and Sources should show the same numbers, and you should be able to open a count and see what's behind it, with open issues, affected devices and missing information kept apart.
- A panel that stays put during live updates. Your selection, your place on the page and any unsaved edits should survive new information arriving.
- A view for household members who aren't administrators. The panel is administrator-only today, and the permissions design comes before any change.

## Later

- Lawn mower errors. When Home Assistant reports a lawn mower's activity as error, that opens an issue the way a vacuum error does. Mowing, docked, paused, returning, and idle end it.
- Problem and tamper sensors. A problem sensor or a tamper sensor opens an issue while it is on. Off ends the issue.
- Triggered alarms. An alarm panel opens an issue while Home Assistant reports it as triggered. Disarmed, armed, and the panel's other states end it.
- Jammed locks. A lock opens an issue while Home Assistant reports it as jammed. Locked, unlocked, and the lock's other states end it.
- Device availability reported by integrations themselves. Home Assistant has a proposal for integrations to report device availability directly. Homeostatic already follows that model and will read those reports once Home Assistant ships them.
- Checks beyond what Home Assistant reports: readings that have gone stale, a detector that has hung, and a command that didn't complete. Each one needs recordings from real devices of normal running, a failure and the recovery before Homeostatic reports it.
- A watchdog that runs outside Home Assistant, so you hear about it when Home Assistant itself stops.
- Watching every entity on very large installs, 6,000 or more. This needs testing under real household load on the hardware people actually run.
- Reconsidering household functions if a clear use case and a useful setup workflow emerge. Their stored definitions are dormant.
- Spoken announcements of alerts on speakers, and a Snooze button on phone notifications.
- More ways to set up alerts: a guided menu of common alerts in Homeostatic, and alerts for one-off events that have no start and end. The condition itself stays in a Home Assistant automation.
- More from TopoMation, such as occupancy and automation context.
- A full history that records every setting change, control and notification, beyond the ended issues History keeps now.
- Suggestions for tidying up settings when you've built up many single-entity rules.

These are ideas under consideration, with no commitment yet:

- Consumables and scheduled maintenance, starting with one kind that has reliable data.
- Grouping maintenance into tasks with a list of supplies, once quantities can be trusted.
- Showing maintenance in Home Assistant's own screens, if Home Assistant offers a supported way to do it.
- Problems reported by other tools and by the machine Home Assistant runs on, where they say clearly when a problem starts and ends.
- Looking up supplies information, like which battery a device takes, from an outside source.

Maintainers: the reasons behind current behavior and these plans are in the [decision records](adr/README.md).
