# ADR 0068: Act on availability monitoring from Sources

**Status:** Accepted; action wording and Issues workflow extended by [ADR 0069](0069-bulk-availability-removal-from-issues.md)
**Later presentation decision:** [ADR 0071](0071-compact-monitoring-inspector.md) combines policy and technical information in Details and adds visible monitoring coverage and filtering.

**Later decision:** [ADR 0070](0070-saved-monitoring-and-history-navigation.md) supersedes the saved-action Undo and History placement provisions where applicable.

**Date:** 2026-10-14

**Partially supersedes:** ADR 0061's requirement that every source monitoring change open the complete policy editor. Policies remain the configuration owner. This decision preserves the availability meanings in ADR 0025 and ADR 0064.

**Later decision:** [ADR 0073](0073-entity-first-monitoring-details.md) supersedes the applicable entity-detail layout, contextual history placement and availability action wording; existing monitoring and issue semantics remain unchanged.

## Context

Source details explain individual and device monitoring at length, but require the owner to visit complete policy editors to stop watching one unwanted entity. The owner requested a quieter detail page with actions beside the condition, explicit unmonitoring and a way to resume. Unavailable remains a reported availability problem while monitored. An integration's use of unavailable for a prohibited action does not change Home Assistant's documented state meanings.

## Decision

Lead source details with the named source, current condition and relevant actions. Keep the Home Assistant link visible. Collapse the policy explanation under Why this is monitored, and place entity IDs and the Homeostatic reconciliation timestamp in Technical details. Preserve history and the existing state distinctions. Compact the mobile application header without hiding global notification state or navigation.

For entities, offer Stop monitoring availability. The action names the selected entities and all affected policies before saving once. Add their canonical source IDs to each applicable saved entity-availability policy and device-availability member exclusion. Other check types, positive selectors, enabled states, notification choices and unrelated drafts stay intact. Device details can apply the same operation to an explicitly selected set of entities. No device-wide or integration-wide action is implied by selecting one member.

Resume monitoring removes explicit exclusions for the selected entities from the named availability policies. Remaining policy scope and eligibility still govern enrollment; resumption does not enable a disabled policy or force an unselected source into monitoring. Undo reverses only a confirmed contextual operation, and refuses a conflicting subsequent policy edit. There is no new exclusion store or second general policy editor.

Use the existing guarded save path with one exact complete payload assembled from confirmed settings. Reject stale revisions and affected policy drafts, preserve unrelated drafts, serialize application and retain errors beside the operation. An uncertain outcome must be reconciled against saved settings before another submission. Rendering and browsing never mutate configuration. Read-only or disconnected views cannot save.

Excluding one source preserves the identities, issues, acknowledgment and reporting clocks of unaffected checks. A saved exclusion edit that changes a device's currently eligible selected evidence replaces that device's check. Ordinary registry growth, removal, disablement or re-enablement preserves a device check while it remains enrolled, including changes to an already excluded member. Empty devices still end monitoring. Monitoring ended is distinct from recovery; resuming qualification does not inherit an earlier ended issue's controls. Existing saved configurations and persisted identities require compatibility coverage.

Persist adapter-owned check identity bindings and the previously evaluated policy exclusions in storage envelope 3. Bind each device by its policy, canonical device identity and detection settings without exclusions. Compare changes to saved exclusions against current eligible members; registry churn alone never replaces the binding. An effective exclusion edit must produce a different actual check identity even when an earlier sequence of exclusions and registry changes would reuse its current hash. Preview and application calculate the same replacement without mutating the previewed runtime. Seed bindings once when reading an envelope-2 installation, before passing the opaque snapshot to the engine. Missing or malformed bindings or scope metadata in a version-3 envelope fail visibly. These are continuity records, with policies remaining the only configuration owner. A subsequent pilot installation requires a paired state and component rollback.

Expose acknowledgment and pause only with their actual issue scope. When a source participates in a larger correlated issue, name that scope before presenting the controls. Never apply an entity-labelled action silently to every issue in a group.

## Acceptance

Verify device continuity through excluded-member removal, disablement and return, both during operation and while stopped. Cover ordinary member growth and loss, upgrade from envelope 2, a repeated exclusion whose provisional identity matches a retained check, pure preview/application parity and durable-save rollback. Assert issue identity, acknowledgment, pause, reporting clocks and history, and reject malformed envelope-3 continuity metadata.

Exercise compact entity/device details, preserved availability states, expanded policy and technical disclosures, exact issue controls, stop/cancel/resume/undo, selected-member batches, conflicting drafts, stale saves, failed or uncertain responses and disconnected views. Verify saved settings after reopening, unchanged unrelated monitoring and retained issue history. Browser acceptance uses synthetic evidence and mocked saves; live installation remains a separate authorized step.
