# Review and respond to an issue

[Homeostatic manual](../guide.md)

Use **Open issues** to investigate a reported problem and decide what to do about it. Sign in with a Home Assistant administrator account to use the panel and its controls.

## Inspect the problem

1. Open **Open issues**, or follow a notification to its issue.
2. Use **Find an issue** to search by equipment name, entity ID or reported condition. **Sort issues** can put the newest or longest-open problems first.
3. Expand the relevant group, then select **View** beside the device name. Its findings open together, even when only some entities are unavailable or a different condition needs attention. An entity without a device opens its own issue. Repairs, broken automations and wider integration issues retain their own views.
4. Read the reported conditions and affected sources. Relevant evidence appears directly, including earlier recorded sources when they add context.
5. Select **Open device** to inspect the equipment in Home Assistant. Individual entity issues and other issue types offer their relevant Home Assistant destination.
6. Under **Policies:**, select a named policy to inspect its full scope and settings. Under **Notifications:**, select a named notification to inspect its timing and delivery methods. Select **Back to issue** to return.

The issue should identify what Home Assistant reported and where to investigate. Homeostatic does not repair the equipment. If an unavailable feature is normal for that equipment, [change its availability monitoring](policies.md#stop-availability-monitoring).

Policies lists every policy covering the entity, including checks that use it to assess a device. Notifications lists the saved assignments from those policies, with shared notifications shown once. A **Custom notification** opens its owning policy. The dialog also identifies absent assignments, disabled sending or unconfigured delivery. Opening an editor sends no notification.

Unavailable devices have independent issues while their integration is working. An integration failure can affect several devices; opening that integration issue shows its complete scope. The text beside acknowledgment and notification-pause controls explains their full scope before you act. Checks waiting for current information appear directly beneath their device. A previously reported problem stays visible when current information is missing, until recovery is confirmed.

## Respond to a device's issues together

1. Select **View** beside the device in **Open issues**, or open the device in **Monitoring** and select its **View** button. Both open the same current device issues, including entity problems and other conditions. A separate device availability issue is not required.
2. All shown issues start selected. Uncheck any issue you want to handle differently, or use **All issues** to select or clear the list.
3. Select **Acknowledge selected** to acknowledge those issues, or **Pause notifications…** and choose when the pause should end. Review each issue's resulting state; an operation can succeed for some issues and fail for others.

If only one current issue belongs to the device, its condition appears above **Acknowledge issue** and **Pause notifications…**, without selection boxes. Selecting an acknowledgment button in this view applies the action without another confirmation. New issues that arrive while the view is open are not added to your selection automatically. An action already under way keeps the issues you submitted, and later issues do not inherit it.

**Stop Monitoring** is a separate coverage change. Its confirmation shows the exact affected entities; the issue checkboxes do not set that scope. Availability checks stop for those entities, while other condition checks continue. Use the policy buttons in the issue dialog to inspect or change a policy.

## Acknowledge an issue

1. Follow an exact issue link, such as a notification, or open an entity without a device and select **Acknowledge issue…**.
2. Check the named issue, then select **Acknowledge issue** to confirm.
3. Return to the issue to see its acknowledgment time.

An exact issue link keeps its original scope, including when the entity has a device. It does not automatically select the device's other issues. Acknowledgment records that someone has seen the issue for everyone receiving its notifications. It stops reminders that require acknowledgment. The issue remains open, and it can still appear in scheduled summaries. Dismissing a phone notification does not acknowledge it; see [notification actions](notifications.md) for phone behavior.

## Pause an issue's notifications

1. Open the issue and select **Pause notifications…**.
2. Choose an **End date and time** in the range shown. Use **More options** to add a reason if useful.
3. Select **Pause notifications**.
4. Check that the saved control shows **Notifications paused** and the intended expiry.

The pause holds new notifications for the issue for everyone, including urgent notifications and reminders. When responding to several selected device issues, it applies separately to each selected issue. Other issues can still notify. Monitoring continues, each issue stays open until its condition clears, and an existing phone message is not dismissed by the pause.

An existing pause can be extended. To end it early, open the issue, select **Resume notifications…**, and confirm with **Resume notifications**. Due notifications may become eligible immediately; another overlapping pause can still apply.

## Follow recovery

When the condition recovers, Homeostatic ends the issue according to that monitoring type's recovery rules. Availability checks wait for recovery confirmation. During that wait, the availability issue leaves **Open issues**, while its source in **Monitoring** retains the pending result.

A missing reading can also remove an availability entry from **Open issues** without establishing recovery. If an issue disappears unexpectedly, inspect its source in **Monitoring**, then check [History](history.md). **Cleared**, **Monitoring ended**, **Joined another problem** and **Issues separated** record different outcomes. When an issue separates, its continuing issues retain any existing acknowledgment and notification pause. Each pause can then be ended independently.

If an action fails or its result is uncertain, read the message and inspect the current acknowledgment or active controls before retrying. [Troubleshooting](../troubleshooting.md) covers connection and saving problems.
