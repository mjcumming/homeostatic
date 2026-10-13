# Roadmap

What Homeostatic does today, what's being worked on next, and what's further out. Last updated October 13, 2026.

## What works now

- Watching integrations, devices, entities and batteries. A new install watches integrations, Home Assistant's Repairs, and automations that name a missing entity. You add more in Sources, one at a time or with rules that cover a whole integration, area, floor, label or device class, including sources added later. An exclusion always wins over a rule.
- Device availability that follows what Home Assistant reports. When a device has a connectivity sensor and it reports disconnected, Homeostatic treats the device as disconnected.
- Battery checks. A battery at 20% or less, or one that reports a low warning, raises an issue. A charging report clears it.
- UPS checks for NUT and APC UPS Daemon: backup operation, low reserve, replacement warnings and faults, with grouped independent issues and reserve schedules for mains and backup mode.
- Vacuum errors. When Home Assistant reports a vacuum's activity as error, that opens an issue. Cleaning, docked, idle, paused, or returning ends it. The notice is Immediate unless you choose otherwise for that vacuum.
- One issue per failure. When an integration fails, the devices and entities you watch on it are listed on that one issue.
- Every Home Assistant Repair as an issue, in the morning summary unless you choose otherwise.
- Automations that name an entity that no longer exists. The issue uses the automation's name, lists the missing entity ids, and opens the automation in the editor. It starts in the morning summary. An entity that is only unavailable stays out, and so does an entity id written only inside a template. Scripts are left out.
- Alerts made from Home Assistant automations with the alert blueprint, with required evidence and an Acknowledge button on the phone.
- Notifications to people's phones through the Companion app, with reusable schedules and delivery methods, summary times you set, a test notification, and taps that open the issue.
- The controls Acknowledge, Pause alerts and Working on this equipment. Pauses and maintenance last up to seven days.
- History of ended issues: the last 100, from the past 30 days.
- Events for your own automations, a card for each panel page, and a ready-made dashboard.
- Optional grouping of Sources by TopoMation locations.

The [user guide](guide.md) and the [alert guide](automation-situations.md) cover all of this. What Homeostatic can't detect is listed under [known limitations](troubleshooting.md#known-limitations).

- Named monitoring policies with Add, Edit, Duplicate, Enable/Disable and Delete, group membership that includes future sources, and links from source details. Policies and Notifications retain a complete draft across navigation and require review before saving.
- Thermostat checks using configurable deviation, progress and worsening thresholds. Temperature-limit checks use chosen low/high bounds and an explicit duration. Both preserve missing-evidence and restart boundaries; overlapping temperature policies operate independently. Detection edits end the old monitoring expectation and restart qualification.
- Separate notification schedules and delivery methods in Notifications, paired explicitly on monitoring policies. Rows can share schedules and methods, use editable acknowledgment intervals or selected report weekdays, and report the same issue independently. Renaming preserves assignments; deletion requires replacement or removal of affected rows. Reviewed reporting edits apply to open issues while retaining unchanged rows. Existing generated choices convert without changing destinations on page load.
- App, voice, email and SMS requests through configured Home Assistant destinations, with fixed or presence-based selection and an explicit fallback or skip choice. Pending requests retain their resolved targets after restart, and cleanup uses prior destinations. Saved methods have a read-only target preview followed by an explicit test request. Isolated tests cover the action mappings and presence behavior; provider-specific voice controls and live-provider trials remain follow-up work.

## Next

- Backup failures and overdue automatic backups. Use Home Assistant's [backup events and timestamps](https://www.home-assistant.io/integrations/backup/) to report a failed attempt with its reason, or a successful backup that is overdue for the owner's chosen interval. Link to Backups and define what evidence ends each issue. Discover the relevant entities rather than assuming their names.
- Health of the machine running Home Assistant. Cover low disk space, sustained CPU load, memory and swap pressure, I/O stalls, and high processor temperature using available [System Monitor](https://www.home-assistant.io/integrations/systemmonitor/) entities. Include reported power-supply or undervoltage problems where supported, such as the [Raspberry Pi power checker](https://www.home-assistant.io/integrations/rpi_power/). Prefer pressure measurements that show work waiting for resources where available. Identify whether a measurement describes the host, container or virtual machine, and use thresholds appropriate to that source and hardware. Require sustained evidence and a defined recovery condition; missing measurements remain missing evidence. Each issue should show the measurement and a useful next step.
- Recurring Home Assistant runtime errors that don't become Repairs. Explore selected integration polling and automation execution errors through [System Log events](https://www.home-assistant.io/integrations/system_log/). Group repeated occurrences, retain their count and latest evidence, and start with actionable patterns and summary reporting. Define recovery before implementation; a quiet log alone doesn't prove that the problem ended.
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
- A Snooze button on phone notifications.
- More ways to set up alerts: a guided menu of common alerts in Homeostatic, and alerts for one-off events that have no start and end. The condition itself stays in a Home Assistant automation.
- More from TopoMation, such as occupancy and automation context.
- A full history that records every setting change, control and notification, beyond the ended issues History keeps now.
- Suggestions for tidying up settings when you've built up many single-entity rules.

These are ideas under consideration, with no commitment yet:

- Consumables and scheduled maintenance, starting with one kind that has reliable data.
- Grouping maintenance into tasks with a list of supplies, once quantities can be trusted.
- Showing maintenance in Home Assistant's own screens, if Home Assistant offers a supported way to do it.
- Problems reported by other tools, where they say clearly when a problem starts and ends.
- Looking up supplies information, like which battery a device takes, from an outside source.

Maintainers: the reasons behind current behavior and these plans are in the [decision records](adr/README.md).
