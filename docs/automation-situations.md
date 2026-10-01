# Alerts from automations

An alert tells you about something happening in the house: water on the basement floor, the garage door open after dark, the freezer warming up. Home Assistant decides whether the condition holds. Homeostatic keeps one issue open while it does, notifies people according to the alert's reporting choice, handles Acknowledge, and closes the issue when the condition clears.

Alerts suit conditions that start and later end. A one-off event like "motion detected" has nothing to clear, so it doesn't make a good alert.

The normal way to make an alert is the **Homeostatic alert** blueprint. Writing the automation yourself with the `homeostatic.report_alert` action is the advanced path, for conditions the blueprint can't express.

## Before you start

- Save the people and schedules in **Notifications** once, unless every alert you make uses Dashboard only. You can save them with notifications still off. Until you do, any other reporting preference fails with the error "Configure shared reporting profiles in Homeostatic Notifications first". See [Activate notifications](guide.md#activate-notifications).
- Import the [Homeostatic alert blueprint](https://github.com/mjcumming/homeostatic/blob/main/blueprints/automation/homeostatic/alert.yaml) under **Settings → Automations & scenes → Blueprints**. Or copy `alert.yaml` from the release zip into `blueprints/automation/homeostatic/` in your config folder and reload automations.

## Create an alert with the blueprint

This example opens an issue when the basement leak sensor detects water.

1. Go to **Settings → Automations & scenes → Blueprints** and select **Homeostatic alert**. Home Assistant opens a new automation based on it.
2. Fill in the form:

   | Field | Example | What it's for |
   | --- | --- | --- |
   | Alert name | Basement water leak | The issue's title and the notification title |
   | Notification message | Water detected near the basement water heater. | The notification text while the alert is active. Plain text or a template. |
   | Reporting preference | Immediate with acknowledgment | Who hears about it and when, using the people and schedules in Notifications |
   | Required evidence | Basement water sensor | Every entity the condition or the message reads |
   | Active when | Basement water sensor is Wet | Home Assistant conditions. All of them must hold. Use And/Or blocks for alternatives. |

   Dashboard only is a good first choice while you check that the condition behaves.

3. Save the automation and leave it on.
4. Within a minute, the alert shows up in **Sources** under **Configured situations**, with its reporting preference and an **Edit alert automation** link. If the condition already holds, an issue opens on **Issues**, and a notification goes out if notifications are on and the preference isn't Dashboard only.

To see what the automation reported, open its traces. Each run makes one `homeostatic.report_alert` call with `state` set to `active`, `clear` or `unknown`.

Homeostatic identifies the alert by the automation's saved ID. Renaming the automation, or changing the alert name, message or reporting preference, keeps the same alert and its open issue. Duplicating the automation makes a separate alert. You edit an alert in its automation; Sources shows the settings but doesn't change them.

### Choose the evidence and conditions

Put every entity that the conditions and the message read into **Required evidence**. Before evaluating anything, the blueprint checks each of them. If one is unavailable, unknown, missing, or still showing a value restored at startup, it reports unknown. An entity you leave out gets no such check: a State condition on a dead sensor is simply false, and the alert would report clear.

Use conditions about the current state: State, Numeric state, Sun, Time, Zone or Template. The **Triggered by** condition doesn't work here, because the blueprint runs on its own triggers.

A condition that fails to evaluate, such as Numeric state on a sensor reading `low`, makes the blueprint report unknown. It tests the condition and its opposite separately, so an error never falls through to clear.

## How an alert reports

The blueprint runs when any Required evidence entity changes, when Home Assistant starts, once a minute, and on any extra triggers you add under **Advanced**. Each run sends one report:

| Report | Sent when | What Homeostatic does |
| --- | --- | --- |
| Active | All evidence is usable and the Active when conditions hold | Opens an issue, or keeps the open one. Repeated active reports never open a second issue. |
| Clear | All evidence is usable and the conditions don't hold | Closes the issue at once |
| Unknown | Some evidence isn't usable, or a condition failed to evaluate | Keeps an open issue open. Unknown never closes an issue. |

Only a clear report closes the issue. Acknowledge doesn't, and turning the automation off doesn't.

If an alert stays unknown for longer than **Wait for unknown evidence** in **Settings** (15 minutes by default), Homeostatic raises that as well: an issue opens for the alert with an unknown status, or the open issue is marked stale. A broken alert doesn't go quiet.

### Evidence expiry

Each report stays current for the time set in **Evidence expires after**, under **Advanced** (300 seconds by default, which is also the minimum). If no new report arrives in that time, because the automation was turned off, deleted or broken, the alert turns unknown. This is the maximum age of a report. It doesn't delay alerting: an active report opens the issue immediately, and a clear report closes it immediately.

The blueprint reports every minute, so the default allows for a few missed runs.

### Time windows and restarts

- The once-a-minute run picks up changes that depend only on the time, so a condition like "between 01:00 and 02:00" can start or end up to a minute late. For exact boundaries, add Time triggers at 01:00 and 02:00 under **Exact reevaluation times or other triggers**.
- Leaving a time window clears the alert even if nothing else changed. An alert for the garage door open after dark closes at sunrise whether or not the door is still open. Word the message to say what was true when it fired, and make a second alert without the time window if you need to know the door is still open.
- After Home Assistant restarts, Homeostatic waits for a fresh report. An open issue stays open and shows unknown until the automation reports again, which the blueprint does at startup. Home Assistant's own `for` durations start over after a restart, and Homeostatic can't change that.

The reasons for this design are in [ADR 0034](adr/0034-create-alerts-from-ha-automations.md).

## More examples

| Alert | Required evidence | Active when |
| --- | --- | --- |
| Freezer too warm | Freezer temperature sensor | Numeric state: freezer temperature above -10 |
| Garage open after dark | Garage door, Sun | State: garage door is Open. State: Sun is Below horizon. |
| Window open while everyone's away | Window sensor, each person | State: window is Open. State: each person is Away. |

The blueprint compares current states only. For hysteresis (warm above -10, cool again only below -15) or anything that depends on what happened earlier, build a helper first, such as a Threshold helper or a template binary sensor, and use the helper as the evidence. The helper has to go unavailable or unknown when its source does. [Alert on a device's own diagnostic sensor](how-to-local-health-signals.md) shows a template that does this.

## Write the automation yourself

Use the `homeostatic.report_alert` action directly when the blueprint can't express the condition, when an automation you already have works the condition out, or when one automation reports several conditions. In the automation editor it's **Homeostatic: Report alert**.

Your automation takes on the work the blueprint does:

- It must be saved with an ID. Automations made in the UI always are. A YAML automation needs an `id:`.
- It reports when Home Assistant starts, whenever the condition may have changed, and again before the last report expires.
- It reports `clear` only when it has seen the condition end, and `unknown` whenever it can't tell.
- It's the only automation reporting that alert, and its runs don't overlap. Use `mode: queued` or `mode: single`.

This automation reports the freezer alert from the examples above:

```yaml
alias: Freezer too warm
id: freezer_too_warm
mode: queued
triggers:
  - trigger: state
    entity_id: sensor.freezer_temperature
  - trigger: homeassistant
    event: start
  - trigger: time_pattern
    minutes: "*"
actions:
  - variables:
      reading: "{{ states('sensor.freezer_temperature') }}"
      report: >-
        {{ 'unknown' if not is_number(reading)
             or state_attr('sensor.freezer_temperature', 'restored')
           else 'active' if reading | float > -10
           else 'clear' }}
  - action: homeostatic.report_alert
    data:
      automation: "{{ this.entity_id }}"
      alert_key: freezer_warm
      name: Freezer too warm
      message: "The garage freezer is at {{ reading }} °C."
      profile: acknowledge
      state: "{{ report }}"
```

| Field | Required | What to put |
| --- | --- | --- |
| `automation` | Yes | The automation that owns the alert. Use `{{ this.entity_id }}`. |
| `alert_key` | No | A stable name for the condition. Defaults to `default`. Give each condition its own key when one automation reports several. Don't use the message or anything else that changes. |
| `name` | Yes | The alert name |
| `message` | Yes | The notification text. Homeostatic uses it only with `active`, so it can be empty for the other states. |
| `profile` | Yes | The reporting preference: `immediate`, `acknowledge` (Immediate with acknowledgment), `morning`, `evening`, `weekly` or `dashboard` (Dashboard only) |
| `state` | Yes | `active`, `clear` or `unknown` |
| `report_timeout` | No | Seconds before the report expires. Defaults to 300. Make it longer than the gap between your reports. |
| `adopt_situation_id` | No | Only for converting an older alert. See [Convert and keep the open issue](#convert-and-keep-the-open-issue). |

The action returns the alert's `reporting_status`: `configured`, `dashboard_only`, `requests_disabled` (notifications are off) or `missing_destinations` (nobody is set up for that preference in Notifications). An alert with missing destinations still opens issues; it just doesn't notify anyone. The [reference](reference.md#homeostaticreport_alert) has the field limits and the rest of the response.

### If a report fails

A rejected report stops that automation run, and the error appears in its trace:

| Error | What to do |
| --- | --- |
| Choose a saved HA automation with a stable ID | Save the automation, or add an `id:` to a YAML automation |
| Configure shared reporting profiles in Homeostatic Notifications first | Save the people and schedules in Notifications, or use Dashboard only |
| This alert is retired; explicitly resume it before reporting | Resume the alert, or turn the automation off. See [Retire an alert](#retire-an-alert). |
| Automation alert capacity reached | The installation has 1000 active automation alerts. Retired ones don't count. |

## Retire an alert

Retiring an alert tells Homeostatic to stop watching it while you keep its automation. If you delete the automation instead, Homeostatic removes the alert on its next refresh, and you don't need to retire it.

1. Go to **Developer tools → Actions** and choose **Homeostatic: Manage automation alert**.
2. Pick the alert's automation and set **Operation** to `retire`. Leave **Alert key** out for a blueprint alert, which uses `default`. Select **Perform action**.
3. Turn off or delete the automation. A retired alert rejects new reports, so an automation left running fails every minute.

An open issue for the alert ends, and History shows it as **Monitoring ended**. It doesn't count as the condition clearing.

Turning the automation off without retiring the alert does something different. Its last report expires, the alert turns unknown, and after **Wait for unknown evidence** Homeostatic raises it as an issue. Deleting the automation ends its open issue as **Monitoring ended**.

To bring a retired alert back, run the same action with `resume`, then turn the automation back on. The alert stays unknown until its next report.

Retired alerts don't count toward the limit of 1000 active alerts. Homeostatic keeps a record of each one until you resume it or delete its automation, so an automation left running can't quietly bring a retired alert back. The action's fields are in the [reference](reference.md#homeostaticmanage_alert).

## Acknowledge from a phone

When Homeostatic sends an alert to a phone itself, the notification has an **Acknowledge** button. [When a notification arrives](guide.md#when-a-notification-arrives) in the user guide explains tapping, acknowledging and dismissing. For alerts, a few points matter:

- Acknowledge stops the 30-minute repeats of Immediate with acknowledgment. The issue stays open until the automation reports clear.
- A button works for 30 days, and only for the occurrence it was sent about. If the alert clears and later fires again, an old button can't acknowledge the new issue.
- When an alert on one of the two immediate choices clears, its notification isn't removed. Homeostatic replaces it with a quiet "Problem cleared." message. On iPhone, the earlier critical alert can stay on screen anyway.

## Alerts declared the older way

Alerts declared in the integration's options keep working. One bound to an entity follows that entity, and one with a `report_timeout` keeps taking reports through `homeostatic.report_situation` or the **Report a situation** blueprint. Homeostatic no longer has a form for editing these declarations.

### Convert and keep the open issue

A declaration with a `report_timeout` can be taken over by an automation like the ones on this page, keeping its open issue and its history. The alert blueprint has no field for this, so write the automation yourself.

1. Turn off the old reporting automation.
2. Write the new automation as described in [Write the automation yourself](#write-the-automation-yourself), with `adopt_situation_id` set to the declaration's ID in its `homeostatic.report_alert` data. Save it.
3. Its first report takes over the declaration. From then on the alert follows the reporting preference in the automation, and `homeostatic.report_situation` calls for that ID are rejected.
