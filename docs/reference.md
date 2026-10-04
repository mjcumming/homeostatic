# Reference

Lookup tables for Homeostatic's timings, entities, actions, card, dashboard and blueprints. The [user guide](guide.md) shows how to use them, and [How it works](how-it-works.md) explains why they behave as they do.

## Contents

- [Setup](#setup)
- [Timings](#timings)
- [Fixed limits](#fixed-limits)
- [Reporting choices](#reporting-choices)
- [Monitoring rules](#monitoring-rules)
- [Node ids](#node-ids)
- [Entities](#entities)
- [Actions](#actions)
- [Card](#card)
- [Dashboard strategy](#dashboard-strategy)
- [Panel addresses](#panel-addresses)
- [Blueprints](#blueprints)
- [Events](#events)

## Setup

Adding Homeostatic creates one integration entry with integration availability monitoring and notification requests off. Change monitoring, timing and notifications in the Homeostatic panel. Homeostatic has no **Configure** form in Home Assistant.

## Timings

Edit these under **Settings → Timing** and **Settings → Problem grouping** in the panel. Values are seconds, except **Group related problems**, which is a count. Each accepts 0 to 86400; **Group related problems** needs at least 2. Zero removes a wait.

| Panel name | Key | Default | What it controls |
| --- | --- | --- | --- |
| Wait for related failures | `settle` | 120 (2 min) | While an integration is still loading or its state is unknown, a device or entity on it waits up to this long before opening an issue of its own, so a failing integration and what's on it end up as one issue |
| Confirm recovery | `clear_hold` | 120 (2 min) | How long an integration, device or entity has to stay available before its issue clears. Alerts and batteries clear at once. |
| Allow reconnecting devices | `rejoin_grace` | 60 (1 min) | After a failed integration comes back, how long its devices and entities get to recover before they can open issues of their own |
| Wait for unknown evidence | `unknown_hold` | 900 (15 min) | How long a watched source can have no current reading, or an alert can be unknown, before Homeostatic opens an issue for it |
| Wait before reporting setup retries | `retry_hold` | 120 (2 min) | An integration in setup retry is a warning at first and becomes a failure once it has been retrying this long |
| Wait after startup | `startup_grace` | 120 (2 min) | After Home Assistant starts, no new issues open for this long, and notifications wait at least this long. Saving a change in the panel doesn't start it. |
| Maximum startup wait | `startup_quiet_max` | 600 (10 min) | After a Home Assistant start, notifications are held until watched integrations finish loading, but never longer than this |
| Group related problems | `coalesce_count` | 3 | How many sources that share a direct dependency have to fail together before they're grouped into one issue on that dependency |
| Grouping window | `coalesce_window` | 60 (1 min) | How close together those failures have to start |
| Standard alert batching | `batch` | 30 | How long a `notify` message waits in a custom notification policy. The six reporting choices don't use it, and the panel hides it while they're in use. |

A watched source that fails opens an issue straight away, subject to the waits above. There's no separate delay before raising an issue.

## Fixed limits

These values aren't configurable.

| What | Value |
| --- | --- |
| Low battery | Level at or below 20%, or a low-battery sensor reporting low |
| Immediate with acknowledgment repeat | Every 30 minutes |
| Recheck of Home Assistant's registries | Every 60 seconds, plus whenever a registry changes |
| History | The latest 100 ended issues from the last 30 days |
| Pause alerts and maintenance | End time in the future and at most seven days away. Reason up to 500 characters. |
| Alerts from automations | Up to 1000 active per installation. Retired ones don't count. Name up to 200 characters, message up to 2000, alert key up to 100. |
| Alert report timeout | 60 to 86400 seconds, default 300. The alert blueprint's minimum is 300. |
| Phone Acknowledge button | Works for 30 days after the notification is sent. The latest 2000 are kept. |

## Reporting choices

The `profile` value is what the [`report_alert`](#homeostaticreport_alert) action and the alert blueprint store. The guide describes [what each choice does](guide.md#set-up-the-reporting-choices).

| Choice | `profile` value | Default schedule |
| --- | --- | --- |
| Immediate | `immediate` | Right away, overnight included |
| Immediate with acknowledgment | `acknowledge` | Right away, repeated every 30 minutes |
| Morning summary | `morning` | Daily at 08:00. The default for Home Assistant Repairs. |
| Evening summary | `evening` | Daily at 18:00 |
| Weekly summary | `weekly` | Sunday at 09:00. The household default for new sources. |
| Dashboard only | `dashboard` | Never sent |

## Monitoring rules

What Homeostatic watches is saved as rules. Sources writes a rule for one source. Policies saves the checks and any other policy. [`preview_rules`](#homeostaticpreview_rules) accepts the stored rules.

| Field | Required | Value |
| --- | --- | --- |
| `id` | Yes | Unique: lowercase letters, digits and `_`, starting with a letter |
| `action` | Yes | `attach` (**Watch**) or `exclude` (**Leave unmonitored**) |
| `checks` | No | `[availability]` (default), `[battery]`, `[vacuum]`, or `[repair]`. One check per rule. `[repair]` is the broad exclusion that turns Repairs off. |
| `enabled` | No | `true` (default) or `false` to pause the rule |
| `match` | Yes | Conditions, below |
| `overridable` | No | Set by Sources on an integration's **Only devices I choose** choice, so a single device can still be watched |

| Match field | Label in the panel | Value |
| --- | --- | --- |
| `kind` | Source type | `integration`, `device`, `entity`, `battery`, `vacuum`, or `repair` |
| `domain` | Domain | An entity domain such as `light`, or the integration's domain for an integration |
| `device_class` | Device class | The entity's device class, such as `temperature` |
| `integration` | Integration instance ID | A config entry id |
| `integration_domain` | Integration type | An integration domain, such as `zha` |
| `device` | Device ID | A device registry id |
| `entity` | Entity ID or stable reference | An entity id. Saved as `registry:<id>` so renames don't break it. |
| `area` | Area ID | The entity's area, or its device's area if the entity has none |
| `floor` | Floor ID | The floor of that area |
| `label` | Label ID | A label on the entity, its device or its area |

Every field in a rule has to match, and a list of values means any of them. A rule without `kind` never matches devices, and a rule with an empty `match` matches integrations and entities. An `exclude` rule wins over any `attach` rule, whatever the order, except that a rule watching one exact device wins over the integration's **Only devices I choose** default.

## Node ids

Actions and events refer to sources by node id. `homeostatic.inventory` lists them under `nodes`.

| Source | Node id |
| --- | --- |
| Integration | `entry:<config entry id>` |
| Device | `device:<device registry id>` |
| Entity | `entity:registry:<entity registry id>`, or `entity:entity_id:<entity id>` for an entity that isn't in the registry |
| Battery | `battery:registry:<entity registry id>` of its main battery entity, or `battery:entity_id:<entity id>` |
| Vacuum | `vacuum:registry:<entity registry id>`, or `vacuum:entity_id:<entity id>` for a vacuum that isn't in the registry |
| Alert | `situation:<id>` |

## Entities

Homeostatic adds one device, **Homeostatic** (model *Health monitor*), with these entities. Default entity ids follow Home Assistant's naming and change if you rename the device or entity.

| Entity | Default entity id | State |
| --- | --- | --- |
| Readiness | `sensor.homeostatic_readiness` | The [readiness](#readiness-states) of watched equipment. Alerts don't count. |
| Open problems | `sensor.homeostatic_open_problems` | Number of open issues, alerts included. Diagnostic. |
| Evidence gaps | `sensor.homeostatic_evidence_gaps` | Number of checks that have never reported or have been unknown longer than **Wait for unknown evidence**. Diagnostic. |

Every entity is `unavailable` only while Homeostatic itself is starting, has a storage error or is unloaded. A failing source never makes these entities unavailable.

### Readiness states

| State | Meaning |
| --- | --- |
| `ready` | Everything required is working |
| `degraded` | Something required has a warning, such as an unavailable entity, an integration retrying or a low battery |
| `blocked` | Something required has failed, such as an integration that failed to set up or needs you to sign in |
| `unknown` | Something required has no current state or isn't watched, and nothing is worse. Also the answer when nothing is watched. |

When requirements disagree, the worst state wins, in the order `blocked`, `degraded`, `unknown`, `ready`.

### Sensor attributes

| Attribute | Value |
| --- | --- |
| `monitored_nodes` | Number of sources and alerts Homeostatic tracks |
| `selected_capabilities` | Number of watched sources behind the overall readiness |
| `notification_consumer_missing` | `true` when the selected consumer automation is missing or off |
| `physical_freshness_verified` | Always `false`. See [Known limitations](troubleshooting.md#known-limitations). |
| `updated_at` | When Homeostatic last finished an update |
| `error` | Homeostatic's own error, if it has one |

## Actions

Read-only actions return a response and change nothing. Call them in **Developer tools → Actions** to see the response, or use `response_variable` in a script or automation. Actions that change something need an administrator when a person calls them; automations can call them too. Issue ids are called `episode_id` in actions and events.

| Action | Kind | Purpose |
| --- | --- | --- |
| [`inventory`](#homeostaticinventory) | Read | Everything Homeostatic knows: sources, rules, open issues, controls, history |
| [`explain`](#homeostaticexplain) | Read | Why a source is in its current state |
| [`readiness`](#homeostaticreadiness) | Read | Readiness of chosen sources |
| [`impact`](#homeostaticimpact) | Read | What depends on a source |
| [`coverage`](#homeostaticcoverage) | Read | What isn't watched or has no current state |
| [`rollup`](#homeostaticrollup) | Read | Counts by status for chosen sources |
| [`policy`](#homeostaticpolicy) | Read | Notification decisions for current issues |
| [`operator_controls`](#homeostaticoperator_controls) | Read | Active pauses and maintenance |
| [`resolved_history`](#homeostaticresolved_history) | Read | Ended issues from the last 30 days |
| [`preview_rules`](#homeostaticpreview_rules) | Preview | What a set of monitoring rules would watch |
| [`preview_policy`](#homeostaticpreview_policy) | Preview | What a notification policy would send now |
| [`preview_maintenance`](#homeostaticpreview_maintenance) | Preview | What maintenance would cover |
| [`acknowledge`](#homeostaticacknowledge) | Change | Acknowledge an issue |
| [`shelve`](#homeostaticshelve) | Change | Pause alerts for an issue |
| [`start_maintenance`](#homeostaticstart_maintenance) | Change | Start Working on this equipment |
| [`cancel_control`](#homeostaticcancel_control) | Change | End a pause or maintenance early |
| [`report_alert`](#homeostaticreport_alert) | Change | Report an alert's state from an automation |
| [`manage_alert`](#homeostaticmanage_alert) | Change | Retire or resume an alert |
| [`report_situation`](#homeostaticreport_situation) | Change | Report an alert declared the older way |

### `homeostatic.inventory`

No fields. Returns `nodes`, `targets`, `catalog`, `enrollment_changes` (the last 50 monitoring changes since Homeostatic loaded), `episodes` (open issues), `operator_controls`, `resolved_history`, `notification_requests`, `delivery_failures` and other status fields.

```yaml
action: homeostatic.inventory
```

### `homeostatic.explain`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | A [node id](#node-ids) |

Returns the node's findings and the condition of each node it depends on.

```yaml
action: homeostatic.explain
data:
  node_id: entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
```

### `homeostatic.readiness`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | List of node ids. Default: everything behind the overall Readiness sensor. |

Returns `answer`, `nodes` and `blocked_by`.

```yaml
action: homeostatic.readiness
data:
  node_ids:
    - entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
```

### `homeostatic.impact`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | A node id |

Returns the nodes that depend on it, with the importance it inherits from them.

```yaml
action: homeostatic.impact
data:
  node_id: entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
```

### `homeostatic.coverage`

No fields. Returns `no_checks` (nodes with no check), `never_observed` (checks that have never reported), `stale` (checks that have been unknown longer than **Wait for unknown evidence**) and `notification_consumer_missing`.

```yaml
action: homeostatic.coverage
```

### `homeostatic.rollup`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | List of node ids. Default: everything behind the overall Readiness sensor. |

Returns counts per status, split into nodes with their own issue, nodes covered by another issue, and nodes with no open issue.

```yaml
action: homeostatic.rollup
data:
  node_ids:
    - entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
```

### `homeostatic.policy`

No fields. Returns the notification decision for each open issue (rule, loudness, recipients, pending times, acknowledgment), the next deadline, routes, whether notifications are on, upcoming reports, and any unavailable destinations.

```yaml
action: homeostatic.policy
```

### `homeostatic.operator_controls`

No fields. Returns `controls`: each active pause or maintenance with its `control_id`, `action` (`shelve` or `maintenance`), target, start and end times, the user who started it, reason and `include_dependents`.

```yaml
action: homeostatic.operator_controls
```

### `homeostatic.resolved_history`

No fields. Returns `started_at`, `retention` (`max_episodes: 100`, `max_age_days: 30`) and `episodes`, newest first. Each entry has the issue as it ended, `resolved_at`, `resolution` (`cleared`, `removed` or `absorbed`), `absorbed_into` and the source's name at the time.

```yaml
action: homeostatic.resolved_history
```

### `homeostatic.preview_rules`

| Field | Required | Value |
| --- | --- | --- |
| `rules` | Yes | A complete list of [monitoring rules](#monitoring-rules). Entity ids are resolved for the preview. |

Returns how many sources would be watched, each rule's match count, and each candidate source with the rules that attach or exclude it. Nothing is saved.

```yaml
action: homeostatic.preview_rules
data:
  rules:
    - id: integration_availability
      action: attach
      match: {kind: integration}
    - id: garage_devices
      action: attach
      match: {kind: device, area: garage}
```

### `homeostatic.preview_policy`

| Field | Required | Value |
| --- | --- | --- |
| `policy` | Yes | A complete notification policy mapping: `timezone`, `recipients`, `digests` and `rules` |

Returns the notifications the policy would send if notifications were turned on now, the decision for each open issue, and the next deadline. Works while notifications are off. Nothing is saved or sent.

```yaml
action: homeostatic.preview_policy
data:
  policy:
    timezone: America/Chicago
    recipients:
      owner: {channels: [event]}
    rules:
      - match: {}
        loudness: notify
        to: owner
```

### `homeostatic.preview_maintenance`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | An integration, entity or external capability node id |
| `include_dependents` | No | `true` to cover what depends on it. Default `false`. |
| `until` | Yes | End time with a time zone, in the future and at most seven days away |

Returns `node_ids` (the scope), `existing_episode_ids` (issues already open, which stay open) and `until`.

```yaml
action: homeostatic.preview_maintenance
data:
  node_id: entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
  include_dependents: true
  until: "2026-10-04T18:00:00-05:00"
```

### `homeostatic.acknowledge`

| Field | Required | Value |
| --- | --- | --- |
| `episode_id` | Yes | An open issue's id, from `inventory` |

Records that someone has seen the issue, for every recipient. Stops reminders on rules that require acknowledgment. The issue stays open. Returns `acknowledgment` with the time (`at`) and the user (`actor_id`) of the first acknowledgment.

```yaml
action: homeostatic.acknowledge
data:
  episode_id: 0199a3c2-5e1f-7b20-9c4d-2a6e8f1b3d57
```

### `homeostatic.shelve`

The action behind **Pause alerts**.

| Field | Required | Value |
| --- | --- | --- |
| `episode_id` | Yes | An open issue's id. Summary tags aren't issue ids. |
| `until` | Yes | End time with a time zone, in the future and at most seven days away. A pause can be extended but not shortened. |
| `reason` | No | Up to 500 characters |

Holds new notifications for the issue, for every recipient, urgent ones included. Returns the saved `control`.

```yaml
action: homeostatic.shelve
data:
  episode_id: 0199a3c2-5e1f-7b20-9c4d-2a6e8f1b3d57
  until: "2026-10-02T08:00:00-05:00"
  reason: Waiting for a replacement part
```

### `homeostatic.start_maintenance`

The action behind **Working on this equipment**.

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | An integration, entity or external capability node id |
| `include_dependents` | No | `true` to cover what depends on it, as the graph changes during the window. Default `false`. |
| `until` | Yes | End time with a time zone, in the future and at most seven days away |
| `reason` | No | Up to 500 characters |

Stops new issues opening in the scope until `until`. Open issues and alerts carry on. Returns the scope, as `preview_maintenance` does, and the saved `control`.

```yaml
action: homeostatic.start_maintenance
data:
  node_id: entry:01J8Z2K3M4N5P6Q7R8S9T0V1W2
  include_dependents: true
  until: "{{ (now() + timedelta(hours=2)).isoformat() }}"
  reason: Replacing the Zigbee coordinator
```

### `homeostatic.cancel_control`

| Field | Required | Value |
| --- | --- | --- |
| `control_id` | Yes | An active control's id, from `operator_controls` |

Ends one pause or maintenance early. Other controls and quiet hours still apply. Returns `cancelled_control_id`.

```yaml
action: homeostatic.cancel_control
data:
  control_id: 9b8e2c41d5f04a7e8c3b6d1a2f4e5c70
```

### `homeostatic.report_alert`

Reports the state of an alert owned by an automation. The first report creates the alert. [Alerts from automations](automation-situations.md) shows how to use it.

| Field | Required | Value |
| --- | --- | --- |
| `automation` | Yes | The saved automation that owns the alert. Its unique id gives the alert its identity. |
| `alert_key` | No | Default `default`. Use different keys when one automation reports several alerts. Keep it stable. Up to 100 characters. |
| `name` | Yes | Alert name, up to 200 characters |
| `message` | Yes | The notification text, up to 2000 characters. Can be empty. |
| `profile` | Yes | A [reporting choice](#reporting-choices) value |
| `state` | Yes | `active`, `clear` or `unknown`. Only `clear` resolves the alert. |
| `report_timeout` | No | Seconds, 60 to 86400, default 300. With no fresh report in this time, the alert turns unknown. |
| `adopt_situation_id` | No | Takes over an alert declared the older way, keeping its open issue |

Returns `node_id`, `retired` and `reporting_status`.

```yaml
action: homeostatic.report_alert
data:
  automation: automation.basement_water_alert
  name: Basement water leak
  message: Water detected near the basement water heater.
  profile: acknowledge
  state: active
  report_timeout: 300
```

### `homeostatic.manage_alert`

| Field | Required | Value |
| --- | --- | --- |
| `automation` | Yes | The owning automation |
| `alert_key` | No | Default `default` |
| `operation` | Yes | `retire` stops watching the alert and ignores its reports until resumed. `resume` starts again. |

Retiring ends an open issue as **Monitoring ended**.

```yaml
action: homeostatic.manage_alert
data:
  automation: automation.basement_water_alert
  operation: retire
```

### `homeostatic.report_situation`

For previously saved situation declarations with a `report_timeout`. New alerts use `report_alert`.

| Field | Required | Value |
| --- | --- | --- |
| `situation_id` | Yes | The declared alert's id |
| `state` | Yes | `active`, `clear` or `unknown` |

Returns `node_id`, `state`, `accepted_at` and `expires_at`.

```yaml
action: homeostatic.report_situation
data:
  situation_id: basement_water
  state: active
```

## Card

Each panel page can go on a dashboard as a card. Like the panel, it's for administrators.

```yaml
type: custom:homeostatic-card
view: issues
navigation: false
```

| Option | Default | Value |
| --- | --- | --- |
| `view` | `overview` | The page the card shows, below |
| `navigation` | `true` | `false` hides the page tabs. If you open another page from the card, a back button returns to the configured view. |

| `view` | Shows |
| --- | --- |
| `overview` | Overview |
| `issues` | Issues, without page tabs |
| `sources` | Sources |
| `policies` | Policies |
| `notifications` | Notifications |
| `settings` | Settings |
| `history` | History |

The older view names `problems`, `configuration`, `house` and `coverage` still load, and `functions` opens Overview.

## Dashboard strategy

Homeostatic registers a dashboard strategy named **Homeostatic**. Choose it under **Settings → Dashboards → Add dashboard**.

It builds seven panel views, each one card with `navigation: false`:

| View | Path | Card `view` |
| --- | --- | --- |
| Overview | `overview` | `overview` |
| Issues | `issues` | `issues` |
| Sources | `sources` | `sources` |
| Policies | `policies` | `policies` |
| Notifications | `notifications` | `notifications` |
| Settings | `settings` | `settings` |
| History | `history` | `history` |

A Homeostatic dashboard you already added keeps the views it was created with. Add it again to include Policies. The sidebar panel includes Policies.

## Panel addresses

The sidebar panel is at `/homeostatic`, for administrators only. Notifications link to these addresses:

| Address | Opens |
| --- | --- |
| `/homeostatic` | Overview |
| `/homeostatic/issues` | Issues |
| `/homeostatic/episode/<issue id>` | That issue, or its History entry if it has ended |
| `/homeostatic/history` | History |
| `/homeostatic/notifications` | Notifications |

Any other address under `/homeostatic/` opens Issues.

## Blueprints

All blueprints need Home Assistant 2026.9.0 or newer.

### Homeostatic alert

[`alert.yaml`](../blueprints/automation/homeostatic/alert.yaml), an automation blueprint. Turns Home Assistant conditions into an alert. [Alerts from automations](automation-situations.md) walks through it.

| Input | Value |
| --- | --- |
| Alert name | The alert's name |
| Notification message | Text or a template. Add any entity it uses to Required evidence. |
| Reporting preference | One of the six [reporting choices](#reporting-choices) |
| Required evidence | Every entity the condition or message needs. If any is missing, unknown, unavailable or restored, the alert reports unknown. |
| Active when | Conditions that must all hold for the alert to be active |
| Evidence expires after | Advanced. Seconds without a fresh report before the alert turns unknown. 300 to 86400, default 300. |
| Exact reevaluation times or other triggers | Advanced. Extra triggers. |

The automation reevaluates when any evidence entity changes, when Home Assistant starts, every minute, and on any extra trigger.

### Homeostatic Companion notifications

[`companion_notification.yaml`](../blueprints/automation/homeostatic/companion_notification.yaml), an automation blueprint. Sends Homeostatic notification events to a Companion app phone. It's only for installations that were already set up to send through a consumer automation. New installations use the built-in sender, and saving the Notifications page replaces a consumer route.

| Input | Default | Value |
| --- | --- | --- |
| Recipient id | `owner` | The policy recipient this automation delivers for |
| Channel id | `event` | The policy channel this automation delivers |
| Companion app notification action | None | For example `notify.mobile_app_your_phone` |

### Homeostatic problem logbook

[`problem_logbook.yaml`](../blueprints/automation/homeostatic/problem_logbook.yaml), an automation blueprint. Writes a logbook entry when an issue opens, changes or ends, whether or not notifications are on.

| Input | Default | Value |
| --- | --- | --- |
| Changes to record | `opened`, `updated`, `resolved` | Which changes to log |

### Report a situation to Homeostatic

[`report_situation.yaml`](../blueprints/automation/homeostatic/report_situation.yaml) is retained for previously saved situation declarations. New alerts should use the Homeostatic alert blueprint.

| Input | Value |
| --- | --- |
| Situation ID | The declared alert's id |
| Required evidence | Every entity the conditions need |
| Situation is active when | Conditions that must all hold |
| Additional reevaluation triggers | Extra triggers |

### Diagnostic state as problem

[`diagnostic_state.yaml`](../blueprints/template/homeostatic/diagnostic_state.yaml), a template blueprint. Makes a `problem` binary sensor from a device's diagnostic entity, which you can then alert on. [Alert on a device's diagnostic sensor](how-to-local-health-signals.md) shows an example.

| Input | Value |
| --- | --- |
| Diagnostic entity | An entity that reports both a fault value and a clear value |
| Fault value | The exact state that means the fault is active, such as `1` |
| Clear value | The exact state that means the fault has cleared, such as `0` |

The sensor is `on` for the fault value, `off` for the clear value, and unavailable for any other value or a restored state.

## Events

Homeostatic fires `homeostatic_episode` when an issue opens, changes or ends, `homeostatic_control` when a control starts or ends, and `homeostatic_notification` for each notification. Their fields are in [Events](events.md).
