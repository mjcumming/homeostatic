# ADR 0015: Deliver notifications to people with a built-in sender

**Status:** Accepted; implementation in progress; reporting configuration model partially superseded by [ADR 0026](0026-fixed-reporting-preferences.md)

**Date:** 2026-09-27

**Deciders:** Michael Cumming

**Partially supersedes:** ADR 0006 (the rule that the integration never calls a transport) and UI worksheet Decision 6 (YAML-only policy, no channel tests, no notify mapping).

## Outcome

Each person hears about the problems they can act on, on their phone. Urgent things that happen in the house can also be spoken at home. Every problem is heard once: not again after a restart, not duplicated, and one tap tells everyone it is handled.

## Context

ADR 0006 kept every transport out of the integration: Homeostatic emits `homeostatic_notification`, and consumer automations deliver it. That held scope down while the engine, policy and outbox were built, and the boundary itself was right. The attention decisions stay in HealthTree.

It makes the first run poor. To get one phone alert, the owner imports a blueprint, creates an automation, types an opaque recipient and channel id that must match the policy YAML, and selects that automation in options. Nothing ties a recipient to a person, and nothing tests a route.

Home Assistant does not fill this gap. Research (2026-09, HA 2026.9) found:

- **No notification system.** HA has transports but no recipients, quiet hours, escalation or acknowledgment model outside the YAML `alert` integration.
- **Phones need the older actions.** Notify entities (`notify.send_message`) take only `message` and `title`, by design. The rich Companion features we rely on (tag replace and clear, critical sound, action buttons) are available only through `notify.mobile_app_*`. Mobile app notify entities (2026.5) do not expose them.
- **Recipients map naturally to people.** HA knows which user registered each mobile app device, and `person` entities link users.
- **Voice is common, and it belongs to rooms.** Speakers and voice satellites are shared by whoever is present. `assist_satellite.announce` and `tts.speak` cannot be replaced, cleared or acknowledged in a tagged way.

A separate notification integration was considered and rejected. No other integration would use it. The policy already lives in HealthTree, and a split would add a second install and a cross-integration contract.

## Decision

1. **Homeostatic ships a built-in sender for three channel kinds.**
   - **Phone:** a Companion app device, delivered through its `notify.mobile_app_*` action with tag, critical sound for `urgent`, clear on resolve, and action buttons.
   - **Announcement:** voice satellites via `assist_satellite.announce`, and media players via `tts.speak`.
   - **Message:** any other notify entity via `notify.send_message`, with title and message only.
2. **Audience follows who can act.** Administrators receive faults and home alerts. Household members receive home alerts (situations) only. Evidence gaps are dashboard-only, except a `critical` gap, which is sent once to administrators.
3. **Recipients are Home Assistant people.** A person's phones are discovered from the mobile app devices registered by that person's user. Other message targets can be added per person.
4. **Announcements are a household recipient, not a person.** They speak home alerts only, never faults. They start Off with no speakers, and have their own level, speakers and quiet hours.
5. **A simple settings page generates the existing HealthTree policy.**
   - Each recipient gets one of four levels: Everything, Important, Urgent only or Off.
   - It adds quiet hours and channels. There is no second policy store.
   - Hand-edited YAML becomes a custom policy. The page shows it read-only and offers a reset; it does not try to round-trip arbitrary YAML.
6. **The event stays the contract and the extension point.**
   - Every delivery still emits `homeostatic_notification`.
   - The sender delivers only channels whose ids carry a built-in kind prefix (`phone:`, `announce:`, `notify:`).
   - Any other channel id stays opaque and consumer-owned, so the existing blueprint and custom automations keep working unchanged.
7. **Buttons map onto existing controls.**
   - *Got it* calls acknowledgment, *Snooze 1 hour* shelves the episode, and *Open* links to the problem.
   - Household members get *Got it* only.
   - A button pressed on a phone is authorized when that device's registering user is the recipient the delivery was sent to, and the episode is currently open. This is narrower than administrator authority and does not require the person to be an administrator.
8. **A test action sends a fixed message through one route**, outside the policy. It creates no episode and has no effect on policy clocks.
9. **After a restart, delivery waits for integrations to load, then sends one summary per recipient.** Overdue reminders are folded into it, never sent as a burst.
10. **Voice speaks home alerts only**: the opening, the first reminder and escalations. It never speaks faults, silent requests, updates, resolutions, summaries or digests, and it respects household quiet hours (urgent bypasses them).

## Options considered

- **Keep ADR 0006 unchanged and improve the blueprint.** This is cheaper, but the recipient–channel id matching and consumer selection remain, and there is still no test and no person model.
- **A separate notification integration.** Rejected, as above.
- **Deliver through notify entities only.** This loses tag replace and clear, critical sound and buttons on phones, which are the main channel.
- **Full rule editing in the UI.** The four levels cover the household cases. Full editing stays in YAML.
- **Per-person voice.** Rooms are shared, and presence-aware routing is not implemented. Revisit with presence.

## Consequences

- Homeostatic now calls notify, `assist_satellite` and `tts` actions. Tests use mocked services and an isolated instance, as before.
- **Transport failures become visible.** A failed service call is recorded (bounded) and shown on the page. A successful call still means *requested*, not received. Voice has no receipt at all.
- **Crash replay.** Outbox replay after a crash resends to phones silently, replacing by tag. Announcements and plain messages are sent at most once, from an attempt recorded before the call.
- **Restarts are quiet.** Nothing is sent until watched integrations finish loading (10-minute cap). Then one summary per recipient covers new problems and overdue reminders. Details are in the proposed spec section.
- **Activation no longer requires a selected consumer automation.** At least one built-in route or one selected consumer is enough.
- **Acknowledgment gains a non-administrator path** through the recipient's own phone, and needs scenario coverage for authorization.
- **Deferred:** presence-aware routing, voice questions (`assist_satellite.ask_question`), escalation chains, per-area subscriptions and per-person self-service settings. They can be added as levels or options without changing this structure.
