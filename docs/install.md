# Install Homeostatic

[Homeostatic manual](guide.md)

This page installs Homeostatic and opens its panel. If it is already installed, use [Upgrade, roll back or remove Homeostatic](manual/maintain-installation.md).

## Before you start

You need Home Assistant 2026.9.3 or newer and an administrator account. The first load needs internet access so Home Assistant can install the required Python library. Use a published [Homeostatic release](https://github.com/mjcumming/homeostatic/releases) and the documentation included with it.

Check that you have a usable Home Assistant backup before changing the installation. Home Assistant's [backup instructions](https://www.home-assistant.io/common-tasks/general/#backups) explain how to create and restore one.

Choose one installation method below.

Homeostatic keeps its saved state in a single Home Assistant storage file that grows with the installation, a few megabytes for several thousand entities, and rewrites it when issues, settings or controls change. Large installations run best from an SSD rather than an SD card.

## Install with HACS

1. Open HACS and its three-dot menu, then select **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with type **Integration**.
3. Find **Homeostatic** in HACS and download the stable release.
4. Restart Home Assistant, then refresh the browser.

This uses HACS's [custom repository procedure](https://hacs.xyz/docs/faq/custom_repositories/).

## Install manually

You need access to the Home Assistant configuration directory, such as through a file share or SSH.

1. Download `homeostatic-<version>.zip` and its matching `.zip.sha256` file from the selected release into an empty folder on your computer. Use the Homeostatic release archive rather than GitHub's source-code archive.
2. Verify the archive against the checksum. On Linux use `sha256sum -c homeostatic-*.zip.sha256`; on macOS use `shasum -a 256 -c homeostatic-*.zip.sha256`. On Windows, run `Get-FileHash .\homeostatic-*.zip -Algorithm SHA256` in PowerShell and compare the result with the checksum file. Stop if the hashes differ.
3. Extract the archive and copy its `custom_components/homeostatic` directory into your Home Assistant configuration directory. The resulting path must be `<config>/custom_components/homeostatic/manifest.json`, with no extra enclosing folder.
4. Restart Home Assistant, then refresh the browser.

If an older Homeostatic directory is present, follow the [upgrade procedure](manual/maintain-installation.md#upgrade) to replace it completely while preserving saved settings.

## Add the integration

1. Open **Settings → Devices & services → Add integration**.
2. Search for **Homeostatic** and add it.
3. Open **Homeostatic** in the sidebar. The **Open issues** page should load.

All eight supplied monitoring policies start enabled, including Batteries and Vacuums. Normal notification sending starts off, and supplied notifications have no delivery methods. Temperature, thermostat and UPS checks need configuration.

If setup or the panel fails, use [Setup fails or the panel says unavailable](troubleshooting.md#setup-fails-or-the-panel-says-unavailable).

Continue with **[Your first monitoring setup](manual/first-run.md)** to review the defaults and prepare one phone destination.

<a id="7-upgrade-and-roll-back"></a>

## Existing installations

[Upgrade, roll back or remove Homeostatic](manual/maintain-installation.md) owns updates, backups, rollback and removal.
