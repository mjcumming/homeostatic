# ADR 0111: Separate notification handling from runtime coordination

**Status:** Accepted
**Date:** 2026-10-24

**Extends:** [ADR 0110](0110-separate-producers-from-runtime.md) component ownership. Preserves [ADR 0102](0102-collect-requests-by-saved-notification.md) collection, [ADR 0109](0109-compact-notification-presentation.md) report scopes, and the existing persistence and sending contracts.

## Context

Runtime coordinates ordered monitoring work but also composes messages, resolves destinations, groups requests, manages report links and phone actions, validates recipients and calls notification services. These details obscure the order in which evidence, library decisions, verified saves and publication happen. Separating files alone would retain that coupling if helpers received the entire runtime.

## Decision

Give one notification component ownership of request composition, destination resolution, delivery state, report scopes, phone actions, transport preparation and failure reporting. Reuse the existing delivery, grouping, report, phone-action and route modules. Pass an explicit read context containing current settings, source and issue presentation, public library query objects and a boundary UTC time. The component does not import Runtime or keep a second settings owner.

Runtime retains the ordered worker and lock, engine and policy lifecycle calls, and the shared verified storage boundary. Publication and transport preparation return explicit records. Runtime saves new report scopes before publishing, saves the cleared outbox afterwards, and saves a prepared sending attempt before calling its transport. Failed saves restore the corresponding report scope, outbox or attempt state. No notification component starts an independent queue, timer or persistence task.

Captured temperature and UPS inputs advance only when the same worker can ingest their observations. UPS capture retains the complete verified role reading without changing mode or reserve hysteresis, so an intervening save cannot consume an unprocessed backup transition. A restart supplies fresh evidence against the last coherently saved producer and engine state.

Keep event payloads, snapshot section names, resolved destinations, pending delivery identities and attempt-before-I/O semantics unchanged. Transport requests remain distinct from physical delivery. This change introduces no configuration or storage migration, dependency or frontend change.

## Acceptance

Scenarios cover UPS capture across a save and restore, multiple queued role readings, collection deadlines, route changes, report scopes saved before publication, save failure and replay, stable delivery IDs, phone acknowledgment and unauthorized requests. Existing storage and upgrade scenarios preserve the shared transaction. Runtime exposes the ordering directly; the notification component has no Runtime reference or storage callback.
