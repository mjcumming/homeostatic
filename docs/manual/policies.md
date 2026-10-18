# Choose what to watch

A policy decides which sources to watch, what counts as a problem and which notifications to use. **Monitoring** shows what's watched now, and **Policies** is where you change it.

## See what's watched

Open **Monitoring** and search for a name or entity ID. **Group by** switches between integrations, Home Assistant locations and, if you use it, TopoMation locations. **Monitoring status** shows only monitored or unmonitored sources, and **More filters** can include disabled sources or show only those with availability exclusions.

Select a source to see its state and coverage. A device shows how many of its monitored entities are available, lists its entities and the policies that watch it, and offers **View** while it has issues. An entity links to its device and integration in Home Assistant, and **Monitoring policies** lists each policy that uses it, what for, and **Edit policy**.

## Add or change a policy

1. Open **Policies**. Select **Edit policy**, or select **Add policy**, choose a **Monitoring type** and select **Continue**.
2. Under **Include**, choose the scope, then pick sources with the button beside it, such as **Choose batteries**.
3. Fill in **When it becomes a problem**, if the type has settings.
4. Under **Notifications**, select **Add notification** for each named notification this policy should use. A policy with none still shows its issues in the panel.
5. Turn on **Policy enabled** and select **Save policy**.

| Include | Watches |
| --- | --- |
| All *sources* | Every eligible source of that type, including ones added later |
| All except selected | Everything except the sources you pick, including ones added later |
| Selected *sources* | Only the sources you pick |
| In selected areas, With selected labels | Sources in those areas or with those labels, including ones added later |
| Matching entity types, All except selected entity types | For entity availability: entities of the domains and device classes you pick, or every other entity |

A policy's type can't change, so add a new policy for a different type. **More actions** offers **Duplicate**, whose copy starts disabled, and **Delete**. **Restore defaults** brings back supplied policies you've deleted.

Policies can overlap. Two battery policies can watch the same battery at different thresholds, each with its own issues and notifications. Changing a policy's scope or settings ends the issues it no longer covers as **Monitoring ended**; renaming it doesn't.

## Availability

Availability checks ask whether Home Assistant can reach something. They go by the state Home Assistant reports.

- **Integrations** reports an integration that fails to load or asks you to sign in again.
- **Devices** reports a device when all of its monitored entities are unavailable. Its **Ignored entities** section lists entities left out of that check; change them with **Choose ignored entities**.
- **Important equipment availability** and **General entity availability** report single entities. Important equipment starts with cameras, locks, alarm panels, and smoke, carbon monoxide, gas and leak detectors, and uses Immediate. General covers every other entity and uses Morning summary. Change either one's **Include** to move entity types between them. They're independent, so editing one never changes the other.

Availability policies skip entities disabled in Home Assistant, and skip diagnostic and configuration entities unless you pick them individually.

## Stop or resume availability monitoring

To stop watching an entity Home Assistant often reports unavailable, select **Stop monitoring…** in its issue or on the entity in **Monitoring**. For several entities on one device, open the device in **Monitoring**, use **Select entities…**, then **Stop monitoring…**. The confirmation lists exactly what stops; other checks on those entities continue.

To undo it, find the entity in **Monitoring** (**More filters → Availability exclusions only** helps) and select **Resume availability monitoring…**.

## Other checks

| Type | Set up | Good to know |
| --- | --- | --- |
| Low battery | Turn on the supplied **Batteries** policy, or add your own. Set **Battery level at or below (%)**. | A low-battery warning from Home Assistant counts too. The issue ends when the level is normal again or the battery reports charging. |
| Vacuum error | Turn on the supplied **Vacuums** policy. | The issue ends when the vacuum is cleaning, docked, idle, paused or returning. |
| Temperature limits | Add a policy, choose sensors, and enter **Below**, **Above** or both, with **For at least**. | **Monitoring** shows **Waiting** while a reading is out of range but hasn't lasted long enough. A reading back in range ends the issue. |
| Thermostat progress | Add a policy and choose thermostats. | Reports a thermostat in heat, cool or heat_cool mode that stops getting closer to its target, or moves away from it. Turning it off or to another mode ends monitoring. |
| UPS backup power, low reserve, battery replacement, faults | Add a policy for each condition you want, and choose a NUT or APC UPS Daemon UPS. | Low reserve can use your own **Raise at or below** and **Clear at or above** values for charge or runtime, entered as a pair, or the UPS's own low setting. It has separate notifications for mains and backup power. |
| Repairs, Broken automations | On from the start, covering everything. | Fix the Repair in Home Assistant, or edit the automation that names a missing entity. |

[Defaults and settings](settings-reference.md#monitoring-types) lists what each type reads and what ends its issues.
