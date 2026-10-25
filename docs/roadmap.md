# Roadmap

Remaining product outcomes and verification work. Last reviewed October 25, 2026. The maintainer selects implementation priority; list order alone does not select the next task.

## Current work

The selected outcome is publication of Homeostatic 1.13.0: jammed-lock checks, left-open monitoring and nine standard reported-condition policies through the existing editor and notification workflow. The [changelog](../CHANGELOG.md#1130---2026-10-25) describes the features and upgrade behavior. The [release-readiness receipt](performance/condition-policies-readiness-2026-10-25.json) records the documentation review and isolated packaged-install rehearsal. Publication awaits the versioned candidate's CI, metadata checks and verified archive.

The household remains on the local working-tree trial based on 1.12.5. The [opening and lock trial](performance/left-open-trial-2026-10-25.json), [hours-control check](performance/left-open-radio-2026-10-25.json) and [condition-policy installation](performance/reported-conditions-install-2026-10-25.json) record the tested contents, saved-setting preservation, restart and live editor checks. The maintainer accepted the UI; that installation has little representative equipment for the nine new conditions, whose behavior is covered in isolated Home Assistant. This release does not update the household installation or request test notifications.

Existing automation-defined problem alerts are implemented, and the maintainer reports that they work on the local Home Assistant. The [alert scenarios](../tests/test_automation_alerts.py) cover registration, current-default notification routing, active/clear/unknown evidence, reload, retirement and phone acknowledgment. Further alert work needs a specific missing user task.

<a id="what-works-now"></a>
<a id="coherent-product-specification-and-uiux-redesign"></a>

The [manual](guide.md) and [specification](spec.md) describe current capabilities and interface behavior. The [changelog](../CHANGELOG.md) records shipped changes, the [decisions](adr/README.md) record rationale, and dated [validation receipts](performance/) retain trial and release evidence. Earlier receipts describe their recorded candidates and dates; their incomplete checks or local-only status do not establish current unfinished work.

## Next

### Other planned work

These are planned outcomes awaiting selection. Each still needs implementation and verification of the user workflow described here.

- Backup failures and overdue automatic backups, monitored through a separate policy type from Updates. Use Home Assistant's [backup events and timestamps](https://www.home-assistant.io/integrations/backup/) to report a failed attempt with its reason, or a successful backup that is overdue for the owner's chosen interval. Link to Backups and define what evidence ends each issue. Discover the relevant entities rather than assuming their names.

- Health of the machine running Home Assistant. Cover low disk space, sustained CPU load, memory and swap pressure, I/O stalls, and high processor temperature using available [System Monitor](https://www.home-assistant.io/integrations/systemmonitor/) entities. Include reported power-supply or undervoltage problems where supported, such as the [Raspberry Pi power checker](https://www.home-assistant.io/integrations/rpi_power/). Prefer pressure measurements that show work waiting for resources where available. Identify whether a measurement describes the host, container or virtual machine, and use thresholds appropriate to that source and hardware. Require sustained evidence and a defined recovery condition; missing measurements remain missing evidence. Each issue should show the measurement and a useful next step.

- Recurring Home Assistant runtime errors that don't become Repairs. Explore selected integration polling and automation execution errors through [System Log events](https://www.home-assistant.io/integrations/system_log/). Group repeated occurrences, retain their count and latest evidence, and start with actionable patterns and summary reporting. Define recovery before implementation; a quiet log alone doesn't prove that the problem ended.

- A view for household members who aren't administrators. The panel is administrator-only today, and the permissions design comes before any change.

### Verification questions

- New automation-alert configuration: check how a newly created outgoing alert obtains its notification choices through the current interface before proposing a setup change. Saved alert reporting remains supported, and current-default delivery works without an alert-specific mapping. The [interface reference](reference.md#reporting-choices) distinguishes those paths. No blocked user task has been reproduced in this reconciliation. Any change must preserve working alerts, saved reporting choices and the public reporting action, and reuse the current notification workflow.
- Battery checks are released. Compare their behavior and issue wording with real battery and charging reports; identify a concrete discrepancy before changing detection.
- Additional live-provider trials beyond the confirmed iPhone test remain possible follow-up work. Missing trial coverage is not evidence of a delivery failure. Request a live test only when separately authorized.

## Deferred

- A broad audit across Home Assistant entity fault contracts and automatic deduplication of Repairs with direct checks are deferred. Possible overlap is acceptable for now. Continue checking each signal's meaning and recovery evidence when adding or changing a policy; revisit broader work when normal use exposes misleading reports or disruptive duplication. Reconsider a direct check if Home Assistant provides reliable equivalent Repair coverage. The [state reference](home-assistant-states.md#how-homeostatic-reads-each-signal) records the relevant contract differences and current severity handling.
- Editor replacement after reconnect: draft text survives, but the `updates.retention` browser case fails its same-input assertion and records a native Home Assistant subscription diagnostic. The [editor receipt](performance/editor-state-2026-10-24.json) and earlier [baseline comparison](performance/notification-payload-fix-2026-10-23.json) preserve the evidence. The maintainer has deferred this edge case; revisit if normal use shows lost work or disruptive editing behavior.
- Extreme machine-event sizes: compact phone requests and short report links are released, while a 1,000-member machine event can still exceed Recorder's retention limit. Complete issue membership remains intact. Guaranteed retention would require a separate versioned event-contract decision. The [payload receipt](performance/notification-payload-fix-2026-10-23.json) records this limit separately from notification delivery. Further investigation is deferred.
- Household performance was accepted after the October 23 review. Further optimization needs a reproduced problem. Historical measurements and intermediate open questions in [Save performance](save-performance.md) and the receipts do not create new optimization tasks by themselves. Safari is outside the planned acceptance scope.

## Later

Evaluate additions against the [product scope](spec.md#product-scope): prioritize Home Assistant and equipment problems, and require a common household need for other built-in policy types. Specialized conditions belong in Home Assistant automations.

- Optional Updates reporting, below jammed-lock monitoring in priority. A supplied Updates policy could report available updates through the existing weekly notification workflow, with links to the corresponding updates in Home Assistant. The owner reviews and performs the work there. Backup monitoring remains separate. This is a convenience feature; update availability alone does not establish a warning or error.
- Device availability reported directly by integrations. Revisit when Home Assistant exposes a documented API; verify Core behavior and available evidence before implementation.
- Consider checks for stale readings or stalled detectors only where a common monitoring need and reliable evidence justify a built-in policy. Each proposal needs recordings from real devices of normal running, failure and recovery. Individual command-completion checks, including whether a cover reached a commanded position, stay outside the built-in scope and belong in Home Assistant automations.
- A watchdog that runs outside Home Assistant, so you hear about it when Home Assistant itself stops.
- Watching every entity on very large installs, 6,000 or more. This needs testing under real household load on the hardware people actually run.
- Reconsidering household functions if a clear use case and a useful setup workflow emerge. Their stored definitions are dormant.
- A Snooze button on phone notifications.
- A guided menu of common problem alerts, if it makes setup easier. Detection and recovery logic stay in Home Assistant automations.
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
