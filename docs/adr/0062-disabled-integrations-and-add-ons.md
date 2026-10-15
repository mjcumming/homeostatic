# ADR 0062: Keep disabled integrations and add-ons out of availability monitoring

**Status:** Accepted
**Date:** 2026-10-14

**Complements:** ADR 0009's disabled-device eligibility and ADR 0060's disabled-entity eligibility. Extends the same scope rule to integrations and add-ons.

## Context

Music Assistant appeared in Issues with Disabled in Home Assistant after its unknown-evidence hold elapsed. The catalog retained the config entry but did not carry its disabled flag into monitoring eligibility. Deliberately disabling a source removes the expectation that it will operate.

## Decision

Disabled sources, including integrations and add-ons, remain accessible in Sources but are hidden by default. The Show disabled sources option reveals them across grouping and search views. Their details say: "Monitoring paused while disabled. Saved monitoring choices resume when re-enabled." This is a browsing filter and does not change saved monitoring choices. They retain their disabled state, but do not generate availability issues solely because they are disabled. Both catalog rules and named policies exclude explicitly disabled sources from availability checks. Saved monitoring choices remain intact and apply again when the source is re-enabled.

Disabling a monitored source removes its availability check through the existing engine lifecycle. Any resulting issue closure is recorded as removed, without passing evidence or a claim of recovery. Related sources with independent findings and Home Assistant Repairs retain their own eligibility; disablement is not a blanket presentation filter over an integration group.

For integrations, use the config entry's `disabled_by` field. Not loaded, setup retry, setup error, unavailable and missing evidence do not establish disablement. Home Assistant propagates config-entry disablement to its device and entity registries; their existing eligibility rules continue to apply.

The same product rule applies to add-ons when an explicit disabled state is available. Homeostatic currently discovers HA config entries, devices and entities, with no separate Supervisor add-on inventory or runtime check. Add-on-related sources follow those existing registry rules. Do not infer add-on disablement from a stopped process, an unavailable entity, disabled automatic startup, or a disabled integration that connects to it. A future native add-on producer must establish its disablement signal before applying this rule.

## Alternatives

- Keep disabled integrations as unknown evidence until an issue opens. This reports an intentional configuration choice as work needing attention.
- Hide disabled issues only in the dashboard. This leaves checks and notification eligibility active.
- Emit passing observations on disablement. This invents recovery evidence.

## Consequences

Sources remains useful for finding and re-enabling disabled equipment. Availability monitoring resumes from current evidence using the retained policy choices. Tests cover disabled startup, enabled missing evidence and errors, removal of an existing issue, reload and re-enablement under both enrollment models.

The signal boundary follows [Home Assistant config-entry lifecycle documentation](https://developers.home-assistant.io/docs/config_entries_index/), [Core config-entry disablement](https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py) and the [Supervisor API](https://developers.home-assistant.io/docs/api/supervisor/endpoints/), checked October 14, 2026.
