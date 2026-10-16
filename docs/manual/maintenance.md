# Work on equipment temporarily

[Homeostatic manual](../guide.md)

Use **Working on this equipment…** before planned work such as restarting a hub or changing an integration. During the chosen period, Homeostatic holds off new issues in that scope. Existing issues and their notifications continue.

To quiet an issue that is already open, [pause its notifications](issues.md#pause-an-issues-notifications).

## Start maintenance

1. Open **Monitoring** and select the integration or monitored entity you will work on.
2. Select **Working on this equipment…** and check the named source.
3. Choose **30 minutes**, **2 hours** or **4 hours**, or open **Choose an end time…** to enter a local end date and time within the displayed limit.
4. Open **More options** if you want to add a reason or select **Also cover equipment that depends on this**. For an integration, that can include the devices and entities watched through it. Leave it off to cover only the selected source.
5. Select **Start maintenance**. Check the saved expiry and expand **Covered equipment** to inspect the applied scope.

Device details do not offer a maintenance button. Choose the relevant entity for a narrow operation, or its integration with dependent equipment when that is the intended scope. An integration-wide window may cover other devices too.

Homeostatic continues reading evidence during maintenance. If a problem starts and clears within the window, it does not open an issue afterward. A problem still present when maintenance ends can open an issue under its normal monitoring rules. Repairs and broken-automation checks are separate from equipment maintenance.

## End maintenance early

1. Open the source where the window was started and find **Working on equipment** with its expiry.
2. Select **End maintenance…**.
3. Check the named scope and select **End maintenance** to confirm.

Problems still present may become eligible immediately. Ending one window leaves other overlapping maintenance windows active.

If saving fails or Home Assistant disconnects, inspect the active control after the connection recovers before trying again. The [settings reference](settings-reference.md) describes control limits, and [Troubleshooting](../troubleshooting.md) covers uncertain results.
