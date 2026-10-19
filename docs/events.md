# Events

Homeostatic fires events on Home Assistant's event bus so you can build your own automations on what it finds. This page lists each event, when it fires and what it carries.

| Event | Fires when | Notifications need to be on |
| --- | --- | --- |
| `homeostatic_episode` | An issue opens, changes or ends | No |
| `homeostatic_control` | An issue notification pause or equipment maintenance window starts or ends, or an issue is acknowledged for the first time | No |
| `homeostatic_notification` | Homeostatic requests a notification for one recipient | Yes |

The payloads call an issue an *episode*: one occurrence of a problem, from the moment it opens until it ends. If the same leak sensor goes offline on Monday and again on Friday, that's two episodes with different `episode_id` values. An issue keeps its `episode_id` in detected facts and `homeostatic.resolved_history`. Individual notification requests use it too. A grouped notification has its own presentation ID and lists the exact issue IDs in `episodes`.

## Detected facts for owner automations

`homeostatic_episode` and `homeostatic_control` report what Homeostatic detected and what people did about it. They fire whether notifications are on or off, and whatever the reporting choices, quiet hours, summaries, pauses or acknowledgments say. Those appear as fields in the payload and never stop an event. What your automation does with an event is up to you, including things Homeostatic's own notifications wouldn't do.

