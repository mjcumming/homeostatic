# ADR 0089: Keep entity policy access contextual

**Status:** Accepted
**Date:** 2026-10-16

**Partially supersedes:** Entity identity and contributing-policy presentation in ADRs 0073 and 0086. Other source inspectors, policy ownership, monitoring decisions and saved settings remain unchanged. ADR 0087 continues to govern maintenance controls.

## Context

The entity inspector repeated its integration destination, gave policy editing similar prominence to the entity-specific monitoring action and explained Home Assistant's registration machinery without helping the next decision. Removing policy access entirely would hide why the entity is monitored, especially when a device policy uses it as evidence. The owner approved one quiet Monitoring policies action that preserves this context.

## Decision

Lead with a small Entity label and the full entity name. Show known Device and Integration names as labeled links to their actual Home Assistant pages. Resolve these relationships from registry ownership independently of the selected tree grouping. Omit absent metadata and separate destination links that repeat the named links. Preserve meaningful location context without invented placeholders.

For a restored entity placeholder, say Not currently provided by followed by its integration name, with a plain fallback when the integration is unknown. Omit the registration explanation. For a current unavailable state, say Home Assistant reports this entity as unavailable. Keep restored, missing, unknown, disabled and unavailable evidence distinct, including pending recovery; these wording changes do not reinterpret Home Assistant evidence.

Use concise coverage text such as Monitored for availability. Preserve explanations of device-only coverage, other condition checks and absent monitoring. Keep the entity-specific availability action visible.

Replace the entity inspector's individual policy edit links with one quiet Monitoring policies action. It opens a contextual dialog listing the contributing policies, each policy's role and its Edit policy action. A policy role distinguishes an individual entity check from evidence used to assess a named device. Editing uses the existing authoritative policy editor and contextual return route. Closing the dialog returns focus to its trigger and leaves the selected entity in view. Opening or dismissing it changes no settings.

The entity inspector still has no Details section. Current findings, related issues and active maintenance remain accessible, and maintenance creation stays absent. Other source types retain their existing policy presentation.

## Acceptance

Exercise restored and unavailable entities, missing ownership, full and long names, device-only and mixed monitoring, exclusions and no contributing policies. Verify linked ownership in integration, location and optional Topomation grouping. Open and dismiss Monitoring policies with pointer and keyboard, edit a contributing policy and return to the selected entity, preserving unrelated drafts and saved settings. Inspect desktop and narrow layouts and verify that existing condition findings, related-issue navigation and maintenance cancellation remain available.
