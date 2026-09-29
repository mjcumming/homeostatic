# Create an alert in a Home Assistant automation

The **Homeostatic alert** blueprint is the recommended workflow. Follow the
[README walkthrough](../README.md#create-your-own-alert): configure name, message,
condition, required evidence and reporting preference in one HA form. The first
valid report registers its source automatically, even if it is currently clear.
Profiles require household people/destinations to be configured once in Notifications.
Requests remain off until explicitly enabled. Missing destinations are shown in
Sources; there is no silent fallback. Automated alerts follow their own selected
profile rather than the household default or a separately saved Sources assignment.

## Evidence and timing

The one-minute refresh bounds time-only reevaluation unless you add exact time
triggers under Advanced. Evidence timeout defaults to 300 seconds and means report
age, not notification delay. Every required entity must have usable, non-restored
evidence. False conditions report clear; missing evidence and condition errors
report unknown. A message template that fails to render stops that report, so its
last accepted evidence expires to unknown. Neither case invents recovery.

For a door-open condition restricted to a time window, leaving the window ends the
condition; it does not prove the door physically closed. Use suitable message text.
HA owns duration and template semantics, including restart limitations.

## Advanced native actions

`homeostatic.report_alert` accepts `automation`, `name`, rendered `message`,
`profile`, and `state` (active, clear, unknown). It also accepts `alert_key`
(default `default`) and `report_timeout` (default 300). Use the saved owning
automation's entity ID. Multiple conditions in one automation need distinct stable
keys. The integration derives durable identity from HA's automation unique ID.

```yaml
action: homeostatic.report_alert
data:
  automation: "{{ this.entity_id }}"
  alert_key: basement_water
  name: Basement water leak
  message: Water detected near the basement water heater.
  profile: acknowledge
  state: active
```

Custom automations must report clear on observed recovery, unknown for evidence
loss, and refresh before the timeout. One owner reports each key; serialize its
runs. Do not use changing messages or automation-run IDs as alert keys. These
actions retain administrator authorization; HA-owned automations use HA's normal
service permissions. They cannot create recipients or enable notification requests.

## Retirement and existing declarations

To remove an alert from monitoring, use **Homeostatic: Manage automation alert**
with its owning automation, alert key, and **Retire**. This records removal from
monitoring, not recovery, and rejects further reports until **Resume** is explicitly
called. Disable its reporting automation too to avoid repeated rejected calls.
Disabling or deleting an automation by itself only lets its evidence expire.
Retire before deleting the owner automation. Registrations and retained retirement
records are capped at 1000; there is no automatic eviction of issue identity.

Existing entity-bound and explicitly declared situations still work. To transfer
a declared report-only situation, stop its old reporter and use `report_alert`
with `adopt_situation_id` set to the declared ID. Keep supplying this optional
field or omit it after the first accepted conversion. The node and open episode
are preserved, its old declaration is shadowed, and `report_situation` can no longer
overwrite it. Entity-bound situations cannot be adopted by this action.

## Phone acknowledgment

Built-in person/phone delivery includes **Acknowledge** for an active individual
issue. It uses the authenticated recipient's HA identity without granting admin
configuration access. Main taps open details; summaries open Issues and have no
bulk acknowledgment. Legacy consumer blueprints retain delivery/clear behavior
without these authenticated buttons.

Callbacks survive restart, expire after 30 days, and are capped at 2000 outstanding
references. Old or expired buttons cannot acknowledge a later occurrence. Android
dismissal callbacks and iPhone notification removal are not acknowledgment or
proof of recovery. Urgent resolution messages are quiet; phone removal remains
subject to Companion/iOS limitations.

## Legacy explicitly declared situations

The following existing workflow remains supported for installations already using
it; new automation alerts should use the one-form blueprint above.


Home Assistant decides whether your condition holds. Homeostatic keeps one issue
open, routes notifications, manages acknowledgment and reminders, and resolves
the issue when your automation reports that it has cleared.

This supports continuing conditions, such as water present or a freezer too warm.
It does not send a separate informational notification for every motion event.

## 1. Declare the situation

In the Homeostatic integration's native options, add to **Situation alerts (YAML
list)** and save:

```yaml
- id: basement_water
  name: Water detected in basement
  importance: critical
  report_timeout: 300
```

