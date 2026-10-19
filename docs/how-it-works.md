# How Homeostatic works

Home Assistant already reports most of what goes wrong: an integration that can't load, an entity it can't reach, a low battery, an automation that names an entity that's gone. Homeostatic compares those reports with your policies, opens an issue when one shows a problem, and asks Home Assistant to notify people when the issue's notifications say so.

## From a report to an issue

Each policy sets an expectation for the sources it covers. An availability policy expects them to stay reachable, a battery policy expects the level to stay above its threshold, and a temperature policy expects readings to stay within your limits. When a source breaks the expectation, Homeostatic opens an issue. The issue stays open while the problem lasts and ends when the check sees recovery.

One source can have several checks. A smart plug can be reachable while its power reading is unavailable, and a battery can be low while the device still works. Each check gets its own issue, so you can treat them differently.

## What availability means

| Home Assistant reports | Availability |
| --- | --- |
| A value such as `on`, `off`, `idle` or a number | Available |
| `unknown` | Available: Home Assistant has the entity but no value right now |
| `unavailable` | Unavailable |
| Nothing yet, or a value restored at startup | Not known. It doesn't show in **Open issues** or send notifications, and it can't end an issue either. |

Availability is about Home Assistant's connection. A reachable sensor can still report an old reading, and a reachable lock might not have locked.

Homeostatic checks each entity on its own. A device groups its entities and their issues but has no availability of its own. If an entity stays missing or restored while its integration is loaded, the **Entities not provided** policy opens an issue after its wait, 24 hours by default.

## When several things fail together

When an integration fails, Homeostatic opens one issue for it that lists the equipment it took down, rather than an issue for every entity. Each affected source keeps its own notifications. If the Zigbee integration uses the morning summary and a leak detector on it uses Immediate, the outage still sends the leak detector's Immediate notification.

While an integration is working, each unavailable entity gets its own issue, even when several drop off at once. After a failed integration recovers, Homeostatic gives its devices a minute to reconnect, then splits anything still unavailable into separate issues. History records that as **Issues separated**.

## From an issue to a person

A policy names one or more notifications. Each named notification decides when to send, immediately, during daily hours or in a scheduled summary, and which delivery methods to use. Each delivery method lists the destinations.

An immediate notification waits for its collection delay, 60 seconds for Immediate, so problems that arrive together share one message. The wait starts with the first problem and doesn't stretch as more arrive, so a long outage can still send more than one message. A summary lists whatever is still open at its scheduled time, including acknowledged issues, so one issue can appear in an immediate message and again in the morning summary.

A notification is a request to Home Assistant. Homeostatic can't confirm that anyone received, read or heard it.

## Staying current

Homeostatic reacts to Home Assistant's events as they happen, so a device that goes unavailable is noticed straight away. Every 15 minutes it also rechecks the whole installation to catch anything an event didn't announce, such as an integration waiting for you to sign in again. Timed steps, like the recovery wait or the end of a pause, run on their own schedule.

After Home Assistant restarts, Homeostatic waits for your integrations to load before it opens new issues or sends notifications, so a restart doesn't look like an outage. Open issues, History, acknowledgments, pauses and notifications waiting to be sent all survive the restart.
