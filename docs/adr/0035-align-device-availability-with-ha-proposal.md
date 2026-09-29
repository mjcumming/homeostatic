# ADR 0035: Align device availability with the Home Assistant proposal

**Status:** Accepted; entity fallback and display implemented locally. Native report ingestion pending upstream.
**Date:** 2026-09-29
**Decider:** Michael Cumming

## Context

The owner chose [HA architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400) as the device availability model instead of a Homeostatic-specific vocabulary. This adopts the proposal as reviewed on this date, not future edits or an assertion that its API has shipped.

## Decision

| Value | Label | Meaning with explicit reports |
| --- | --- | --- |
| `available` | Available | Reporting integrations agree the device is available. |
| `partially_available` | Partially available | Reporting integrations disagree. |
| `unavailable` | Unavailable | Reporting integrations agree it is unavailable. |
| `unknown` | Unknown | Availability cannot be determined. |
| `disabled` | Disabled | The HA device is disabled. |

Explicit reports take precedence. Preserve their config-entry identities; ignore detached entries and clear reports on unload. Without reports, follow the enabled-entity fallback: no entities or no states means unknown; any state other than unavailable means available; all unavailable means unavailable. Entity fallback alone does not produce partially available. An HA unknown entity value is not an unavailable state. Disabled takes precedence.

## Relationship to current monitoring

ADR 0025 remains the implemented contract for selected-entity availability checks. Its `some_unavailable` warning is not the proposal's `partially_available` device status. A device can be available while a separately monitored entity has an availability issue.

Selected-member checks and the proposal's all-enabled-entity fallback have different scopes. Do not relabel an existing warning as the new status or silently change saved exclusions. Keep monitoring selection, device availability, equipment health, dependency effects, and attention distinct. Add no health-tree enum, rewrite no HA entity state, and infer no dependency from membership.

Degraded, Insufficient evidence, and Awaiting status are not the chosen device labels. Explain Unknown in supporting text. Not monitored remains a monitoring choice, not another availability value.

## Delivery

This is a design decision only. The inspected HA 2026.9.3 device registry does not provide the proposed reporting API. Do not call hypothetical APIs or create replacement HA core endpoints. The roadmap tracks implementation, including provenance, display, and the separation from existing monitoring findings.

Before implementation, resolve partially missing or restored entity states and incomplete integration reporting against upstream: the proposal does not fully specify those combinations. Validate report precedence, conflicting reports, unload and detachment, disabled and empty devices, entity fallback, and independent entity warnings with executable scenarios. Accepting this direction changes no runtime, saved monitoring, notifications, or deployment.


## Implementation note: 2026-09-29

Entity fallback and the separate device display are implemented locally. The pure report reducer has lifecycle and precedence scenarios; native report ingestion still requires a supported upstream API. The spec defines the conservative completion for partially missing or restored evidence and aggregation over actual current reports. These details are local implementation choices, not claimed upstream decisions. Registry devices remain browsable without retaining a removed monitoring check, as permitted by ADR 0013. Earlier delivery paragraphs describe the boundary at decision time.
