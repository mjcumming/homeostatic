# ADR 0047: Give Policies its own dashboard page

**Status:** Accepted
**Date:** 2026-10-04

**Supersedes:** the Settings placement of the installation-wide catalog in ADR 0028 and ADR 0030. Their split between group policies and individual source choices remains.

**Presentation superseded by:** [ADR 0048](0048-policy-checks.md). The page and the Sources split remain.

## Context

Choosing what Homeostatic watches is a different job from setting waits and grouping. The catalog editor lived as the third item under Settings, then listed rules in catalog language. A household that already watched integrations, devices, and batteries still had no visible way to turn on vacuum errors. The same hiding is what moved Notifications out of Settings.

## Decision

Use seven main dashboard destinations: Overview, Issues, Sources, Policies, Notifications, Settings, and History. Policies owns the existing catalog editor, its review, and its guarded save. Settings owns Timing and Problem grouping.

Policies leads with four broad checks: integration connections, device availability, batteries, and vacuum errors. A missing broad check offers one action that drafts that scope. A saved broad rule is edited in that check and is left out of the other group list. Other group policies, individual source choices, and Advanced rule details stay on the page. Sources still owns one source. Notifications still owns who gets told.

Moving the page does not change catalog matching, exclusions, preview, or save. An existing generated Home Assistant dashboard keeps its previous views until it is created again. The sidebar panel shows the new page.

## Consequences

The choice that watches current and future sources is on the main navigation. A vacuum, battery, device, or integration check that is off is visible without opening Settings. Settings has the waits and the grouping controls. One source is still changed in Sources.
