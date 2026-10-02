# ADR 0040: Display Home Assistant automation failures

**Status:** Superseded by [ADR 0044](0044-report-home-assistant-repairs-as-issues.md)
**Date:** 2026-10-01

## Context

Broken automations can affect a home without producing a Homeostatic equipment issue. Reading automation references to guess whether a rule will work would mislabel valid conditions and miss failures that occur only during execution. Home Assistant already reports some failures as Repair issues.

## Decision

Homeostatic reads active Home Assistant automation Repair errors for validation failures and missing actions. They appear in Overview and Issues with the automation name, Home Assistant's reported reason and a link to its editor or Repairs. They disappear when Home Assistant clears or dismisses the Repair issue. This needs no alert blueprint and creates no Homeostatic episode or notification request.

Do not inspect automation rules or infer failures from missing references. Home Assistant run errors that only appear in traces remain outside this first implementation until a supported event or query contract can identify them reliably.

## Consequences

Owners see confirmed automation failures in the normal issue list. The list follows Home Assistant's reports and may omit an automation that never runs or a run error that Home Assistant records only in a trace. Repair cards do not have Homeostatic acknowledgment, reporting preferences or history.
