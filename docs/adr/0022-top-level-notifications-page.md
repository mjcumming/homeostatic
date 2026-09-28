# ADR 0022: Give Notifications its own dashboard page

**Status:** Accepted
**Date:** 2026-09-28
**Decider:** Michael Cumming

**Supersedes:** ADR 0019's five-page navigation and placement of Notifications inside Settings.

## Context

Choosing people, destinations, quiet hours, and whether notification requests are active is a distinct household task. Nesting it in Settings makes the task harder to find and makes the Overview notification status lead through an unrelated settings section.

## Decision

Use six main dashboard destinations: Overview, Issues, Sources, History, Notifications, and Settings. Notifications owns the existing person delivery editor, request switch, test action, and review-before-save flow. Settings owns installation timing and problem grouping. The Overview notification status opens Notifications. The generated Home Assistant dashboard also includes the destination.

ADR 0021 still governs deferred automation routing. Moving the page does not change policy, recipients, saved options, or delivery behavior.

## Consequences

Notification configuration is directly reachable on desktop and phone. Settings has fewer unrelated controls. Both pages continue to use the same saved options and preview contract.
