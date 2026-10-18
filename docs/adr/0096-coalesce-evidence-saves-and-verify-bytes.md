# ADR 0096: Coalesce evidence-only saves and verify stored bytes

**Status:** Accepted on 2026-10-18; implementation pending
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-18

**Extends:** the atomic-write and read-back verification rule in the [specification](../spec.md) and ADR 0010's ordered refresh. **Refines:** ADR 0092's statement that further persistence work requires measured evidence.

## Context

Every refresh ends in a verified save: the runtime builds its snapshot, about 7.8 MB of JSON on the household installation, asks Home Assistant's Store to write it, reads the file back, parses it into a second object tree and compares the two in the executor. The [phase 2 trace](../save-performance.md#what-the-remaining-second-is) measured 2.5 such saves a minute in an idle house, each allocating two large object trees, and CPython generation-2 collections of about 0.85 s on the main thread: 0.4 a minute idle, 2 to 4 a minute during edits. After the [catalog](performance/live-latency-candidate-rows-2026-10-17.json) and [scan](performance/live-latency-scan-reuse-2026-10-17.json) changes a Stop Monitoring save takes 1.33 s on the server, so a collection landing inside it is now more than half of that save, and it lands in roughly one edit in two or three. Home Assistant Core sets no collector thresholds; the integration can only lower what it allocates.

The verification exists because Store logs a write failure without raising. The read-back guards two things: a notification request is published only after the state that records it is durable, and an accepted settings edit is never reported as saved when it is not.

## Decision

Every save stays verified, and verification stops parsing. The runtime serializes its envelope with the same helper and the same envelope fields the Store uses, reads the stored file as bytes in the executor, and compares the two byte strings. Equal bytes verify the save with no second object tree. Different bytes fall back to today's parse and deep compare, so a difference in how Home Assistant serializes can never by itself make monitoring unavailable; only a snapshot that fails that compare too raises the existing storage error.

Evidence-only refreshes coalesce their saves. A refresh that queued no notification request, opened, updated or resolved no episode, and changed no operator control or setting marks the snapshot pending instead of saving, and a Home Assistant timer saves once, verified, at most 15 seconds later; further such refreshes inside the window extend nothing and save nothing. Any refresh or action that does queue a request, change an episode or control, apply settings, or stop the runtime saves immediately and verified as today, which also flushes a pending save. Startup, reload, unload and the final save are unchanged. Snapshots built for a save are still constructed under the runtime lock and remain unchanged until verification finishes.

The persistence format, the Store key, rollback on failed saves, ordered observations and stable delivery identities do not change.

## Alternatives

- Tuning or freezing the garbage collector for the whole Home Assistant process is Core's decision, not an integration's, and would move the cost onto every other integration.
- Dropping read-back verification removes the only signal that a Store write failed, since the Store logs and continues.
- Saving less often for every refresh, including those with requests or episode changes, would let a crash lose a published delivery record or an issue identity, which the specification keeps across reloads.
- Shrinking the snapshot changes a persistence format owned partly by the library and is a separate decision with its own evidence.

## Acceptance

Exercise a successful save and confirm the stored bytes verify without a parsed comparison; patch the Store to write different bytes and confirm the parsed comparison runs and still raises for a real mismatch; patch the serializer to differ benignly and confirm the parsed comparison accepts it. Exercise evidence-only refreshes: the save is deferred, a second refresh inside the window adds no save, the timer saves once, and a notification request, an episode change, a settings save and unload each save immediately and clear the pending timer. Keep the existing rollback, outbox-replay and final-save scenarios green. Measure on the household installation with the phase 2 trace: saves per minute idle, generation-2 collections per minute idle and during six edit cycles, and the save response and settled medians against the scan reuse receipt.

## Consequences

Idle saves fall from one per refresh to one per 15 second window at most, and every save allocates one large object tree instead of two. A crash can lose up to 15 seconds of evidence-only state that the next refresh re-derives from current Home Assistant state; requests, episodes, controls and settings are never in that window. The byte comparison couples verification to the Store's serializer through its own helper, with the parsed comparison as the fallback when that coupling breaks.
