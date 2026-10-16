# ADR 0073: Keep entity details focused on the entity

**Status:** Accepted
**Date:** 2026-10-15

**Later decision:** [ADR 0086](0086-visible-evidence-and-flat-details.md) supersedes affected-member disclosures retained for other source types and clarifies name preservation and concise navigation. Entity details continue without a Details section.

**Later decision:** [ADR 0087](0087-remove-maintenance-creation-from-ui.md) removes maintenance creation from the panel. Existing maintenance visibility and cancellation remain available; published actions and runtime semantics are unchanged.

**Later decision:** [ADR 0089](0089-contextual-entity-monitoring-policies.md) replaces entity policy edit links with one contextual Monitoring policies action, links the named Device and Integration directly, and refines entity condition and coverage wording.

**Partially supersedes:** the source detail layout in ADRs 0061, 0068 and 0071; the contextual history placement in ADR 0070; and the availability action wording in ADR 0069. Monitoring semantics, policy ownership, guarded saves, issue scope and quiet save completion remain unchanged.

## Context

The owner found the selected entity pane noisy: repeated Availability and Monitoring labels, collapsed policy information, and issue controls that could affect many other sources. The Monitoring toolbar mixed page filters with tree expansion controls. The owner approved an entity-first layout, clearer control placement and consistent notification terminology.

## Decision

Lead entity details with the entity name, useful location and the current condition in plain language. Omit unassigned location placeholders and repeated type or field labels when they add no information. State actual monitoring coverage separately in one concise sentence. Preserve the distinctions among unavailable, unknown, restored, missing, disabled and unmonitored evidence.

Keep contributing policies and contextual availability controls visible. Remove the entity Details disclosure, raw technical blocks and history footer. Keep meaningful condition evidence, independent condition checks and supported equipment maintenance available. Other source types retain the evidence and affected-member controls needed to explain their scope.

Related issues have a clear View issue action. Acknowledgment and notification pauses belong on the full issue view, where the complete scope is visible; entity details never apply those controls to a larger issue. Name the operations Acknowledge issue and Pause notifications. Acknowledgment records awareness and stops acknowledgment-dependent reminders; other notification behavior can continue. Pausing notifications affects the selected issue and every recipient until expiry, without resolving it.

Use Remove this entity from availability monitoring and Resume availability monitoring for contextual entity actions. Batch labels also name availability monitoring and the selected entities. The existing confirmation identifies affected entities and policies, and other checks remain intact.

Place native navigation beside source identity and name its actual destination, such as Go to integration page, Go to device page or View entity state. Links must not promise a destination they do not open. History remains available through the History page and issue links, and existing source-history routes remain supported.

Arrange the Monitoring toolbar as Search, Monitoring status and More filters. The latter is a button opening an anchored panel that does not resize or rearrange the toolbar. Show active filter state, support keyboard dismissal and restore focus. Place Group by and a stable Collapse groups button immediately above the tree, separate from the selected details. The collapse control affects tree groups only. Preserve filtering, selected-source inspection, expansion state and narrow-screen navigation.

## Acceptance

Exercise entity details with normal, unavailable, unknown, restored, missing, disabled, excluded and mixed-policy evidence. Verify that related-issue navigation preserves source context and only the issue view exposes acknowledgment and pause. Cover exact availability removal/resumption, unaffected condition checks and drafts, uncertain saves, maintenance and old history links. Inspect desktop and phone layouts with long names and light/dark themes. Verify anchored filter placement, keyboard opening and dismissal, focus restoration, live-update continuity, and that Collapse groups leaves issue details and filters intact.
