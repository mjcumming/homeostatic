# Build roadmap

Updated 2026-09-29. This file tracks delivery; [spec.md](spec.md) controls implemented behavior. The owner decisions in [ui.md](ui.md) sections 16 and 17 remain the target. The library owns health and attention semantics.

| Increment | Status | Acceptance |
| --- | --- | --- |
| Reliable HA adapter | Complete | Ordered observations, retry continuity, policy-controlled content, consistent unload; regression scenarios |
| First function and situation | Complete | Stable bindings, function readiness entity, edgeless situation, unknown preserves episode, named delivery content |
| Consumer delivery foundation | Complete | Notifications off initially; activation summary; versioned events and durable outbox; consumer blueprint and tests |
| Detected facts for automations | Implemented; notification context parenting follows ADR 0015 | Episode and control fact events independent of notifications; function event entities; enum readiness; example blueprints ([ADR 0014](adr/0014-publish-detected-facts-for-owner-automations.md)) |
| HA-aligned device availability | Entity fallback and device display implemented locally; native report ingestion pending upstream ([ADR 0035](adr/0035-align-device-availability-with-ha-proposal.md)) | Follow discussion 1400 vocabulary, explicit-report precedence and entity fallback; preserve provenance and independent entity monitoring. Confirm usable upstream API and unspecified evidence combinations; add lifecycle and fallback scenarios. |
| Rule catalog and enrollment | Complete for availability | All stable match fields: domain, device class, integration, device, entity, area, floor, label; additive attach, exclude wins; passive enrollment of future sources; match preview and provenance |
| Function configuration | Complete for declared capabilities and static suggestions | Entity/integration/function/external requirements; cycle validation; per-function accept/reject decisions; watched/excluded/missing previews; external evidence producers remain a release gate |
| Owner YAML policy | Complete for static recipients | Validated rules and routes; recipient quiet hours and reminders; escalation and grouped digests; read-only explanations/activation preview; activation resets escalation without rewriting episode history |
| People and built-in delivery | In progress locally ([ADR 0015](adr/0015-deliver-notifications-to-people.md)) | Person and phone selection, simple levels, quiet hours, built-in phone and notify-entity requests, route test, and preview-before-save are implemented in the working tree. Isolated policy, save, route and restart-deduplication tests pass; synthetic desktop and phone layout reviewed. Live pilot review remains. Household announcements and phone Got it/Snooze buttons remain open; [proposal](proposals/notification-settings.md) |
| Fixed reporting preferences | Implemented ([ADR 0027](adr/0027-reporting-defaults-and-delivery.md)) | Six choices, per-profile recipients, weekly default, open-problem summaries, Sources assignments, guarded migration, and Overview reporting forecasts. |
| Operator controls | Implemented, including acknowledgment and early cancellation | Administrator actions and dashboard forms; scope preview; seven-day maximum and explicit expiry; durable control records; existing alerts and situations stay active during equipment maintenance; shared acknowledgment and early cancellation have library, administrator-service, dashboard and restart scenarios; HealthTree 0.4.0 supplies the shared state; phone acknowledgment wiring remains |
| Resolution history backend | Complete for terminal episodes | Last 100 observed resolutions within 30 days; durable findings/identity, distinct removal/absorption, read-only inventory/action contract; dashboard overview, searchable history pages and retained detail implemented; full journal remains planned |
| Product presentation | Live dashboard, resolved history and bounded controls implemented; remaining presentation planned | Review story notification texts first; then auto-populated dashboard and reusable cards: needs attention, home functions, house browsing, visible coverage, recent changes; problem detail, maintenance, remedies, native Repair links, recently resolved history; walkthroughs in UI section 17; first prototype and draft story messages described in section 18; sidebar, cards, strategy, live read transport, a bounded diagnostic runtime activity log and native HA floor-to-area browsing implemented, with separate floorless-area and unassigned-source groups; [isolated HA walkthrough](testing/dashboard-walkthrough.md) passed, including a corrected embedded return path; resolved-history browsing and shelving/maintenance forms implemented; specific remedies/Repairs, notification links and remaining wording remain |
| Unified Sources workspace | Implemented locally for review ([ADR 0017](adr/0017-one-sources-workspace.md)) | Validate the one-tree navigation and contextual editor against the owner's live HA pilot after the controlled release path; refine labels and spacing from that review. [Sources acceptance checks](spec.md#sources-workspace-target) remain the test contract. |
| Optional TopoMation connection | Planned enrichment; not a release gate | HA areas/floors work independently; optional richer location navigation, then occupancy/automation context; later per-function suggestions require review; location membership never creates causal edges; monitoring survives loss of TopoMation |
| Evidence producers | Gate for physical-freshness and command-completion claims | Real healthy/failure/recovery traces for detector progress, device-originated freshness and command completion, replayed as fixtures |
| Watchdog | Gate for HA-outage coverage | External observer and alert route verified independently of HA |
| Large-installation responsiveness | Ordered processing slices implemented; broad enrollment and target hardware remain unqualified | [Runtime assessment](testing/runtime-scaling.md#2026-09-26-ordered-processing-slices): ten actual-storage synthetic device-summary cycles settled each outage in 0.358–0.502 s with one save and no scan. Nine cycles stayed below 49 ms loop gaps; one reached 186 ms, still above the proposed 100 ms target. Initial transfer was 3.91 MB. All 6,000 individual entity checks still took 3.77 s with a 0.79 s maximum gap. Sustained household load, hardware measurements and catalog paging remain. |
| Distribution | GitHub 1.0.0 release for selected monitoring | Published health-tree 0.5.0 pin, reproducible ZIP, isolated package-install smoke and metadata checks; native live setup and dashboard verified with 129 integration instances. Extended observation and large-installation qualification remain. |

The structured YAML rule/function/situation forms are development interfaces. Legacy entity selections migrate to catalog rules; there is one attach/exclude model. The current catalog contains availability checks only. Check-specific parameters and additional evidence producers will arrive with their own contracts and traces. The dashboard now includes guided monitoring rule editing with preview and guarded save. Configuration-health suggestions for excessive one-entity rules remain presentation work. Do not add a competing per-entity override system or a native condition builder. No phone receipt, physical-device freshness, or production readiness is inferred from passing synthetic tests.

The automation-first situation handoff is implemented locally: native report action,
expiring evidence, condition-editor blueprint, restart and delivery scenarios.
Guided Homeostatic situation menus and one-shot event reporting remain future work.

[ADR 0034](adr/0034-create-alerts-from-ha-automations.md) is implemented: configure
an alert once in the HA automation editor, with automatic registration and a shared
Companion acknowledgment handler. Native device validation remains a separate
owner-authorized pilot; ADR 0032's explicit declarations remain supported.

## Maintenance and health product direction

[Scope and acceptance](proposals/maintenance-and-health.md) define the increments
below, building on the existing health-tree architecture. This table owns their
delivery status; Planned
means intended work, and Consider means an option without a delivery commitment.
No item here is a claim of implementation or authorization to release or deploy.

| Item | Status | Next milestone |
| --- | --- | --- |
| MH-1: Contextual battery maintenance | Implemented in the development tree; real-device traces pending | Review battery candidates, validate percentage/binary and charging behavior against real devices, then verify served UI and reporting before release. |
| MH-2: Practical action details and native repair handoff | Planned extension of existing problem details | Add supported action destinations and optional verified supplies metadata; preserve provenance and observation-based recovery. |
| MH-3: Consistent summaries and drill-down | Planned verification/refinement of existing views | Audit shared result scopes and distinguish episodes, affected devices and evidence gaps; cover live resolution and removal. |
| MH-4: Household visibility | Planned; access architecture first | Propose the scoped read/permission contract and test direct access before changing the administrator-only dashboard. |
| MH-5: Stable views during live updates | Planned verification/refinement of existing handling | Separate layout/evidence updates; preserve selection, focus and drafts while retaining revision-bound previews. |
| MH-6: Consumables and scheduled maintenance | Consider | Select one evidence-backed producer after the battery increment. |
| MH-7: Supplies and task grouping | Consider | Establish trustworthy quantities and preserve each task's underlying episode. |
| MH-8: Native maintenance surface integration | Consider | Verify a supported extension contract and compare user benefit and maintenance cost. |
| MH-9: Structured third-party and host evidence | Consider | Select sources with stable identity and explicit opening/clearing evidence. |
| MH-10: Optional supplies metadata integration | Consider | Evaluate supported providers, provenance and behavior when metadata is absent. |

Start with MH-1 and the action details it requires; verify MH-3 and MH-5 alongside
that increment. Design MH-4 independently before exposing data. Existing evidence
producer and external-watchdog gates remain in force for claims of physical freshness,
command completion, or Home Assistant outage coverage.
