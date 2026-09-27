# ADR 0011: Separate optional entity availability from device faults

**Status:** Superseded by [ADR 0012](0012-monitoring-expectations-and-persistent-exclusions.md).

**Date:** 2026-09-26

**Deciders:** Michael Cumming

**Supersedes:** ADR 0009's evidence-selection and partial-unavailability rules. Its identity, enrollment, disablement, and library-boundary rules remain in force.

## Context

The Outdoor Speakers WiiM device was online and in Solo mode while its virtual
Group Master entity was unavailable. This is expected: the WiiM group entity
only becomes available when the player acts as a group master. The main player's
availability instead follows the coordinator's communication-update success.
Homeostatic treated the optional group's state as a device warning and opened a
fault episode. Entity availability alone does not establish an unexpected or
actionable fault. Ordinary HA entity categorization does not establish that an
entity is essential to device operation.

## Decision

- Prefer an adapter contract with known connectivity meaning where supported.
  For the `wiim` platform, use the single enabled main `media_player` registry
  entity, excluding the virtual entity whose unique id ends in `_group_master`.
  This selection uses registry identity, never a friendly name or entity-id
  naming convention. If there is no unique main player, leave a coverage gap;
  do not substitute an optional entity. Registry changes re-evaluate selection.
- For other devices retain the generic evidence set from ADR 0009. Any usable
  member supplies limited HA availability evidence (`pass`). Mixed unavailable
  or unknown members remain diagnostic information (`partial_availability`),
  not a device warning. This does not verify all capabilities or physical health.
- When every selected member is unavailable, report `fail/all_unavailable`.
  When none is usable and some evidence is unknown, missing, or restored,
  report `unknown/incomplete_evidence`. Unknown evidence cannot prove recovery;
  the library's existing unknown hold and evidence-gap presentation still apply.
- Optional capabilities require an explicit entity check or declared function
  requirement when their absence matters. A generic device summary is not a
  substitute for that requirement. Keep these decisions in the HA adapter;
  do not change health-tree semantics or WiiM's group behavior.
- Existing partial-unavailability episodes receive the corrected observations
  and close through the normal library recovery hold. Do not delete history,
  hide a still-open episode, or hand-edit persisted engine data.

## Alternatives

Changing WiiM to pretend an absent group is available would misrepresent a
virtual capability and leave the generic monitoring error intact. Ignoring only
this one entity by display name would miss equivalent cases in other integrations.
Choosing an arbitrary representative for every device has no reliable meaning.
Treating mixed evidence as unknown would eventually produce another stale
episode even while usable HA availability evidence remains present.

## Consequences and validation

Generic summaries deliberately do not detect every partial capability failure.
Users can monitor required entities separately. Entirely unavailable generic
summaries describe HA evidence, not a proven physical outage or an expectation
that the equipment must always be on. Further integration-specific selection
requires its own documented producer meaning and executable scenarios.

Regression scenarios cover a solo WiiM, group-role changes, unknown input data,
loss and recovery of main-player availability, absent/ambiguous main identity,
and generic partial/total/unknown transitions. Tests must challenge normal
inactivity as well as detect outages. Synthetic checks do not establish physical
device readiness.
