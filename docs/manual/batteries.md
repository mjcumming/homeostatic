# Watch batteries

[Homeostatic manual](../guide.md)

Use a **Low battery** policy to report a low percentage or a low-battery warning supplied by Home Assistant. The supplied **Batteries** policy starts off and uses a 20% threshold.

Before starting, find the battery in **Monitoring** and inspect its readings. Homeostatic recognizes battery percentages and low-battery warnings from Home Assistant's entity metadata. When a device has one of each, they can appear as one battery. Check that the displayed readings belong together before including it.

## Set up the policy

1. Open **Policies** and choose **Edit policy** for **Batteries**. To create a separate policy, select **Add policy**, choose **Low battery**, and select **Continue**.
2. Give the policy a useful name. Under **Include**, choose the batteries to watch. **Selected batteries…** lets you choose individual batteries; **All batteries** also includes eligible batteries discovered later. See [Choose what to monitor](policies.md) for areas, labels and exclusions.
3. Set **Battery level at or below (%)**. A reported percentage equal to this value is low. An explicit low-battery warning also opens a problem, even when the percentage is higher.
4. Review **Notifications**. The supplied policy selects **Morning summary**. Configure its delivery method through [Set up and change notifications](notifications.md), or remove its assignments to keep the policy's issues in the panel only.
5. Turn **Policy enabled** on and select **Save policy**.
6. Return to the battery in **Monitoring**. Confirm that the policy is listed and inspect the current percentage, warning and any charging evidence. A current low report can now appear in **Open issues**.

## Read the result

If a battery has both percentage and warning readings, a low result from either keeps the condition low. Conflicting reports remain visible so the readings can be investigated.

The low condition ends when every monitored low-battery reading is current and normal: the percentage is above the threshold and any low-battery warning is off. A current charging report associated with that battery also ends the low condition. If charging stops while the battery still reports low, an issue can open again. A charging clearance records charging; it does not establish a full charge or a replacement.

Missing, unavailable, restored or invalid readings leave the battery condition unknown unless another current reading establishes low battery or charging. Missing charging evidence alone cannot clear a low condition. Inspect the battery's evidence in Monitoring when its state is unclear.

Use a separate policy when some batteries need a different threshold or notification choice. Overlapping policies keep their own findings. UPS reserve checks have different charging and recovery rules; use [Watch UPS conditions](ups.md) for those.

See [Monitoring types and defaults](monitoring-reference.md) for supported evidence and [What Homeostatic cannot establish](limitations.md) for detection limits.
