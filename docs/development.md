# Development environment and checks

Use Python 3.14.2 or newer within the 3.14 series and Node.js 22 or newer, on Linux or WSL:

Only this repository is required; development and HA installation use the same published HealthTree version.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
```

`make quick` and the commit hook run lint, format, and frontend checks. Run focused Python tests for changed behavior before copying a local test build. CI runs `make check`: strict mypy, the complete Home Assistant integration tests, separate 95% statement and branch coverage floors, and the frontend checks. Its release job also builds and smoke-tests the archive. The [two workflows](development-workflows.md) describe when to copy a local test build and when to publish a release. The consumer blueprint is exercised by HA's real automation engine with a mocked phone service; tests never send messages to a live installation.

The lockfile and integration manifest pin `health-tree==0.4.0` from PyPI. CI installs that published package. Library behavior changes belong in the separate library RFP/ADR and tests; release a new library version before updating this pin.

Build a reproducible installation archive from a clean committed checkout with `uv run python script/build_pilot.py`. The ZIP includes frontend assets, the optional consumer blueprint, installation instructions and exact build identity.

On this workstation, the prepared environment is outside the mounted Windows filesystem:

```bash
cd /mnt/c/GitHub/homeostatic
export UV_PROJECT_ENVIRONMENT="$HOME/.cache/homeostatic/venv"
export PATH="$HOME/.cache/homeostatic/tools:$PATH"
uv sync --locked
uv run python script/check.py --quick
```

Run commits from WSL after installing the WSL hook. Home Assistant metadata is validated separately by the pinned official hassfest action in CI. With Docker available, run locally from the repository:

```bash
docker run --rm --mount "type=bind,source=$PWD,target=/github/workspace,readonly" ghcr.io/home-assistant/hassfest
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for workflow, [docs/spec.md](spec.md) for implemented behavior, [docs/roadmap.md](roadmap.md) for remaining scope, [docs/ui.md](ui.md) for owner-facing working notes, and [CHANGELOG.md](../CHANGELOG.md) for changes.
