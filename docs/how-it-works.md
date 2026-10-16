# How Homeostatic works

[Homeostatic manual](guide.md)

Home Assistant already reports many things that go wrong: an integration cannot load, an entity is unavailable, a battery is low or an automation names an entity that no longer exists. Homeostatic watches the conditions you choose, keeps track of their issues and requests notifications on your schedule.

## From a report to an issue

A policy connects a source to an expectation. An availability policy expects its selected equipment to remain available through Home Assistant. A battery policy expects the reported charge to stay above its threshold. A temperature policy applies the limits and duration you choose.

When the evidence meets a policy's problem condition, Homeostatic opens an issue. Further reports update that issue while the problem continues. The relevant recovery evidence ends it. Acknowledgment records that someone has seen the issue; it does not change the condition being monitored.

One source can have several checks. A smart plug can be available while its power-reading entity is unavailable. A battery can be low while the device still communicates. The separate findings let you investigate and choose notifications for each condition.

## Availability and missing readings

Homeostatic distinguishes Home Assistant's current state from the absence of a current report.

| Home Assistant evidence | Availability meaning |
| --- | --- |
| A current value such as `on`, `off`, `idle` or a number | The entity is available through Home Assistant. |
| A current `unknown` value | Home Assistant supplies a state but has no value for it. This is available evidence for an availability check. |
| `unavailable` | Home Assistant cannot provide that feature or reading right now. |
| No current state, or a value restored during startup | There is insufficient current evidence to assess availability. |

These meanings depend on the check. An `unknown` temperature value cannot establish whether a room is within its configured limits, even though that state does not create an entity-availability failure.

A device availability check uses its selected operational entities. It reports unavailable when every selected entity is unavailable. A current state from one member makes that device check pass, while an independently watched unavailable entity can still have its own issue. Diagnostics and configuration entities do not supply the device check. The device assessment shown in Monitoring can use a wider set than a policy with exclusions.

Open issues focuses on current reported problems. Availability findings with only missing evidence stay in Monitoring. An existing availability problem followed by a missing reading remains unresolved there. Likewise, an availability issue awaiting recovery confirmation leaves Open issues while Monitoring shows the pending result. An empty issue list therefore needs to be read alongside monitoring coverage and current evidence.

## Why related problems appear together

Homeostatic uses Home Assistant's recorded relationships between integrations and their equipment. If a watched integration fails, its issue can include the watched devices and entities affected by that connection. If several related availability failures begin close together while the integration remains loaded, Homeostatic can group those findings too. The grouping settings control that behavior.

For example, several Zigbee devices may become unavailable together. Their common integration provides a useful place to investigate. A loaded integration does not establish that the devices are working, and grouping does not establish a shared physical cause.

The Open issues page also arranges findings beneath integration and device headings for browsing. Expanding a heading does not merge issues. Each opened issue retains its own evidence and controls. When an issue becomes part of another problem, History records **Joined another problem** and links to the related issue while it remains available.

When a failed integration returns, Homeostatic gives its equipment time to reconnect. Findings still present can remain grouped or become individual issues according to the current evidence and grouping settings. Inspect those remaining findings instead of assuming that the integration's recovery ended every problem.

## How a policy reaches a person

The configuration has three parts:

| Part | What it decides |
| --- | --- |
| Monitoring policy | What to watch, what opens an issue and which named notifications to use |
| Named notification | When to request attention and which delivery methods to use |
| Delivery method | Which configured Home Assistant destinations to use, with optional presence choices |

Each policy can select several named notifications. Shared notification edits affect their saved uses; changing one policy's assignment affects that policy. Monitoring continues when a policy has no notification assignments or global sending is off.

Immediate notifications can request attention as an issue becomes eligible. Daily-hours notifications wait outside their window. Scheduled summaries include eligible problems still open at their scheduled time, including acknowledged ones. Problems that clear before a waiting request becomes eligible are omitted. [Notification settings](manual/settings-reference.md) describe the timing choices.

Compatible requests about the same device can share one continuing phone message while their findings remain separate issues. As one finding clears, the message updates to show those still open. Different instructions or destinations keep their messages separate. This message grouping does not change what acknowledgment or a pause means for an individual issue.

Homeostatic hands requests to Home Assistant's configured delivery routes. A request result cannot confirm that a person received or heard the message. [Set up notifications](manual/notifications.md) explains destination tests and phone actions.

## Recovery, changes and restarts

Availability recovery has a confirmation period. Other checks follow their own recovery conditions: for example, a temperature limit needs a usable reading back within range. Missing evidence does not establish recovery. The [monitoring reference](manual/monitoring-reference.md) describes each type.

Changing a monitoring expectation can end its issue even while the equipment is still failing. History calls this **Monitoring ended**. Disabling a policy, removing a source from its scope or changing detection settings is different from observing recovery. [History](manual/history.md) preserves the recorded outcome.

Homeostatic saves open issues, retained history and active controls across a Home Assistant restart. Restored readings wait for fresh evidence, and startup waits allow integrations to load before new issues and notifications become eligible. Open issues continue through that restart; pending notification requests and reminders follow their saved rules. A panel save does not start the full Home Assistant startup wait.

The [settings reference](manual/settings-reference.md) owns timing and retention values. [What Homeostatic cannot establish](manual/limitations.md) explains the limits of reported availability, physical freshness and monitoring from inside Home Assistant.
