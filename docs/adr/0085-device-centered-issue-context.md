# ADR 0085: Present related problems and waiting checks under their device

**Status:** Accepted; healthy-integration sibling grouping superseded by [ADR 0090](0090-independent-issues-under-healthy-integrations.md)
**Date:** 2026-10-16

**Later decision:** [ADR 0086](0086-visible-evidence-and-flat-details.md) refines the opened issue and source layouts, counts and labels. Device grouping, retained problems and exact issue scope remain unchanged.

**Partially superseded:** [ADR 0088](0088-show-information-that-supports-a-decision.md) removes shared issue labels and repeated cross-device counts from list entries. Complete acknowledgment and pause scope remains beside the issue controls.

**Partially supersedes:** the one-row placement of shared loaded-integration issues in the integration specification and ADR 0061 and the unknown-check presentation in ADR 0046. Detection, dependency, episode and notification decisions remain unchanged.

## Context

The owner found a vacuum described as activity unknown beside a shared availability issue, even though Home Assistant explicitly reported the vacuum unavailable. Related entity findings were separated from the device. The owner requested generic device grouping and preservation of actual errors through missing information.

## Decision

Group by registry device identity across policies. A shared issue anchored on a currently loaded integration can show its device-specific findings under each known device when all recorded members have known device ownership. Each entry opens the original complete issue. Mark shared entries and explain the complete acknowledgment and pause scope in its dialog. Count distinct issues at integration and page level; a device count means issues affecting that device. Incomplete ownership and actual integration problems stay at integration level.

Retain the last reported warning or failure for each monitored check as adapter presentation evidence, separately from opaque library snapshots. Unknown observations preserve it, passing observations clear it, and ending monitoring removes it. Restore this evidence across reloads without inventing reports absent from older saved state. This record does not decide recovery or create dependency edges.

A wholly unknown check with explicit evidence that no previous problem is retained appears as a waiting check under an affected device, rather than another current issue. It remains inspectable in Monitoring when there is no visible device issue. Incomplete evidence remains visible. A reported problem followed by unknown evidence remains visible with its earlier report and the current limitation. These rules apply across check types and policies.

For vacuums, preserve the distinction between unavailable, unknown, missing, restored and unrecognized activity. All remain unknown to the vacuum error detector. A retained vacuum error remains labelled as an error pending current status; normal HA activity establishes its recovery under the existing detector rules.

## Acceptance

Cover shared and standalone issues, missing ownership, search, pagination, exact action scopes, generic waiting checks, prior error followed by unavailability, reload and normal activity. Inspect desktop and narrow layouts using the existing device issue fixture. No live notification is part of acceptance.
