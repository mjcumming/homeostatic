# ADR 0097: Shrink the snapshot and save only durable changes

**Status:** Proposed on 2026-10-18
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-18

**Extends:** [ADR 0096](0096-coalesce-evidence-saves-and-verify-bytes.md), which bounded how often evidence-only refreshes save, and the persistence rules in the [specification](../spec.md). **Depends on:** a health-tree decision for the engine and policy snapshots.

## Context

After the latency series the household installation still rewrites a 7.7 MB file about 1.5 times a minute, roughly 17 GB a day, and the allocation behind each save triggers a generation-2 collection that pauses the whole Home Assistant process for about 0.85 s every three to four minutes. The [footprint measurement](../performance/snapshot-footprint-2026-10-18.json) explains both.

The file is 30 percent indentation, which the Home Assistant Store applies to every file it writes. Of the 5.4 MB of content, the engine snapshot is 2.1 MB, of which 1.5 MB is the last observation of each of 1,757 checks; the adapter's attention route signatures are 1.4 MB because each of eight routes stores the full JSON of the same thirteen rules; the policy snapshot is 0.7 MB; enrollment rows and check evidence are 0.9 MB together; the remaining eighteen sections are 0.3 MB.

Between two idle saves one minute apart, only observation times changed: the current record of every check and integration, the engine's check records and the policy route states. Episodes, history, controls, enrollment and delivery were identical. The minute reconcile re-observes every check and stamps the time into persisted evidence, so the snapshot differs every minute even when nothing happened, and the coalescing window writes it once. Config-entry rewrites by other integrations added sixteen immediate saves in 33 minutes because the engine returned events for each; which events is the open question the trace answers.

## Decision

The adapter persists only what it cannot re-derive from Home Assistant, and skips a save whose content equals the last stored content.

- Route signatures store a digest of their canonical JSON instead of the JSON. Equality is all the comparison needs.
- Check and integration evidence persist the condition, not the time it was last observed. The observation time is presentation state that the first refresh after a restart re-derives, as startup already re-observes every source.
- Before writing, the runtime serializes the envelope once, hashes the bytes and skips the write when the hash equals the hash of the last verified write. The serialization already exists for byte verification, so a skipped save costs one serialization in the executor and no disk write.
- A per-refresh trace of engine event types, in the existing identifier-token format, records why a refresh saved at once.

The engine and policy snapshots are health-tree's. This decision asks the library to keep volatile observation times out of its snapshot or to expose whether a snapshot changed in content, and records that request in both roadmaps; until then the adapter's hash comparison only helps when the engine snapshot is unchanged.

The Store format, the atomic write, the byte verification and the coalescing window do not change. User documentation states that the state file grows with the installation and is rewritten after changes, and recommends an SSD for large installations.

## Alternatives

- Compressing or hand-formatting the file departs from the Store format every other integration uses and from the backup and migration tooling built on it.
- Splitting the snapshot into several Store files per section reduces the bytes per write but multiplies the atomic writes and verifications and complicates rollback of a failed save.
- Lengthening the coalescing window beyond 15 seconds trades more lost evidence for fewer writes without removing the cause, which is that a reconcile with no change produces a different snapshot.

## Acceptance

A reconcile that observes no changed condition leaves the adapter's snapshot sections byte-identical and, once the library keeps times out of its snapshot, performs no write. Route signatures still detect every rule, digest, method and quiet-hours change. Evidence views still show the last observation time after a refresh and show it again after a restart once the first refresh completes. The size of the household store file and the saves per idle minute are measured before and after, and the write volume per day is recorded in the receipt.

## Consequences

The store file falls by at least the 1.4 MB of route content plus its indentation, and idle writes fall from one per minute to one per real change. Restart loses the displayed observation times until the first refresh, which already happens before the panel is used. The adapter gains a dependency on health-tree's snapshot behavior for the remaining per-minute churn.
