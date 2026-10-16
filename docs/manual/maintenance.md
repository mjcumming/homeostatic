# End an active maintenance period

[Homeostatic manual](../guide.md)

A source may show **Working on equipment** with an expiry when a maintenance period is active. Homeostatic holds off new issues in that scope until the period ends. Existing issues and their notifications continue.

To quiet an issue that is already open, [pause its notifications](issues.md#pause-an-issues-notifications).

Homeostatic continues reading evidence during maintenance. If a problem starts and clears within the window, it does not open an issue afterward. A problem still present when maintenance ends can open an issue under its normal monitoring rules. Repairs and broken-automation checks are separate from equipment maintenance.

## End maintenance early

1. Open **Monitoring**, select the source with the active period and find **Working on equipment** with its expiry.
2. Select **End maintenance…**.
3. Check the named scope and select **End maintenance** to confirm.

Problems still present may become eligible immediately. Ending one window leaves other overlapping maintenance windows active.

If saving fails or Home Assistant disconnects, inspect the active control after the connection recovers before trying again. The [settings reference](settings-reference.md) describes control limits, and [Troubleshooting](../troubleshooting.md) covers uncertain results.
