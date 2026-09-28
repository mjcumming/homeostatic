# Proposed spec section: notification settings and built-in delivery

**Status:** Accepted direction under [ADR 0015](../adr/0015-deliver-notifications-to-people.md); implementation in progress. The delivered subset is described in `spec.md` and `events.md`. This proposal remains the target for announcements, phone controls, and remaining delivery behavior.

The owner reporting direction is now [five fixed reporting preferences](reporting-preferences.md), recorded in [ADR 0026](../adr/0026-fixed-reporting-preferences.md). It replaces broad person levels as the target reporting interface and introduces guided morning, evening, and weekly schedules. This older proposal remains context for delivery and audience work; its level and digest-deferral choices do not override the new direction. Runtime behavior has not changed.

## Outcome

Each person hears about the problems they can act on, on their phone. Urgent things that happen in the house can also be spoken at home. Every problem is heard once: not again after a restart, not duplicated, and one tap tells everyone it is handled.

## Two audiences

The audience is decided by who can act on a problem, not by how bad it is.

- **Administrators** (HA users with administrator rights) can fix Home Assistant. They receive **faults**: equipment, integration and function problems, the `fault` category.
- **Household members** (every other person) cannot fix Home Assistant. They receive **home alerts** only: situations such as a water leak or a door left open, the `situation` category. An integration going offline tells a household member nothing they can use.
- **Administrators get home alerts too.**
- **Evidence gaps** (status `unknown`) are not notifications. "We don't know what happened" is shown on the dashboard, not sent. The one exception: a gap at `critical` importance is sent once to administrators, as a normal (not urgent) notification with no reminders. An example is a leak sensor that has gone silent, which means the house is blind to leaks.

## Settings page

The dashboard gains a top-level **Notifications** page ([ADR 0022](../adr/0022-top-level-notifications-page.md)). Like the rest of the dashboard it is administrator-only. It edits the same options entry as native options; there is no second configuration store.

```
Notifications                                             [ On ● ]

Michael · administrator                                   [Send test]
  Tell me about   ( ) Everything  (●) Important  ( ) Urgent only  ( ) Off
  Phones          [x] iPhone 16   [x] iPad
  Also send to    [ notify.michael_email ▾ ]   + add
  Quiet hours     22:00 – 07:00   (urgent still comes through)

Sarah · household                                         [Send test]
  Home alerts     (●) All  ( ) Urgent only  ( ) Off
  Phones          [x] Pixel 9
  Quiet hours     off

Announcements                                             [Send test]
  Speak home alerts   ( ) Important  ( ) Urgent only  (●) Off
  Speakers        (none selected)   + add
  Quiet hours     22:00 – 07:00   (urgent still comes through)

Right now: 3 open problems → Michael 2, Sarah 0, Announcements 0.
[ + Add person ]                     Advanced: edit policy YAML →
```

- **People.** "Add person" lists HA `person` entities that have a linked user. The role comes from that user's administrator flag. A change of role changes the card on the next save, with a preview.
- **Phones.** Phones are the mobile app devices registered by that user, pre-checked when first added. A new phone registered later appears unchecked, with a "new" marker.
- **Also send to.** This lists other `notify` entities (email, ntfy, Telegram and so on).
- **Speakers.** This lists `assist_satellite` entities, plus `media_player` entities that support announcements. Media players use the TTS engine selected once for announcements. It defaults to the pipeline's engine.
- **Announcements start Off with no speakers selected.** They speak **home alerts only**. A fault is never spoken.
- **Right now.** The preview line uses the existing read-only `preview_policy` against current episodes and sends nothing.
- **Saving.** Save uses the existing preview-then-save workflow, reloads, and retains episode and policy continuity.

## Levels generate the policy

The page writes a generated `policy`. Tiers use effective importance; the category comes from the check label `category`.

