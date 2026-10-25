# Advanced interface reference

[Homeostatic manual](guide.md)

This page describes Homeostatic's entities, action schemas, identifiers, cards, dashboard strategy and event-consumer blueprints. It is intended for people integrating Homeostatic with scripts, automations or dashboards. Everyday configuration belongs in the [manual](guide.md).

Home Assistant automations can report continuing problems through the [automation alert interfaces](#automation-alert-interfaces). This reference describes their implemented contracts and the distinction between saved alert reporting choices and monitoring-policy notification assignments.

## Contents

- [Configuration references](#setup)
- [Node ids](#node-ids)
- [Entities](#entities)
- [Actions](#actions)
- [Card](#card)
- [Dashboard strategy](#dashboard-strategy)
- [Panel addresses](#panel-addresses)
- [Blueprints](#blueprints)
- [Automation alert interfaces](#automation-alert-interfaces)
- [Events](#events)

## Setup

For installation, use [Install Homeostatic](install.md). For supported configuration, use [Choose what to monitor](manual/policies.md) and [Set up and change notifications](manual/notifications.md). Configuration is managed in the Homeostatic panel; there is no native Home Assistant Configure form or integration YAML setup.

### Timings

Timing labels, defaults, units and behavior are listed in [Notification and control settings](manual/settings-reference.md). The ordinary settings reference owns these values.

### Fixed limits

History retention, operator-control bounds and other user-facing limits are listed in [Notification and control settings](manual/settings-reference.md). Individual action schemas below repeat bounds needed to validate an API request. Alert-interface limits are listed under [Automation alert interfaces](#automation-alert-interfaces).

### Policy notifications

See [Monitoring types and defaults](manual/monitoring-reference.md) for policy defaults and [Notification and control settings](manual/settings-reference.md) for named notifications, timing and destinations. The [notifications how-to](manual/notifications.md) covers assigning and editing them.

## Node ids

Actions and events use `node_id` for a monitored source or check, and `episode_id` for an issue. Obtain current values from `homeostatic.inventory`. Treat them as opaque identifiers; names are editable and are not identities.

Named monitoring policies create distinct checks for their selected sources. A check's `node_id` commonly begins with `monitoring:` and can change when its detection settings change. Its `monitoring_source` identifies the underlying catalog source, and `monitoring_policy` identifies the contributing policy. Use the current monitored `node_id` for `explain`, `readiness`, `impact` and other model queries. A catalog source identity is not necessarily a queryable monitored check.

These canonical source forms help interpret inventory data; callers should read the returned identity rather than reconstruct it:

| Source | Canonical identity form |
| --- | --- |
| Integration | `entry:<config entry id>` |
| Device | `device:<device registry id>` |
| Entity | `entity:registry:<entity registry id>`, or `entity:entity_id:<entity id>` for a state-only entity |
| Battery | `battery:registry:<primary entity registry id>`, or `battery:entity_id:<entity id>` |
| Vacuum | `vacuum:registry:<entity registry id>`, or `vacuum:entity_id:<entity id>` |

Other source kinds also expose their identities through inventory. Automation alert records use `situation:<id>`; their contracts are under [Automation alert interfaces](#automation-alert-interfaces). Functions are dormant: they have no supported setup workflow or registered public action in the current integration.

## Entities

Homeostatic adds a **Homeostatic** device with model **Health monitor** and these sensors. Entity IDs follow Home Assistant's naming and may differ after renaming or a naming collision; retrieve the actual IDs from the installation.

| Entity | Typical initial entity id | State |
| --- | --- | --- |
| Readiness | `sensor.homeostatic_readiness` | The [readiness state](#readiness-states) of selected equipment. |
| Open problems | `sensor.homeostatic_open_problems` | Count of open issues held by monitoring. Diagnostic. |
| Evidence gaps | `sensor.homeostatic_evidence_gaps` | Count of watched checks that have never reported or have remained unknown beyond the configured wait. Diagnostic. |

The sensors become unavailable when Homeostatic cannot supply a current answer, including startup, storage errors and unload. A failing monitored source does not itself make these sensors unavailable. The Open problems count can exceed the visible **Open issues** count because that page filters availability evidence gaps and recovery-confirmation entries.

### Readiness states

| State | Meaning |
| --- | --- |
| `ready` | The selected equipment requirements have passing evidence. |
| `degraded` | A requirement has a warning, such as an unavailable entity or low battery. |
| `blocked` | A requirement has failed, such as an integration setup or authentication failure. |
| `unknown` | A requirement lacks a current answer and no stronger adverse state applies. Also returned when no equipment is selected. |

When results differ, the precedence is `blocked`, `degraded`, `unknown`, `ready`. These states describe Home Assistant evidence; see [What Homeostatic cannot establish](manual/limitations.md).

### Sensor attributes

| Attribute | Value |
| --- | --- |
| `monitored_nodes` | Number of runtime source records. |
| `selected_capabilities` | Number of selected targets behind overall readiness. |
| `notification_consumer_missing` | Whether the configured event-consumer automation is missing or off. |
| `physical_freshness_verified` | Always `false`. |
| `updated_at` | Time of Homeostatic's last completed update. |
| `error` | Homeostatic's current runtime error, if present. |

## Actions

Read-only actions require a response and do not change live monitoring. Call them through **Developer tools → Actions**, or use `response_variable` in a script or automation. Mutation actions support an optional response. A person calling a mutation or `notification_report` must be an administrator; HA-owned automations follow Home Assistant's administrator-service authorization.

Queries require a running Homeostatic instance. Unknown identities and invalid fields return errors. Examples containing `<node_id>`, `<episode_id>` or `<control_id>` require values from the current inventory or control response. Templated expiry examples are intended for scripts or automations; direct calls need a future ISO timestamp with a time zone.

| Action | Kind | Purpose |
| --- | --- | --- |
| [`inventory`](#homeostaticinventory) | Read | Sources, policies, open issues, controls and history. |
| [`explain`](#homeostaticexplain) | Read | Findings and dependencies for a monitored check. |
| [`readiness`](#homeostaticreadiness) | Read | Readiness of selected sources. |
| [`impact`](#homeostaticimpact) | Read | Sources that depend on a monitored check. |
| [`coverage`](#homeostaticcoverage) | Read | Checks and sources with missing coverage or evidence. |
| [`rollup`](#homeostaticrollup) | Read | Status and issue-membership counts. |
| [`policy`](#homeostaticpolicy) | Read | Notification decisions for current issues. |
| [`operator_controls`](#homeostaticoperator_controls) | Read | Active pauses and maintenance windows. |
| [`resolved_history`](#homeostaticresolved_history) | Read | Retained ended issues. |
| [`notification_report`](#homeostaticnotification_report) | Read | Exact included issue IDs for a short notification link. |
| [`preview_policy`](#homeostaticpreview_policy) | Preview | Simulate notification-policy activation. |
| [`preview_maintenance`](#homeostaticpreview_maintenance) | Preview | Calculate the current maintenance scope. |
| [`acknowledge`](#homeostaticacknowledge) | Change | Acknowledge an issue. |
| [`shelve`](#homeostaticshelve) | Change | Pause notifications for an issue. |
| [`start_maintenance`](#homeostaticstart_maintenance) | Change | Hold new issues for equipment undergoing work. |
| [`cancel_control`](#homeostaticcancel_control) | Change | End one pause or maintenance window early. |

The automation reporting actions `report_alert`, `manage_alert` and the existing-declaration compatibility action `report_situation` are documented [separately](#automation-alert-interfaces).

### `homeostatic.inventory`

No fields. Returns source and catalog data, `targets`, `enrollment_changes`, `episodes`, `operator_controls`, `resolved_history`, `notification_requests`, `delivery_failures` and current evidence fields. `enrollment_changes` retains at most 50 activity records for the current runtime and is not persistent issue history.

```yaml
action: homeostatic.inventory
response_variable: homeostatic_inventory
```

### `homeostatic.explain`

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | A current monitored [node id](#node-ids). |

Returns the check's findings and the condition of its dependencies.

```yaml
action: homeostatic.explain
data:
  node_id: '<node_id>'
```

### `homeostatic.readiness`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | List of monitored node ids. Defaults to overall-readiness targets. |

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
| `node_id` | Yes | A current monitored node id. |

Returns dependent nodes and the importance inherited from them.

```yaml
action: homeostatic.impact
data:
  node_id: '<node_id>'
```

### `homeostatic.coverage`

No fields. Returns `no_checks` (registered sources without a check), `never_observed` and `stale` (check-level evidence gaps), plus `notification_consumer_missing`. Use Monitoring and catalog data to inspect discovery and saved selections.

```yaml
action: homeostatic.coverage
```

### `homeostatic.rollup`

| Field | Required | Value |
| --- | --- | --- |
| `node_ids` | No | List of monitored node ids. Defaults to overall-readiness targets. |

Returns counts per status, divided by own issue, coverage by another issue and no open issue.

```yaml
action: homeostatic.rollup
data:
  node_ids:
    - '<node_id>'
```

### `homeostatic.policy`

No fields. Returns `episodes` with notification explanations, `next_deadline`, `routes`, `notifications_enabled`, upcoming `reports` and `unavailable_destinations`. Read this response to inspect decisions; it does not request delivery.

```yaml
action: homeostatic.policy
```

### `homeostatic.operator_controls`

No fields. Returns `controls`, each containing `control_id`, `action` (`shelve` or `maintenance`), `target`, `started_at`, `until`, `user_id`, `reason` and `include_dependents`. A control may also retain `monitoring_roots` used to apply its scope.

```yaml
action: homeostatic.operator_controls
```

### `homeostatic.resolved_history`

No fields. Returns `started_at`, `retention` and `episodes`, newest first. Each record contains the issue as it ended, `resolved_at`, `resolution` (`cleared`, `removed`, `absorbed` or `split`), `absorbed_into`, `split_into` and a source display snapshot when available. `split_into` lists continuing issue IDs when issues separate; it is empty for other outcomes.

New source snapshots retain known ownership and canonical-source metadata. Older records may lack it. Historical names and associations do not change when the current registry changes. `removed` does not establish recovery; `absorbed` identifies an issue that joined another issue. Retention is documented in [Notification and control settings](manual/settings-reference.md).

```yaml
action: homeostatic.resolved_history
```

### `homeostatic.notification_report`

Read a short notification link's exact membership. Requires administrator access. Pass `reference`, the 32-character identifier after `/homeostatic/notification/`; optional `offset` defaults to 0 and `limit` defaults to 200 (maximum 200). The response contains `status` (`available` or `expired`), `reference`, `episodes`, `total` and `next_offset`. Request each page until `next_offset` is `null`. Unknown or expired references return no IDs and never imply recovery. Reading does not extend retention or change monitoring. Link retention is described in [notification tap destinations](spec.md#notification-tap-destinations).

```yaml
action: homeostatic.notification_report
data:
  reference: "0123456789abcdef0123456789abcdef"
  offset: 0
  limit: 200
```

### `homeostatic.preview_policy`

| Field | Required | Value |
| --- | --- | --- |
| `policy` | Yes | A low-level policy mapping with `timezone`, `recipients` and `rules`; optional `digests`. |

This is the policy engine's configuration shape, separate from the named-notification editor's configuration. It returns `at`, issue explanations in `episodes`, simulated `deliveries`, `reports` and `next_deadline`. The simulation assumes activation and works while normal sending is off. Nothing is saved or sent.

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
| `node_id` | Yes | An eligible integration, entity or external-capability identity. |
| `include_dependents` | No | Include graph dependents; default `false`. |
| `until` | Yes | Zoned ISO timestamp, strictly in the future and no more than seven days away. |

Returns `node_ids`, `existing_episode_ids` and `until`. It changes nothing. Starting maintenance recomputes the scope; the preview is not a reservation.

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
| `episode_id` | Yes | A current open issue id from inventory. |

Records awareness for every recipient and stops acknowledgment-dependent reminders. Other eligible notifications may continue. Returns `acknowledgment` with the first acknowledgment's `at` and `actor_id`. The authenticated Home Assistant context supplies the actor; callers cannot set it.

```yaml
action: homeostatic.acknowledge
data:
  episode_id: '<episode_id>'
```

### `homeostatic.shelve`

The action behind **Pause notifications**.

| Field | Required | Value |
| --- | --- | --- |
| `episode_id` | Yes | A current issue id; a summary tag is not an issue id. |
| `until` | Yes | Zoned ISO timestamp, strictly in the future and no more than seven days away. Existing pauses may be extended, not shortened. |
| `reason` | No | Text up to 500 characters; default empty. |

Holds new notifications for this issue for every recipient, including urgent routes. Existing messages remain, and recovery can still update or clear them. The issue remains open. Returns the saved `control`.

```yaml
action: homeostatic.shelve
data:
  episode_id: '<episode_id>'
  until: '{{ (now() + timedelta(hours=2)).isoformat() }}'
  reason: Waiting for a replacement part
```

### `homeostatic.start_maintenance`

Start equipment maintenance through this Home Assistant action. Active periods remain visible in the panel, where **End maintenance** ends them early. The panel has no action for starting a period.

| Field | Required | Value |
| --- | --- | --- |
| `node_id` | Yes | An eligible integration, entity or external-capability identity. |
| `include_dependents` | No | Include graph dependents as relationships change; default `false`. |
| `until` | Yes | Zoned ISO timestamp, strictly in the future and no more than seven days away. |
| `reason` | No | Text up to 500 characters; default empty. |

Prevents new issues in the applied scope until expiry. Existing issues, their notifications and observations continue. There is no global maintenance scope. Situation roots and scopes containing situations are rejected. Returns the applied scope, as `preview_maintenance` does, and the saved `control`.

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
| `control_id` | Yes | A current control id from `operator_controls`. |

Ends that pause or maintenance window early. Overlapping controls and other notification holds remain effective. Missing, expired or replaced control ids are rejected. Returns `cancelled_control_id`.

```yaml
action: homeostatic.cancel_control
data:
  control_id: '<control_id>'
```

Control mutations save before confirming success. A persistence failure can leave an uncertain outcome. After monitoring recovers, inspect current controls or acknowledgment before retrying; do not automatically repeat an ambiguous request.

## Card

The reusable card type is `custom:homeostatic-card`. Panel and card access require an administrator. For dashboard setup, use [Add Homeostatic to a dashboard](manual/dashboards.md).

```yaml
type: custom:homeostatic-card
view: issues
navigation: false
```

| Option | Default | Meaning |
| --- | --- | --- |
| `view` | `issues` | Initial page, using the identifiers below. |
| `navigation` | `true` | Whether to show page tabs. With tabs hidden, contextual navigation can open another page and a back control returns to the configured view. |

| `view` | Visible page |
| --- | --- |
| `issues` | Open issues |
| `sources` | Monitoring |
| `policies` | Policies |
| `notifications` | Notifications |
| `settings` | Settings |
| `history` | History |

Compatibility aliases remain accepted: `overview`, `problems` and `functions` open Open issues; `house` and `coverage` open Monitoring; `configuration` opens Settings. The `functions` alias does not expose a functions page. Internal versioned element names are cache-management details; saved dashboard YAML should use the reusable card name above.

## Dashboard strategy

The `custom:homeostatic` strategy generates a **Homeostatic** dashboard with five panel views. Each contains one card with `navigation: false`; Settings remains available through the card header.

```yaml
strategy:
  type: custom:homeostatic
```

| View title | Path | Card `view` |
| --- | --- | --- |
| Open issues | `issues` | `issues` |
| Monitoring | `sources` | `sources` |
| Policies | `policies` | `policies` |
| Notifications | `notifications` | `notifications` |
| History | `history` | `history` |

Existing dashboard configurations are not rewritten during an update. Their saved views remain, and supported older identifiers open their replacement destinations. The sidebar panel uses the current navigation independently.

## Panel addresses

The administrator-only sidebar panel is `/homeostatic`. Encode identity values as individual URL path components. Links grant no additional access and do not acknowledge an issue or change monitoring.

| Address | Destination |
| --- | --- |
| `/homeostatic` or `/homeostatic/issues` | Open issues |
| `/homeostatic/episode/<episode_id>` | Current issue detail, or its retained History entry if it ended |
| `/homeostatic/node/<node_id>` | Source detail |
| `/homeostatic/sources` | Monitoring |
| `/homeostatic/sources/<source_id>` | Selected source in Monitoring |
| `/homeostatic/sources/<source_id>/history` | Compatibility route to that source's history |
| `/homeostatic/policies` | Policies |
| `/homeostatic/policies/<policy_id>` | Policy editor |
| `/homeostatic/notifications` | Named notifications |
| `/homeostatic/notifications/profiles/<profile_id>` | Named-notification editor |
| `/homeostatic/notifications/methods` | Delivery methods |
| `/homeostatic/notifications/methods/<method_id>` | Delivery-method editor |
| `/homeostatic/history` | History |
| `/homeostatic/history/<episode_id>` | Selected History entry |
| `/homeostatic/settings` or `/homeostatic/settings/timing` | Timing settings |
| `/homeostatic/settings/grouping` | Legacy route to installation timing settings |

The older `/homeostatic/notifications/policies` route opens Policies, with an optional policy id after it. Unrecognized routes fall back to Open issues. If an issue is absent from both current monitoring and retained history, the page reports that its outcome cannot be determined.

## Blueprints

The event-consumer blueprints below declare Home Assistant 2026.9.0 as their minimum version. They are optional; the normal [notification setup](manual/notifications.md) uses saved delivery methods.

### Homeostatic Companion notifications

[`companion_notification.yaml`](../blueprints/automation/homeostatic/companion_notification.yaml) consumes `homeostatic_notification` request events for a selected recipient and channel, then calls a Companion notification action. Avoid routing the same request through both this consumer and a built-in delivery method. The blueprint does not add the built-in sender's phone acknowledgment action. Its description retains older setup wording; it is not a current Notifications configuration guide.

| Input | Default | Value |
| --- | --- | --- |
| Recipient id | `owner` | The policy recipient whose request events it accepts. |
| Channel id | `event` | An exact channel in the request's `channels` list. |
| Companion app notification action | None | An existing Home Assistant notify action. |

The blueprint reuses notification tags, sends silent updates when requested and handles resolution requests. Event receipt and a successful action call do not prove delivery to a phone.

### Homeostatic problem logbook

[`problem_logbook.yaml`](../blueprints/automation/homeostatic/problem_logbook.yaml) writes a logbook entry when an issue opens, changes or ends. Notification sending need not be enabled.

| Input | Default | Value |
| --- | --- | --- |
| Changes to record | `opened`, `updated`, `resolved` | Event changes to log. |

<a id="unfinished-alert-interfaces"></a>

## Automation alert interfaces

The alert blueprint and reporting actions register automation-owned problems, update their evidence and preserve their identities across reloads. [Automation-defined alerts](automation-situations.md) explains which choices belong to the Home Assistant automation. The contracts below describe current behavior, including the existing saved reporting configuration.

### Reporting choices

The `report_alert` schema accepts the profile values below. Matching `automation_profiles` entries compile into notification routes. The current editors do not create that mapping, and a monitoring policy's named notification assignment does not configure it. Source-specific assignments and current default notification rows can also supply routes under the existing policy order. Existing saved mappings may use their own timing and delivery methods; the profile identifiers alone do not promise a schedule or destination. The blueprint's fixed selector is separate from the current reusable named notifications.

| `profile` | Existing selector label |
| --- | --- |
| `immediate` | Immediate |
| `acknowledge` | Immediate with acknowledgment |
| `morning` | Morning summary |
| `evening` | Evening summary |
| `weekly` | Weekly summary |
| `dashboard` | Dashboard only |

Selecting a profile neither creates delivery methods nor enables global sending. Report responses distinguish `dashboard_only`, `requests_disabled`, `configured` and `missing_destinations`. This status checks the selected alert-profile mapping and global sending; it is not a complete explanation of the effective notification routes. In particular, a missing profile mapping can coexist with delivery through current default notification rows.

### `homeostatic.report_alert`

Reports a continuing condition owned by a saved automation. The first accepted report creates its declaration. The owning automation's saved identity and `alert_key` determine the alert identity.

| Field | Required | Value |
| --- | --- | --- |
| `automation` | Yes | An automation entity with a saved HA automation identity. |
| `alert_key` | No | Nonempty stable key, at most 100 characters; default `default`. |
| `name` | Yes | Nonblank name, at most 200 characters. |
| `message` | Yes | Text at most 2000 characters; may be empty. Used for active reports. |
| `profile` | Yes | One of the [reporting choices](#reporting-choices). |
| `state` | Yes | `active`, `clear` or `unknown`. Only `clear` establishes recovery. |
| `report_timeout` | No | Integer seconds from 60 to 86400; default 300. Expiry makes the evidence unknown. |
| `adopt_situation_id` | No | Existing declared situation with a report timeout to adopt, preserving its identity. |

Returns `node_id`, `retired` and `reporting_status`. Up to 1000 active declarations are retained; retired declarations do not count toward that limit. Invalid reports mutate nothing. A retired alert rejects reports until explicitly resumed.

### `homeostatic.manage_alert`

Retires or resumes a condition owned by a saved automation.

| Field | Required | Value |
| --- | --- | --- |
| `automation` | Yes | Owning automation. |
| `alert_key` | No | Default `default`. |
| `operation` | Yes | `retire` or `resume`. |

Retiring ends monitoring and rejects further reports until resumed. It does not establish recovery. Returns `node_id`, `retired` and `reporting_status`.

### `homeostatic.report_situation`

Existing-declaration compatibility interface. It accepts only previously saved situations with a `report_timeout`. Use the automation-owned alert blueprint for automatic registration of a new problem.

| Field | Required | Value |
| --- | --- | --- |
| `situation_id` | Yes | Declared id matching a lowercase letter followed by lowercase letters, digits or underscores. |
| `state` | Yes | `active`, `clear` or `unknown`. |

Returns `node_id`, `state`, `accepted_at` and `expires_at`. A declaration adopted by an automation-owned alert rejects further `report_situation` calls for that id.

### Homeostatic alert

[`alert.yaml`](../blueprints/automation/homeostatic/alert.yaml) registers a continuing problem from a saved Home Assistant automation and reports its current evidence. It declares Home Assistant 2026.9.0 as its minimum version. Its fixed reporting selector uses the choices described above; the current editors do not create alert-profile mappings.

| Input | Existing contract |
| --- | --- |
| Alert name | Declaration name. |
| Notification message | Text or template; every referenced entity belongs in Required evidence. |
| Reporting preference | One of the accepted profile values above. |
| Required evidence | Entities needed by the condition and message. Missing, unknown, unavailable or restored evidence produces an unknown report. |
| Active when | Conditions that must all hold. |
| Evidence expires after | Integer seconds from 300 to 86400; default 300. |
| Exact reevaluation times or other triggers | Additional reevaluation triggers. |

The implementation reevaluates on required-entity changes, HA startup, every minute and additional triggers. It reports active, clear or unknown; invalid evidence does not clear a prior condition.

### Report a situation to Homeostatic

Compatibility blueprint: [`report_situation.yaml`](../blueprints/automation/homeostatic/report_situation.yaml). It targets previously saved declarations; the automation-owned alert blueprint registers new problems automatically.

| Input | Existing contract |
| --- | --- |
| Situation ID | Previously declared situation id. |
| Required evidence | Entities needed by its conditions. |
| Situation is active when | Conditions that must all hold. |
| Additional reevaluation triggers | Extra triggers. |

### Diagnostic state as problem

[`diagnostic_state.yaml`](../blueprints/template/homeostatic/diagnostic_state.yaml) produces a template binary sensor from documented fault and clear values. An alert automation can use that sensor as evidence; creating the sensor does not register an alert automatically.

| Input | Existing contract |
| --- | --- |
| Diagnostic entity | Source with documented fault and clear values. |
| Fault value | Exact raw state representing the fault. |
| Clear value | Distinct exact raw state representing recovery. |

The sensor is on for the fault value, off for the clear value and unavailable for any other value or a restored source state. The blueprint declares Home Assistant 2026.9.0 as its minimum version.

## Events

`homeostatic_episode` records issue changes, `homeostatic_control` records control changes, and `homeostatic_notification` carries delivery requests. These events have different meanings: a delivery request is not proof of receipt, acknowledgment or recovery. See [Events](events.md) for their schemas and consumer behavior.
