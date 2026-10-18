# ADR 0097: Persist durable facts only

**Status:** Accepted on 2026-10-18; the adapter part is implemented, installed and measured on the household installation; the library part shipped in health-tree 0.9.0 (its ADR 0041)
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-18

**Extends:** [ADR 0096](0096-coalesce-evidence-saves-and-verify-bytes.md), which bounded how often evidence-only refreshes save, and the persistence rules in the [specification](../spec.md). **Depends on:** a health-tree decision for the engine and policy snapshots, requested in that repository's RFP acceptance section.

## Context

After the latency series the household installation still rewrites a 7.7 MB file about 1.5 times a minute, roughly 17 GB a day, and the allocation behind each save triggers a generation-2 collection that pauses the whole Home Assistant process for about 0.85 s every three to four minutes. The [footprint measurement](../performance/snapshot-footprint-2026-10-18.json) and the [core design audit](../core-design-audit-2026-10-18.md) explain both.

The snapshot persists three kinds of state. Durable facts, about 1 MB: episodes, resolved history, operator controls, the delivery ledger, monitoring identities and scopes, enrollment, retry starts, phone actions, automation alerts, Repairs, broken automations, temperature and UPS monitor progress, notification flags and policy settings. Library working memory, 2.8 MB: the engine's check records with the full last observation of each of 1,757 checks, and the policy's route states. Caches, 1.8 MB: route signatures that store the full JSON of the same thirteen rules once per route, and check and integration evidence that store the last observation's reason, message, time and status for every source.

Between two idle saves one minute apart, only observation times changed. The minute reconcile re-observes every check and stamps the time into persisted evidence and into the engine's check records, so a quiet installation produces a different snapshot every minute and the coalescing window writes it once.

## Decision

The persistence boundary is durable facts. A durable fact is state the product cannot re-derive from Home Assistant after a restart: an issue's identity and history, what the owner decided, what was delivered, what was enrolled, and timing progress that a restart would otherwise reset. Everything observed from Home Assistant is a cache that the first refresh rebuilds, as startup already re-observes every source before the panel is used.

For the adapter's own sections:

- Route signatures persist as a digest of their canonical JSON. Equality is the only use of the stored value; a legacy snapshot holding the full signature converts to its digest on restore.
- Evidence persists the last known failure and whether history is complete, which the history goal needs. The current observation stays in memory, in the one latest-observation map the audit's step 2 introduced, and is rebuilt by the first refresh.
- The runtime serializes the envelope once, keeps a digest of the last verified write, and skips a save whose bytes equal it. The serialization already existed for byte verification, which now compares the stored file with those same bytes.
- The refresh trace records the engine event types each refresh produced, so the saves that still happen can be attributed.

For the library's sections, health-tree 0.9.0 keeps volatile observation state out of the engine and policy snapshots (its ADR 0041): the engine drops its clock and each check's observation payload in favor of the payload's durable details, and policy routes persist each tracked episode's decision instead of the clock. Two snapshots taken while no condition changed are equal, so the digest comparison skips every save that follows an unchanged refresh.

The Store format, the atomic write, the byte verification and the coalescing window do not change. User documentation states that the state file grows with the installation and is rewritten after changes, and recommends an SSD for large installations.

## Alternatives

- Compressing or hand-formatting the file departs from the Store format every other integration uses and from the backup and migration tooling built on it.
- Splitting the snapshot into several Store files reduces the bytes per write but multiplies atomic writes and verifications and complicates rollback of a failed save.
- Lengthening the coalescing window trades more lost evidence for fewer writes without removing the cause.
- Persisting the current observation but not its time keeps the churn out of the file at the cost of showing a stale reading as current after a restart; the first refresh replaces it anyway, so the record is not worth keeping.

## Acceptance

A reconcile that observes no changed condition leaves every adapter section of the snapshot byte-identical; once the library keeps times out of its snapshot, it performs no write. Route digests detect every rule, digest, method and quiet-hours change that the full signatures detected, and a legacy snapshot restores without re-activating unchanged routes. Evidence views show the last observation after the first refresh and the last failure after a restart. A save whose bytes equal the last verified write performs no write. The household store file size, the saves per idle minute and the refresh event types are measured before and after.

## Consequences

The store file falls by the route content and the evidence records plus their indentation, about 2.3 MB of 7.7 MB, and the adapter's sections stop changing on a quiet minute. Idle writes keep happening until the library change lands, because the engine's check records carry observation times. Restart loses the displayed observation times until the first refresh, which completes before the panel is used. The adapter gains a dependency on health-tree's snapshot behavior for the remaining churn, recorded in both roadmaps.
