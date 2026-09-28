# ADR 0025: Follow Home Assistant entity availability semantics

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming
**Supersedes:** ADR 0012's device-member eligibility and its treatment of `unknown` and total unavailability.

## Context

A Home Assistant button reports the time it was last pressed. Its value can be `unknown` before any press, even while Home Assistant can reach it. Excluding all buttons from device summaries would discard useful availability evidence to avoid treating this normal value as a device issue. Home Assistant distinguishes an unknown value from an unavailable entity: the latter means it cannot currently read or control the entity.

## Decision

- Keep enabled button entities eligible for device summaries under the ordinary entity-selection rules. Do not infer a fault from their last-pressed value or require a press to clear an issue.
- An HA entity state of `unknown` is a known, available entity with an unknown value for the passive availability check. It is not a warning, failure, or stale device issue. Preserve the raw HA state in evidence and display.
- An HA entity state of `unavailable` warns that HA cannot currently read or control that selected entity. A device summary warns when any selected member is unavailable, including when every member is unavailable. It does not assert physical-device failure.
- Missing state, restored startup state, disabled sources, and absent eligible members remain separate evidence or scope cases; an HA `unknown` value does not erase those distinctions.

If a device has no eligible members, keep its saved device-summary choice visible but attach no device availability check. When eligible members appear, the saved choice applies. Removing the last eligible member retires an existing check as a scope removal, not recovery. No brand, integration, entity name, or button device-class exception is used.

## Alternatives

- **Exclude all buttons.** Loses an availability signal to work around a normal unknown value.
- **Treat unknown as an availability fault.** Confuses a missing value with loss of access and creates false device issues.
- **Treat all unavailable members as device failure.** HA availability alone does not establish a physical fault.

## Consequences

The passive availability check answers whether HA reports an unavailable entity. An `unknown` value may coexist with a passing availability check; that pass does not verify the entity's value or physical freshness. The current HA state remains visible for questions that depend on the value. Existing episodes caused solely by unknown button values resolve when reevaluated; an unavailable entity remains a warning until HA reports access again or monitoring scope changes.
