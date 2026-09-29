# Report a situation from a Home Assistant automation

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
