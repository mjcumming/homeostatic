# Pilot validation

The combined 0.1.0b1 candidate targets Home Assistant 2026.9.3 and Python 3.14, using the published health-tree 0.2.0 distribution. It includes the dashboard, administrator controls and persisted resolved-history backend.

## Combined checks

On 2026-09-25 the required check command passed 303 Python tests and eight Node frontend tests, plus Ruff, formatting and strict typing. Combined branch-aware coverage was 98.79%, with statement and branch coverage individually above 95%. Official hassfest reported one valid integration and no invalid integrations.

The separate [dashboard walkthrough](dashboard-walkthrough.md) records native setup, failure/recovery, future enrollment, area changes, reload, full restart and the embedded return-navigation regression. It used the same library behavior from its pre-release commit. The combined suite now uses the released wheel.

## Package acceptance

`script/build_pilot.py` builds from a clean committed revision, packages tracked frontend assets and the optional blueprint, and records the commit and file hashes. Building the same revision twice must produce the same ZIP hash.

`script/smoke_pilot.py` accepts that ZIP and requires a separate environment containing HA 2026.9.3 without HealthTree already installed. It verifies the package hashes, copies only the component into a temporary configuration, and lets HA install the manifest dependency. It exercises native config flow, function readiness, frontend asset serving, failure/recovery, resolved history and reload. Notifications stay off; synthetic timings are explicitly zero so the check never sleeps. The browser walkthrough independently used normal timing defaults.

The CI job builds the ZIP, runs this clean-install check and uploads the archive only after success. Local package acceptance is recorded once this candidate is built.

## Reproduce

```bash
uv sync --locked
uv run python script/check.py
uv run python script/build_pilot.py
uv venv --python 3.14 /tmp/homeostatic-pilot-venv
uv pip install --python /tmp/homeostatic-pilot-venv/bin/python homeassistant==2026.9.3
/tmp/homeostatic-pilot-venv/bin/python script/smoke_pilot.py dist/homeostatic-0.1.0b1-pilot.zip
```

Use a fresh environment for each smoke run. The check intentionally refuses an already-installed HealthTree so an editable checkout cannot mask a missing dependency. Home Assistant binds only to loopback and the temporary configuration is removed after shutdown.

This does not establish real-house behavior, physical freshness, command completion, phone receipt or external-watchdog independence. Follow the [pilot guide](../pilot.md) for the first passive installation and observation.
