# Homeostatic

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="custom_components/homeostatic/brand/dark_icon.png"><img src="custom_components/homeostatic/brand/icon.png" alt="Homeostatic icon" width="88"></picture></p>

Most Home Assistant failures are silent. An integration fails after an update, a switch drops off the network, a battery dies, an automation breaks when an entity is renamed. You find out when friends are over and "Alexa, turn on the back deck lights" does nothing.

Home Assistant knew. It marked the deck switch unavailable on Tuesday and didn't tell anyone.

Homeostatic makes Home Assistant easier to run. It tracks what's broken, failing or misbehaving and tells you on your terms: right away, in a morning or evening summary, or once a week. With the deck switch on the morning summary, you'd have known on Wednesday. When a whole integration goes down, you get one issue listing everything behind it, instead of forty alerts.

It covers:

- Integrations that won't start, keep retrying, or need you to sign in again
- Devices and entities that go unavailable
- Batteries running low
- Vacuums that report an error
- Repairs Home Assistant raises, like an automation calling an action that no longer exists
- Situations in the house you ask it to watch, like water on the basement floor or the garage left open after dark

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Installations](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fanalytics.home-assistant.io%2Fcustom_integrations.json&query=%24.homeostatic.total&label=installs&color=41BDF5&logo=home-assistant&cacheSeconds=3600)](https://analytics.home-assistant.io/custom_integrations.json)
[![GitHub Release](https://img.shields.io/github/v/release/mjcumming/homeostatic?include_prereleases&sort=semver)](https://github.com/mjcumming/homeostatic/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/mjcumming/homeostatic/ci.yml?branch=main&label=CI)](https://github.com/mjcumming/homeostatic/actions/workflows/ci.yml)
[![Home Assistant](https://img.shields.io/badge/home%20assistant-2026.9.3+-blue.svg)](https://www.home-assistant.io/)
[![License](https://img.shields.io/github/license/mjcumming/homeostatic.svg)](LICENSE)

<p align="center">
  <img src="docs/images/overview.png" alt="Homeostatic Overview page with one open Zigbee issue" width="720"/>
</p>

<p align="center"><small>The Overview page in a demo house, with one Zigbee problem open.</small></p>

> Using Homeostatic? Please [star the repo](https://github.com/mjcumming/homeostatic). It helps other Home Assistant users find it.

## What it watches

A new install watches your integrations and Home Assistant's Repairs. You add devices, entities, batteries, vacuums and alerts in the panel. In **Sources**, you choose one source, or every current and future device on one integration. In **Policies**, you choose a check for the whole installation, including sources added later.

- A battery issue opens at 20% or less, or when the device reports a low warning. It's tracked apart from whether the device is available.
- A vacuum issue opens when Home Assistant reports the vacuum's activity as error. Cleaning, docked, idle, paused, or returning ends it. The notice is Immediate unless you choose otherwise for that vacuum, and it names the area Home Assistant assigned when there is one.
- A Repair's issue ends when Home Assistant stops reporting the Repair, or when you ignore it in Home Assistant.
- Alerts are ordinary Home Assistant automations made from a blueprint, so you get the full automation editor for the condition. If a sensor an alert needs goes offline, the alert shows *unknown*, so a dead leak sensor never reads as a dry floor.

## What you get when something goes wrong

An issue for each problem. It quotes what Home Assistant reported (setup failed, needs sign-in, retrying), lists the entities affected, suggests what to try, and shows recovery as it happens. When an integration fails, the devices and entities you watch on it are listed on that one issue instead of each raising its own.

Notifications on your schedule. Everything you watch has one of six reporting choices, and all Repairs share one:

| Choice | What happens |
| --- | --- |
| Immediate | Sent right away, overnight included. A vacuum error starts here. |
| Immediate with acknowledgment | Sent right away and repeated every 30 minutes until someone taps Acknowledge or the problem clears |
| Morning summary | In the 8:00 summary. Repairs start here. |
| Evening summary | In the 18:00 summary |
| Weekly summary | In the Sunday 9:00 summary. Integrations, devices, entities and batteries start here. |
| Dashboard only | Never sent. It shows in the panel. |

You can change the summary times and choose which people get each kind. Notifications go to their phones through the Home Assistant Companion app, and they don't need to be admins to tap Acknowledge. Notifications stay off until you turn them on. After a Home Assistant restart, Homeostatic waits for your integrations to finish loading, then sends one summary instead of a burst.

Controls for problems you already know about:

- *Acknowledge* tells everyone that someone has seen the issue. It stops the repeat reminders, and the issue stays open until the problem clears.
- *Pause alerts* silences one issue for up to a week.
- *Working on this equipment* is for planned work. It shows what will be affected, then holds off new issues for that equipment until the end time you set.

History of ended issues for 30 days, and a Home Assistant event for every change to an issue if you want to build your own automations on top.

## The panel

Homeostatic adds a sidebar panel for administrators:

| Page | What it's for |
| --- | --- |
| Overview | What's open and what's being watched |
| Issues | Every open problem, with its details and controls |
| Sources | Every integration, device, entity, battery and vacuum Home Assistant knows about. Choose what to watch for one source. |
| Policies | Turn Integrations, Devices, Batteries, Vacuums, and Repairs on or off for current and future sources. Add a policy for an area, floor, label, or another condition. |
| Notifications | People, phones, schedules, and the switch that turns notifications on |
| Settings | Timing and problem grouping |
| History | Ended issues from the last 30 days |

If you use [TopoMation](https://github.com/mjcumming/topomation), Sources can also show your devices by its locations (property, buildings, floors, rooms) as well as by Home Assistant's floors and areas.

## How it works

Homeostatic builds a map of what depends on what: each device and entity you watch depends on its integration. When things fail, Homeostatic works out which failure explains the others and keeps one issue for that failure. The reporting choice decides when someone hears about it.

The reasoning comes from [Health Tree](https://github.com/mjcumming/health-tree), a separate Python library with no Home Assistant code in it. Homeostatic connects it to Home Assistant, keeps the history, draws the panel and sends the notifications.

## What it can't tell you

Homeostatic only knows what Home Assistant reports. If Home Assistant says a sensor is available, Homeostatic can't tell whether its reading is fresh, whether a detector has hung, or whether a command actually worked. Checks for those are on the [roadmap](docs/roadmap.md). The [user guide](docs/guide.md#what-an-availability-problem-means) explains what an availability warning does and doesn't mean.

It can't tell you Home Assistant itself has stopped, because it runs inside it. You need something outside Home Assistant for that.

Watching every entity on a very large install (6,000 or more) is still too slow. Start with your integrations and the devices that matter.

The full list is in [Known limitations](docs/troubleshooting.md#known-limitations).

## Requirements

- Home Assistant 2026.9.3 or newer.
- Internet access the first time it loads, so Home Assistant can install the [health-tree](https://pypi.org/project/health-tree/) library from PyPI. After that, Homeostatic runs locally.
- An administrator account to set it up.

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) and choose **Custom repositories**.
2. Add `https://github.com/mjcumming/homeostatic` with the type **Integration**.
3. Find **Homeostatic**, download version **1.5.0**, and restart Home Assistant.

[![Open your Home Assistant instance and open a repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mjcumming&repository=homeostatic&category=integration)

### Manual

1. Download `homeostatic-1.5.0.zip` and its checksum from the [1.5.0 release](https://github.com/mjcumming/homeostatic/releases/tag/v1.5.0).
2. Copy its `custom_components/homeostatic` folder into your Home Assistant config folder, so you end up with `<config>/custom_components/homeostatic/manifest.json`. Replace any older copy completely.
3. Restart Home Assistant.

[Install and first run](docs/install.md) covers backups, checking the download and rolling back.

## Getting started

1. Go to **Settings → Devices & services → Add integration** and add **Homeostatic**.

   [![Open your Home Assistant instance and start setting up Homeostatic.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=homeostatic)

2. Open **Homeostatic** in the sidebar. It's watching your integrations and Home Assistant's Repairs, and nothing else yet.
3. Open **Sources**, pick an integration or device you know well, and choose what to watch in its **Settings**. You'll see what the change does before you save it. Start with a few things that matter and widen from there.
4. Open **Policies** for a check that should cover sources added later. **Integrations** and **Repairs** start on. **Devices**, **Batteries**, and **Vacuums** start off; select **Monitor all devices**, **Monitor all batteries**, or **Monitor all vacuums** to turn one on. **Add policy** matches an area, floor, label, or another condition. You'll see what the change covers before you save it.
5. Leave notifications off for a day or two and see what turns up. When it looks right, open **Notifications**, pick the people and their phones, check the schedules and turn notifications on. Homeostatic sends to the Companion app itself.

The [user guide](docs/guide.md) covers the rest: one integration's devices, policies, batteries, vacuums, notifications and the controls.

## Create your own alert

The condition lives in a Home Assistant automation, made from the Homeostatic alert blueprint. Homeostatic handles the issue, its history, the notifications and the Acknowledge button.

1. Import the [Homeostatic alert blueprint](https://github.com/mjcumming/homeostatic/blob/main/blueprints/automation/homeostatic/alert.yaml) under **Settings → Automations & scenes → Blueprints**. Or copy `alert.yaml` from the release zip into `blueprints/automation/homeostatic/` and reload automations.
2. Create an automation from the blueprint and fill it in:

   | Field | Example |
   | --- | --- |
   | Alert name | Basement water leak |
   | Notification message | Water detected near the basement water heater. |
   | Active when | Basement water sensor is Wet |
   | Required evidence | Basement water sensor |
   | Reporting preference | Immediate with acknowledgment |

   *Required evidence* is every entity the condition or the message depends on. If one of them goes unavailable, the alert shows unknown rather than clear.

3. Save it. While the condition holds there's one open issue, and it resolves when the condition clears. Turning the automation off doesn't count as the condition clearing.

Start a new alert on **Dashboard only** until you trust the condition. Both immediate choices send overnight.

The [alert guide](docs/automation-situations.md) covers writing the automation by hand, retiring an alert and converting alerts made the older way.

## Screenshots

From the same demo house as above.

<img src="docs/images/issue.png" alt="A Zigbee issue with its reported condition, next step and notification status" width="720"/>

<img src="docs/images/sources.png" alt="Sources page with monitored Zigbee devices and the failed connection" width="720"/>

<img src="docs/images/notifications.png" alt="Notifications page with a phone and reporting schedules" width="600"/>

<img src="docs/images/history.png" alt="History page with three ended availability problems" width="720"/>

## Dashboard cards

Any panel page can go on your own dashboards as a card. The card is for administrators, like the panel.

```yaml
type: custom:homeostatic-card
view: overview
```

| `view` | Shows |
| --- | --- |
| `overview` | Overview |
| `issues` | Issues |
| `sources` | Sources |
| `policies` | Policies |
| `notifications` | Notifications |
| `settings` | Settings |
| `history` | History |

There's also a ready-made Homeostatic dashboard. Pick it when you add a new dashboard in Home Assistant.

## Blueprints

| Blueprint | What it does |
| --- | --- |
| [Homeostatic alert](blueprints/automation/homeostatic/alert.yaml) | Makes an alert from Home Assistant conditions. Start here. |
| [Problem logbook](blueprints/automation/homeostatic/problem_logbook.yaml) | Writes issue changes to the logbook |
| [Report a situation](blueprints/automation/homeostatic/report_situation.yaml) | The older way to make an alert. It still works, but new alerts should use the alert blueprint. |
| [Diagnostic state](blueprints/template/homeostatic/diagnostic_state.yaml) | Turns a device's diagnostic entity, like a communication-error sensor, into a problem sensor Homeostatic can watch |

## Removing Homeostatic

1. Go to **Settings → Devices & services**, open Homeostatic and delete it. This also deletes its stored issues and history.
2. Remove it in HACS, or delete `<config>/custom_components/homeostatic`.
3. Restart Home Assistant.

Alerts you made from the blueprint are ordinary automations, so delete or disable those too. The [user guide](docs/guide.md#remove-homeostatic) lists everything else to tidy up.

## Documentation

| Guide | What's in it |
| --- | --- |
| [Install and first run](docs/install.md) | A guided first setup, from install to a test notification, plus upgrading and rolling back |
| [User guide](docs/guide.md) | Choosing what to watch, batteries, vacuums, notifications, the controls and removal |
| [Alerts from automations](docs/automation-situations.md) | Making alerts for conditions in the house |
| [How it works](docs/how-it-works.md) | How failures become issues and when they are reported |
| [Troubleshooting](docs/troubleshooting.md) | Common problems, and the full list of known limitations |
| [Reference](docs/reference.md) | Every option, timing, entity, action, card setting and blueprint |
| [Events](docs/events.md) | Building your own automations on Homeostatic's events |
| [Specification](docs/spec.md) | Exactly how it behaves, with every timing |
| [Decisions](docs/adr/README.md) | Why it works the way it does |
| [Roadmap](docs/roadmap.md) | What's next |
| [Changelog](CHANGELOG.md) | What changed |

Bug reports are welcome in [GitHub Issues](https://github.com/mjcumming/homeostatic/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [development setup](docs/development.md). Behavior is written down in the [spec](docs/spec.md) before it changes, every change comes with a test scenario, and the tests run against an isolated Home Assistant, so nothing reaches a real phone.

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
```

## License

[MIT](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
