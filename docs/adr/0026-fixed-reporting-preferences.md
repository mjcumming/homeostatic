# ADR 0026: Use five fixed reporting preferences

**Status:** Accepted product direction; details settled by [ADR 0027](0027-reporting-defaults-and-delivery.md)
**Date:** 2026-09-28
**Decider:** Michael Cumming

**Partially supersedes:** ADR 0015's broad per-person levels as the sufficient owner configuration model, and ADR 0021's deferral of guided digest configuration, for the five built-in choices only. Existing behavior remains until the replacement is specified and implemented.

## Context

The owner needs different reporting for different devices and conditions: loss of important monitoring should arrive immediately, while a less important outage can wait for a weekly summary. Broad importance levels and person filters do not provide a usable assignment workflow.

Acknowledgment adds complexity but serves a distinct purpose. Loss of leak monitoring can warrant one immediate notification; detected water can warrant repeated attention until someone acknowledges it. Both must arrive during quiet hours.

## Decision

- Provide five built-in choices: Immediate, Immediate - acknowledgment required, Morning summary, Evening summary, and Weekly summary.
- Both immediate choices bypass quiet hours. Do not add an owner-facing urgency category for delivery restricted to regular hours.
- Acknowledgment-required reporting repeats until acknowledged or resolved. Acknowledgment remains awareness, not recovery or repair.
- Configure report times, weekly day, time zone, and recipients within Homeostatic's Notifications page. Owners need no separate Home Assistant schedule helpers or automations.
- Assign preferences to devices and supported conditions through Sources. Detailed defaults, precedence, and UI controls remain to be designed.
- Keep the five presets in the adapter. Preserve HealthTree ownership of generic attention behavior and its existing closed types.
- The later [reporting defaults decision](0027-reporting-defaults-and-delivery.md) and [specification](../spec.md#fixed-reporting-preferences-adr-0027) settle these details. Example times and reminder intervals in this decision were not approved defaults.

This decision does not settle summary contents, retention, reminder frequency, recipient filtering, dependency grouping, migration, or the household default. Existing person/delivery infrastructure remains useful; the fixed choices replace its claim to be a sufficient reporting-preference interface.

## Options considered

- **Only immediate without acknowledgment.** Simpler, but misses the repeated-attention case for detected water.
- **Immediate constrained by quiet hours, with another urgent category.** Rejected by the owner: immediate includes overnight.
- **An unrestricted rule builder.** More flexibility than needed for everyday device configuration.
- **Separate Home Assistant schedule helpers or owner-built automations.** Requires setup that Homeostatic can manage.
- **Importance levels alone.** Cannot express report schedules or distinguish conditions on one device.

## Consequences

The owner chooses from a bounded vocabulary. Device configuration describes the reporting outcome instead of an inferred priority.

Weekly schedules require generic library support. Historical summaries, if adopted, require defined accounting and retention; existing active-only digests are insufficient. Shared failures need an explicit rule for combining assigned preferences.

Update the integration specification and HealthTree RFP before runtime implementation, with executable scenarios. This ADR records direction, not delivered functionality.
