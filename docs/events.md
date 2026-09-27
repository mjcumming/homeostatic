# Event contract

Homeostatic publishes two kinds of events: detected facts for owner automations, and notification requests for consumers.

## Detected facts for owner automations

[ADR 0014](adr/0014-publish-detected-facts-for-owner-automations.md) publishes what Homeostatic detects so owners can write their own rules. These events are facts, not attention decisions: they fire whether notifications are on or off, and regardless of recipients, quiet hours, digests, shelving or acknowledgment. What an automation does with them, including ignoring Homeostatic's policy, is the owner's choice.

### `homeostatic_episode`, version 1

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `entry_id` | Installation identity |
| `change` | `opened`, `updated` or `resolved` |
| `episode_id` | HealthTree episode identity; the same id as in notification requests and resolution history |
| `form` | The library's `root` or `group` |
| `anchor`, `anchor_name`, `anchor_kind` | Node id, current display name and source kind (`entity`, `device`, `integration`, `situation`, `external` or `function`) |
| `entity_ids` | The anchor's HA entity, or a device summary's selected member entities |
| `device_id`, `area_id`, `floor_id` | HA registry ids when HA supplies them, otherwise null |
| `status`, `importance` | Library status and importance |
| `reasons` | Findings with `node_id`, `check_id`, `status`, `reason` and `message` |
| `function_ids`, `functions` | Ids and names of currently affected functions; for a resolution, the functions it affected |
| `opened_at` | When the episode opened |
| `shelved`, `maintenance`, `acknowledged` | Operator state when the fact was recorded. Flags never suppress a fact |
| `resolution`, `absorbed_into` | Present on `resolved`: `cleared`, `removed` or `absorbed`, and the absorbing episode id |

`updated` fires only when status, importance, the conditions behind the reasons, or affected functions change. Repeated observations and display-name changes publish nothing. Only `cleared` is a recovery decision; `removed` means evidence was withdrawn.

### `homeostatic_control`, version 1

| Field | Meaning |
| --- | --- |
| `schema_version`, `entry_id` | As above |
| `change` | `started` or `ended` |
| `kind` | `shelve`, `maintenance` or `acknowledge` |
| `control_id` | Operator control id; null for acknowledgment |
| `episode_id` | Shelved or acknowledged episode, otherwise null |
| `node_id`, `include_dependents` | Maintenance scope, otherwise null and false |
| `until` | Control expiry, or null for acknowledgment |
| `reason` | The owner's reason text |
| `ended_reason` | On `ended`: `cancelled`, `expired`, `replaced` (a shelf was extended) or `target_removed` |

Acknowledgment publishes `started` once, on the first acknowledgment of an episode, and lasts until the episode resolves.

### Delivery and attribution

Facts publish after the state they describe is saved, before any notification request from the same change. They are published at most once: reloads and restarts do not replay them, and a failed save publishes nothing. The startup hold delays notification requests only; facts found while Home Assistant starts publish immediately. An automation that needs current truth after a restart should use the readiness sensors or the `inventory`, `explain` and `resolved_history` actions.

Each event carries a Home Assistant context for the logbook and automation traces. An episode fact's parent is the state change that caused it, when exactly one did; reconciliation and integration-entry changes have no parent. A control fact reuses the context of the action call, so HA attributes the acting user; an expiry has none. Context chaining is best effort and not part of the payload contract; `episode_id` is the join key. Parenting notification requests to their episode fact will follow the delivery changes in proposed ADR 0015.

### Entities

The overall and per-function readiness sensors are enum sensors with the options `ready`, `degraded`, `blocked` and `unknown`. Each function also has an event entity with event types `problem_opened`, `problem_changed` and `problem_resolved`, carrying `episode_id`, `anchor`, `anchor_name`, `status`, `importance` and `resolution`. Each event describes one episode entering, changing within or leaving the function's impact; use the readiness sensor to know when the function is ready again. Situations and individual sources have no entities of their own: situations already rest on an HA entity, and the bus event carries per-source identity.

The [function status light](../blueprints/automation/homeostatic/function_status_light.yaml) and [problem logbook](../blueprints/automation/homeostatic/problem_logbook.yaml) blueprints are examples. Consumers should ignore unfamiliar fields; fields are only added within a schema version.

