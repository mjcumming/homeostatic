# Review and respond to an issue

[Homeostatic manual](../guide.md)

Use **Open issues** to investigate a reported problem and decide what to do about it. Sign in with a Home Assistant administrator account to use the panel and its controls.

## Inspect the problem

1. Open **Open issues**, or follow a notification to its issue.
2. Use **Find an issue** to search by equipment name, entity ID or reported condition. **Sort issues** can put the newest or longest-open problems first.
3. Expand the relevant group, then select the finding beneath the device name. Repairs and broken automations have their own groups. A group heading helps you find problems; open a finding to act on a particular issue.
4. Read the reported condition, opening time and affected sources. Expand **Details** or the affected-entity list when more information is needed. A shared issue can involve several devices, so check its scope before using a control.
5. Follow the relevant Home Assistant link to inspect the equipment, integration, Repair or automation. Links to **Monitoring** show the source's current readings and the policies that watch it.

The issue should identify what Home Assistant reported and where to investigate. Homeostatic does not repair the equipment. If an unavailable feature is normal for that equipment, [change its availability monitoring](policies.md#remove-unwanted-availability-monitoring).

![An opened MQTT Kitchen issue showing its reported condition, related equipment and issue actions](../images/manual-issue-detail.png)

An example issue shows the reported condition and the actions that apply to it.

## Acknowledge an issue

1. Open the issue and select **Acknowledge issue…**.
2. Check the named issue, then select **Acknowledge issue** to confirm.
3. Return to the issue to see its acknowledgment time.

Acknowledgment records that someone has seen the issue for everyone receiving its notifications. It stops reminders that require acknowledgment. The issue remains open, and it can still appear in scheduled summaries. Dismissing a phone notification does not acknowledge it; see [notification actions](notifications.md) for phone behavior.

## Pause an issue's notifications

1. Open the issue and select **Pause notifications…**.
2. Choose an **End date and time** in the range shown. Use **More options** to add a reason if useful.
3. Select **Pause notifications**.
4. Check that the saved control shows **Notifications paused** and the intended expiry.

The pause holds new notifications for that issue for everyone, including urgent notifications and reminders. Other issues can still notify. Monitoring continues, the issue stays open until its condition clears, and an existing phone message is not dismissed by the pause.

An existing pause can be extended. To end it early, open the issue, select **Resume notifications…**, and confirm with **Resume notifications**. Due notifications may become eligible immediately; another overlapping pause can still apply.

For planned work that may create new problems, use [Working on this equipment](maintenance.md).

## Follow recovery

When the condition recovers, Homeostatic ends the issue according to that monitoring type's recovery rules. Availability checks wait for recovery confirmation. During that wait, the availability issue leaves **Open issues**, while its source in **Monitoring** retains the pending result.

A missing reading can also remove an availability entry from **Open issues** without establishing recovery. If an issue disappears unexpectedly, inspect its source in **Monitoring**, then check [History](history.md). **Cleared**, **Monitoring ended** and **Joined another problem** record different outcomes.

If an action fails or its result is uncertain, read the message and inspect the current acknowledgment or active controls before retrying. [Troubleshooting](../troubleshooting.md) covers connection and saving problems.
