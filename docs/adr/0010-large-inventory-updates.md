# ADR 0010: Preserve ordered conditions and separate catalog from evidence updates

**Status:** Accepted

**Date:** 2026-09-26

**Deciders:** Michael Cumming

## Context

A broad entity-level runtime experiment took seconds to apply one burst of transitions through the graph. Rebuilding inventory, persisting and publishing a full dashboard for each callback made even a narrow burst stall Home Assistant. The dashboard also has thousands of discovered candidates; rendering or retransmitting all rows after every evidence change wastes work. Collapsing a burst to its last observation would hide failures and recoveries that the episode engine must see.

## Decision

- Home Assistant callbacks capture availability-condition changes with their receipt times. The runtime indexes watched sources by entity, queues distinct changes in order, and lets one serialized refresh worker drain them. A later reconciliation does not erase a captured transition. A device summary emits a new observation when its status or reason changes; ordinary value changes or other member changes that leave that condition unchanged do not emit redundant observations.
- Static catalog metadata has an in-memory revision. An optional compact WebSocket subscription uses schema version 2: a full baseline includes the catalog, HA areas, floors and devices; later events at the same revision carry complete dynamic evidence but omit those static fields. Catalog changes, reconnection, runtime replacement and recovery from unavailability require a new baseline. A client rejects a compact update without a matching available baseline. Existing schema-version-1 full subscriptions remain supported.
- Presentation limits ordinary work: Home shows at most 30 individual problems and summarizes normal or low-importance unknown-only episodes; Monitoring previews at most 20 evidence-review sources; source searches inspect the complete inventory while rendering at most 50 matching rows. These limits do not change checks, episodes, readiness or notification decisions.

## Options considered

- **Reconcile only the latest state after a burst.** This can erase an outage and recovery or change their episode timing.
- **Run a full inventory scan, save and dashboard publication for each callback.** The measured burst blocked Home Assistant for seconds.
- **Send the complete catalog on every dashboard update.** Evidence changes rarely alter source identity, location or rule metadata, so repeated full transfers are unnecessary.
- **Render every discovered source immediately.** Thousands of rows delay browser interaction and bury the problems that need attention.

## Consequences

Event ordering and health semantics remain with the existing engine; the adapter reduces redundant work around it. The first catalog transfer remains large, and the device-sized synthetic lab still measured a 0.30-second maximum event-loop gap, above the proposed 0.10-second slice budget. Sustained traffic, target hardware and browser interaction remain release gates. Schema revisions and baseline validation add client complexity, so tests must cover reconnection and missing or mismatched baselines.