| Rule (in order) | Match | Loudness | To | Reminder |
| --- | --- | --- | --- | --- |
| 1 | status `unknown`, importance `critical` | `notify` | Administrators not Off | none |
| 2 | status `unknown` | `record` | nobody (dashboard only) | none |
| 3 | importance `critical`, `situation` | `urgent` | Administrators not Off; household not Off; Announcements at Urgent only or Important | 30 min until acknowledged |
| 4 | importance `critical` | `urgent` | Administrators not Off | 30 min until acknowledged |
| 5 | importance `high`, `situation` | `notify` | Administrators at Everything or Important; household at All; Announcements at Important | none |
| 6 | importance `high` | `notify` | Administrators at Everything or Important | none |
| 7 | `situation` | `notify` | Administrators at Everything; household at All | none |
| 8 | any other | `notify` | Administrators at Everything | none |

Urgent reminders use `require_acknowledgment: true`. Quiet hours and the batch delay follow the existing library behaviour: `urgent` bypasses quiet hours.

- **Generated marker.** The generated policy carries `generated: simple-v1` and a hash.
- **Custom policies.** If the saved policy lacks the marker or its hash no longer matches, the page shows **Custom policy (edited in YAML)**. The levels are read-only, the preview line still works, and there is a **Reset to simple settings** action that previews before saving.
- **Existing installations.** An installation still on the shipped default (`owner` / `event`) opens in simple mode. The owner picks which administrator `owner` is, and the `event` channel is kept, so an existing blueprint continues to work.

## Recipient and channel identity

| Kind | Recipient id | Channel id | Delivered by |
| --- | --- | --- | --- |
| Person | `person:<person id>` | `phone:<mobile_app device id>` | Built-in sender |
| Person | same | `notify:<entity registry id>` | Built-in sender |
| Announcements | `announcements` | `announce:<entity registry id>` | Built-in sender |
| Any | any | any id without these prefixes (e.g. `event`) | Consumer automations only |

Registry ids survive renames. The page shows current names. A missing device or entity appears as **target lost** with a remap choice; it is never silently dropped.

## Built-in sender

The sender handles each request after it is saved in the outbox and published as `homeostatic_notification`. The payload is unchanged apart from the channel ids. It skips delivery ids it has already handled in the current runtime.

| Request | Phone (`notify.mobile_app_*`) | Message (`notify.send_message`) | Announcement |
| --- | --- | --- | --- |
| `open`, `escalate` | Title and message; `tag`; group `homeostatic`; buttons | Title and message | Speak the title (home alerts at or above the level only) |
| `remind` | Same as open | Title and message | Speak only the first reminder |
| `update` (silent) | Same tag, no sound (iOS `interruption-level: passive`, Android `alert_once`) | Nothing | Nothing |
| `update` (not silent) | Same tag, with sound | Title and message | Nothing |
| `summary`, `digest` | Group tag; lists the problems | Title and message | Nothing |
| `resolve` of an `urgent` episode | Silent replacement: "Resolved at 3:40 AM · <title>" | "Resolved: <title>" | Nothing |
| `resolve` otherwise | `clear_notification` on the tag | "Resolved: <title>" | Nothing |

- **`urgent` on phones:** iOS `interruption-level: critical` with sound, and Android high priority on the channel `Homeostatic urgent`. Whether a phone overrides Do Not Disturb depends on phone settings, so the test action reports "requested", not "rang".
- **Speech:** `assist_satellite.announce` (`message`, default chime) or `tts.speak` with `media_player_entity_id`. The spoken text is the title only, so no evidence detail is read aloud.
- **Titles are written to be read aloud:** short, plain words, the place last ("Water leak in the basement"). Entity ids and codes go in the message body, never the title.
- **Failures:** a failed service call is logged and recorded in `inventory.delivery_failures`, which keeps the latest 50. The page shows the latest failure for each route. It does not retry. A successful call records `requested_at` only.

## Phone buttons

