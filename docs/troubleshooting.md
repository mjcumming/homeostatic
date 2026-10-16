# Troubleshooting

[Homeostatic manual](guide.md)

Start with the symptom below. Home Assistant's **Settings → System → Logs** is useful for setup, storage and delivery errors; search for `homeostatic`. For the boundaries of supported monitoring, see [What Homeostatic cannot establish](manual/limitations.md).

## Setup fails or the panel says unavailable

If Homeostatic is missing from **Add integration**, check that `<config>/custom_components/homeostatic/manifest.json` exists without an extra enclosing directory. Confirm the [requirements](install.md#before-you-start), restart Home Assistant and refresh the browser.

If setup reports that Homeostatic is already configured, open its sidebar panel. One installation uses one Homeostatic integration; monitoring and notification choices are edited in that panel.

If the integration fails to load, read the log:

| Finding | Next step |
| --- | --- |
| A requirements error names `health-tree` | Restore internet access for dependency installation, then restart Home Assistant. |
| Invalid configuration or saved data | Check the release's upgrade notes and [rollback instructions](manual/maintain-installation.md#roll-back). An older version may need its matching saved data restored. Do not delete settings as a troubleshooting shortcut. |
| Storage errors, such as a full disk | Correct the storage problem, then reload Homeostatic. Restore a matching backup if its saved data is damaged. |

If the integration is loaded but the panel is unavailable, check the message:

| Panel condition | Next step |
| --- | --- |
| Homeostatic is starting or reloading | Let startup finish. The panel should update when monitoring becomes available. |
| Connection lost | Check the Home Assistant connection. Reconnect before trying to change settings. |
| Administrator access required | Sign in with an administrator account. Homeostatic cards have the same requirement. |
| Homeostatic reported an error | Read the Home Assistant log and any Homeostatic storage/configuration notification. |
| Dashboard and integration out of sync | Follow the upgrade checks below. |

While the panel lacks current data, retained content is not evidence that monitoring is current. Loading or failed catalog retrieval is also different from an empty list of sources.

## Old screens after an upgrade

1. Confirm the installed version in HACS, or in the installed `manifest.json` after a manual installation.
2. Restart Home Assistant after downloading an update.
3. Refresh the browser with its cache bypassed. In the Companion app, reopen the app and use its frontend-cache reset if necessary.
4. For a manual installation, confirm that the old component directory was replaced completely. Follow [Upgrade](manual/maintain-installation.md#upgrade) if older files remain.

Let Home Assistant finish restarting before judging an out-of-sync message. Save or discard pending edits before deliberately reloading the page.

## No notifications arriving

Follow the saved configuration from the issue to its destination:

1. Open the affected issue and its policy. Confirm that monitoring is enabled and the policy covers the source.
2. Inspect **Notifications** in the policy. **No notifications** means the policy is intentionally dashboard-only.
3. Open the assigned named notification. Check its timing, days, time zone and **Send using** methods. An assignment without a method cannot request delivery.
4. Open the method. Check the destination and any presence rule, including its fallback or skip choice. Save changes in each editor separately.
5. Confirm that the global **Notifications** switch is on. Check whether the issue has paused notifications or has already been acknowledged under a reminder schedule.
6. Reopen the saved, unchanged delivery method and select **Send test**. Check the destination separately from the request result.

A scheduled summary sends at its next occurrence and includes eligible open problems. A daily-hours window holds requests outside its hours; a problem that ends before the next opening produces no delayed message. Acknowledgment stops acknowledgment-dependent reminders, while eligible open problems can still appear in summaries.

If the test arrives but ordinary notifications do not, concentrate on the policy assignment, timing and issue controls. If the test does not arrive, check Home Assistant's delivery provider, logs and destination permissions. For a phone, check the app's signed-in user, its person association under **Settings → People**, and notification permission. [Set up and change notifications](manual/notifications.md) owns the full procedure.

## Too many issues or messages

Use **Open issues** to inspect the actual reported condition before changing anything. If an entity is not expected to remain available, [remove that availability selection](manual/policies.md) or narrow the contributing policy. Ending monitoring records that outcome without claiming the equipment recovered.

Overlapping policies are independent. Inspect their names and settings before deleting an apparent duplicate; two temperature thresholds or notification choices may be intentional.

If the issues are useful but the messages are too frequent, change the named notification or its policy assignment. Inspect the shared uses before saving a named notification. Use [Pause notifications](manual/issues.md) for an existing issue or [maintenance](manual/maintenance.md) for planned equipment work.

## Expected equipment or a check is missing

1. Clear Monitoring search and filters, and include disabled sources if appropriate.
2. Open **Policies** and inspect whether the relevant policy is enabled and its sources are selected.
3. Check exclusions and the monitoring type. Availability's broad selections omit diagnostic and configuration entities; exact individual selection is available where supported. Disabled sources remain ineligible.
4. For a battery, UPS or temperature check, compare the available HA evidence with the [monitoring reference](manual/monitoring-reference.md). Missing required inputs can prevent a check from becoming useful.

**Open issues** lists current reported problems. Missing availability evidence and recovery confirmation can remain visible in Monitoring without appearing there. [How issues work](how-it-works.md) explains that distinction.

## A device shows unavailable but works

Open the device in Home Assistant and compare the relevant entities with Homeostatic's selected evidence. Some devices make an unused feature unavailable in standby or another operating mode. Select the entities whose availability you actually expect.

A device assessment and an individual policy can cover different members because of exclusions. A working member may keep the device's overall availability assessment clear while an unavailable entity still has its own issue. Current `off`, `idle` and `unknown` values count as available for availability checks; they do not necessarily supply a usable reading for a temperature or battery check.

## A save failed or its result is uncertain

Keep the editor open and read the message. Validation errors identify the fields to correct. A conflict means saved settings changed while the draft was being edited. Review the current saved values before applying the intended change again.

If the connection was lost during a save, reconnect and keep the draft. Open Homeostatic in a separate browser tab to inspect freshly loaded saved settings, then compare those with the original draft before making another change. Reopening an editor in the original tab can restore its draft and does not establish what was saved. Contextual availability changes offer **Refresh saved monitoring** when their result needs checking. Confirmed saves finish quietly; a persistent success banner is not required. Other editors can still contain unsaved changes.

Navigation retains drafts within the same browser tab and administrator session. Reloading the page, closing the tab or changing the signed-in user ends that draft session.

## A phone tap does not open the issue

Single-issue notifications open the issue, or its retained History entry after it ends. Device messages and summaries open **Open issues**. Tests open **Notifications**. An expired History link can no longer show the original record.

Check that the Companion app is connected to the server that sent the message and that its current user has administrator access. Tapping the message opens context; the separate **Acknowledge** action records awareness. A device message's acknowledgment applies to the issues included in that message.

<a id="known-limitations"></a>

## Supported scope

See [What Homeostatic cannot establish](manual/limitations.md) for detection, access, history and delivery boundaries. Automation-defined alerts are unfinished and have no supported setup procedure in this manual.
