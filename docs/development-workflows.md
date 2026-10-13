# Local testing and release

Use the local test cycle to try a small, contained change in the owner's Home Assistant pilot. Use the release cycle when the change is ready to publish. Neither cycle changes saved monitoring choices or turns on notification requests unless the owner asks for it.

## Quick local test

1. Update the spec and an executable scenario when behavior changes. Run `uv run python script/check.py --quick` (or `make quick`), plus the Python tests for the changed behavior. For a dashboard change, run the relevant browser fixture in `tests/frontend/preview.html` against the current component.
2. Copy the working tree's `custom_components/homeostatic` files to the local HA configuration. Stage a clean copy outside `custom_components`, excluding `__pycache__` and `.pyc`, then replace the installed component folder so removed files can't linger. Keep the prior component folder as a small rollback copy. Don't copy development files, modify `.storage`, create a release archive, bump the version, or tag the test.
3. Restart HA Core for Python changes. For frontend-only changes, hard-refresh the browser with the cache disabled and confirm it fetched the changed asset. If the versioned module URL stays cached, bump its query version in the test copy and restart Core. Check the affected screen, the HA logs, the notification-request state, and the saved monitoring choices. If the test fails, restore the prior component and restart.

A local test build can include uncommitted changes. When you report the result, record the source branch and revision, whether the tree was dirty, and which files you copied. Keep notification requests off and monitoring within the existing pilot scope. Don't use this path for stored-data migrations, dependency upgrades, or a change that activates delivery. Test those in isolation, and use the release safeguards below for the live house. This short cycle doesn't need a fresh full HA backup when the stored contracts are unchanged and a usable automatic backup already exists.

## Full release

Monitoring and notification editors require the published health-tree version pinned in the integration manifest and lockfile. For isolated library development, install a sibling checkout into the existing test environment with `uv pip install --python .venv/bin/python --no-deps -e ../health-tree` after syncing. A later `uv sync` restores the published dependency. Release library changes first, then update the adapter pin and pass the clean-install checks below.

1. Finish the behavior documentation, scenarios, changelog, and version changes. Run the quick checks and focused tests while you work. Commit and push the release candidate only when the maintainer asks.
2. Let GitHub CI run `script/check.py` without `--quick`, including strict typing, the complete Python suite, coverage, and frontend tests. CI also builds the archive from the clean commit, checks installation in a fresh HA environment, and runs hassfest. Don't repeat the full suite locally just because CI will run it. Run it locally to track down a specific failure.
3. Publish the release tag and the CI-validated archive only after the exact candidate commit passes. If the owner separately authorizes installation, install that archive on the local HA instance, then check the version, the affected UI, notification requests, and saved monitoring choices. Keep the previous component folder for rollback.

For an ordinary code-only upgrade, a recent usable automatic HA backup is enough. Take a fresh full HA backup before a stored-data migration, an options-schema or dependency change, or when no suitable backup exists. If stored data changes, rolling back needs the paired HA backup and the matching component. Never put old code over newer stored data.
