# Choose what to monitor

[Homeostatic manual](../guide.md)

A monitoring policy chooses the sources to watch, the condition that opens an issue and the notifications to use. Supplied policies and policies you create use the same controls in **Policies**.

For eligible sources, starting settings and the conditions each monitoring type detects, see the [monitoring reference](monitoring-reference.md).

## Add or change a policy

1. Open **Policies**. Select **Edit policy** beside an existing policy, or select **Add policy** and choose a **Monitoring type** from the alphabetical list. For **Unavailable entities**, also choose a **Source category**: **Any entity type**, **Cameras**, **Locks**, **Alarm panels** or **Safety sensors**. Select **Continue**.
2. Give the policy a useful name and check the sources to monitor. Focused categories and equipment types use a flat list. **Any entity type** and **Missing entities** use a tree: select a group checkbox or expand its arrow to choose individual entities. A dash means some entities are selected; selecting it checks the rest. Search and **Monitored only** help review a longer list. Filtered group checkboxes affect only matching entities. Expanding a branch leaves your choices unchanged.
3. Review the detection settings offered for that type. For **Unavailable entities**, set **Report unavailable after** to the time a continuous outage should last before opening an issue. Zero reports immediately. Repairs and broken automations always cover their complete supported set and have no source selector.
4. Under **Notifications**, use **Add notification** to choose a saved named notification. To keep issues in the panel without notifications from this policy, remove every assignment so the section reads **No notifications**. [Set up notifications](notifications.md) covers timing and destinations.
5. Set **Policy enabled** as intended, then select **Save policy**.

The saved policy controls monitoring. An enabled switch in an unsaved draft has not changed the running policy. A confirmed save removes the unsaved-change controls; if saving fails, the editor retains your draft and explains the problem.

To find the policies watching an entity, select it in **Monitoring**, then open **Monitoring policies**. Each policy explains what it checks, including its availability and other condition checks. Use **Edit policy** to change one, or close the dialog to return to the entity. The labeled device and integration names open their Home Assistant pages.

## Watch entities an integration is not providing

Choose **Missing entities** when registered entities remain in Home Assistant but their integration no longer supplies them. The owning integration must be loaded. Select the entities in the tree and set **For at least (hours)**; the default is 24 hours. Save the policy and choose its notification assignments as usual.

An enabled registration with a missing state or restored placeholder can qualify. Any live state means the entity is being provided, including unknown or unavailable; ordinary changes to its value do not affect this condition. Use **Unavailable entities** to watch live unavailable states. Disabled entities are excluded. Startup and integration reloads interrupt the waiting period.

The issue identifies the entity and its loaded integration. Use **Open Entity** to inspect it in Home Assistant. Homeostatic does not delete registrations or determine whether they are obsolete.

## Choose a scope that will stay useful

| Future sources | Use it when |
| --- | --- |
| Do not include automatically | Only the equipment you choose should be watched. |
| Include automatically | All current and future eligible sources should be watched. Uncheck individual sources to exclude them. |
| In selected areas | Home Assistant areas define the equipment you want, including new matching sources. |
| With selected labels | Home Assistant labels define the equipment you want, including new matching sources. |

Flat lists offer the supported **Future sources** choices above, with area or label choices in the same editor. Checked always means monitored. Checking every current source does not automatically include future sources. Integration lists show each configured connection. Selecting one keeps that exact connection; existing saved rules for an integration family still include its future connections. Area and label choices are not offered for integrations.

For battery, vacuum, temperature, thermostat and UPS policies, area and label scopes show matching sources and saved exceptions. Change the area or label selection to broaden that scope. You can exclude individual matching sources.

New custom **Unavailable entities** policies start disabled with no entities selected, including when you choose a category. Choose the entities to include; newly added entities stay outside that exact selection. Supplied availability policies follow their saved category scopes. To watch a diagnostic or configuration entity individually, choose it explicitly. Disabled sources remain outside availability monitoring.

Fresh setup enables **Cameras**, **Locks**, **Alarm panels**, **Safety sensors** and **General entity availability**. Safety sensors includes smoke, carbon monoxide, gas and moisture binary sensors; General includes the other eligible operational entities. The categories use Immediate, while General uses Morning summary. Cameras starts with a five-minute unavailability wait; the others start at zero. Availability watches whether Home Assistant can provide a state; selecting a smoke or leak detector here does not configure smoke or leak detection.

The category stays fixed after creation and appears beside the monitoring type; renaming or duplicating a policy keeps it. Cameras, locks, alarm panels and safety sensors use flat lists. Other saved entity scopes use the general tree. Saved choices outside a category remain visible and removable. Individual checkboxes override the saved scope without changing another policy. The explanation above the list describes how new entities are included. Clearing every checkbox is allowed. Changes apply when you select **Save policy**.

A return to availability before the configured wait ends cancels the pending issue. Missing readings, restored startup values and restarts interrupt an unfinished wait. Recovery uses the separate installation recovery setting. The editor identifies overlapping enabled availability policies; a shorter wait on another policy can still produce an earlier issue or notification.

Updates add newly supplied policies disabled and leave existing policies, including Important equipment, unchanged. Enable a category when its sources, wait and notifications suit the household, then adjust any overlapping old coverage deliberately. Deleting a supplied policy keeps it deleted across later updates; **Restore defaults** can restore a chosen missing policy.

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

To stop a policy temporarily, open it, turn **Policy enabled** off, then select **Save policy**. To remove it, choose **More actions → Delete** and review the deletion confirmation. Select **Delete policy** to confirm, or **Cancel** to keep it and return to the policy. Disabling or deleting ends that policy's monitoring. Other policies watching the same equipment continue.

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
