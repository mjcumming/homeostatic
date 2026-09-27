# ADR 0008: Use native HA topology for presentation, not causation

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

The owner needs to browse a recognizable house without constructing a second location registry first. Home Assistant already has floors, areas, devices, and entities, but its device registry can include bridges, services, and virtual groupings. Location or device membership does not establish that one capability depends on another. The owner agreed to HA-first browsing with optional later TopoMation enrichment in `docs/ui.md` section 17.

## Decision

Explore starts with HA floors and areas and groups entity sources under their current HA device association where one exists. Sources without an area or device remain reachable. Registry grouping changes presentation only: it never attaches a check, creates a dependency edge, suppresses an episode, or changes importance or readiness. The catalog rules and owner-confirmed function requirements remain the monitoring and causal authorities. TopoMation may later enrich navigation, but its absence cannot block monitoring.

## Options considered

- **Use a flat integration/entity list only.** It makes household exploration and local consequences hard to recognize.
- **Require a separate TopoMation or custom house tree.** It adds a prerequisite before the first useful Homeostatic view.
- **Infer causal edges from location or device association.** Co-location and registry membership do not prove a hard dependency.

## Consequences

HA moves update where a source appears, and rule matching can separately change enrollment. Device counts are registry associations, not physical-equipment counts. Optional richer topology needs an explicit mapping and fallback contract before implementation.
