# ADR 0100: A failed settings save reloads from the store

**Status:** Accepted on 2026-10-18; implemented
**Implementation status:** See the [roadmap](../roadmap.md#current-work).

**Date:** 2026-10-18

**Extends:** [ADR 0097](0097-shrink-the-snapshot-and-save-durable-changes.md) and [ADR 0098](0098-update-the-subject-and-sweep-rarely.md); the fifth step of the [core design audit](../core-design-audit-2026-10-18.md). **Supersedes:** the in-process rollback of the settings transaction described in the [specification](../spec.md).

## Context

A settings save begins by taking a checkpoint: the engine and policy snapshots, and a deep copy of every runtime attribute that is neither infrastructure nor a view discovery replaces. On the household installation the copy takes 0.12 s and the two library snapshots build several megabytes of dictionaries, on every Stop Monitoring click, so that the rare failed save can put the runtime back in place. The copy keeps a second object tree alive during the save, part of the allocation behind the generation-2 collections that still land inside about one edit in two, and the rollback code that restores it is a second implementation of what startup already does.

What the rollback protects is one rule: the panel never shows settings as saved when the store does not hold them, and the running house follows the stored settings. After ADRs 0096 to 0098 and health-tree 0.9.0, every save is verified, a save that changes nothing writes nothing, and the stored file always holds the last verified durable state, so startup from that file is a complete recovery.

## Decision

A failed settings save is handled like a failed refresh, then the integration reloads. The runtime reports the error to the caller, marks monitoring unavailable with the existing storage notification, and schedules a reload of its config entry. The reload restores the last verified store and the config entry's previous options through the startup path, re-observes every source as startup does, and monitoring resumes under the settings the store holds. The checkpoint deep copy, the pre-save library snapshots and the in-process rollback are retired. The panel's save response says that the settings were not saved and that monitoring is reloading from the last saved state.

## Alternatives

- Rolling back in-process from the stored file keeps every current guarantee, including the ordered observation queue, but adds a second caller of the restore path that must work while listeners are live.
- Keeping the deep copy but excluding more attributes keeps a second object tree for the common case to serve the rare one.
- Snapshotting only the sections an edit can change needs a map from settings to sections that every future setting must maintain.

## Acceptance

A settings save whose write fails, and one whose verification fails, each answer the panel with an error, leave the config entry's previous options in place, and end with a reloaded integration whose settings, issues and controls match the last verified store and whose monitoring is available. A configuration read during the failure returns the stored settings and revision once the reload completes. A settings save on the household installation no longer logs a checkpoint phase. The existing storage-failure scenarios for refreshes are unchanged.

## Consequences

Each settings save does less work and allocates less. A failed save costs a reload, a few seconds during which the panel shows monitoring unavailable, and any observations queued at that moment, which only happens while storage is already failing. The specification's transaction description loses its rollback; the store and the config entry are the only two places state lives after a failure.
