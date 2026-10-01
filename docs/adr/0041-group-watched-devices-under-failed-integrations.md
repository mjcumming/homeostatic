# ADR 0041: Group watched devices under failed integrations

**Status:** Accepted
**Date:** 2026-10-01

**Supersedes:** The no-dependency-from-device-membership rule in ADR 0035 and the no-edge statement in ADR 0037. Their display and evidence decisions remain in force.

## Context

When an integration fails, its selected device availability checks can fail at the same time. Without graph edges, Homeostatic opens a separate issue for each device beside the integration issue. That makes one control-path outage look like several unrelated problems.

## Decision

A watched device availability check depends on each watched integration entry associated with the device in Home Assistant's registries. If the integration and device checks fail together, health-tree groups the device finding under the integration issue. A device failure while its integration check is healthy remains its own issue. An unwatched integration creates no edge.

The edge expresses where Homeostatic gets availability evidence. It does not rewrite the device's own observation or assert that the physical device has stopped working. Device-to-entity membership remains a monitoring scope, not another dependency edge. A device associated with multiple watched entries may depend on each of them; the device's selected entity evidence still determines its own status.

## Consequences

An integration outage can produce one issue with affected devices instead of one issue per device. The grouping can attribute a concurrent device availability finding to an integration even if the physical fault has a separate cause. Homeostatic retains each device finding and its evidence in the issue details so the owner can investigate after the integration recovers.
