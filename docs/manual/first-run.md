# Get started

This walk-through shows you what Homeostatic watches, sends a test to your phone, connects the notifications the starting policies use, and turns sending on. You don't need a current problem to finish it.

You'll need the Home Assistant Companion app on your phone, signed in to this Home Assistant with notifications allowed.

## 1. See what's watched

Open **Homeostatic** in the sidebar. **Open issues** lists anything Home Assistant is reporting now. Leave the **Notifications** switch in the header off for the moment.

Open **Policies**. A new installation starts with these policies on:

| Policy | Reports | Notification |
| --- | --- | --- |
| Integrations | An integration that fails to load or asks you to sign in again | Morning summary |
| Important equipment availability | An unavailable camera, lock, alarm panel, or smoke, carbon monoxide, gas or leak detector | Immediate |
| General entity availability | Any other unavailable entity | Morning summary |
| Entities not provided | An entity its integration has stopped providing for 24 hours | Morning summary |
| Repairs | A Home Assistant Repair | Morning summary |
| Broken automations | An automation that names an entity that no longer exists | Morning summary |

Batteries and Vacuums start off. Temperature limits, thermostat progress and UPS checks are policies you add yourself; see [Choose what to watch](policies.md).

## 2. Look at a device you know

Open **Monitoring**, search for a device such as a lamp, and select it. You'll see how many of its monitored entities are available and which policies watch it. Looking doesn't change anything.

## 3. Add your phone

1. Open **Notifications**, switch to **Delivery methods** and select **Add delivery method**.
2. Name it, for example **My phone**.
3. Select **Add destination**, choose **App notification** and pick your phone.
4. Select **Save delivery method**.
5. Select **Edit delivery method**, then **Send test**, and check that the test arrives.

If your phone isn't listed, check that the Companion app is signed in to this Home Assistant and allowed to send notifications.

## 4. Connect the notifications

In the **Notifications** list, edit **Morning summary**, select **My phone** under **Send using**, and select **Save notification**. Do the same for **Immediate**.

Morning summary sends one message at 08:00 listing what's still open, and skips the day when nothing is. Immediate covers the important equipment: if a lock or leak detector drops off at night, your phone gets an urgent alert about a minute later. If that's more than you want, leave Immediate without a delivery method, or set the Important equipment availability policy to Morning summary.

## 5. Turn sending on

Turn on the **Notifications** switch in the header. Problems that are already open become eligible straight away: Immediate ones are sent after their short wait, and the rest wait for the next morning summary.

## Next

- [Respond to issues](issues.md) when something shows up in **Open issues**.
- [Choose what to watch](policies.md) to turn on battery checks or watch a freezer's temperature.
- [Set up notifications](notifications.md) for other destinations, delivery hours or presence-based choices.