## Notification requests

Homeostatic emits `homeostatic_notification` on the Home Assistant event bus. A consumer automation decides how to deliver it. The integration does not call a phone, TTS, notify service, or an episode persistent notification. Its own storage/configuration errors still use a native persistent notification.

### Payload version 1

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `entry_id` | Installation identity |
| `delivery_id` | Stable request id; unchanged on outbox replay |
| `episode_id` | HealthTree episode identity, or an opaque group id for a summary/digest |
| `tag` | Stable replacement/clear key scoped to the installation and recipient |
| `action` | `open`, `update`, `remind`, `escalate`, `resolve`, `summary`, or `digest` |
| `channels` | Opaque channel ids authorized for this recipient; consumers filter membership |
| `digest` | Digest id for digest deliveries, otherwise null |
| `group` | Optional opaque summary/digest membership id |
| `recipient` | Opaque configured recipient id |
| `loudness` | `digest`, `notify`, or `urgent`; record-only decisions emit no event |
| `silent` | Whether this request should avoid a new alert |
| `title`, `message` | Human-facing content, led by the affected function when available |
| `cause` | Anchor node id, or null for summary |
| `functions` | Names of affected functions |
| `resolution` | Present on resolve; `cleared`, `removed`, `absorbed`, `notifications_disabled`, or `replaced` (presentation moved to an individual message) |
| `episodes` | Current episode ids included in a summary or digest |

HA's event envelope supplies publication time. Publication means **delivery requested**, not delivered or read. A problem detail URL will be added when the problem view exists; no placeholder link is sent. Identical reminders remain new requests with new delivery ids. Silent identical individual replacements are deduplicated.

Function-to-function requirements and confirmed automation candidates contribute to affected function names and upstream importance through HealthTree. Unreviewed/rejected suggestions contribute no dependency impact. Function previews never emit notification events.

Unknown evidence does not generate an empty replacement. The last policy-authorized message remains readable in `homeostatic.inventory` under `notification_requests`; current evidence is available separately in `explain` and `episodes`.

## Consumer setup

Copy [the Companion blueprint](../blueprints/automation/homeostatic/companion_notification.yaml) into `<HA config>/blueprints/automation/homeostatic/companion_notification.yaml`, reload blueprints, and create an automation from it. Select your actual `notify.mobile_app_...` action, recipient id, and channel id. Enable that automation, select it in Homeostatic options, then activate notification events.

