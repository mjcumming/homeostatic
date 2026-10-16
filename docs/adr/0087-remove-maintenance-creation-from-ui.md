# ADR 0087: Remove maintenance creation from the panel

**Status:** Accepted
**Date:** 2026-10-16

**Partially supersedes:** The maintenance-creation interface requirements in ADRs 0061, 0071 and 0073. Active maintenance visibility and cancellation, published services and runtime semantics remain unchanged.

## Context

Preventing new issues during planned work is a valid but narrow household use case. The maintenance form adds another control to learn, including scope, dependent equipment and an expiry. Its behavior for current problems is also surprising: starting maintenance leaves existing issues and their notifications active. Acknowledgment, pausing an issue's notifications and removing inappropriate monitoring cover routine household decisions.

The owner approved removing maintenance creation from the interface while preserving published actions and a way to end existing periods.

## Decision

Remove every panel entry point and form for starting equipment maintenance. Keep issue acknowledgment and notification pauses in their existing scopes. Do not broaden those controls or reinterpret them as preventive equipment pauses.

Retain `homeostatic.start_maintenance` and `homeostatic.preview_maintenance` with their current scope, expiry, persistence and notification semantics. Existing maintenance periods, including those created through Home Assistant actions, remain visible with their target and expiry. Keep **End maintenance** available so those periods can be ended early.

## Acceptance

Verify that source, issue and history views offer no maintenance-creation action or form. Verify that an active maintenance period remains visible and can be ended, while acknowledgment and notification pauses continue to work. Published maintenance actions retain their existing tests and behavior.
