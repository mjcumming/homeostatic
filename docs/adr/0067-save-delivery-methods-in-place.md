# ADR 0067: Save delivery methods in place

**Status:** Accepted
**Date:** 2026-10-14

**Supersedes in part:** [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md)'s requirement to reload for shared delivery-method definitions. Its notification model, remaining reload boundaries and preservation requirements remain in force.

## Context

The October 14 live review measured 7–8 seconds of server handling for a delivery-method rename because every method edit restarted the integration. The owner approved applying method edits in the existing runtime while preserving delivery semantics.

## Decision

Changes confined to reusable notification profiles, delivery methods and their generated policy use the existing serialized, verified in-place save transaction. This includes method names, destinations, presence rules, creation and deletion, with ordinary reference validation and explicit replacement or removal of uses. Accompanying monitoring-policy edits may change notification assignments only; policy identities, order, sources and detection remain unchanged. Policy-only monitoring edits retain their existing path. Other installation changes, including time zone, legacy default/Repair/automation assignments, global sending and timing settings, retain reload. Mixed definition and source/detection or policy-list changes also retain reload.

Keep the runtime, panel and subscriptions active. Drain captured observations in their existing order, compare effective reporting instructions against one captured source inventory, and preserve verified persistence and whole-transaction rollback. Observations arriving during storage remain queued. This introduces no new schema, scheduler, cache or save mechanism.

Method identities and surviving assignment identities remain stable. A rename does not reset acknowledgment, reporting clocks, delivered state or pending requests. Effective destination or presence-rule changes reconcile only affected reporting. Cancel obsolete requests and clean up prior messages using their original resolved targets; never retarget an already queued delivery by resolving presence again. Unchanged routes retain their clocks and pending delivery identities. New requests use the current saved method and current presence evidence under the existing delivery contract. The save never enables global sending. While sending is off, new issue notifications stay suppressed; the existing silent cleanup contract for prior messages remains unchanged.

## Acceptance

The roadmap owns implementation and installation status. Use isolated mocked-destination scenarios for rename, destination and presence changes, add/delete with reference updates, unaffected routes, queued targets, failed writes, rollback and observations arriving during storage. Verify runtime identity and the actual editor save/reopen path. Measure the resulting save separately from the previous reload samples. No live delivery test follows from this decision.
