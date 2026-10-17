# Homeostatic architecture decision records

The [integration specification](../spec.md) says what Homeostatic does. These records explain choices that could reasonably have gone another way. Library engine and policy decisions remain in the separate health-tree ADR index.

| ADR | Decision | Status |
| --- | --- | --- |
| [0094](0094-one-device-issue-workflow.md) | Use one device issue workflow from every investigation page | Accepted; implemented, installed and verified for a local trial; supersedes entry routing and device membership in 0093 and refines 0091 presentation |
| [0093](0093-explicit-device-availability-issue-selection.md) | Act on explicitly selected device availability issues | Accepted; earlier local trial installed and verified; entry routing and availability-only membership superseded by 0094; selection contract retained |
| [0092](0092-scoped-refresh-and-coherent-saves.md) | Scope refresh work and keep configuration reads coherent | Accepted; extends 0010/0067 and finalizes 0029's loading boundary |
| [0091](0091-direct-issue-actions-and-coverage.md) | Show issue actions and coverage directly | Accepted; supersedes availability action wording in 0073/0074 and opened-issue disclosures and navigation in 0086 |
| [0090](0090-independent-issues-under-healthy-integrations.md) | Keep failures independent under healthy integrations | Accepted; refines 0041 and supersedes healthy-integration grouping in 0085 and 0088 |
| [0089](0089-contextual-entity-monitoring-policies.md) | Keep entity policy access contextual | Accepted; refines entity presentation in 0073 and 0086 |
| [0088](0088-show-information-that-supports-a-decision.md) | Show information that supports a decision | Accepted; supersedes shared entry marking in 0085 |
| [0087](0087-remove-maintenance-creation-from-ui.md) | Remove maintenance creation from the panel | Accepted |
| [0086](0086-visible-evidence-and-flat-details.md) | Show essential evidence and keep supporting details flat | Accepted; entity policy and identity presentation refined by 0089; opened-issue disclosures and navigation superseded by 0091 |
| [0085](0085-device-centered-issue-context.md) | Present related problems and waiting checks under their device | Accepted; detail presentation refined by 0086; shared entry marking superseded by 0088; per-finding device navigation superseded by 0094 |
| [0001](0001-omit-switch-conversion-helper-entries.md) | Omit switch conversion helper entries from monitoring inventory | Accepted |
| [0002](0002-retain-group-sources-as-limited-aggregate-evidence.md) | Retain Group sources as limited aggregate evidence | Proposed |
| [0003](0003-one-rule-catalog-for-passive-enrollment.md) | Use one rule catalog for passive enrollment and exclusions | Accepted |
| [0004](0004-confirm-dependencies-per-function.md) | Confirm automation-derived dependencies per function | Accepted; function setup path superseded by 0039 |
| [0005](0005-ha-availability-is-control-path-evidence.md) | Treat HA availability as control-path evidence | Accepted |
| [0006](0006-request-notifications-through-consumers.md) | Request notifications through consumer automations | Accepted; partially superseded by 0015 |
| [0007](0007-separate-resolved-history-from-runtime-activity.md) | Separate resolved-problem history from runtime monitoring activity | Proposed |
| [0008](0008-use-ha-topology-only-for-presentation.md) | Use native HA topology for presentation, not causation | Accepted; navigation destination superseded by 0017 |
| [0009](0009-device-availability-summaries.md) | Use eligible HA entity evidence for one device availability summary | Partially superseded by 0012 and 0025; diagnostic fallback by 0064 |
| [0010](0010-large-inventory-updates.md) | Preserve ordered conditions and separate catalog from evidence updates | Accepted |
| [0011](0011-device-availability-requires-meaningful-evidence.md) | Separate optional entity availability from device faults | Superseded by 0012 |
| [0012](0012-monitoring-expectations-and-persistent-exclusions.md) | Monitor declared availability expectations and persist exclusions | Partially superseded by 0013 and 0025 |
| [0013](0013-retire-automatically-discovered-sources.md) | Retire automatically selected sources when HA removes registry evidence | Accepted |
| [0014](0014-publish-detected-facts-for-owner-automations.md) | Publish detected facts for owner automations | Proposed |
| [0015](0015-deliver-notifications-to-people.md) | Deliver notifications to people with a built-in sender | Accepted; reporting model partially superseded by 0026; method and presence design by 0056; device/entity restart presentation by 0064 |
| [0016](0016-guided-integration-availability-defaults.md) | Guide availability enrollment by integration | Accepted; navigation scope extended by 0017 |
| [0017](0017-one-sources-workspace.md) | Use one Sources workspace | Accepted |
| [0018](0018-source-panel-views.md) | Use source-specific views beside one tree | Accepted; UI workflow and scope partially superseded by 0061 |
| [0019](0019-accepted-dashboard-baseline.md) | Implement the accepted task-focused dashboard baseline | Accepted; automation picker superseded by 0021, navigation by 0022 and native options by 0039; UI simplification by 0059; UI workflow and scope partially superseded by 0061 |
| [0020](0020-integration-monitoring-master-control.md) | Stop monitoring an integration as one scope | Accepted |
| [0021](0021-defer-automation-notification-routing-ui.md) | Defer automation notification routing in Settings | Accepted; guided digest deferral partially superseded by 0026 and native options by 0039 |
| [0022](0022-top-level-notifications-page.md) | Give Notifications its own dashboard page | Accepted; UI workflow and scope partially superseded by 0061 |
| [0023](0023-optional-topomation-location-tree.md) | Use Topomation as an optional location tree | Superseded by 0024 |
| [0024](0024-explicit-topomation-grouping.md) | Offer Topomation as its own Sources grouping | Accepted |
| [0025](0025-follow-home-assistant-availability-semantics.md) | Follow Home Assistant entity availability semantics | Accepted; supersedes 0012 source eligibility and status mapping; partial-device warning superseded by 0045; eligibility by 0064 |
| [0026](0026-fixed-reporting-preferences.md) | Use five fixed reporting preferences | Accepted; details settled by 0027; fixed profile model superseded by 0055; notification ownership/defaults partially superseded by 0066 |
| [0027](0027-reporting-defaults-and-delivery.md) | Fixed reporting defaults and delivery semantics | Accepted; combined profiles and single-choice assignment superseded by 0055 |
| [0028](0028-settings-scope-and-visible-reporting.md) | Keep global policies in Settings and expose reporting directly | Accepted; catalog presentation superseded by 0030; page placement superseded by 0047; UI simplification by 0059 |
| [0029](0029-load-catalog-pages-on-demand.md) | Load revision-bound catalog pages on demand | Accepted; panel context and loading boundary finalized by 0092 |
| [0030](0030-separate-group-policies-from-source-choices.md) | Show group policies separately from individual source choices | Accepted; partially supersedes 0028; page placement superseded by 0047; catalog editor by 0048; reusable-definition ownership by 0054 |
| [0031](0031-review-source-settings-together.md) | Review integration monitoring and reporting together | Accepted; UI simplification by 0059; UI workflow and scope partially superseded by 0061 |
| [0032](0032-automation-reported-situations.md) | Receive expiring situation reports from HA automations | Accepted; setup and registration partially superseded by 0034 |
| [0033](0033-notification-tap-destinations.md) | Open issue context from notification taps | Accepted |
| [0034](0034-create-alerts-from-ha-automations.md) | Configure an alert once in its HA automation, with automatic registration and phone acknowledgment | Accepted; no-eviction rule superseded by 0042 |
| [0035](0035-align-device-availability-with-ha-proposal.md) | Align device availability with the Home Assistant proposal | Accepted; no-edge rule superseded by 0041; entity fallback by 0064 |
| [0036](0036-compact-sources-evidence-and-choices.md) | Keep Sources focused on status, scope, and action | Accepted; connection-row placement superseded by 0037; UI simplification by 0059; UI workflow and scope partially superseded by 0061; source-detail disclosures by 0086 |
| [0037](0037-group-connections-with-registry-owned-devices.md) | Group connections with their registry-owned devices | Accepted; supersedes 0036 connection-row placement; no-edge statement superseded by 0041 |
| [0038](0038-connectivity-evidence-and-device-problem-card.md) | Treat reported disconnection as device evidence | Accepted; connectivity-off availability interpretation superseded by 0064; detail disclosures and name shortening by 0086 |
| [0039](0039-mothball-functions-and-native-options.md) | Mothball functions and remove native options | Accepted; supersedes native option and function setup paths |
| [0040](0040-display-home-assistant-automation-repairs.md) | Display Home Assistant automation failures | Superseded by 0044 |
| [0041](0041-group-watched-devices-under-failed-integrations.md) | Group watched devices under failed integrations | Accepted; supersedes 0035 no-dependency-from-device-membership rule |
| [0042](0042-clean-up-deleted-automation-alerts.md) | Clean up deleted automation alerts | Accepted; supersedes 0034 no-eviction rule |
| [0043](0043-skip-startup-grace-on-integration-reload.md) | Skip startup grace on integration reload | Accepted |
| [0044](0044-report-home-assistant-repairs-as-issues.md) | Report Home Assistant Repairs as issues | Accepted; supersedes 0040 |
| [0045](0045-device-issue-requires-every-selected-entity-unavailable.md) | Open a device issue only when every selected entity is unavailable | Accepted; supersedes 0025's partial-device warning; eligibility, Sources fallback and connectivity exception superseded by 0064 |
| [0046](0046-report-vacuum-error-activity.md) | Report a vacuum's error activity as an issue | Accepted; presentation extended by 0085 |
| [0047](0047-policies-page.md) | Give Policies its own dashboard page | Accepted; check presentation superseded by 0048; UI workflow and scope partially superseded by 0061 |
| [0048](0048-policy-checks.md) | Show Integrations, Devices, Batteries, and Vacuums as on or off, and Repairs as always on | Accepted; Repairs row superseded by 0049; reusable-definition ownership by 0054; UI simplification by 0059 |
| [0049](0049-repairs-check.md) | Turn Repairs on or off like the other checks | Accepted; UI simplification by 0059 |
| [0050](0050-flag-automations-that-name-missing-entities.md) | Flag automations that name a missing entity | Accepted |
| [0051](0051-monitor-ups-conditions-through-shared-mappings.md) | Monitor UPS conditions through shared integration mappings | Accepted; required battery-ownership transfer superseded by 0058 |
| [0052](0052-thermostat-setpoint-deviation-alerts.md) | Detect thermostat setpoint deviation with progress-aware checks | Accepted; reporting assignment model superseded by 0055 |
| [0053](0053-configurable-temperature-limit-checks.md) | Check user-configured temperature limits | Accepted; reporting assignment model superseded by 0055 |
| [0054](0054-reusable-monitoring-policy-editor.md) | Manage reusable monitoring policies on Policies | Accepted; notification timing by 0057; type editing, built-in presentation and overlap by 0058; UI simplification by 0059; UI workflow and scope partially superseded by 0061 |
| [0055](0055-separate-notification-schedules-and-methods.md) | Pair reusable notification schedules and delivery methods on policies | Accepted; schedule library superseded by 0057; test-setting migration by 0058 |
| [0056](0056-ha-delivery-methods-and-presence.md) | Deliver through Home Assistant methods with optional presence selection | Accepted; UI simplification by 0059 |
| [0057](0057-policy-owned-notification-timing.md) | Configure notification timing inside each policy | Accepted; test-setting migration superseded by 0058; UI simplification by 0059; notification ownership/defaults partially superseded by 0066 |
| [0058](0058-unified-policy-lifecycle.md) | Use one editable policy lifecycle | Accepted; UI simplification by 0059; eligibility and delivery presentation by 0064; notification ownership/defaults partially superseded by 0066 |
| [0059](0059-save-directly-and-test-configured-methods.md) | Save directly and test configured delivery methods | Accepted; UI workflow and scope partially superseded by 0061; compound inline-method drafts by 0066 |
| [0060](0060-hide-recovery-confirmation-from-issue-lists.md) | Keep recovery confirmation out of issue lists and explain related-source findings | Accepted; evidence-gap list visibility partially superseded by 0065 |
| [0061](0061-issues-first-product-workflows.md) | Use Issues-first product workflows and scoped editing | Accepted; notification ownership/defaults partially superseded by 0066; detail presentation by 0086; maintenance creation UI superseded by 0087 |
| [0062](0062-disabled-integrations-and-add-ons.md) | Keep disabled integrations and add-ons visible without availability issues | Accepted |
| [0063](0063-remove-superseded-configuration-and-ui.md) | Remove superseded configuration and interface implementations | Accepted |
| [0064](0064-monitoring-coverage-and-device-evidence.md) | Monitor operational entities and consolidate device notifications | Accepted; notification ownership/defaults partially superseded by 0066 |
| [0065](0065-separate-availability-evidence-gaps-from-issues.md) | Keep current availability evidence gaps in Sources without changing monitoring | Accepted |
| [0066](0066-reusable-notifications-own-timing-and-delivery.md) | Reuse six named notifications with timing, delivery and explicit policy assignments | Accepted; method reload boundary superseded by 0067 |
| [0067](0067-save-delivery-methods-in-place.md) | Save delivery methods in place while preserving routing and queued requests | Accepted |
| [0068](0068-contextual-availability-monitoring-controls.md) | Act on availability monitoring from compact source details | Accepted; action wording and Issues workflow extended by 0069; source-detail disclosures superseded by 0071 |
| [0069](0069-bulk-availability-removal-from-issues.md) | Remove unwanted availability monitoring from Issues | Accepted; extends 0068; group placement and scope superseded by 0074 |
| [0070](0070-saved-monitoring-and-history-navigation.md) | Finish saved monitoring changes and restore History navigation | Accepted; supersedes History placement in 0061 and saved-action Undo in 0068/0069 |
| [0071](0071-compact-monitoring-inspector.md) | Show monitoring coverage in a compact source inspector | Accepted; supersedes source-detail disclosures in 0068; inspector layout refined by 0073 and 0086; maintenance creation UI superseded by 0087 |
| [0072](0072-quiet-save-completion.md) | Complete saves without persistent success messages | Accepted; supersedes success feedback in 0061 and 0070 |
| [0073](0073-entity-first-monitoring-details.md) | Keep entity details focused on the entity | Accepted; supersedes entity presentation in 0061/0068/0071, source-history placement in 0070 and availability wording in 0069; affected-member presentation and navigation refined by 0086; maintenance creation UI superseded by 0087; entity policy and identity presentation refined by 0089; stopping-action wording superseded by 0091 |
| [0074](0074-availability-removal-inside-open-issues.md) | Review availability removal inside an opened issue | Accepted; supersedes group-wide action placement and scope in 0069; action wording superseded by 0091 and confirmation presentation by 0094 |

These records explain the decisions behind the current specification and identify later supersessions. Their dates are the dates recorded here, not claimed dates of the original discussions. Acceptance records a product decision. The [roadmap](../roadmap.md#current-work) owns implementation, validation and installation status; those states are not repeated in decision status fields. A new ADR supersedes an accepted decision; a proposed ADR describes unresolved tradeoffs without claiming owner approval.

Write an ADR when an adapter boundary, source eligibility, graph-confirmation rule, delivery or persistence contract, or enduring UI model has real alternatives and would be easy to reverse without its rationale. Keep ordinary bug fixes, wording adjustments, and release validation in the spec, changelog, and tests.
