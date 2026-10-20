# ADR 0099: Supply general and important equipment availability policies

**Status:** Accepted
**Date:** 2026-10-18

**Partially superseded:** [ADR 0108](0108-category-availability-policies-and-policy-waits.md) replaces the supplied Important equipment offering with category availability policies and adds per-policy qualification waits. Existing saved policies remain unchanged. Independent scopes, evidence interpretation and affected-equipment assignments on shared issues remain binding; [ADR 0107](0107-add-new-supplied-policies-disabled-on-upgrade.md) governs adding the new categories disabled on existing installations.

**Supersedes in part:** [ADR 0058](0058-unified-policy-lifecycle.md) and [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md) for fresh-install entity-availability selections and notification assignments. Their ordinary editable policy lifecycle, independent overlap, preservation and notification activation rules remain in force. [ADR 0064](0064-monitoring-coverage-and-device-evidence.md) continues to govern entity eligibility and independent issue controls; reusable message collection follows ADR 0102.

**Related decision:** [ADR 0102](0102-collect-requests-by-saved-notification.md) owns collection delay and message grouping by saved notification, recipient and destination, without requiring a shared issue. [ADR 0090](0090-independent-issues-under-healthy-integrations.md) continues to govern causal issue grouping; a shared integration issue retains applicable availability notification assignments from affected equipment.

## Context

Broad availability monitoring helps an owner discover equipment that Home Assistant can no longer reach. The useful response time varies: an unavailable media player can usually wait until morning, while losing access to a lock, camera or alarm panel may deserve attention overnight.

A separate availability implementation and supplied policy for every equipment category would multiply policies without changing the evidence being assessed. Two supplied policies can provide broad starting coverage with different notification timing. Owners can then configure selections and reporting for their household.

This decision concerns availability only. Smoke detection, a lock reporting a jam, low batteries, UPS conditions and other reported conditions retain their separate policy decisions. Selecting a detector for availability does not configure detection of the condition it measures.

## Decision

### Two starting policies, one availability check

Fresh installations enable these two ordinary policies in place of the single supplied entity-availability policy:

| Policy | Initial selection | Named notification |
| --- | --- | --- |
| General entity availability | Eligible operational entities outside the Important equipment starting selection | Morning |
| Important equipment availability | Eligible entities matching the equipment types below | Immediate |

Both use the existing availability monitoring type and its qualification, startup, unknown-evidence and recovery rules. Important equipment changes the notification assignment; it introduces no new issue severity, priority field, reliability guarantee or availability detector. Immediate allows overnight requests once an issue is eligible. Urgent has daytime hours and would not meet this starting choice.

Keep the supplied integration and device availability policies and their current defaults. The two policies in this decision divide entity availability only.

Fresh setup continues to leave global sending off and notification delivery methods unassigned. The owner configures destinations and enables sending through the existing Notifications workflow. If a referenced named notification has been deleted, explicitly restoring a supplied policy leaves that assignment empty rather than recreating the notification.

### Initial entity selection

Define the Important equipment starting selection as the union of:

| Home Assistant metadata | Included entities |
| --- | --- |
| Domain `camera` | Cameras |
| Domain `lock` | Locks |
| Domain `alarm_control_panel` | Alarm panels |
| Domain `binary_sensor`, with device class `smoke`, `carbon_monoxide`, `gas` or `moisture` | Smoke, carbon monoxide, gas and leak detectors |

