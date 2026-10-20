# ADR 0107: Add new supplied policies disabled on existing installations

**Status:** Accepted
**Date:** 2026-10-19

**Extends:** The supplied-policy lifecycle in [ADR 0058](0058-unified-policy-lifecycle.md) and fresh-install defaults in [ADR 0106](0106-enable-supplied-battery-and-vacuum-policies.md). Newly introduced policies may be added to an existing installation once, disabled. Previously offered policies retain their saved edits, enablement and deletion choices. The preserving upgrade contract in [ADR 0105](0105-preserve-settings-when-adding-collection-delays.md) remains binding.

**Refines:** The general restriction of new defaults to fresh setup or explicit restoration. This narrow exception permits new disabled policy records; it never reapplies changed defaults or restores an absent historical policy. The collection-format conversion in ADR 0105 remains unchanged; any introduction step is independently validated before the combined candidate is saved.

## Context

New supplied policies should be discoverable after an upgrade without changing what an existing installation monitors or sends. Replacing saved settings with the latest defaults would overwrite household choices. Adding every missing default on each load would also recreate policies the owner deliberately deleted.

Fresh setup has no saved monitoring choices to preserve and can enable supplied policies that have usable source and detection defaults.

## Decision

Use the following lifecycle for newly supplied policies:

| Installation or action | Result |
| --- | --- |
| Fresh setup | Create the current supplied policies with their documented fresh-install settings. Enable those with complete, usable defaults. Global notification sending starts off and delivery methods remain unassigned. |
| Existing installation first receives a new supplied policy | Add it as an ordinary saved policy with `enabled: false`, preserving every existing policy and all other user settings. |
| Later load or upgrade | Preserve that policy's saved state, including deletion. Do not reapply its template. |
| Explicit Restore defaults | Restore only the selected missing policies through the existing restoration draft and save. Preserve surviving policies and unrelated editors. |

Templates that require source selection or detection settings retain that setup requirement. Introducing a new monitoring type does not authorize enabling an incomplete policy on fresh setup.

### Add once and preserve deletion

Track which supplied policy introductions an installation has already received in durable configuration metadata. Use stable policy identities and introduction information; names and the current list of missing policies cannot establish whether an addition is new. A rename or changed template is the same introduction and must not create a replacement policy under a new identity.

For an installation without this metadata, establish a baseline covering every supplied policy published before this addition mechanism. A missing historical policy remains absent. Fresh setup records the current baseline, including retired historical identities. Apply only genuinely later introductions, recording their addition together with the resulting validated settings. Skipped releases must add each applicable later introduction once. A skipped introduction whose template is already retired is recorded as handled without adding a saved policy. Repeated loads, retries and later upgrades must not recreate a subsequently deleted policy. Ordinary configuration saves and selective restoration preserve the introduction metadata.

An existing policy with the same identity always takes precedence: retain its complete saved contents and record the introduction as handled. Never repurpose a retired supplied identity for a different policy. Retiring a template removes it from fresh setup and the current restoration catalog; surviving saved policies keep their identities and behavior.

### Preserve monitoring and notification choices

Do not change existing policy names, selectors, detection settings, enabled states, ordering or notification assignments. Append the new disabled policies. Preserve shared notifications, delivery methods, destinations, global sending, controls, history and pending delivery identities. A fresh-install enabled default must never re-enable an existing disabled policy.

Adding a disabled policy creates no active check and authorizes no notification request. Its initial notification assignments may reference existing supplied notifications. If a referenced notification has been deleted, leave the assignment empty; do not recreate the notification or a destination. Enabling the policy remains an explicit policy-editor save using the existing workflow.

Construct and validate the complete upgraded candidate and restore supported runtime state before persisting settings and introduction metadata. A failed upgrade leaves the prior configuration and runtime state intact and sends nothing. A repeat load after success performs no further addition. Follow the established upgrade and release safeguards for configuration changes.

## Consequences

Existing installations can discover new monitoring in Policies without gaining active monitoring or notification requests during upgrade. Owners can enable useful additions or delete unwanted ones. The upgrade path needs durable introduction tracking and a legacy baseline; repeatedly merging the latest templates is insufficient.

Fresh-install defaults and upgrade additions have different enabled states. Each feature decision must document its fresh defaults, required setup and stable introduction identity. This rule does not retroactively restore historical defaults.

## Required verification

Before implementation ships, executable scenarios must cover fresh setup; upgrades from both supported configuration storage locations; skipped releases; renamed, edited, disabled and deleted historical policies; a new policy enabled, edited or deleted after its first addition; identity collisions; unchanged ordering of existing policies; deleted named notifications; sending on and off; pending replay identities; and at least two reloads. Failed validation, settings writes and runtime restoration must leave both configuration and introduction tracking unchanged and request no notification. Packaged upgrade checks must use published earlier settings as well as current-format fixtures.

Implementation and validation status belong in [Current work](../roadmap.md#current-work).
