# ADR 0113: Report actionable Home Assistant host-health problems

**Status:** Accepted
**Date:** 2026-10-26
**Settings decision:** 2026-10-31

## Context

Home Assistant can become unreliable when its storage fills, its workloads wait for resources, its processor overheats, or its power supply is inadequate. An owner needs to know when a sustained condition calls for attention, what Home Assistant actually reported, and where to investigate. A stream of normal utilization readings or brief spikes does not serve that task.

This decision defines the first host-health outcome. It follows the [product scope](../spec.md#product-scope), the [ordinary policy lifecycle](0058-unified-policy-lifecycle.md), [shared notifications](0066-reusable-notifications-own-timing-and-delivery.md), and the [preserving upgrade contract](0107-add-new-supplied-policies-disabled-on-upgrade.md).

## Decision

### Conditions worth reporting

Start with low available storage and sustained CPU, memory and storage I/O pressure, where a source can provide meaningful evidence. Report each distinct condition with the affected source, current measurement and units, configured limit, how long the condition has persisted, and a useful next step. Do not diagnose a failed drive, insufficient RAM or a particular process from pressure alone. Different conditions may have different actions and should remain distinguishable even when notifications group them.

Keep the initial set small. Installations vary, and a useful check does not need to cover every hardware platform or every possible failure. If a trustworthy source is unavailable, leave that condition unmonitored and make the limitation clear where the owner configures or reviews it. Do not add a utilization-based substitute, extra categories, or special-case hardware handling merely to make every installation fit.

Consider processor temperature as part of this outcome using the existing [temperature-limit policy](0053-configurable-temperature-limit-checks.md) wherever it meets the task. Hardware-specific limits and useful setup must be established before adding a separate check. Do not create a second policy solely to duplicate the existing comparison and notification workflow.

Use reported power faults through existing supported checks where they meet the task. The Raspberry Pi power checker provides a problem-class binary sensor and creates a Home Assistant Repair for undervoltage ([documentation](https://www.home-assistant.io/integrations/rpi_power/), [Core 2026.10.0](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/rpi_power/binary_sensor.py)). Homeostatic already monitors problem-class sensors and Repairs. Verify actual coverage and possible duplicate reports before adding another power check; do not claim all hardware has an equivalent source.

Backup failure and overdue backups remain a separate outcome. A host-health check does not establish that backups work. A stopped Home Assistant cannot report its own outage; an external watchdog remains separate. Host health does not repair equipment, stop workloads, delete files, change configuration, or guarantee machine or physical-device health.

### Source evidence and setup

Use supported Home Assistant entities as evidence, starting with [System Monitor](https://www.home-assistant.io/integrations/systemmonitor/). Its documented sensors include disk free and usage, CPU, memory, swap, processor temperature, and CPU, memory and I/O pressure averages. Pressure Stall Information reports the share of time tasks are stalled on a resource; it is evidence of waiting, not the cause of the wait. Prefer a validated pressure source to a utilization-only alert when both address the same concern. Memory utilization, CPU utilization and swap usage can add context where available; a high value alone is not an automatic host-health issue under this decision.

System Monitor entities are disabled by default, and some measurements depend on the environment and hardware. Disk sensors describe mount points, not individual directory sizes. Processor temperature may be absent in a virtual machine. Show the source and the scope it actually establishes: host, virtual machine, container or an unidentified scope. Do not infer that a mount is Home Assistant's data storage, or that a reading covers the physical host, from its name, integration or discovery order alone. Require confirmation where the source's role or scope cannot be established. An absent, disabled or unsupported source is a coverage gap, not a healthy reading or an automatic host failure.

Reuse the Policies workflow for source selection and condition settings, and the existing notification assignments for timing and destinations. Reuse the issue and source views for evidence and the next action. Add no separate metrics dashboard or notification configuration. Apply the [UI purpose test](../spec.md#purpose-before-controls) to any proposed controls. Preserve editable and deleted policies, notification choices and pending delivery identities; introduce any genuinely new supplied policy once and disabled on existing installations under ADR 0107. A fresh-install policy requiring source selection or detection settings cannot be enabled until those requirements are met.

### Qualification and recovery

Each issue requires a current usable reading that remains on the problem side of its selected limit for a defined interval. Brief excursions and ordinary startup or maintenance work should not generate repeated issues. A normal current reading before qualification cancels the pending interval; a required evidence gap also breaks that interval. Acknowledgment changes attention, not the underlying condition.

An established issue remains open until current usable evidence satisfies its defined recovery condition. Missing, unavailable, unknown, restored, nonnumeric, nonfinite or unsupported-unit evidence establishes neither a problem nor recovery. Restart or reload discards unfinished qualification, while established issues and eligible delivery identities follow the existing persistence contract. Removing a source or disabling or deleting a policy ends monitoring through the ordinary lifecycle without asserting that the host recovered. Detection changes and renames follow existing policy identity rules.

Choose recovery waits or separate thresholds only when they make a concrete condition less noisy and can be explained. They must not be introduced into the existing temperature-limit policy in conflict with ADR 0053. Define exact equality, units, source selection, intervals and recovery rules for each new check before implementation. Repeated evaluation of a cached state cannot establish physical freshness.

### Configurable starting settings

Use the following configurable starting points for the four disabled policies. Hardware, available storage and workloads vary, so no single set of limits can establish what is actionable on every installation. Owners select the relevant source and can adjust the problem and recovery limits and waits before enabling a policy. These are Homeostatic starting points, not Home Assistant standards or guarantees of early detection. A PSI average is already smoothed; the additional qualification interval tests whether the reported average stays elevated. Avoid more settings or severity tiers unless the owner has a concrete use for them.

| Condition and source | Starting setting to open | Starting setting to clear |
| --- | --- | --- |
| Available space on the selected relevant mount | Below 5 GiB for 30 minutes | Above 6 GiB for 30 minutes |
| Memory PSI full, 300-second average | Above 5% for 10 minutes | Below 2% for 10 minutes |
| I/O PSI full, 300-second average | Above 5% for 15 minutes | Below 2% for 10 minutes |
| CPU PSI some, 300-second average | Above 20% for 15 minutes | Below 10% for 10 minutes |

The 5 GiB storage setting provides a margin above the 2 GiB minimum used by certain Supervisor jobs on its data directory ([threshold](https://github.com/home-assistant/supervisor/blob/2026.09.0/supervisor/resolution/const.py), [job check](https://github.com/home-assistant/supervisor/blob/2026.09.0/supervisor/jobs/decorator.py), [measured directory](https://github.com/home-assistant/supervisor/blob/2026.09.0/supervisor/host/info.py)). It does not guarantee that an individual backup or update fits and may be unsuitable for small storage. The [kernel PSI definitions](https://docs.kernel.org/accounting/psi.html) describe pressure without prescribing these thresholds. The [household recording](../performance/host-health-observations-2026-10-31.json) supports the settings as quiet during the observed period on one installation; it did not exercise a real failure or establish useful limits for other systems. No universal processor-temperature limit is selected.

System Monitor's registry platform and translation keys distinguish `disk_free`, `memory_pressure_full_avg300`, `io_pressure_full_avg300` and `cpu_pressure_some_avg300` in Home Assistant 2026.9.3; select actual enabled entities rather than relying on their editable entity IDs or names. The owner must explicitly choose each source and confirm the storage mount. Source scope remains unidentified unless supported evidence establishes it.

### Ownership

Homeostatic owns Home Assistant source discovery and interpretation, configuration, timers, I/O and persisted producer state. The adapter reads the clock and passes UTC times into health-tree. Producers use the existing ordered observation path. Health-tree owns dependency, issue and attention decisions through its public APIs; snapshots are opaque persistence data. Review the existing health-tree contracts before implementation and identify any necessary library change in both repositories. This decision does not presume one is needed.

The chosen System Monitor identities and units are recorded in [Home Assistant states](../home-assistant-states.md). PSI `some` and `full` have distinct meanings and do not establish an outage or cause. Product feedback and additional recordings can inform future starting settings without changing an existing owner's saved choices.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) tracks progress. Validate the complete owner workflow and add executable scenarios for each implemented condition, including:

- Eligible and ineligible sources, disabled and missing entities, correct units and mount identity, source scope and ambiguous mappings; no selection by entity name alone.
- Exact threshold and duration boundaries, normal startup and short spikes, sustained pressure or low space, recovery and renewed problems, and any justified recovery buffer.
- Unknown, unavailable, restored, invalid, unsupported-unit and missing evidence during qualification and while open; restart and reload, detection edits, source removal, policy deletion and acknowledgment.
- Clear, actionable evidence and next steps without claiming a specific cause; existing temperature, problem-sensor and Repair workflows and any overlapping findings.
- Existing notification assignments, global sending off, mocked direct and optional consumer delivery, queued observations during I/O, and stable pending delivery identities on replay.
- Fresh setup and preserving upgrade, including repeated reloads, saved edits, deletion, destinations, sending choices and introduced policies. Verify a migration before changing any published configuration or stored state.

Test with isolated Home Assistant and mocked services. Validate source interpretations against Home Assistant documentation and Core. Never send a test notification through the household installation without separate authorization. Update the current specification, user guide, event documentation where applicable and changelog with the implemented behavior.
