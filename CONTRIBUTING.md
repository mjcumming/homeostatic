# Contributing

Read the relevant part of [docs/spec.md](docs/spec.md) before changing behavior. Update it before implementing a new rule. The health-tree library owns dependency, episode, readiness, and attention semantics; Homeostatic owns observations, discovery, configuration, storage, delivery requests, and HA presentation. Consumer automations own actual delivery. Read [docs/roadmap.md](docs/roadmap.md) before expanding a development interface into a product feature.

Use Python 3.14 and Node.js 22 or newer on Linux or WSL and run `uv sync --locked`. Follow Home Assistant's integration conventions, annotate code, and use native lifecycle helpers. Keep observations honest about their source. Never turn a cached HA value into proof of physical-device communication.

Tests run against real HA helpers and the real health-tree engine. Observation scenarios live in `tests/fixtures/scenarios.yaml`; lifecycle and error-path scenarios live in the corresponding test modules. Pass or freeze time, never sleep. Each behavior change needs a scenario that shows its practical consequence.

For a quick local test:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
uv run pytest tests/test_dashboard.py  # replace with tests for the changed behavior
```

The quick command and commit hook run lint, format and frontend checks. Run focused Python tests for the change, then follow the [local test cycle](docs/development-workflows.md) for an owner-authorized copy to HA. `make quick` runs the same quick command. CI runs the full `script/check.py` suite, including mypy, real HA integration tests, and separate 95 percent statement and branch coverage floors. Its clean-install smoke test and pinned official hassfest action validate the release candidate. Use a local full run when investigating a failure, not as a duplicate release gate. Install and run the hook in the same Linux/WSL environment as HA. [docs/development.md](docs/development.md) gives the environment setup and the local hassfest Docker command. Blueprint tests use the actual automation engine with mocked transport services. Add user-visible changes under `[Unreleased]` in the changelog.

The maintainer reviews all changes. Commit on `main` with Conventional Commit subjects when a commit is requested. Do not create a branch unless the maintainer asks to set work aside. Never publish, deploy, or test notifications against a live installation without the maintainer's instruction.


Keep the specification, user guide examples, event contract and executable scenarios in the same change as behavior. The integration specification is the local behavior owner; the roadmap records unfinished product decisions without claiming they are implemented. Version persisted envelopes and event payloads independently, and test upgrades, source loss, activation and storage failures.
