# ADR 0056: Deliver through Home Assistant methods with optional presence selection

**Status:** Accepted
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Date:** 2026-10-12

**Later decision:** Required preview-before-test UI and generic destination presentation is superseded by [ADR 0059](0059-save-directly-and-test-configured-methods.md). The historical decision below is retained; validation and persistence safeguards still apply.

**Partially supersedes:** the person-only configuration and presence deferral in [ADR 0015](0015-deliver-notifications-to-people.md). Selecting a voice destination through a policy also replaces that ADR's fixed category, reminder and report restrictions on speech. Existing delivery identity, authorization and request-versus-receipt boundaries remain.

## Context

Owners need app, voice, email and SMS delivery. A useful method may always reach the same phone, reach several destinations, or select destinations according to who is home. Reusable methods allow that choice to change independently of schedules.

## Decision

Notifications owns named delivery methods. Each method has a stable identity, a name, and one or more explicitly configured destinations. A destination records its transport and target using supported Home Assistant capabilities. A method can contain several transport types.

The supported product scope includes:

| Type | Home Assistant connection |
| --- | --- |
| App | Companion app notification destinations, retaining supported issue links, replacement and acknowledgment actions |
| Voice | Assist satellite announcements or a configured TTS provider and compatible media-player targets |
| Email | Configured email notification destinations, including SMTP recipient entities |
| SMS | A configured SMS notification integration with its required recipient targets |

Home Assistant owns provider accounts and credentials. Homeostatic selects configured targets and validates the parameters required by the supported action. Show missing setup or unavailable destinations explicitly. Choosing Voice does not imply support for every assistant brand; use the capabilities actually exposed by its installed integration.

Both notify entities and supported notification actions are needed. Email can use a notify entity, while an SMS integration can require a named notify action and phone-number targets. Do not restrict the design to the current notify-entity picker or expose arbitrary service calls as ordinary delivery methods.

## Fixed and presence-aware selection

Fixed methods always use their selected destinations. Optional presence selection can choose the destinations of selected people currently home, or use different destination sets for home and away. Require an explicit fallback destination set or an explicit choice to skip when no recipient qualifies or presence is unknown. Show that choice in the method summary.

Resolve presence for each new scheduled notification or reminder using current HA evidence. A presence change alone does not send a message, replay missed messages or reset a schedule. A current, non-restored `home` state qualifies a person as home. `not_home` and named zones count as away. Missing, restored, `unknown`, `unavailable` and empty states are unknown evidence. Home/away selection uses its home destinations when at least one selected person is known home, its away destinations when all are known away, and its explicit fallback otherwise. People-currently-home selection uses only qualifying people's destinations, or its explicit fallback when none qualify.

A pending delivery's resolved targets are retained with its delivery identity for outbox replay. Replaying the same request must not choose a new set of people. Clearing or updating previously sent messages uses the destinations that received those requests, even if someone has since left home. Transport failure is reported separately from presence fallback.

Homeostatic reads HA presence and maps destinations after health-tree authorizes a new request. The adapter persists resolved channels and prior target history with route-specific message identities; the library sees opaque method recipients and independent attention routes. This requires the matching local health-tree ADR 0037 implementation. It does not depend on snapshot inspection or adapter-owned scheduling.

## Transport behavior

An action request does not prove receipt, reading or that speech was heard. The UI describes the available capabilities of each destination. App actions can provide acknowledgment where supported; voice, email and SMS delivery do not imply reply-based acknowledgment. Existing in-app controls remain available.

Voice uses spoken issue or report text when its selected schedule is due, including the schedule's reminder behavior. An immediate schedule includes overnight delivery for its selected methods. Notification entities and SMS actions receive the message text. Silent updates and cleanup create no speech, emails or texts. Only Companion destinations receive replacement or withdrawal operations. Provider-specific formatting, speech length and volume controls remain follow-up work.

Tests use an isolated HA instance and mocked services. An administrator previews a saved delivery method to see its exact current targets and presence evidence, then explicitly requests a test for that set. The preview token binds the saved revision, method definition, presence evidence and available targets; changes require another preview. Requests and failures are reported separately for each destination. Merely opening, editing or previewing a method never sends.

The transport adapter requests `assist_satellite.announce`, `tts.speak`, `notify.send_message`, Companion app notification actions, or a named `notify` action with explicit SMS targets. Discovery checks satellite announcement and media-player playback capability. Home Assistant's generic notification listings do not establish that every entity or action is an email or SMS provider; the owner must choose the configured provider appropriate to the destination. No arbitrary service domains or actions are accepted as ordinary methods.

## Sources and implementation requirements

The Home Assistant capabilities were checked on 2026-10-12:

- [Companion app notifications](https://companion.home-assistant.io/docs/notifications/notifications-basic/) and [notify entities and actions](https://www.home-assistant.io/integrations/notify/).
- [Assist satellite announcements](https://www.home-assistant.io/integrations/assist_satellite/) and [TTS media-player speech](https://www.home-assistant.io/integrations/tts/).
- [SMTP recipient entities](https://www.home-assistant.io/integrations/smtp/) and [Twilio SMS notification targets](https://www.home-assistant.io/integrations/twilio_sms/). These are supported-capability examples, not exclusive provider choices.
- [Person state and zones](https://www.home-assistant.io/integrations/person/).

Executable isolated tests cover the four transport types, destination discovery and permissions, mixed methods, home/away/unknown selection, explicit skip and fallback, missing destinations, provider failures, replay after a presence change, prior-target cleanup and acknowledgment capability. Real-device trials remain necessary before claiming a particular assistant or provider works. These changes are in the working tree; no release, deployment or live-provider test is claimed.
