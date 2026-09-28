# ADR 0021: Defer automation notification routing in Settings

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming

**Supersedes:** The automation picker in ADR 0019's installation settings baseline.

## Context

Homeostatic can emit notification events for existing consumer automations, but the owner has not settled a guided automation routing workflow. Showing an automation picker beside person delivery suggests that both are ready to configure and makes the person setup path harder to understand.

## Decision

The guided Notifications page configures people and built-in destinations. It does not offer automation selection or detailed routing and digest editing. Notification delay belongs in Timing; the policy time zone appears with quiet hours.

Keep the saved consumer option and event contract for existing configurations. If a consumer is selected, show its presence and link to the native Homeostatic options to clear it before configuring person delivery. Do not clear or migrate it automatically. Revisit a guided automation route only after its behavior, preview, and correction path are specified.

## Consequences

New users have one supported delivery setup path. Existing automation configurations remain readable and operational through their saved options, but cannot be newly selected in the guided page. The native options flow remains the compatibility path.
