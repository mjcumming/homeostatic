# ADR 0038: Treat reported disconnection as device evidence

**Status:** Accepted
**Date:** 2026-09-30
**Decider:** Michael Cumming

**Supersedes:** ADR 0035's entity fallback when a current connectivity-class binary sensor reports disconnection, and ADR 0025's ordinary-`off` treatment for that sensor in a selected device check. The remaining eligibility, report-precedence, and monitoring choices stay in force.

## Context

Home Assistant defines `off` for a binary sensor with device class `connectivity` as disconnected. Its value is a current HA state, so the generic ADR 0035 fallback calls a device Available even when this sensor reports disconnection. A selected device check also treats that `off` as ordinary available evidence. The issue card can therefore pair an Available device label with an unavailable motion entity and a disconnected connectivity entity, obscuring the actionable condition.

## Decision

For a registry-associated, enabled `binary_sensor` whose effective device class is `connectivity`, a current `off` state is an explicit disconnection report. In the device availability entity fallback, it establishes **Unavailable** even if other enabled entities have states. Disabled devices and current native integration availability reports retain ADR 0035 precedence. Missing, restored, `unknown`, and HA `unavailable` states do not report disconnection. Other binary sensor classes and entities named “Connectivity” do not acquire this meaning.

When this entity is included in a watched device's selected members, its current `off` state yields a `warn/connectivity_disconnected` device observation and keeps the issue open through the existing episode and clear-hold rules. A selected-member exclusion still removes it from that monitoring check; it does not rewrite the independent all-enabled-entity device status. Do not create a dependency edge or infer a physical cause. Device availability remains an HA evidence assessment, not proof of physical freshness.

The device problem card leads with the device name, the reported disconnection and any other affected selected entities, and the device-page action. Show the integration once as quiet context and shorten repeated device-name prefixes in entity labels. Put the explanation of differing assessment scopes behind a disclosure only when it helps explain conflicting evidence. Monitoring choices and diagnostics start collapsed; raw data and copy controls remain in Technical details. The main card uses a small, consistent type scale and adequate spacing.

## Consequences

The adapter must use registry device-class metadata, with current state metadata only as a fallback, and record which connectivity entity supplied the finding. Device-status and watched-device scenarios cover disconnected, connected, unavailable, restored, disabled, excluded, and mixed-member cases. Browser scenarios cover the compact card, conflict explanation, and collapsed technical controls. This is a Homeostatic adapter rule; health-tree's generic enums and observation contract do not change.
