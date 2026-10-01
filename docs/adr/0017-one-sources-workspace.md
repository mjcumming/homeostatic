# ADR 0017: Use one Sources workspace

**Status:** Accepted
**Date:** 2026-09-27
**Decider:** Michael Cumming

**Partially supersedes:** ADR 0008's separate Explore destination and ADR 0016's integration-only navigation for the monitoring editor. HA topology remains presentation-only, and all ADR 0016 enrollment/default rules remain in force.

## Context

Explore, Monitoring, and Settings ask the owner to find the same source repeatedly. Their different hierarchies, expansion behavior, and long review lists make that task harder. Sharing a tree component across three destinations would improve consistency but retain the repeated navigation. The owner agreed to one shared source workspace and asked to document that direction before more implementation.

## Decision

Use one Sources destination for source discovery, evidence review, and contextual monitoring choices. Keep one selected source and one detail panel. Show identity/location, current evidence, and current monitoring together; Edit monitoring opens a deliberate draft in that panel. Do not recreate Explore, Monitoring, and Settings as three mandatory detail tabs.

Offer integration and location groupings of the same source identities. The integration view keeps integration, device, and entity levels. The location view uses HA floors and areas. Catchalls keep sources with missing associations reachable. Search and Needs review filter this hierarchy; evidence gaps do not produce a separate flat report or automatically open every affected branch. Preserve independent expansion, selection, ordinary page scrolling, and the absence of nested pagination from ADR 0016.

Retain Overview, Issues, History, and installation-wide Settings. Settings owns alert/delivery options, functions, situations, and general configuration. Links concerning one source open that source in Sources. Monitoring edits retain the existing catalog, administrator boundary, exact preview, revision check, save/reload, and failure behavior.

The target contract and acceptance criteria are in [the specification](../spec.md#sources-workspace-target).

## Alternatives

- Three pages sharing a tree still require repeated context changes for one source.
- Three compulsory detail tabs move the same fragmentation inside the workspace.
- A single flat inventory or review list makes installation size dictate the page's complexity.

## Consequences

Existing source links and reusable-card views route into Sources. Selection uses stable identities, never a display-name search. Migration changes presentation and navigation only: it cannot enroll sources, alter saved defaults, change dependency or episode decisions, or enable notifications.
