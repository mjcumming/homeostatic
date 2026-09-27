# ADR 0005: Treat HA availability as control-path evidence

**Status:** Accepted
**Date:** 2026-09-26
**Decider:** Michael Cumming

## Context

A loaded Home Assistant integration and an available entity show what HA reports. They do not prove a physical device supplied a fresh reading, a detector processed a frame, or a command succeeded. A restored or cached state can look plausible after communication stops. The integration specification and agent rules maintain this evidence boundary.

## Decision

The initial catalog checks config-entry state and entity availability, and names those checks and their limits in the dashboard. HA `unknown`, restored, disabled, missing, or startup states are not treated as verified physical recovery. Monitoring coverage distinguishes an observed check from the stronger proof a function may need. Device-origin freshness, detector progress, command verification, and end-to-end service checks require separate source-specific observations and failure/recovery traces before they can support stronger claims.

## Options considered

- **Treat HA availability as device health.** A cached or aggregate state could conceal an offline or malfunctioning device.
- **Wait for physical proofs before exposing any HA checks.** This would discard useful control-path evidence and delay visibility into integration setup failures.
- **Infer physical failure from generic log messages.** Logs do not reliably identify continuing failure or prove recovery.

## Consequences

The dashboard may show a passing HA check while explicitly saying physical operation is unverified. Missing stronger evidence remains a coverage question, not an invented episode. Adding a richer producer changes the evidence contract and needs a trace that demonstrates failure and clearing.
