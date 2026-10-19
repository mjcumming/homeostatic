# Choose what to monitor

[Homeostatic manual](../guide.md)

A monitoring policy chooses the sources to watch, the condition that opens an issue and the notifications to use. Supplied policies and policies you create use the same controls in **Policies**.

For eligible sources, starting settings and the conditions each monitoring type detects, see the [monitoring reference](monitoring-reference.md).

## Add or change a policy

1. Open **Policies**. Select **Edit policy** beside an existing policy, or select **Add policy**, choose a **Monitoring type** from the alphabetical list, and select **Continue**.
2. Give the policy a useful name. For **Entity availability**, expand an integration, then a device, and check the entities to monitor. All branches start collapsed. Search finds entities across the complete tree and opens matching branches; clearing it restores the branches you opened. Expanding a branch leaves monitoring choices unchanged. A device-group checkbox changes only the displayed matches. **Monitored only** helps review the selection. Other monitoring types offer their supported **Include** choices and source picker.
3. Review the detection settings offered for that type. Repairs and broken automations always cover their complete supported set and have no source selector.
4. Under **Notifications**, use **Add notification** to choose a saved named notification. To keep issues in the panel without notifications from this policy, remove every assignment so the section reads **No notifications**. [Set up notifications](notifications.md) covers timing and destinations.
5. Set **Policy enabled** as intended, then select **Save policy**.

The saved policy controls monitoring. An enabled switch in an unsaved draft has not changed the running policy. A confirmed save removes the unsaved-change controls; if saving fails, the editor retains your draft and explains the problem.

To find the policies watching an entity, select it in **Monitoring**, then open **Monitoring policies**. Each policy explains what it checks, including its availability and other condition checks. Use **Edit policy** to change one, or close the dialog to return to the entity. The labeled device and integration names open their Home Assistant pages.

## Watch entities an integration is not providing

Choose **Entities not provided** when registered entities remain in Home Assistant but their integration no longer supplies them. The owning integration must be loaded. Select the entities in the same tree and set **For at least (hours)**; the default is 24 hours. Save the policy and choose its notification assignments as usual.

An enabled registration with a missing state or restored placeholder can qualify. A live entity reporting unavailable is being provided and belongs to availability monitoring. Disabled entities are excluded. Startup and integration reloads interrupt the waiting period.

The issue identifies the entity and its loaded integration. Use **Open Entity** to inspect it in Home Assistant. Homeostatic does not delete registrations or determine whether they are obsolete.

## Choose a scope that will stay useful

| Selection | Use it when |
| --- | --- |
| All sources of the selected type | Every eligible source of that type should be watched, including sources added later. |
| All except selected | Most sources should be watched, with specific exceptions. Newly added eligible sources are included. |
| Selected sources | Only the named equipment should be watched. |
| Sources in areas or with labels | Home Assistant location or labels define the equipment you want. New matching sources join the selection. |

The editor offers only the choices supported by the monitoring type. Integration selection uses the integration name and includes its current and future configured connections; area and label choices are not offered for integrations. An integration exclusion can identify one configured connection.

Availability policies automatically select enabled operational entities. To watch a diagnostic or configuration entity individually, choose it explicitly in an entity availability policy. Disabled sources remain outside availability monitoring.

Fresh setup supplies **General entity availability** using Morning summary and **Important equipment availability** using Immediate. Important equipment initially includes cameras, locks, alarm panels and binary sensors reporting smoke, carbon monoxide, gas or moisture. General initially includes the other eligible operational entities. These selections follow entity type and device class, so future matching entities are included. Availability watches whether Home Assistant can provide a state; selecting a smoke or leak detector here does not configure smoke or leak detection.

Both policies use the same entity list. Their starting selections follow entity types, including future matching entities. Individual checkboxes override those selections without changing the other policy. The short explanation above the list describes how new entities are included. Clearing every checkbox is allowed. Changes apply when you select **Save policy**.

