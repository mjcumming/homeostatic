# Watch thermostat progress

[Homeostatic manual](../guide.md)

Use **Thermostat progress** to report when a thermostat's temperature stops making the configured progress toward its target or moves away from it. Homeostatic reads the thermostat's own current temperature, target and mode.

This check supports **heat**, **cool** and **heat_cool**. Before starting, confirm that the thermostat reports a usable current temperature and the target needed for its mode. Use [Temperature limits](temperature.md) for a separate lower or upper temperature boundary.

## Add the policy

1. Open **Policies → Add policy**, choose **Thermostat progress**, and select **Continue**.
2. Name the policy. Under **Include**, choose **Selected thermostats…**, select the thermostat and choose **Done**.
3. Review **When it becomes a problem**:

   | Field | Starting value | Meaning |
   | --- | --- | --- |
   | Temperature unit | °F | Unit for the following temperature differences. |
   | Deviation from target | 2 | Permitted distance from the applicable target. |
   | Required progress | 2 | Improvement that earns a new progress interval. |
   | Worsening threshold | 2 | Movement away from the best temperature reached that opens an issue while outside the permitted margin. |
   | Progress window (seconds) | 3600 | Time allowed to make the required progress. |

   Choose values that suit the system. The deviation may be zero; progress, worsening and the progress window must be positive. If changing the temperature unit, review all numeric values in that unit.
4. Review **Notifications**. A new policy selects **Urgent** when that named notification exists. Its supplied timing is daily from 08:00 to 22:00; configure timing and delivery through [Set up and change notifications](notifications.md).
5. Turn **Policy enabled** on and select **Save policy**. Open the thermostat in **Monitoring** to inspect the policy, temperature and target.

## Understand the result

Heating checks a temperature below the target minus the permitted deviation. Cooling checks a temperature above the target plus that deviation. **heat_cool** uses its lower heating target and upper cooling target. A reading on the permitted boundary satisfies the check.

With the starting settings and a heating target of 70 °F, a reported 65 °F begins a progress interval. Reaching 67 °F within an hour earns a new interval. Remaining at 65 °F for the hour opens a stalled-temperature issue. Falling from the best temperature reached by 2 °F opens a worsening issue without waiting for the hour to end. Smaller improvements accumulate; returning to a temperature already reached earns no new progress.

Once an issue opens, improvement alone does not clear it. The temperature must enter the permitted margin: in this example, 68 °F or above. Changing the target to an already-satisfied value can also end the configured condition; the finding distinguishes that target change from measured improvement.

A target or mode change starts a new comparison. Turning the thermostat off or selecting an unsupported mode, including **auto**, ends that monitoring expectation without establishing recovery. Missing, unknown, unavailable or malformed temperature/target readings leave an open issue unresolved and discard pending progress comparisons. Usable evidence starts a new interval. Restart has the same boundary for pending comparisons and preserves an existing issue.

Changes to the thermostat's reported heating or cooling activity do not restart the progress interval. Homeostatic can therefore report lack of progress even when the thermostat never reports an active heating or cooling action.

See [Monitoring types and defaults](monitoring-reference.md) for the full check list and [What Homeostatic cannot establish](limitations.md) for evidence limits.