| Button | Action id | Administrators | Household | Effect |
| --- | --- | --- | --- | --- |
| Got it | `HOMEOSTATIC_ACK::<episode_id>` | yes | yes | Library acknowledgment |
| Snooze 1 hour | `HOMEOSTATIC_SNOOZE::<episode_id>` | yes | no | Shelve for 1 hour (applies to everyone) |
| Open | URI to the problem view, when it exists | yes | no | Navigation only; the dashboard is administrator-only |

- Buttons appear on openings, reminders and escalations for episodes. Summaries carry only Open, and only for administrators.
- **Household members get Got it only.** Snooze shelves the episode for every recipient, so a household member must not be able to silence an administrator.
- **After Got it,** every other recipient's phone notification is silently replaced with "<name> has it · <title>". Reminders stop for everyone. Announcements are not repeated.
- The integration listens for `mobile_app_notification_action`.
- **Authorization:** the event's context user must be the user of the person whose recipient id received a delivery for that episode, the button must be allowed for that person's role, and the episode must still be open. Otherwise it is ignored and logged. The actor recorded is that user.
- **Persistence:** actions go through the same runtime lock, save-before-confirm and storage-failure behaviour as the administrator actions.
- **Scope:** dismissing or swiping a notification does nothing.

## Test

`homeostatic.test_notification` (administrator) takes a recipient and a channel. It sends "Homeostatic test: this route works" through the built-in sender, bypassing policy, quiet hours and the outbox. It creates no episode and changes no clocks. It returns `requested` or the service error.

## Activation

Enabling notifications requires at least one enabled built-in route or a selected enabled consumer automation. Coverage reports a recipient with no deliverable route, and it reports "no route for `urgent`" when no recipient would receive rule 1.

## Restarts

**Implemented on `feat/people-delivery`:** the quiet period, the startup summary and the no-burst reminder (scenarios 13–16). Crash-replay handling arrives with the built-in sender.

A restart should be invisible unless something is actually wrong once HA is back up.

- **Startup quiet period.** Nothing is sent while Home Assistant starts. The quiet period ends when every watched integration has finished loading, or after 10 minutes, whichever comes first. "Finished" means the entry is no longer `NOT_LOADED` or `SETUP_IN_PROGRESS`. An entry in setup retry counts as finished, so it cannot hold the period open. The existing startup grace (120 s) becomes the minimum. The 10-minute cap is an advanced option, not on the settings page.
- **One message after startup.** Everything that became deliverable during the quiet period goes out as one summary per recipient. That includes new problems and reminders that fell due while HA was down. It never goes out as individual messages. Problems that recovered during the quiet period are not mentioned. Announcements never speak a startup summary.
- **Catch-up reminders.** A reminder that fell due while HA was down is folded into that summary once. Its next reminder is scheduled from the summary time, never back-filled.
- **Crash replay.** A request replayed from the outbox is sent to phones silently, replacing by tag. Announcements and plain messages are sent at most once: the sender records an attempt before calling, and skips a replayed request that already has an attempt.

Existing behaviour is unchanged: restored states count as unknown, open problems and clocks persist, and recovery during downtime closes quietly after the clear hold.

## What is configurable

The settings page holds levels, phones, other destinations, speakers and quiet hours. Nothing else goes on it.

Durations (startup grace and cap, settle, holds, batch delay) stay in the existing native options with their defaults. They are not surfaced until the pilot shows a household that needs them.

There is no per-warning mute switch. Owners already have three ways to silence something:

- **Ignore this check** (persistent exclusion, ADR 0012) for something that should never be watched.
- **Snooze** or **shelve** for something known and temporary.
- **Maintenance** for planned work.

## Walkthroughs

Five stories run end to end against this proposal, with draft message text. The household used in all five:

- **Michael:** administrator, Important, quiet hours 22:00–07:00.
- **Sarah:** household, All home alerts.
- **Announcements:** Urgent only, kitchen satellite. The owner turned this on; the default is Off.