An issue reports what Home Assistant told Homeostatic, which isn't always a physical fault (see [what Homeostatic can't tell you](troubleshooting.md#what-homeostatic-cant-tell-you)). If an automation restarts an integration or power-cycles a device when an issue opens, give it a limit, such as `mode: single` and a delay, so it can't loop.

### `homeostatic_episode`

The `change` field says what happened:

- `opened` when an issue opens.
- `updated` when an open issue's status, importance or findings change. Repeated identical reports, name changes and changes to message text alone don't fire it.
- `resolved` when an issue ends. The rest of the payload describes the issue as it last stood.

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `entry_id` | The Homeostatic config entry |
| `change` | `opened`, `updated` or `resolved` |
| `episode_id` | The issue's ID |
| `form` | `root` for an issue about one source, `group` for an older grouped issue |
| `anchor` | Homeostatic's ID for the source the issue is about, such as `entry:<config entry id>` for an integration or `device:<device id>` for a device. Treat it as opaque. |
| `anchor_name` | The source's current display name |
| `anchor_kind` | `integration`, `device`, `entity`, `battery`, `vacuum`, `ups`, `thermostat`, `temperature_limit`, `situation` (an alert), `repair` (a Home Assistant Repair), or `broken_automation` (an automation that names a missing entity). `null` when the source no longer exists. |
| `entity_ids` | The source's entity, or a device's watched entities. Empty for an integration or an alert from an automation. |
| `device_id`, `area_id`, `floor_id` | The source's Home Assistant device, area and floor IDs, or `null` |
| `status` | `warn`, `fail` or `unknown` |
| `importance` | `low`, `normal`, `high` or `critical`. |
| `reasons` | The findings behind the issue. Each has `node_id` (the source with the finding), `check_id` (`availability`, `entity_not_provided`, `battery`, `vacuum`, `ups_power`, `ups_reserve`, `ups_battery_replacement`, `ups_fault`, `thermostat`, `temperature_limit`, `condition`, `repair`, `broken_automation`, or `null` on a finding about grouped sources), `status`, `reason` (a short code such as `unavailable`, `active`, `stale` or `dependents_failing`) and `message` (readable text, or `null`). |
| `opened_at` | When the issue opened, as an ISO 8601 timestamp |
| `shelved` | Whether the issue's notifications were paused |
| `maintenance` | Whether the source was covered by an equipment maintenance window |
| `acknowledged` | Whether someone had acknowledged the issue |
| `resolution` | Only on `resolved`. `cleared` means the problem ended. `removed` means Homeostatic stopped watching the source or changed what it checks, which says nothing about the problem. `absorbed` means the issue became part of another issue. `split` means the problems continue as separate issues, without established recovery. History shows **Cleared**, **Monitoring ended**, **Joined another problem** or **Issues separated**. |
| `absorbed_into` | Only on `resolved`: the ID of the issue that absorbed this one, or `null` |
| `split_into` | On `resolved`: the exact continuing issue IDs for `split`, otherwise an empty list |
| `split_from` | On successor `opened` events: the predecessor issue ID whose controls and attention state were retained |

Vacuum evidence gaps use `vacuum_unavailable`, `vacuum_unknown`, `vacuum_missing`, `vacuum_restored` or `vacuum_unrecognized`, each with status `unknown`.

Entities not provided findings use check `entity_not_provided`, with reason `entity_not_provided` for a qualified warning and `entity_provided` for a live entity. While the owning integration is starting or unloaded the reason is `provider_not_loaded`, and when ownership can't be confirmed it's `provider_not_confirmed`; both have status `unknown` and request no notifications.

### `homeostatic_control`

`change` is `started` or `ended`. Pausing notifications and starting work on equipment fire both. Acknowledge fires `started` once, the first time an issue is acknowledged, and never fires `ended`: an acknowledgment lasts until the issue ends.

| Field | Meaning |
| --- | --- |
| `schema_version`, `entry_id` | As for `homeostatic_episode` |
| `change` | `started` or `ended` |
| `kind` | `shelve` (**Pause**), `maintenance` (equipment maintenance through a Home Assistant action) or `acknowledge` |
| `control_id` | The control's ID, for `homeostatic.cancel_control`. `null` for `acknowledge`. |
| `episode_id` | The issue, for `shelve` and `acknowledge`. `null` for `maintenance`. |
| `node_id` | The source, for `maintenance`. `null` otherwise. |
| `include_dependents` | For `maintenance`, whether it also covers dependent equipment. `false` otherwise. |
| `until` | When the control ends, as an ISO 8601 timestamp. `null` for `acknowledge`. |
| `reason` | The reason entered, or an empty string |
| `ended_reason` | Only on `ended`. `cancelled` means someone ended it early. `expired` means its end time passed. `replaced` means a pause was extended, and a new `started` follows. `target_removed` means the issue ended or the source is no longer watched. |

### Example: critical issues in the notification list

This automation adds an entry to Home Assistant's notification list (the bell in the sidebar) when a critical issue opens, and removes it when the issue ends. It works whether Homeostatic's own notifications are on or off.

```yaml
alias: Critical Homeostatic issues in the notification list
mode: queued
triggers:
  - trigger: event
    event_type: homeostatic_episode
    event_data:
      schema_version: 1
      change: opened
      importance: critical
    id: opened
  - trigger: event
    event_type: homeostatic_episode
    event_data:
      schema_version: 1
      change: resolved
    id: resolved
actions:
  - variables:
      notification_id: "issue_{{ trigger.event.data.episode_id }}"
  - choose:
      - conditions:
          - condition: trigger
            id: opened
        sequence:
          - action: persistent_notification.create
            data:
              notification_id: "{{ notification_id }}"
              title: "{{ trigger.event.data.anchor_name }}"
              message: >-
                {{ trigger.event.data.reasons | map(attribute='message') | select | join('\n')
                   or 'Open Homeostatic for details.' }}
    default:
      - action: persistent_notification.dismiss
        data:
          notification_id: "{{ notification_id }}"
```

It catches issues that are critical when they open. An issue whose importance rises later arrives as `updated`, so add a trigger for that if you need it. Dismissing an entry that doesn't exist does nothing, so the `resolved` trigger can safely fire for every issue.

## Notification requests

### `homeostatic_notification`

Homeostatic fires `homeostatic_notification` once for each notification it requests for one recipient, after notification timing, delivery windows, pauses and acknowledgments have had their say. It fires only while notifications are on, apart from the withdrawals sent when you turn notifications off (see [Restart and activation](#restart-and-activation)) or remove Homeostatic.

Homeostatic's built-in sender listens for this event too. It handles `phone:` Companion app targets, `notify:` notification entities, `satellite:` announcements, `tts:` provider/player pairs, and `sms:` notification actions with recipient targets. Other channels are for your own automation; the Companion notifications blueprint uses a channel called `event`. An event records a request; it doesn't show that anyone received it.

Each notification a policy uses is handled on its own, so one issue can produce an immediate request and later appear in a summary for the same delivery method. Presence decides the destinations when a request is prepared; a presence change alone sends nothing. Destinations other than Companion phones ignore silent updates and withdrawals, so cleanup never speaks or sends an email or text.

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` |
| `entry_id` | The Homeostatic config entry |
| `delivery_id` | This request's ID. It stays the same if the request is fired again after a restart. See [Delivery replay and deduplication](#delivery-replay-and-deduplication). |
| `action` | What the request does. See the table below. |
| `recipient` | `method:<method id>` for a delivery method, or a custom policy recipient such as `owner` |
| `route` | The stable identity of a policy notification entry. A grouped request can contain several entries; use `routes` for its complete route membership. Omitted when no entry applies. |
| `routes` | On grouped requests, the independent notification-entry identities represented. Treat each as opaque. |
| `channels` | The resolved destinations for this request: `phone:<device id>`, `notify:<entity registry id>`, `satellite:<entity registry id>`, `tts:<provider registry id>:<player registry id>`, `sms:<notify action>:<URL-encoded recipient>`, or custom channels such as `event`. Act only when your channel is listed. |
| `episode_id` | An issue ID on individual and standalone-entity requests; an opaque presentation ID on a collected message, device message, summary or digest. Use `episodes` for exact grouped membership. |
| `tag` | An opaque key for replacing or clearing this message. A grouped message keeps its key through membership changes and restart. |
| `title` | The source, device or alert name. On a collected message, `Homeostatic: 3 issues need attention`; on other summaries, `Homeostatic: 3 open problems`. |
| `message` | The issue's findings. On a summary, one line per issue. On `resolve`, a short note such as `Problem cleared.` |
| `loudness` | `digest`, `notify` or `urgent` |
| `silent` | `true` when the request replaces an earlier message without alerting again |
| `digest` | The report's identifier on digest requests; otherwise `null`. Treat it as opaque. |
| `group` | On collected messages, device messages, summaries and digests: the opaque presentation-group ID |
| `notification_id` | On collected messages, the saved notification identity. Renaming does not change it. |
| `episodes` | The exact issue IDs represented by a grouped request. Empty when its last member ends and the message is withdrawn. |
| `notification_subject` | When present, the canonical device or source identity used for notification presentation; it does not assert a common cause. |
| `notification_subject_name` | The display name of that subject. |
| `cause` | Homeostatic's ID for the issue's source, or `null` on a grouped request |
| `age` | On an issue's request, how long the issue had been open, in whole hours, such as `3h` |
| `previously_reported` | Whether this recipient had been told about the issue before. Digests use it to mark each issue as new or still outstanding. |
| `resolution` | Only on `resolve`. See the second table below. |

| `action` | Meaning |
| --- | --- |
| `open` | An issue first qualifies for attention; it can join a collected message |
| `activate` | Existing findings qualify when outgoing notifications are enabled or their delivery instructions change |
| `update` | The issue or grouped message changed. Often `silent`. |
| `remind` | A repeat at the notification entry's configured reminder interval until someone acknowledges |
| `escalate` | A custom notification policy raised the loudness after a delay |
| `summary` | A restart or activation summary for source kinds without device or entity subjects, such as integrations or Repairs |
| `digest` | A scheduled report of eligible open problems |
| `resolve` | Withdraw or replace an earlier message, for the reason in `resolution` |

| `resolution` | Meaning |
| --- | --- |
| `cleared` | The problem ended |
| `removed` | Homeostatic stopped watching the source, or Homeostatic itself was removed. The problem may still be there. |
| `absorbed` | The issue became part of another issue |
| `split` | The problems continue as separate issues; withdraw the old message without announcing recovery |
| `notifications_disabled` | Notifications were turned off, or the notification settings changed. The problem may still be open. |
| `replaced` | Presentation moved to another notification subject or summary; monitoring continues |

### Collected notification messages

Requests for the same named notification, recipient and destination that arrive within its collection delay share one message, whatever their causes. The payload carries `notification_id`, the exact `episodes` and `routes`, and its own `tag`; its `episode_id` identifies the message, not an issue. A later window gets a new message. Scheduled summaries don't wait for collection.

When one of its issues ends, a silent update keeps the tag and lists the issues still open. Pending collections survive a restart.

The phone **Acknowledge** button acknowledges exactly the issues that message showed. Tapping a message with several issues opens **Issues in this notification**, limited to those issues; tapping acknowledges nothing.

### Summaries and digests

A summary or digest has its own `episode_id` and `tag`, which aren't issue IDs. Use `episodes` to see which issues it holds.

When an issue in a summary ends, Homeostatic sends a silent `update` with the remaining issues under the same tag. When the last one ends, it sends `resolve` with an empty `episodes` list. A reminder or escalation for one issue moves that issue out of the summary and into a message of its own.

## Delivery replay and deduplication

Homeostatic saves each request before it fires the event, then saves again to mark it as sent. If Home Assistant stops between those two saves, the request fires again after the restart with the same `delivery_id`. Your automation can therefore see the same request twice. Either skip a `delivery_id` you've already handled, or send with `tag` so the repeat replaces the first message on the phone. The Companion notifications blueprint uses the tag.

Resolved targets are saved with the request. Replay keeps them even if someone has arrived home or left since the request was prepared. Silent updates and cleanup use the destinations of previous requests. A later presence change cannot introduce unseen findings into a silent update sent to an earlier destination. Fields beginning with `_` are internal delivery bookkeeping; consumers must ignore them.

Two kinds of repeat are deliberate. A reminder is a new request with a new `delivery_id`, even when its text matches the last one. A silent update that would change nothing isn't fired at all.

You may also get a `resolve` for a message your automation never saw, for example when an issue ends during the startup hold. Clearing a tag that isn't on the phone is harmless.

The event bus doesn't keep events. If your automation is off or Home Assistant is down when a request fires, nothing sends it again later.

The built-in sender records each `delivery_id` and channel before it sends, so a replayed request doesn't reach the phone twice. If Home Assistant stops after that record is saved and before the send, that one message is lost.

## Restart and activation

When Home Assistant starts, Homeostatic holds notification requests while your integrations load. The hold lasts at least **Wait after startup** (120 seconds by default). After that it ends as soon as no watched integration is still loading, or at **Maximum startup wait** (600 seconds by default). Integrations that are retrying or failed to set up count as finished, and disabled ones are ignored. Both timings are in **Settings**.

Collection windows start after the startup hold and any pause end. An overdue reminder updates its previous message once. Silent updates and withdrawals go out when the hold ends. Reloading Homeostatic while Home Assistant is running has no hold.

`homeostatic_episode` and `homeostatic_control` aren't held. They fire as Homeostatic detects things, during startup too. They're never replayed after a restart or reload, so an automation that was off misses them. To get the current state after a restart, read the readiness sensors, or call `homeostatic.inventory`, `homeostatic.explain` or `homeostatic.resolved_history` (see the [reference](reference.md#actions)).

When you turn notifications on, Homeostatic looks at the issues already open. Immediate entries begin their configured collection window when eligible; daily-hours entries also wait for their delivery hours. Scheduled entries wait for their next occurrence. Dashboard-only monitoring sends nothing. Escalation timing starts when notifications were turned on, and reminders start from the first request on each entry. Issue history and ages don't change.

Changing a policy's notifications, a named notification or a delivery method while notifications are on withdraws the affected messages with `resolve` and `notifications_disabled`, and the changed entries start afresh. A collection already waiting keeps its deadline. Renaming alone changes nothing.

Turning notifications off withdraws every outstanding message with `resolve` and `notifications_disabled`. The problems may still be open.

## Order and context

Homeostatic saves the state an event describes before it fires the event. `homeostatic_episode` and `homeostatic_control` events from one change fire before any notification request from that change. If the save fails, nothing fires.

`homeostatic_episode` and `homeostatic_control` events carry a Home Assistant context, so the logbook and automation traces can show where they came from. A `homeostatic_episode` event's parent is the state change that caused it, when exactly one did. A `homeostatic_control` event reuses the context of the action call, so the logbook shows who acted. An expiry has no parent, and notification requests have no parent either. Use context for tracing only, and connect events through `episode_id`.

## Compatibility

Every payload carries `schema_version: 1`. Within a version, fields are only ever added, never renamed or removed, so ignore fields you don't recognize and match `schema_version: 1` in your triggers. Treat IDs and tags as opaque text.

Homeostatic's own Acknowledge button on phones arrives as a `mobile_app_notification_action` event whose `action` starts with `HOMEOSTATIC_ACK_`. Homeostatic handles it, and it isn't meant for your automations. The panel's WebSocket commands aren't an automation interface either; [spec.md](spec.md#live-dashboard) describes them.
