# Homeostatic integration specification

Date: 2026-09-25. Development baseline: Home Assistant 2026.9.3 and Python 3.14.

This is the integration implementation contract. The library design of record remains `health-tree/docs/rfp.md`; its accepted ADRs govern engine and policy behavior. The owner decisions in `health-tree/docs/ideas/homeostatic-ui.md`, section 16, set the product direction. This foundation increment implements the function/situation/delivery boundary below; the remaining release work is tracked in [roadmap.md](roadmap.md). No library semantics change.

## Scope and setup

One Homeostatic config entry per installation. Native setup and options select integration instances and entities. Enrollment is explicit: new sources are not enrolled automatically. Selected registered entities use entity-registry identity, so renaming an entity preserves its node and history. Unregistered entities use their entity id. Selection discovers the owning config entry, if any, and monitors its HA control-path capability. A selected entity depends on that config entry; an unavailable entity does not claim physical hardware is dead.

The first catalog checks config-entry state and entity availability. Disabled, removed, missing, unknown, startup, or restored sources are unknown evidence. A loaded config entry passes; setup retry warns for a configurable retry hold, then fails; setup/migration errors and failed unload fail. Pending reauthentication fails with `auth_required`. An entity with a real available state passes its HA availability check; unavailable fails. A valid state value does not prove physical freshness or the correctness of that value. Removed selected sources remain unknown requirements until the owner explicitly removes them from scope.

Only selected sources and their direct owning entry are registered. Device, area, and label associations do not imply extra causal edges. Device freshness, Frigate liveness, command completion, battery/update catalogs, and external probes require separate producer contracts and real traces. Manual enrollment is a development bridge to attribute-matching attach/exclude rules, passive automatic enrollment, and inherited future sources. It is not the final enrollment model.

## Time and lifecycle

Create or restore the engine only after HA has started. Load listeners and entities earlier, reporting unavailable until startup completes. One adapter owns calls into engine and policy on the HA event loop. Observations arriving together are ingested atomically. State and entry callbacks capture observations with their receipt time before queuing work. Every captured transition is applied in order, even if storage is busy. Each transition is its own observation batch; reconciliation must not erase it. Registry changes trigger an inventory refresh; a 60-second reconciliation interval catches missed lifecycle changes and pending reauthentication. A deadline timer uses the earlier engine/policy deadline, independently of reconciliation. No delay is added to batch unrelated observations.

Initial settings: settle 120 seconds, rejoin grace 60 seconds, startup grace 120 seconds, coalescing count 3 and window 60 seconds, notification batch 30 seconds, clear hold 120 seconds, unknown hold 900 seconds. Availability failures have zero raise hold; setup retry has a 120-second warning period across unsuccessful setup attempts. SETUP_IN_PROGRESS does not reset the retry onset; leaving the retry cycle does. All these durations can be edited in options. Availability checks use no observation expiry because they read HA's current state; physical freshness is explicitly unsupported. The reconciliation timer is adapter plumbing, not a physical heartbeat.

Reconciliation reads all enrolled sources into one observation batch. It registers new nodes before ingesting observations, preserving existing check state. It keeps missing selected nodes as unknown. Explicit unenrollment removes their nodes; a removal notice is not presented as physical recovery.

Ordinary available-value changes do not trigger a new availability observation or snapshot write. Changes between available, unavailable, unknown, missing, and restored evidence do. Periodic reconciliation still refreshes the available HA evidence.

## Presentation and queries

An overall readiness sensor preserves `ready`, `unknown`, `degraded`, and `blocked`. It uses all explicitly selected capabilities; no selections yield unknown. Additional diagnostic sensors show open episode count and evidence-gap count. Intentionally composite function nodes are not counted as unwatched evidence gaps; their requirements provide the evidence. The raw coverage query retains the library no-checks list. Queries/actions expose inventory, explain, readiness, impact, coverage, and rollup through service responses. Queries use only public library APIs. Episode presentation is maintained from engine events and persisted independently, never extracted from engine snapshot internals.

## Attention and persistence

Notifications default to off. The integration emits `homeostatic_notification` events for policy deliveries; it does not deliver episode messages through notify services or persistent notifications. An optional consumer blueprint owns Companion app delivery. Persistent notifications are reserved for failures of Homeostatic itself. Delivery means requested, never received or read.

