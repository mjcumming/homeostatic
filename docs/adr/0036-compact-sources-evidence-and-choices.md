# ADR 0036: Keep Sources focused on status, scope, and action

**Status:** Accepted
**Date:** 2026-09-30
**Decider:** Michael Cumming

**Supersedes:** The repeated selected-entity row and default presentation of all three entity choices under ADRs 0017 and 0018. Their one-tree navigation, source-specific views, and guarded settings changes remain in force.

## Context

The owner reviewed device and entity details for Mobile App and Network UPS Tools. The tree placed issue counts below source names. The device panel repeated generic explanations before a long entity list. An entity panel repeated its own name in a one-row list and a link that selected the same entity. Mobile App also inserted a Connections tier beside devices with similar names. Entity Settings gave a separate availability check the same prominence as following the device or excluding an entity.

The distinctions still matter. One device issue may cover many unavailable selected entities; HA entity availability does not diagnose physical equipment. A config entry is not an HA device. An entity can be included through its device, monitored separately, excluded, or unselected.

## Decision

Start the tree collapsed. Show an issue count immediately after its source name, with scope counts secondary. For integrations with multiple config entries, show labeled connection rows directly under the integration after devices. Keep their identities reachable through search and issue navigation; list and explain them in a collapsed section of the integration panel.

Device details lead with the count of selected entities unavailable or missing a current state, show those entities first, and collapse other selected entities. Keep the independent HA device-availability result compact and separately labeled. Entity details show HA status, current value where useful, and effective monitoring state once. Remove the one-row self-list and generic next-step paragraphs from these views. Keep direct HA and monitoring actions.

Entity Settings show the effective monitoring state, following device monitoring, and exclusion first. Offer a separate check directly when no device check includes the entity; otherwise place it under More monitoring choices, open when already selected. Preserve all existing catalog actions, exclusions, drafts, review, and guarded save behavior.

## Consequences

The screen gives an owner the affected source, the reported HA condition, the monitoring relationship, and a direct action without repeated names or boilerplate. No saved monitoring choice, episode, dependency, or notification policy changes. Availability remains evidence about HA's control path, not proof of physical device health.
