# Set up notifications

Three things decide who hears about a problem and when:

- A **policy** picks one or more named notifications.
- A **named notification** decides when to send and which delivery methods to use.
- A **delivery method** lists the destinations: phones, speakers, email, SMS or other Home Assistant notify services.

Named notifications and delivery methods are shared. Before you save a change, **Changes apply to** lists the policies or notifications it affects.

## Add a delivery method

1. Open **Notifications → Delivery methods** and select **Add delivery method**.
2. Name it, select **Add destination**, choose a **Delivery type** and pick a destination. The help icon beside **Delivery type** explains what each type needs, with links for setting up email and SMS.
3. Add any other destinations, then select **Save delivery method**.
4. Select **Edit delivery method**, then **Send test**. Tests work while sending is off. A successful test means Home Assistant accepted the request, so check the destination to be sure it arrived.

To pick destinations by who's home, open **Change destinations based on who's home** and choose a **Presence selection**:

| Presence selection | Sends to |
| --- | --- |
| Fixed destinations | The destinations under **Send to** |
| Home or away | One set of destinations while anyone you pick is home, another when they're all away |
| People currently home | The destinations you set for each person who's home |

With either presence mode, **When no recipient can be chosen** decides between **Skip notification** and **Send to instead**. Unknown presence never counts as home or away.

## Choose when to send

Homeostatic starts with six named notifications. Select **Edit notification** on one, or **Add notification** to make another.

| When to notify | Sends | Settings |
| --- | --- | --- |
| Immediately | As soon as an issue qualifies, day or night | **Collection delay (seconds)** |
| Immediately, with acknowledgment | The same, then reminders until someone acknowledges | **Collection delay (seconds)**, **Remind every (minutes)** |
| During daily hours | Only between **Start** and **End**; issues from overnight wait for the start | **Collection delay (seconds)**, **Start**, **End** |
| Scheduled summary | One message on the days and time you pick, listing what's still open | **Summary time**, **Days** |

The collection delay is how long Homeostatic waits to bundle requests for the same notification and destination into one message. If several sensors drop off at about the same time, Immediate sends one message listing them. The wait starts with the first request, later ones don't extend it, and 0 sends straight away.

Under **Send using**, pick the delivery methods, then select **Save notification**. A notification with no delivery method sends nothing.

To use a notification, open a policy and select **Add notification** under **Notifications**. Remove all of a policy's notifications to keep its issues in the panel only.

## Turn sending on or off

The **Notifications** switch in the header turns sending on or off for the whole installation. Monitoring continues either way. When you turn it on, problems that are already open become eligible under their notifications' timing.

## On your phone

Immediate notifications, with or without acknowledgment, arrive as critical alerts on iPhone and on the **Homeostatic urgent** channel on Android. Others use normal priority. Tapping a notification opens its issue, or the issues in that message. The **Acknowledge** button acknowledges the issues in that message. Phone notifications update and clear themselves as issues change; other destinations only get new messages.
