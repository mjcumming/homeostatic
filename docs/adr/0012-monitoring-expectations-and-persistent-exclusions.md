# ADR 0012: Monitor declared availability expectations and persist exclusions

**Status:** Accepted

**Date:** 2026-09-26

**Deciders:** Michael Cumming

**Supersedes:** ADR 0011 and ADR 0009's interpretation of device summaries as device faults.

## Context

WiiM's optional Group Master entity is normally unavailable in Solo mode.
Home Assistant reports availability, but that state alone does not distinguish
an unexpected outage from a capability that is not currently applicable.
A WiiM-specific exception does not solve that ambiguity for other integrations.
Allowing one available member to pass the entire summary can also hide the loss
of a required capability.

## Decision

- Selecting an entity for availability monitoring declares an expectation that
  it should be available. A selected device summary applies that expectation to
  its eligible members. It groups monitoring findings; it is not a physical
  device-health verdict. Discovery without an attach rule creates no expectation.
- Retain the editable broad device/integration defaults with notifications off.
  Explain that broad monitoring requires tuning and includes future matching
  sources. Do not expand existing saved rules or infer required capabilities
  from brand names, display names, or entity-id suffixes.
- Use enabled ordinary device entities, or diagnostic entities if no ordinary
  entities exist. Hidden entities remain eligible; disabled and configuration
  entities do not. Apply catalog entity exclusions after selecting this set;
  excluding every ordinary member does not introduce diagnostic replacements.
- All selected members usable means pass. Some unavailable means warn; all
  unavailable means fail. Unknown, missing, or restored evidence with no
  unavailable member means unknown. These describe the declared monitoring
  expectation, not a diagnosis or proof of physical operation.
- "Ignore this availability check" stages a persistent catalog exclusion using
  stable entity-registry identity. The owner previews and saves through the
  existing configuration workflow. The exclusion applies to direct checks and
  device-summary membership, survives restarts and entity-id renames, and can
  be removed through the same rule editor. No separate suppression database.
- A scope change caused by exclusions retires any affected aggregate episode
  as removed and reevaluates the remaining scope. It is not recovery. Preserve
  actual HA states and retained history. Excluding all members leaves no check;
  it does not produce a passing device assessment.
- Acknowledgment means awareness of the current episode. Shelving pauses alerts
  temporarily. Ignoring changes future monitoring expectations. None of these
  asserts that the underlying condition has cleared. This change adds no new
  acknowledgment action; use only operator controls actually implemented.

## Presentation

Name the unavailable monitored entities and show current HA states. Explain
that the cause may be a normal mode or a failure. Provide a persistent ignore
choice beside each member, separate from episode controls. Keep device-detail
lists bounded and provide a route to all monitoring choices. Explain HA's
integration/device/entity organization and Homeostatic's interpretation in the
README before the rule examples.

## Validation

Use the same generic contract for WiiM and other integrations. Exercise selected
unavailable entities, persistent exclusion, rename/restart, remaining-member
outage, all-member exclusion, preview parity, and scope removal without false
recovery. Tests must preserve unrelated configuration and HA entity states.