The blueprint uses the episode tag to replace and clear messages. It requests critical iOS sound for urgent non-silent messages; Android and device-specific sound/channel behavior must be tested on the intended phone. Silent replacement and clearing have platform limits. See the official [Companion notification documentation](https://companion.home-assistant.io/docs/notifications/notifications-basic/) and [critical notification documentation](https://companion.home-assistant.io/docs/notifications/critical-notifications/).

For another consumer, listen to this event, filter version, recipient, and channel membership, route the title/message, and use `tag` for updates/clears. Configuring an enabled automation is an owner assertion of routing; it cannot prove that arbitrary automation code handles the event or reaches a phone. A disabled/missing selected consumer appears in coverage and the evidence-gap sensor. Recipient-specific capability inspection, including a proven urgent consumer, remains a release gate.

## Restart and activation

Requests are persisted before publication, then acknowledged locally by saving an empty outbox. A crash between the two saves can replay the same `delivery_id`; consumers should deduplicate or replace by tag. The event bus does not retain events for an offline consumer. A pending opening that has recovered before publication is canceled; an idempotent clear still withdraws its tag because an unacknowledged opening might already have reached a consumer. An already published request with an unconfirmed local acknowledgement can be replayed; there is no exactly-once claim.

Enabling notifications after record-only monitoring uses HealthTree activation. It preserves episode history, starts escalation at activation, and begins reminders at each recipient's first request. Activation requests are combined by recipient when policy permits them; quiet hours and batch delays still apply. Digest-only problems wait for their scheduled digest. Record-only problems produce nothing. Ordinary reloads preserve clocks and do not replay openings.

When Home Assistant itself starts, requests are held and saved, not published. The hold lasts at least the startup grace and ends when no watched integration is still `NOT_LOADED` or `SETUP_IN_PROGRESS`, or at `startup_quiet_max` (600 seconds by default). Setup retry and errors count as finished, and disabled entries are ignored. Alerting requests made during the hold join one `summary` per recipient (group `startup_<recipient>`), including a reminder that fell due while HA was down; a request for an episode that already had its own message moves it into the summary, as activation does. Silent replacements and resolutions keep their normal form and are published when the hold ends. A reload while HA is running has no hold.

Summaries and digests retain membership. Resolutions silently refresh the group's tag with the remaining problems; the last resolution clears it. An individual reminder/escalation moves that episode out of the group and uses its own tag. Group ids are not episode ids: use the `episodes` list to find their members. Consumers should ignore unfamiliar extra fields and treat `tag` as opaque. Owner episode tags retain their original spelling for compatibility; other recipients have distinct tags.

Turning notifications off withdraws requested messages without claiming recovery. Editing the policy or batch delay while enabled withdraws old routes and activates the replacement policy. Publication remains a request, and event acknowledgements remain local outbox bookkeeping. Human acknowledgment uses the separate explicit-awareness actions below; outbox bookkeeping never supplies it.

## Operator controls

Shelving holds future alerts for the selected episode across recipients, including reminders and escalation. It preserves existing messages and permits library-authorized silent updates and resolution. It does not acknowledge receipt. Maintenance prevents new episodes in its equipment scope but leaves already-open episodes and situation alerts active. Controls are saved before resulting events are published. Previously authorized durable outbox entries keep their delivery ids and replay behavior; an operator action cannot recall a request that may already have been published.

Dashboard forms use HA's native `call_service` WebSocket command with `return_response: true` for `preview_maintenance`, `shelve`, `start_maintenance`, and, with the compatible library, `acknowledge` and `cancel_control`. They do not define a second mutation endpoint or event contract. The returned saved control confirms the adapter's durable action result, not notification receipt; uncertain failures require inspecting active controls before retrying.

## Resolution history

The `resolved_history` action and inventory field retain library resolution events even when no notification was requested. Transport actions such as `notifications_disabled` or `replaced` are not problem resolutions and never create history entries. History distinguishes `cleared`, `removed` and `absorbed`; only `cleared` represents the library's recovery decision. The historical episode is the evidence carried by the library resolution event, and `resolved_at` records when the adapter handled it. History queries never replay notification requests.

## Dashboard read transport

The dashboard uses authenticated administrator-only WebSocket commands, separate from notification events. `homeostatic/subscribe` acknowledges the subscription, sends a presentation and then pushes updates; compact subscriptions use schema version 2 to send catalog metadata once and smaller evidence updates. Standard `unsubscribe_events` removes the subscription. `homeostatic/node` accepts `node_id` for current evidence and potential impact. Configuration reads and previews never trigger notification deliveries or operator actions. Saving enabled alert requests through `homeostatic/save_alerts` reloads the integration and can request messages for already-open problems under the saved policy. Startup, errors and unload return explicit unavailability. The authoritative payload and lifecycle contract is in [spec.md](spec.md#live-dashboard).

A watched device summary uses one `device:<registry id>` anchor and availability check. `some_unavailable` is a warning against the selected availability expectation; `all_unavailable` fails that expectation. Neither proves a physical fault. The same rules apply to every integration. Persistent entity exclusions remove direct checks and summary membership. A changed exclusion set retires the previous aggregate episode as `removed`, then evaluates the remaining members; removing evidence never supplies a recovery observation. Ordinary recovery retains the library clear hold. Repeated state changes leaving status and reason unchanged do not create redundant observations; changes in condition retain their order and timestamp. Disabling a device removes its watched check and resolves its episode as removed. Hidden but enabled entities remain eligible.

## Explicit awareness

Notification publication, receipt and dismissal do not acknowledge an episode.
Administrators use `homeostatic.acknowledge` with the current `episode_id`;
the adapter derives the actor from the authenticated action context. An
acknowledgment may produce a silent update, never a recovery notice. Rules opt
in with `require_acknowledgment: true`. The dashboard displays the library's
first acknowledgment time. Phone action wiring remains a consumer increment.
