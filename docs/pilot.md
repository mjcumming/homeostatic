# Homeostatic pilot

The 0.1.0b10 pilot combines the live dashboard, availability enrollment, function readiness, notification policy, administrator controls and bounded resolution history. Start with passive observation. This build is for trying real equipment and recording what happens; it is not a completed production release.

## Install

The tested baseline is Home Assistant **2026.9.3** with Python 3.14. HA OS and Container manage Python themselves. Compatibility with other HA versions must be checked before installation. The integration requires access to PyPI on first setup to install its pinned **health-tree 0.3.0** dependency. No library checkout, editable install, Node.js or developer tools are needed on the HA host.

1. Make a Home Assistant backup. If an earlier Homeostatic development build exists, save its component directory and HA backup together so code and stored data can be restored as a pair.
2. Extract `homeostatic-0.1.0b10-pilot.zip` on your computer. `BUILD_INFO.json` identifies the exact commit and lists checksums for the packaged files. The adjacent `.sha256` file verifies the ZIP itself.
3. Copy the extracted `custom_components/homeostatic` folder to your Home Assistant configuration directory, resulting in `<HA config>/custom_components/homeostatic/manifest.json`. On HA OS this configuration directory is normally `/config`; with Container it is the host directory mounted at `/config`. Use your existing method of accessing those configuration files. Replace an old component folder in full so obsolete files do not remain. Do not copy the whole repository or ZIP inside the component folder.
4. Restart Home Assistant. In **Settings > Devices & services > Add integration**, search for **Homeostatic**. An existing entry should load the updated component after restart instead of creating another entry.
5. Leave **Notification events** off. Narrow the passive availability rule using the first-observation guidance below before previewing or saving on a large installation. Open **Homeostatic** in the sidebar using an administrator account. No manual JavaScript-resource registration is needed.

If Homeostatic does not appear in Add integration, first check the folder nesting and restart; then inspect the HA logs for `homeostatic` and dependency-install errors. The dashboard deliberately shows monitoring unavailable during startup, reload or failure. A browser refresh after an upgrade reloads the frontend assets. This pilot uses manual installation; HACS installation is not yet the documented distribution path.

## First observation

Start with a small area or a few familiar sources. The default rule matches all eligible HA entities and integration instances, including future sources. **Replace the broad default before preview or setup on large installations.** The first live 0.1.0b1 pilot found that a whole-catalog preview on an installation with more than 6,000 registered entities left HA unresponsive for several minutes. Version 0.1.0b2 skips graph construction for enrollment-only previews and registers monitored graphs in a batch; isolated 10,000-source scenarios pass. Earlier runtime outage-burst qualification failed because repeated inventory scans, saves and publications stalled the event loop. Version 0.1.0b6 combines redundant refreshes and reuses unchanged inventory. A narrow 60-capability synthetic lab passed the proposed burst budgets with real storage and WebSocket delivery. Monitoring all 6,000 entities still missed those budgets; whole-house enrollment remains unqualified. See [runtime qualification](testing/runtime-scaling.md).

An integration-only rule successfully started the first pilot with 127 watched integration instances. It monitors their HA setup/availability state; it does not monitor the availability of their individual entities:

```yaml
- id: pilot_integrations
  action: attach
  match:
    kind: integration
  checks: [availability]
```

Alternatively, select a few familiar entities. Replace `sensor.YOUR_ENTITY` with a real sensor:

```yaml
- id: pilot_sources
  action: attach
  match:
    entity: sensor.YOUR_ENTITY
  checks: [availability]
```

Use **Preview without saving** to inspect the scope. Define one or two familiar functions with real requirements, using the examples in `README.md`. Without declared functions, the dashboard explicitly reports that no functions are defined. Availability describes HA's reported control path; it does not demonstrate fresh physical readings or successful device commands.

Observe normal operation for **24–48 hours**, leaving notifications off. Record the installed build, HA version, selected sources, expected behavior and any unexpected problem or coverage gap. Inspect coverage for excluded, unwatched, missing or unknown requirements. The dashboard presents current problems, enrollment changes, and **Recently resolved** history with search and outcome filters. The native `homeostatic.resolved_history` action and inventory field expose the same retained history.

