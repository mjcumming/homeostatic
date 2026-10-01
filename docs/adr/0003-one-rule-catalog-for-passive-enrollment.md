# ADR 0003: Use one rule catalog for passive enrollment and exclusions

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

Home Assistant discovers many entries and entities, including new ones after setup. A fixed entity list would miss arrivals; separate per-entity overrides would create a second selection system. The owner settled a single attribute-matching rule model and passive default in the first-release decision.

## Decision

Catalog rules attach supported checks or exclude sources. Attach matches are additive; any matching exclusion wins regardless of rule order. Match identity uses registry and config-entry ids rather than display names. A narrow rule handles a special case. New eligible sources inherit matching rules. The starting rule attaches passive HA availability to eligible sources, while notifications start off. Previews show matches and effective enrollment before saving; excluded and unmatched sources remain in the searchable inventory. An excluded capability required by a function stays an unwatched requirement rather than becoming ready.

## Options considered

- **Maintain a selected-entity list with per-entity overrides.** It would need ongoing enrollment for new sources and a second precedence model.
- **Make rule order decide exclusions.** Reordering a rule would silently change monitoring scope.
- **Hard-code a small set of integration domains.** It would miss future sources and owner-specific capabilities.

## Consequences

One rule system owns selection and provenance. Broad passive enrollment can create a large catalog, so the UI summarizes unselected inventory and bounded searches, and whole-house runtime scale remains a separate qualification gate. Active probes and per-check timing overrides require later evidence and their own contract; the initial availability catalog does not imply physical-device health.
