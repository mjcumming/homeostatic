# Notification and control settings

[Homeostatic manual](../guide.md)

This page lists notification choices, delivery capabilities, temporary controls and installation-wide settings. For the setup procedure, see [set up and change notifications](notifications.md). Source eligibility and detection settings belong in the [monitoring reference](monitoring-reference.md).

## Named notifications

These are the six editable choices supplied with a fresh setup. All start without delivery methods, and the global **Notifications** switch starts off. Updates preserve supported saved choices, including edited names, custom assignments, deleted definitions and policies with no notifications.

| Supplied name | Starting timing | Supplied policy assignments |
| --- | --- | --- |
| Immediate | Eligible requests collect for 60 seconds, including overnight | Important equipment availability |
| Immediate with acknowledgment | Eligible requests collect for 5 seconds, then reminders every 30 minutes until acknowledged or the problem ends | Temperature-limit templates; UPS low reserve on backup power |
| Urgent | Every day from 08:00 to 22:00, with a 60-second collection delay | Thermostat, UPS backup-power and UPS fault templates |
| Morning summary | Every day at 08:00, with no extra delay | General entity and integration availability, Entities not provided, Repairs, broken automations and batteries; UPS battery replacement and low reserve on mains power |
| Evening summary | Every day at 18:00 | Vacuums |
| Weekly summary | Sunday at 08:00 | Available to select |

All eight supplied policies, including Batteries and Vacuums, are enabled on fresh setup. Temperature, thermostat and UPS templates still require configuration. An assignment does not enable a disabled policy or complete its required source and detection setup. Restoring a supplied policy uses its default notification only if that notification still exists. It does not recreate a deleted notification or select destinations.

The notification editor provides these settings:

| Field | Accepted choice and effect |
| --- | --- |
| Name | A nonempty name for the shared notification. Renaming preserves its assignments. |
| When to notify | **Immediately**, **Immediately, with acknowledgment**, **During daily hours** or **Scheduled summary**. |
| Collection delay (seconds) | A whole number at least 0. Wait this long to combine requests using this notification. Later requests don't extend the wait. Zero sends without waiting. Hidden for scheduled summaries, which have no additional delay. |
| Remind every (minutes) | A whole number of minutes, at least 1. Shown for acknowledgment reminders. |
| Start and End | Distinct local times. Shown for daily hours. The start is included; the end is excluded. A window can cross midnight. |
| Summary time and Days | One local time and at least one weekday. Shown for scheduled summaries. |
| Send using | One or more saved delivery methods. An empty selection sends nothing. |

Scheduled times use the Home Assistant installation time zone displayed in the editor and follow its daylight-saving rules. During daily hours, still-eligible requests start collecting when hours open. If the collection deadline falls after closing, sending waits for the next opening without another collection delay. Requests are dropped if the problem ends first. Scheduled summaries include eligible open problems even after immediate delivery or acknowledgment. Empty summaries are skipped.

## Delivery destinations

A method may combine several destinations and delivery types. Configure the supporting integration in Home Assistant before selecting it in Homeostatic. Only available supported types appear for new selections; a saved destination that becomes unavailable remains visible so it can be repaired or removed.

| Delivery type in the picker | Required Home Assistant destination | Homeostatic capabilities |
| --- | --- | --- |
| App notification | A registered Companion app phone with push notifications | Issue links, replacement and clearing of messages, and an Acknowledge action on active individual, device or collected messages |
| Speaker announcement | An Assist satellite that supports announcements, or a media player that supports media playback with an available text-to-speech provider | Spoken message; choose the speaker first, then a provider when several are available |
| Email | A recognized email notification entity or action, such as a configured SMTP route | New message through the configured route |
| SMS | A recognized SMS action with a recipient number | New message to that number; the picker accepts 5–15 digits, optionally beginning with `+` |
| Other notification | A supported notification entity or registered notification action | New message using that route's existing configuration |

Generic notification destinations are not assumed to support email addresses or SMS recipient numbers. Only a recognized SMS route offers a number field. Email, SMS, speech and generic notification routes do not provide Homeostatic's phone acknowledgment or message replacement controls.

**Send test** appears for a saved delivery method with no pending edits. It can send while normal notifications are off, uses the saved presence rules and reports requests, failures or an explicit skip. The result does not confirm receipt.

