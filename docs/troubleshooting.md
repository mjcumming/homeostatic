# Troubleshooting

Home Assistant's log, under **Settings → System → Logs**, shows setup, storage and delivery errors; search it for `homeostatic`.

## Setup fails or the panel says unavailable

| You see | Do this |
| --- | --- |
| Homeostatic isn't in **Add integration** | Check that `<config>/custom_components/homeostatic/manifest.json` exists, restart Home Assistant and refresh the browser. |
| The log mentions `health-tree` | Home Assistant couldn't download the library Homeostatic uses. Restore internet access and restart. |
| The panel says Homeostatic is starting or reloading | Wait. The panel updates when monitoring is ready. |
| The panel asks for an administrator | Sign in with an administrator account. Cards need one too. |
| A storage or configuration error | Fix the cause, such as a full disk, and reload Homeostatic. Restore your backup if the saved data is damaged. |

## Old screens after an update

Restart Home Assistant after updating, then refresh the browser with its cache bypassed. In the Companion app, reopen the app or reset its frontend cache. For a manual install, check that you replaced the whole `custom_components/homeostatic` folder.

## No notifications

Follow the chain from the issue to your phone:

1. Open the issue. **Notifications:** shows the named notifications that cover it, or **None assigned** if its policy has none.
2. Open the named notification and check that **Send using** has a delivery method. Immediate waits for its collection delay, daily hours wait for the start time, and a summary waits for its scheduled time.
3. Check that the **Notifications** switch is on, and that the issue isn't paused, or already acknowledged under a reminder schedule.
4. Open the delivery method and select **Send test**. If the test doesn't arrive, check the destination itself. For a phone, check the Companion app's sign-in, its person under **Settings → People**, and its notification permission.

## Too many issues or notifications

If an entity is often unavailable and you don't care, use **Stop monitoring…** in its issue. If the issues are useful but the notifications aren't, change the policy's notifications, or move the entity from Important equipment availability to General entity availability so it waits for the morning summary. A longer collection delay bundles more of a burst into one message.

Policies can overlap on purpose, so look at every policy watching something before you delete one that seems to be a duplicate.

## Something isn't monitored

Clear the search and filters in **Monitoring**, and turn on **More filters → Include disabled sources** if you need to. Then check the policy: it must be enabled, its selection must include the source, and the source mustn't be excluded. Availability policies skip anything disabled in Home Assistant, and skip diagnostic and configuration entities unless you pick them individually.

## An entity shows unavailable but the device works

Some devices make a feature unavailable while it isn't in use, for example in standby. Compare the device's entities in Home Assistant with the ones Homeostatic monitors, and stop monitoring the ones you don't expect to stay available.

## A save failed

The editor keeps your changes and says what went wrong. If someone else saved first, look at the current settings and make your change again. If storing the settings failed, the panel says **Could not save settings; monitoring is reloading from the last saved state** and Homeostatic reloads with the settings it last saved. When it's back, check the settings and save again.

## A phone tap doesn't open the issue

Check that the Companion app is signed in to this Home Assistant with an administrator account. A notification about an issue that has since ended opens its History entry, until History no longer keeps it.

## What Homeostatic can't tell you

- Whether a reading is fresh or a command worked. An available entity means Home Assistant's connection to it is working, nothing more.
- Smoke, carbon monoxide, gas, water, tampering, a jammed lock or a triggered alarm. Important equipment availability only checks that Home Assistant can reach those devices, so use Home Assistant automations for the conditions themselves.
- That Home Assistant itself has stopped. Homeostatic runs inside it, so you need something outside Home Assistant for that.
- Whether anyone received a notification. Homeostatic hands requests to Home Assistant, which may log delivery errors.
- Every automation fault. The broken-automation check finds entity IDs that don't exist; it doesn't read templates or scripts, or tell you whether an automation ran.
- Problems from before Homeostatic was installed, or older than History keeps.

Homeostatic doesn't repair anything, retry integrations or operate devices. People without an administrator account can receive notifications and use the phone **Acknowledge** button, but can't open the panel.
