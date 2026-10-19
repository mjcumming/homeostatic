# Roadmap

What Homeostatic does today, what's being worked on next, and what's further out. Last updated October 19, 2026.

## What works now

- One list of supplied and user-created policies. Each has a fixed monitoring type, a source selection, optional overlaps with other policies, and its own notifications. Policies can be duplicated, disabled, deleted and restored.
- Fresh setup watches integration availability, Home Assistant Repairs, automations that name missing entities, and entities an integration has stopped providing. Entity availability is split in two: **Important equipment availability** (cameras, locks, alarm panels, and smoke, carbon monoxide, gas and leak detectors) uses Immediate, and **General entity availability** covers everything else in the morning summary. Notifications start off and have no destinations.
- A failed integration becomes one issue that lists the equipment it affects, and each affected source keeps its own notifications. Failures under a working integration stay separate issues.
- Batteries (a 20% threshold, low warnings and charging), UPS conditions from NUT and APC UPS Daemon, vacuum errors, temperature limits and thermostat progress. These start off or need configuring.
- Six editable named notifications: Immediate, Immediate with acknowledgment, Urgent, and Morning, Evening and Weekly summaries. Each has its timing, a collection delay that bundles requests arriving together, and delivery methods for phones, speakers, email, SMS and other Home Assistant notify routes, with optional presence-based choices and an explicit test.
- Open issues and Monitoring group issues by device and share one device dialog for acknowledging, pausing notifications and stopping monitoring. History keeps the last 100 ended issues from the past 30 days.
- Alerts from your own automations through `homeostatic.report_alert`, sent through the named notification each alert picks.
- Events for your own automations, a card for each panel page, a ready-made dashboard, and optional TopoMation grouping in Monitoring.

The [manual](guide.md) covers setup and everyday use, and [Troubleshooting](troubleshooting.md#what-homeostatic-cant-tell-you) lists what Homeostatic can't tell you.

## Current work

- Remove the 1.10.0 configuration reset and the 1.11.0 device-policy conversion, with their upgrade notes. Both have run on the household installation.
- Jammed locks are the next policy addition, specified in [proposed ADR 0075](adr/0075-report-jammed-locks.md). Implementation hasn't started.

## Next

- Qualify save and refresh performance under sustained household load.
- Bound large issue event payloads so Home Assistant Recorder can retain them. The local pilot reports that some `homeostatic_episode` events exceed its 32,768-byte limit. Resolve it without silently dropping the evidence exposed by issue queries.
- Backup failures and overdue automatic backups. Use Home Assistant's [backup events and timestamps](https://www.home-assistant.io/integrations/backup/) to report a failed attempt with its reason, or a successful backup that is overdue for the owner's chosen interval. Link to Backups and define what evidence ends each issue. Discover the relevant entities rather than assuming their names.
- Health of the machine running Home Assistant. Cover low disk space, sustained CPU load, memory and swap pressure, I/O stalls, and high processor temperature using available [System Monitor](https://www.home-assistant.io/integrations/systemmonitor/) entities. Include reported power-supply or undervoltage problems where supported, such as the [Raspberry Pi power checker](https://www.home-assistant.io/integrations/rpi_power/). Prefer pressure measurements that show work waiting for resources where available. Identify whether a measurement describes the host, container or virtual machine, and use thresholds appropriate to that source and hardware. Require sustained evidence and a defined recovery condition; missing measurements remain missing evidence. Each issue should show the measurement and a useful next step.
- Recurring Home Assistant runtime errors that don't become Repairs. Explore selected integration polling and automation execution errors through [System Log events](https://www.home-assistant.io/integrations/system_log/). Group repeated occurrences, retain their count and latest evidence, and start with actionable patterns and summary reporting. Define recovery before implementation; a quiet log alone doesn't prove that the problem ended.
- Battery checks tested against real devices. The checks are released. The next step is to compare them with real battery and charging reports and refine what a battery issue tells you to do.
- A view for household members who aren't administrators. The panel is administrator-only today, and the permissions design comes before any change.

## Later

Evaluate additions against the [product scope](product-specification.md#product-scope): prioritize Home Assistant and equipment problems, and require a common household need for other built-in policy types. Specialized conditions belong in Home Assistant automations.

- Standard reported conditions have separate proposed decisions: [problem sensors](adr/0076-report-problem-sensors.md), [lawn mower errors](adr/0077-report-lawn-mower-errors.md), [tamper](adr/0078-report-tamper-sensors.md), [unsafe conditions](adr/0079-report-safety-sensors.md), [water leaks](adr/0080-report-moisture-sensors.md), [smoke](adr/0081-report-smoke-sensors.md), [gas](adr/0082-report-gas-sensors.md), [carbon monoxide](adr/0083-report-carbon-monoxide-sensors.md) and [triggered alarms](adr/0084-report-triggered-alarms.md). Each identifies its audience, useful response, selection requirements and recovery evidence. Implementation has not started. Problem sensors follow jammed locks in priority; the other proposals have no committed implementation order. Completion requires the policy editor and observation mapping, executable lifecycle and mocked notification scenarios, and specification, guide and changelog updates. Proposed notification defaults remain subject to review.
- Device availability reported by integrations themselves. Home Assistant has a proposal for integrations to report device availability directly. Homeostatic already follows that model and will read those reports once Home Assistant ships them.
- Consider checks for stale readings or stalled detectors only where a common monitoring need and reliable evidence justify a built-in policy. Each proposal needs recordings from real devices of normal running, failure and recovery. Individual command-completion checks, including whether a cover reached a commanded position, stay outside the built-in scope and belong in Home Assistant automations.
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
