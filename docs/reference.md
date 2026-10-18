# Automation reference

Homeostatic's sensors, actions, cards and panel addresses, for your own automations, scripts and dashboards. Everyday setup is in the [manual](guide.md), and the events Homeostatic fires are in [Events](events.md). Configuration lives in the panel; there's no YAML setup.

## Node ids

Actions and events use `node_id` for a monitored source or check and `episode_id` for an issue. Get current values from `homeostatic.inventory` and treat them as opaque; names can change, IDs don't.

Each policy creates its own checks. A check's `node_id` usually starts with `monitoring:` and changes when its detection settings change. Its `monitoring_source` is the underlying source and `monitoring_policy` the policy. Use the check's `node_id` for `explain`, `readiness` and `impact`.

| Source | Identity |
| --- | --- |
| Integration | `entry:<config entry id>` |
| Device | `device:<device registry id>` |
| Entity | `entity:registry:<entity registry id>`, or `entity:entity_id:<entity id>` for an entity with no registry entry |
| Battery | `battery:registry:<primary entity registry id>`, or `battery:entity_id:<entity id>` |
| Vacuum | `vacuum:registry:<entity registry id>`, or `vacuum:entity_id:<entity id>` |

## Entities

Homeostatic adds a **Homeostatic** device with these sensors. Entity IDs follow Home Assistant's naming, so check the actual IDs in your installation.