Home Assistant documents the [camera building block](https://www.home-assistant.io/integrations/camera/), [lock building block](https://www.home-assistant.io/integrations/lock/), [alarm control panel building block](https://www.home-assistant.io/integrations/alarm_control_panel/) and [binary sensor device classes](https://www.home-assistant.io/integrations/binary_sensor/#device-class). The metadata identifies the reported capability; inclusion in Important equipment is Homeostatic's editable starting choice.

Apply the existing broad availability eligibility rules first: enabled operational entities, including those without a device; exclude disabled, diagnostic and configuration entities. The two initial selections are disjoint and together cover that complete eligible set. Diagnostic and configuration entities remain available for explicit entity selection under the existing rules.

General's initial selection is the complement of the Important equipment starting expression within that eligible set. Save each policy's selection as its own editable configuration. General must not compute its scope by looking at the other policy's current selections, enabled state or existence. General availability remains capable of monitoring any eligible entity.

Use domain and device-class metadata rather than names or a one-time list of discovered entity IDs. Selection must express the union and its complement through ordinary editable policy configuration; no special behavior may depend on a supplied policy's identity. Newly discovered entities and metadata changes follow the saved selection rules. The implementation must extend selection representation and the existing editor if needed; materializing the current inventory would leave future cameras in the wrong group.

Door, window, motion, occupancy and temperature entities remain in General initially unless they also match the expression above. Their importance depends on household use. Owners can select particular entities, areas or labels for more prompt reporting. Do not infer a security role or freezer-monitoring purpose from an entity's name.

### Editing and overlap

The Policies page and existing policy editor own selection, enablement and notification assignment. Notifications owns reusable timing and destinations. Monitoring shows which saved policies cover an entity. Reuse these workflows; no new priority page, classification wizard or per-category policy controls are introduced.

Policy names and selection summaries must explain the actual scope, including General's initial exclusions. Owners can change either selection, create additional availability policies or deliberately watch the same entity through several policies. Each policy retains independent detection, notification assignments and controls under ADR 0058. ADR 0102 collects eligible requests selecting the same saved notification and delivery target; it does not require their issues to share a cause.

Default duplication is avoided by the initial selections. There is no runtime winner, notification suppression between these policies, mandatory ownership transfer or automatic editing of another policy. Changing only Important equipment does not move an entity out of General. An owner who wants an entity covered exactly once edits the relevant selections through the ordinary policy workflow. Selection changes follow the existing monitoring-ended lifecycle and do not claim physical recovery.

Disabling, deleting or narrowing one policy leaves the other policy unchanged. It can therefore leave entities without an entity-availability check, although independent device or integration monitoring may remain. Coverage must describe the remaining checks accurately. Restoring one supplied policy restores only that policy; it does not repair, reset or rewrite its counterpart. Deliberate later overlap or gaps are saved configuration choices.

### Evidence and dependency boundaries

Follow [Home Assistant states](../home-assistant-states.md) and [ADR 0005](0005-ha-availability-is-control-path-evidence.md). An entity reporting `unavailable` supplies availability failure evidence. A current `unknown` value passes availability; missing states and restored placeholders retain the existing missing-evidence handling. Ordinary camera activity states, including `idle`, do not establish a video failure. Returning availability establishes what Home Assistant reports, without proving fresh video, recording, physical operation or successful commands.

Keep existing confirmed dependency suppression and integration recovery behavior under ADR 0090. An unavailable entity under a healthy integration retains its own finding and reporting assignment. A confirmed failed integration can absorb dependent availability findings into one shared issue. That consolidation must preserve the applicable notification assignments described below.

### Configured attention survives a confirmed integration failure

Apply this rule to configured availability policies generally. Important equipment is the supplied starting selection for Immediate reporting; the name or supplied identity grants no special runtime behavior.

Evaluate the shared integration issue against the availability assignments for the integration and its confirmed affected monitored equipment. Each applicable assignment retains its configured timing, recipients, delivery methods, presence choices, reminders and controls. A Morning assignment on the integration must not mask an Immediate assignment for an affected camera or lock. A dashboard-only choice on one source must not silence an independently configured assignment on another affected source. Global sending, startup holds, acknowledgments and notification pauses retain their existing semantics.

Use the engine's public dependency and current affected-scope evidence, restricted to the availability checks selected by each policy. Merely sharing a healthy integration or appearing in inventory is insufficient. Home Assistant's integration and entity reports can arrive in either order; reconcile both paths without treating the arrival order as different notification intent. A qualifying Important equipment assignment requests its Immediate notification for the shared issue once eligible, including overnight, using its own configured destinations.

The issue identifies the confirmed integration failure and its affected equipment. An Immediate message can explain that the Basement leak detector is unavailable because of the known Zigbee failure. The integration can also appear in its configured Morning summary. These are valid separate notification requests; causal grouping must not substitute one schedule for the other.

Repeated members must not multiply the same issue/assignment opening. Absorption before delivery retains one authorized pending opening; absorption after delivery updates its scope silently without replaying the opening. New evidence that first makes a different assignment eligible may request its configured attention. For example, an integration issue initially affecting only general equipment must request the Important equipment notification if a lock later becomes affected. Additional affected members of an already-authorized assignment update its contents without repeating its opening.

ADR 0102 separately collects eligible requests by saved notification identity, recipient and resolved destination during a fixed collection window. The requests may concern one shared integration issue or several unrelated issues. Different saved notifications remain independent even when they have identical names or settings. This preserves intentional overlap and avoids a priority winner or a shared-issue requirement for message collection. Preserve existing controls, recurrence and recovery rules; neither absorption nor splitting establishes physical recovery of the equipment.

The library already exposes affected-node matching through `Match.nodes` and independent attention routes. Homeostatic currently generates first-match source scopes with silent rules for assignments absent from an earlier scope; a matching integration scope can therefore prevent an affected equipment assignment from being evaluated. Implementation must correct that rule compilation and consolidate authorized requests without inventing adapter-owned attention timers. It must also verify notification history across absorption; existing matching APIs alone do not establish that replay handling is complete.

Homeostatic owns supplied selections, editing, availability scope mapping and notification presentation. health-tree continues to own dependency, lifecycle, readiness, attention and generic delivery reduction through public APIs. Start with its existing affected-node matching and independent routes. Identify any required public matching, grouping or absorption-history change in both repositories, and update the library's governing decision, specification and scenarios before changing its behavior. No code may branch on the supplied Important equipment policy's name or identity to implement this rule.

## Alternatives

- Keep one all-entity policy. Simple, but its single starting notification assignment cannot distinguish routine equipment from equipment whose unavailability merits overnight attention.
- Supply a separate availability policy for every equipment category. Useful when owners need those distinctions, but unnecessary as the starting configuration. Owners can create them themselves.
- Give specialized policies automatic precedence or fallback. This couples independent policies and makes enablement or deletion silently change another policy's effective coverage.
- Let only the integration's assignment apply after grouping. This can delay an affected lock or camera's configured Immediate notification until morning.

## Implementation acceptance

The [roadmap](../roadmap.md#current-work) owns implementation status. Before shipping, update the owning specification sections, user guide, events reference where affected and changelog, with executable scenarios covering:

- Fresh-install coverage for every listed domain and binary-sensor class, ordinary entities, metadata-free entities, disabled entities, diagnostic/configuration entities and entities without a device. Prove that every eligible entity matches exactly one of the two initial policies, including entities discovered after installation and entities whose metadata changes.
- Identical availability interpretation and qualification/recovery behavior in both policies, including current `unknown`, missing/restored evidence, repeated unavailability, recovery, recurrence and restart. Important equipment must not change severity.
- Morning versus Immediate eligibility, including an overnight standalone failure: Important equipment can request attention and General waits for its summary. The same camera or detector must not also enter General's summary under the untouched defaults.
- A confirmed integration failure at night with an affected Important equipment entity: one shared issue and an eligible Immediate opening for each applicable assignment, regardless of the integration's Morning assignment. Repeated members cannot multiply the same issue/assignment opening; ADR 0102 owns collection of those eligible requests. An outage affecting only general equipment retains its configured scheduled reporting.
- Integration-first and entity-first observations, simultaneous captured batches, and absorption before versus after an opening request. Preserve pending or previously requested attention without replaying an opening solely because the issue anchor changes. Include restart and stable outbox replay after absorption.
- An existing general-equipment integration issue gaining its first affected important entity requests newly eligible attention. Later members of an already-authorized assignment update the same notification silently. Healthy siblings and unrelated inventory cannot trigger an assignment; disabled or unselected checks contribute nothing.
- Requests selecting the same saved notification and target collect under ADR 0102 across both shared and unrelated issues. Different saved notification identities, timing or destinations remain independent, including an Immediate request and a later Morning summary. No globally fastest-policy rule or blanket user-overlap suppression is introduced.
- Independent device findings, notification controls, message collection, partial recovery and integration recovery with equipment still unavailable. Keep one issue for the confirmed shared failure, preserve exact controls and attention through any required successors, and never report recovered equipment without qualifying evidence.
- Editing both compound selections through the existing editor, preserving unmatched and future scope, accurate selection summaries and per-entity coverage, independent drafts, save/reopen, cancellation and failure. Exercise keyboard and narrow-screen paths during rendered review.
- Intentional overlap, selection changes with an open issue, disable/delete and individual restoration. No automatic fallback, policy rewrite, duplicate replay or invented recovery; deliberate overlaps retain independent policy behavior.
- Explicit add/restore with a deleted named-notification default, preserving the other policy and global sending. No migration or compatibility work for existing installations is required.
- Isolated mocked direct-delivery and optional consumer-event paths, global sending off, unassigned destinations, queued observations during I/O and stable delivery IDs during outbox replay. Request events do not prove delivery.

This ADR records the accepted design. The local implementation and its verification are recorded in Current work; publication and installation remain separate steps.
