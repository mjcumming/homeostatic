# ADR 0105: Preserve settings when adding collection delays

**Status:** Accepted
**Date:** 2026-10-19

**Later decision:** [ADR 0107](0107-add-new-supplied-policies-disabled-on-upgrade.md) permits a separate, validated addition of genuinely new supplied policies once, disabled, on existing installations. It preserves this collection-format conversion and its prohibition on recreating historical policies, notifications or delivery methods.

**Supersedes in part:** The release-reset exception in [ADR 0102](0102-collect-requests-by-saved-notification.md). Its collection behavior and fresh-install defaults remain unchanged.

## Context

The earlier collection release authorized replacing otherwise-valid named-notification settings that lacked collection delays. That replacement also discarded policies, destinations, disabled choices and the sending setting. Before broader introduction, the maintainer required protection of existing installations. A missing timing field does not justify replacing unrelated saved choices.

## Decision

Convert the recognized earlier named-notification format by adding `collection_delay_seconds: 0` to non-report profiles that lack the field. Zero preserves their previous eligibility timing. Keep every other saved value, identity, assignment, selector, exclusion, explicit deletion and global sending choice. Do not add fresh-install policies, notifications or delivery methods.

Build the conversion in memory, apply the existing device-to-entity policy conversion, validate the complete settings and restore the supported stored runtime state before writing converted configuration. Use the same path whether the earlier settings are in config-entry data or options. On the next load the settings are current and require no further conversion. Current-format settings are unchanged.

Mixed old/current profiles, malformed settings, unsupported schemas and invalid stored state fail visibly without replacing settings or partially saving a conversion. An existing adapter delivery envelope without `delivery_collections` predates the supported collection-state contract and must be rejected before configuration writes or runtime startup. A rehearsal using actual published earlier component/library state showed that otherwise accepting that envelope can replay previously presented notifications. Preserve the original configuration and state so the matching prior installation or backup remains usable; do not reinterpret opaque library snapshots to force an upgrade.

Absent saved state and supported current delivery envelopes permit the settings conversion. Compatible history, acknowledgments, pauses and pending requests retain their existing restore contract. Replayed requests retain stable delivery identities and previously resolved destinations; adding the zero delay does not introduce a new send or destination.

The onboarding and maintenance guides describe the supported conversion and preserve the distinction between fresh-install defaults and existing choices. Older unsupported formats are not silently reset.

## Validation

Executable upgrade scenarios cover the published earlier settings fixture in both storage locations, sending on and off, customized and deleted defaults, device coverage, notification assignments and destinations, current-format no-op reloads, malformed and mixed settings, invalid stored state, retained history and controls, and stable pending replay without duplicate delivery after a second reload. Actual historical presented and queued snapshots must be rejected without settings writes, state changes or notification requests. Tests use isolated Home Assistant and mocked notification services.
