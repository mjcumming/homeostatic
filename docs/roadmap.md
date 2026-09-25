# Build roadmap

Updated 2026-09-25. This file tracks delivery; [spec.md](spec.md) controls implemented behavior. The owner decisions in health-tree's UI worksheet section 16 remain the target. The library owns health and attention semantics.

| Increment | Status | Acceptance |
| --- | --- | --- |
| Reliable HA adapter | Complete | Ordered observations, retry continuity, policy-controlled content, consistent unload; regression scenarios |
| First function and situation | Complete | Stable bindings, function readiness entity, edgeless situation, unknown preserves episode, named delivery content |
| Consumer delivery foundation | Complete | Notifications off initially; activation summary; versioned events and durable outbox; consumer blueprint and tests |
| Rule catalog and enrollment | Complete for availability | All stable match fields: domain, device class, integration, device, entity, area, floor, label; additive attach, exclude wins; passive enrollment of future sources; match preview and provenance |
| Function configuration | Complete for declared capabilities and static suggestions | Entity/integration/function/external requirements; cycle validation; per-function accept/reject decisions; watched/excluded/missing previews; external evidence producers remain a release gate |
| Owner YAML policy | Next | Validated rules/recipients; quiet hours, reminders, escalation and digests; explain decisions; activation clocks start at enablement |
| Operator controls | Planned | Shelving, expiring scoped maintenance; no global equipment quiet window; situation edge lint |
| Product presentation | Planned | Review story notification texts first; then problems/functions/maintenance/coverage, remedies, native Repair links, recently resolved history |
| Evidence producers | Release gate | Real healthy/failure/recovery traces for detector progress, device-originated freshness and command completion, replayed as fixtures |
| Watchdog | Release gate | External observer and alert route verified independently of HA |
| Distribution | Release gate | Released/pinned health-tree, actual HA deployment check, metadata validation and reviewed release; no fabricated package pin |

The structured YAML rule/function/situation forms are development interfaces. Legacy entity selections migrate to catalog rules; there is one attach/exclude model. The current catalog contains availability checks only. Check-specific parameters and additional evidence producers will arrive with their own contracts and traces. A richer interactive rule editor and configuration-health suggestions for excessive one-entity rules remain presentation work. Do not add a competing per-entity override system or a native condition builder. No phone receipt, physical-device freshness, or production readiness is inferred from passing synthetic tests.