Times are local.

### 1. Water leak at 3 a.m.

The basement leak sensor reports wet at 03:02. This is a situation at `critical` importance, so rule 3 applies: urgent, which bypasses quiet hours.

| Time | Michael's phone | Sarah's phone | Kitchen speaker |
| --- | --- | --- | --- |
| 03:02 | **Water leak in the basement** · "Basement leak sensor reported water at 3:02 AM." Critical sound. Got it · Snooze 1 hour · Open | Same text, critical sound. Got it | Chime, "Water leak in the basement." |
| 03:04 Sarah taps Got it | Silently replaced: "Sarah has it · Water leak in the basement" | Unchanged | Nothing |
| 03:40 sensor dry, situation clears | Silently replaced: "Resolved at 3:40 AM · Water leak in the basement" | Same | Nothing |

If nobody taps, reminders go every 30 minutes, the speaker repeats once at 03:32, and then stays quiet. In the morning, Michael can still see what happened at 3 a.m., because an urgent resolution replaces the notification rather than clearing it.

### 2. The Zigbee coordinator goes down

The ZHA entry fails at 14:12, and 40 devices behind it go unavailable. HealthTree coalesces them into one episode anchored on the integration after the settle period. Three declared functions depend on it, and the highest is `high`, so rule 6 applies.

| Time | Michael | Sarah | Speaker |
| --- | --- | --- | --- |
| ~14:14 | **Zigbee network is down** · "ZHA stopped responding at 2:12 PM. 40 devices and 3 functions affected: basement lighting, hall motion, garage door sensor." Got it · Snooze 1 hour · Open | Nothing (fault) | Nothing (faults are never spoken) |
| More devices report during the outage | Silent update of the same notification | — | — |
| 14:31 recovered, after the clear hold | Cleared | — | — |

There is one message, not 40. Sarah hears nothing, because she cannot fix it.

### 3. The freezer sensor's battery dies

The garage freezer temperature sensor goes silent.

- **HA reports `unavailable`.** This is a fault. If the "Freezer monitoring" function is declared `high`, Michael gets **Freezer monitoring stopped** · "Garage freezer sensor has been unavailable since 9:10 AM. Check its battery or connection." If it is left at normal importance, the problem appears on the dashboard only (Michael is at Important).
- **HA keeps the last value and the sensor just stops reporting** (unknown evidence). This is dashboard-only, unless freezer monitoring is `critical`. In that case Michael gets one normal notification: **Freezer sensor stopped reporting** · "No reading from the garage freezer sensor since 9:10 AM. Homeostatic can't tell whether the freezer is OK." No reminders.
- **Sarah hears nothing in either case.** If the freezer actually warms up, that is a situation, and it would reach her.

### 4. Home Assistant restarts after an update

HA stops at 02:00 and is back at 02:03. Z-Wave JS takes 4 minutes to load. The garage freezer sensor from story 3 is still unavailable, and its reminder fell due during the restart.

| Time | Michael | Sarah | Speaker |
| --- | --- | --- | --- |
| 02:03–02:07 quiet period (waiting for Z-Wave JS) | Nothing | Nothing | Nothing |
| 02:07 quiet period ends | Held: Michael's quiet hours run to 07:00, and this is not urgent | Nothing (no home alert in it) | Nothing |
| 07:00 | One reminder: **Freezer monitoring stopped** · "Unavailable since 9:10 AM." The library held it through quiet hours. | — | — |

Z-Wave devices that were unavailable during loading never open a problem. The restart itself never wakes anyone, because only urgent problems bypass quiet hours. If nothing is wrong after a restart, nothing is sent.

### 5. Michael is at the cabin; the garage is left open

The "Garage door open after 22:00" situation opens at 22:15 at `high` importance, so rule 5 applies. Michael's quiet hours hold `notify` until 07:00. Sarah has no quiet hours.

