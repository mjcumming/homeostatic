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

Use HACS or install by hand. Both end with the same files in the same place.

### With HACS

1. In HACS, open the menu (⋮) and choose **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with the type **Integration**.
3. Find **Homeostatic**, select **Download**, choose version **1.3.0** and download it.
4. Restart Home Assistant (**Settings → System**, then the power button at the top right).

### By hand

You'll need access to your Home Assistant config folder, through the Samba share, SSH or a file editor add-on.

1. From the [1.3.0 release](https://github.com/mjcumming/homeostatic/releases/tag/v1.3.0), download `homeostatic-1.3.0.zip` and `homeostatic-1.3.0.zip.sha256` into the same folder on your computer.
2. Check the download against its checksum before you unpack it. In that folder, run the command for your system:

   ```bash
   sha256sum -c homeostatic-1.3.0.zip.sha256        # Linux
   shasum -a 256 -c homeostatic-1.3.0.zip.sha256    # macOS
   ```

   Both should print `homeostatic-1.3.0.zip: OK`. On Windows, run `Get-FileHash .\homeostatic-1.3.0.zip -Algorithm SHA256` in PowerShell and compare the hash with the first value in the `.sha256` file. If the check fails, download the zip again and don't install it.
3. Unzip it. Copy its `custom_components/homeostatic` folder into your config folder, so you end up with `<config>/custom_components/homeostatic/manifest.json`. If an older copy is already there, delete that folder first. Copying over it leaves old files behind.
4. Optionally, copy the zip's `blueprints/automation/homeostatic` folder to `<config>/blueprints/automation/homeostatic`. Then you won't need to import the alert blueprint in step 6.
5. Restart Home Assistant.

The zip also holds `BUILD_INFO.json`, which records the version, the commit it was built from and a checksum for every file inside.

## 2. Add the integration

1. Go to **Settings → Devices & services → Add integration** and search for **Homeostatic**.
2. Select it. Homeostatic is added straight away, watching your integrations and Home Assistant's Repairs, with notifications off. You'll turn notifications on from the panel in step 6.

Homeostatic appears in the sidebar. If it isn't in the integration list, or setup fails, see [Setup fails or the panel says unavailable](troubleshooting.md#setup-fails-or-the-panel-says-unavailable).

## 3. Look around the panel

Open **Homeostatic** in the sidebar. You land on **Overview**.

A new install watches one thing: whether each of your integrations is working. That covers integrations that fail to load, keep retrying, or need you to sign in again. It doesn't watch devices, entities, batteries or vacuums until you choose them.

Homeostatic reads the current state straight away. Any integration that's failing shows up under **Open issues**. Select one to see what Home Assistant reported, what to try, and a link to the integration. You don't need to act on it now.

Overview also says **Reporting is off**. Issues appear in the panel, but nothing is sent anywhere until step 6.

Now open **Sources**. This lists every integration, device, entity, battery, and vacuum Home Assistant knows about, grouped by integration. The counts beside each name show how many devices it has and how many open issues. This is where you choose what to watch.

## 4. Watch one device

Pick a device you know well and can check easily, such as a smart plug or a lamp.

1. In **Sources**, type its name in the search box, or expand its integration, and select the device.
2. The **Source** view shows what Home Assistant reports right now: the device's availability and each of its entities with its current state.
3. Select the **Settings** tab in the device's details. Under **Device availability**, choose **Always monitor this device**.
4. Select **Review changes**. The review shows what will start being watched. Select **Save changes**.

Homeostatic now watches the device as a whole, with one check across its entities. If Home Assistant reports any of them unavailable, an issue opens for the device and names the entity. When the device comes back, Homeostatic waits two minutes to confirm it's stable, then ends the issue and moves it to **History**.

Saving reloads Homeostatic without another startup wait. To see an issue open, unplug the device, as long as nothing depends on it. How quickly Home Assistant marks it unavailable depends on the integration: some take seconds, and a battery-powered Zigbee device can take hours.

Other devices on the same integration stay unwatched. The [user guide](guide.md#choose-what-to-watch) shows how to watch a whole integration, including devices you add later.

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

Use **Dashboard only** for now. The other reporting choices need the notification setup from step 6, and until it's saved, the automation stops with the error "Configure shared reporting profiles in Homeostatic Notifications first".

Turn the *Homeostatic test* toggle on. Within a few seconds, **Issues** shows *Test alert* with your message, and its reporting line says **Dashboard only**. The alert also appears in **Sources**, with a link to its automation.

Homeostatic reloads whenever you save a change in its panel, but that reload adds no startup wait. If the issue doesn't appear, check that the toggle and automation are on.

Turn the toggle off. The issue ends straight away, and **History** lists it as **Cleared**.

Keep the alert for now. Step 6 uses it.

## 6. Turn on notifications

Homeostatic sends notifications to phones through the Companion app itself, so you don't need a notification automation. Your Home Assistant user has to be linked to a person under **Settings → People**, and your phone has to be signed in to the Companion app as that user.

1. Open **Notifications**.
2. Under **People and destinations**, use **Add person** to choose yourself, then tick your phone.
3. Select **Send test** beside your phone. The panel says "Test requested. Check the selected destination." Your phone should show *Homeostatic test: this route works*. The test works before anything is saved, and it doesn't create an issue. If nothing arrives, see [No notifications arriving](troubleshooting.md#no-notifications-arriving).
4. Under **Reporting profiles**, open **Weekly summary** and tick yourself under **Recipients**. Weekly summary is the household default, so every source you watch reports there unless you choose otherwise. Open **Morning summary** and tick yourself, so Home Assistant's Repairs reach you. Then open **Immediate** and tick yourself there too.
5. Under **Outgoing requests**, tick **Enable notification requests**. This is the switch that turns notifications on. The test in step 3 works without it.
6. Select **Review changes**. The review lists what you changed and how many notifications your open issues would produce right now. Select **Save settings**. Homeostatic reloads, and Overview now says **Reporting is on**.

To see a real alert reach your phone, edit the *Homeostatic test alert* automation, change **Reporting preference** to **Immediate** and save it. Turn the toggle on. Your phone gets the alert as an urgent notification, which can sound even when the phone is muted. Tap it to open the issue in the panel, then turn the toggle off again.

When you're finished, delete the *Homeostatic test alert* automation and the *Homeostatic test* helper. Homeostatic removes the alert after Home Assistant removes its automation entity.

In a real setup, give Homeostatic a day or two with notifications going only to the weekly summary before you choose Immediate for anything. The [user guide](guide.md#activate-notifications) covers people, schedules and reporting choices in detail.

## 7. Upgrade and roll back

Before you upgrade, read the release notes in the [changelog](../CHANGELOG.md) and take a backup.

With HACS, the new version appears with your other updates. Install it, restart Home Assistant, then refresh any browser tab that has the panel open.

By hand, repeat step 1 with the new zip: check the checksum, move the old `custom_components/homeostatic` folder somewhere outside `custom_components` so you can put it back later, copy in the new folder and restart.

After the restart, open the panel. Your open issues, history and choices are where you left them.

To roll back:

- If the release notes don't mention a change to stored data or options, put the old version back and restart. In HACS, open Homeostatic, choose **Redownload** from its menu (⋮) and pick the previous version. By hand, replace the folder with the copy you kept.
- If they do mention one, or you aren't sure, restore the backup you took before the upgrade. That brings back the old version and the data it saved together. An older version can fail to load data that a newer one has saved. A full restore rolls all of Home Assistant back to the moment of the backup, so anything else you changed since then is undone too.

To stop Homeostatic without removing it, disable it under **Settings → Devices & services**. To remove it completely, see [Remove Homeostatic](guide.md#remove-homeostatic).

## Next steps

- The [user guide](guide.md): watching whole integrations and batteries, notifications, and the controls for issues you already know about.
- [Alerts from automations](automation-situations.md): real alerts, such as a water leak or the garage left open after dark.
- [How Homeostatic works](how-it-works.md): how it turns failures into issues, and when it tells you.
- [Troubleshooting](troubleshooting.md), if something doesn't look right.
