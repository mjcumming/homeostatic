# ADR 0106: Enable supplied battery and vacuum policies on fresh setup

**Status:** Accepted
**Date:** 2026-10-19

**Later decisions:** [ADR 0108](0108-category-availability-policies-and-policy-waits.md) supersedes the fresh-install availability policy list below while retaining enabled Batteries and Vacuums. [ADR 0107](0107-add-new-supplied-policies-disabled-on-upgrade.md) adds genuinely new supplied policies once, disabled, to existing installations; historical edits and deletions remain unchanged.

**Supersedes in part:** Only the disabled fresh-install defaults for Batteries and Vacuums in [ADR 0058](0058-unified-policy-lifecycle.md). The policy lifecycle, existing-installation preservation and notification safeguards remain in force.

## Context

Before release, the maintainer requested that fresh installations start with Batteries and Vacuums enabled alongside the other supplied monitoring. Both checks have supported default detection settings and can show useful problems before any delivery destination is configured. Existing installations must keep the owner's saved choices.

## Decision

Fresh setup enables all eight supplied policies: Integrations, General entity availability, Important equipment availability, Entities not provided, Repairs, Broken automations, Batteries and Vacuums. Batteries retains its 20% threshold and Morning summary assignment. Vacuums retains its Evening summary assignment.

Global notification sending remains off. The six supplied named notifications retain their existing timing and start without delivery methods or destinations. Temperature, thermostat and UPS templates still require source and detection configuration before enabling. New custom policies and duplicates still start disabled.

This change updates the supplied definitions only. Setup, reload and upgrades do not apply these enabled states to existing policies or add deleted policies. Preserve every saved enabled or disabled choice, policy edit, notification assignment, destination and global sending choice. Selective restoration remains an explicit owner action and does not overwrite surviving policies or recreate deleted notifications.

## Validation

Fresh-flow and packaged-install checks assert exactly eight enabled supplied policies, six notifications without delivery methods, and sending off. An isolated runtime scenario verifies that the supplied battery and vacuum policies report current problems without requesting delivery. Upgrade scenarios explicitly store both policies as disabled or deleted, independently of the new defaults, and verify unchanged settings and monitoring through setup and two reloads. Cover both config-entry storage locations and sending on and off. Existing historical conversion and state-preservation scenarios remain required.
