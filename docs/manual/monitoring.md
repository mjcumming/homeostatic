# Inspect equipment and its monitoring

[Homeostatic manual](../guide.md)

**Monitoring** shows the integrations, devices and entities Homeostatic has discovered, their current evidence and the policies that watch them. Looking at a source does not change its monitoring.

## Find a source

1. Open **Monitoring** and enter a name or entity ID in **Search**.
2. Leave **Monitoring status** at **All** to search both watched and unwatched sources. Choose **Monitored** or **Not monitored** when that distinction helps.
3. Use **Group by** to browse by integration or **Home Assistant location**. **TopoMation locations** is also available when TopoMation supplies the location tree.
4. Expand the relevant branch and select the source. On a narrow screen, **Back to Monitoring** returns to the tree.

The details identify the source, its current condition and its monitoring. Select **Open entity** to open Home Assistant’s entity dialog, including when the entity is no longer provided by its integration. The named Device and Integration links open their respective Home Assistant pages.

An **Issues** badge marks a source or group with a current reported problem. **Not monitored** is ordinary coverage information. Missing or restored availability readings alone do not create a badge, including after an earlier failure; inspect the source details for those readings. On a device, one **View** opens the same device dialog as **Open issues**, including partial availability and other conditions. Choose which issues to acknowledge or pause there. Entities without a device and wider issues retain their own scope.

![Monitoring with 3rd Floor Sensor selected and its availability and monitoring coverage visible](../images/manual-monitoring.png)

A device shows its availability summary first, followed by entity names linked to Home Assistant and then monitoring coverage. The summary counts monitored entities. Its dialog names any unavailable entities and explains missing or restored readings, even when no issue is open. The policy links include checks covering the device and its entities; each open issue retains its own condition and controls.

## Understand what is watched

1. Select the source and read its monitoring summary.
2. Review the contributing policies. A source may have several checks, such as entity availability and battery condition.
3. Open the relevant policy to inspect its selection and settings. The editor shows the policy's complete scope, which may include other equipment.
4. Follow [Choose what to monitor](policies.md) if that scope needs changing.

Device details show the current states of its entities and their monitoring coverage. Each entity can have an independent issue; a working sibling does not clear it. [How Homeostatic works](../how-it-works.md#availability-and-missing-readings) explains the state meanings.

## Find an excluded or disabled source

1. Clear the search if it may be hiding the source, and set **Monitoring status** to **All**.
2. Open **More filters**.
3. Select **Include disabled sources** to show equipment disabled in Home Assistant. Select **Availability exclusions only** to find sources with saved availability exclusions.
4. Open the source and inspect its condition and policies.

Disabled sources are hidden by default and do not acquire availability checks. Their saved choices apply again when they are enabled in Home Assistant. Resuming an availability exclusion is a separate operation; [the policy guide](policies.md#resume-availability-monitoring) explains it.

Search, filters, **Group by** and **Collapse groups** change the displayed list. They do not enable policies, exclude equipment or change an issue. A selected source can remain open after a filter removes it from the tree.

## Check an evidence gap or earlier problem

Use the source details when **Open issues** has no current availability warning but a reading is missing or recovery is still being confirmed. The details preserve that distinction instead of treating every quiet source as recovered.

Open [History](history.md) to find ended problems. A retained issue link opens its recorded entry. History describes what Homeostatic saw at the time; current source readings belong in Monitoring.

The [monitoring reference](monitoring-reference.md) lists eligible sources and the evidence each check uses. If an expected source is still missing, see [Troubleshooting](../troubleshooting.md).
