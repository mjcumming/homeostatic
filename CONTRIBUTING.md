# Contributing

Read the relevant part of [docs/spec.md](docs/spec.md) before changing behavior. Update it before implementing a new rule. The health-tree library owns dependency, episode, readiness, and attention semantics; Homeostatic owns observations, discovery, configuration, storage, delivery requests, and HA presentation. Consumer automations own actual delivery. Read [docs/roadmap.md](docs/roadmap.md) before expanding a development interface into a product feature.

Use Python 3.14 on Linux or WSL and run `uv sync --locked`. Follow Home Assistant's integration conventions, annotate code, and use native lifecycle helpers. Keep observations honest about their source. Never turn a cached HA value into proof of physical-device communication.

Tests run against real HA helpers and the real health-tree engine. Observation scenarios live in `tests/fixtures/scenarios.yaml`; lifecycle and error-path scenarios live in the corresponding test modules. Pass or freeze time, never sleep. Each behavior change needs a scenario that shows its practical consequence.

Before review:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py
```

Run Home Assistant's official hassfest validator for manifest, services, and translation changes. The commit hook, `make check`, and CI share `script/check.py`. Install and run the hook in the same Linux/WSL environment as HA. The pinned official hassfest action validates metadata separately; the README gives the Docker command. Blueprint tests use the actual automation engine with mocked transport services. Keep line and branch coverage at or above 95 percent. Add user-visible changes under `[Unreleased]` in the changelog.

The maintainer reviews all changes. Use feature branches and Conventional Commit subjects when a commit is requested. Never publish, deploy, or test notifications against a live installation without the maintainer's instruction.


Keep the specification, README examples, event contract and executable scenarios in the same change as behavior. The integration specification is the local behavior owner; the roadmap records unfinished product decisions without claiming they are implemented. Version persisted envelopes and event payloads independently, and test upgrades, source loss, activation and storage failures.
