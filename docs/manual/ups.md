# Watch UPS conditions

[Homeostatic manual](../guide.md)

Homeostatic can watch UPS reports from **Network UPS Tools (NUT)** and **APC UPS Daemon**. It offers separate policies for backup power, low reserve, battery replacement and faults. Each condition keeps its own issue and controls.

Before starting, find the UPS in **Monitoring** and inspect its status and measurements. Discovery needs a recognized status report plus battery charge or remaining runtime. Homeostatic leaves disabled Home Assistant entities disabled. A missing measurement is shown as missing evidence.

## Add a UPS policy

1. Open **Policies → Add policy**. Choose the condition to watch and select **Continue**:

   | Monitoring type | Purpose |
   | --- | --- |
   | UPS backup power | Report operation on backup power. |
   | UPS low reserve | Report a low-reserve warning or a configured charge/runtime threshold. |
   | UPS battery replacement | Report the UPS's battery-replacement warning. |
   | UPS faults | Report supported fault flags or NUT bypass operation. |

2. Name the policy. Under **Include**, choose **Selected UPS devices…**, select the UPS and choose **Done**. Other scope choices can include future matching devices; see [Choose what to monitor](policies.md).
3. For **UPS low reserve**, review the available charge and runtime fields. Optional **Raise at or below** and **Clear at or above** values must be entered as a pair, with the clear value higher than the raise value. Runtime values use minutes. Leaving a pair blank uses the UPS's low setpoint when available. An explicit low-reserve warning still applies.
4. Review **Notifications**. Backup-power and fault policies initially select **Urgent**; battery replacement selects **Morning summary**. Low reserve initially selects **Morning summary** for **Mains power confirmed** and **Immediate with acknowledgment** for **Backup power confirmed**. These choices are added only if those named notifications still exist. Configure their delivery methods in [Notifications](notifications.md).
5. Turn **Policy enabled** on and select **Save policy**. Repeat for any other UPS conditions to watch.
6. Open the UPS in **Monitoring**. Confirm its policies and readings. Any active conditions appear separately in **Open issues**; clearing one condition leaves the others intact.

## Follow a UPS issue

Backup-power monitoring clears when the UPS reports mains operation. Replacement and fault checks need a usable current status showing that their warning or fault has ended. UPS issues also use the installation's recovery wait, described in [Notification and control settings](settings-reference.md).

Low reserve needs its own recovery evidence. Every monitored reserve measurement must recover, and the explicit low warning must clear. With a custom pair, recovery occurs at or above the clear value. With a device low setpoint, the reading must rise above it. Charging alone does not clear low reserve, replacement warnings or faults.

If low reserve continues as the UPS switches to backup, the backup notification assignment becomes applicable and an earlier acknowledgment is reset. An existing notification pause stays in effect. Returning to mains stops backup-route reminders, while low reserve remains open until its readings recover.

Missing or unusable evidence cannot establish recovery. Low reserve can remain visible with a last confirmed power mode; that mode continues to select its reporting assignment. Before any power mode has been confirmed, low reserve appears in the panel without a mains or backup notification assignment taking effect. APC communication-loss reports make cached condition readings unusable.

Generic battery policies and UPS reserve policies may watch the same battery independently. Review both policies if their findings or notification choices overlap. See [Monitoring types and defaults](monitoring-reference.md) for the supported conditions and [What Homeostatic cannot establish](limitations.md) for evidence limits.
