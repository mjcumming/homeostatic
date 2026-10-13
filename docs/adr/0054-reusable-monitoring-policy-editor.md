# ADR 0054: Manage reusable monitoring policies on Policies

**Status:** Accepted; notification timing selection superseded by [ADR 0057](0057-policy-owned-notification-timing.md); type editing, built-in presentation and overlapping-policy behavior partially superseded by [ADR 0058](0058-unified-policy-lifecycle.md); replacement implementation pending
**Date:** 2026-10-12

**Partially supersedes:** the reusable-definition editing boundary in [ADR 0030](0030-separate-group-policies-from-source-choices.md) and [ADR 0048](0048-policy-checks.md). Named policies are edited on Policies even when they select individual sources. Existing source enrollment and exclusion semantics remain until an implementation specification explicitly changes them.

**Later decision:** ADR 0057 replaces the shared-schedule selector with timing owned by each notification entry. ADR 0058 fixes type at creation, gives supplied and custom policies the same lifecycle, and permits independent overlap. The earlier decision text remains below as history; unaffected detection-change and review safeguards remain in effect.

## Context

The current catalog editor can add, edit, pause and remove selection rules. The thermostat and temperature-limit designs need named policies with configurable detection settings and independent copies. Owners also need a clear place to assign notification schedules and delivery methods.

## Decision

Policies owns reusable monitoring definitions. Each definition has a stable identity, editable name, supported check type, selected sources or groups, detection parameters, enabled state, and notification rows. Each notification row pairs one schedule with one or more delivery methods, as defined in [ADR 0055](0055-separate-notification-schedules-and-methods.md).

Provide Add, Edit, Duplicate, Enable/Disable and Delete. Built-in definitions remain available as starting templates. A duplicate copies settings into an independent, inactive draft with a new identity. Editing or renaming retains identity. Saved copies have no inheritance relationship to their template or original.

Source selection supports individual sources and supported groups such as an area, label or integration. Group selection includes future matching sources. Sources shows effective monitoring and applicable named policies, with links to their editor. Existing source enrollment controls continue to serve their own scope; there is one editor for each reusable definition.

All changes use the complete draft and existing preview/review/guarded-save path. Viewing a page changes nothing. Navigation retains pending edits. The review identifies affected sources and existing alerts.

## Changes to active monitoring

Changing detection parameters, check type or selected scope ends the affected policy's existing alerts and pending qualification, then starts evaluation under the saved definition. A continuing condition can raise a new alert after satisfying the new detection settings. Disable and Delete end its monitoring and pending notification requests. History records that monitoring ended, rather than reporting observed recovery. Already delivered email, SMS and speech cannot be withdrawn.

Renaming leaves active monitoring alone. Changing only notification rows uses the reporting-change behavior in ADR 0055.

Allow overlapping custom detection policies. Each is an independent monitoring expectation and can create its own finding and notification requests. Show the contributing policy names. There is no policy-priority or overlap-resolution editor. Existing dependency grouping still applies; this decision does not disable correlation or duplicate a built-in availability check merely because two enrollment rules select it.

## Consequences and implementation work

Homeostatic owns policy definitions, source selection and check-specific parameters. health-tree continues to own dependency, episode, acknowledgment and attention behavior. Ending a policy must affect only its contributions, including when an issue is shared through dependency grouping.

The specification and executable tests cover stable identity, independent duplication, group membership changes, draft retention, policy reset, shared-issue removal, and notification assignment. Policy changes use the existing removal lifecycle without migrating historical alerts between changed detection rules.

The [editor design](../policy-editors.md) records the screens and implementation boundary. Local editors and runtime support these definitions. Releasing independent notification rows requires publishing the corresponding health-tree route API and updating the integration dependency first; the currently published dependency does not implement that API.
