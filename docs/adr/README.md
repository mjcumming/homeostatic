# Homeostatic architecture decision records

The [integration specification](../spec.md) says what Homeostatic does. These records explain choices that could reasonably have gone another way. Library engine and policy decisions remain in the separate health-tree ADR index.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-omit-switch-conversion-helper-entries.md) | Omit switch conversion helper entries from monitoring inventory | Accepted |
| [0002](0002-retain-group-sources-as-limited-aggregate-evidence.md) | Retain Group sources as limited aggregate evidence | Proposed |
| [0003](0003-one-rule-catalog-for-passive-enrollment.md) | Use one rule catalog for passive enrollment and exclusions | Accepted |
| [0004](0004-confirm-dependencies-per-function.md) | Confirm automation-derived dependencies per function | Accepted |
| [0005](0005-ha-availability-is-control-path-evidence.md) | Treat HA availability as control-path evidence | Accepted |
| [0006](0006-request-notifications-through-consumers.md) | Request notifications through consumer automations | Accepted; partially superseded by 0015 if accepted |
| [0007](0007-separate-resolved-history-from-runtime-activity.md) | Separate resolved-problem history from runtime monitoring activity | Proposed |
| [0008](0008-use-ha-topology-only-for-presentation.md) | Use native HA topology for presentation, not causation | Accepted |
| [0009](0009-device-availability-summaries.md) | Use eligible HA entity evidence for one device availability summary | Partially superseded by 0012 |
| [0010](0010-large-inventory-updates.md) | Preserve ordered conditions and separate catalog from evidence updates | Accepted |
| [0011](0011-device-availability-requires-meaningful-evidence.md) | Separate optional entity availability from device faults | Superseded by 0012 |
| [0012](0012-monitoring-expectations-and-persistent-exclusions.md) | Monitor declared availability expectations and persist exclusions | Accepted |
| [0014](0014-publish-detected-facts-for-owner-automations.md) | Publish detected facts for owner automations | Proposed |
| [0015](0015-deliver-notifications-to-people.md) | Deliver notifications to people with a built-in sender | Proposed |

Records 0003–0008 document choices from the owner worksheet and pilot specification. Their dates are the dates recorded here, not claimed dates of the original decisions. Accepted records settled owner direction, not production readiness. An accepted decision is superseded by a new record, not silently rewritten. A proposed decision records the current pilot approach and its unresolved tradeoffs; it does not claim owner approval.

Write an ADR when an adapter boundary, source eligibility, graph-confirmation rule, delivery or persistence contract, or enduring UI model has real alternatives and would be easy to reverse without its rationale. Keep ordinary bug fixes, wording adjustments, and release validation in the spec, changelog, and tests.