Exclusions belong to their policy and remain saved if a source disappears. Missing saved choices appear in the list with **Remove saved choice**. Devices organize the list and related issues; Homeostatic does not assign a device availability status.

Existing device availability policies become entity availability policies during an upgrade, retaining their names, enabled state and notifications. Selected devices retain coverage of their operational entities. Area and label device selections retain the devices matching at upgrade time and include future entities on those devices. Review the resulting list if devices later move or gain labels.

## Stop availability monitoring

Use this when Home Assistant regularly marks a feature unavailable and you have decided it does not need an availability check. These controls update the affected policies' exclusions.

1. Choose the appropriate starting point:

   | Starting point | Action |
   | --- | --- |
   | An opened availability issue | Select **Stop Monitoring**. The review includes its currently unavailable monitored entities. |
   | One entity in Monitoring | Select **Stop Monitoring**. |
   | Selected members of a device in Monitoring | Select **Select entities…**, choose the members, then **Stop Monitoring**. |

2. Review the entity count and the exact names shown in the confirmation. It explains that availability monitoring will stop while other checks continue. A wider issue may cover several devices.
3. Select **Stop Monitoring** to confirm. Choose **Cancel** to keep the saved monitoring unchanged.

Stopping ends the affected availability monitoring and can end other availability issues for those same entities. Other checks, such as battery or temperature monitoring, continue. Home Assistant's entities stay enabled. The outcome is **Monitoring ended**, without claiming that the equipment recovered.

If the result cannot be confirmed, use **Refresh saved monitoring** when offered and review the saved scope before another action. Later adjustments belong to the policies or the resumption control below.

## Resume availability monitoring

1. Find the source in **Monitoring**. **More filters → Availability exclusions only** helps locate excluded sources.
2. For an entity, select **Resume availability monitoring…**. For device members, use **Select entities…**, choose the members, and select **Resume availability monitoring for selected entities…**.
3. Check the exact entities in the confirmation, then select **Resume availability monitoring**.

This removes the reviewed explicit exclusions. The policy must still be enabled and its source selection must still include eligible equipment. Resuming an exclusion does not enable a disabled policy or broaden its selection.

## Duplicate, disable, delete or restore

The monitoring type stays fixed after creation. To configure a different type, add another policy. To reuse existing settings, open **More actions** beside the policy and select **Duplicate**. The copy is independent and starts disabled; review its name, selection, settings and notifications before enabling and saving it.

To stop a policy temporarily, open it, turn **Policy enabled** off, then select **Save policy**. To remove it, choose **More actions → Delete** and review the deletion confirmation. Disabling or deleting ends that policy's monitoring. Other policies watching the same equipment continue.

To restore a deleted supplied policy:

1. Select **Restore defaults** in Policies.
2. Choose the missing policies to restore and select **Restore selected**.
3. Open each restored draft, review its settings and select **Save policy**.

Restoration leaves other policies unchanged. It does not recreate deleted notifications or enable global sending. Updates preserve edited and deleted policies.

## Understand the effect of an edit

Policies can overlap. Two battery policies can watch the same battery at different thresholds and use different notifications. Each remains independent; inspect all contributing policies when a change does not remove an issue or notification you expected it to affect.

Renaming a policy keeps its current issues. Changing detection settings or the selected monitoring expectation can end the old issue and begin fresh evaluation. History records the ended monitoring separately from recovery.

Each editor saves its own changes. Saving a policy does not save a pending notification or delivery-method draft. Moving between Homeostatic pages, or visiting another Home Assistant page and returning in the same tab, retains pending drafts. Reloading or closing the tab ends that draft session. Use **Discard changes** to restore a saved policy's settings before saving; it does not undo a completed save.

When an older device availability policy is converted to entity availability, it retains the devices in its saved scope and covers future entities on those devices. Newly discovered devices require selection. Standalone entities are not added to that converted coverage.
