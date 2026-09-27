# ADR 0001: Omit switch conversion helper entries from monitoring inventory

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

Homeostatic's passive catalog discovers Home Assistant config entries and entities. `switch_as_x` presents an existing switch as a light, fan, or another entity type. Its config entry appeared as a separate “Change device type of a switch” source alongside the resulting entity. The owner explicitly rejected those helper entries in the monitoring list.

## Decision

The `switch_as_x` config entry is ineligible for the monitoring inventory, regardless of broad saved attach rules. The converted entity remains eligible for its own HA availability check. It has no dependency on the omitted helper entry. Eligibility uses the integration domain, not the display name.

## Options considered

- **Keep both sources.** This presents the conversion wrapper as another monitored device and adds a duplicate-looking source.
- **Add a default exclusion rule.** Existing saved rules can still attach the helper; the entry also remains in the discovered inventory.
- **Hide the row in the dashboard only.** The hidden helper would still affect monitoring counts, graph state, and episodes.

## Consequences

The list no longer treats a conversion wrapper as its own device. Homeostatic does not independently monitor that helper's config-entry setup state. The converted entity's availability is still only HA control-path evidence, not proof that the physical switch responds.
