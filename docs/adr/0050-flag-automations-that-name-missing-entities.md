# ADR 0050: Flag automations that name a missing entity

**Status:** Accepted
**Date:** 2026-10-04

## Context

An automation stores entity ids in its triggers, conditions, and actions. Home Assistant loads that automation when one of those ids no longer exists. The automation stays on, and the part that names the missing id never runs. Home Assistant does not raise a Repair for this. [ADR 0044](0044-report-home-assistant-repairs-as-issues.md) reports Repairs Home Assistant raises, and leaves rule-reference scans and trace-only run errors outside that contract.

The reference is still in the saved automation. Home Assistant exposes it through `entities_in_automation` and `automations_with_entity` on the pinned automation component. Those helpers read explicit entity ids from triggers, conditions, and actions. Homeostatic already uses the same helpers when suggesting function requirements.

Deleting an integration, or removing an entity, does not edit the automation. `automation_reloaded` does not fire. The events that do fire are entity-registry removal and an entity-id change. A removal that happened while Home Assistant was off is not replayed, so a pass after startup is also required. Saving the automation in the editor cannot introduce a missing id. A file can. Reloading automations is when that saved id becomes visible, and when a fix should clear the issue.

An entity id written only inside a template is absent from those helpers. Configuration another integration keeps for itself is also absent. TopoMation occupancy sources are that second case. TopoMation lighting and vacuum rules are ordinary automations: their triggers name TopoMation's occupancy sensor, a lux sensor, or `sun.sun`, and their actions name the devices they control.

## Decision

After Home Assistant has started, Homeostatic checks loaded automations for entity ids that are in neither the entity registry nor the state machine. The same check runs when automations reload. On an entity-registry removal, or an update that carries the previous entity id, the check asks which automations still name that id. When an entity id is created again, open issues that named it are checked again. Other registry updates do not run this check.

If the automation component is not loaded, the check does nothing and does not end issues it already opened.

Each matching automation is one issue. The issue takes the automation's name, lists the missing ids, and links to that automation in the editor. A later check ends it when the automation no longer names a missing id, the automation is gone, or the entity exists again. The issue is not a Repair. It is outside the dependency map. It does not change enrollment, and it does not edit the automation.

The check is on until the owner turns it off, on the same Policies row pattern as Repairs. The row is **Broken automations**. **Turn off** drafts the exclusion, and **Monitor all automations** removes it. Its reporting choice uses the same name and defaults to the morning summary. Turning Repairs off leaves this check alone.

[ADR 0044](0044-report-home-assistant-repairs-as-issues.md) stays as it is. Repairs still repeat Home Assistant's issue registry only. Trace-only run errors stay out.

## Alternatives

- **Wait for each integration to raise a Repair.** The broken reference is often in an automation the integration did not author, and a private setting such as a TopoMation occupancy source would still need its own owner to notice it.
- **Treat this as a Repair.** Repairs would then mix Home Assistant's issues with a scan Home Assistant does not perform.
- **Scan on every registry update.** Area, name, and disabled changes do not strand an id.

## Consequences

A registered entity whose state is `unavailable` or `unknown` does not open this issue. `sun.sun` and any other entity that has a state without a registry row do not either. A disabled registry entry is still present, so it does not either.

An automation with several triggers is flagged while any one of its explicit entity ids is missing. The other triggers can still run.

Entity ids that appear only inside a template stay invisible. So does any entity id stored outside an automation, including a TopoMation occupancy source. A device trigger that never resolved to an entity id stays invisible here; Home Assistant's own device-automation failure remains a Repair when Home Assistant raises one.

Scripts are the same shape and are not part of this decision.
