# ADR 0059: Save directly and test configured delivery methods

**Status:** Accepted
**Date:** 2026-10-13

**Partially supersedes:** the required review-before-save UI in [ADR 0019](0019-accepted-dashboard-baseline.md), [ADR 0028](0028-settings-scope-and-visible-reporting.md), [ADR 0031](0031-review-source-settings-together.md), [ADR 0036](0036-compact-sources-evidence-and-choices.md), [ADR 0048](0048-policy-checks.md), [ADR 0049](0049-repairs-check.md), [ADR 0054](0054-reusable-monitoring-policy-editor.md) and [ADR 0057](0057-policy-owned-notification-timing.md); the preview-before-test UI in [ADR 0056](0056-ha-delivery-methods-and-presence.md); and connection-level integration selection in [ADR 0058](0058-unified-policy-lifecycle.md). This applies to all retained editors and maintenance controls, including older rule-based and reporting editors. Validation, authorization, stable identities, revision checks and rollback remain required.

## Context

Trying the policy redesign exposed unnecessary steps and unclear choices. Restoring defaults led to a failed review with no useful explanation. Integration choices displayed account and phone names without identifying the integration. Repairs and broken automations offered a dropdown for their only scope. Notification setup exposed an exhaustive service inventory, mislabeled generic services as SMS or email, and repeated the same destination list in a separate test area.

The owner accepted one Save action throughout the UI, integration-family selection, type-specific labels and testing only a configured delivery method. The existing immutable monitoring type remains unchanged.

## Save and apply

Every configuration editor has one Save changes action. Remove separate Review buttons, review screens and preview prerequisites throughout the UI. Maintenance also applies directly from its completed form without a review step. Validate the full exact draft during the action, require administrator access, reject stale saved revisions, serialize saves and restore previous options if applying settings fails. An internal preview/token exchange can preserve these guarantees without asking the owner to operate it. Public read-only preview APIs may remain for compatibility and inspection.

Retain drafts through navigation and failures. Give actionable validation, conflict and apply errors. Capture the submitted payload so changes made while saving cannot be mistaken for the validated payload. A concise deletion confirmation can identify affected policies or shared-method uses; it does not create a general review workflow.

Restore selected adds missing defaults to the draft. Save applies them. Fresh setup supplies defaults, while reloads and updates preserve deliberate deletions and edits. Do not add an automatic reset or resurrect deleted defaults.

## Policy choices

Monitoring type is chosen at creation, read-only during editing and retained by duplicates. Supported scope and detection settings remain editable.

Selected integrations are integration families identified by domain, such as Mobile App or Matter. Choosing a family watches all eligible configured connections now and in future. Account and phone names may appear as supporting detail, but are not selectable integration choices. Existing saved connection-specific choices must not silently broaden merely because the editor is opened or an unrelated setting is saved.

Name source pickers for their type: Choose integrations, Choose devices, Choose entities and the corresponding headings and help. Repairs watches all Repairs. Broken automations checks all automations for references to missing entities. These editors show a short explanation instead of a single-choice Watch dropdown or generic condition text with no setting to edit.

## Delivery setup

A method editor starts with its name, its selected destinations and Add destination. A new unsaved method does not masquerade as a saved item in the list beside the editor. Add destination chooses the delivery type first and then offers a searchable list of supported configured destinations. Use friendly names and location context where available; technical identifiers belong in optional details.

Show only capabilities established by the provider and target. Generic notify entities or actions do not establish email or SMS support. Unclassified notification routes remain generic. Only verified SMS providers offer recipient-number fields. For speech, choose the speaker first and then a provider when needed; do not list every provider/player pair. Unavailable targets are hidden from new selection by default, while unavailable saved targets remain visible for repair.

Fixed destinations are the ordinary path. Presence controls are optional and reveal home/away or selected-people choices with an explicit fallback or skip. Existing presence and replay semantics remain unchanged. Put Enable notifications near the top of Notifications and explain that monitoring continues while it is off.

## Testing

Send test appears only in the editor of a saved unchanged delivery method. There is no separate testing area, global destination-test list, test destination picker or user-operated preview step. Editing requires saving before another test. Resolve the method's current destinations and presence at the explicit test action; internal target validation can use the retained preview API.

A test requests messages only through that method's resolved configured destinations. It works independently of normal notification activation. Show requests, per-destination failures and explicit skip outcomes without claiming receipt or speech heard. Opening, editing, validating and saving a method never sends a test. Tests use isolated Home Assistant instances and mocked transports.

## Consequences and validation

The owner completes a configuration once and saves it once. Implementation must retain stale-revision, concurrent-edit and rollback protection without exposing backend validation stages as navigation.

Executable coverage includes direct saving in each editor, validation and apply errors with retained drafts, selective restoration, fixed type, integration families with multiple and future connections, truthful transport classification, compact destination selection, saved-only method testing, presence fallback and unavailable targets. Browser checks cover keyboard use, narrow screens and the absence of required Review actions and separate test areas. No release or live installation change follows from accepting this decision.
