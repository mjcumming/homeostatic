# Development environment and checks

Use Python 3.14.2 or newer within the 3.14 series and Node.js 22 or newer, on Linux or WSL. Start adapter work in this repository. [Current work](roadmap.md#current-work) identifies any unpublished library prerequisite.

## Set up the environment

Install [uv](https://docs.astral.sh/uv/getting-started/installation/). Run commands from the Homeostatic repository root. By default, uv uses `.venv`. On the maintainer's workstation, select the prepared environment outside the mounted Windows filesystem first:

```bash
cd /mnt/c/GitHub/homeostatic
export UV_PROJECT_ENVIRONMENT="$HOME/.cache/homeostatic/venv"
export PATH="$HOME/.cache/homeostatic/tools:$PATH"
```

Keep the same environment selection for setup, checks and commits. Initialize it from the locked published dependencies:

```bash
uv sync --locked
```

If Current work requires an unpublished health-tree API, apply the sibling-checkout override below before running integration checks. Otherwise the published requirement in the [project configuration](../pyproject.toml) and [integration manifest](../custom_components/homeostatic/manifest.json) is the development baseline.

After setup, install the hook and run the quick checks and focused tests:

```bash
uv run --no-sync prek install
uv run --no-sync python script/check.py --quick
uv run --no-sync pytest tests/test_dashboard.py
```

Choose the focused test module for the behavior being changed. `make quick` and the commit hook use the prepared environment without synchronizing it. Repeat `uv sync --locked` when the locked dependencies change, then reapply any required local override. uv's [synchronization behavior](https://docs.astral.sh/uv/concepts/projects/sync/) explains why ordinary `uv run` can replace a development override.

## Changes spanning both repositories

Read the instructions in each repository before editing there. Library behavior belongs in health-tree's RFP, ADRs and tests; Homeostatic owns observation, configuration and delivery integration. Track adapter adoption and its remaining prerequisite in [Current work](roadmap.md#current-work).

When the adapter requires a library change that is not yet published, first synchronize the adapter environment as above, then install the sibling checkout into that same environment:

```bash
uv pip install --python "${UV_PROJECT_ENVIRONMENT:-.venv}/bin/python" --no-deps -e ../health-tree
```

Use `uv run --no-sync` for subsequent development commands so they retain the editable library. This command targets either the selected project environment or `.venv`; it does not assume the workstation uses `.venv`. Confirm which library is being imported when reporting cross-repository validation:

```bash
uv run --no-sync python -c "import health_tree; print(health_tree.__file__)"
```

An explicit `uv sync --locked` restores the published dependency. Reapply the override only while the current adapter work requires it. A passing test against the sibling checkout does not validate installation against the published pin.

For release, publish the library first, update the adapter's manifest, project dependency and lockfile, and validate against the published package. CI synchronizes locked dependencies and the clean-install smoke check rejects editable dependencies. Follow the [full release workflow](development-workflows.md#full-release); a dependency change cannot use the code-only local-copy path.

## Checks and packaging

Quick checks run lint, format and frontend tests. Run focused Python tests for changed behavior. CI runs strict mypy, the complete Home Assistant integration tests, the separate statement and branch coverage floors defined in the [coverage check](../script/check_coverage.py), and frontend tests. Tests use isolated Home Assistant instances and mocked notification transports.

The [development workflows](development-workflows.md) define the checks and authorization needed for a local installation or release. For an authorized release candidate, synchronize its published dependencies and build from a clean committed checkout:

```bash
uv sync --locked
uv run --locked python script/build_release.py
```

The ZIP holds the integration, frontend assets, automation blueprints, documentation and exact build identity. CI installs that archive into a fresh Home Assistant environment.

Commit from WSL after installing the hook there. In CI, the pinned official hassfest action validates Home Assistant metadata. With Docker available, run hassfest locally from the repository:

```bash
docker run --rm --mount "type=bind,source=$PWD,target=/github/workspace,readonly" ghcr.io/home-assistant/hassfest
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution rules, the [specification](spec.md) for current behavior, and the [changelog](../CHANGELOG.md) for changes.
