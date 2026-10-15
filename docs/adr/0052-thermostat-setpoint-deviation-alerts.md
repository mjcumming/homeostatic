# ADR 0052: Detect thermostat setpoint deviation with progress-aware checks

**Status:** Accepted; reporting assignment model superseded by [ADR 0055](0055-separate-notification-schedules-and-methods.md)
**Implementation status:** See the [roadmap](../roadmap.md#current-work).
**Date:** 2026-10-11
**Updated:** 2026-10-12

## Context

A thermostat can remain available while the space it controls stays above its cooling target or below its heating target. The owner wants a standard equipment check for inadequate heating or cooling. Independent temperature limits, including freeze risk and refrigerator or freezer warming, will have a separate decision record.

Home Assistant's [climate contract](https://developers.home-assistant.io/docs/core/entity/climate/) distinguishes requested HVAC mode from reported HVAC action. Action is optional. `heat_cool` requests a target range; `auto` can represent schedules or learned behavior and cannot be treated as a synonym for `heat_cool`. Current temperature and targets can be absent. State temperatures use the climate entity's reported `temperature_unit`.

A target change commonly creates a large mismatch while equipment is working. A fixed allowance can expire during useful recovery. Progress-aware qualification can distinguish improving, stalled and worsening temperature without predicting a home's thermal behavior.

## Agreed scope and architecture

Implement a built-in Homeostatic equipment check, following the catalog pattern used for batteries and vacuums. Use only the thermostat's own reported current temperature and applicable target. External sensors, overheating while heating, and overcooling while cooling are outside this check's scope.

For `heat`, evaluate temperature below target. For `cool`, evaluate temperature above target. For `heat_cool`, use the low target for heating and high target for cooling. HVAC action is supporting evidence rather than a prerequisite: equipment that never starts must not escape detection.

Homeostatic owns thermostat interpretation, progress state and evaluation deadlines. health-tree owns the existing episode, acknowledgment and attention-policy lifecycle. Notification criteria, profiles, recipients, scheduling, reminders and delivery paths remain the same as for other equipment checks. This introduces no thermostat logic into health-tree or separate notification mechanism.

ADR 0034 continues to own arbitrary automation-authored situation alerts. This bounded equipment check does not change that workflow. A reusable automation remains an alternative for custom logic.

The scope, architecture and default policy were agreed in discussion. The working tree implements the bounded producer and named-policy enrollment. Isolated producer and Home Assistant lifecycle tests validate the transitions; release and real-device validation remain separate milestones.

## Default progress policy

The default deviation margin is **2 °F**. The default meaningful progress is **2 °F toward target within one hour**. The default worsening threshold is **2 °F away from target**, with no confirmation delay. These thresholds and the progress interval are monitoring-policy parameters. The owner can duplicate the default monitoring policy and adjust them for a different home or system. This is the decided configuration model, not a claim that policy duplication already exists.

The 2 °F value is a tolerance for deciding whether reported change is meaningful. It does not assert verified measurement accuracy of ±2 °F for every thermostat. As a temperature difference it equals 10/9 °C; conversion must not apply the Fahrenheit absolute-temperature offset.

Progress qualification applies whenever temperature remains beyond the configured deviation margin, including with an established target. It is not limited to target or mode changes. The permitted margin defines successful conditioning as well as the boundary for qualification. A room close to target must not open an issue merely because it does not move another 2 °F.

While qualifying a possible issue:

- Meaningful progress renews the opportunity to reach target.
- No meaningful progress within one hour qualifies a stalled condition.
- Movement away from target by at least the worsening threshold opens or updates an issue immediately while temperature is outside the permitted margin. For heating this is a temperature fall; for cooling it is a temperature rise. Do not wait for the one-hour progress deadline or an additional confirmation interval.

The default reporting choice for a worsening finding is Immediate, through the existing attention policy and delivery path. Detection does not directly send a notification or enable outgoing requests. Preserve explicit owner reporting choices and the existing delivery controls. A worsening finding on an already-open stalled issue must be evaluated through the same policy without creating a duplicate issue.

Once an issue opens, progress alone does not resolve it. Entering the permitted deviation margin resolves it: heating clears at or above target minus margin; cooling clears at or below target plus margin. Equality is permitted. With the default margin and a heating target of 70 °F, readings of 68 °F and 69 °F satisfy the policy. Exact target attainment and a separate clear threshold are not required. No maximum total recovery time is imposed while continuing meaningful progress renews the allowance.

## Implementation guidance for progress accounting

Keep a comparison temperature, best temperature reached during the current attempt, and time of last credited progress. Credit a new step only when the best reading improves by at least the progress threshold beyond the last credited comparison. Smaller improvements can accumulate toward a step. Returning to an already reached temperature does not count as new progress, so oscillation cannot indefinitely renew the allowance.

For a heating target of 70 °F and starting reading of 65 °F, reaching 67 °F within the hour earns another interval if still beyond the deviation margin. Remaining at 65 °F for the hour qualifies as stalled. A fall from the starting reading of 65 °F to 63 °F reaches the worsening threshold immediately. Entering the permitted margin ends qualification or clears an open issue without requiring a further full progress step. Cooling reverses the comparisons.

The comparison and best-reading approach is implementation guidance, not a requirement for a particular storage algorithm. The implementation specification and fixtures must define the worsening reference temperature for the unchanged target/mode context, exact deadline ordering and rounding. A target change must not manufacture movement away from target. Keep state bounded per thermostat rather than requiring unbounded temperature history or a learned thermal model.

## Evidence and lifecycle boundaries

Missing, unknown, unavailable, restored, nonnumeric or nonfinite required values establish neither deviation nor recovery. Existing availability monitoring handles loss of contact. A reachable thermostat lacking a usable temperature or target means this check cannot evaluate; it is not automatically offline. Re-reading a cached HA value does not establish an independent physical sample or physical freshness.

A target or conditioning-mode change establishes a new comparison context. A smaller gap caused by changing target is not measured temperature progress. Ordinary heating/cooling activity cycles must not reset that context. Rounding and unit changes must not create false target-change events.

Restart and evidence-gap handling must preserve an open issue without asserting recovery or constructing a trend across unobserved time. Define which progress state is persisted and when a new observation period is required.

Use wording such as "temperature has not made the expected progress toward the heating target." Include the thermostat, space, mode, measured temperature, target, observed change and interval. The default is an investigation threshold, not proof of an equipment defect. Some hydronic and heat-pump systems have slow response times, as described in [Natural Resources Canada's operating guidance](https://natural-resources.canada.ca/energy-efficiency/home-energy-efficiency/keeping-heat-section-9-operating-your-house-thermostats-water-heaters-furnaces-other-heatingcooling-systems).

## Implementation contract

Implementation verification, October 12, 2026: the unit statement in Context above does not apply to the supported [Core 2026.9 implementation](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/climate/__init__.py). That version writes state temperatures in the installation's configured temperature unit. The adapter passes that unit explicitly rather than reading a nonexistent entity attribute or inferring native hardware units. This corrects the evidence contract without changing the accepted monitoring behavior.

The [implementation specification](../spec.md#configured-temperature-producers) owns precise baselines and transitions. Worsening compares with the best temperature reached in the current target, mode and conditioning-direction context. Progress at deadline equality is evaluated before stall; progress first observed after the deadline cannot erase a qualified stall. Absolute temperatures and differences normalize separately, with Celsius comparisons rounded to six decimals. Gaps and restart discard pending qualification and trend history while retaining a qualified finding. Stable source and policy identities keep renames from resetting monitoring; detection edits end the old expectation. `auto` is not enrolled.

Changing the target to an already-satisfied value may end the configured condition, but the explanation must distinguish that from measured temperature improvement. Turning conditioning off or selecting an unsupported mode ends the applicable monitoring expectation without proving equipment repair. Define these transitions using existing lifecycle APIs and test them.

Freeze and overheat protection belong to independent temperature-limit policies under ADR 0053. The thermostat check does not add absolute danger thresholds or special notification severity based on how cold or hot the room becomes.

## Alternatives and validation

A fixed target-change allowance is easier to configure but can alert during useful recovery. Learning recovery rates or using weather and occupancy adds evidence requirements and assumptions; neither is needed for this progress-threshold design.

Before implementation is complete, executable scenarios must cover meaningful and sub-threshold progress, oscillation, stall deadlines, immediate worsening at the threshold, worsening of an already-open stalled issue, entering the permitted margin with less than a full progress step, equality at the margin, ranged targets, absent HVAC action, target and mode changes, missing evidence, unit conversion, custom parameters and restart. Use isolated Home Assistant tests with mocked notification services and real-device traces before claiming physical failure detection.
