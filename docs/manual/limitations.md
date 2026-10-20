# What Homeostatic cannot establish

[Homeostatic manual](../guide.md)

Homeostatic tracks the evidence Home Assistant supplies and the checks you configure. Use these boundaries when deciding what a finding means. For a setup that behaves unexpectedly, start with [Troubleshooting](../troubleshooting.md).

## Equipment and readings

An available entity tells you that Home Assistant has a current state for it. That does not establish that a physical measurement is fresh, a detector is still processing, or a command reached the equipment and succeeded.

Some integrations mark a feature unavailable when the device's current mode does not support it. Homeostatic cannot infer the physical reason from that state. Select the entities you expect to remain available.

Entities on the same device can have different availability states. Group entities can also remain available when their members fail. Inspect important members directly. Device, integration and location grouping does not establish a physical cause.

## Detection scope

Homeostatic focuses on Home Assistant and equipment problems, with additional policies for common household needs such as temperature limits and thermostat progress. Use Home Assistant automations for specialized conditions or household-specific sequences, including checking whether a door closed after a command.

The broken-automation check finds named entity references that no longer exist. It does not detect every automation error, prove that an automation ran, inspect entity references found only in templates, or check scripts. Home Assistant Repairs provide a separate source of reported problems.

Battery checks cannot identify a replacement battery or tell you which battery to buy. Vacuum checks follow reported error activity. A fault that never appears in the supported evidence is outside that check.

Automation-defined alerts are unfinished and are not ready for user setup. The manual does not offer a blueprint or diagnostic-sensor recipe for them. Backup failures, general host-health checks and other proposed monitoring remain on the [roadmap](../roadmap.md).

## Notifications and access

A notification result records a request to Home Assistant. It cannot confirm receipt, a spoken announcement being heard, or a message being read. Provider errors can appear only in the Home Assistant log.

The panel and dashboard cards require administrator access. Other recipients can receive messages and use a supplied phone acknowledgment action, but cannot open the administrator panel. Phone snooze controls are not available.

## History and outages

History is a bounded record of ended issues. It is not a complete journal of configuration changes, control actions or delivery attempts. The [settings reference](settings-reference.md) lists retention limits. Times reflect when Homeostatic recorded a change, which may be later than physical recovery after an outage.

Homeostatic runs inside Home Assistant. It cannot notify you that Home Assistant itself has stopped while both are offline. That needs monitoring outside Home Assistant.

Homeostatic does not repair equipment, retry integrations or operate devices to clear an issue. Follow the relevant Home Assistant destination to investigate and take action.

## Scale and platform qualification

Whole-installation monitoring on very large systems still needs qualification under representative household load. Select useful coverage and review the installation's responsiveness rather than assuming a universal capacity guarantee. Actual delivery-provider results also require verification; a successful request alone does not confirm receipt.
