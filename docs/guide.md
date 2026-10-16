# Homeostatic manual

Homeostatic helps you run Home Assistant by collecting reported problems and notifying people when they need to know. It watches the integrations and equipment you select, keeps the current issues together, and records how ended problems finished.

New to Homeostatic? [Install it](install.md), then follow [Your first monitoring setup](manual/first-run.md). The tutorial works even when there are no current issues.

## Three choices control your setup

| Choice | What it determines | Example |
| --- | --- | --- |
| Monitoring policy | Which sources to watch and what condition matters | Watch selected batteries for a low reading |
| Named notification | When to report and which delivery methods to use | Morning summary |
| Delivery method | Which configured Home Assistant destinations receive requests | A selected Companion app phone |

A policy can select more than one notification, or none. Monitoring continues while notification sending is off. [How issues and notifications work](how-it-works.md) explains the complete path from a reported problem to recovery.

## Find your way around

| Page | Use it to |
| --- | --- |
| Open issues | Review current reported problems and act on an issue |
| Monitoring | Find equipment, inspect current evidence and open the policies that watch it |
| Policies | Choose sources, detection settings and notification assignments |
| Notifications | Manage named notifications and delivery methods |
| History | Review ended problems and their recorded outcomes |
| Settings | Adjust installation timing and problem grouping from the header utility |

The panel and Homeostatic dashboard cards require a Home Assistant administrator account.

## Use it day to day

<a id="operator-controls"></a>

- [Review and respond to an issue](manual/issues.md)
- [Inspect equipment and its history](manual/monitoring.md)
- [Review ended problems](manual/history.md)
- [Work on equipment temporarily](manual/maintenance.md)

## Choose what to watch

<a id="choose-what-to-watch"></a>
<a id="watch-batteries"></a>
<a id="watch-ups-conditions"></a>
<a id="watch-vacuums"></a>
<a id="watch-temperature-limits"></a>
<a id="watch-thermostat-progress"></a>

- [Choose what to monitor](manual/policies.md): supplied policies, source selections, exclusions and overlapping checks.
- [Watch batteries](manual/batteries.md)
- [Watch UPS conditions](manual/ups.md)
- [Watch temperature limits](manual/temperature.md)
- [Watch thermostat progress](manual/thermostats.md)

The [monitoring reference](manual/monitoring-reference.md) covers all supported types, including Repairs, broken automations and vacuum errors.

## Arrange notifications

<a id="activate-notifications"></a>
<a id="choose-delivery-methods"></a>
<a id="when-a-notification-arrives"></a>

[Set up and change notifications](manual/notifications.md) covers destinations, explicit tests, named notifications, policy assignments and presence choices. The [settings reference](manual/settings-reference.md) lists defaults and compares acknowledgment, pauses and maintenance.

## Get help and maintain your installation

<a id="what-an-availability-problem-means"></a>
<a id="remove-homeostatic"></a>

- [Troubleshooting](troubleshooting.md)
- [What Homeostatic cannot establish](manual/limitations.md)
- [Upgrade, roll back or remove Homeostatic](manual/maintain-installation.md)
- [Add Homeostatic to a dashboard](manual/dashboards.md)

For automations that consume Homeostatic's existing results, use the [advanced interface reference](reference.md) and [events reference](events.md). The [roadmap](roadmap.md) covers work that is not ready for use, including automation-defined alerts.
