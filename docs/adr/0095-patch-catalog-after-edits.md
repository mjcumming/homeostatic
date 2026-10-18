# ADR 0095: Patch the catalog after an edit instead of reloading it

**Status:** Accepted on 2026-10-17; implemented, installed and measured on the household installation; unreleased
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-17

**Partially supersedes:** ADR 0029's reload of every catalog page whenever the revision changes. **Extends:** ADR 0010's in-memory catalog revision and ADR 0092's schema-3 panel summary.

## Context

The [live attribution](../save-performance.md#live-attribution-of-a-stop-monitoring-action) of a Stop Monitoring action on the household installation found that, after the save, the panel discards its cached catalog and fetches 63 pages with about 11,800 rows through four workers, taking 1.5 to 3 s, and then rebuilds its trees. With the deprecated device property reads removed, the action settles in a median 5.3 s and that reload is the largest remaining share at 1.8 s. The edit itself changed a handful of rows: one watched node, one candidate's enrollment flags, one enrollment change record and one readiness target.

Two server behaviors cause the reload. The dashboard raises the catalog revision whenever discovery replaces the static inventory object, even when every row is equal, so a discovery that changes nothing can still invalidate every client. Each rule change regenerates every candidate row, so the client has no way to tell which rows moved.

## Decision

Content decides the revision. When the runtime publishes a replaced static inventory, the dashboard compares each section with the sections it last published: nodes and candidates by `node_id`, areas, devices and floors by `id`, readiness targets by value, and enrollment change records by batch and node. Equal content keeps the current revision and sends no catalog change.

When content changed, the revision increases by one and the schema-3 subscription event carries a one-step delta beside the new revision: the previous revision, and for each section the inserted or replaced rows and the removed keys, with enrollment change records appended. The event carries a delta only when the change fits in one page of rows across all sections; a larger change sends no delta.

A client applies a delta only when its complete catalog is loaded at the delta's previous revision. It then patches its sections, holds the new revision and requests no page. In every other case, including no loaded catalog, a different base revision, a missing delta, reconnection and runtime replacement, the client keeps the existing full paged reload and its stale-catalog safeguards. Section order carries no meaning for clients; the panel sorts what it shows.

Catalog pages, schema-1 and schema-2 subscriptions, the save response, exact-payload validation, stale-revision checks on saves, verified persistence and rollback are unchanged. The server keeps only the sections it last published; it holds no delta history. Follow-up detail and configuration reads after a save remain separate requests.

## Alternatives

- Returning the changed rows in the save response serves only the client that saved. Other open panels and the saving client's own subscription would still reload, and the catalog contract would live in two places.
- Server-side search and tree-branch queries, named in ADR 0029, remove the client cache altogether. They change search, draft previews and navigation and remain a separate design decision.
- Larger pages or more concurrent workers still transfer and parse every row after each edit.
- Comparing content for the revision while keeping full reloads removes only the idle invalidations and leaves the edit cost in place.

## Acceptance

Exercise an exclusion edit on a large catalog: the event carries exactly the affected rows, the revision increases once, and the client's patched catalog equals a fresh full load when compared by key. Exercise a discovery that changes no content: the revision and the client's catalog stay as they were and no page is requested. Exercise a change larger than one page, a client whose base revision differs, a client with no loaded catalog, reconnection and runtime replacement: each takes the full paged reload, and page requests at an old revision are rejected as today. Exercise two clients editing in turn: the second applies the delta or reloads, and its save still fails the revision check when the configuration moved on. Compare schema-2 payloads before and after. Measure the same Stop and Resume actions on the household installation with the existing in-page method and report catalog work and settled time before and after.

## Consequences

Edit events grow by the delta they carry. Publishing a changed catalog costs one pass of row comparisons over the previous sections, bounded by the catalog size. The client gains one more path beside its baseline and reload logic, and every uncertain state still resolves through the full reload. Idle discoveries that change nothing stop invalidating clients.
