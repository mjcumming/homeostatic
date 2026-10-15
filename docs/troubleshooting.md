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
- The log says "Invalid Homeostatic configuration or snapshot", followed by the reason. This usually means the saved data doesn't match the installed version, for example after rolling back to an older version without restoring the matching backup. Restore the backup you took before the upgrade, as described in [Upgrade and roll back](install.md#7-upgrade-and-roll-back). Unsupported pre-policy test settings are not converted or reset. Supported unified policies and Custom notification assignments remain preserved; use a fresh test setup only for the earlier model transition.

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

Start with the affected policy in **Policies**. Fresh setup selects named notifications without delivery methods, and global sending is off.

1. Confirm the policy is enabled and matches the source. Check that an issue is open.
2. Inspect its **Notifications** assignment. Open that named notification in **Notifications** to check its timing and **Send using** methods. No method means it is unconfigured; no policy assignment means **Dashboard only**.
3. Check the time, weekdays and displayed time zone for a summary, or the start and end of a daily-hours window. Reports include open problems at their scheduled time; a closed window holds requests until its next opening. Acknowledgment stops acknowledgment reminders, but an open issue remains eligible for a summary.
4. Check that the **Notifications** switch near the top of the panel is on. It applies immediately; save policy, notification and method edits in their respective editors.
5. Check the selected delivery method's destinations and presence settings. Presence-based methods may select fallback destinations or skip when nobody qualifies. Inspect recent request failures and unavailable targets.

For a Companion app phone, check the Home Assistant user-to-person link under **Settings → People**, the account signed in to the app and the app's notification permission. An unavailable phone registration cannot receive requests.

Save the method, then select **Send test** in its editor. A test request works while normal sending is off. If it arrives but policy notifications do not, check timing, pauses, acknowledgment and policy scope. If it never arrives, inspect the provider and Home Assistant logs. A successful request cannot confirm receipt on the phone.

## Too many issues

Fresh setup enables integration, device and entity availability policies, Repairs and broken automations. Open **Policies** to see which policies select the sources producing issues. You can narrow a policy's source selection or disable it, then select **Save policy**.

An entity can be unavailable because its current device mode does not support it. Inspect its readings before deciding to monitor it. A device availability check uses selected operational entities and opens a device issue when they are all unavailable. Current off and unknown values remain available.

Overlapping policies operate independently. If two policies intentionally select the same source, inspect their names and detection settings. Disable or delete the one you no longer want. A battery policy may find many low batteries at once; each follows that policy's threshold and the reported low/charging evidence.

