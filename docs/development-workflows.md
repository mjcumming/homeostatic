# Local testing and release

Use the local test cycle to see a bounded change in the owner's Home Assistant pilot. Use the release cycle when the change is ready to publish. Neither cycle changes saved monitoring choices or enables notification requests unless the owner specifically asks.

## Quick local test

1. Update the spec and an executable scenario when behavior changes. Run `uv run python script/check.py --quick` (or `make quick`), plus the Python tests for the changed behavior. For a dashboard change, run the relevant browser fixture in `tests/frontend/preview.html` against the current component.
2. Copy the working tree's `custom_components/homeostatic` files to the local HA configuration. Stage a clean copy outside `custom_components`, excluding `__pycache__` and `.pyc`, then replace the installed component folder so removed files cannot linger. Keep the prior component folder as a small rollback copy. Do not copy development files, modify `.storage`, create a release archive, bump the version, or tag the test.
3. Restart HA Core for Python changes. For frontend-only changes, hard-refresh the browser with cache disabled and confirm it fetched the changed asset. If the versioned module URL remains cached, bump its query version in the test copy and restart Core. Check the affected screen, HA logs, notification-request state, and saved monitoring choices. Restore the prior component and restart if the test fails.

This is a local test build, which may contain uncommitted changes. Record the source branch and revision, whether the tree was dirty, and the copied files when reporting the result. Keep notification requests off and monitoring within the existing pilot scope. Do not use this path for stored-data migrations, dependency upgrades, or a change that activates delivery; test those in isolation and use the release safeguards below for the live house. A fresh full HA backup is not part of this short cycle when the stored contracts are unchanged and a usable automatic backup already exists.

## Full release

1. Finish the behavior documentation, scenarios, changelog, and version changes. Run the quick checks and focused tests while working. Commit and push the release candidate only when the maintainer asks.
2. Let GitHub CI run `script/check.py` without `--quick`, including strict typing, the complete Python suite, coverage, and frontend tests. CI also builds the archive from the clean commit, checks installation in a fresh HA environment, and runs hassfest. Do not repeat the full suite locally solely because CI will run it; use a local full run to resolve a specific failure.
3. Publish the release tag and CI-validated archive only after the exact candidate commit passes. Install that archive on the local HA instance, then verify the version, affected UI, notification requests, and saved monitoring choices. Keep the previous component folder for rollback.

Use a recent usable automatic HA backup for an ordinary code-only upgrade. Take a fresh full HA backup before a stored-data migration, options-schema or dependency change, or when no suitable backup exists. If stored data changes, rollback requires the paired HA backup and matching component; do not put old code over newer stored data.
