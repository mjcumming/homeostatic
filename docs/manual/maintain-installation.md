# Upgrade, roll back or remove Homeostatic

[Homeostatic manual](../guide.md)

Use these procedures for an existing installation. For a new installation, start with [Install Homeostatic](../install.md).

## Upgrade

Read the target release's [upgrade notes](../../CHANGELOG.md) first. Check that a usable Home Assistant backup exists. Take a fresh backup before an update that changes saved data, configuration structure or dependencies, or when no usable recent backup is available.

Upgrades preserve your policies, source selections, exclusions, notification assignments, delivery methods and sending switch. Disabled policies stay disabled, and deleted supplied policies and notifications stay deleted. Saved issue history and active acknowledgment and pause controls remain in place.

Supported older notification settings gain a **Collection delay (seconds)** of 0 where that setting was previously absent, preserving their existing timing and destinations. Homeostatic first checks that it can safely resume the saved notification state. Older device availability policies become entity availability policies with their saved device coverage retained; [Choose what to monitor](policies.md#choose-a-scope-that-will-stay-useful) explains how that coverage handles future sources. Existing settings that already use the current format remain unchanged.

1. With HACS, download the chosen Homeostatic release. For a manual installation, download and verify the new archive as described in [Install manually](../install.md#install-manually).
2. For a manual installation, replace the whole `custom_components/homeostatic` directory with the new directory so removed files cannot remain. Leave Home Assistant's configuration and storage files in place.
3. Restart Home Assistant and refresh the browser. If an old interface remains, follow [Old screens after an upgrade](../troubleshooting.md#old-screens-after-an-upgrade).
4. Open Homeostatic and check the saved policies, notification assignments, delivery methods and sending switch. Inspect an open issue or a familiar source and confirm that History loads.

An assignment shown as **Custom notification — keep current settings** retains its settings until you replace or remove it.

### An upgrade cannot start

Unsupported or malformed settings stop setup without replacing your data. Saved monitoring state that fails to restore during startup leaves Homeostatic unavailable and the original settings and history intact. Keep the saved configuration and backup while investigating the error using [Troubleshooting](../troubleshooting.md#setup-fails-or-the-panel-says-unavailable). A configuration error does not require starting over.

The error **Saved notification state predates supported collection tracking** means Homeostatic cannot safely resume that older notification state. Setup stops before changing settings or history or requesting messages. Keep the matching previous Homeostatic version, or restore its paired Home Assistant backup, and [report the upgrade problem](https://github.com/mjcumming/homeostatic/issues). Leave the saved state intact; deleting it would lose the information needed to preserve the installation.

Deleting the integration and adding it again creates a fresh setup and loses its saved settings and history. Use that path only when you intend to start over. Restoring a backup of the matching older installation is the route back.

## Roll back

Check the release notes for changes to saved data or options before reinstalling an older version.

- When saved data is compatible, select the previous version through HACS's download options, or download its verified release archive and replace the complete component directory. Restart Home Assistant and check the panel and settings.
- When saved data changed, or compatibility is uncertain, restore the matching Home Assistant backup so the older code and its saved data return together. Replacing code alone can leave it unable to read newer records.

Home Assistant's [restore instructions](https://www.home-assistant.io/common-tasks/general/#restoring-a-backup) explain the available restore choices. A full restore also rolls back other Home Assistant changes made after that backup.

## Stop temporarily

To stop sending messages while monitoring continues, turn off **Notifications** in the Homeostatic header. To stop the integration itself, disable Homeostatic under **Settings → Devices & services**. These are different choices: disabling the integration stops monitoring.

Use [Pause notifications](issues.md#pause-an-issues-notifications) to quiet one open issue temporarily.

## Remove Homeostatic

1. Under **Settings → Devices & services**, delete the Homeostatic integration. This removes its settings, open issues, retained history and active controls.
2. Remove the downloaded integration through HACS, or delete `<config>/custom_components/homeostatic` after a manual installation.
3. Restart Home Assistant.
4. Remove Homeostatic cards and dashboards you added. Disable or remove any custom automations that call `homeostatic.*` actions, including experimental or older blueprint-based automations, so they do not continue calling a removed integration.

Blueprint files and template entities added separately remain separate resources. Remove those too if they are no longer used.
