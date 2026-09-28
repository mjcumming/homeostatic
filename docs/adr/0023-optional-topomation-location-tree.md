# ADR 0023: Use Topomation as an optional location tree

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming

## Context

Home Assistant floors and areas cannot express the deeper house hierarchy already maintained in Topomation. Sources already offers a location grouping, and Topomation exposes a read-only location list over its Home Assistant WebSocket API.

## Decision

When `topomation/locations/list` returns a usable location hierarchy, the Sources location grouping presents that hierarchy. Explicit entity assignments take precedence over the location's HA area mapping. Sources not placed in the hierarchy remain reachable under Unassigned. When the command is absent, fails, or returns an unusable hierarchy, the existing HA floor and area tree remains available. The integration grouping and all source identities stay the same.

The connection uses Topomation's public WebSocket command. Homeostatic does not read Topomation's runtime or storage and does not import occupancy or automation rules. Location membership is presentation only.

## Alternatives

- Require Topomation for Homeostatic: would make ordinary monitoring depend on another optional integration.
- Copy Topomation's hierarchy into Homeostatic storage: would create a second location authority and a synchronization problem.
- Keep only HA floors and areas: would hide the owner's more useful house structure.

## Consequences

Topomation's location response is now an optional presentation contract. Missing or inconsistent mappings require an Unassigned group. Monitoring and problems continue independently when Topomation is unavailable.
