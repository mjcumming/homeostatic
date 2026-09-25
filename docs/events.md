# Notification event contract

Homeostatic emits `homeostatic_notification` on the Home Assistant event bus. A consumer automation decides how to deliver it. The integration does not call a phone, TTS, notify service, or an episode persistent notification. Its own storage/configuration errors still use a native persistent notification.

## Payload version 1

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

Summaries and digests retain membership. Resolutions silently refresh the group's tag with the remaining problems; the last resolution clears it. An individual reminder/escalation moves that episode out of the group and uses its own tag. Group ids are not episode ids: use the `episodes` list to find their members. Consumers should ignore unfamiliar extra fields and treat `tag` as opaque. Owner episode tags retain their original spelling for compatibility; other recipients have distinct tags.

Turning notifications off withdraws requested messages without claiming recovery. Editing the policy or batch delay while enabled withdraws old routes and activates the replacement policy. Publication remains a request, and event acknowledgements remain local outbox bookkeeping. Human acknowledgment is not implemented by this increment.

## Operator controls

Shelving holds future alerts for the selected episode across recipients, including reminders and escalation. It preserves existing messages and permits library-authorized silent updates and resolution. It does not acknowledge receipt. Maintenance prevents new episodes in its equipment scope but leaves already-open episodes and situation alerts active. Controls are saved before resulting events are published. Previously authorized durable outbox entries keep their delivery ids and replay behavior; an operator action cannot recall a request that may already have been published.

## Resolution history

The `resolved_history` action and inventory field retain library resolution events even when no notification was requested. Transport actions such as `notifications_disabled` or `replaced` are not problem resolutions and never create history entries. History distinguishes `cleared`, `removed` and `absorbed`; only `cleared` represents the library's recovery decision. The historical episode is the evidence carried by the library resolution event, and `resolved_at` records when the adapter handled it. History queries never replay notification requests.

## Dashboard read transport

The dashboard uses authenticated administrator-only WebSocket commands, separate from notification events. `homeostatic/subscribe` acknowledges the subscription, sends a schema-version-1 presentation, then pushes updates; standard `unsubscribe_events` removes it. `homeostatic/node` accepts `node_id` for current evidence and potential impact. These commands never trigger notification deliveries or operator actions. Startup, errors and unload return explicit unavailability. The authoritative payload and lifecycle contract is in [spec.md](spec.md#live-dashboard).
