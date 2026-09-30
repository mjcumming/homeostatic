# Homeostatic installation and controlled rollout

Version 1.1.3 pins health-tree 0.5.1 and simplifies cleared device History details. It retains the removed-device History improvement from 1.1.2, the Sources tree and monitoring guidance from 1.1.1, opt-in battery maintenance, availability enrollment, function readiness, Home Assistant automation alerts, reporting preferences, administrator controls and bounded resolution history. Start with passive observation. Battery and availability findings describe Home Assistant evidence; they do not prove physical-device freshness or a particular failure cause.

For an owner-authorized local UI trial before publication, use the [quick local test cycle](development-workflows.md). The installation steps below apply to a CI-validated archive from a clean commit or a tagged release.

## Install

The tested baseline is Home Assistant **2026.9.3** with Python 3.14. HA OS and Container manage Python themselves. Compatibility with other HA versions must be checked before installation. The integration requires access to PyPI on first setup to install its pinned **health-tree 0.5.1** dependency. No library checkout, editable install, Node.js or developer tools are needed on the HA host.

1. Confirm a recent usable Home Assistant automatic backup and save the installed Homeostatic component folder for rollback. Make a fresh full HA backup if this upgrade changes stored data, the options schema or the pinned dependency, or if no suitable backup exists. Ordinary code-only upgrades do not need another full backup.
2. Download `homeostatic-1.1.3.zip` and its `.sha256` file from the [GitHub release](https://github.com/mjcumming/homeostatic/releases/tag/v1.1.3). `BUILD_INFO.json` identifies the exact commit and lists checksums for the packaged files. The adjacent `.sha256` file verifies the release ZIP itself.
3. Copy the extracted `custom_components/homeostatic` folder to your Home Assistant configuration directory, resulting in `<HA config>/custom_components/homeostatic/manifest.json`. On HA OS this configuration directory is normally `/config`; with Container it is the host directory mounted at `/config`. Use your existing method of accessing those configuration files. Replace an old component folder in full so obsolete files do not remain. Do not copy the whole repository or ZIP inside the component folder.
4. Restart Home Assistant. In **Settings > Devices & services > Add integration**, search for **Homeostatic**. An existing entry should load the updated component after restart instead of creating another entry.
5. Leave notification requests off. Narrow the passive availability rule using the first-observation guidance below before previewing or saving on a large installation. Open **Homeostatic** in the sidebar using an administrator account. No manual JavaScript-resource registration is needed.

If Homeostatic does not appear in Add integration, first check the folder nesting and restart; then inspect the HA logs for `homeostatic` and dependency-install errors. The dashboard deliberately shows monitoring unavailable during startup, reload or failure. A browser refresh after an upgrade reloads the frontend assets. This archive describes manual installation; the README also documents installation through HACS as a custom repository.

## First observation

Start with a small area or a few familiar sources. New installations watch integration state; device summaries and separate entity checks are opt-in. Existing pilot installations may retain a broad device rule. Review its effective scope in Settings before expanding monitoring, especially when an integration discovers transient clients. The first live 0.1.0b1 pilot found that a whole-catalog preview on an installation with more than 6,000 registered entities left HA unresponsive for several minutes. Version 0.1.0b2 skips graph construction for enrollment-only previews and registers monitored graphs in a batch; isolated 10,000-source scenarios pass. Earlier runtime outage-burst qualification failed because repeated inventory scans, saves and publications stalled the event loop. Version 0.1.0b6 combines redundant refreshes and reuses unchanged inventory. A narrow 60-capability synthetic lab passed the proposed burst budgets with real storage and WebSocket delivery. Monitoring all 6,000 entities still missed those budgets; whole-house enrollment remains unqualified. See [runtime qualification](testing/runtime-scaling.md).

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

Use **Preview without saving** to inspect the scope. Define one or two familiar functions with real requirements, using the examples in the [user guide](guide.md#define-a-function). Without declared functions, the dashboard explicitly reports that no functions are defined. Availability describes HA's reported control path; it does not demonstrate fresh physical readings or successful device commands.

Observe normal operation for **24–48 hours**, leaving notifications off. Record the installed build, HA version, selected sources, expected behavior and any unexpected problem or coverage gap. Inspect coverage for excluded, unwatched, missing or unknown requirements. The dashboard presents current problems, enrollment changes, and **Recently resolved** history with search and outcome filters. The native `homeostatic.resolved_history` action and inventory field expose the same retained history.

## Controlled checks

Use expendable test equipment or a synthetic helper. Do not interrupt an essential household device merely to test monitoring.

| Check | What to observe |
| --- | --- |
| Unavailable source | One appropriate problem and the expected effect on the function; distinguish unknown evidence from a confirmed failure. |
| Recovery | The function recovers after the configured confirmation period; the episode appears in resolved history. Startup grace and recovery confirmation default to two minutes. |
| New matching source | Enrollment and coverage update without editing the dashboard. |
| Reload and full HA restart | The dashboard shows unavailability/disconnection, then fresh data; function definitions, history and active controls remain. |
| Short maintenance window | Preview the exact scope first; use **Working on this equipment** in source details to create a brief bounded window; check expiry. Existing problems and situation alerts remain active. |
| Shelve an open test problem | **Pause alerts** directly in problem details retains the problem and pauses future alerts until expiry. Use a short window; **End now** resumes due attention under the remaining policy holds. |

Use the action examples in the [user guide](guide.md#operator-controls), replacing node ids and timestamps with current values. History keeps the latest 100 observed terminal episodes within 30 days, including removal and absorption as distinct outcomes. It is not a complete activity log, and old history is not reconstructed on upgrade.

Only after passive behavior is understood, open **Notifications**, select one person and one intended phone, review the reporting preferences, and enable outgoing requests. The built-in sender handles phone delivery and acknowledgment; a consumer automation is not required. Test only the intended phone and verify opening, acknowledgment, reminders and recovery. A delivery request is not proof that the phone received it. See [events](events.md) for the routing contract.

## Rollback

Disable the Homeostatic entry to stop monitoring and its dashboard. Disable the optional consumer automation as well if you created it. To remove the pilot, remove the integration entry through HA, remove only its component folder and optional blueprint, then restart. For an ordinary code-only trial with unchanged stored contracts, restore the prior component folder and restart. If stored data changed, restore the paired HA backup and matching component version. Do not hand-edit opaque runtime storage or downgrade code against newer stored data.

## Build and validation

Developers can reproduce the archive from its clean committed revision with `uv sync --locked` followed by `uv run python script/build_pilot.py`. The archive contains tracked component files, all frontend assets, the optional blueprint, documentation, license and build identity; it excludes development environments and local HA configuration.

The [dashboard walkthrough](testing/dashboard-walkthrough.md) records the isolated real-HA browser journey. Required integration checks and official hassfest validate the combined candidate. A separate clean installation smoke check must verify the packaged component and automatically installed published dependency. Results belong in `docs/testing/pilot-validation.md`.

Physical-device freshness, detector liveness, command-completion evidence, external watchdog coverage, a full transition journal, phone acknowledgment wiring and optional TopoMation enrichment remain later work. They do not prevent a bounded passive availability pilot.


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
