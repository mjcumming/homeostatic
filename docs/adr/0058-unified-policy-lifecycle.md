# ADR 0058: Use one editable policy lifecycle

**Status:** Accepted
**Date:** 2026-10-13

**Partially supersedes:** the editable check type, separate built-in enrollment presentation and shared-check restriction for overlapping policies in [ADR 0054](0054-reusable-monitoring-policy-editor.md); the required UPS/battery ownership transfer in [ADR 0051](0051-monitor-ups-conditions-through-shared-mappings.md); and the preservation/conversion requirements for existing test settings in [ADR 0055](0055-separate-notification-schedules-and-methods.md) and [ADR 0057](0057-policy-owned-notification-timing.md). Policy-owned timing and reusable delivery methods remain the accepted notification model.

## Context

The combined policy mockup was positively reviewed: supplied policies appear immediately with user-created policies, and all use the same editor. Subsequent review settled type identity, supported settings, overlap and deletion. The owner explicitly waived migration of existing settings because this redesign is in a test phase. Keeping compatibility with those settings would add work without a requirement.

## Policy identity and ownership

Use one ordinary policy model for supplied and user-created policies. Both support editing, duplication, enabling, disabling and deletion. Supplied origin confers no deletion protection. Show them together in one list without a separate collapsed built-in section.

Choose the monitoring type when creating a policy. Once created, the type is immutable and shown read-only. Duplicates retain that type and start as independent inactive copies. Names, source selection, supported detection settings, enabled state and notification entries remain editable. Use Add policy to monitor a different kind of problem. Use Monitoring type as the user-facing label.

Each policy owns its notification entries under ADR 0057. Each entry has immediate or scheduled timing and one or more selected reusable delivery methods. No entries means dashboard-only monitoring.

## Capabilities and overlapping policies

Build source-selection options and detection fields from the capabilities of the selected type. The reviewed selection patterns are all eligible sources, selected sources, sources in areas and sources with labels. Offer only patterns that work for that type. Verify the exact supported mappings against the producers and source metadata during implementation. Do not assume integration sources have area or label membership or show a selector that cannot match them.

Where supported, multiple selected sources, areas or labels use the reviewed searchable picker. Any selected area or label matches within that selection mode. Retain selections through filtering; show a compact summary when the picker closes. The mockup establishes the interaction, while runtime matching and detection need executable validation.

Allow deliberately overlapping policies, including battery policies with different thresholds and UPS reserve alongside generic battery monitoring. Evaluate each policy's configured detection and notification behavior independently, and identify the contributing policy in its findings. Owners decide whether the resulting notifications are useful and can edit, disable or delete policies themselves.

Do not prevent overlap, add a priority/conflict wizard, require ownership transfer, automatically replace another policy or silently merge configurations. Existing dependency grouping may still organize issues; it must not erase independently configured policy behavior. The UPS evidence, power-mode selection and renewed-attention rules remain in effect; the mandatory battery-ownership transfer does not apply to this redesigned model.

## Supplied policies and updates

Install supplied definitions as ordinary user-owned policies. Keep templates available for adding policies and selectively restoring deleted defaults. Restoration is explicit and must not overwrite unrelated policies. Deleting a supplied policy leaves it deleted; restart and software updates must not recreate it automatically. Preserve user edits to surviving policies on updates. These lifecycle rules apply to the new model even though migration of earlier test settings is waived.

Start with integration, device and entity availability monitoring, Repairs and broken automations enabled. Batteries and vacuums are optional and start off. Temperature limits, thermostat deviation and UPS monitoring require source/settings selection and are offered as templates. Every supplied policy starts with no notification entries, and the global notification switch starts off. Fresh setup therefore monitors for the dashboard without unsolicited notification sending. Monitoring enabled and notification delivery enabled remain separate choices.

## Test-phase rebuild without migration

No migration of existing test settings is required for this redesign. Remove legacy enrollment, general-default inheritance, source/condition override conversion, shared-schedule expansion and preservation of old pending requests as implementation prerequisites. The new editor does not need compatibility controls merely to retain those settings. Configure new policies directly in the unified model.

Do not automatically reset or convert existing configurations during upgrade. Fresh setup is the supported path for trying this testing redesign; older test schemas may be incompatible with the new editor and validator. This transition does not promise backward compatibility.

This waiver concerns the transition from the previous test configuration. Normal save, reload and restart of the new model must retain its policies, user edits, deletions and runtime state according to the existing lifecycle contracts. Reading or editing still sends nothing; reviewed saves and explicit delivery tests remain separate actions. The waiver does not authorize resetting a live installation, deleting files or stored settings now, enabling delivery, or deploying the redesign.

## Implementation and validation

Implement the [editor design](../policy-editors.md) against this lifecycle and ADR 0057's timing model. The parser and runtime support configurable battery thresholds and independent overlapping policies. These remain required behavior when the editor changes. Verify per-type selection and parameter support before exposing controls.

Add executable scenarios for immutable type, independent duplication and overlap, supported selectors, configurable detection, deletion, selective restoration, update preservation, first-run silence, and persistence of the new model. Browser tests cover the unified list, read-only type, conditional fields, searchable multiple selection, notification entries, review, keyboard use and narrow screens. No legacy migration scenarios are required for this redesign.

Update the existing specification, user guide, reference, event documentation and screenshots with implementation. They describe the unified model and identify retained legacy contracts separately. The accepted decisions above do not require a legacy conversion contract.
