# Notification event contract

Homeostatic emits `homeostatic_notification` on the Home Assistant event bus. A consumer automation decides how to deliver it. The integration does not call a phone, TTS, notify service, or an episode persistent notification. Its own storage/configuration errors still use a native persistent notification.

## Payload version 1

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `entry_id` | Installation identity |
| `delivery_id` | Stable request id; unchanged on outbox replay |
| `episode_id` | HealthTree episode identity; `activation` for an activation summary |
| `tag` | Stable replacement/clear key scoped to the installation |
| `action` | `open`, `update`, `resolve`, or `summary` |
| `recipient` | Opaque recipient id; `owner` in the initial policy |
| `loudness` | `notify` or `urgent` in the initial policy |
| `silent` | Whether this request should avoid a new alert |
| `title`, `message` | Human-facing content, led by the affected function when available |
| `cause` | Anchor node id, or null for summary |
| `functions` | Names of affected functions |
| `resolution` | Present on resolve; `cleared`, `removed`, `absorbed`, or `notifications_disabled` |
| `episodes` | Episode ids included in an activation summary |

HA's event envelope supplies publication time. Publication means **delivery requested**, not delivered or read. A problem detail URL will be added when the problem view exists; no placeholder link is sent. Reminder, escalation and digest actions are reserved for the policy increment and are not emitted yet.

Unknown evidence does not generate an empty replacement. The last policy-authorized message remains readable in `homeostatic.inventory` under `notification_requests`; current evidence is available separately in `explain` and `episodes`.

## Consumer setup

Copy [the Companion blueprint](../blueprints/automation/homeostatic/companion_notification.yaml) into `<HA config>/blueprints/automation/homeostatic/companion_notification.yaml`, reload blueprints, and create an automation from it. Select your actual `notify.mobile_app_...` action and the recipient id. Enable that automation, select it in Homeostatic options, then activate notification events.

The blueprint uses the episode tag to replace and clear messages. It requests critical iOS sound for urgent non-silent messages; Android and device-specific sound/channel behavior must be tested on the intended phone. Silent replacement and clearing have platform limits. See the official [Companion notification documentation](https://companion.home-assistant.io/docs/notifications/notifications-basic/) and [critical notification documentation](https://companion.home-assistant.io/docs/notifications/critical-notifications/).

For another consumer, listen to this event, filter version and recipient, route the title/message, and use `tag` for updates/clears. Configuring an enabled automation is an owner assertion of routing; it cannot prove that arbitrary automation code handles the event or reaches a phone. A disabled/missing selected consumer appears in coverage and the evidence-gap sensor. Recipient-specific capability inspection, including a proven urgent consumer, remains a release gate.

## Restart and activation

Requests are persisted before publication, then acknowledged locally by saving an empty outbox. A crash between the two saves can replay the same `delivery_id`; consumers should deduplicate or replace by tag. The event bus does not retain events for an offline consumer. A pending opening that has recovered before publication is canceled; an idempotent clear still withdraws its tag because an unacknowledged opening might already have reached a consumer. An already published request with an unconfirmed local acknowledgement can be replayed; there is no exactly-once claim.

Enabling notifications after record-only monitoring emits one summary of problems already open. It is explicitly an **activation-time snapshot**, not a live problem count. Subsequent updates and resolutions use their episode tags. Ordinary reloads do not replay all openings. Turning notifications off withdraws previously requested messages without claiming their episodes recovered.
