# ADR 0032: Receive expiring situation reports from HA automations

**Status:** Accepted
**Date:** 2026-09-29
**Deciders:** Michael Cumming

## Context

The owner chose to make the HA automation handoff work before building a
Homeostatic condition editor. HA must own arbitrary combinations of state,
time, presence and other conditions. Entity binding alone left the native
automation action path incomplete. HealthTree ADR 0036 extends ADR 0031's
entity-only reporter boundary; this record defines the adapter contract.

## Decision

- Add a native administrator action, Report situation, with an explicit configured
  id and Active, Cleared or Cannot determine state. No arbitrary message sender,
  ad hoc node creation, recipient override or delivery bypass is added.
- Declare automation situations using id, name, importance and report_timeout
  in seconds. Entity and report_timeout are mutually exclusive.
- Use HealthTree's existing check TTL and unknown_hold. An expired report becomes
  unknown; only a new clear report resolves. Restart/reload also requires new
  evidence while retaining an existing episode's identity.
- Apply reports in serialized arrival order with adapter acceptance time. One
  automation owns an id. Repeated active reports renew evidence on the same
  episode, not separate occurrences. Persist before publishing deliveries.
- Supply an automation blueprint exposing HA's native condition and trigger
  selectors. It evaluates on evidence changes, HA start and each minute, with
  optional exact-boundary triggers. Evaluate conditions within the action sequence
  so false conditions explicitly clear instead of skipping the action.
- Require owners to enumerate the evidence entities. Missing or unavailable
  evidence reports unknown before evaluating the active conditions. Conditions
  describe continuing states; event/trigger-id predicates are not suitable for
  periodic reevaluation. Complex event logic should maintain a stateful entity.
- Keep entity-bound situations supported. One-shot occurrence reporting and
  Homeostatic condition-authoring menus remain outside this increment.

## Alternatives

- Only document template sensors: valid for experienced users, but does not expose
  the requested native automation handoff.
- Persist reports forever: leaves an abandoned automation looking authoritative.
- Clear when a report expires: invents recovery when the producer stops.
- Add another rule engine: duplicates HA condition and timing semantics.

## Consequences

The owner can build arbitrary current-state rules in HA and retain Homeostatic's
existing issue and attention lifecycle. Setup still declares the situation in
native Homeostatic options. The blueprint refresh interval bounds time-condition
latency to about one minute unless an extra trigger names the boundary. Startup
reports can race integration readiness; the next refresh retries. HA owns any
duration semantics, and the integration does not claim unobserved continuity.
