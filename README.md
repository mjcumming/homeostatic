# Homeostatic

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="custom_components/homeostatic/brand/dark_icon.png"><img src="custom_components/homeostatic/brand/icon.png" alt="Homeostatic icon" width="88"></picture></p>

Home Assistant usually knows when something breaks: an integration that can't connect, a lock it can't reach, a low battery, a Repair. It just doesn't tell anyone. Homeostatic watches for those problems, keeps them in one list, and notifies people on the schedule you choose.

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![GitHub Release](https://img.shields.io/github/v/release/mjcumming/homeostatic?sort=semver)](https://github.com/mjcumming/homeostatic/releases)
[![CI](https://github.com/mjcumming/homeostatic/actions/workflows/ci.yml/badge.svg)](https://github.com/mjcumming/homeostatic/actions/workflows/ci.yml)

## What you get

- An alert at night when a lock, camera, alarm panel, or smoke, carbon monoxide, gas or leak detector drops off Home Assistant.
- A morning summary of everything else that's unavailable, plus Repairs and automations that name entities that no longer exist.
- One issue when an integration fails, listing the equipment it took down.
- Optional checks for low batteries, vacuum errors, UPS power and battery, temperature limits, and thermostats that can't reach their target.
- Acknowledge, pause or stop watching an issue in the panel, or acknowledge it from the notification on your phone.

![Open issues grouped by integration and device](docs/images/manual-open-issues.png)

## Install

You need Home Assistant 2026.9.3 or newer and an administrator account.

In HACS, add `https://github.com/mjcumming/homeostatic` as a custom repository of type **Integration**, download Homeostatic and restart Home Assistant. Then add **Homeostatic** under **Settings → Devices & services → Add integration**. The [install page](docs/install.md) covers manual installation, updates and removal.

Notifications start off. Follow [Get started](docs/manual/first-run.md) to send a test to your phone and turn them on.

## Documentation

The [manual](docs/guide.md) covers responding to issues, choosing what to watch and setting up notifications. [How Homeostatic works](docs/how-it-works.md) explains the model, and [Troubleshooting](docs/troubleshooting.md) lists what it can't tell you.

## Contribute

[Contributing](CONTRIBUTING.md) explains development. The [specification](docs/spec.md) owns current behavior, and the [roadmap](docs/roadmap.md) lists what's next. The decision engine is the separate [health-tree](https://github.com/mjcumming/health-tree) library. Homeostatic is licensed under the [MIT license](LICENSE).
