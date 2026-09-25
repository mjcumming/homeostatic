# Changelog

## [Unreleased]

### Added

- Administrator operator actions for episode shelving and bounded equipment maintenance, with scope previews, explicit expiry, reason/actor records and restart persistence.
- Current-control queries and expiry scheduling, with scenarios for situation isolation, continuing existing alerts, authorization, concurrent observations and storage failures.

- Owner YAML notification policy: recipients/channels, timezone, quiet hours, reminders, escalation, digests and strict validation.
- Read-only policy explanations and activation previews through native options and response actions.
- Grouped digest/activation messages with durable membership, replacement and clearing; channel-aware consumer blueprint.

- Function requirements for integration instances, other functions and declared external capabilities, with pre-save cycle validation.
- Per-function automation suggestions with stable accepted/rejected decisions, including static entity and device/area/floor/label targets.
- Current-function explanations and isolated function previews showing dependency changes, evidence gaps, rule provenance and upstream importance.

- Passive availability rule catalog with domain, device class, integration, device, entity, area, floor and label matching; additive attachments and order-independent exclusions.
- Automatic enrollment of future matching sources, stable match identities, retained missing-source evidence, and per-check attach/exclude explanations.
- Read-only rule previews in native setup/options and the `preview_rules` action, plus recent enrollment-change details in inventory.

- Initial Home Assistant integration with explicit source enrollment, native setup and options, dependency-aware monitoring, notification requests, health queries, and restart persistence.
- Python 3.14 development environment and integration tests against Home Assistant 2026.9.3.
- Named functions with stable entity requirements, editable importance, and individual readiness sensors.
- Entity-bound situation alerts, independent of equipment dependencies and readiness, preserving open episodes through unknown evidence.
- Versioned notification events, durable outbox replay, a Companion app consumer blueprint, activation summaries, and visible consumer gaps.
- One shared check command for local development, CI and commit hooks; expanded regression/blueprint tests, event documentation and an implementation roadmap.

### Changed

- Activation uses the public library API, preserves episode history, starts escalation afresh and respects delivery holds. Policy edits withdraw old routes before activation.

- Empty functions are explicit unwatched drafts; missing function/external declarations remain unknown requirements.
- Native setup/options preview now includes function requirements and candidate decisions, with readable graph validation errors.

- Setup defaults to the editable passive rule pack; existing development selections convert to narrow rules in options without broadening scope.
- Function requirements remain unwatched/unknown when catalog rules exclude them. Equipment exclusions do not suppress situations.

- New configurations default to notifications off. Consumer automations own episode notification delivery; native persistent notifications remain for Homeostatic errors.
- The original development snapshot upgrades to the current envelope without replacing episode identities.
- CI uses the reviewed HealthTree baseline including accepted situation ADRs.

### Fixed

- Repeated reminder requests are preserved even when their text is unchanged; summary resolutions update the remaining group.

- Excluded registered entities remain unwatched terminal requirements instead of appearing ready through a healthy owning integration.

- Preserve source transitions while storage is busy instead of replacing them with the latest state.
- Preserve setup-retry onset across unsuccessful attempts.
- Retain useful notification content when observations become unknown and policy requests no update.
- Complete unload cleanup even when the final storage write fails, with a visible storage error.
