# Build roadmap

Updated 2026-09-25. This file tracks delivery; [spec.md](spec.md) controls implemented behavior. The owner decisions in health-tree's UI worksheet section 16 remain the target. The library owns health and attention semantics.

| Increment | Status | Acceptance |
| --- | --- | --- |
| Reliable HA adapter | In this increment | Ordered observations, retry continuity, policy-controlled content, consistent unload; regression scenarios |
| First function and situation | In this increment | Stable bindings, function readiness entity, edgeless situation, unknown preserves episode, named delivery content |
| Consumer delivery foundation | In this increment | Notifications off initially; activation summary; versioned events and durable outbox; consumer blueprint and tests |
| Rule catalog and enrollment | Next | All stable match fields: domain, device class, integration, device, entity, area, floor, label; additive attach, exclude wins; passive enrollment of future sources; match preview and provenance |
| Full function configuration | Planned | Declared external capabilities, importance, per-function candidate edges, excluded requirements stay unknown |
| Owner YAML policy | Planned | Validated rules/recipients; quiet hours, reminders, escalation and digests; explain decisions; activation clocks start at enablement |
| Operator controls | Planned | Shelving, expiring scoped maintenance; no global equipment quiet window; situation edge lint |
| Product presentation | Planned | Review story notification texts first; then problems/functions/maintenance/coverage, remedies, native Repair links, recently resolved history |
| Evidence producers | Release gate | Real healthy/failure/recovery traces for detector progress, device-originated freshness and command completion, replayed as fixtures |
| Watchdog | Release gate | External observer and alert route verified independently of HA |
| Distribution | Release gate | Released/pinned health-tree, actual HA deployment check, metadata validation and reviewed release; no fabricated package pin |

The current manual entity enrollment and structured YAML forms are development interfaces. Do not grow them into a competing per-entity override system or a native condition builder. No phone receipt, physical-device freshness, or production readiness is inferred from passing synthetic tests.
