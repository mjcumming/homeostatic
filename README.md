# Homeostatic

Health monitoring and situation alerts for Home Assistant, powered by the separate [health-tree](https://github.com/mjcumming/health-tree) library.

Homeostatic answers **what is wrong, what depends on it, and what needs attention**. HealthTree supplies the dependency graph, episodes, readiness, and attention policy. This integration supplies Home Assistant observations, configuration, timers, persistence, entities, and notification requests. Consumers deliver those requests to people.

**Status: 0.1.0b1 pilot candidate.** Tested against Home Assistant 2026.9.3 on Python 3.14. HealthTree 0.2.0 is pinned in the integration manifest and installed automatically by HA. Follow the [pilot installation and observation guide](docs/pilot.md). The first dashboard is read-only; operator actions and bounded resolution history are available through native HA actions. HACS distribution and real-house validation remain outstanding.

## What works now

- Automatically populated Homeostatic sidebar dashboard, reusable cards and a dashboard strategy, with live problems, functions, HA location browsing, coverage, rule provenance and current problem details. The first aggregate surface requires an administrator.

- Native setup/options with editable attach/exclude catalog rules, match previews, passive enrollment of future sources, and explanations of every attachment/exclusion. Registered sources keep their identity across renames.
- Integration setup, retries and authentication evidence; entity availability; dependency correlation into episodes.
- Named functions with entity, integration, function and external capability requirements; editable importance; per-function automation suggestions and confirmed/rejected decisions; each exporting readiness as `ready`, `unknown`, `degraded`, or `blocked`.
- Named situation alerts bound to existing HA entities: `on` is active, `off` is clear, missing/unknown/unavailable is unknown. A situation remains independent of equipment readiness.
- Owner YAML notification policy with recipients, channels, quiet hours, reminders, escalation, grouped digests, explanations and safe previews.
- Overall readiness, open-problem and evidence-gap sensors, plus `inventory`, `explain`, `readiness`, `impact`, `coverage`, and `rollup` response actions.
- Notifications off by default, one activation summary, versioned `homeostatic_notification` events, and a [Companion app consumer blueprint](blueprints/automation/homeostatic/companion_notification.yaml).
- Ordered observation capture during storage writes, retry continuity, restart persistence, durable delivery outbox, and unload cleanup.

A passing availability check shows that HA currently reports an available control path. It does not verify physical-device freshness, detector progress, command completion, or phone receipt. Those require their own evidence producers and real traces.

Richer evidence checks, dashboard operator controls, specific Repairs links, history presentation, optional TopoMation enrichment, and the external watchdog are tracked in the [build roadmap](docs/roadmap.md). The structured YAML forms are development interfaces.

## Install the pilot

Use an isolated development HA instance on Linux or WSL. Install the sibling health-tree checkout into the **same Python environment that runs HA**, place `custom_components/homeostatic` under `<HA config>/custom_components/`, restart that instance, and add **Homeostatic** through **Settings â†’ Devices & services â†’ Add integration**.

Review the supplied passive availability rule. Matching entities and integration instances enroll automatically, including future sources. Notifications remain off until activated. Missing enrolled sources remain unknown across restarts until their rules explicitly remove them from scope. Startup grace and recovery confirmation default to two minutes; ordinary notification batching defaults to thirty seconds. See the [specification](docs/spec.md) for every timing and its meaning.

### Open the dashboard

After setup, administrators can open **Homeostatic** in the HA sidebar. It updates from the integration's inventory and public health queries as sources enroll, move, fail or recover. Overview, house browsing, coverage, and problem/function details use one shared live subscription. Startup, monitoring errors and a disconnected browser are explicitly unavailable.

The integration also registers a **Homeostatic** community dashboard strategy in HA's new-dashboard dialog. Add it there for a separate dashboard, or add the Homeostatic card to an existing dashboard:

```yaml
type: custom:homeostatic-card
view: overview
```

Supported views are `overview`, `house`, `coverage`, `functions`, and `problems`. The last two are focused cards. Set `navigation: false` to hide internal page tabs; drill-downs retain a return button to the configured view. Local frontend resources are registered automatically; existing dashboards are not modified.

This first dashboard is read-only and administrator-only because it includes installation-wide configuration, inventory and routing. Readiness entities retain their ordinary HA access controls. Problem details show current evidence, affected functions, potential impact, notification requests and active-control information. Action buttons hand off to native HA source pages; shelving and maintenance creation still use the existing administrator actions. Availability does not prove physical freshness or command completion.

Recent changes currently show the last 50 enrollment changes from the runtime, not a durable recovery journal. TopoMation is not required or read by this increment. Notification event/blueprint links and automatic Repairs remedies remain follow-up work.

### Choose what to watch

The **Catalog rules (YAML list)** field starts with:

```yaml
- id: passive_availability
  action: attach
  match: {}
  checks: [availability]
```

This watches HA availability for every eligible entity and integration instance, excluding Homeostatic itself. It performs no device polling or active probes. Edit or disable this rule with `enabled: false`, or replace it with narrower attach rules. An empty list intentionally watches no equipment. All matching attachments contribute; **every matching exclusion wins**, regardless of rule order. Check timings are house settings below the rules field.

For example, keep the broad rule and add:

```yaml
- id: ignore_workbench
  action: exclude
  match:
    area: YOUR_AREA_ID

- id: ignore_one_source
  action: exclude
  match:
    entity: sensor.experimental_temperature
  checks: [availability]
```

These are additional rows in the same list. `availability` is the only supported catalog check in this increment. Omitting `checks` has the same effect today; other checks/parameters are rejected. Equipment exclusions do not suppress situation alerts.

| Match field | Value |
| --- | --- |
| `domain` | Entity domain (`sensor`, `light`, etc.), or integration domain for an integration node |
| `device_class` | Effective HA device class, such as `temperature` |
| `integration` | Config-entry id; matches that instance and its entities |
| `device` | Device registry id; matches its entities |
| `entity` | Current entity id on input, saved as `registry:<id>` when registered |
| `area` | Effective area id: entity override, otherwise device area |
| `floor` | Floor id of that effective area |
| `label` | Label id on the entity, device, or effective area |
| `kind` | `entity` or `integration`, when a rule should affect only one kind |

A field accepts a string or a list of alternatives. Different fields must all match. Names never drive matching. Get exact ids and matching attributes from `homeostatic.inventory`; entity display names can change without changing rule identity. State-only entities use the weaker `entity_id:` reference and need edits after a rename.

Turn on **Preview without saving**, then submit to see each rule's match count and the resulting number of watched sources. Edit and preview again as needed; turn Preview off and submit to apply. For full per-source explanations without saving:

```yaml
action: homeostatic.preview_rules
data:
  rules:
    - id: temperature_sources
      action: attach
      match:
        domain: sensor
        device_class: temperature
response_variable: preview
```

Device/area/label moves trigger matching again; the periodic reconciliation also catches new integration instances. Inventory includes `attached_by`, `excluded_by`, and the last 50 enrollment changes from the current runtime, with before/after attributes. It includes excluded candidates so an absent check can be explained. Previously enrolled missing identities retain their last known attributes for matching until explicitly excluded or unmatched by edited rules.

Existing development selections appear as narrow `selected_entities` / `selected_integrations` rules when opening options. Saving converts them to the same rule model. This preserves existing scope rather than turning on the broad default for an existing installation.

### Define a function

In **Functions (YAML list)**:

```yaml
- id: garage_access
  name: Garage access
  importance: high
  requires:
    - cover.garage_door
    - binary_sensor.garage_obstruction

- id: arriving_home
  name: Arriving home
  importance: critical
  requires:
    - function:garage_access
    - entry:YOUR_CONFIG_ENTRY_ID
```

Keep `id` stable; it identifies the function and its readiness entity. Names may change. Importance is `low`, `normal`, `high`, or `critical`, and HealthTree propagates it upstream to shared causes. It does not directly choose notification routing.

Requirements may name an entity, an integration (`entry:<id>`), another function (`function:<id>`), or an external capability (`external:<id>`). Entity inputs are saved as `entity:registry:<id>` when registered; already-saved references are accepted too. The earlier `entities` list still works alongside `requires`. Cycles and situation-node requirements are rejected before saving.

Catalog rules decide which checks watch each requirement. Missing, excluded or unmatched requirements remain explicit unknowns. An excluded entity cannot borrow readiness from its healthy integration. A function with no requirements is an unwatched draft. Any answer other than `ready` means the requirements are not all proven ready. Availability checks still do not prove successful command completion or physical-device freshness.

For a capability outside HA, enter this in **External capabilities (YAML list)**:

```yaml
- id: backyard_network
  name: Backyard network service
  importance: high
```

Then add `external:backyard_network` to a function's `requires`. This declares an unwatched requirement, so the function stays unknown until an appropriate evidence producer exists. This increment implements declarations and dependencies; it does not probe the external service or accept external health reports. Deleting a declaration that a function still requires leaves a visible missing requirement.

### Review automation suggestions

Associate existing automations with the function whose needs you are defining:

```yaml
- id: basement_lighting
  name: Basement motion lighting
  importance: high
  automations:
    - automation.basement_motion_lighting
  accept:
    - binary_sensor.basement_motion
    - light.basement
  reject:
    - input_boolean.optional_mode
```

Start with `automations` and preview before choosing `accept` or `reject`. The preview lists statically discoverable entity references and current members of device/area/floor/label targets. Every suggestion identifies the automation and reference type. Conditions, optional actions and notification targets can all appear; **accept only a capability whose failure prevents this function from working**. Listing an automation does not itself create a dependency on its availability.

Accepted candidates become required edges for this function. Rejected and unreviewed candidates create no edges. Decisions use stable entity identities and survive refresh/reload. If an automation stops referencing an accepted entity, the requirement remains until explicitly removed; the preview marks it as no longer suggested. Automations outside a function contribute no suggestions to that function and no inferred dependency edges.

Candidate discovery is deliberately marked incomplete: runtime templates and downstream scripts/scenes are not recursively analyzed. Declare any missing requirement explicitly. Situation alerts remain independent of this equipment graph.

### Preview function changes

Turn on **Preview without saving** in setup/options for rule counts, function readiness, gaps, and candidate decisions. Correct any validation error, review the result, then turn Preview off to save. For full explanations, use `homeostatic.functions` for current monitoring, or preview an unsaved replacement list:

```yaml
action: homeostatic.preview_functions
data:
  functions:
    - id: garage_access
      name: Garage access
      importance: high
      requires:
        - cover.garage_door
        - binary_sensor.garage_obstruction
response_variable: preview
```

The response includes added/removed requirement edges, rule attachment/exclusion explanations, missing requirements, effective upstream importance and affected functions. Optional `external_capabilities` and `rules` fields replace those settings for the preview; omitting them retains current settings. The `functions` list replaces the entire function list in the preview.

Preview uses current observations in an isolated HealthTree model. It does not reproduce previous hold timers or episode history, save options, fire notifications, or execute automations. `present` means a current HA state/entry exists, or that a function/external declaration exists; it does not establish health. Readiness and monitoring status are separate fields.

### Bind a situation

Create the condition in HA first, using a template, binary sensor, or an automation-maintained helper. In **Situation alerts (YAML list)**:

```yaml
- id: garage_open_at_night
  name: Garage open at night
  importance: critical
  entity: binary_sensor.garage_open_at_night
```

The entity owns the condition, schedule, and delay. Homeostatic owns the episode and attention lifecycle. The source must report **unavailable when its evidence disappears**, not off; otherwise a dead source looks like a cleared situation. Its availability contract is not automatically verified in this increment. Restored or unexpected values are unknown. Only a genuine `off` clears the alert. Situation nodes have no dependency edges and never enter the overall readiness selection.

### Activate notifications

1. Install the [consumer blueprint](blueprints/automation/homeostatic/companion_notification.yaml) and create an enabled automation using your actual Companion `notify.mobile_app_...` action.
2. Set its recipient and channel to match the policy. Create a consumer for each route you intend to deliver. Select that automation in **Notification consumer automation**.
3. Enable **Activate notification events**.

Existing open problems are summarized per recipient when policy permits delivery, then followed by live changes. Quiet hours and batch delays can defer the summary; digest-only problems wait for their digest. Record-only problems and an empty activation send nothing. The selected consumer is checked for being present and enabled; arbitrary consumer logic and phone receipt are not verified. A missing/disabled consumer appears as an evidence gap.

The integration emits events and retains the last requested content. A consumer owns tags, replacements, clearing, sound, and transport-specific behavior. Unknown evidence does not blank the previous failure message. Dismissing a phone message does not resolve its episode. The [event contract](docs/events.md) describes payloads and at-least-once replay after interrupted storage acknowledgement. Critical importance requests urgent delivery in the default policy; the phone's actual behavior needs testing.

### Configure notification policy

Edit **Notification policy (YAML mapping)** in setup/options. The default is `owner`
on the `event` channel, with critical problems urgent and other problems notified
after the house's notification delay. This example uses phone consumers:

```yaml
timezone: America/Chicago
recipients:
  owner:
    channels: [phone]
    quiet_hours: {start: "22:00", end: "07:00"}
  backup:
    channels: [phone]
digests:
  morning: {at: "08:00", to: owner}
rules:
  - match: {importance: critical}
    loudness: urgent
    to: [owner, backup]
    remind_every: 15m
  - match: {category: situation}
    loudness: notify
    to: owner
    remind_every: 1h
    escalate_after: 2h
  - match: {status: unknown}
    loudness: digest
    digest: morning
    remind_every: 1d
  - match: {}
    loudness: notify
    to: owner
    remind_every: 4h
    escalate_after: 1d
```

For each reason, the first matching rule wins; HealthTree chooses the loudest
result across reasons. Supported matches are `status`, `importance`, `reason`,
`category`, `labels`, `age`, and `due_within`. Omitted fields match anything;
values within a field are alternatives. Labels must all match. Durations accept
integer seconds or strings such as `1d2h30m`; reminders must be positive. Clock
times must be quoted `HH:MM`. Set `timezone` explicitly for the house.

`record` retains a problem without sending it. `digest` requires a named digest;
`notify` and `urgent` require recipients. Urgent requests pass quiet hours. Notify
reminders wait through that recipient's quiet hours. Escalation raises one level
when a destination is available; it does not repeatedly climb the ladder.
Recipients and channels are opaque ids, not notification service names. Configure
a blueprint instance for `owner`/`phone` and another for `backup`/`phone` in the
example. The selected consumer check cannot verify every route or actual receipt.

Call `homeostatic.policy` to inspect current winning rule indexes (zero based),
recipients, pending times, and the next deadline. Call `homeostatic.preview_policy`
with the proposed mapping under `policy` to simulate activation against current
open episodes. Preview returns proposed requests and decisions without saving,
sending, or changing live timers. The options Preview also displays those decisions.

Activation preserves problem history and starts escalation afresh. Each recipient's
reminders begin with their first request. Ordinary restart preserves these clocks.
Editing policy or notification delay while enabled clears old requests and starts
attention under the replacement policy. Summaries and digests update silently as
members resolve; the last resolution clears the group. An individual reminder or
escalation replaces that episode's membership with its own message.

Presence-dependent recipients and acknowledgment remain future integration work.
Shelving is available through the administrator action described below. Policies cannot execute corrective actions.

### Inspect the model

In **Developer tools â†’ Actions**, call `homeostatic.inventory` for node ids, rule explanations, recent enrollment changes, episodes, and notification requests. Pass a node id to `homeostatic.explain` or `homeostatic.impact`. `homeostatic.readiness` and `homeostatic.rollup` default to selected capabilities/functions and accept `node_ids`. These actions are read-only. Situation ids are `situation:<id>`, function ids are `function:<id>`, and external capability ids are `external:<id>`.

## Development and checks

Use Python 3.14.2 or newer within the 3.14 series and Node.js 22 or newer, on Linux or WSL:

Only this repository is required; development and HA installation use the same published HealthTree version.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py
```

`make check` invokes the same command. It checks Ruff lint/formatting, strict mypy, the real Home Assistant integration tests, and separate 95% statement and branch coverage floors. The commit hook and CI use that same entry point. The consumer blueprint is exercised by HA's real automation engine with a mocked phone service; tests never send messages to a live installation.

The lockfile and integration manifest pin `health-tree==0.2.0` from PyPI. CI installs that published package. Library behavior changes belong in the separate library RFP/ADR and tests; release a new library version before updating this pin.

Build a reproducible installation archive from a clean committed checkout with `uv run python script/build_pilot.py`. The ZIP includes frontend assets, the optional consumer blueprint, installation instructions and exact build identity.

On this workstation, the prepared environment is outside the mounted Windows filesystem:

```bash
cd /mnt/c/GitHub/homeostatic
export UV_PROJECT_ENVIRONMENT="$HOME/.cache/homeostatic/venv"
export PATH="$HOME/.cache/homeostatic/tools:$PATH"
uv sync --locked
uv run python script/check.py
```

Run commits from WSL after installing the WSL hook. Home Assistant metadata is validated separately by the pinned official hassfest action in CI. With Docker available, run locally from the repository:

```bash
docker run --rm --mount "type=bind,source=$PWD,target=/github/workspace,readonly" ghcr.io/home-assistant/hassfest
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, [docs/spec.md](docs/spec.md) for implemented behavior, [docs/roadmap.md](docs/roadmap.md) for remaining scope, [docs/ui.md](docs/ui.md) for owner-facing working notes, and [CHANGELOG.md](CHANGELOG.md) for changes.

## Recently resolved problems

`homeostatic.resolved_history` returns the latest 100 terminal episodes observed within 30 days, newest first. The same response is available under `homeostatic.inventory` â†’ `resolved_history`. It includes collection start time and retention limits. History survives a restart and includes problems that cleared before a notification was requested.

Each row retains the original episode id, opening time, findings and display labels under `episode`, plus `resolved_at`, `resolution`, `absorbed_into` and a source display snapshot when available. `cleared` means the library observed recovery; `removed` means monitoring ended; `absorbed` links to a larger problem. Resolution time is when Homeostatic learned of the event, including after downtime. Old findings describe the past episode, not current device health. Upgrading starts collection from that point; earlier resolutions are not reconstructed. This is bounded problem history, not a full activity or delivery journal.

## Operator controls

Use **Developer Tools > Actions** while the monitor is running. `homeostatic.inventory` supplies stable node and episode ids; `homeostatic.operator_controls` lists active controls and their expiry/reason. Mutations require administrator access for user calls; HA automations can use the same actions. All expiries must include a timezone, be in the future, and be within seven days.

Preview a scope before creating maintenance. Replace the example node and expiry with your actual selection:

```yaml
action: homeostatic.preview_maintenance
data:
  node_id: "entity:entity_id:sensor.observed"
  include_dependents: true
  until: "2026-09-25T22:00:00Z"
response_variable: maintenance_preview
```

The response names the current scope, functions and existing problems. Use the same fields with `homeostatic.start_maintenance` and an optional `reason` to apply it. Dependents follow the graph during the window. Maintenance prevents new equipment problems from opening; readiness, existing alerts and independent situation alerts remain active.

To pause alerts for an already-open problem across every recipient:

```yaml
action: homeostatic.shelve
data:
  episode_id: "<current episode id from inventory>"
  until: "2026-09-25T22:00:00Z"
  reason: "Working on this problem"
```

Shelving leaves the problem and its current message visible. Silent updates and resolution still work. The shelf holds reminders and escalation, including urgent alerts, until expiry; other policy holds still apply. Shelves and maintenance survive restarts. A shelf can be extended. Early cancellation, acknowledgment and dashboard buttons are planned. If an action reports a storage error, inspect active controls after the monitor recovers before retrying.

## Beyond the pilot

Complete product presentation; capture healthy/failure/recovery traces for detector liveness, device-originated freshness and command completion; verify an external watchdog and notification consumers; validate the actual deployment. Synthetic fixtures and high coverage do not satisfy the real-house evidence gates.

MIT licensed. See [SECURITY.md](SECURITY.md) for reporting a security concern.
