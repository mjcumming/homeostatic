# ADR 0019: Implement the accepted dashboard baseline

**Status:** Accepted
**Date:** 2026-09-27
**Decider:** Michael Cumming

**Supersedes:** ADR 0017's stacked mobile layout and ADR 0018's hidden monitoring editor. Their one-tree workspace, source views, identity, and reviewed-save boundaries remain in force. Extends ADR 0016 to integration-family defaults.

## Context

Repeated live UI iterations exposed the wrong hierarchy: integration-entry titles appeared as integration types, selected details scrolled out of reach, mobile details appeared above the source list, and simple choices required technical interpretation. Timing controls remained outside the custom settings page. The owner approved a clickable mockup and requested that it be built.

## Decision

Implement the five-page baseline in the specification. Use real integration families, a persistent desktop workspace, and list-to-detail mobile navigation. Keep Source, Settings, and History views for the selection, show monitoring controls immediately, and retain explicit review before saving. Use the existing catalog and Home Assistant options as the only configuration store.

Add a generic integration-domain matcher so family defaults include subsequently created integration connections. Do not special-case Eero, infer hardware identity from names, or rewrite existing saved enrollment automatically.

Expose the ten existing house timings and supported notification policy fields through a guarded installation-settings editor. Preserve arbitrary rules and definitions; transport remains in consumer automations. This does not adopt the separate proposed built-in notification sender.

## Consequences

The interface can answer ordinary household questions without exposing raw identifiers. A generic matcher supports opt-in network clients and opt-out fixed equipment without brand-specific health logic. Existing broad selections require an explicit reviewed change. Local mockup appearance is a design baseline; live behavior must be verified with actual component data and isolated configuration tests.
