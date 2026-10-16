# ADR 0061: Use Issues-first product workflows and scoped editing

**Status:** Accepted
**Later decision:** [ADR 0068](0068-contextual-availability-monitoring-controls.md) adds contextual availability exclusions through the existing policy configuration owner and compacts source details.
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Later decision:** [ADR 0070](0070-saved-monitoring-and-history-navigation.md) supersedes the saved-action Undo and History placement provisions where applicable.

**Date:** 2026-10-14

**Later decision:** Notification timing ownership, its editor placement and compound inline-method drafts are superseded by [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). The historical decision below remains for context.

**Partially supersedes:** the prescribed dashboard and source-view layouts in [ADR 0018](0018-source-panel-views.md) and [ADR 0019](0019-accepted-dashboard-baseline.md); primary navigation and Overview routing in [ADR 0022](0022-top-level-notifications-page.md) and [ADR 0047](0047-policies-page.md); the integration-owned editor and cross-page aggregation of pending drafts in [ADR 0031](0031-review-source-settings-together.md); the mandatory source settings presentation in [ADR 0036](0036-compact-sources-evidence-and-choices.md); separate source-enrollment editor presentation in [ADR 0054](0054-reusable-monitoring-policy-editor.md); and the universal Save changes label and global-control placement in [ADR 0059](0059-save-directly-and-test-configured-methods.md). Existing enrollment semantics and saved choices remain until explicitly covered by implementation specifications. This decision preserves ADR 0059's compound inline-method draft and direct-save safeguards.

**Implementation clarification:** [ADR 0063](0063-remove-superseded-configuration-and-ui.md) removes the superseded configuration runtime and UI. Preservation of saved monitoring applies to the unified policy model; it does not require the earlier test schema or its editors.

**Later decision:** [ADR 0072](0072-quiet-save-completion.md) supersedes persistent save-success messages.

**Later decision:** [ADR 0073](0073-entity-first-monitoring-details.md) supersedes the applicable entity-detail layout, contextual history placement and availability action wording; existing monitoring and issue semantics remain unchanged.

**Later decision:** [ADR 0086](0086-visible-evidence-and-flat-details.md) defines visible issue evidence, preserved entity names and one flat supporting Details section. Group navigation and exact issue actions remain unchanged.

**Later decision:** [ADR 0087](0087-remove-maintenance-creation-from-ui.md) removes maintenance creation from the panel. Existing maintenance visibility and cancellation remain available; published actions and runtime semantics are unchanged.

## Context

Successive interface changes left overlapping destinations, duplicated sources, settings panels without editable settings, unexplained issue counts and save controls without changes to save. Navigation failed to restore the task being performed. The owner requested a coherent product specification and prototypes before application changes.

Walkthroughs established an Issues-first interface, investigation groups, connected source and policy workflows, scoped draft actions, and notification configuration. The owner accepted those workflows and requested consolidation into the product specification and standards.

## Decision

### Tasks and navigation

Use Issues, Sources, Policies and Notifications as primary destinations, with Issues opening by default. Remove the separate Overview. Place retained issue history within Issues and expose related history from sources. Keep installation-wide configuration in a labelled Settings utility. Retain useful operating status, active controls and supported deep links as destinations change.

Issues organizes investigation groups with exact issue identities beneath them. Sources presents each real source once and explains its independent checks and policies in the details. A selected source does not require Source, Settings and History tabs. Contextual Edit policy opens the authoritative policy editor with its complete scope and a return route. Entity details explicitly identify entity, device and integration relationships where known.

Groups are presentation. They neither infer parent failure from member counts nor replace the engine's correlation, issue identity, recovery, acknowledgment or attention rules. An entity without a device, a Repair and an automation problem remain directly reachable. Historical associations use recorded issue membership.

### Operational controls and drafts

Global Notifications uses confirmed On/Off state and applies only that setting. It is reachable throughout the interface and preserves all editor drafts. Pending or error feedback stays adjacent to the control; ordinary success does not create a page-wide banner. Monitoring continues while sending is off.

Inside the policy editor, Enabled is part of the draft. Optional policy-list quick controls and their interaction with a pending draft were not part of the reviewed workflow; they require a defined scope before implementation.

An unchanged editor has no save footer, Cancel, disabled Save or No changes message. Changes reveal Discard changes and the named save action. Save policy and Save delivery method apply their explicit scopes. Discard restores an existing object's unsaved changes in place and does not undo completed saves; discarding a new draft abandons it without creating a saved object. Confirmed saving removes dirty controls when no newer edits remain, shows a concise result and retains contextual return. New edits clear prior success feedback.

Navigation preserves current-session drafts and context. Back, Forward, direct links and refresh resolve meaningful destinations. Full and notification-focused policy views share one draft. Live updates preserve focus, input, selection and reading position. Unsaved restart recovery requires a separately verified storage strategy.

### Method editing and notifications

Timing remains owned by independent policy notification entries under ADR 0057. Notifications owns reusable methods and a policy-configuration index; it does not recreate shared schedules or a second timing editor.

Within a policy, Use method selects and returns without persisting. Cancel method changes restores the pre-open method draft, including earlier staged changes. Save policy commits its policy and staged methods together; policy Discard changes removes that unsaved scope. This retains ADR 0059's compound workflow.

Standalone Save delivery method applies the method to its saved shared uses and does not save a pending policy draft. Both entry points disclose affected uses and retain conflict protection. Assigned-method deletion must preserve reference integrity; the exact replacement/removal interaction remains a bounded follow-up.

Tests remain explicit actions on saved unchanged methods, independently available while ordinary sending is off. Resolve presence at request time, preserve explicit fallback or skip behavior, and report requested, failed or skipped outcomes without claiming receipt. Editing and saving never send tests.

## Consequences and implementation boundary

The [product specification](../product-specification.md) owns user goals, workflow requirements, page alternatives and acceptance journeys. [UI standards](../ui-standards.md) owns shared patterns. [Policy and notification editors](../policy-editors.md) owns form layout. The [roadmap](../roadmap.md#coherent-product-specification-and-uiux-redesign) orders the refactor.

Scoped actions require adapter support and tests before the interface can claim independent persistence. Retain administrator authorization, exact submitted payload validation, stale-revision rejection, serialized application, rollback and newer-draft preservation. Translate an explicitly scoped edit through the existing configuration owner without applying unrelated drafts. No new configuration store is approved.

Retiring duplicate source editors must preserve access to existing enrollment and exclusions until an explicit compatible replacement is available. Opening or saving an unrelated edit must not broaden scope, reset settings or alter issue identity. Existing notification links require compatibility handling as routes change.

Application implementation, accessibility and scale validation remain pending. Prototype counts, simulated findings, saves and delivery results are not runtime evidence. This approval makes no engine behavior change and authorizes no live notification test, release or deployment.
