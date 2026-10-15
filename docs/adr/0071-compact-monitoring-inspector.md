# ADR 0071: Show monitoring coverage in a compact source inspector

**Status:** Accepted
**Date:** 2026-10-15

**Partially supersedes:** The separate policy and technical disclosures in ADR 0068. Policies retain configuration ownership, and contextual availability actions retain their existing scope and guarded saves.

**Later decision:** [ADR 0073](0073-entity-first-monitoring-details.md) supersedes the applicable entity-detail layout, contextual history placement and availability action wording; existing monitoring and issue semantics remain unchanged.

## Context

The owner wants to see which entities are monitored and change monitoring easily while keeping all monitoring states browsable. The selected source pane devotes too much space to explanations, empty history and technical information.

## Decision

Keep All as the initial monitoring filter, with Monitored and Not monitored available beside search. This filter intersects with search and existing filters, preserves matching ancestors and survives navigation. Disabled Home Assistant sources retain their separate visibility setting. A selected source remains inspectable when filtering or a saved change removes its row from the results.

Derive coverage from active checks and their actual evidence inputs. Name the coverage, including device availability and condition checks such as temperature. Shared device membership alone does not establish monitoring. Monitoring coverage is independent of current health, maintenance and notification sending.

Lead the selected pane with the source name, compact coverage and relevant actions. Ordinary Home Assistant values use a secondary line. Open problems, missing evidence and active equipment controls remain visible. Keep the Home Assistant link available.

One collapsed Details disclosure holds contributing policy explanations, maintenance setup and technical information. View history opens related records on demand; empty-history and retention explanations appear there. Configure monitoring opens Policies when the entity has no contextual availability action. Removal and resumption keep their existing named policy scope; there is no second policy editor or general monitoring switch.

## Acceptance

Exercise All, Monitored and Not monitored with direct checks, device evidence, temperature inputs and unmonitored entities. Verify search intersections, disabled-source visibility, retained ancestors and selection, navigation back from Policies, and retained focus and disclosure state during refresh. Cover the existing removal, cancellation, resumption, conflicts, maintenance and history paths. Inspect desktop and narrow phone layouts in both themes, including long names and horizontal overflow.
