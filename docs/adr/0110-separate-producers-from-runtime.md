# ADR 0110: Separate producer management from runtime coordination

**Status:** Accepted
**Date:** 2026-10-24

**Extends:** [ADR 0092](0092-scoped-refresh-and-coherent-saves.md) ordered observation and save boundaries. Preserves the durable-state contract in [ADR 0097](0097-shrink-the-snapshot-and-save-durable-changes.md) and targeted refreshes in [ADR 0098](0098-update-the-subject-and-sweep-rarely.md).

## Context

The Home Assistant adapter already separates detection algorithms from health-tree's dependency, issue and attention decisions. Runtime still constructs temperature and UPS monitors, restores their state, dispatches each check, tracks integration retries and combines their deadlines. Adding a check consequently requires changes to coordination code as well as the detector and catalog.

## Decision

Give one producer component ownership of detector instances, retained detector state, observation dispatch, integration retry holds and producer deadlines. Reuse the existing detector modules, Repairs reader and broken-automation scanner. Configuration and catalog code continue to define eligible sources and monitoring expectations. Pass current settings and UTC times into producer operations; producers do not own settings, read the clock, install timers, save storage or call health-tree's engine or attention policy.

Runtime owns Home Assistant listeners, catalog reconciliation, the ordered observation queue and lock, calls to public health-tree APIs, and the coherent save and delivery boundary. Producers expose observations, expectation-restart intents, detached presentation values, their next deadline and their persistence sections. Runtime applies restart intents through the engine and combines deadlines into its existing Home Assistant timer. Detection facts may inform the existing attention rules, but producers do not decide whom or when to notify.

Keep one queue on the Home Assistant loop. Temperature evidence remains captured as raw HA state until the worker can advance its producer and the engine together. Existing immutable observations retain their capture time and order. No independent producer tasks, queues, schedulers, registration framework or new dependency are introduced.

Keep the published snapshot section names and values unchanged. Source-specific restore validation remains deferred until that source is constructed; a failed restore must leave the original store intact. Query paths read captured evidence and producer presentation without advancing qualification. The health-tree boundary, saved configuration, delivery identities and request-before-delivery semantics are unchanged.

## Consequences

A detector's construction, restore, evidence dispatch and deadlines have one owner. Runtime still coordinates catalog and engine changes, persistence and delivery. The producer component uses explicit dispatch over the existing small set of checks; a generic plugin interface would add machinery without a current use.

## Acceptance

Executable scenarios preserve ordered capture across a held worker, producer and engine snapshot consistency, qualification deadlines, integration retries, UPS transitions, scoped refreshes, read-only queries, repeated restore and failed restore without writes or sends. Existing save and delivery scenarios cover the shared completion boundary. This extraction requires no configuration or stored-state migration.
