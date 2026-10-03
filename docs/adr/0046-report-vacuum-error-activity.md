# ADR 0046: Report a vacuum's error activity as an issue

**Status:** Accepted
**Date:** 2026-10-03

## Context

Home Assistant's vacuum entity reports one of six activities: cleaning, docked, idle, paused, returning, and error. Error means the vacuum encountered an error while cleaning. Integrations that follow the vacuum model map their own status codes onto that activity. A fault left on some other sensor never becomes this state.

A low battery is already a Homeostatic issue. Home Assistant standardized the signal, the current reading both opens and ends the issue, the owner turns the check on, and the check stays separate from availability. A vacuum in error has that same shape. Watching it from an alert automation would repeat one condition the entity model already defines, once per vacuum.

The household default for a newly monitored source is the weekly summary. A vacuum reporting an error is happening now, so that default would hold the notice until the next summary. Immediate with acknowledgment would send again every 30 minutes until someone acknowledges it. That repeat is for a condition someone has to confirm they saw. A vacuum error needs one notice, and the issue stays open until the activity changes.

A cover that never reaches a commanded position has no current state that means the move failed. That case stays an owner-written automation and is outside this decision. Homeostatic does not command the vacuum, retry a job, or send it back to the dock.

## Decision

A `vacuum` entity is a monitorable source, enrolled the way a battery is. Discovery lists vacuum entities as candidates. None are watched until a reviewed catalog rule selects the vacuum error check. An availability rule leaves this check off, and a vacuum rule leaves availability off. A broad rule may cover current and future vacuum entities. An exclusion wins.

The check reads the entity's current activity:

| Activity | Result |
| --- | --- |
| `cleaning`, `docked`, `idle`, `paused`, `returning` | `pass` |
| `error` | `fail` / `vacuum_error` |
| `unavailable`, `unknown`, missing, restored, or any other value | `unknown` |

Unknown keeps an open issue open. The check has no raise hold and no clear hold, so the issue follows the activity Home Assistant is reporting. The finding says Home Assistant reports the vacuum in error. When Home Assistant has an area for that vacuum, the notification names it. That area is the device's assignment in Home Assistant.

The source is its own node and has no dependency edges. A failed integration does not absorb it. When the entity cannot be read, this check is unknown. If the owner also watches the vacuum's availability, that remains a separate issue.

Starting to watch a vacuum assigns it the Immediate reporting choice. Immediate sends once, including overnight, and does not repeat. The owner can change that vacuum's choice the same way as any other source. Turning notifications on remains a separate reviewed step. Discovering a vacuum sends nothing by itself.

## Consequences

Once notifications are on, a newly reported vacuum error is sent immediately, including overnight. The issue ends when Home Assistant reports cleaning, docked, idle, paused, or returning. A momentary error activity notifies and then ends, because the check does not wait.

A vacuum whose integration never uses the error activity stays quiet under this check. A fault that exists only on another entity stays on the alert path. An integration that maps a vendor condition such as offline onto error produces this issue while the entity state is error.

The specification, user guide, and executable scenarios are updated when the check is implemented. This decision adds no cover check and no command-completion check.
