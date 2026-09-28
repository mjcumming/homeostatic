# ADR 0024: Offer Topomation as its own Sources grouping

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming

## Context

ADR 0023 put the Topomation hierarchy behind the generic Location choice. The owner could not tell whether Sources was showing Topomation or Home Assistant floors and areas. Both trees are useful and have distinct authorities.

## Decision

Sources offers Integration and Home Assistant location groupings. When Topomation's read-only location command returns a usable tree, it also offers Topomation in the same Group by control. Home Assistant location always uses native floors and areas. Topomation uses its own ordered hierarchy and existing entity placement rules. If Topomation becomes unavailable while selected, Sources returns to Home Assistant location. The selected source identity remains stable across groupings; location selections map through a shared HA area when possible.

This supersedes ADR 0023's automatic use of Topomation within the Location grouping. Location membership still changes presentation only.

## Alternatives

- Keep automatic substitution: hides which location authority is in use.
- Require Topomation: makes an optional integration a dependency of ordinary source browsing.

## Consequences

The grouping menu identifies the source of the hierarchy. The optional Topomation view disappears when its response is unavailable or unusable. Monitoring, dependencies, and attention remain unchanged.
