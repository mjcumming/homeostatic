# Homeostatic

**Know what's wrong with your home, what it affects, and who needs to hear about it.**

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Installations](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fanalytics.home-assistant.io%2Fcustom_integrations.json&query=%24.homeostatic.total&label=installs&color=41BDF5&logo=home-assistant&cacheSeconds=3600)](https://analytics.home-assistant.io/custom_integrations.json)
[![GitHub Release](https://img.shields.io/github/v/release/mjcumming/homeostatic?include_prereleases&sort=semver)](https://github.com/mjcumming/homeostatic/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/mjcumming/homeostatic/ci.yml?branch=main&label=CI)](https://github.com/mjcumming/homeostatic/actions/workflows/ci.yml)
[![Coverage floor](https://img.shields.io/badge/coverage%20floor-95%25-brightgreen.svg)](CONTRIBUTING.md)
[![Home Assistant](https://img.shields.io/badge/home%20assistant-2026.9.3+-blue.svg)](https://www.home-assistant.io/)
[![Python](https://img.shields.io/badge/python-3.14-blue.svg)](https://www.python.org/downloads/)
[![health-tree](https://img.shields.io/pypi/v/health-tree?label=health-tree)](https://pypi.org/project/health-tree/)
[![Project Status](https://img.shields.io/badge/project%20status-beta-orange.svg)](#project-status)
[![Maintenance](https://img.shields.io/maintenance/yes/2026.svg)](https://github.com/mjcumming/homeostatic)
[![License](https://img.shields.io/github/license/mjcumming/homeostatic.svg)](LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/mjcumming/homeostatic.svg)](https://github.com/mjcumming/homeostatic/issues)

> ⭐ **Using Homeostatic?** Please [star the repo](https://github.com/mjcumming/homeostatic). It takes 25 stars to get into the HACS default store, and it helps other Home Assistant users find the project.

A growing Home Assistant install fails in quiet, confusing ways. The lights stop following motion: is it the light, the motion sensor, or the Zigbee integration behind both? A dozen entities go unavailable at once and you get a dozen alerts for one problem.

Homeostatic sits inside Home Assistant and answers three questions:

1. **What is wrong?** One problem per root cause, not one alert per symptom.
2. **What does it affect?** The things your home *does*, like **Garage access** or **Motion lighting**, and whether they're ready.
3. **Who should hear about it, and when?** A notification policy with quiet hours, reminders, and escalation, off until you turn it on.

<!--
Screenshots: save PNGs to docs/images/ and uncomment.
Suggested: overview.png (Home page with counts and recent issues),
problem.png (a problem's details with affected functions and next step),
sources.png (Sources grouped by area), notifications.png (the Notifications page).

<p align="center">
  <img src="docs/images/overview.png" alt="Homeostatic overview" width="720"/>
</p>
-->

## Features

- **Root-cause grouping.** When an integration fails, its unavailable devices are linked to that one problem instead of paging you for each.
- **Functions and readiness.** Name what your home does, list what it needs, and get a `ready`, `unknown`, `degraded`, or `blocked` sensor for each. Homeostatic can suggest requirements from your existing automations.
- **Importance flows upstream.** Mark **Garage access** as high importance and the hub it depends on inherits that importance when it fails.
- **Situation alerts.** Bind conditions you define, like **Garage open at night**, to the same attention system, even when all the equipment works.
- **Notification policy.** Recipients, quiet hours, digests, reminders, and escalation, with a preview before saving. Notifications start off.
- **Acknowledge, pause, and maintenance.** Record that you've seen a problem, pause its alerts, or declare a maintenance window with a preview of what it affects.
- **Coverage you can see.** The dashboard shows what's watched, what's excluded, and where evidence is missing, so silence never passes for health.
- **Native to Home Assistant.** Config flow, floors and areas, entity registry identity, sidebar dashboard, reusable cards, response actions, and blueprints. Runs locally with passive monitoring; it never polls your devices.

## Requirements

- Home Assistant **2026.9.3** or newer (tested on 2026.9.3, Python 3.14).
- Internet access to PyPI on first setup, so HA can install the pinned [health-tree](https://pypi.org/project/health-tree/) library.
- An administrator account for the dashboard.

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) and choose **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with type **Integration**.
3. Find **Homeostatic**, turn on **Show beta versions** if the latest release is a beta, and download it.
4. Restart Home Assistant.

[![Open your Home Assistant instance and open a repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mjcumming&repository=homeostatic&category=integration)

### Manual

1. Download `homeostatic-<version>-pilot.zip` from the [latest release](https://github.com/mjcumming/homeostatic/releases).
2. Copy its `custom_components/homeostatic` folder into your HA configuration directory, so you end up with `<config>/custom_components/homeostatic/manifest.json`. Replace any older copy in full.
3. Restart Home Assistant.

The [pilot guide](docs/pilot.md) covers backups, verifying the archive, and rollback.

## Quick start

1. Go to **Settings > Devices & services > Add integration** and add **Homeostatic**.

   [![Open your Home Assistant instance and start setting up Homeostatic.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=homeostatic)

2. Open **Homeostatic** in the sidebar. New installs watch integration health only.
3. In **Sources**, pick a few integrations or devices you know well and choose **Edit monitoring**. Preview, then save. On a large install, start small.
4. Define one function you care about, for example:

   ```yaml
   - id: garage_access
     name: Garage access
     importance: high
     requires:
       - cover.garage_door
       - binary_sensor.garage_obstruction
   ```

5. Watch it for a day or two with notifications off. When it behaves the way you expect, set up the [Companion app blueprint](blueprints/automation/homeostatic/companion_notification.yaml) and turn them on in **Notifications**.

## How it works

Homeostatic turns your HA setup into a dependency graph: integrations, devices, entities, and the functions you define on top of them. It feeds HA's own signals (integration setup state and entity availability) into [Health Tree](https://github.com/mjcumming/health-tree), a separate, dependency-free Python library that works out root causes, groups symptoms into one episode per root, tracks recovery, and decides who hears what. Homeostatic handles everything HA-specific: discovery, storage, the dashboard, and delivery.

### How a device gets an availability warning

Home Assistant's device record groups entities; it does not provide one device-health state. When you choose to monitor a device, Homeostatic makes one availability summary from its enabled ordinary entities (including buttons), or enabled diagnostic entities if it has no ordinary ones. Disabled and configuration entities are not included. You can exclude a selected entity through the monitoring rules. New installations watch integration setup state first; device summaries require a monitoring choice.

| Home Assistant evidence from selected entities | Device availability summary |
| --- | --- |
| Any entity is `unavailable` | **Warning:** Home Assistant cannot currently read or control that entity. This remains a warning even if every selected entity is unavailable. |
| An entity is `unknown` | No availability issue from that value. Home Assistant has the entity, but its value is not known; an unpressed button is a common example. |
| No entity is `unavailable` | No availability warning. This does not verify the device's physical operation or the correctness of its readings. |
| An entity is missing or has only a restored startup state | Evidence is incomplete; Homeostatic keeps this distinct from a confirmed availability warning. |

Home Assistant's **Not provided** filter is different from an entity reporting `unavailable`: the registry still lists an entity that is not currently supplied. Homeostatic treats that as a source or monitoring-scope question, not a device error. An automatically discovered entity removed from the registry leaves monitoring scope; an explicit requirement stays visible until you change it.

The device summary does not assign an **error** from entity availability alone. Integration setup failures, authentication requests, and owner-defined situation alerts are separate signals with their own rules. Open the device's details to see exactly which entities and states contributed. Homeostatic cannot yet prove that a sensor is sending fresh readings or that a command succeeded; see [ADR 0025](docs/adr/0025-follow-home-assistant-availability-semantics.md) and the [specification](docs/spec.md) for the precise rules.

## Dashboard and cards

Administrators get a **Homeostatic** sidebar panel with **Overview**, **Issues**, **Sources**, **History**, **Notifications**, and **Settings**. You can also add a card to any dashboard:

```yaml
type: custom:homeostatic-card
view: overview   # or sources, history, notifications, configuration, functions, problems
```

A **Homeostatic** dashboard strategy is available in HA's new-dashboard dialog.

## Blueprints

| Blueprint | What it does |
| --- | --- |
| [Companion notifications](blueprints/automation/homeostatic/companion_notification.yaml) | Sends Homeostatic notification requests to the HA Companion app |
| [Function status light](blueprints/automation/homeostatic/function_status_light.yaml) | Shows a function's readiness on a light |
| [Problem logbook](blueprints/automation/homeostatic/problem_logbook.yaml) | Writes problem changes to the logbook |
| [Diagnostic state](blueprints/template/homeostatic/diagnostic_state.yaml) | Template blueprint for situation-alert sources |

## Documentation

| Guide | For |
| --- | --- |
| [User guide](docs/guide.md) | Monitoring rules, functions, situations, notification policy, actions, and operator controls |
| [Pilot guide](docs/pilot.md) | First install, first observation, controlled checks, rollback |
| [Event contract](docs/events.md) | Building your own automations on Homeostatic events |
| [Specification](docs/spec.md) | Exact implemented behavior and timings |
| [Roadmap](docs/roadmap.md) | What's planned |
| [Changelog](CHANGELOG.md) | What changed |

## Project status

**Beta (0.1.0b17).** Running in a real-house pilot. The dashboard, availability monitoring, functions, situations, notification policy, and operator controls work and are backed by executable scenarios and integration tests with 95% statement and branch coverage floors. Known limits:

- Whole-house monitoring of every entity on very large installs (6,000+ entities) doesn't yet meet responsiveness targets. Start with integrations and selected devices. See [runtime scaling](docs/testing/runtime-scaling.md).
- Freshness, detector liveness, and command-completion checks aren't built yet.
- Phone action buttons (acknowledge from the notification) are still consumer-side work.

Bug reports and pilot observations are welcome in [Issues](https://github.com/mjcumming/homeostatic/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [development setup](docs/development.md). In short:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
```

## License

[MIT](LICENSE). Report security issues as described in [SECURITY.md](SECURITY.md).