## Controlled checks

Use expendable test equipment or a synthetic helper. Do not interrupt an essential household device merely to test monitoring.

| Check | What to observe |
| --- | --- |
| Unavailable source | One appropriate problem and the expected effect on the function; distinguish unknown evidence from a confirmed failure. |
| Recovery | The function recovers after the configured confirmation period; the episode appears in resolved history. Startup grace and recovery confirmation default to two minutes. |
| New matching source | Enrollment and coverage update without editing the dashboard. |
| Reload and full HA restart | The dashboard shows unavailability/disconnection, then fresh data; function definitions, history and active controls remain. |
| Short maintenance window | Preview the exact scope first; use **Plan maintenance** in equipment details to create a brief bounded window; check expiry. Existing problems and situation alerts remain active. |
| Shelve an open test problem | **Pause alerts** under **Manage this problem** in problem details retains the problem and pauses future alerts until expiry. Use a short window; early cancellation is not implemented. |

Use the action examples in `README.md`, replacing node ids and timestamps with current values. History keeps the latest 100 observed terminal episodes within 30 days, including removal and absorption as distinct outcomes. It is not a complete activity log, and old history is not reconstructed on upgrade.

Only after passive behavior is understood, configure the included Companion blueprint for one recipient and one intended phone. The optional file belongs at `<HA config>/blueprints/automation/homeostatic/companion_notification.yaml`. Create and enable its automation, select it in Homeostatic options, then enable notification events. Confirm opening, replacement, recovery, quiet hours and urgent behavior on that phone. Event publication alone does not prove phone delivery. See `docs/events.md` for the routing contract.

## Rollback

Disable the Homeostatic entry to stop monitoring and its dashboard. Disable the optional consumer automation as well if you created it. To remove the pilot, remove the integration entry through HA, remove only its component folder and optional blueprint, then restart. To return to a prior development build with its prior state, restore the paired HA backup and component version. Do not hand-edit opaque runtime storage or downgrade code against newer stored data.

## Build and validation

Developers can reproduce the archive from its clean committed revision with `uv sync --locked` followed by `uv run python script/build_pilot.py`. The archive contains tracked component files, all frontend assets, the optional blueprint, documentation, license and build identity; it excludes development environments and local HA configuration.

The [dashboard walkthrough](testing/dashboard-walkthrough.md) records the isolated real-HA browser journey. Required integration checks and official hassfest validate the combined candidate. A separate clean installation smoke check must verify the packaged component and automatically installed published dependency. Results belong in `docs/testing/pilot-validation.md`.

Physical-device freshness, detector liveness, command-completion evidence, external watchdog coverage, a full transition journal, early control cancellation and optional TopoMation enrichment remain later work. They do not prevent a bounded passive availability pilot.


## 0.1.0b6 synthetic package and UI validation

Build `112a57bffaa66210715e8dba6f25fca5a6257fa0` produced
`homeostatic-0.1.0b6-pilot.zip`, SHA-256
`c4799e5f2a955c1fd9819c8ce69a6de2d62cee7ff7d310fddd9605e032c49ec7`.
All results in this section are from isolated synthetic environments.

- Required checks passed: 332 Python tests, 22 frontend tests, 98.92% combined
  coverage, lint, formatting and strict typing. Two opt-in performance profiles
  ran separately and passed their functional assertions.
- Official HA 2026.9.3 hassfest reported one valid integration and none invalid.
- The exact ZIP passed fresh installation, automatic health-tree 0.3.0 dependency
  installation, all five versioned frontend resources, failure/recovery and reload.
- A running synthetic HA lab used actual Store writes and authenticated WebSocket
  delivery for the 6,000-entity catalog with 60 selected capabilities. Outage and
  recovery settled in about 80 ms. Broad monitoring remains unqualified; full
  measurements and reproduction instructions are in the runtime assessment.
- Actual HA browser checks verified phone sidebar navigation, full-catalog search,
  bounded 50-row pages and preserved page selection through evidence updates.

This establishes package and bounded synthetic behavior. Sustained household
traffic, appliance performance and broader enrollment remain separate work.
