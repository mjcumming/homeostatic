# ADR 0029: Load revision-bound catalog pages on demand

**Status:** Accepted; finalized by [ADR 0092](0092-scoped-refresh-and-coherent-saves.md) on 2026-10-17; the reload of every page on each revision change is superseded by [ADR 0095](0095-patch-catalog-after-edits.md)
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-09-29

## Context

Compact subscriptions avoid repeated full catalogs, but the initial event and
every catalog invalidation still transfer several megabytes before Open issues can
show problems. Monitoring needs complete search and a continuous expandable tree.

## Decision

Extend ADR 0010 with an opt-in schema-3 summary and administrator-only catalog
pages, bounded to 200 rows each. Open issues receives evidence and the names needed
for current problems and controls. Inventory-dependent views request the full
catalog lazily, sharing one client cache and at most four concurrent page requests. The client
installs all pages together only if their revision is still current, merging
the newest evidence. It exposes loading/error states until search is complete.
Reload, disconnect and revision changes invalidate pending results. Existing
schema-1 and schema-2 clients keep their contracts.

## Alternatives

- A full initial catalog retains the measured transfer and parse cost on every
  dashboard opening, including views that never browse sources.
- Server-side search and tree-branch queries would reduce total Sources bytes,
  but would also change search, draft previews and navigation. They remain a
  separate design decision.
- Publishing partial pages as complete inventory can hide search matches and
  misrepresent monitoring scope.

## Consequences

Open issues no longer needs the installation-wide catalog. Monitoring still transfers
the complete catalog when opened, but each response and parse is bounded in row
count. A single source row can still be large; this is not a byte or latency
guarantee. The server retains one shared full presentation for legacy clients.
No monitoring settings, episode rules or notification activation change.
