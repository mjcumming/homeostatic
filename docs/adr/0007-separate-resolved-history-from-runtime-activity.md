# ADR 0007: Separate resolved-problem history from runtime monitoring activity

**Status:** Proposed
**Date:** 2026-09-26
**Decider:** Michael Cumming (pending)

## Context

An ended episode answers what happened to a problem. Enrollment and rule changes answer what the monitor changed during this run. Mixing them would make source arrivals look like household faults or make a short runtime log appear to be a durable history. The pilot specification gives them distinct retention and meaning.

## Proposed decision

Store a bounded history only when HealthTree emits `EpisodeResolved`: at most 100 terminal episodes observed within 30 days. Preserve the resolution as `cleared`, `removed`, or `absorbed`; only `cleared` represents observed recovery. Keep the last 50 monitoring changes in the current runtime separately for diagnostics, including a scope snapshot at load. Show the resolved-history collection and retention limits on History. Do not infer historical device state from current inventory or reconstruct events before collection began.

## Options considered

- **Use one combined timeline.** Administrative enrollment changes could be mistaken for equipment problems.
- **Derive history from the current engine snapshot.** A snapshot does not supply an auditable terminal event stream or past display context.
- **Persist a full indefinite journal.** It adds storage, migration, and privacy costs beyond this pilot's needs.

## Consequences

The owner can inspect recent resolutions without treating removal or absorption as repair. The runtime enrollment log remains available for diagnostics but does not appear in History or serve as a permanent audit trail. A longer history or export requires a new retention and persistence decision.
