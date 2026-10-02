# ADR 0044: Report Home Assistant Repairs as issues

**Status:** Accepted
**Date:** 2026-10-01

## Context

Home Assistant raises Repairs for problems an owner has to act on: an automation that calls an action that no longer exists, a deprecated YAML setting, an integration that needs attention before an upgrade. They appear only under Settings → Repairs, and nothing reaches a phone. ADR 0040 showed one kind, automation validation errors and missing actions, in Overview and Issues, but without acknowledgment, history or notifications, and ignored every other Repair.

Owners want one place for everything that goes wrong with Home Assistant, and to hear about it on the same schedule as their other issues.

## Decision

Every active Repair in Home Assistant's issue registry becomes a Homeostatic issue, whatever its severity or integration. Repairs that Homeostatic raises itself are left out. A Repair the owner ignores in Home Assistant ends its issue, and so does a Repair Home Assistant deletes.

An issue's name is the Repair's title as Home Assistant shows it, in Home Assistant's language. Its message names the integration that raised it and the severity. The issue links to the automation editor when Home Assistant gives that link, and to the Repairs page otherwise.

All Repairs share one reporting choice, kept with the other reporting choices as `repairs`. It defaults to the morning summary, because Repairs rarely need a reply within minutes but shouldn't wait a week. Owners change it under **Notifications → Household default**. Repair nodes carry the same profile label as automation alerts and use the same label rules. With a custom notification policy, Repairs follow that policy like any other source.

Repairs have no place in the dependency map. They aren't equipment, so **Working on this equipment** doesn't apply to them. Acknowledge and Pause alerts work as they do for any issue, and ended Repairs go to History.

Home Assistant keeps only persistent Repairs across a restart. Integrations raise the rest again while they set up. So during the startup hold, a Repair that had an open issue before the restart and hasn't been raised again reads unknown, which keeps its issue open. After the hold ends, a Repair that's still missing ends its issue.

Homeostatic stores the Repairs it has open issues for, with their names and links, so those issues survive a restart. It keeps at most 500. A Repair beyond that limit stays visible in Home Assistant but gets no issue.

## Consequences

Owners see every Home Assistant Repair in Issues, get them in the morning summary by default, and keep a 30-day record in History. An install with many deprecation warnings will see all of them in its summary every morning until they're fixed or ignored in Home Assistant, or until the owner sets Repairs to the weekly summary or Dashboard only.

Homeostatic still doesn't inspect automations itself. Run errors that Home Assistant records only in traces don't produce Repairs and stay outside Homeostatic.

This supersedes ADR 0040.
