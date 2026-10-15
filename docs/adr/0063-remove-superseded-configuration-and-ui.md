# ADR 0063: Remove superseded configuration and interface implementations

**Status:** Accepted
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Date:** 2026-10-14

**Clarifies:** ADR 0058's test-phase rebuild without migration and ADR 0061's preservation of saved monitoring. Preservation applies to the unified policy model. It does not require a second runtime or editor for pre-policy test configurations.

## Context

The Issues-first redesign left older page renderers, source enrollment controls, configuration endpoints and reporting conversion paths in the application. Some were unreachable; others continued to support a configuration model whose migration requirement had already been waived. Current documentation also continued to describe those superseded workflows. This made it difficult to tell which behavior was intentional and allowed obsolete paths to remain maintenance obligations.

The maintainer explicitly requested removal of this code. The separate question of whether individual entity availability should be monitored by default remains under review. Removing obsolete implementations must not decide that monitoring question implicitly.

## Decision

Use the unified monitoring policy model as the only equipment configuration model. Remove the old source enrollment editor, fixed reporting editor, shared-schedule conversion, and alternate runtime selection for pre-policy test settings. Remove their handlers, endpoints, imports, abandoned renderers and tests. Update current documentation to describe the remaining implementation. Historical ADRs retain their rationale and identify the replacement.

Preserve the accepted Issues, Sources, Policies and Notifications workflows, source evidence explanations, scoped drafts and saves, notification methods, and installation timing controls. Preserve all current-model saved policies, deletions, methods and notification activation. Retain authorization, exact-payload validation, revision checks, serialized application, rollback, and the existing issue and outbox lifecycle.

Do not migrate, reset or delete live configuration as part of this cleanup. Reject unsupported older configuration explicitly. Fresh setup in an isolated installation remains the supported way to try the replacement model. A current-model restart or unrelated save must not rewrite monitoring scope.

Keep small route aliases where required to open a supported destination from an existing link. An alias is not a second page implementation. Keep catalog matching, evidence producers and public health-tree adapters that the current model actually uses. Names such as rule, profile or policy are not sufficient evidence that a helper is obsolete: automation-owned alerts still have a supported reporting contract, and policy compilation still creates internal rules.

Remove tests that exist only to preserve the retired configuration or interface. Preserve and exercise their still-required behavior through the current model, especially disabled-source eligibility, missing evidence, scope removal, restart, delivery and guarded saving. Cleanup is complete only when the replacement paths pass their checks and remaining references have a current purpose.

## Monitoring boundary

The Entities policy currently selects enabled eligible entities, whether or not they belong to a device. Its default is not a legacy renderer artifact. Device availability is inferred from selected entity evidence and does not establish that every feature works. The [coverage review](0064-monitoring-coverage-and-device-evidence.md) records the use cases and alternatives before any default or evidence rule changes.

## Consequences

There is one equipment configuration model and one implementation for each current workflow. Older test configurations can fail validation, as already permitted by the rebuild decision. Deployments must replace the installed component directory so deleted modules cannot remain. This change does not authorize deployment, notification tests on the live installation, or deletion of its saved data.
