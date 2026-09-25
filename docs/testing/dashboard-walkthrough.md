# Dashboard walkthrough

Completed 2026-09-25 against Home Assistant 2026.9.3, frontend 20260826.7, Python 3.14.7, and health-tree `a525938c2d866956a4cefab8261da39d96347de1`. This validates the first read-only dashboard increment. It does not validate a packaged pilot installation or physical equipment.

## Environment

The disposable HA Core instance listened only on `127.0.0.1:18123`, using a copied development integration and a local test account. Stock account/bootstrap setup was provisioned separately to avoid unrelated default onboarding integrations; **Homeostatic itself was installed and configured through the real HA integration screens**. No live-house configuration or credentials were used. Notification events remained disabled throughout.

Synthetic equipment consisted of an input boolean and a template sensor whose availability followed that boolean. A state-only sensor was added later through HA's REST API to exercise enrollment after setup. Real HA registries, config entries, persistence, authenticated WebSocket transport, sidebar panels and Lovelace rendering were used. The actual registered component ran inside HA, rather than only against the standalone synthetic preview.

The development host lacks optional FFmpeg and TurboJPEG system libraries. HA logged media-related warnings; media functionality was outside this walkthrough. HA also reported the Core installation-method and migrated-HTTP-configuration notices. These are not claimed as passing media or distribution checks.

## Results

| Scenario | Observed result |
| --- | --- |
| Native setup with default passive rule | Integration created successfully; Homeostatic appeared in the sidebar without manually registering dashboard resources. Twelve eligible sources were watched in this fixture. |
| No configured functions | Dashboard explicitly said no functions were defined; it did not infer whole-house readiness. |
| Native options preview | Preview reported the synthetic lighting function ready, with no requirement gaps, without saving. |
| Save a function | `Walkthrough lighting` appeared in the live dashboard with its declared sensor requirement. The dashboard itself needed no entity-list edit. |
| Availability failure | Turning the synthetic link off produced one open problem, `Walkthrough lighting: blocked`, with the motion source identified as the cause. |
| Problem detail | Displayed the failing source, affected function, public explanation and notification-events-off state. Native entity details opened successfully. |
| Recovery | Turning the link on returned the function to ready and cleared the episode after the saved default recovery hold. No shortened timing overrides are claimed. |
| New source after setup | `sensor.walkthrough_added` enrolled automatically; watched count changed from 12 to 13 and the enrollment change appeared. |
| Native area assignment | Assigning the motion source to Living Room through HA entity settings updated house browsing and the related function immediately. |
| Integration reload | The existing subscription received explicit unavailability, then a fresh available snapshot. Function, inventory and dashboard registration survived. |
| Generated dashboard | Homeostatic appeared under Community dashboards. A separate administrator-only dashboard was created with Overview, House and Coverage views. |
| Embedded navigation | Found and fixed a missing return path after Overview drilled into coverage with its own page tabs hidden. The real HA dashboard now offers Back to Overview and restores that view. |
| Full HA restart | The open browser showed Connection lost and removed current health claims. It reconnected and displayed fresh data after HA restarted; saved function, area assignment and generated dashboard remained. |
| Missing source after restart | The state-only source retained its enrolled identity and its node query reported unknown; disappearance was not interpreted as recovery. The unrelated configured lighting function remained ready. |

Recorded transport checkpoints used the real `homeostatic/subscribe` and `homeostatic/node` endpoints. They confirmed one episode during failure, zero after recovery, false then true availability across entry reload, and notifications disabled at every checkpoint.

## Reproduce the core journey

Use an isolated HA installation with the development library prerequisite available. Include this synthetic equipment in its configuration:

```yaml
input_boolean:
  walkthrough_link:
    name: Walkthrough link
    initial: true
template:
  - sensor:
      - name: Walkthrough motion source
        unique_id: walkthrough_motion_source
        state: "observed"
        availability: "{{ is_state('input_boolean.walkthrough_link', 'on') }}"
```

1. Add Homeostatic in Settings > Devices & services using the passive defaults and notifications off. Open its sidebar panel.
2. In Homeostatic options, preview and save this function, leaving timing defaults intact:

   ```yaml
   - id: walkthrough_lighting
     name: Walkthrough lighting
     importance: high
     requires:
       - sensor.walkthrough_motion_source
   ```

3. Turn the synthetic link off. Inspect the problem and its native source link. Turn it back on and allow the configured recovery hold to complete.
4. Add a synthetic state after enrollment and confirm it appears. Assign the registered motion source to an area and confirm the location view follows it.
5. Reload Homeostatic while observing its panel. Then create a Homeostatic community dashboard under Settings > Dashboards. From Overview, open coverage and use Back to Overview.
6. Restart the isolated HA process with the browser open. Confirm explicit loss of connection, a fresh view on reconnection, and unknown evidence for any non-restored state-only source.

## Regression and checks

The required check command passed after the navigation fix: 283 Python integration tests, eight Node frontend tests, Ruff, formatting, strict typing and both coverage floors (98.73% combined coverage). Official hassfest passed for the dashboard manifest in the preceding implementation increment; this walkthrough did not change metadata.

The executable browser regression is in `tests/frontend/preview.html`. Serve the repository on loopback, open that fixture, leave Administrator enabled and a live scenario selected, and press **Run navigation regression**. It exercises the actual production custom element with hidden page tabs, opens coverage, asserts a return control exists, returns to Overview, and checks that the return control disappears there. The observed result was **PASS**. This browser fixture is a manual executable check; it is not part of the Node-only CI suite.

## Remaining boundary

The first dashboard is read-only and administrator-only. This walkthrough did not validate phone delivery, physical freshness, command completion, an external watchdog, packaged installation, or optional TopoMation integration. Persisted resolved-history backend work is being integrated separately for the pilot; the dashboard tested here still shows current-runtime enrollment changes. Library release/pinning, combined-build validation and pilot installation instructions belong to the pilot assembly milestone.
