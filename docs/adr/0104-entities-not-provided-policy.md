# ADR 0104: Report entities not provided through a separate policy

**Status:** Accepted
**Date:** 2026-10-18

**Extends:** ADR 0058's editable policy lifecycle and ADR 0103's entity selection workflow. Refines ADR 0065 only for the explicitly selected condition below; ordinary availability evidence gaps remain outside current issues and their badges.

## Context

An integration can leave enabled entity registrations without corresponding live entities after a change, upgrade or other disruption. Home Assistant presents these registrations using unavailable states with `restored: true`. That placeholder also occurs during startup or an integration reload. It establishes that the integration is not currently providing the entity; it does not establish that the entity is obsolete or that its equipment failed.

The owner wants Homeostatic to surface persistent cases as a separate monitoring policy and provide an entity link. Entity deletion and registry cleanup remain outside Homeostatic's scope.

Home Assistant's [registry documentation](https://contributors.home-assistant.io/architecture/core/registries/) and [Core 2026.10.0 entity registry implementation](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/helpers/entity_registry.py) establish the distinction between live entity states and restored placeholders. The latter may remain after an integration fails to set up. A live entity reporting unavailable is a separate availability condition.

## Decision

Add the monitoring type **Entities not provided**, with check identity `entity_not_provided`. Policies select canonical registered entities through the existing policy editor. Broad selection includes enabled operational, diagnostic and configuration entities; those categories do not establish that an entity registration is deliberately unused. Disabled entities, devices and owning integrations are ineligible. An unmonitored entity creates no issue merely because it is unmonitored.

Evaluate this condition only after Home Assistant has started and the registered entity's owning config entry is loaded and enabled. A missing current state or a restored placeholder establishes not-provided evidence under those prerequisites. Any live, non-restored entity state establishes that the entity is being provided, including `unknown`, `unavailable`, `off` and ordinary values. These values retain their existing meanings for other policies. Missing registry ownership, a mismatched owner, startup, unloading, retry or setup failure supplies unknown evidence for this policy; it never establishes that the entity returned.

Apply the scoped observation rules from ADR 0092 and ADR 0098 independently to this check. Ordinary live value and attribute changes do not change whether an entity is provided and must not queue provider observations or evaluation. A different check on the same entity may need the reading without reobserving this condition. Owner lifecycle, relevant registry changes and periodic reconciliation still refresh the prerequisites; captured presence transitions retain their receipt order.

The policy's **For at least** setting defaults to 24 hours. The configured interval qualifies continuous not-provided evidence through health-tree's raise hold; interrupted evidence restarts qualification. Zero explicitly disables the waiting period. Use zero clear hold and no freshness TTL. Unknown evidence cannot clear an open condition. Its incomplete current evidence stays inspectable but does not produce a current-issue badge or notification request. Existing startup notification holds remain in force. Home Assistant owns observation and timer scheduling; health-tree owns qualification, episodes and attention.

After qualification, open a normal-importance maintenance warning named **Entity not provided**. Identify the entity and owning integration and explain that the integration is loaded but is not providing that registered entity. Do not diagnose an upgrade, claim obsolescence, or describe the equipment as failed. Normal issue acknowledgment and notification pause controls apply. A current live state clears the condition through the ordinary lifecycle. Removing, disabling or excluding a registration ends monitoring without inventing recovery.

Offer a supplied editable policy named **Entities not provided**, enabled on fresh setup, selecting all eligible registered entities with a 24-hour qualification period and Morning summary notification assignment. Sending remains controlled by the existing global setting and configured destinations. Existing installations gain the template through Add policy or explicit restoration; updates never insert it into saved choices, reactivate a deleted policy or overwrite edits. A newly created custom policy starts disabled, as other custom policies do. This decision authorizes no installation, live configuration mutation or notification test.

Canonical entity details own inspection; Policies owns source selection, waiting duration and notification assignments. Keep the finding attached to its real entity and existing device grouping. Link **Open entity** to its Home Assistant entity view, with an owning integration link when available. Add no delete, cleanup, obsolete-marking or registry mutation controls. Do not manufacture a Home Assistant Repair; this is an independently configured Homeostatic condition.

## Verification

Executable scenarios cover restored and absent states with a loaded owner; live unavailable, unknown and ordinary states; startup, loading, retry and disabled owners; missing or mismatched registry records; device and entity disablement; the qualification boundary and interrupted qualification; current recovery; independent availability findings; policy exclusion, duplication, restart and removal; and silent unconfigured delivery. Check both mocked direct notification requests and event consumers through existing transport scenarios when notification wiring changes.

Always-on runtime scenarios also cover a broad policy receiving ordinary value and irrelevant-attribute traffic, with zero engine ingestion, engine or notification-policy advancement, discovery, publication and save work. Mixed-check scenarios verify that battery, vacuum and temperature updates still reach their own checks without generating provider or unchanged availability observations. The large-inventory measurement repeats the broad-policy case. Storage-write counts alone cannot establish that irrelevant traffic is idle.

Rendered scenarios cover Add policy, grouped entity selection, duration editing, validation, save/discard and reopening, warning identity, entity links and the absence of deletion controls. Exercise desktop and phone layouts, keyboard navigation and returns to the issue. Record isolated acceptance separately from any later authorized installation.