| Time | Michael | Sarah | Speaker |
| --- | --- | --- | --- |
| 22:15 | Held by quiet hours | **Garage door is open** · "The garage door has been open since 10:15 PM." Got it | Nothing (`high`; speaker is set to Urgent only) |
| 22:18 Sarah taps Got it | — | Unchanged | — |
| 22:20 door closed, situation clears | The held message is cancelled; nothing is sent | Cleared | — |
| 07:00 | Nothing: it resolved before delivery. It appears in resolved history. | — | — |

Sarah is not an administrator. Her Got it is accepted because she received this episode and Got it is allowed for household members. She had no Snooze button, so she could not silence Michael.

### Holes these stories found, and what changed

- **Urgent resolutions vanished.** They are now replaced with "Resolved at …" instead of cleared (story 1).
- **Voice repeated every 30 minutes at night.** The speaker now says the opening and one reminder only (story 1).
- **A household Snooze could silence an administrator.** Household members now get Got it only (story 5).
- **Faults could be spoken.** Announcements now speak home alerts only (story 2).
- **Titles were not written to be read aloud.** A title rule was added (story 1).

## Acceptance scenarios

1. A new person with two phones receives an urgent opening on both, with critical data, tag and buttons; resolution clears both.
2. An Important-level person receives a `high` episode; an Urgent-only person does not.
3. A silent update replaces the phone notification without sound, sends nothing to message targets and says nothing on speakers.
4. An urgent home alert during quiet hours reaches phones and enabled speakers; a `notify`-level one waits.
5. *Got it* from the recipient's phone acknowledges and stops reminders for all recipients. The same button from another user's phone is ignored.
6. *Snooze 1 hour* shelves the episode; reminders resume after expiry.
7. Outbox replay after a simulated crash re-sends with the same tag. Within one runtime a delivery id is sent once.
8. A failing `notify` action is recorded in `delivery_failures`; the episode and outbox are unaffected.
9. A custom YAML policy shows read-only levels; resetting previews and then saves the generated policy.
10. The shipped default with the existing blueprint still delivers through the `event` channel after migration to simple mode.
11. A removed phone shows "target lost"; the remaining routes still deliver.
12. The test action sends one message and leaves the policy state byte-identical.
13. A restart where one watched integration loads after 5 minutes opens no problem for it and sends nothing.
14. A restart with two real new problems and one overdue reminder sends exactly one summary per recipient after the quiet period, and nothing to speakers.
15. An integration stuck in setup retry does not extend the quiet period; after the minimum it follows ordinary retry escalation.
16. With no integration finishing, the quiet period ends at the 10-minute cap.
17. A replayed outbox request re-sends silently to phones and does not repeat an announcement or message.
18. A household member receives a critical situation but not a critical fault, an integration outage or an evidence gap.
19. A critical evidence gap sends one notify-level message to administrators with no reminders; a non-critical gap sends nothing.
20. A household member's phone offers only Got it; a crafted Snooze action from that phone is ignored.
21. After Got it, the other recipients' notifications are silently replaced with "<name> has it" and nothing is spoken.
22. An urgent resolution replaces the phone notification with a resolved line; a non-urgent resolution clears it.
23. A speaker says an unacknowledged urgent home alert at most twice (the opening and the first reminder) and never speaks a fault.
24. The five walkthroughs replay as integration scenarios with the message text above.

## Open questions

- Can the startup summary reuse HealthTree activation summaries without resetting escalation clocks, or does the library need a "summarize pending" call? Check before implementation.
- Several non-urgent problems held by quiet hours are released as separate messages at the end of quiet hours (existing behaviour, not restart-specific). Should the end of quiet hours also produce one summary per recipient?
- Should household members be told when a home **function** they rely on stops working (for example "Heating is not working")? Proposed: not in this increment; functions are faults and go to administrators.

Settled 2026-09-27: no morning digest in this increment; evidence gaps are dashboard-only apart from the critical exception above; announcements default Off.
