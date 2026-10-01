# ADR 0039: Mothball functions and remove native options

**Status:** Accepted
**Date:** 2026-10-01

**Supersedes:** The native options path in ADRs 0019 and 0021 and the function setup path in ADR 0004.

## Context

Function readiness requires an owner to describe a household function and confirm every required source. The setup and resulting `unknown` state have been difficult to understand, without a clear everyday decision they help make. Home Assistant's native Configure form duplicates the Homeostatic panel and exposes raw YAML-shaped settings.

## Decision

New installations create the single Homeostatic entry with integration availability monitoring and notifications off. The integration provides no native Configure form or YAML configuration fields. Monitoring, timing and notifications are edited in the Homeostatic panel.

Function definitions and their implementation remain in the repository and in existing stored options, but production loads them inactive. They do not contribute graph nodes, readiness, issue importance, notification content or visible function entities. Existing function sensor and event registry entries are disabled by the integration. The dashboard and action catalog do not offer function setup, suggestions or previews. A future design needs a specific user decision, a guided setup path and a new ADR before functions return.

Existing situation declarations and consumer delivery settings remain readable so saved installations continue to operate. The panel can replace a consumer route when a person-delivery setup is reviewed and saved. A separate migration path is needed for owners who want to edit an older situation declaration.

## Consequences

The everyday setup has one place to edit. Saved function definitions are preserved for a future design, but existing function automations stop receiving function entity updates. Generic equipment monitoring, alerts and notification delivery remain available.