The initial policy has one opaque recipient (`owner`) and an event channel. Critical-importance problems are urgent; other findings notify after the batch duration. Rich owner-authored YAML policy, quiet hours, reminders, and digest configuration remain release work. Enabling notifications requires an enabled consumer automation selected in options. Runtime coverage reports a missing/disabled consumer. Selecting an automation confirms the owner's routing choice; it does not prove phone receipt or that arbitrary consumer code handles every loudness.

Activation sends one summary of the current open problems, then subsequent live deliveries. Reload with notifications already enabled does not replay openings. Existing problems remain eligible for future policy updates and resolutions. The initial policy has no reminder or escalation timers; those clocks must start at activation when configurable policy lands.

Events have a versioned payload, stable episode id/tag, stable delivery id, action, recipient, loudness, silent flag, title/message, cause and affected functions. `open`, `update`, `resolve`, and `summary` are implemented. The event contract reserves future reminder/escalation/digest actions. See [events.md](events.md). Content changes only when the library issues a delivery: unknown evidence does not replace the last delivered failure with blank text.

Persist engine state, policy state, episode presentation, last requested messages, and a delivery outbox in a versioned HA Store. Restore policy before feeding engine restore events. Reconcile current observations before releasing pending openings; cancel an unsent opening when its episode has resolved. Save before firing events and save the cleared outbox afterwards. A crash between emission and acknowledgement can replay the same delivery id: delivery is at least once, consumers must replace by tag or deduplicate by delivery id. Event publication is not an acknowledgement from a consumer.

Use atomic Store writes and read-back verification because Store can log a write failure without raising. Invalid snapshots remain visible failures and must not silently discard history. Native invalid-JSON handling remains with HA and its storage-corruption Repair. The original development envelope is migrated without inventing new episode identities; obsolete native episode notifications are dismissed after a successful save.

Unload and shutdown cancel all callbacks, drain captured observations, and attempt a final save. A failed final save leaves the last durable snapshot and creates a visible Homeostatic storage error; cleanup still completes so there is no stopped runtime registered as a failed unload. A platform refusal to unload keeps monitoring running. Work already saving cannot create a new timer after shutdown starts.

## Functions and situations

Native setup/options include structured YAML fields for this development increment. A function has an immutable owner-chosen `id`, a name, importance (`low`, `normal`, `high`, `critical`), and one or more entity requirements. Entity references resolve to registry identities at save time. Requirements are enrolled automatically and remain unknown when missing. A function node has dependency edges and no own checks. Each function gets a readiness sensor; overall readiness includes functions and explicitly selected capabilities.

A situation has its own immutable `id`, name, importance, and one bound entity. `on` means active/fail, `off` means clear/pass. Missing, disabled, restored, unavailable, unknown, or unexpected states mean unknown. Unknown never clears an open situation. The situation has no dependency edges and is excluded from readiness targets and function requirements. HealthTree owns its episode and policy lifecycle. Situation checks use zero raise/clear holds, an explicit `ttl: null`, and the configured unknown hold.

The owner supplies condition logic in Home Assistant. Its template/helper must expose source loss as unavailable, not off. Setup documentation and inventory expose this unverified availability contract. Automatic template inspection is not implemented. Equipment maintenance must never use the global quiet scope or suppress situations; maintenance controls remain release work.

## Acceptance scenarios

Tests use real Home Assistant helpers and the real health-tree engine. They cover native setup/options, singleton setup, startup deferral, failure/notification/recovery, dependency correlation, startup/restored unknowns, setup retry escalation, missing sources, stable entity rename, enrollment changes, notification disablement, service validation, unload cleanup, corruption, and restart without a duplicate episode, captured transitions during storage, retry cycles, storage-error cleanup, functions, situation unknown/recovery, and consumer events. Tests advance time explicitly. Real-house traces remain a release gate.

## Development dependency

The library is currently unreleased. Development installs the sibling health-tree checkout. The custom integration manifest intentionally has no fabricated PyPI pin; development HA must have that checkout installed in its Python environment. Before distribution, release the reviewed library, pin its real version in the manifest and development configuration, and remove this development-only installation requirement. HACS distribution is not enabled until that gate is met.
