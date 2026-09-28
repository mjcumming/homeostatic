# ADR 0016: Guide availability enrollment by integration

**Status:** Accepted
**Date:** 2026-09-27
**Decider:** Michael Cumming

**Navigation scope extended by:** [ADR 0017](0017-one-sources-workspace.md) adds the HA location view in one Sources workspace. Integration/device/entity navigation, enrollment defaults, exception precedence, and the absence of nested pagination remain in force.

**Supersedes:** ADR 0012's broad device default and ADR 0003's unconditional exclusion precedence for integration device defaults.

## Context

A broad device-summary default treats transient network clients as expected to remain available. Eero can discover visiting phones and can see one phone under a new identity when its Wi-Fi address changes. A per-client exclusion does not cover the next identity. The current settings tree also paginates inside a scroll window and exposes overlapping rule controls and internal ids.

## Decision

- New installations watch integration connection state by default. Device summaries and separate entity checks require an explicit owner choice.
- An integration can establish a default for current and future device summaries. Leaving those devices unmonitored creates no check, episode, or alert. An exact device watch can override that integration default. Other exclusions still win, including entity exclusions from summary membership.
- Saved broad rules keep their previous scope until the owner previews and saves a change. Scope removal ends affected episodes as removed, not recovered.
- Keep one rule catalog. The integration device default is an overridable exclusion in that catalog, not a second preference store. Expose the effective current state and future-match scope in the guided editor.
- Navigate only integration, device, and entity levels. Expand branches on demand and use whole-inventory search rather than nested pagination. Show readable policy summaries before technical rule fields.

## Consequences

Transient clients can remain discoverable without becoming problems. Owners can still select equipment that matters. A watched integration connection alone does not establish that its clients or equipment operate. Broad custom rules can still affect an integration; the preview must show the effective result. Large branches render only when opened, and browser tests must cover the navigation at pilot scale.
