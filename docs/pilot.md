# Homeostatic pilot

The 0.1.0b1 pilot combines the live dashboard, availability enrollment, function readiness, notification policy, administrator controls and bounded resolution history. Start with passive observation. This build is for trying real equipment and recording what happens; it is not a completed production release.

## Install

The tested baseline is Home Assistant **2026.9.3** with Python 3.14. HA OS and Container manage Python themselves. Compatibility with other HA versions must be checked before installation. The integration requires access to PyPI on first setup to install its pinned **health-tree 0.2.0** dependency. No library checkout, editable install, Node.js or developer tools are needed on the HA host.

1. Make a Home Assistant backup. If an earlier Homeostatic development build exists, save its component directory and HA backup together so code and stored data can be restored as a pair.
2. Extract `homeostatic-0.1.0b1-pilot.zip` on your computer. `BUILD_INFO.json` identifies the exact commit and lists checksums for the packaged files. The adjacent `.sha256` file verifies the ZIP itself.
3. Copy the extracted `custom_components/homeostatic` folder to your Home Assistant configuration directory, resulting in `<HA config>/custom_components/homeostatic/manifest.json`. On HA OS this configuration directory is normally `/config`; with Container it is the host directory mounted at `/config`. Use your existing method of accessing those configuration files. Replace an old component folder in full so obsolete files do not remain. Do not copy the whole repository or ZIP inside the component folder.
4. Restart Home Assistant. In **Settings > Devices & services > Add integration**, search for **Homeostatic**. An existing entry should load the updated component after restart instead of creating another entry.
5. Leave **Notification events** off. Review the passive availability rule and save. Open **Homeostatic** in the sidebar using an administrator account. No manual JavaScript-resource registration is needed.

If Homeostatic does not appear in Add integration, first check the folder nesting and restart; then inspect the HA logs for `homeostatic` and dependency-install errors. The dashboard deliberately shows monitoring unavailable during startup, reload or failure. A browser refresh after an upgrade reloads the frontend assets. This pilot uses manual installation; HACS installation is not yet the documented distribution path.

## First observation

Start with a small area or a few familiar sources. The default rule matches all eligible HA entities and integration instances, including future sources. Narrow it in the setup/options form if that would make the first trial easier to inspect. For example, replace `sensor.YOUR_ENTITY` with a real sensor:

```yaml
- id: pilot_sources
  action: attach
  match:
    entity: sensor.YOUR_ENTITY
  checks: [availability]
```

Use **Preview without saving** to inspect the scope. Define one or two familiar functions with real requirements, using the examples in `README.md`. Without declared functions, the dashboard explicitly reports that no functions are defined. Availability describes HA's reported control path; it does not demonstrate fresh physical readings or successful device commands.

Observe normal operation for **24–48 hours**, leaving notifications off. Record the installed build, HA version, selected sources, expected behavior and any unexpected problem or coverage gap. Inspect coverage for excluded, unwatched, missing or unknown requirements. The first dashboard presents current problems and enrollment changes; resolved problems are available through **Developer tools > Actions > `homeostatic.resolved_history`** and the `resolved_history` field in `homeostatic.inventory`.

## Controlled checks

Use expendable test equipment or a synthetic helper. Do not interrupt an essential household device merely to test monitoring.

| Check | What to observe |
| --- | --- |
| Unavailable source | One appropriate problem and the expected effect on the function; distinguish unknown evidence from a confirmed failure. |
| Recovery | The function recovers after the configured confirmation period; the episode appears in resolved history. Startup grace and recovery confirmation default to two minutes. |
| New matching source | Enrollment and coverage update without editing the dashboard. |
| Reload and full HA restart | The dashboard shows unavailability/disconnection, then fresh data; function definitions, history and active controls remain. |
| Short maintenance window | Preview the exact scope first; create a brief bounded window using `homeostatic.start_maintenance`; check expiry. Existing problems and situation alerts remain active. |
| Shelve an open test problem | `homeostatic.shelve` retains the problem and pauses future alerts until expiry. Use a short window; early cancellation is not implemented. |

Use the action examples in `README.md`, replacing node ids and timestamps with current values. History keeps the latest 100 observed terminal episodes within 30 days, including removal and absorption as distinct outcomes. It is not a complete activity log, and old history is not reconstructed on upgrade.

Only after passive behavior is understood, configure the included Companion blueprint for one recipient and one intended phone. The optional file belongs at `<HA config>/blueprints/automation/homeostatic/companion_notification.yaml`. Create and enable its automation, select it in Homeostatic options, then enable notification events. Confirm opening, replacement, recovery, quiet hours and urgent behavior on that phone. Event publication alone does not prove phone delivery. See `docs/events.md` for the routing contract.

## Rollback

Disable the Homeostatic entry to stop monitoring and its dashboard. Disable the optional consumer automation as well if you created it. To remove the pilot, remove the integration entry through HA, remove only its component folder and optional blueprint, then restart. To return to a prior development build with its prior state, restore the paired HA backup and component version. Do not hand-edit opaque runtime storage or downgrade code against newer stored data.

## Build and validation

Developers can reproduce the archive from its clean committed revision with `uv sync --locked` followed by `uv run python script/build_pilot.py`. The archive contains tracked component files, all frontend assets, the optional blueprint, documentation, license and build identity; it excludes development environments and local HA configuration.

The [dashboard walkthrough](testing/dashboard-walkthrough.md) records the isolated real-HA browser journey. Required integration checks and official hassfest validate the combined candidate. A separate clean installation smoke check must verify the packaged component and automatically installed published dependency. Results belong in `docs/testing/pilot-validation.md`.

Physical-device freshness, detector liveness, command-completion evidence, external watchdog coverage, full history presentation, interactive operator buttons and optional TopoMation enrichment remain later work. They do not prevent a bounded passive availability pilot.
