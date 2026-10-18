# ADR 0094: Use one device issue workflow from every investigation page

**Status:** Accepted
**Date:** 2026-10-17

**Partially supersedes:** ADR 0093's availability-only membership and singular entry points from Open issues; ADR 0091's combined-header opening time and primary device navigation; the per-finding queue navigation in ADRs 0085 and 0090; the entity/policy disclosure presentation of the confirmation retained by ADR 0074. ADR 0093's exact selection contract, ADR 0090's independent issue lifecycle and existing notification deep-link targets remain unchanged.

## Context

Monitoring offered a combined response for one device, while Open issues still opened each finding separately. A device with some unavailable entities or a different condition could never reach the same device context through those findings. The user approved one device entry wherever registry ownership is known, so acknowledging, pausing and reviewing its monitoring use the same workflow.

## Decision

Open issues shows one View action at each device heading. The findings beneath it explain the affected entities and conditions without separate issue popups. View opens the shared device dialog used by Monitoring, even when no aggregate device availability issue exists. The dialog includes current issues whose complete recorded source membership resolves through canonical Home Assistant registry ownership to that one device. This includes independent availability and condition checks. A name match, common integration or partial overlap does not establish ownership. Preserve wider integration issues and issues with unknown or cross-device scope as their complete original issue, outside the device selection.

Monitoring retains the order device identity and availability, linked entity names, then coverage. Its single View opens the same current device issue set. Keep x of y monitored entities available as availability evidence where known; a different condition does not turn available entities into unavailable ones. Partial availability and missing evidence must remain distinguishable. Ordinary issue visibility rules still apply; showing a device context never invents a failure or recovery.

An entity with no registry device keeps its own issue view. Existing episode URLs, including notification taps, retain the exact original issue and its action scope. They do not silently select other issues. Device entry and direct episode entry share the response implementation while preserving these different scopes. Closing or returning from a policy editor restores the entry context, filters, position and focus.

Use ADR 0093's selection contract for the complete device set: all current issues start selected, individual exceptions remain possible, and one response area applies acknowledgment or a pause to the captured issue IDs. One current issue has direct controls without a checkbox or selection count. Keep each issue's condition and control state visible, including distinct checks on the same entity. Later arrivals do not inherit selection or controls; recovery cannot redirect a pending operation. Individual failures remain visible. No issues are merged, and no engine or notification lifecycle rule changes.

The combined header omits an Opened timestamp calculated from the earliest included issue. It is not the device's opening time and does not help choose the response. Retained issue chronology remains available through existing exact issue and History routes. Keep one outlined Open device action per view. Use matching control heights and padding, equal widths for the acknowledgment/pause pair, and compact spacing. Put Policies: and Notifications: beside their named editor buttons, with responsive wrapping. Those editors remain authoritative and return to the device dialog. Do not add an expander or another navigation layer to repeat visible information.

Stop Monitoring retains its separate availability-coverage confirmation under ADR 0074; acknowledgment/pause selections never determine its scope. Its heading names the operation and entity count, and the exact entity names stay visible below it. Remove the Details disclosure and repeated policy list; policy editing remains available from the issue dialog. A concise sentence states that availability checks stop while other condition checks continue. Applicable policy exclusions and guarded save scope are unchanged. A device dialog does not grant a new device-wide monitoring exclusion or change unrelated policies.

## Acceptance

Exercise the same device from Open issues and Monitoring with all entities unavailable, only some unavailable, one remaining entity issue, a previous failure with missing current evidence, and an independent condition such as a battery or temperature problem. Verify one queue View, no per-finding popup controls, the same full device issue set and the same response area. An unattached entity retains its own view. A name collision, stale ownership, a wider integration issue and a cross-device issue cannot join the device action scope.

Cover initial all selection, subset and zero selection, a single direct action, later arrivals, recovery, replacement identities, pending operations and partial failure. Verify exact notification links remain exact. Coverage confirmation, cancellation, stale evidence and failure must preserve unrelated settings. Inspect desktop and phone layouts, enlarged text, keyboard operation, editor return and restored list context. Confirm the combined opening date is absent, the device link is secondary, action widths match, and policy/notification rows wrap without clipping.
