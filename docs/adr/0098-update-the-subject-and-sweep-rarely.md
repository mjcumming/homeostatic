# ADR 0098: Update the subject of each event and sweep rarely

**Status:** Accepted on 2026-10-18; implemented, installed and measured on the household installation
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-18

**Extends:** [ADR 0010](0010-large-inventory-updates.md), which made callbacks capture ordered observations and one worker drain them, and [ADR 0097](0097-shrink-the-snapshot-and-save-durable-changes.md). **Supersedes:** the 60-second reconciliation in the [specification](../spec.md) as the normal path for discovery and observation.

## Context

The [core design audit](../core-design-audit-2026-10-18.md) found that the loop knows what changed when an event arrives and then recomputes the installation anyway. Every 60 seconds the reconciliation reads every registry entry, re-evaluates every candidate, composes every source, rebuilds the catalog rows and re-observes every check, 0.46 s on the event loop of the household installation, whether or not anything changed. Every refresh, whatever its cause, also re-observes all 79 integration entries, and a config-entry rewrite by another integration with no change to the entry's title, domain or disabled state requests such a refresh: 17 of the 60 idle refreshes in 33 minutes, 16 of which saved at once because the engine returned events for the re-observed entries.

State changes already update their subject. The state listener builds observations for the sources indexed to that entity and queues them in order; the refresh that drains the queue evaluates in 0.03 s. Config-entry state changes have the same path through each watched entry's state listener. Registry, Repairs and automation-reload events request a rediscovery, and those are rare: one registry change in the same 33 minutes. The deadline timer already drives time-based transitions: settle windows, holds, batch windows and digest schedules request a refresh at their due time.

What the minute tick still provides is a safety net: a missed event, metadata retained for sources that disappeared, and a pending reauthentication flow that has no event. The startup hold and retry holds are already deadlines of the timer.

## Decision

Events update their subject; the installation is swept rarely.

- A refresh observes a source only when something about that source arrived: a queued state or entry observation, a discovery, or the first refresh. Integration entries are no longer re-observed on every refresh.
- A config-entry update that changes nothing the catalog or the entry's state listener would notice requests no refresh.
- The 60-second reconciliation becomes a sweep every 15 minutes. The sweep does what the reconciliation did: it reads the registries, re-evaluates candidates, refreshes metadata retained for vanished sources, re-reads Repairs, scans automations, re-observes every source including pending reauthentication, and writes the trace summary.
- The startup hold and setup retries keep their own clocks. The deadline timer already includes the startup grace, the longest startup wait and each retry hold; a refresh at a retry deadline re-observes that entry so the warning escalates on time.

The ordered observation queue, the deadline timer, discovery on registry, Repairs and automation events, and the catalog and scan reuse for monitoring edits do not change.

## Alternatives

- Keeping a 60-second tick that only advances time keeps a refresh a minute for nothing: the deadline timer already requests refreshes at the moments that matter, and a quiet minute has no time-based transition.
- Making the sweep interval a setting adds a control without a user decision behind it; 15 minutes bounds the latency of the safety net well below the holds it backs up, and the constant can change with evidence.
- Observing integration entries on every refresh to detect reauthentication sooner costs 79 observations a refresh for a condition that arrives a few times a year; the sweep detects it within 15 minutes.

## Acceptance

A refresh caused by a state change ingests only that entity's observations and no integration observations; a sweep ingests every watched source. A config-entry update that leaves the title, domain and disabled state unchanged requests no refresh, and a title change still rediscovers. No refresh runs between events and the sweep; the sweep fires every 15 minutes and reads the registries. With startup grace configured and no events, the startup hold ends when the grace elapses, and a setup retry escalates at its hold without a sweep. The household installation is measured before and after: refreshes and writes per idle minute, discovery time per idle minute, and the share of refreshes with no engine events.

## Consequences

Idle work falls from a rediscovery and a full re-observation every minute to one every 15 minutes, and the idle refresh rate falls to the rate of real changes. Writes per minute fall with it once the engine's snapshot stops changing on unchanged observations, since the write-skip from ADR 0097 then takes effect between sweeps. A missed event, a vanished source's metadata, or a reauthentication flow is noticed within 15 minutes instead of one; the candidate catalog of a newly registered entity still appears on its registry event. The trace summary covers 15-minute windows.
