# ADR 0014: Publish detected facts for owner automations

**Status:** Proposed

**Date:** 2026-09-27

**Deciders:** Michael Cumming

**Related:** ADR 0006 (notification requests through consumers), proposed ADR 0013 (built-in delivery to people), ADR 0005 and ADR 0012 (what availability evidence means).

## Context

Homeostatic detects problems, recoveries, situations and operator actions. Today the only outbound hooks are:

- `homeostatic_notification`, a per-recipient delivery request. It fires only when notifications are enabled and the attention policy authorizes a message, after quiet hours, digests, batching, shelving and acknowledgment have applied.
- The overall readiness sensor, two diagnostic counts, and one readiness sensor per function.

HealthTree already emits `EpisodeOpened`, `EpisodeUpdated` and `EpisodeResolved`. The adapter uses them for notification requests and resolution history but does not publish them. An owner who wants to act on what Homeostatic found (turn on a status light, restart an integration, log to an external system, feed Node-RED) must either trigger on notification requests, which are filtered attention decisions rather than facts, or poll the sensors.

Owners will always want responses that Homeostatic's UI does not offer. Building UI for each of them is unbounded work. Home Assistant's own answer to this is state and events that automations can use.

## Decision

Homeostatic publishes what it detects as a stable, versioned stream of facts that owner automations may consume however they like. What an owner does with it, including ignoring Homeostatic's attention policy, is the owner's choice. Notification delivery (ADR 0006, and ADR 0013 if accepted) is one opinionated consumer of these facts, not the definition of what is observable.

### Events

Two event types, so a trigger can select one family without template filtering:

| Event type | `change` values | Fires when |
| --- | --- | --- |
| `homeostatic_episode` | `opened`, `updated`, `resolved` | HealthTree emits the corresponding episode event, for anchored episodes and situations alike |
| `homeostatic_control` | `started`, `ended` | Shelving, maintenance or acknowledgment is saved, cancelled or expires |

Every payload carries `schema_version`, `entry_id` and `change`. An episode payload also carries:

- `episode_id`, `form` (anchor or situation), `anchor` (node id) and `anchor_name`
- `entity_ids`, `device_id`, `area_id` and `floor_id` for the anchor, when HA supplies them, so that rules can act without querying Homeostatic
- `status`, `importance`, `reasons` (kind and reason strings as the library reports them), `functions` (currently affected function names), `opened_at`
- `shelved`, `maintenance` and `acknowledged` flags as they stood at publication
- on resolution, `resolution` (`cleared`, `removed` or `absorbed`) and `absorbed_into`

A control payload carries the control id, kind, scope and the affected `episode_id` where there is one.

Homeostatic's own monitoring health (evidence gaps, runtime or storage errors, a missing notification consumer) is not published as events. It remains on the diagnostic sensors and their attributes, where a state trigger covers any owner who wants to react to it.

### Semantics

- **Independent of attention.** Fact events fire whether notifications are on or off and regardless of recipients, quiet hours, digests, shelving or acknowledgment. Those states are reported as flags; they do not suppress events.
- **Meaningful change only.** `updated` fires when status, importance, reasons or affected functions change. Repeated identical observations publish nothing, consistent with ADR 0010.
- **Order and durability.** Events publish after the state they describe is saved, and before any notification request derived from the same change.
- **At most once, no replay.** Reloads and restarts do not replay history. Current state after a restart is read from entities and the existing `inventory`, `explain` and `resolved_history` actions. Unlike notification requests, fact events have no outbox.
- **One join key.** `episode_id` and anchor identity are identical across fact events, notification requests and resolution history. Notification requests do not reference a fact event: reminders, escalations and digests have none, one fact can yield several requests or none, and outbox replay would leave the reference stale.
- **Evidence limits unchanged.** Payloads describe Homeostatic's findings under ADR 0005 and ADR 0012: availability is control-path evidence, not a physical diagnosis. Documentation warns that remedial automations can loop if they act on it as proof of a fault.
- **Additive contract.** Fields are added, never renamed or repurposed, within a schema version. Consumers ignore unfamiliar fields. A breaking change requires a new schema version and a changelog entry.

### Context chaining

Homeostatic fires its events with an HA `Context` so the logbook and automation traces can show the path from a source to a delivered message.

- An episode event's context has as its parent the state change that caused it, when exactly one did. When a batch of several observations produced the change, it has no parent.
- A notification request caused directly by an episode change (open, update, resolve) has that episode event's context as its parent. Reminders, escalations, digests and activation requests are started by time or configuration and have no parent.
- A control event reuses the context of the action call that caused it, so the acting user is attributed without a payload field. An expiry has no parent.

Context chaining is best effort, for attribution in HA's own tools. It is not part of the payload contract, and rules must not depend on it; `episode_id` remains the join key.

### Entities

Entities give owners conditions and restart-safe state that events cannot. They are provided at function level and above, never per source node or per situation, so entity count grows with declared functions, not with devices.

- Function readiness sensors declare `device_class: enum` with their options, so the automation editor offers the states. These sensors already exist.
- One `event` entity per function with event types `problem_opened`, `problem_changed` and `recovered`, mirroring episode facts that affect the function.
- The existing overall readiness sensor and diagnostic counts are unchanged.

Situations are published only as episode events. Each situation already rests on an HA entity that owners can trigger on directly; an extra Homeostatic entity would mostly duplicate it.

A household with 15 functions has 33 Homeostatic entities: 15 readiness sensors, 15 event entities and the 3 existing overall sensors.

### Examples instead of UI

Requests for edge-case behavior are answered with an automation rather than a new setting. The repository ships two or three example blueprints (for example a status light for a function and a logbook entry for every episode) and documents the full contract in `docs/events.md`.

## Options considered

- **Keep `homeostatic_notification` as the only event.** Owners would need notifications enabled to observe anything, and would receive policy-filtered, per-recipient copies instead of facts.
- **Add settings and UI for each requested reaction.** Unbounded, and every addition becomes a compatibility burden in the configuration store.
- **One event type with a `family` field.** Fewer names, but every trigger needs a template condition and the automation editor cannot select a family directly.
- **Publish monitoring-health events.** Nobody is expected to automate a reaction to coverage changes, and the diagnostic sensors already expose them.
- **A problem binary sensor per function.** Duplicates the enum readiness sensor, which already supports state triggers with durations.
- **Entities per situation or per source node.** Situations already have their source entity. Per-node entities would dominate registry and recorder cost at the thousands of nodes the pilot's scale work targets; the bus event already carries per-source identity.
- **A fact-event reference on notification requests.** Often null, sometimes a list, and stale after replay. `episode_id` and context chaining serve the same purposes.
- **Replay fact events through the durable outbox.** Would give at-least-once delivery, but replayed history confuses automations that act on events, and current state is already available from entities and actions.

## Consequences

- Owners can build any reaction to what Homeostatic detects without UI changes, including ones that bypass its attention policy.
- The payload becomes a public compatibility contract. Field choices need the same care as the notification schema.
- HA's recorder stores bus events. Meaningful-change filtering keeps volume proportional to real changes, not observations.
- An owner automation that misses an event while HA is down does not see it later; rules that need current truth should use entity conditions.
- The logbook and traces can explain why a message was sent, from the source through Homeostatic to the consumer automation.
- HealthTree and its RFP are unchanged. This is an adapter decision.
