# Defaults and settings

## Monitoring types

| Type | Watches | Problem | Ends when | New installation |
| --- | --- | --- | --- | --- |
| Integration availability | Integration connections | Setup keeps failing or retrying, or Home Assistant asks you to sign in again | It loads normally for the recovery wait | **Integrations**: on, Morning summary |
| Entity availability | Enabled entities; diagnostic and configuration entities only when picked individually | Home Assistant reports it unavailable | Any other state lasts for the recovery wait | **Important equipment availability**: on, Immediate. **General entity availability**: on, Morning summary |
| Entities not provided | Enabled registered entities, including diagnostic and configuration ones | Its integration is loaded but hasn't provided it for the wait | Home Assistant reports a live state | **Entities not provided**: on, 24-hour wait, Morning summary |
| Low battery | Battery level sensors and low-battery warnings | Level at or below the threshold, or a low warning | Every reading is normal, or the battery reports charging | **Batteries**: off, 20%, Morning summary |
| Vacuum error | Vacuums | Error activity | Cleaning, docked, idle, paused or returning | **Vacuums**: off, Evening summary |
| Repairs | Home Assistant Repairs other than Homeostatic's own | An active Repair | The Repair is fixed or ignored | **Repairs**: on, Morning summary |
| Broken automations | Automations that name entity IDs | An automation names an entity that doesn't exist | The entity exists again, or the automation no longer names it | **Broken automations**: on, Morning summary |
| Temperature limits | Temperature sensors in °C, °F or K | Below or above your limit for your duration | A reading within the limits | You add it; Immediate with acknowledgment |
| Thermostat progress | Thermostats in heat, cool or heat_cool mode | Stalls short of its target for the progress window, or moves away from it | The temperature reaches the allowed margin | You add it; 2 °F margins, 3600-second window, Urgent |
| UPS backup power | UPS devices from NUT or APC UPS Daemon | Running on backup power | Back on mains for the recovery wait | You add it; Urgent |
| UPS low reserve | The same | A low-reserve warning, or charge or runtime at your threshold | All readings recover and the warning clears, for the recovery wait | You add it; Morning summary on mains, Immediate with acknowledgment on backup |
| UPS battery replacement | The same | A replace-battery warning | The warning clears for the recovery wait | You add it; Morning summary |
| UPS faults | The same | A reported fault or NUT bypass | The fault clears for the recovery wait | You add it; Urgent |

For availability, a current `unknown`, `off` or `idle` state counts as available. A missing state, or one restored at startup, can't show recovery, so the issue stays open until Home Assistant reports a real state.

## Named notifications

| Name | Timing | Collection delay | Used by |
| --- | --- | --- | --- |
| Immediate | Immediately, day or night | 60 seconds | Important equipment availability |
| Immediate with acknowledgment | Immediately, then every 30 minutes until acknowledged | 5 seconds | Temperature limits; UPS low reserve on backup |
| Urgent | Daily from 08:00 to 22:00 | 60 seconds | Thermostat progress; UPS backup power and faults |
| Morning summary | Daily at 08:00 | None | Integrations, general entities, entities not provided, Repairs, broken automations and batteries; UPS battery replacement, and low reserve on mains |
| Evening summary | Daily at 18:00 | None | Vacuums |
| Weekly summary | Sundays at 08:00 | None | Nothing at first |

They all start without a delivery method, and the **Notifications** switch starts off. Times use Home Assistant's time zone. Daily hours can cross midnight; the start time is included and the end time isn't.

## Delivery types

| Delivery type | Needs | Extras |
| --- | --- | --- |
| App notification | A phone with the Companion app and notifications allowed | Taps open the issue, messages update and clear, and an **Acknowledge** button |
| Speaker announcement | An Assist satellite that can announce, or a media player with a text-to-speech provider | |
| Email | An email notify service, such as SMTP | |
| SMS | A recognized SMS notify service and a phone number of 5 to 15 digits, optionally starting with `+` | |
| Other notification | Any other notify entity or action | |

## Issue controls

| Control | Effect |
| --- | --- |
| Acknowledge | Records that someone has seen the issue. Stops reminders that wait for acknowledgment; summaries still include it. |
| Pause | Holds every notification about the issue, for everyone, for 1, 4 or 24 hours. Pausing again extends it. |
| Resume | Ends a pause early. |
| Stop monitoring | Excludes the entity from its availability policies. Other checks continue. |
| End maintenance | Ends a maintenance window early. |
| Notifications switch | Turns sending on or off for the whole installation. Monitoring continues. |

## Installation timing

Open **Settings** from the panel header. The first three are shown directly, and the rest are under **Advanced timing**. Zero removes a wait.

| Setting | Default | What it does |
| --- | --- | --- |
| Report setup problems after | 2 min | How long an integration can keep retrying setup before it's reported |
| Clear recovered issues after | 2 min | The recovery wait: how long restored availability must last before its issue ends |
| Wait after Home Assistant starts | 2 min | Holds new issues and notifications while Home Assistant starts |
| Wait for related failures | 2 min | Gives a failure that another failure might explain time to settle before it gets its own issue |
| Wait for unknown evidence | 15 min | How long a check waits before treating missing evidence as stale |
| Allow reconnecting devices | 1 min | Time for devices to come back after their integration recovers |
| Maximum startup wait | 10 min | The longest notifications wait for integrations to load after Home Assistant starts |

## Limits

| Item | Limit |
| --- | --- |
| History | The last 100 ended issues from the past 30 days |
| Pauses and maintenance windows | Up to 7 days through the `homeostatic.shelve` and `homeostatic.start_maintenance` actions |
| Phone **Acknowledge** buttons | Work for 30 days; the latest 2,000 are kept |
| Full recheck of registries, Repairs and integrations | Every 15 minutes, as well as whenever Home Assistant reports a change |
