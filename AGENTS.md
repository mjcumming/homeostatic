# Agent instructions

Homeostatic is the Home Assistant adapter and catalog for health-tree. The library is a separate repository. Read the relevant sections of `docs/spec.md` before changing behavior and add an executable scenario for each behavior change. Update `CHANGELOG.md` for user-visible changes.

- Keep dependency, episode, readiness, and attention decisions in health-tree. Use public APIs only. Snapshots are opaque persistence data, not a query interface.
- Home Assistant owns I/O, timers, configuration, entities, and storage. Read the clock at adapter boundaries and pass UTC times into the library.
- A reported HA state is evidence about HA's control path. It does not prove physical-device freshness or successful command completion.
- Use Python 3.14, type annotations, and Google-style docstrings. Records are frozen, slotted, keyword-only dataclasses. No future annotations import. No prints in integration code.
- Never sleep in tests. Use time fixtures and real Home Assistant test helpers.
- Follow [the two development workflows](docs/development-workflows.md). Run `uv run python script/check.py --quick` (also `make quick`) and focused tests for a local UI trial. The commit hook uses quick checks. CI runs `uv run python script/check.py` (also `make check`) for strict types, the full suite and both coverage floors, then packages and smoke-tests the release candidate. Use Linux or WSL for Home Assistant. Validate metadata with official hassfest after manifest, services, or translation changes.
- Notification events are requests, not proof of delivery. Keep transports in consumer automations; test the shipped blueprint with mocked services. Preserve queued observations during I/O and stable delivery ids during outbox replay.
- Keep `docs/spec.md`, `docs/events.md`, README examples, and executable scenarios together with behavior changes. Use `docs/roadmap.md` for unfinished product scope. Owner-facing working notes live in `docs/ui.md`; they are not the spec.
- Do not commit, push, tag, publish, deploy, or open issues or PRs unless the maintainer asks. Work on `main`. Do not create a branch or worktree unless the maintainer asks to set work aside. Take dates from the system.
- Never send notifications through a user's live installation during tests. Tests use an isolated Home Assistant instance.
