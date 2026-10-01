# ADR 0043: Skip startup grace on integration reload

**Status:** Accepted
**Date:** 2026-10-01

## Context

The health-tree engine starts grace when Homeostatic creates or restores it. Saving a panel change reloads Homeostatic and creates an engine while Home Assistant is already running. That delays new issues for another two minutes after each save, even though Home Assistant has not restarted.

## Decision

Use the configured startup grace when Home Assistant starts. Set the engine's startup grace to zero for a Homeostatic integration reload while Home Assistant is already running, including a panel save. Keep the configured value in saved settings so a later full Home Assistant start still uses it. Notification startup hold follows the same full-start boundary.

## Consequences

A new observed failure after a panel save can open immediately, subject to its other configured holds. A full Home Assistant start continues to protect against restored and incomplete startup evidence. The health-tree engine's general restore behavior remains unchanged; the adapter decides which lifecycle it is handling.
