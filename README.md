# Homeostatic

Health monitoring and situation alerts for Home Assistant, powered by the separate [health-tree](https://github.com/mjcumming/health-tree) library.

Homeostatic answers **what is wrong, what depends on it, and what needs attention**. HealthTree supplies the dependency graph, episodes, readiness, and attention policy. This integration supplies Home Assistant observations, configuration, timers, persistence, entities, and notification requests. Consumers deliver those requests to people.

**Status: development foundation, not a distribution release.** Tested against Home Assistant 2026.9.3 on Python 3.14. The unreleased health-tree dependency must be installed from the sibling checkout. Normal HACS installation and real-house observation proofs remain release gates.

## What works now

- Native setup/options with explicit entity and integration selection; registered sources keep their identity across renames.
- Integration setup, retries and authentication evidence; entity availability; dependency correlation into episodes.
- Named functions with importance and required entities, each exporting readiness as `ready`, `unknown`, `degraded`, or `blocked`.
- Named situation alerts bound to existing HA entities: `on` is active, `off` is clear, missing/unknown/unavailable is unknown. A situation remains independent of equipment readiness.
- Overall readiness, open-problem and evidence-gap sensors, plus `inventory`, `explain`, `readiness`, `impact`, `coverage`, and `rollup` response actions.
- Notifications off by default, one activation summary, versioned `homeostatic_notification` events, and a [Companion app consumer blueprint](blueprints/automation/homeostatic/companion_notification.yaml).
- Ordered observation capture during storage writes, retry continuity, restart persistence, durable delivery outbox, and unload cleanup.

A passing availability check shows that HA currently reports an available control path. It does not verify physical-device freshness, detector progress, command completion, or phone receipt. Those require their own evidence producers and real traces.

The full rule catalog, automatic enrollment, richer function configuration, owner-authored YAML policy, shelving/maintenance, Repairs links, problem panel, history, and external watchdog are tracked in the [build roadmap](docs/roadmap.md). Manual enrollment and the structured YAML forms are development interfaces. The target rule model uses additive attach rules and exclusions that always win.

## Try the development build

Use an isolated development HA instance on Linux or WSL. Install the sibling health-tree checkout into the **same Python environment that runs HA**, place `custom_components/homeostatic` under `<HA config>/custom_components/`, restart that instance, and add **Homeostatic** through **Settings → Devices & services → Add integration**.

Select the integrations/entities to monitor. New sources are not yet enrolled automatically. Missing selected sources remain unknown requirements until explicitly removed. Startup grace and recovery confirmation default to two minutes; ordinary notification batching defaults to thirty seconds. See the [specification](docs/spec.md) for every timing and its meaning.

### Define a function

In the **Functions (YAML list)** field, enter, for example:

```yaml
- id: garage_access
  name: Garage access
  importance: high
  entities:
    - cover.garage_door
    - binary_sensor.garage_obstruction
```

Requirements are enrolled automatically. Keep `id` stable; it identifies the function and its readiness entity. Names may change. Importance is `low`, `normal`, `high`, or `critical`. Registry identities are saved instead of changeable entity ids; later edits may show `registry:...` references, which are also accepted. Removing a registry entry leaves the requirement unknown.

The function's readiness sensor can drive fallback automations. Any answer other than `ready` means that its requirements are not all proven ready. Selecting entities also adds them to the overall readiness answer.

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
2. Select that automation in **Notification consumer automation**.
3. Enable **Activate notification events**.

Existing open problems produce one activation-time summary, then live changes. The selected consumer is checked for being present and enabled; arbitrary consumer logic and phone receipt are not verified. A missing/disabled consumer appears as an evidence gap.

The integration emits events and retains the last requested content. A consumer owns tags, replacements, clearing, sound, and transport-specific behavior. Unknown evidence does not blank the previous failure message. Dismissing a phone message does not resolve its episode. The [event contract](docs/events.md) describes payloads and at-least-once replay after interrupted storage acknowledgement. Critical importance requests urgent delivery in the initial fixed policy; the phone's actual behavior needs testing.

### Inspect the model

In **Developer tools → Actions**, call `homeostatic.inventory` for node ids, episodes, and notification requests. Pass a node id to `homeostatic.explain` or `homeostatic.impact`. `homeostatic.readiness` and `homeostatic.rollup` default to selected capabilities/functions and accept `node_ids`. These actions are read-only. Situation ids are `situation:<id>` and function ids are `function:<id>`.

## Development and checks

Use Python 3.14.2 or newer within the 3.14 series, on Linux or WSL:

```text
GitHub/
  health-tree/
  homeostatic/
```

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py
```

`make check` invokes the same command. It checks Ruff lint/formatting, strict mypy, the real Home Assistant integration tests, and separate 95% statement and branch coverage floors. The commit hook and CI use that same entry point. The consumer blueprint is exercised by HA's real automation engine with a mocked phone service; tests never send messages to a live installation.

CI checks out health-tree at `807af7cb12c9177cd33cdb6772c2a872d844c989`, including the accepted situation decisions and fixtures. The local environment uses the sibling checkout. Library behavior changes belong in its own RFP/ADR and tests.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, [docs/spec.md](docs/spec.md) for implemented behavior, [docs/roadmap.md](docs/roadmap.md) for remaining scope, and [CHANGELOG.md](CHANGELOG.md) for changes.

## Before distribution

Release and pin the reviewed health-tree version; complete the rule/policy/operator workflows; capture healthy/failure/recovery traces for detector liveness, device-originated freshness and command completion; verify an external watchdog and notification consumers; validate the actual deployment. Synthetic fixtures and high coverage do not satisfy the real-house evidence gates.

MIT licensed. See [SECURITY.md](SECURITY.md) for reporting a security concern.
