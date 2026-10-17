# ADR 0090: Keep failures independent under healthy integrations

**Status:** Accepted
**Date:** 2026-10-16

**Later decisions:** [ADR 0093](0093-explicit-device-availability-issue-selection.md) permits explicit acknowledgment or pause of selected issues. [ADR 0094](0094-one-device-issue-workflow.md) applies that workflow to all current issues wholly owned by one registry device and gives that device one queue entry. These supersede single-issue-only dashboard response presentation while preserving independent issues, unrelated-device isolation and lifecycle semantics.

**Refines:** ADR 0041's independent-device guarantee. Supersedes the presentation of healthy-integration sibling groups in ADRs 0085 and 0088; complete scope remains visible for genuine integration failures.

## Context

An unavailable light appeared as a device-specific issue, but opening it showed four devices and offered acknowledgment and pause for the whole group. The library's sibling coalescing can combine availability checks under a healthy integration, including checks discovered together after startup. This conflicts with the adapter's existing rule that a device failure under a healthy integration stays independent. Clearer labels do not correct the action scope.

The maintainer requested coordinated correction of the grouping and the resulting interface. Sharing an integration is insufficient evidence of a common failure.

## Decision

Homeostatic disables the library's optional sibling coalescing through its public engine settings. Keep dependency edges and genuine failed-integration suppression and absorption. After an integration recovers and reconnect grace ends, remaining failures become independent issues. Independent device, entity and policy checks retain their existing identities and notification instructions; compatible notifications may still be consolidated by device without combining acknowledgment or pause scope.

Existing grouped issues transition through the library's explicit split events. Retain the original issue in history with its successor identities and a non-recovery outcome. Carry existing acknowledgment and pause state only to the named successors, preserving the original time, actor and expiry. Missing evidence does not establish recovery. Pending notification work retains its authorization and timing; superseded notifications are withdrawn without an all-clear.

A check shared by multiple recovering integration issues gets one successor. Reuse an existing independent issue with its own controls. When a new successor has several predecessors, begin fresh attention rather than choose one predecessor's controls arbitrarily; each predecessor's history links to that same successor.

Device issue entries open their actual independent issue. Their evidence and actions must not include unrelated devices merely because they share a working integration. A genuine integration failure may show all affected devices and its complete action scope. Keep supporting information useful to the selected problem.

Remove the inactive problem-grouping controls from Installation Settings. Previously stored count and window values remain accepted for saved-data compatibility but no longer influence grouping. Do not change monitoring selections or notification destinations.

## Acceptance

Exercise four unavailable devices under a loaded integration, including startup discovery and a later failure. Verify that acknowledgment and pause on one issue do not affect another device, including after reload. Retain independent checks on the same device and their existing notification consolidation.

Exercise an actual integration outage, recovery with unavailable devices remaining, and restoration of an older grouped issue with active controls and pending notifications. Verify truthful history, complete successor scope, unchanged observation boundaries, and no false recovery. Check desktop and narrow issue interactions and the simplified settings page using isolated Home Assistant and mocked notification services.