Three or more watched devices or entities on the same integration that fail within a minute can be grouped into one issue. The count and time window are under **Settings → Problem grouping**. [How it works](how-it-works.md#how-one-failure-becomes-one-issue) explains grouping.

If the issues are useful but the notifications are too frequent, change the policy's notification entries. Scheduled summaries and dashboard-only monitoring keep issues visible. **Pause notifications** quiets an issue temporarily; the [user guide](guide.md#operator-controls) explains the controls.

## An alert stuck on unknown

An alert reads unknown when its automation reports that it can't evaluate the condition, or when its reports stop. Open the alert's automation under **Settings → Automations & scenes** and look at its traces to see which branch ran.

- An entity under **Required evidence** is unavailable, has no value, or still has the state Home Assistant restored at startup. Fix that entity, or remove it from **Required evidence** if the condition doesn't use it.
- The automation is turned off or was deleted. Reports stop, and after **Evidence expires after** (five minutes by default) the alert reads unknown. Turn the automation back on. If you meant to stop the alert, retire it as described in the [alert guide](automation-situations.md).
- A condition errors, for example comparing a temperature that isn't a number. The blueprint reports unknown when a condition can't be evaluated. Make the condition handle values that aren't numbers.
- Home Assistant restarted. The alert reads unknown until the automation reports again, which it does at startup and every minute after.
- You wrote the automation by hand, and it reports less often than its timeout. Report more often or lengthen the timeout.

An alert that was clear and stays unknown for 15 minutes opens an issue saying its reading is out of date. An alert that was active stays open while it's unknown, and only a clear report ends it.

If the alert doesn't appear in Homeostatic at all, its automation's call to Homeostatic is failing. The trace shows the error:

- "Configure shared reporting profiles in Homeostatic Notifications first": the alert requests an automation reporting profile that has not been configured. The current method editor does not create these profiles. Use **Dashboard only** while configuring the automation reporting contract described in the [alert guide](automation-situations.md).
- "Choose a saved HA automation with a stable ID": the automation has no ID. Automations made in the editor always have one. Add an `id` to an automation written in YAML.
- "This alert is retired; explicitly resume it before reporting": the alert was retired. Resume it as described in the [alert guide](automation-situations.md).

## A phone tap doesn't open the issue

Tapping a single-issue notification opens that issue in the panel. Some notifications open somewhere else by design: summaries open **Issues**, and test notifications open **Notifications**. If the issue has ended, the tap opens its entry in **History**, and if that has expired too, the page says so.

When a tap doesn't get there:

- The person who tapped isn't a Home Assistant administrator. The panel is for administrators only. Anyone the notification was sent to can still use its **Acknowledge** button.
- The Companion app isn't currently signed in to the Home Assistant server that sent the notification. The link points at a page on that server.
- The notification came from your own automation instead of Homeostatic's built-in sender. The Companion notifications blueprint includes the link. An automation you wrote yourself has to set it, as `url` for iPhone and `clickAction` for Android.

The **Acknowledge** button appears on issue notifications sent by Homeostatic itself. For a combined device message, it acknowledges the exact issues shown when that message was sent; a later failure still needs attention. Scheduled summaries, notices that issues have ended and test notifications don't have one.

## A device shows unavailable but works

Homeostatic shows what Home Assistant reports. First check the device in Home Assistant under **Settings → Devices & services**. If Home Assistant shows the same entities as unavailable, the cause is in the integration or the device, and Homeostatic is passing it on.

If the device works but Homeostatic reports it unavailable:

- Some integrations make an entity unavailable when a feature isn't in use, such as a receiver's second zone while it's in standby. That opens a device issue only when every selected entity on the device does it. Review its contributing entity policy and narrow the selection if this entity is not expected to remain available. A passing device summary can coexist with that individual entity issue.
- Battery devices that sleep can show as unavailable between check-ins, depending on the integration. Exclude the entities that do this.

The device assessment in **Sources** uses enabled operational entities. Its scope can differ from a policy that excludes some of those entities. The policy's evidence and counts honor its selection, while an individually unavailable entity retains its own issue even when a sibling makes the device summary pass. Diagnostic and configuration entities do not supply automatic device availability, and a connectivity sensor's current off value does not create an availability failure.

The [user guide](guide.md#what-an-availability-problem-means) explains what an availability problem means in detail.

## Known limitations

- Homeostatic only knows what Home Assistant reports. Home Assistant reporting a sensor available doesn't prove the reading is fresh or that a command worked, and Homeostatic can't tell whether a detector has stopped processing. Checks for these are on the [roadmap](roadmap.md).
- It can't tell you Home Assistant itself has stopped, because it runs inside Home Assistant. You need a monitor outside Home Assistant for that.
- Some integrations mark a control unavailable when the device's current mode doesn't support it. Homeostatic can't tell that from lost contact.
- A device availability issue opens when every selected operational entity is unavailable. Individual entity monitoring covers a partial failure while siblings still report. Compatible device notifications combine those findings while each issue keeps its own recovery and controls.
- A notification request isn't proof of delivery. Homeostatic hands each message to Home Assistant's notify action, which can't confirm the phone received it, and some delivery errors appear only in the Home Assistant log.
- When an integration fails, everything watched on it is grouped under its issue, including a device that happens to have a fault of its own at the same moment. Check anything still failing once the integration recovers.
- An automation that names an entity that no longer exists opens an issue. An automation that never runs, or an error that appears only in its trace, doesn't show up in Homeostatic. An entity id written only inside a template is not seen, and scripts are not checked.
- Repairs and broken automations have their own policies and notification entries. Their policy editors offer only the source-selection options supported by those checks.
- A device's availability never reads **Partially available**. Home Assistant doesn't yet let integrations report device availability directly, so Homeostatic works it out from entity states.
- A light or binary sensor group can stay available while some of its members are unavailable. Watch the members that matter directly.
- Each battery policy has a configurable percentage threshold, initially 20%. Homeostatic cannot identify a battery replacement or tell you which replacement battery to buy.
- A vacuum issue follows the vacuum entity's error activity. A fault that never becomes that activity stays an alert you write yourself. The notice names the area Home Assistant has assigned to the vacuum, which is often the room where it docks.
- Alerts describe continuing conditions. A one-off event, like a doorbell press, doesn't fit unless something in Home Assistant holds it as a state. Homeostatic can't check that **Required evidence** lists every entity your condition uses.
- The panel and cards are for administrators only. Other people can receive notifications and tap **Acknowledge**, but can't open the panel.
- Delivery methods can select people currently home or use configured speakers. Phone snooze controls are not provided.
- Homeostatic never fixes anything itself. It doesn't retry integrations, turn anything back on or send commands to devices. It shows the Repairs Home Assistant raises, but fixing or ignoring them happens in Home Assistant.
- The History page keeps up to 100 ended issues from the last 30 days. Its times are when Homeostatic saw a change, so after Home Assistant has been down, an end time can be later than the actual recovery.
- Timings apply to the whole installation. You can't give one source a different wait.
- Watching every entity on a very large install (6,000 or more) is still too slow. Start with your integrations and the devices that matter.
