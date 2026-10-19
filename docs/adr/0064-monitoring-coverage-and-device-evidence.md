# ADR 0064: Monitor operational entities and consolidate device notifications

**Later decision:** [ADR 0103](0103-entity-availability-with-grouped-selection.md) retires device availability policies and inferred device assessments. Historical device rules below no longer define current behavior.

**Status:** Accepted
**Date:** 2026-10-14

**Later decisions:** [ADR 0099](0099-two-supplied-entity-availability-policies.md) retains applicable equipment availability notifications on a confirmed shared integration issue. [ADR 0102](0102-collect-requests-by-saved-notification.md) replaces device-based message collection for reusable notifications with a fixed collection window keyed by saved notification, recipient and destination. A shared issue is not required; distinct saved notifications remain independent.

**Later decision:** [ADR 0093](0093-explicit-device-availability-issue-selection.md) adds explicit selection of same-device availability issues in the shared dashboard dialog. It supersedes the single-issue-only response presentation; independent issue controls and notification grouping remain unchanged.

**Later decision:** Empty supplied notification assignments are superseded by [ADR 0066](0066-reusable-notifications-own-timing-and-delivery.md). The historical decision below remains for context.

**Supersedes in part:** ADR 0009's diagnostic fallback and the availability interpretations in ADR 0025, ADR 0035, ADR 0038 and ADR 0045; ADR 0058's broad entity eligibility and independent delivery presentation; ADR 0015's single restart-summary presentation for device and entity findings. Independent policy ownership, detection, timing and operator controls remain intact. Complements ADR 0062's registry-disablement rule and preserves ADR 0061's UI workflows.

## Context

A device summary can pass when one entity reports while another capability is unavailable. Entity coverage is necessary for partial failures. Reporting both the derived device summary and each failed entity separately repeats the same problem. Diagnostic entities are not automatic operational expectations merely because Home Assistant enables them.

