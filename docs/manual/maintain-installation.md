# Upgrade, roll back or remove Homeostatic

[Homeostatic manual](../guide.md)

Use these procedures for an existing installation. For a new installation, start with [Install Homeostatic](../install.md).

## Upgrade

Read the target release's [upgrade notes](../../CHANGELOG.md) first. Check that a usable Home Assistant backup exists. Take a fresh backup before an update that changes saved data, configuration structure or dependencies, or when no usable recent backup is available.

This release replaces the earlier notification configuration with fresh defaults. Custom policies, notification assignments and delivery methods are replaced, while saved issue history is retained. Sending starts off. After upgrading, review the new policies and configure destinations before enabling sending. Restore the matching full backup and component version if you need to return to the earlier setup.

1. With HACS, download the chosen Homeostatic release. For a manual installation, download and verify the new archive as described in [Install manually](../install.md#install-manually).
2. For a manual installation, move the old `custom_components/homeostatic` directory outside `custom_components` as a rollback copy, then copy in the new directory. Replace the whole directory so removed files cannot remain.
3. Restart Home Assistant and refresh the browser. If an old interface remains, follow [Old screens after an upgrade](../troubleshooting.md#old-screens-after-an-upgrade).
4. Open Homeostatic and check the saved policies, notification assignments, delivery methods and sending switch. Inspect an open issue or a familiar source and confirm that History loads.

After this replacement, ordinary saves and restarts retain your changes, disabled policies, deleted supplied policies and explicit choices to use no notifications. An assignment shown as **Custom notification — keep current settings** retains its settings until you replace or remove it.

### An older configuration fails validation

The upgrade notes identify the earlier notification configuration that this release replaces. Other unsupported configuration formats fail validation without being reset or converted. Keep the prior backup and try the new defaults in a separate Home Assistant test installation before deciding to replace the old setup.

Deleting the integration and adding it again creates a fresh setup and loses its saved settings and history. Use that path only when you intend to start over. Restoring a backup of the matching older installation is the route back.

## Roll back

Check the release notes for changes to saved data or options before reinstalling an older version.

- When saved data is compatible, select the previous version through HACS's download options, or restore the complete component directory retained from the manual installation. Restart Home Assistant and check the panel and settings.
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
