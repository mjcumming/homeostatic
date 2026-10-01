# Troubleshooting

Each section starts from something you can see, lists the likely causes, and says what to check. The [known limitations](#known-limitations) at the end cover what Homeostatic can't do at all.

Many checks start in the Home Assistant log. Go to **Settings → System → Logs** and search for `homeostatic`.

## Setup fails or the panel says unavailable

Homeostatic isn't in the **Add integration** list:

- The files are in the wrong place. You should have `<config>/custom_components/homeostatic/manifest.json`, with no extra folder level in between.
- Home Assistant hasn't restarted since you installed the files. Restart it, then refresh the browser, because the integration list is cached.
- Home Assistant is older than 2026.9.3. Update it first.

Adding it says "Homeostatic is already configured": there can only be one Homeostatic per Home Assistant. Open **Homeostatic** in the sidebar to change monitoring, timing or notifications.

The Homeostatic card under **Settings → Devices & services** says it failed to set up:

- The first load couldn't install the health-tree library. Look in the log for a requirements error that names `health-tree`. Home Assistant needs internet access the first time Homeostatic loads. Fix the connection and restart.
- The log says "Invalid Homeostatic configuration or snapshot", followed by the reason. This usually means the saved data doesn't match the installed version, for example after rolling back to an older version without restoring the matching backup. Restore the backup you took before the upgrade, as described in [Upgrade and roll back](install.md#7-upgrade-and-roll-back).

The panel shows a message instead of your pages:

| Message | What it means and what to do |
| --- | --- |
| Loading dashboard | The panel is receiving the latest state. It clears within a few seconds. |
| Monitoring unavailable, saying Homeostatic is starting or has been unloaded | Normal while Home Assistant starts, because Homeostatic begins monitoring only once Home Assistant has finished starting. The page updates on its own. If it stays, check under **Settings → Devices & services** that Homeostatic is loaded and not disabled. |
| Monitoring unavailable, saying Homeostatic reported an error | Home Assistant also shows a notification: "Homeostatic cannot provide current health. Check its configuration, storage, and logs." Look in the log for "Homeostatic refresh failed". If the cause is storage, such as a full disk, fix it, then reload Homeostatic from its menu (⋮) under **Settings → Devices & services**. If the saved data is damaged, restore a backup. |
| Connection lost | The browser lost its connection to Home Assistant. It reconnects on its own. |
| Administrator access is required for the installation-wide dashboard | You're signed in as a user who isn't an administrator. The panel and the Homeostatic cards are for administrators only. |
| The Homeostatic dashboard and integration are out of sync | See the next section. |

## Old screens after an upgrade

The panel looks the same as before the upgrade, is missing something the release notes describe, or says "The Homeostatic dashboard and integration are out of sync":

- Home Assistant hasn't restarted since the update. HACS downloads the new version, but it only runs after a restart.
- The browser is still showing the old panel. Reload the page, bypassing the cache (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). In the Companion app, close the app completely and reopen it. If that doesn't help, use the app's option to reset its frontend cache.
- A manual install was copied over the old folder, leaving old files behind. Delete `<config>/custom_components/homeostatic`, copy in the new folder from the zip and restart.
- The installed version isn't the one you expect. HACS shows the installed version. For a manual install, open `<config>/custom_components/homeostatic/manifest.json` and check `version`.

If Home Assistant is still restarting when you see the out-of-sync message, let it finish and refresh the page.

## No notifications arriving

Start with the issue you expected to hear about. Its card on **Issues** has a reporting line that tells you where it stands:

| Reporting line | What it means and what to do |
| --- | --- |
| Reporting off | Notifications aren't turned on. Open **Notifications**, tick **Enable notification requests** under **Outgoing requests**, then select **Review changes** and **Save settings**. Overview says **Reporting is on** once it's saved. |
| Dashboard only | The source's reporting choice is **Dashboard only**, or the choice it uses has nobody under **Recipients**. Without recipients, a reporting choice behaves like **Dashboard only**. |
| Weekly summary, Morning summary or Evening summary | The issue is waiting for that report. New sources start on **Weekly summary**, which is sent on Sunday at 9:00. To hear sooner, open the source in **Sources**, go to **Settings** and change **Source preference**. |
| Notification requested | Homeostatic handed the message to the phone's notify action. Look at the phone side, below. |
| Acknowledged · problem remains open | Someone acknowledged it, which stops the repeats for **Immediate with acknowledgment**. |

If Overview says **Reporting needs attention**, a destination is missing or a request failed. Open **Notifications**. Under **People and destinations**, a phone marked as unavailable can't receive anything, and **Recent delivery request failures** lists the errors Home Assistant returned.

Your phone isn't offered under **People and destinations**, or is marked as unavailable:

- Your Home Assistant user isn't linked to a person. Check under **Settings → People**.
- The Companion app on that phone is signed in as a different user. Each person is offered only their own phones.
- A phone marked as unavailable has a Companion app registration that can't receive push notifications. Check that notifications are allowed for the app, and sign out of the app and back in if that doesn't help.

Select **Send test** beside the phone. If the test arrives but real notifications don't, the cause is in the reporting choices above. If the test fails or never arrives, the cause is the phone or the Companion app:

- Notifications for the Companion app are turned off in the phone's settings.
- On Android, Immediate notifications use their own notification channel, *Homeostatic urgent*, which may be muted in the app's notification settings.

Other reasons you hear nothing:

- Someone used **Pause alerts** on the issue. The issue shows when the pause ends.
- Someone started **Working on this equipment**, so no new issues open for that equipment until it ends. The source shows the end time.
- Home Assistant restarted recently. Notifications wait until your integrations have finished loading, up to ten minutes, then arrive as one summary.
- The issue ended before its summary was due. Summaries include only issues that are still open, and an empty summary isn't sent.
- The destination is a notify entity rather than a Companion phone. Those get new notifications and reminders, but no updates to earlier messages and no notice when an issue ends.

## Too many issues

A new install watches only your integrations. A long list of issues usually comes from watching more than you need:

- An integration you don't care about keeps failing or retrying, such as one for a TV that's switched off at the wall. Open it in **Sources**, go to **Settings** and turn off **Allow monitoring for this integration**.
- An entity is watched separately and also as part of its device, so one failure gives two issues. Keep one of them: choose **Follow device monitoring** in the entity's **Settings**.
- An entity is unavailable for a normal reason, such as a feature that only exists in some modes. Open the issue and use **Ignore availability…** beside that entity under **Monitoring choices**, or **Ignore this availability check…** on the entity's own issue.
- A source you chose by hand no longer exists in Home Assistant, so it has had no reading for 15 minutes. Remove its monitoring choice in **Sources**.
- You used **Monitor all batteries**, and it found many low batteries at once. Each one stays open until its reading rises above 20% or it reports charging.

Three or more watched devices or entities on the same integration that fail within a minute are grouped into one issue. To group more readily, lower **Group related problems** or widen **Grouping window** under **Settings → Problem grouping**. [How it works](how-it-works.md#how-one-failure-becomes-one-issue) explains which failures group and which don't.

If the issues are right but the notifications are too many, change the reporting choices instead. Summaries and **Dashboard only** keep issues visible without sending each one, and **Pause alerts** quiets a single issue for up to a week. The [user guide](guide.md#operator-controls) covers the controls.

## An alert stuck on unknown

An alert reads unknown when its automation reports that it can't evaluate the condition, or when its reports stop. Open the alert's automation under **Settings → Automations & scenes** and look at its traces to see which branch ran.

- An entity under **Required evidence** is unavailable, has no value, or still has the state Home Assistant restored at startup. Fix that entity, or remove it from **Required evidence** if the condition doesn't use it.
- The automation is turned off or was deleted. Reports stop, and after **Evidence expires after** (five minutes by default) the alert reads unknown. Turn the automation back on. If you meant to stop the alert, retire it as described in the [alert guide](automation-situations.md).
- A condition errors, for example comparing a temperature that isn't a number. The blueprint reports unknown when a condition can't be evaluated. Make the condition handle values that aren't numbers.
- Home Assistant restarted. The alert reads unknown until the automation reports again, which it does at startup and every minute after.
- You wrote the automation by hand, and it reports less often than its timeout. Report more often or lengthen the timeout.

An alert that was clear and stays unknown for 15 minutes opens an issue saying its reading is out of date. An alert that was active stays open while it's unknown, and only a clear report ends it.

If the alert doesn't appear in Homeostatic at all, its automation's call to Homeostatic is failing. The trace shows the error:

- "Configure shared reporting profiles in Homeostatic Notifications first": the alert uses a reporting choice other than **Dashboard only**, and the notification setup hasn't been saved yet. Save it under **Notifications**, or use **Dashboard only**.
- "Choose a saved HA automation with a stable ID": the automation has no ID. Automations made in the editor always have one. Add an `id` to an automation written in YAML.
- "This alert is retired; explicitly resume it before reporting": the alert was retired. Resume it as described in the [alert guide](automation-situations.md).

## A phone tap doesn't open the issue

Tapping a single-issue notification opens that issue in the panel. Some notifications open somewhere else by design: summaries open **Issues**, and test notifications open **Notifications**. If the issue has ended, the tap opens its entry in **History**, and if that has expired too, the page says so.

When a tap doesn't get there:

- The person who tapped isn't a Home Assistant administrator. The panel is for administrators only. Anyone the notification was sent to can still use its **Acknowledge** button.
- The Companion app isn't currently signed in to the Home Assistant server that sent the notification. The link points at a page on that server.
- The notification came from your own automation instead of Homeostatic's built-in sender. The Companion notifications blueprint includes the link. An automation you wrote yourself has to set it, as `url` for iPhone and `clickAction` for Android.

The **Acknowledge** button appears only on notifications about a single open issue sent by Homeostatic itself. Summaries, notices that an issue has ended and test notifications don't have one.

## A device shows unavailable but works

Homeostatic shows what Home Assistant reports. First check the device in Home Assistant under **Settings → Devices & services**. If Home Assistant shows the same entities as unavailable, the cause is in the integration or the device, and Homeostatic is passing it on.

If the device works but one of its entities is unavailable:

- Some integrations make an entity unavailable when a feature isn't in use, such as a receiver's second zone while it's in standby. The device's issue names the entity. Use **Ignore availability…** for it, or choose **Exclude this entity** in its **Settings** in **Sources**. Home Assistant's state for the entity doesn't change.
- Battery devices that sleep can show as unavailable between check-ins, depending on the integration. Exclude the entities that do this.
- An enabled connectivity sensor on the device reports *off*, for example a cloud-connection sensor while the device works locally. Homeostatic treats that as the device reporting itself disconnected. Excluding the sensor stops the issue. The device's availability in **Sources** still reads unavailable, because it uses every enabled entity, so disable the sensor in Home Assistant if you don't need it.

The opposite also happens: a device's availability reads **Available** while its issue stays open. One working entity is enough for Home Assistant to call a device available, while the issue tracks every entity you chose to watch. The issue explains this under **Why does Home Assistant say Available?**

The [user guide](guide.md#what-an-availability-problem-means) explains what an availability problem means in detail.

## Known limitations

- Homeostatic only knows what Home Assistant reports. Home Assistant reporting a sensor available doesn't prove the reading is fresh or that a command worked, and Homeostatic can't tell whether a detector has stopped processing. Checks for these are on the [roadmap](roadmap.md).
- It can't tell you Home Assistant itself has stopped, because it runs inside Home Assistant. You need a monitor outside Home Assistant for that.
- A notification request isn't proof of delivery. Homeostatic hands each message to Home Assistant's notify action, which can't confirm the phone received it, and some delivery errors appear only in the Home Assistant log.
- When an integration fails, everything watched on it is grouped under its issue, including a device that happens to have a fault of its own at the same moment. Check anything still failing once the integration recovers.
- Automation failures come only from Home Assistant's Repairs: validation errors and missing actions. An automation that never runs, or an error that appears only in its trace, doesn't show up in Homeostatic.
- A device's availability never reads **Partially available**. Home Assistant doesn't yet let integrations report device availability directly, so Homeostatic works it out from entity states.
- A light or binary sensor group can stay available while some of its members are unavailable. Watch the members that matter directly.
- The low-battery level is fixed at 20%. Homeostatic can't tell whether a battery was replaced or recharged, and doesn't know what type of battery a device takes.
- Alerts describe continuing conditions. A one-off event, like a doorbell press, doesn't fit unless something in Home Assistant holds it as a state. Homeostatic can't check that **Required evidence** lists every entity your condition uses.
- The panel and cards are for administrators only. Other people can receive notifications and tap **Acknowledge**, but can't open the panel.
- Notifications can't go to whoever is home, be spoken on a speaker, or be snoozed from the phone.
- Homeostatic never fixes anything itself. It doesn't retry integrations, turn anything back on or send commands to devices. It shows automation failures that Home Assistant reports in Repairs; its own issues stay in Homeostatic.
- The History page keeps up to 100 ended issues from the last 30 days. Its times are when Homeostatic saw a change, so after Home Assistant has been down, an end time can be later than the actual recovery.
- Timings apply to the whole installation. You can't give one source a different wait.
- Watching every entity on a very large install (6,000 or more) is still too slow. Start with your integrations and the devices that matter.
