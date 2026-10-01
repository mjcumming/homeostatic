# Development environment and checks

Use Python 3.14.2 or newer within the 3.14 series and Node.js 22 or newer, on Linux or WSL.

You only need this repository. Development and the HA installation use the same published health-tree version.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then:

```bash
uv sync --locked
uv run prek install
uv run python script/check.py --quick
```

`make quick` and the commit hook run lint, format, and frontend checks. Run focused Python tests for the changed behavior before you copy a local test build. CI runs `make check`: strict mypy, the complete Home Assistant integration tests, separate 95% statement and branch coverage floors, and the frontend checks. Its release job also builds and smoke-tests the archive. The [two workflows](development-workflows.md) say when to copy a local test build and when to publish a release. Tests run the consumer blueprint through HA's real automation engine with a mocked phone service, and they never send messages to a live installation.

The lockfile and integration manifest pin `health-tree==0.5.1` from PyPI, and CI installs that published package. Library behavior changes go in the library's own RFP, ADRs and tests. Release a new library version before you update this pin.

Build a reproducible installation archive from a clean committed checkout with `uv run python script/build_release.py`. The ZIP holds the integration with its frontend assets, the automation blueprints, the docs, installation instructions and the exact build identity.

On the maintainer's workstation, the prepared environment lives outside the mounted Windows filesystem:

```bash
cd /mnt/c/GitHub/homeostatic
export UV_PROJECT_ENVIRONMENT="$HOME/.cache/homeostatic/venv"
export PATH="$HOME/.cache/homeostatic/tools:$PATH"
uv sync --locked
uv run python script/check.py --quick
```

Commit from WSL after you install the hook there. In CI, the pinned official hassfest action validates the Home Assistant metadata. If you have Docker, run hassfest locally from the repository:

```bash
docker run --rm --mount "type=bind,source=$PWD,target=/github/workspace,readonly" ghcr.io/home-assistant/hassfest
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow, [docs/spec.md](spec.md) for current behavior, [docs/roadmap.md](roadmap.md) for what's planned, and [CHANGELOG.md](../CHANGELOG.md) for changes.
