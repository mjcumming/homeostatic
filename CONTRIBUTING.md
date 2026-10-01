# Contributing

Read the relevant part of [docs/spec.md](docs/spec.md) before changing behavior, and update it before you implement a new rule. The health-tree library owns dependency, episode, readiness and attention semantics. Homeostatic owns observations, discovery, configuration, storage, delivery requests and HA presentation. The actual sending is done by Homeostatic's built-in sender or by a consumer automation. Check [docs/roadmap.md](docs/roadmap.md) before turning a development interface into a product feature.

Use Python 3.14 and Node.js 22 or newer on Linux or WSL, and run `uv sync --locked`. Follow Home Assistant's integration conventions, annotate code, and use native lifecycle helpers. Keep observations honest about their source. Never treat a cached HA value as proof that the physical device communicated.

Tests run against real HA helpers and the real health-tree engine. Observation scenarios live in `tests/fixtures/scenarios.yaml`, and lifecycle and error-path scenarios live in the matching test modules. Pass or freeze time. Never sleep. Each behavior change needs a scenario that shows what it changes in practice.

For a quick local test:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
uv run pytest tests/test_dashboard.py  # replace with tests for the changed behavior
```

The quick command and the commit hook run lint, format and frontend checks. `make quick` runs the same quick command. Run focused Python tests for the change, then follow the [local test cycle](docs/development-workflows.md) when the owner has authorized a copy to HA. CI runs the full `script/check.py` suite, including mypy, real HA integration tests, and separate 93 percent statement and branch coverage floors. CI also validates the release candidate with a clean-install smoke test and the pinned official hassfest action. Run the full suite locally only to investigate a failure. CI is the release gate. Install and run the hook in the same Linux/WSL environment as HA. [docs/development.md](docs/development.md) covers environment setup and the local hassfest Docker command. Blueprint tests use the real automation engine with mocked transport services. Add user-visible changes under `[Unreleased]` in the changelog.

The maintainer reviews all changes. When a commit is requested, commit on `main` with a Conventional Commit subject. Don't create a branch unless the maintainer asks you to set work aside. Never publish, deploy, or test notifications against a live installation unless the maintainer tells you to.

Change the spec, user guide examples, event contract and executable scenarios in the same change as the behavior. The spec describes what Homeostatic does now, and the roadmap lists unfinished work without claiming it's built. Version persisted envelopes and event payloads independently, and test upgrades, source loss, activation and storage failures.