Home Assistant distinguishes unavailable from unknown. Current off and idle states remain available. Missing states and restored placeholders are absent evidence, subject to the existing unknown-evidence hold. The device registry has explicit disabled_by metadata but no generic device-availability state in Core 2026.10.1. Homeostatic derives its summary from eligible entity evidence. See the [state documentation](https://www.home-assistant.io/docs/configuration/state_object/), [entity-unavailable rule](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/entity-unavailable/) and [device registry](https://github.com/home-assistant/core/blob/2026.10.1/homeassistant/helpers/device_registry.py).

## Decision

### Coverage and evidence

Automatically monitor availability of enabled operational entities, including entities without a device. Broad, area and label selection excludes diagnostic and configuration entities. Selecting an exact entity explicitly opts that entity into availability monitoring, provided it is enabled. Device availability uses enabled operational members; remove the fallback that selects diagnostics when no operational entities exist. An empty device has no inferred availability check.

Automatic availability and the read-only device assessment in Sources respond to unavailable and absent evidence. Sources uses operational inventory for the general assessment and the applicable policy members for monitored evidence and counts; browsing an unmonitored source does not create a check. Do not interpret a current binary sensor off value as an availability failure, including a connectivity-class sensor. Condition-specific checks such as battery, UPS and temperature monitoring retain their explicitly configured evidence and semantics; this decision does not discard their diagnostic inputs.

Keep each entity's findings independent. A passing device summary or sibling cannot clear an unavailable or absent entity. Current HA unknown supplies available control-path evidence, while missing or restored evidence cannot establish recovery. Preserve activation, unknown-evidence and recovery holds. A derived device summary reports all selected members unavailable, passes when any selected member has a current state, and otherwise reports incomplete evidence.

Exclude disabled integrations, devices and entities using their registry fields. Never infer disablement from unavailable, missing, unloaded or stopped states. Preserve ADR 0062: removing a disabled source's check ends monitoring without inventing recovery; saved choices resume on re-enablement. Related independently enabled sources and Repairs retain their own eligibility.

### All except these

Add optional `excluded_sources` to each named monitoring policy: canonical source IDs subtracted from the positive selector. All except these retains a broad selector, so newly discovered eligible sources enroll automatically. Missing excluded IDs stay saved and visible for removal; names, ordering and current inventory size do not change identity.

Exclusions belong to their policy. A device policy can exclude a whole device or particular entity members from its device evidence. Excluding every member leaves that device without an availability check. Independently configured policies retain their own scope. The current policy editor owns these choices; no retired source editor or configuration hierarchy returns.

An empty exclusion list preserves existing detection identity. A changed nonempty exclusion set is a detection edit and follows the existing monitoring-ended lifecycle. Rename and notification changes preserve detection identity.

### Device notifications

An entity attached to a device uses that device as its notification subject. Different problems remain separate issues with their own observations, reasons, timing, acknowledgments and recovery. Compatible notifications about that device share one continuing message, including availability, low battery and other configured conditions. An entity without a device uses its own canonical identity, including conditions derived from that entity. Other source kinds retain their existing presentation. A derived device-availability finding adds context without producing another message.

health-tree owns a pure delivery-group reducer after attention authorization. It combines only deliveries already authorized by the policy and explicitly assigned a common opaque subject and compatible delivery intent by Homeostatic. It never adds causal dependencies, changes own health or creates synthetic episodes. Group membership is available through a public immutable record; snapshots remain opaque persistence data.

Compatibility requires the same complete delivery instructions, recipient and resolved destinations. Homeostatic compares notification timing, repeat behavior, conditions and selected methods; different instruction sets remain independent. Policy rows and clocks remain independent even when authorized presentation combines. Scheduled reports retain their existing report contracts. Startup holds still gate transport; findings consolidate under their device or standalone entity during startup and activation. Other source kinds retain their per-recipient and route summaries. Restart does not replay openings or accumulate overdue reminders; a due reminder updates its continuing subject message once.

Stable group identity survives individual recovery and restart. Partial recovery updates the existing message silently and retains every remaining authorized finding. Only the last member ending withdraws the message; monitoring removal is not recovery. A device-association change moves the affected finding to its current subject on the next authorized message update, retaining other members and without claiming recovery. Registry changes do not create attention by themselves. A newly qualifying failure can request attention even if earlier members were acknowledged. Notification acknowledgment applies only to the exact issues represented by that displayed request, never to later arrivals. Per-issue dashboard controls remain unchanged.

Store grouping membership with durable delivery state. Resolve presence for new requests before grouping, preserve prior resolved destinations for silent updates and withdrawal without introducing unseen findings to those destinations, and retain stable outbox delivery IDs across replay. Different groups or instructions must not inherit one another's membership or destinations.

Established integration failures continue to use existing dependency grouping. Merely sharing an integration or device never proves a common cause. Older independent failures remain separate issues even when their device notifications combine.

### Product boundaries

Preserve the current Sources, Issues, Policies and Notifications workflows. Extend the existing selector with All except these. Do not reset saved policies, enable outgoing delivery or deploy changes. Fresh defaults retain enabled availability, Repair and broken-automation policies without notification entries and global sending off. Condition-specific policies retain their setup requirements.

## Required scenarios

- An operational entity fails while a sibling reports; it remains actionable under the device notification subject.
- Several entities and their device summary fail together; one compatible device message contains the findings.
- Partial recovery, including a passing device summary, leaves the same notification with unavailable or absent members through holds and reload.
- Acknowledgment covers shown issues; a later failure requests attention.
- Availability and battery remain distinct issues with compatible device delivery.
- Different recipients, schedules, repeat behavior or conditional instructions remain separate.
- Automatic diagnostics/configuration, diagnostic-only devices and disabled records acquire no availability checks; exact entity selection can opt in diagnostics.
- Current unknown and off do not open availability issues; missing/restored evidence follows its hold and cannot clear failure.
- All-except enrolls new eligible sources, retains missing exclusions, filters device members per policy and survives save/reload.
- Last-member removal, route removal, presence changes and replay preserve membership and destination cleanup.
- An entity gains or loses its device association while failing; subsequent reminders and recovery use the current subject without withdrawing sibling failures.

## Consequences

Operational failures remain covered without automatic diagnostic noise. Broad policies can be narrowed without enumerating everything to keep. Device messages retain continuing failures while issue histories and deliberate delivery instructions stay independent. The adapter requires the accompanying health-tree delivery-group API; release that library before publishing an adapter build that depends on it.
