# ADR 0004: Confirm automation-derived dependencies per function

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

An automation can reference conditions, optional actions, notifications, and runtime templates. A reference does not prove that a household function fails when that entity fails. A false dependency edge can hide an independent failure and inflate impact. The owner settled per-function review, without a global suggestion queue, in `docs/ui.md` section 16.

## Decision

Homeostatic suggests statically discoverable automation references only while the owner defines a particular function. The owner accepts or rejects candidates for that function; unreviewed candidates create no edges. Confirmed requirements use stable identities and remain until the owner changes them, even if an automation later stops referencing them. Missing or excluded confirmed requirements remain visible as unknown evidence. HealthTree alone computes readiness and impact from the confirmed graph.

## Options considered

- **Create edges automatically from every automation reference.** Optional and conditional references would become false hard dependencies.
- **Collect all references in a global review queue.** The owner could not judge necessity without the specific function's purpose.
- **Provide no suggestions.** Definitions would rely entirely on manual discovery and miss useful clues.

## Consequences

The owner must review requirements, and suggestions are deliberately incomplete for runtime templates and downstream scripts. A preview shows proposed edge changes before saving. This decision governs adapter discovery and confirmation; it does not change HealthTree's graph semantics.