Presence selection offers **Fixed destinations**, **Home or away** and **People currently home**. Presence-based methods require selected Home Assistant people and either fallback destinations or **Skip notification**. The [notification procedure](notifications.md#choose-destinations-using-presence) describes selection and unknown-presence behavior.

## Scope of saved changes

| Control or editor | What saving changes |
| --- | --- |
| Save policy | That policy's monitoring, detection and notification assignments |
| Save notification | That shared notification's name, timing and selected delivery methods, across its saved policy uses |
| Save delivery method | That method's name, destinations and presence rules, across its saved uses |
| Save settings | Installation timing |
| Notifications switch | Normal sending for the installation; saves independently of editor drafts |

Each editor retains its own pending changes during navigation within the same browser tab. A confirmed save removes its unsaved-change controls when no newer edits remain. Failed or uncertain saves remain visible. Opening, reading and editing do not send messages; saving effective notification changes can make open problems eligible for new requests if sending is on.

## Issue and equipment controls

| Choice | Scope and effect | What continues |
| --- | --- | --- |
| Acknowledge issue | Records awareness of the issue for everyone and stops its acknowledgment-dependent reminders | The issue remains open; other notifications, including scheduled summaries, may continue |
| Pause notifications | Holds new notifications for the whole issue, for everyone, including urgent notifications | Monitoring continues and the issue remains open; existing messages are not dismissed |
| End maintenance | Ends an active equipment maintenance period early; problems still present may become eligible immediately | Existing issues and their notifications continue; other overlapping maintenance periods remain active |
| Remove notification assignments | Removes that policy's outgoing notification choices | Monitoring continues and issues remain visible in Open issues |
| Disable or delete a policy, or remove a source from its selection | Ends the monitoring supplied by that policy or selection | Independent policies keep monitoring their own selections; ending monitoring is recorded separately from recovery |
| Notifications off | Stops normal new issue notifications across the installation | Monitoring and the panel continue; explicit delivery-method tests remain available |

Pauses require an end time in the future, no more than seven days away. The end-time picker uses the browser's local time, identified as **Your local time**. An optional reason may contain up to 500 characters. An existing pause can be extended; use **Resume notifications** to finish it early. Ending one pause leaves other overlapping pauses in force.

See [issue actions](issues.md), [ending active maintenance](maintenance.md) and [policy changes](policies.md) for procedures.

## Installation timing

Open **Settings**. The first three settings are shown directly; the remaining timing controls are under **Advanced timing**. Fields display their units beside the value. Whole-minute saved waits display in minutes; other waits display in seconds. Standard notification batching always displays seconds. Zero removes a wait.

| Setting | Fresh default | Effect |
| --- | --- | --- |
| Report setup problems after | 2 min | An integration that keeps retrying setup becomes a failure after this wait. |
| Clear recovered issues after | 2 min | Requires restored integration, device or entity availability to persist before its issue clears. Condition checks use their own recovery rules. |
| Wait after Home Assistant starts | 2 min | Holds new issues and notifications during Home Assistant startup. Saving panel settings does not start this wait. |
| Wait for related failures | 2 min | Lets an uncertain dependency settle before a device or entity opens a separate issue. |
| Wait for unknown evidence | 15 min | Sets the wait before a check treats missing or uncertain evidence as stale. Availability evidence gaps stay out of Open issues and do not request availability notifications; their unresolved evidence remains in Monitoring. Condition checks use their own evidence rules. |
| Allow reconnecting devices | 1 min | Gives devices and entities time to recover after their failed integration returns. |
| Maximum startup wait | 10 min | Limits how long notifications wait for watched integrations to finish loading after Home Assistant starts. |
| Standard notification batching | 30 sec | Applies to supported Custom standard requests. Named notifications use their own collection delay or scheduled summary time. |

Waits accept nonnegative whole values in the unit shown. There is no separate general delay before a watched failure opens an issue beyond the applicable waits and its policy's detection criteria.

## Retention and fixed limits

| Item | Limit |
| --- | --- |
| History | The latest 100 ended issues from the last 30 days; entries expire when either limit is exceeded |
| Phone Acknowledge actions | Retained for up to 30 days, with the latest 2,000 kept |
| Home Assistant registry recheck | Every 60 seconds, as well as when a registry change is reported |

History includes issues that cleared, ended when monitoring stopped or joined another issue. A missing or expired record cannot establish how a past problem ended. See [review ended problems](history.md) for using the records that remain.
