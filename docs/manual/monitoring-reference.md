# Monitoring types and defaults

[Homeostatic manual](../guide.md)

A monitoring policy selects sources, defines a condition and assigns notifications. Each policy has a fixed **Monitoring type**. These tables describe fresh setup and newly added policies. Saved edits, deleted policies and existing notification choices survive updates.

The named notifications below initially have no delivery methods, and global sending starts off. Their timing and delivery settings are in [Notification and control settings](settings-reference.md). Use [Choose what to monitor](policies.md) to change scope and [Set up and change notifications](notifications.md) to arrange delivery.

## Starting policies and source requirements

| Monitoring type | Eligible source or required evidence | Starting setup | Initial notification |
| --- | --- | --- | --- |
| Integration availability | Eligible Home Assistant integration connections. | **Integrations** is enabled. | Morning summary |
| Entities not provided | Enabled registered entities whose owning integration is loaded but has no live entity, including diagnostic and configuration entities. | **Entities not provided** is enabled, with a 24-hour wait. Existing installations can add or explicitly restore the policy. | Morning summary |
| Entity availability | Enabled operational entities outside the Important equipment selection, including entities without a device. | **General entity availability** is enabled. | Morning summary |
| Entity availability | Enabled operational cameras, locks, alarm panels and smoke, carbon monoxide, gas and moisture binary sensors. | **Important equipment availability** is enabled. | Immediate |
| Low battery | Battery percentage sensors or numbers, or battery-class low-warning binary sensors. An associated charging report supplies context. | **Batteries** is disabled; threshold 20%. | Morning summary |
| Vacuum error | Vacuum entities with a reported activity. | **Vacuums** is disabled. | Evening summary |
| Repairs | Active Home Assistant Repairs, excluding Homeostatic's own Repairs. | **Repairs** is enabled and covers all eligible Repairs. | Morning summary |
| Broken automations | Loaded automations that explicitly name entity IDs. | **Broken automations** is enabled and checks all automations in scope. | Morning summary |
| Temperature limits | Temperature sensors with a usable numeric value and °C, °F or K unit. | Add a policy; starts disabled, with °F and duration 0. Select sources, enter at least one bound and choose the duration deliberately. | Immediate with acknowledgment |
| Thermostat progress | Thermostats with current temperature and valid targets in heat, cool or heat_cool mode. | Add a policy and select sources. Starts disabled, with 2 °F deviation, progress and worsening values and a 3600-second progress window. | Urgent |
| UPS backup power | A recognized NUT or APC UPS Daemon UPS with status and charge or runtime evidence. | Add and configure a policy; starts disabled. | Urgent |
| UPS low reserve | The same UPS evidence, with explicit low warning, readable low setpoints or chosen numeric thresholds. | Add and configure a policy; starts disabled. No universal charge or runtime cutoff is supplied. | Morning summary on mains; Immediate with acknowledgment on backup |
| UPS battery replacement | A recognized UPS status reporting replacement warnings. | Add and configure a policy; starts disabled. | Morning summary |
| UPS faults | A recognized UPS status reporting supported faults or NUT bypass. | Add and configure a policy; starts disabled. | Urgent |

New policy assignments use these named notifications only while the definitions still exist. Repairs and Broken automations cover their complete supported source sets; their editors do not offer individual source selection.

## Availability evidence

Broad availability policies exclude diagnostic and configuration entities. An explicit individual entity selection can opt one into entity availability monitoring. A device with no eligible members has no availability check.

Disabled integrations, devices and entities do not acquire availability issues solely because they are disabled. Their saved monitoring choices apply again when they are enabled. Monitoring can reveal disabled sources for inspection. Homeostatic's own sources and the **Change device type of a switch** helper integration are excluded; the helper's converted entity remains eligible.

| Type | Reported problem | Evidence that ends the condition |
| --- | --- | --- |
| Integration availability | Setup retry, setup or migration error, failed unload, or a request to sign in again. | The connection is loaded without pending reauthentication, followed by the recovery wait. |
| Entity availability | Home Assistant reports unavailable. | A current state other than unavailable, followed by the recovery wait. |

A current **unknown** value, **off** or **idle** still establishes HA availability. Missing states and restored startup values are evidence gaps. They cannot establish recovery. Gap-only availability findings and findings awaiting recovery confirmation stay out of Open issues; their evidence remains in **Monitoring**. See [How issues and notifications work](../how-it-works.md).

## Condition checks

| Type | Reported problem | Evidence that ends the condition | Editable detection fields |
| --- | --- | --- | --- |
| Low battery | Percentage at or below the threshold, or an explicit low warning. | Every monitored low signal is current and normal, or associated charging is currently confirmed. | Percentage threshold from 0 to 100. |
| Vacuum error | The vacuum reports error activity. | Cleaning, docked, idle, paused or returning activity. | None. |
| Repairs | Home Assistant has an active Repair. | Home Assistant removes the Repair, or it is ignored there. | None. |
| Broken automations | An explicitly referenced entity exists in neither Home Assistant's registry nor its current states. | The entity exists again, the automation no longer references it, or the automation is removed. | None. |
| Temperature limits | The reading remains below or above a configured bound for the selected duration. | A usable reading within the configured range, including either boundary. | Unit; optional lower/upper bounds; duration from 0 to 365 days. |
| Thermostat progress | Temperature outside the permitted margin stalls for the progress window or worsens by the configured amount. | Temperature enters the permitted margin, including when a changed target is already satisfied. | Unit; deviation, progress and worsening differences; positive progress window. |
| UPS backup power | Explicit backup operation. | Explicit mains operation and the recovery wait. | None. |
| UPS low reserve | Explicit low warning or a monitored numeric threshold. | All monitored reserve signals recover and the explicit warning clears, followed by the recovery wait. | Optional charge and runtime raise/clear pairs; clear must exceed raise. |
| UPS battery replacement | Explicit replacement warning. | A usable current status clears the replacement warning, followed by the recovery wait. | None. |
| UPS faults | Supported fault flags or NUT bypass operation. | A usable current status clears the mapped condition, followed by the recovery wait. | None. |

Battery, vacuum and temperature checks have no additional recovery wait. Installation startup and notification timing still apply. UPS and availability checks use the configured recovery wait. See [Notification and control settings](settings-reference.md) for those installation timings.

Missing or unusable evidence does not clear an open condition. Temperature gaps and restarts discard pending duration/progress calculations while preserving an already-open issue. Unsupported thermostat modes end the applicable monitoring expectation. Disabling or deleting a policy also ends its monitoring without establishing recovery; [History](history.md) distinguishes those outcomes.

Repairs and broken-automation findings link to the relevant Home Assistant screen. Repairs must be fixed or ignored there. Broken-automation checks do not evaluate template-only entity references, scripts or whether an automation actually ran.

For setup and detailed recovery behavior, use [batteries](batteries.md), [UPS conditions](ups.md), [temperature limits](temperature.md) or [thermostat progress](thermostats.md). [What Homeostatic cannot establish](limitations.md) owns the broader limits of these checks.
