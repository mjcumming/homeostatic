# ADR 0013: Retire automatically selected sources when HA removes registry evidence

**Status:** Accepted

**Date:** 2026-09-27

**Deciders:** Michael Cumming

**Supersedes:** ADR 0012 only where it retained automatically selected device summaries after their last eligible entity disappeared.

## Context

Broad catalog rules select current and future HA sources. Home Assistant can remove an entity from its registry while leaving its device record. Retaining every previously matched identity then creates indefinite missing-evidence warnings for sources that the integration no longer provides. The entity-registry removal event reports the removed identity, not whether a person or an integration caused the removal. A separate brand-specific rule or inferred user intent would not be reliable.

## Decision

- Treat broad rule matches as conditional on current registry membership. Remove an automatically selected registry entity when its registry record is gone. Remove an automatically selected device summary when its last eligible registry entity is gone, even if the device record remains. Keep eligible registered entities with missing HA states in scope as unknown evidence.
- Retain an exact entity-id attach rule, a legacy explicit entity selection, or a function requirement as an explicit entity expectation after registry deletion. Retain an exact device-id attach rule as an explicit device expectation without eligible members. These remain unknown until their evidence returns or the owner edits the expectation.
- Retain a state-only entity identity while its state is absent because no entity-registry removal is available for it. Its identity is weaker and does not follow an entity-id rename.
- A removed watched source ends its active episode as `removed`, keeps the bounded resolved history, and records a scope transition. Removal never reports recovery. If matching evidence returns, the source can enroll again under the same rule.
- Apply the same distinction to all integrations. Automatically selected config entries already leave scope when their registry entries are deleted.

## Consequences

Removing a source from a broad rule reduces current monitoring scope. The catalog can still show HA device records without eligible entities separately, with no availability check or fault episode. Owners who intend to monitor a missing source must select its exact identity or retain it as a function requirement. HA's removal event cannot prove why the source disappeared.

## Validation

Exercise automatic entity and device removal during runtime and after restart, preserved explicit selections, missing state with an intact registry entry, removed episode history, and re-enrollment when evidence returns.
