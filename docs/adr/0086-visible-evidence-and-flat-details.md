# ADR 0086: Show essential evidence and keep supporting details flat

**Status:** Accepted
**Date:** 2026-10-16

**Later decision:** [ADR 0091](0091-direct-issue-actions-and-coverage.md) removes the opened issue's Details expander and generic Monitoring destination, and adds direct entity/device, policy and notification buttons. Supporting evidence remains visible. Separate source inspectors retain the applicable rules below and in ADR 0089.

**Later decision:** [ADR 0089](0089-contextual-entity-monitoring-policies.md) moves entity policy explanations and editing into a contextual Monitoring policies dialog and uses linked Device and Integration names. Other source types retain their visible policy actions.

**Partially supersedes:** the source-detail disclosures in ADRs 0036 and 0038, the issue and source presentation in ADRs 0061 and 0071, and affected-member presentation retained by ADRs 0073 and 0085. Tree grouping, entity-first inspection, recorded issue membership and all monitoring and notification decisions remain unchanged.

## Context

An opened availability issue hid a single affected entity behind another disclosure, replaced its name with Entity, repeated the same findings in supporting sections and exposed an internal notification identity. Opening Details still required another expansion to see recorded sources. The owner requested visible names and conditions, one useful Details section and concise destination links across related views.

## Decision

An opened issue shows its affected names, reported conditions, opening time and action scope directly. Short affected-source lists stay visible. In the issue list, waiting checks appear directly beneath their affected device without a separate disclosure. Group entity findings under their device without adding the device summary and its entities into one headline source count. Describe the affected devices and entities without a device separately. Independent checks retain their identities and contributions.

Shortening a repeated device prefix must leave a meaningful entity name. When the full entity name equals its device name, retain the full name. A generic label such as Entity or Selected entity cannot replace a known name. Keep current missing evidence distinct from unavailability and from an earlier reported problem.

Each issue or non-entity source inspector may have one optional Details section for supporting information. Opening it reveals its contents together, with ordinary headings and lists instead of nested source, check or technical disclosures. Entity inspectors continue to have no Details section. Show the relevant evidence once and retain earlier recorded scope when it adds information absent from the main view. Recorded membership does not imply that every member still has a problem. Large sets must remain bounded and completely reachable; do not hide a short list merely because the same renderer handles large sets.

Apply the same rule to source inspectors: current problems, missing readings, short source lists, contributing policy actions and active controls remain visible. Additional ordinary readings and technical information may appear together in Details. Group expansion in inventory trees and issue lists remains a separate navigation control. Confirmation forms retain their existing exact entity and policy scope.

Name links for their destination, such as Open device, Open integration and View integration logs, when the surrounding source identifies the target. View in Monitoring opens the selected source's current evidence and monitoring context; provide it once per useful destination. Do not repeat a link already supplied by a named source. Omit routine loaded-integration statements when they add no decision-relevant information. Preserve an integration's actual failure or a scope distinction that changes how the evidence should be understood.

Notification status uses a configured display name when supplied, or a concise evaluated status such as Scheduled summary when no display name is available. Preserve readable legacy labels when they identify the configured behavior. Internal notification and check identities remain diagnostic data and must not become display labels. Showing or opening details never changes monitoring, issue identity, recovery, acknowledgment, notification eligibility or delivery.

## Acceptance

Exercise a shared issue with two devices and one affected entity each, including an entity with the same name as its device. Cover standalone entities, mixed unavailable and missing evidence, overlapping check contributions, earlier recorded members and notification identities without a known display name. Verify the complete affected scope and exact issue actions survive the presentation change.

Inspect the issue and related source views on desktop and narrow screens. Names and conditions must be readable before expansion; one Details expansion must expose the remaining content without another disclosure. Check meaningful navigation, live-update continuity, long lists, keyboard access and viewport fit. Use isolated scenarios without live notification requests.
