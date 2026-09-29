# ADR 0028: Keep global policies out of source settings and expose reporting directly

**Status:** Accepted
**Date:** 2026-09-28

## Context

The owner found the installation-wide catalog editor inside Eero's Settings and
could not find the reporting choices already agreed in ADRs 0026 and 0027.
Displaying the old notification editor until a separate setup action hid the
new workflow. A source's Settings implied that all catalog policies belonged
to that source.

## Decision

Extend ADR 0022's global Settings navigation with Monitoring policies, alongside
Timing and Problem grouping. Keep the complete catalog editor there. Source
Settings contains scoped monitoring choices, their review, and reporting
assignments. Multiple direct policies link to the global editor.

Notifications always displays the fixed reporting choices, schedules, people,
destinations, household default, and activation. Older saved policies do not
hide these controls or display the retired person-level editor. Reading a page
does not stage or save a replacement. The first reporting edit or explicit review
creates the draft, carrying over known person destinations, clearing the old
consumer selection in the draft, and leaving outgoing requests off. The existing
preview and exact-save contract applies. The previous policy remains active
until the replacement is saved, as required by ADR 0027.

## Consequences

Global policy scope is explicit. Reporting is usable without a separate reset or
migration gate. No runtime policy semantics, storage contract, or delivery engine
changes are needed. Editing installation timing alone does not replace reporting.
