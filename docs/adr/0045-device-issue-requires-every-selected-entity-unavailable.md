# ADR 0045: Open a device issue only when every selected entity is unavailable

**Status:** Accepted
**Date:** 2026-10-02
**Supersedes:** ADR 0025's rule that a device summary warns when any selected member is unavailable.

## Context

ADR 0025 made a watched device warn as soon as any one of its selected entities went `unavailable`. ADR 0035 adopted a different rule for the device status shown in Sources: a device is Unavailable only when all its enabled entities are. The two rules disagreed, so a device could read Available while an issue was open on it, and the panel needed a "Why does Home Assistant say Available?" explanation.

The stricter rule also produced issues that weren't about contact with the device. Home Assistant uses `unavailable` for more than lost contact: some integrations mark a control `unavailable` when the device's current mode or program doesn't support it. A device whose mode changes several times a day then looked like it was dropping off the network.

Home Assistant itself has no device availability today. The only written design is [architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400), "Device availability reporting", opened in May 2026 and still open. When an integration doesn't report device availability itself, it derives the status from entities: Available if any enabled entity has a state other than `unavailable`, Unavailable only when every enabled entity is `unavailable`, and Unknown when the device has no enabled entities. It never derives "partially available" from entity states. [Home Assistant states](../home-assistant-states.md) collects the documentation and Core behavior behind this.

## Decision

A watched device's availability check follows the discussion 1400 entity rule, applied to the entities the owner has selected for that device:

| Selected entities | Result |
| --- | --- |
| At least one has a current state, including an HA `unknown` value | `pass/available` |
| Every one is `unavailable` | `warn/all_unavailable` |
| A selected connectivity sensor reports `off` | `warn/connectivity_disconnected` (ADR 0038, unchanged) |
| None has a current state and not every one is `unavailable` (missing or restored states) | `unknown/incomplete_evidence` |
| None selected | No check (ADR 0025, unchanged) |

Excluded entities play no part in the check. Exclusions exist to drop features that are unavailable by design, so the check follows the owner's selection rather than every enabled entity. The device status in Sources keeps ADR 0035's rule over all enabled entities. The two only differ when the owner has excluded something.

An entity the owner watches on its own still gets its own availability issue. `warn/some_unavailable` is no longer produced. History keeps showing it for issues recorded before this change.

## Alternatives

- **Keep warning on any unavailable entity.** Catches one dead sensor on a working device, but raises false issues whenever an integration greys out a control, and contradicts the device status beside it.
- **Treat partial unavailability as a separate, quieter warning.** Discussion 1400 reserves "partially available" for conflicting integration reports, not entity states, and a quieter warning still needs a notification policy, a label and an explanation for something that usually isn't a fault.
- **Use every enabled entity, ignoring exclusions.** Would match the Sources status exactly, but would make exclusions pointless for the issue.

## Consequences

A device issue now means Home Assistant can't reach any of the device's selected features, or its connectivity sensor says it's disconnected. One failed entity on an otherwise working device no longer opens a device issue; the owner watches that entity on its own if it matters. Open issues recorded as `some_unavailable` end at the next evaluation because the device now passes, and History records them as cleared, as happened when ADR 0025 changed the meaning of `unknown`. When Home Assistant ships native device availability reports, ADR 0035's precedence rules still apply.
