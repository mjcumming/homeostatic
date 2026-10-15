## Problem and resulting behavior

Describe the user-visible change and one concrete before/after example.

## Validation

- [ ] `uv run --no-sync python script/check.py` passes (including both coverage floors).
- [ ] Behavior is covered by an executable scenario.
- [ ] Verification covers the complete promised workflow; any remaining acceptance is explicit.
- [ ] Metadata changes pass official hassfest, when applicable.
- [ ] Tests use isolated HA and mocked transports; no live notifications.

## Documentation

- [ ] Implemented behavior is reflected in `docs/spec.md`, README examples, and the changelog.
- [ ] Event/storage contract changes include migration or replay scenarios.
- [ ] Remaining acceptance and cross-repository adoption are recorded in `docs/roadmap.md#current-work`.
- [ ] Superseded code, callers, fixtures and guidance are removed; required retained behavior is explained.

The maintainer must be able to explain the change before merge.
