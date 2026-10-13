# Install and first run

This tutorial takes you from a fresh install to a working setup: Homeostatic watching one of your devices, one test alert, and a test notification on your phone. Set aside about half an hour. Each step builds on the one before, so follow them in order.

To test an unreleased change instead of a published release, use the [quick local test](development-workflows.md#quick-local-test).

## Before you start

You need:

- Home Assistant 2026.9.3 or newer, and an administrator account.
- Internet access the first time Homeostatic loads, so Home Assistant can install its [health-tree](https://pypi.org/project/health-tree/) library from PyPI.
- [HACS](https://hacs.xyz/), if you want to install that way.
- The Home Assistant Companion app on your phone, signed in as your own user, for step 6.

Take a backup first. Go to **Settings → System → Backups** and select **Back up now**. Homeostatic doesn't change your other integrations, but a backup gives you a clean way back.

## 1. Install Homeostatic

This guide describes the **1.8.0b1 testing prerelease** and its fresh-setup policy model. Use HACS or install by hand. Both end with the same files in the same place.

### With HACS

1. In HACS, open the menu (⋮) and choose **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with the type **Integration**.
3. Find **Homeostatic** and open its download options. Include beta/prerelease versions if needed, choose **1.8.0b1** explicitly and download it. If HACS does not offer this prerelease, use the manual download below.
4. Restart Home Assistant (**Settings → System**, then the power button at the top right).

### By hand

You'll need access to your Home Assistant config folder, through the Samba share, SSH or a file editor add-on.

1. From the [1.8.0b1 prerelease](https://github.com/mjcumming/homeostatic/releases/tag/v1.8.0b1), download `homeostatic-1.8.0b1.zip` and `homeostatic-1.8.0b1.zip.sha256` into the same folder on your computer.
2. Check the download against its checksum before you unpack it. In that folder, run the command for your system:

   ```bash
   sha256sum -c homeostatic-1.8.0b1.zip.sha256        # Linux
   shasum -a 256 -c homeostatic-1.8.0b1.zip.sha256    # macOS
   ```

   Both should print `homeostatic-1.8.0b1.zip: OK`. On Windows, run `Get-FileHash .\homeostatic-1.8.0b1.zip -Algorithm SHA256` in PowerShell and compare the hash with the first value in the `.sha256` file. If the check fails, download the zip again and don't install it.
3. Unzip it. Copy its `custom_components/homeostatic` folder into your config folder, so you end up with `<config>/custom_components/homeostatic/manifest.json`. If an older copy is already there, delete that folder first. Copying over it leaves old files behind.
4. Optionally, copy the zip's `blueprints/automation/homeostatic` folder to `<config>/blueprints/automation/homeostatic`. Then you won't need to import the alert blueprint in step 5.
5. Restart Home Assistant.

The zip also holds `BUILD_INFO.json`, which records the version, the commit it was built from and a checksum for every file inside.

## 2. Add the integration

1. Go to **Settings → Devices & services → Add integration** and search for **Homeostatic**.
2. Select it. Homeostatic is added straight away, watching integration, device and entity availability, Home Assistant Repairs, and automations that name a missing entity, with notifications off. You'll turn notifications on from the panel in step 6.

Homeostatic appears in the sidebar. If it isn't in the integration list, or setup fails, see [Setup fails or the panel says unavailable](troubleshooting.md#setup-fails-or-the-panel-says-unavailable).

## 3. Look around the panel

Open **Homeostatic** in the sidebar. You land on **Overview**.

A new install enables supplied policies for integration, device and entity availability, Home Assistant Repairs, and automations that name a missing entity. An integration issue covers a failure to load, repeated setup retries or a need to sign in again. Batteries and vacuums start off; temperature, thermostat and UPS templates need configuration. Each policy starts with no notifications.

Homeostatic reads the current state straight away. Any integration that's failing shows up under **Open issues**. Select one to see what Home Assistant reported, what to try, and a link to the integration. You don't need to act on it now.

Overview also says **Reporting is off**. Issues appear in the panel, but nothing is sent anywhere until step 6.

Now open **Sources**. This lists every integration, device, entity, battery, and vacuum Home Assistant knows about, grouped by integration. The counts beside each name show how many devices it has and how many open issues. Open a source to inspect its readings and applicable policies. Use **Policies** to choose what to watch and when to notify.

## 4. Review a monitoring policy

Fresh setup already watches eligible devices through the supplied device availability policy. Pick a familiar device, such as a smart plug or lamp, and inspect its policy:

1. In **Sources**, search for the device and open it. Its details show availability and current entity readings.
2. Follow its applicable policy link, or open the device availability policy in **Policies**.
3. Review the name, **Monitoring type**, source selection and **Notifications**. The type is fixed; the other supported settings are editable.
4. Leave the source selection unchanged for this walkthrough. With no notification entries, the policy is **Dashboard only**.

To narrow what is watched, edit the policy's source selection, then select **Review changes** and save after checking the affected sources. Changes to detection or source selection start fresh monitoring for the new settings. Merely opening the policy changes nothing.

A device issue opens when every selected entity is unavailable, or a supported connectivity sensor reports disconnected. One unavailable entity can instead have its own issue under the separate entity availability policy. When availability returns, Homeostatic waits for the configured recovery interval before ending the issue. The [user guide](guide.md#choose-what-to-watch) explains source selection and overlapping policies.

## 5. Make a test alert

Alerts cover what's happening in the house, like water on the floor. You write the condition as an ordinary automation from the Homeostatic alert blueprint. For this test, the condition is a toggle you control.

1. Create the toggle. Go to **Settings → Devices & services → Helpers**, select **Create helper**, choose **Toggle** and name it *Homeostatic test*.
2. Import the blueprint, unless you copied it in step 1. Go to **Settings → Automations & scenes → Blueprints**, select **Import blueprint**, paste `https://github.com/mjcumming/homeostatic/blob/main/blueprints/automation/homeostatic/alert.yaml` and import it.
3. Open the **Homeostatic alert** blueprint and create an automation from it:

   | Field | Value |
   | --- | --- |
   | Alert name | Test alert |
   | Notification message | The Homeostatic test toggle is on. |
   | Reporting preference | Dashboard only |
   | Required evidence | Homeostatic test (the entities the condition reads) |
   | Active when | A state condition: *Homeostatic test* is *On* |

4. Save the automation as *Homeostatic test alert*.

Use **Dashboard only** for this test. Automation reporting preferences use a separate reporting-profile contract; policy notification entries do not configure them. See [Alerts from automations](automation-situations.md) before enabling automation-owned delivery.

Turn the *Homeostatic test* toggle on. Within a few seconds, **Issues** shows *Test alert* with your message, and its reporting line says **Dashboard only**. The alert also appears in **Sources**, with a link to its automation.

Homeostatic reloads whenever you save a change in its panel, but that reload adds no startup wait. If the issue doesn't appear, check that the toggle and automation are on.

Turn the toggle off. The issue ends straight away, and **History** lists it as **Cleared**.

When finished, delete the test automation and helper. Homeostatic removes the alert after Home Assistant removes its automation entity.

## 6. Turn on notifications

Create a reusable delivery method, then choose when a policy uses it. For a Companion app phone, link your Home Assistant user to a person under **Settings → People** and sign in to the app as that user.

1. Open **Notifications**, select **Add delivery method**, give it a name and select a destination. Start with fixed destinations.
2. Review and save the method. Select **Preview delivery method**, inspect the targets, then explicitly request a test. The result confirms a request; check the destination for receipt. Testing works while normal notifications are off.
3. Open a policy in **Policies**. Under **Notifications**, select **Add another notification** and choose a scheduled summary time and weekdays. Select the method you created. Add a separate immediate entry if this policy needs it.
4. Review and save the policy. Other policies keep their own timing and methods; policies with no entries remain dashboard-only.
5. In **Notifications → Outgoing requests**, enable notification requests, review the change and save. Existing open issues follow their entries: immediate entries can send now, while scheduled entries wait for their next time.

Start with a summary for one policy, then add immediate delivery where it helps. Optional reminders continue until acknowledgment or recovery. An acknowledged open problem can still appear in a scheduled summary. See [Activate notifications](guide.md#activate-notifications) for presence-based methods, multiple entries and delivery tests.

## 7. Upgrade and roll back

Before you upgrade, read the release notes in the [changelog](../CHANGELOG.md) and take a backup.

With HACS, the new version appears with your other updates. Install it, restart Home Assistant, then refresh any browser tab that has the panel open.

By hand, repeat step 1 with the new zip: check the checksum, move the old `custom_components/homeostatic` folder somewhere outside `custom_components` so you can put it back later, copy in the new folder and restart.

For upgrades within the unified policy model, open the panel after restart to check your retained policies, open issues and history.

The testing release that introduces this model requires fresh setup for configurations using the older schedule library. It does not automatically convert or erase those settings. An old configuration can fail setup with a validation error. Keep your backup and use a separate test Home Assistant instance to try the new defaults. If you choose to replace an existing test configuration, [removing Homeostatic](guide.md#remove-homeostatic) deletes its settings and history; adding it again creates the new defaults. Restore the matching backup to return to the older configuration.

To roll back:

- If the release notes don't mention a change to stored data or options, put the old version back and restart. In HACS, open Homeostatic, choose **Redownload** from its menu (⋮) and pick the previous version. By hand, replace the folder with the copy you kept.
- If they do mention one, or you aren't sure, restore the backup you took before the upgrade. That brings back the old version and the data it saved together. An older version can fail to load data that a newer one has saved. A full restore rolls all of Home Assistant back to the moment of the backup, so anything else you changed since then is undone too.

To stop Homeostatic without removing it, disable it under **Settings → Devices & services**. To remove it completely, see [Remove Homeostatic](guide.md#remove-homeostatic).

## Next steps

- The [user guide](guide.md): watching whole integrations and batteries, notifications, and the controls for issues you already know about.
- [Alerts from automations](automation-situations.md): real alerts, such as a water leak or the garage left open after dark.
- [How Homeostatic works](how-it-works.md): how it turns failures into issues, and when it tells you.
- [Troubleshooting](troubleshooting.md), if something doesn't look right.
