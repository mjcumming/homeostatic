# ADR 0053: Check user-configured temperature limits

**Status:** Accepted; producer and policy integration implemented in the working tree, with isolated validation; reporting assignment model superseded by [ADR 0055](0055-separate-notification-schedules-and-methods.md)
**Date:** 2026-10-11
**Updated:** 2026-10-12

## Context

An owner may want an alert before a building or pipe area freezes, or when a refrigerator or freezer gets too warm. These conditions use a permitted temperature range independent of any thermostat's target or mode. A temperature sensor's placement and the owner's purpose determine the useful limits.

The owner wants numeric limits in the UI and the ability to create different monitoring policies with different settings. This check therefore has no universal temperature limit or common duration selected for every use. Freeze risk and refrigeration warming are examples of the same comparison pattern.

## Decision

### Built-in check and configuration

Add a built-in Homeostatic temperature-limit check. The owner selects a temperature sensor and configures a minimum, a maximum, or both. Require at least one bound. Display numeric limits with their units. If both are present, reject a minimum greater than the maximum. Validate finite numeric values and supported temperature units.

Each monitoring policy contains its selected sources, enabled bounds, permitted out-of-range duration and reporting-profile assignment. Let the owner duplicate a policy and change its source selection, limits, duration or reporting choice. A new policy has an independent identity; editing or renaming retains identity. These are decided settings and workflows, not claims about currently available policy duplication or per-rule duration overrides.

Monitoring policies define which readings constitute a problem. Notification profiles define recipients and when and how that problem is reported. Reuse the existing profile assignment and delivery path. Planned profile creation and duplication belong to the existing editable-notification-profiles roadmap item, not a second temperature-specific notification editor.

### Condition and duration

A reading is outside the permitted range when it is below the enabled minimum or above the enabled maximum. Equality at either bound is permitted. A policy with only a minimum watches cold conditions; one with only a maximum watches warm conditions.

Open an issue after the reported temperature remains continuously outside the range for the configured duration. The duration is a detection setting, separate from notification schedules and reminders. Allow an explicitly configured zero duration for immediate detection. There is no universal duration default: setup requires the owner to choose a duration before activation. Use-specific presets may be considered later.

A current valid reading inside the permitted range cancels pending qualification or clears an open issue. Use the configured range for both detection and recovery, without adding a required second temperature threshold. The out-of-range duration filters brief excursions before opening; acknowledgement never changes the condition.

If a reported reading moves directly from below the minimum to above the maximum without an observed in-range reading, the condition is still outside the range. Preserve its pending qualification or open issue and update the evidence; do not invent an unobserved recovery. Separate low-only and high-only policies can be created when the owner wants distinct issue identities or reporting choices.

No thermostat mode, target-change allowance or progress test applies. Movement toward the range does not excuse a reading that has remained outside it for the chosen duration.

### Evidence and lifecycle

Read temperature from the selected Home Assistant sensor and normalize its reported units against the configured bounds. Missing, unknown, unavailable, restored, nonnumeric or nonfinite readings establish neither temperature failure nor recovery. Treat them as unknown evidence. Availability monitoring handles loss of contact; a missing numeric value does not itself establish that the device is offline.

For pending qualification, a gap in required evidence breaks the observed continuous interval. Start a new qualification interval when current usable evidence returns. Keep an already-open issue open through the gap and resolve it only when usable evidence establishes the condition has ended. Repeated evaluation of a cached value does not prove physical sensor freshness.

Keep state bounded per selected sensor and policy. Homeostatic owns numeric interpretation, qualification timing and persisted producer state. health-tree owns the ordinary issue, acknowledgment and attention lifecycle. Do not add temperature semantics or new closed enums to health-tree.

Use stable source and policy identities rather than editable names. An issue should show the sensor, measured temperature, violated bound, configured range and observed out-of-range duration. A removed policy or sensor is a monitoring-scope change, not measured recovery. A settings change invalidates its unsaved preview and must be reviewed before saving through the existing guarded configuration path.

### Scope and implementation requirements

The configurable range, duration and shared reporting model were agreed in discussion. The working tree implements the producer and independent named-policy enrollment. The [implementation specification](../spec.md#configured-temperature-producers) defines restart and gap handling: pending qualification restarts, while already-qualified findings persist until usable recovery evidence. Detection edits retire the old expectation; renames retain identity. Overlapping temperature policies remain independent. Generated notification assignments keep unknown temperature evidence on the dashboard, avoiding an additional outgoing temperature report when availability evidence is missing. Isolated producer and Home Assistant lifecycle tests cover these transitions, source removal, future group membership and unit changes. Release validation and real-device evidence remain separate milestones.

No physical freeze prediction, food-safety determination, equipment diagnosis, automatic equipment control or automatic selection of limits is implied. The issue reports the configured sensor threshold condition.

## Alternatives and consequences

A freeze-specific check and separate refrigeration checks would duplicate the same bounded comparison and timing behavior. One configurable check supports those purposes with owner-selected numbers.

An owner-written automation can express special conditions, but should not be required for this ordinary numeric check. Arbitrary automation-authored situations remain under ADR 0034. A mandatory separate clear threshold would add another setup decision; the range-and-duration rule keeps the numeric setup small.

## Validation before implementation is complete

Executable scenarios must cover low-only, high-only and two-sided bounds; exact boundary equality; duration zero and deadline equality; brief excursions; recovery; movement directly between low and high violations; missing or invalid readings during qualification and an open issue; unit conversion; restart; sensor rename or removal; and policy duplication and edits. Test reporting through existing paths with isolated Home Assistant and mocked notification services. Verify sensor semantics with real-device evidence before claiming physical-condition detection.
