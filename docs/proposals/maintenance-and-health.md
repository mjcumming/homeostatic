# Maintenance and health roadmap

**Reviewed:** 2026-09-29

**Delivery:** Planned increments and future options are tracked in the [build roadmap](../roadmap.md#maintenance-and-health-product-direction).

This roadmap extends Homeostatic using the existing health-tree architecture:
dependency-aware episodes, evidence boundaries, readiness and attention policy.
External projects provide useful design references; they do not determine our
roadmap or require a separate architecture decision.

This document owns scope, sequencing and acceptance. The build roadmap owns
delivery status; the specification owns runtime behavior. Planned work is a
product intention, not a shipped feature or permission to deploy. Consider items
have no implementation commitment.

## Starting point

The catalog now has a bounded HA battery producer alongside availability. The
library's rinse-aid story establishes engine behavior, not a working HA
consumable producer. Battery behavior is specified in
[the product specification](../spec.md#battery-maintenance-producer);
real-device traces and served UI verification remain release gates.
Native floors/areas, catalog matching, reviewed enrollment, episode controls,
reporting and source-specific views provide foundations to reuse.

The installation dashboard requires administrator access. Household visibility
needs a scoped read contract. HA-aligned device availability follows
[ADR 0035](../adr/0035-align-device-availability-with-ha-proposal.md), separately
from selected-entity findings and physical-equipment health.

Upstream has delivered a maintenance dashboard. Broader repair, household-access
and supplies ideas include discussion proposals. Development-branch source is
not evidence that a feature exists in the owner's installed HA release.

## Planned increments

### MH-1: Battery maintenance with contextual evidence

**Outcome:** Identify devices needing battery attention, explain why, and clear
the finding only on evidence defined by the producer contract.

- Discover percentage and explicit low-battery entities through HA metadata.
  Reuse catalog matching, exclusions, reviewed selection and provenance.
- Define how several battery entities on one device relate. Do not count a
  percentage and binary warning as two replacement tasks by default, or merge
  genuinely separate batteries solely because they share a device.
- Evaluate charging context where supplied. Distinguish replaceable batteries,
  rechargeable devices and storage batteries when supported metadata permits.
  Do not infer chemistry or normal discharge behavior from names.
- The owner set the first percentage low threshold at **20%** on 2026-09-29:
  a current reading at or below 20% is low. A current, confirmed charging report
  for the same battery **clears the low condition**, including an explicit
  low-battery warning. If charging stops while low evidence remains, the
  condition may open again. The recorded clearance means that the monitored
  low-and-not-charging condition ended; it does not establish replacement or a
  healthy charge. Missing, unavailable, or restored charging evidence does not
  clear the condition. The 20% threshold is a Homeostatic choice, not a
  universal battery standard.
- Specify threshold overrides, holds, explicit-warning precedence, conflicting
  reports, source pairing, missing/restored values, and the exact recovery
  observation trace before coding.
- Apply the existing capability model: a leading battery warning may belong to
  the capability; independent maintenance debt gets an edgeless maintenance node.
  Define this mapping per check, not per screen.

**Acceptance:** Healthy, low, charging while low, charging stopping while low,
conflicting, unavailable, restored and recovered traces; deduplication, restart
continuity and independent availability findings. Exercise existing reporting
preferences without another attention policy. Validate real device observations
for every claimed evidence shape.

**Next step:** Validate real-device traces and the served UI, then decide whether
the evidence supports a release. No health-tree API change is currently
justified.

### MH-2: Findings that explain the work to do

**Outcome:** Recognizable subject, supported condition, consequence and a specific
next action. With verified metadata: "Hallway sensor battery low - replace
1 x CR2032."

- Reuse native device, integration, reauthentication and Repair destinations.
  Offer the relevant destination rather than a generic Settings link.
- Carry optional replacement type, quantity, instructions and metadata
  provenance. Missing supplies data stays unknown.
- Preserve problem identity and reporting state. Opening a repair flow,
  acknowledging or recording a replacement is not proof of recovery.
- Link related native Repairs. Before importing one as a finding, define its
  identity and lifecycle mapping to avoid competing episodes or alerts.

**Acceptance:** Useful details with and without metadata; working destinations;
stale metadata and removed-target handling; no automatic device commands or
duplicate notification lifecycle.

### MH-3: Consistent summaries and drill-down

**Outcome:** Every count has an understandable unit and opens the findings or
sources it describes.

- Reuse backend query results and stable identities across Overview, Issues,
  Sources and cards. Do not reproduce episode logic in the browser.
- Name episode, affected-device and evidence-gap counts separately. Explain one
  root episode affecting several devices rather than adding overlapping counts.
- Preserve navigation filters. If evidence changes between tap and load, show
  current results and explain a resolved or removed selection.
- Keep coverage visible when there are no open problems. No selected checks or
  unknown evidence cannot establish whole-house health.

**Acceptance:** Matching summary/detail scopes through filtering, resolution,
absorption and removal; consistent empty states and accessible return navigation.

### MH-4: Household visibility with administrator controls

**Outcome:** Household members see selected practical tasks without receiving
installation-wide configuration or diagnostic access.

- Design a scoped read model and backend-enforced permissions first.
  Hiding administrator buttons is insufficient.
- Decide visible subjects, locations, details and destinations. Check that each
  offered HA destination is usable by the intended household member.
- Start with reading permitted findings and instructions. Acknowledgment, pause,
  assignment and completion each need an explicit authorization contract;
  do not automatically expose shared episode controls.
- Project the existing episodes into the permitted scope. Keep enrollment,
  configuration and diagnosis in the administrator workspace.

**Acceptance:** Administrator/non-administrator scenarios for direct API calls,
subscriptions, deep links, reconnect and revoked access. No unauthorized
installation data or controls reach the client.

**Next step:** Proposed household-access ADR and read-contract sketch. The current
administrator-only contract stays in force until that design is settled.

### MH-5: Stable views during live updates

**Outcome:** New evidence updates the view without disrupting the user's task.

- Extend existing handling, separating inventory/topology changes from state
  changes. Batch presentation work without dropping or reordering engine input.
- Preserve selection, expanded groups, scroll, keyboard focus and drafts.
  Refresh identity and location from registry changes.
- Retain revision-bound catalog loading and reviewed-save protection. A repaint
  must not overwrite a draft; changed configuration invalidates an old preview.
- Reuse HA naming and location data, including reachable unassigned sources.

**Acceptance:** Desktop/mobile scenarios for rapid updates, renaming, relocation,
removal, reconnect and concurrent editing. Measure representative household
behavior; synthetic performance alone does not establish deployment readiness.

## Ideas to consider later

| Item | Useful outcome | Decision or evidence needed |
| --- | --- | --- |
| MH-6: Consumables and scheduled maintenance | Rinse aid, filters and brush life use existing episodes and reporting. | A producer contract and real traces per condition; explicit clearing/deadlines. The rinse-aid fixture is a starting story, not device support. |
| MH-7: Supplies and task grouping | Aggregate replacement quantities by type or plan a maintenance trip by location. | Trustworthy type/quantity and identity; incomplete-data presentation; each task retains its episode id. Group completion cannot manufacture recovery. |
| MH-8: Native HA maintenance surfaces | Present Homeostatic findings through compatible native cards or dashboards. | A supported extension contract on the actual HA version, suitable permissions, and preserved cause/evidence/episode context. Compare user benefit and maintenance cost. |
| MH-9: Structured third-party and host evidence | Explain backup capacity, missing automation references, host or network problems. | Reuse existing producers; define identity, applicability, opening and clearing per source. No blanket log-event ingestion or unsupported physical diagnosis. |
| MH-10: Optional supplies metadata integration | Read battery notes or future device metadata without maintaining a duplicate database. | Supported API, provenance, refresh/removal semantics and useful behavior when the provider is absent. |

## Sequence and delivery boundaries

1. Specify and implement MH-1 with the minimum MH-2 action details it needs.
2. Verify MH-3 and MH-5 alongside that concrete maintenance experience. These
   are focused refinements, not prerequisites for rebuilding every screen.
3. Design MH-4 independently, then implement after its access contract is settled.
4. Select later ideas using observed household needs and available evidence.
   Avoid placeholder pages or a parallel settings/catalog system.

Each increment updates the owning specification before behavior, adds executable
scenarios and records delivery in the changelog. Existing real-observation and
external-watchdog release gates remain. Local implementation, isolated validation,
release and live installation are separate milestones.

## Sources and limits

Reviewed on 2026-09-29. These links are prior art and user evidence, not an
automatic dependency on future upstream behavior.

- [OHF roadmap issue 80](https://github.com/OpenHomeFoundation/roadmap/issues/80)
  and [frontend PR 30372](https://github.com/home-assistant/frontend/pull/30372):
  maintenance dashboard delivery and original discussion.
- [Maintenance strategy](https://raw.githubusercontent.com/home-assistant/frontend/dev/src/panels/maintenance/strategies/maintenance-view-strategy.ts):
  metadata selection, native grouping and charging-aware percentage checks.
- [Home summary](https://raw.githubusercontent.com/home-assistant/frontend/dev/src/panels/lovelace/cards/hui-home-summary-card.ts):
  distinct low-battery and unavailable-battery summaries.
- [Maintenance panel](https://raw.githubusercontent.com/home-assistant/frontend/dev/src/panels/maintenance/ha-panel-maintenance.ts):
  registry-triggered layout generation and unchanged-layout comparison.
- [Product discussion 3327](https://github.com/orgs/home-assistant/discussions/3327):
  household visibility and administrator actions.
- [Supplies request 3810](https://github.com/orgs/home-assistant/discussions/3810):
  battery type and quantity.
- [Repairs developer contract](https://developers.home-assistant.io/docs/core/platform/repairs/):
  native fixes, instructions and issue lifecycle.
- [Health-score discussion 1326](https://github.com/home-assistant/architecture/discussions/1326):
  broader evidence and objections to collapsing distinct problems into one score.
  This is a separate proposal, not the maintenance implementation.
