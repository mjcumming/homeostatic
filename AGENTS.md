# Agent instructions

Homeostatic is the Home Assistant adapter and catalog for health-tree. The library is a separate repository. Read the relevant sections of `docs/spec.md` before changing behavior and add an executable scenario for each behavior change. Update `CHANGELOG.md` for user-visible changes.

- Keep dependency, episode, readiness, and attention decisions in health-tree. Use public APIs only. Snapshots are opaque persistence data, not a query interface.
- Home Assistant owns I/O, timers, configuration, entities, and storage. Read the clock at adapter boundaries and pass UTC times into the library.
- A reported HA state is evidence about HA's control path. It does not prove physical-device freshness or successful command completion.
- Use Python 3.14, type annotations, and Google-style docstrings. Records are frozen, slotted, keyword-only dataclasses. No future annotations import. No prints in integration code.
- Never sleep in tests. Use time fixtures and real Home Assistant test helpers.
- Run `uv run python script/check.py` (also `make check`) for lint, format, strict types, tests and both coverage floors. Use Linux or WSL for Home Assistant. Validate metadata with official hassfest after manifest, services, or translation changes.
- Notification events are requests, not proof of delivery. Keep transports in consumer automations; test the shipped blueprint with mocked services. Preserve queued observations during I/O and stable delivery ids during outbox replay.
- Keep `docs/spec.md`, `docs/events.md`, README examples, and executable scenarios together with behavior changes. Use `docs/roadmap.md` for unfinished product scope.
- Do not commit, push, tag, publish, deploy, or open issues or PRs unless the maintainer asks. Work on branches. Take dates from the system.
- Never send notifications through a user's live installation during tests. Tests use an isolated Home Assistant instance.
