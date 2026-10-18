# Install, update or remove Homeostatic

You need Home Assistant 2026.9.3 or newer and an administrator account. The first start needs internet access so Home Assistant can download the Python library Homeostatic uses; after that it runs locally. Make sure you have a working [Home Assistant backup](https://www.home-assistant.io/common-tasks/general/#backups) before you install or update.

Homeostatic keeps its state in one Home Assistant storage file. The file grows with your installation, to a few megabytes for several thousand entities, and is rewritten when issues, settings or controls change. Large installations run best from an SSD rather than an SD card.

## Install with HACS

1. In HACS, open the three-dot menu and select **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with type **Integration**.
3. Download **Homeostatic** and restart Home Assistant.
4. Go to **Settings → Devices & services → Add integration** and add **Homeostatic**.
5. Open **Homeostatic** in the sidebar. **Open issues** should load.

## Install manually

1. From a [release](https://github.com/mjcumming/homeostatic/releases), download `homeostatic-<version>.zip` and its `.zip.sha256` file. GitHub's source-code archive won't work.
2. Check the archive: `sha256sum -c homeostatic-*.zip.sha256` on Linux, `shasum -a 256 -c homeostatic-*.zip.sha256` on macOS, or on Windows compare `Get-FileHash .\homeostatic-*.zip -Algorithm SHA256` with the checksum file.
3. Copy the archive's `custom_components/homeostatic` folder into your Home Assistant configuration folder, so that `<config>/custom_components/homeostatic/manifest.json` exists.
4. Restart Home Assistant, then follow steps 4 and 5 above.

Then follow [Get started](manual/first-run.md).

## Update

Read the release's [upgrade notes](../CHANGELOG.md) first. Update in HACS, or for a manual install replace the whole `custom_components/homeostatic` folder. Restart Home Assistant and refresh your browser. If the panel still looks old, see [Old screens after an update](troubleshooting.md#old-screens-after-an-update).

To go back to an earlier version, restore the backup you took before updating. Older code can't always read data saved by a newer version.

## Remove

1. Under **Settings → Devices & services**, delete the Homeostatic integration. This removes its settings, issues, history and controls.
2. Remove Homeostatic in HACS, or delete `<config>/custom_components/homeostatic`.
3. Restart Home Assistant.
4. Remove any Homeostatic cards and dashboards, and any automations that call `homeostatic.*` actions.
