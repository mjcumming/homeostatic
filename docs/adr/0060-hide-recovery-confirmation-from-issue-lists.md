# ADR 0060: Keep recovery confirmation out of issue lists

**Status:** Accepted; implemented locally, not deployed by this change
**Date:** 2026-10-13

**Complements:** [ADR 0041](0041-group-watched-devices-under-failed-integrations.md), which preserves individual findings under an integration, and [ADR 0025](0025-follow-home-assistant-availability-semantics.md), which distinguishes availability evidence from values and monitoring scope. Their grouping and evidence rules remain in force.

## Context

Overview displayed Sun and Matter as Checking recovery for hours. Both connections were loaded. Sun's grouped issue contained stale checks for three disabled optional entities. Matter's issue also contained unavailable equipment. The presentation interpreted a loaded integration with any open issue as recovery, although related-source findings could keep that issue open indefinitely.

The owner requested that recovery-confirmation entries be omitted from the issue lists and that details use clearer wording. This is a presentation decision with an eligibility correction; it does not change the library's recovery holds.

## Decision

Overview and Issues omit availability issues while current evidence indicates availability and the brief is confirming recovery. Their displayed counts use the same filtered set, and the recent list selects its three entries after filtering. The underlying issue remains open and can still be inspected through Sources until the library resolves it.

Details use Running — confirming recovery for an integration and Available — confirming recovery for an entity or device. Explain that Home Assistant currently reports availability and Homeostatic is waiting for it to persist. Do not say running again or imply a previous outage solely because an issue remains open.

A loaded integration with outstanding findings on related sources remains visible. Its brief identifies the number of related sources needing attention; details list their findings and provide routes to Sources. Use the complete public issue findings, including recorded members, rather than only the anchor's explanation. A healthy grouping anchor does not establish recovery of its members or prove that it failed previously.

Missing current evidence never establishes recovery. Unknown and unavailable evidence, and a non-passing watched dependency, retain their existing distinctions. Do not hide those conditions merely because the anchor is loaded or historical failure text is absent.

Disabled entity sources remain in the browsing catalog but receive no availability checks from catalog rules or named policies. Saved monitoring choices retain their meaning when an entity becomes eligible again. Do not synthesize passing evidence for a disabled entity or describe the end of its monitoring as physical recovery.

Filtering changes presentation only. Health-tree continues to decide issue grouping, resolution, readiness and notification eligibility. Hiding a recovery-confirmation entry neither acknowledges nor resolves it and does not alter saved notification settings.

## Alternatives

- Keep Checking recovery on every open issue whose anchor is available. This confuses confirmation holds with persistent problems on related sources and occupies the main issue list with entries that need no action.
- Hide every issue under a loaded integration. This would conceal genuinely unavailable devices, entities and missing evidence.
- Resolve issues as soon as the interface observes availability. This would bypass the library's confirmation hold and member recovery rules.

## Consequences

The main lists focus on conditions still needing review. Their counts can be lower than the number of open issues retained by the monitoring engine. Sources remains the route to pending recovery details. A healthy integration can still head an issue for related-source problems, with those problems named explicitly.

The executable recovery-presentation and disabled-availability fixtures cover filtering, filling recent-list slots, preserving related-source findings, disabled-entity eligibility and re-enabling. The integration and entity browser regressions cover the same presentation in cards and details.