| Entity | Typical entity ID | State |
| --- | --- | --- |
| Readiness | `sensor.homeostatic_readiness` | The [readiness state](#readiness-states) of the selected equipment |
| Open problems | `sensor.homeostatic_open_problems` | Number of open issues. Diagnostic. |
| Evidence gaps | `sensor.homeostatic_evidence_gaps` | Number of checks that have never reported or stayed unknown past **Wait for unknown evidence**. Diagnostic. |

The sensors are unavailable while Homeostatic can't give a current answer, such as during startup or after a storage error. Open problems can be higher than the count in **Open issues**, which hides availability checks with unknown evidence and those waiting to confirm recovery.

### Readiness states

| State | Meaning |
| --- | --- |
| `ready` | Every selected requirement is passing. |
| `degraded` | A requirement has a warning, such as an unavailable entity or a low battery. |
| `blocked` | A requirement has failed, such as an integration that can't set up. |
| `unknown` | A requirement has no current answer and nothing worse applies, or nothing is selected. |

The precedence is `blocked`, `degraded`, `unknown`, then `ready`.

### Sensor attributes

| Attribute | Value |
| --- | --- |
| `monitored_nodes` | Number of sources being tracked |
| `selected_capabilities` | Number of selected targets behind readiness |
| `notification_consumer_missing` | Whether the configured event-consumer automation is missing or off |
| `physical_freshness_verified` | Always `false` |
| `updated_at` | When Homeostatic last finished an update |
| `error` | Homeostatic's current error, if any |

## Actions

Read actions need a response: use **Developer tools → Actions**, or `response_variable` in a script. A person calling a change action must be an administrator; automations follow Home Assistant's rules for administrator actions. Times need a time zone, and the examples use templates, which work in scripts and automations.

| Action | Kind | Purpose |
| --- | --- | --- |
| [`inventory`](#homeostaticinventory) | Read | Sources, policies, open issues, controls and history |
| [`explain`](#homeostaticexplain) | Read | Findings and dependencies for a check |
| [`readiness`](#homeostaticreadiness) | Read | Readiness of selected sources |
| [`impact`](#homeostaticimpact) | Read | Sources that depend on a check |
| [`coverage`](#homeostaticcoverage) | Read | Sources and checks with missing coverage or evidence |
| [`rollup`](#homeostaticrollup) | Read | Status and issue counts |
| [`policy`](#homeostaticpolicy) | Read | Notification decisions for current issues |
| [`operator_controls`](#homeostaticoperator_controls) | Read | Active pauses and maintenance windows |
| [`resolved_history`](#homeostaticresolved_history) | Read | Retained ended issues |
| [`preview_policy`](#homeostaticpreview_policy) | Preview | Simulate a notification policy |
| [`preview_maintenance`](#homeostaticpreview_maintenance) | Preview | Work out a maintenance window's scope |
| [`acknowledge`](#homeostaticacknowledge) | Change | Acknowledge an issue |
| [`shelve`](#homeostaticshelve) | Change | Pause an issue's notifications |
| [`start_maintenance`](#homeostaticstart_maintenance) | Change | Hold new issues for equipment during work |
| [`cancel_control`](#homeostaticcancel_control) | Change | End a pause or maintenance window early |

### `homeostatic.inventory`

No fields. Returns sources and catalog data, `targets`, `enrollment_changes` (the last 50, for the current run only), `episodes`, `operator_controls`, `resolved_history`, `notification_requests`, `delivery_failures` and current evidence.

```yaml
action: homeostatic.inventory
response_variable: homeostatic_inventory
```

### `homeostatic.explain`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | A current check's [node id](#node-ids) |

Returns the check's findings and the state of its dependencies.

```yaml
action: homeostatic.explain
data:
  node_id: '<node_id>'
```

### `homeostatic.readiness`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | Check node ids. Defaults to the readiness targets. |

Returns `answer`, `nodes` and `blocked_by`. An empty selection returns `unknown`.

```yaml
action: homeostatic.readiness
data:
  node_ids:
    - '<node_id>'
```

### `homeostatic.impact`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | A current check's node id |

Returns the nodes that depend on it and the importance they pass on.

```yaml
action: homeostatic.impact
data:
  node_id: '<node_id>'
```

### `homeostatic.coverage`

No fields. Returns `no_checks` (sources without a check), `never_observed` and `stale` (checks without current evidence), and `notification_consumer_missing`.

```yaml
action: homeostatic.coverage
```

### `homeostatic.rollup`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | Check node ids. Defaults to the readiness targets. |

Returns counts per status, split into sources with their own issue, sources covered by another issue and sources with none.

```yaml
action: homeostatic.rollup
data:
  node_ids:
    - '<node_id>'
```

### `homeostatic.policy`

No fields. Returns `episodes` with notification explanations, `next_deadline`, `routes`, `notifications_enabled`, upcoming `reports` and `unavailable_destinations`. It never sends anything.

```yaml
action: homeostatic.policy
```

### `homeostatic.operator_controls`

No fields. Returns `controls`, each with `control_id`, `action` (`shelve` or `maintenance`), `target`, `started_at`, `until`, `user_id`, `reason` and `include_dependents`.

```yaml
action: homeostatic.operator_controls
```

### `homeostatic.resolved_history`

No fields. Returns `started_at`, `retention` and `episodes`, newest first. Each record has the issue as it ended, `resolved_at`, `resolution` (`cleared`, `removed`, `absorbed` or `split`), `absorbed_into`, `split_into` and the source's details when known. `removed` means monitoring stopped, not that the problem ended; `absorbed` means the issue joined another one; `split` lists the separate issues that continue it in `split_into`.

```yaml
action: homeostatic.resolved_history
```

### `homeostatic.preview_policy`

| Field | Required | Value |
| --- | --- | --- |
| `policy` | Yes | A policy-engine mapping with `timezone`, `recipients` and `rules`, and optionally `digests` |

Simulates turning the policy on now and returns `at`, issue explanations in `episodes`, the `deliveries` it would request, `reports` and `next_deadline`. It works while sending is off, and saves and sends nothing. This is the policy engine's own format, not the panel's named notifications.

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
| `node_id` | Yes | An integration or entity identity |
| `include_dependents` | No | Also cover equipment that depends on it; default `false` |
| `until` | Yes | A time in the future, at most seven days away |

Returns `node_ids`, `existing_episode_ids` and `until`, and changes nothing. Starting maintenance works out the scope again.

```yaml
action: homeostatic.preview_maintenance
data:
  node_id: '<node_id>'
  include_dependents: true
  until: '{{ (now() + timedelta(hours=2)).isoformat() }}'
```

### `homeostatic.acknowledge`

| Field | Required | Value |
| --- | --- | --- |
| `episode_id` | Yes | An open issue's id |

Records that someone has seen the issue, for every recipient, and stops reminders that wait for acknowledgment. Returns `acknowledgment` with the first acknowledgment's `at` and `actor_id`, which comes from the calling user.

```yaml
action: homeostatic.acknowledge
data:
  episode_id: '<episode_id>'
```

### `homeostatic.shelve`

The action behind **Pause notifications**.

| Field | Required | Value |
| --- | --- | --- |
| `episode_id` | Yes | An open issue's id |
| `until` | Yes | A time in the future, at most seven days away. A pause can be extended but not shortened. |
| `reason` | No | Up to 500 characters |

Holds new notifications about the issue for everyone, including urgent ones. Existing messages stay, and recovery can still update or clear them. Returns the saved `control`.

```yaml
action: homeostatic.shelve
data:
  episode_id: '<episode_id>'
  until: '{{ (now() + timedelta(days=3)).isoformat() }}'
  reason: Waiting for a replacement part
```

### `homeostatic.start_maintenance`

Starts a maintenance window. The panel shows active windows and can end them, but can't start one.

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | An integration or entity identity |
| `include_dependents` | No | Also cover equipment that depends on it; default `false` |
| `until` | Yes | A time in the future, at most seven days away |
| `reason` | No | Up to 500 characters |

Prevents new issues in the window's scope until it ends. Issues that are already open, their notifications and monitoring carry on. Returns the scope, as `preview_maintenance` does, and the saved `control`.

```yaml
action: homeostatic.start_maintenance
data:
  node_id: '<node_id>'
  include_dependents: true
  until: '{{ (now() + timedelta(hours=2)).isoformat() }}'
  reason: Replacing equipment
```

### `homeostatic.cancel_control`

| Field | Required | Value |
| --- | --- | --- |
| `control_id` | Yes | A current control id from `operator_controls` |

Ends that pause or maintenance window early. Other overlapping controls stay. Returns `cancelled_control_id`.

```yaml
action: homeostatic.cancel_control
data:
  control_id: '<control_id>'
```

Change actions save before they report success. If saving fails, the result is uncertain: check the current controls or acknowledgment before trying again.

## Dashboards

The sidebar panel is there as soon as Homeostatic is installed. To add a Homeostatic dashboard, go to **Settings → Dashboards → Add dashboard**, choose **Homeostatic**, and make it visible to administrators only. It has views for Open issues, Monitoring, Policies, Notifications and History.

To put one page on another dashboard, add a manual card:

```yaml
type: custom:homeostatic-card
view: issues
navigation: false
```

| Option | Default | Meaning |
| --- | --- | --- |
| `view` | `issues` | The page to show: `issues` (Open issues), `sources` (Monitoring), `policies`, `notifications`, `history` or `settings` |
| `navigation` | `true` | Whether to show the page tabs. Without them, links to other pages show a button back to this view. |

The ready-made dashboard comes from the `custom:homeostatic` strategy:

```yaml
strategy:
  type: custom:homeostatic
```

## Panel addresses

The panel lives at `/homeostatic`. Links grant no extra access and don't acknowledge anything.

| Address | Opens |
| --- | --- |
| `/homeostatic` or `/homeostatic/issues` | Open issues |
| `/homeostatic/issues/notification/<episode ids>` | Open issues limited to the issues in one notification, comma-separated |
| `/homeostatic/episode/<episode_id>` | An issue, or its History entry if it has ended |
| `/homeostatic/node/<node_id>` | A source |
| `/homeostatic/sources` | Monitoring |
| `/homeostatic/sources/<source_id>` | A source selected in Monitoring |
| `/homeostatic/policies` | Policies |
| `/homeostatic/policies/<policy_id>` | A policy's editor |
| `/homeostatic/notifications` | Named notifications |
| `/homeostatic/notifications/profiles/<profile_id>` | A named notification's editor |
| `/homeostatic/notifications/methods` | Delivery methods |
| `/homeostatic/notifications/methods/<method_id>` | A delivery method's editor |
| `/homeostatic/history` | History |
| `/homeostatic/history/<episode_id>` | One History entry |
| `/homeostatic/settings` | Settings |

Encode each ID as its own path segment. Unknown addresses open Open issues.

## Blueprints

These optional blueprints consume Homeostatic's [events](events.md). The built-in delivery methods don't need them.

[`companion_notification.yaml`](../blueprints/automation/homeostatic/companion_notification.yaml) sends `homeostatic_notification` requests for one recipient and channel to a Companion app notify action. Its inputs are **Recipient id** (default `owner`), **Channel id** (default `event`) and the **Companion app notification action**. It reuses tags, sends silent updates and handles withdrawals, but doesn't add the **Acknowledge** button. Don't route the same requests through it and a built-in delivery method.

[`problem_logbook.yaml`](../blueprints/automation/homeostatic/problem_logbook.yaml) writes a logbook entry when an issue opens, changes or ends, whether or not sending is on. **Changes to record** chooses which of `opened`, `updated` and `resolved` to log.
