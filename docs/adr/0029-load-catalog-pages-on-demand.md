# ADR 0029: Load revision-bound catalog pages on demand

**Status:** Proposed; implemented locally for review

**Date:** 2026-09-29

## Context

Compact subscriptions avoid repeated full catalogs, but the initial event and
every catalog invalidation still transfer several megabytes before Overview can
show problems. Sources needs complete search and a continuous expandable tree.

## Decision

Extend ADR 0010 with an opt-in schema-3 summary and administrator-only catalog
pages, bounded to 200 rows each. Overview receives evidence and the names needed
for current problems and controls. Inventory-dependent views request the full
catalog lazily, sharing one client cache and one sequential download. The client
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

Overview no longer needs the installation-wide catalog. Sources still transfers
the complete catalog when opened, but each response and parse is bounded in row
count. A single source row can still be large; this is not a byte or latency
guarantee. The server retains one shared full presentation for legacy clients.
No monitoring settings, episode rules or notification activation change.
