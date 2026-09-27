# ADR 0006: Request notifications through consumer automations

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

HealthTree owns episode attention and timing. Homeostatic must expose actionable messages without becoming tied to Companion app, TTS, or another transport. The owner settled the content/timing versus transport boundary in `docs/ui.md` section 16.

## Decision

The library policy decides recipient, timing, and loudness from episode state. The adapter builds evidence-bounded title and message content and emits `homeostatic_notification` requests with stable delivery and episode identities. Consumer automations choose the device, app, service, and transport formatting; the shipped blueprint is one consumer. Notifications start disabled and require an enabled consumer when activated. Homeostatic reports a delivery request, never that a person received or read it. The durable outbox is saved before publication; replay can occur after a crash, so consumers replace by tag or deduplicate by delivery id.

## Options considered

- **Call notify services directly from the adapter.** This would couple the integration to transport capabilities and recipient mappings.
- **Move timing and escalation into each consumer.** Consumers would duplicate episode-aware policy and could disagree about reminders or silence.
- **Treat event emission as confirmed delivery.** HA event publication provides no receipt from a phone or person.

## Consequences

The owner must configure a consumer and routes. A missing or disabled consumer is a monitoring gap, and successful event emission is not proof of receipt. Attention decisions remain in HealthTree; this ADR records the Home Assistant adapter and transport boundary.