Keep the id stable. Do not include `entity` for an automation-reported situation.
The timeout is the maximum age of a report, in seconds (60 to 86400). Use 300 or
more with the supplied blueprint, which refreshes every minute. This is not a
delay before alerting. Ordinary startup grace and notification policy still apply.

## 2. Create the reporting automation

Copy [the reporting blueprint](../blueprints/automation/homeostatic/report_situation.yaml)
to your HA configuration at `blueprints/automation/homeostatic/report_situation.yaml`.
In **Settings -> Automations & scenes -> Blueprints**, reload blueprints if needed,
then create an automation from **Report a situation to Homeostatic**.

Fill in the native HA form:

- **Situation ID:** `basement_water`.
- **Required evidence:** select your basement water binary sensor.
- **Situation is active when:** add a State condition for that sensor, state `on`
  (HA may display this as Wet or Detected).
- **Additional reevaluation triggers:** optional; leave empty for the water case.

Save and enable the automation. Use **Run actions** once to evaluate its current
condition immediately. Subsequent state changes and the one-minute refresh keep
the report current. Inspect the automation trace and Homeostatic Issues to verify
the result before activating notifications.

The blueprint reports Active when all conditions hold, Cleared when they do not,
and Cannot determine when any required evidence is missing, unknown, unavailable
or marked restored. Include every entity your condition depends on. Do not add
top-level automation conditions that skip clearing or refresh reports.

## 3. Configure notification delivery

In **Homeostatic -> Notifications**, configure recipients and their destinations,
review the reporting settings, and explicitly enable notification requests when
ready. Existing legacy policies/consumer automations remain supported; see the
[notification guide](guide.md#activate-notifications) if your installation uses
that route. A situation can open while notifications are off. Activation may
report an already-open issue. A successful report action confirms processing,
not phone receipt; testing on a live installation may send real notifications.

## More conditions, using the same HA editor

| Situation | Required evidence | Active conditions |
| --- | --- | --- |
| Freezer too warm | Freezer temperature | Numeric state above your chosen threshold |
| Nighttime motion during a full moon | Motion sensor and moon-phase entity | Motion on AND time between 01:00 and 02:00 AND moon phase full_moon |
| Window open while away | Window sensor and relevant person entities | Window open AND everyone away |

The moon entity must already exist in your HA installation; use its actual id and
state. Add time triggers at 01:00 and 02:00 for exact boundary reevaluation,
otherwise the next minute tick handles time-only changes. An already-active
motion sensor is evaluated when the window begins; this describes current
nighttime activity, not a history of individual motion events.

For hysteresis, elaborate delays, or logic based on event history, use a stateful
HA helper/template that correctly reports unknown evidence, and bind that entity
or include it in the blueprint. HA duration conditions do not prove continuity
through a restart. The blueprint has no extra notification or condition engine.

## Use the action in an existing automation

Under **Then do -> Add action**, choose **Homeostatic: Report situation**. Supply
the configured id and choose Active, Cleared, or Cannot determine. YAML example:

```yaml
action: homeostatic.report_situation
data:
  situation_id: basement_water
  state: active
```

Your automation must also report `clear` on observed recovery and `unknown` when
it cannot evaluate the condition. Reevaluate at startup and more often than the
configured timeout. Use one owner automation per id and serialize its runs.
Avoid replaying a captured old condition after a delay; evaluate current evidence
when reporting. Homeostatic orders calls by arrival and supplies acceptance time.

Repeated active reports retain the same issue. Acknowledgment does not clear it.
If the reporter stops, its report expires to unknown; after the configured
unknown hold, existing policy may alert about stale evidence. Restart/reload
preserves open issue identity but requires a fresh report. Neither expiry nor
restart means recovery. Only an explicit clear report resolves the issue.

The action is administrator-protected; HA-owned automations can call it using
HA's normal service authorization. Entity-bound situations reject this action.
It cannot enroll arbitrary ids, enable notifications or override recipients.
If storage fails, inspect Homeostatic state after recovery before retrying an
ambiguous action. The existing durable notification outbox controls replay.

Condition evaluation errors (such as nonnumeric temperature values) report unknown.
The blueprint checks both the positive condition and its explicit negation;
falling through an errored condition does not report clear.
