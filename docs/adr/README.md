# Homeostatic architecture decision records

The [integration specification](../spec.md) says what Homeostatic does. These records explain choices that could reasonably have gone another way. Library engine and policy decisions remain in the separate health-tree ADR index.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-omit-switch-conversion-helper-entries.md) | Omit switch conversion helper entries from monitoring inventory | Accepted |
| [0002](0002-retain-group-sources-as-limited-aggregate-evidence.md) | Retain Group sources as limited aggregate evidence | Proposed |
| [0003](0003-one-rule-catalog-for-passive-enrollment.md) | Use one rule catalog for passive enrollment and exclusions | Accepted |
| [0004](0004-confirm-dependencies-per-function.md) | Confirm automation-derived dependencies per function | Accepted; function setup path superseded by 0039 |
| [0005](0005-ha-availability-is-control-path-evidence.md) | Treat HA availability as control-path evidence | Accepted |
| [0006](0006-request-notifications-through-consumers.md) | Request notifications through consumer automations | Accepted; partially superseded by 0015 if accepted |
| [0007](0007-separate-resolved-history-from-runtime-activity.md) | Separate resolved-problem history from runtime monitoring activity | Proposed |
| [0008](0008-use-ha-topology-only-for-presentation.md) | Use native HA topology for presentation, not causation | Accepted; navigation destination superseded by 0017 |
| [0009](0009-device-availability-summaries.md) | Use eligible HA entity evidence for one device availability summary | Partially superseded by 0012 and 0025 |
| [0010](0010-large-inventory-updates.md) | Preserve ordered conditions and separate catalog from evidence updates | Accepted |
| [0011](0011-device-availability-requires-meaningful-evidence.md) | Separate optional entity availability from device faults | Superseded by 0012 |
| [0012](0012-monitoring-expectations-and-persistent-exclusions.md) | Monitor declared availability expectations and persist exclusions | Partially superseded by 0013 and 0025 |
| [0013](0013-retire-automatically-discovered-sources.md) | Retire automatically selected sources when HA removes registry evidence | Accepted |
| [0014](0014-publish-detected-facts-for-owner-automations.md) | Publish detected facts for owner automations | Proposed |
| [0015](0015-deliver-notifications-to-people.md) | Deliver notifications to people with a built-in sender | Accepted; reporting configuration model partially superseded by 0026 |
| [0016](0016-guided-integration-availability-defaults.md) | Guide availability enrollment by integration | Accepted; navigation scope extended by 0017 |
| [0017](0017-one-sources-workspace.md) | Use one Sources workspace | Accepted; implemented locally for review |
| [0018](0018-source-panel-views.md) | Use source-specific views beside one tree | Accepted |
| [0019](0019-accepted-dashboard-baseline.md) | Implement the accepted task-focused dashboard baseline | Accepted; automation picker superseded by 0021, navigation by 0022 and native options by 0039 |
| [0020](0020-integration-monitoring-master-control.md) | Stop monitoring an integration as one scope | Accepted |
| [0021](0021-defer-automation-notification-routing-ui.md) | Defer automation notification routing in Settings | Accepted; guided digest deferral partially superseded by 0026 and native options by 0039 |
| [0022](0022-top-level-notifications-page.md) | Give Notifications its own dashboard page | Accepted |
| [0023](0023-optional-topomation-location-tree.md) | Use Topomation as an optional location tree | Superseded by 0024 |
| [0024](0024-explicit-topomation-grouping.md) | Offer Topomation as its own Sources grouping | Accepted |
| [0025](0025-follow-home-assistant-availability-semantics.md) | Follow Home Assistant entity availability semantics | Accepted; supersedes 0012 source eligibility and status mapping; partial-device warning superseded by 0045 |
| [0026](0026-fixed-reporting-preferences.md) | Use five fixed reporting preferences | Accepted product direction; contract and implementation pending |
| [0027](0027-reporting-defaults-and-delivery.md) | Fixed reporting defaults and delivery semantics | Accepted |
| [0028](0028-settings-scope-and-visible-reporting.md) | Keep global policies in Settings and expose reporting directly | Accepted; catalog presentation superseded by 0030; page placement superseded by 0047 |
| [0029](0029-load-catalog-pages-on-demand.md) | Load revision-bound catalog pages on demand | Proposed; implemented locally for review |
| [0030](0030-separate-group-policies-from-source-choices.md) | Show group policies separately from individual source choices | Accepted; partially supersedes 0028; page placement superseded by 0047; catalog editor superseded by 0048 |
| [0031](0031-review-source-settings-together.md) | Review integration monitoring and reporting together | Accepted |
| [0032](0032-automation-reported-situations.md) | Receive expiring situation reports from HA automations | Accepted; setup and registration partially superseded by 0034 |
| [0033](0033-notification-tap-destinations.md) | Open issue context from notification taps | Accepted |
| [0034](0034-create-alerts-from-ha-automations.md) | Configure an alert once in its HA automation, with automatic registration and phone acknowledgment | Accepted; implemented; no-eviction rule superseded by 0042 |
| [0035](0035-align-device-availability-with-ha-proposal.md) | Align device availability with the Home Assistant proposal | Accepted; connectivity-class fallback and selected-check treatment superseded by 0038, no-edge rule by 0041; native report ingestion pending upstream |
| [0036](0036-compact-sources-evidence-and-choices.md) | Keep Sources focused on status, scope, and action | Accepted; connection-row placement superseded by 0037 |
| [0037](0037-group-connections-with-registry-owned-devices.md) | Group connections with their registry-owned devices | Accepted; supersedes 0036 connection-row placement; no-edge statement superseded by 0041 |
| [0038](0038-connectivity-evidence-and-device-problem-card.md) | Treat reported disconnection as device evidence | Accepted; supersedes 0035 fallback and 0025 selected-check treatment for connectivity-class sensors |
| [0039](0039-mothball-functions-and-native-options.md) | Mothball functions and remove native options | Accepted; supersedes native option and function setup paths |
| [0040](0040-display-home-assistant-automation-repairs.md) | Display Home Assistant automation failures | Superseded by 0044 |
| [0041](0041-group-watched-devices-under-failed-integrations.md) | Group watched devices under failed integrations | Accepted; supersedes 0035 no-dependency-from-device-membership rule |
| [0042](0042-clean-up-deleted-automation-alerts.md) | Clean up deleted automation alerts | Accepted; supersedes 0034 no-eviction rule |
| [0043](0043-skip-startup-grace-on-integration-reload.md) | Skip startup grace on integration reload | Accepted |
| [0044](0044-report-home-assistant-repairs-as-issues.md) | Report Home Assistant Repairs as issues | Accepted; supersedes 0040 |
| [0045](0045-device-issue-requires-every-selected-entity-unavailable.md) | Open a device issue only when every selected entity is unavailable | Accepted; supersedes 0025's partial-device warning |
| [0046](0046-report-vacuum-error-activity.md) | Report a vacuum's error activity as an issue | Accepted |
| [0047](0047-policies-page.md) | Give Policies its own dashboard page | Accepted; check presentation superseded by 0048 |
| [0048](0048-policy-checks.md) | Show Integrations, Devices, Batteries, and Vacuums as on or off, and Repairs as always on | Accepted; Repairs row superseded by 0049 |
| [0049](0049-repairs-check.md) | Turn Repairs on or off like the other checks | Accepted |
| [0050](0050-flag-automations-that-name-missing-entities.md) | Flag automations that name a missing entity | Accepted |

These records explain the decisions behind the current specification and identify later supersessions. Their dates are the dates recorded here, not claimed dates of the original discussions. Acceptance records a product decision, not production readiness. A new ADR supersedes an accepted decision; a proposed ADR describes unresolved tradeoffs without claiming owner approval.

Write an ADR when an adapter boundary, source eligibility, graph-confirmation rule, delivery or persistence contract, or enduring UI model has real alternatives and would be easy to reverse without its rationale. Keep ordinary bug fixes, wording adjustments, and release validation in the spec, changelog, and tests.
