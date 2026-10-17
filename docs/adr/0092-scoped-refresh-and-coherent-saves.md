# ADR 0092: Scope refresh work and keep configuration reads coherent

**Status:** Accepted
**Date:** 2026-10-17

**Extends:** ADR 0010's separation of catalog and evidence updates, ADR 0067's in-place saves, and the catalog-loading design in ADR 0029. The maintainer accepted the October 17 review and its recommended changes. Existing notification, persistence and reload boundaries remain unchanged.

## Context

A configuration read could return the revision of an in-progress save with the preceding runtime settings. A second editor could overwrite an accepted change without failing the revision check. Measurements also found full discovery on ordinary temperature readings and policy renames, repeated source scans in closed editors, overlapping detail requests, and full catalog loading on the initial Issues page.

## Decision

Configuration reads that include settings wait for a pending save to finish or roll back when a runtime is available. A read while the runtime is absent returns the existing not-ready response. Queued reads resolve the current runtime after acquiring the save lock. Settings and their revision come from the same completed state. Uncontended settings reads remain synchronous and do not discover notification destinations. Delivery capability discovery remains separate.

Ordinary temperature evidence uses the ordered observation path. Catalog invalidation follows relevant metadata and actual thermostat eligibility or membership changes. Unselected climate state changes do not force discovery. Policy renames update affected source and engine labels through public APIs without rediscovering the installation or resetting effective notification instructions. Detection edits retain their existing lifecycle.

Source trees and picker indexes may be reused while their catalog inputs remain unchanged; live evidence stays current independently. Closed policy editors resolve saved selections without building the complete picker. Search covers the full inventory while results render in bounded increments. Missing selections, independent drafts, keyboard focus and saved scope remain intact.

Each source or issue detail view allows one request in flight and coalesces further updates into a subsequent refresh. Selection, user and connection changes invalidate obsolete results. Unrelated evidence updates do not reconstruct an unchanged settings editor.

The shipped panel opts into `homeostatic/subscribe` with `paged: true, panel: true`. This schema-3 variant identifies itself with `panel_context: true`, omits installation-wide coverage, and supplies current issue/control sources with canonical, device, integration and location context. `inventory.monitored_count` describes the complete monitored scope even when no issue source rows are needed. `catalog_loaded` remains false until the complete revision-bound catalog arrives. The Issues list can render without that download; inventory-dependent views and availability edits still request it. Opening an availability issue starts that load and preserves the existing save guards until it completes. Canonical source identity includes entity evidence used by independent temperature checks, even when the check has no explicit monitoring-source field. Existing full, compact and ordinary paged subscribers keep their response contracts.

Keep exact-payload validation, stale-revision checks, the runtime lock, verified persistence, rollback, ordered observations and stable delivery identities. These changes introduce no new store, scheduler, configuration owner or library persistence format. Further persistence work requires evidence after the narrower changes are measured.

## Alternatives

- Broad refreshes make harmless readings and local edits compete with saves and browser interaction.
- Removing revision checks or persistence verification would weaken safeguards without addressing unnecessary work.
- Removing the Issues catalog request alone would lose the context needed by its current presentation.
- Dropping coverage from existing subscription formats would change an established API for other consumers.

## Acceptance

Exercise reads during successful saves and rollback, then verify that a second save preserves the first accepted edit. Assert discovery counts for temperature updates, unselected climate changes and cosmetic policy edits. Preserve issue identities, effective schedules, queued requests and rollback.

Use large-catalog picker scenarios, bounded rendered rows, complete search, missing selections and retained drafts. Verify request coalescing, navigation, reconnect, issue grouping and empty states before catalog loading. Compare legacy subscriber payloads and rendered workflows against isolated Home Assistant. The roadmap owns measured results and installation status.
