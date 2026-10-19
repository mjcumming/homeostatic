# Local testing and release

Use the local test cycle to try a small, contained change in the owner's Home Assistant pilot. Use the release cycle when the change is ready to publish. Neither cycle changes saved monitoring choices or turns on notification requests unless the owner asks for it.

Isolated save measurements and their reproduction steps are in [Save performance](save-performance.md).

## Complete a change

Keep each change small enough to review as one outcome. One person or agent owns completion across all affected repositories, including delegated work. Identify that owner, the governing decision, affected files and observable completion condition in the task's opening update.

- Finish or explicitly park overlapping implementation before another task changes that subsystem. A handoff names the remaining work and files it owns. Parallel reviews, tests and disjoint edits can continue; preserve unrelated changes.
- Read the owning specification and relevant decisions first. Resolve contradictions at their owning source before dependent edits. Accepted decisions remain binding; proposals and prototypes do not override them. When the maintainer changes a decision, record its supersession and update the behavior and executable coverage together.
- Replacement includes removal of obsolete code, callers, routes, configuration paths, fixtures and guidance. Required compatibility or intentionally dormant behavior needs a concrete use and a linked decision. Discarded development configurations alone do not justify migration machinery; preserve published contracts and saved user data as required.
- Verify the complete promised user workflow, including integration boundaries, and inspect the final diff and package contents. For UI work, use the bounded control/path inventory and generated receipt described below; record pass, fail or untested for each promised path. When a recurring mistake can be checked mechanically, add the smallest useful check to the existing test or validation runner.
- Update [Current work](roadmap.md#current-work) when implementation or acceptance changes. Start it with the next product outcome and its remaining completion conditions; keep detailed status and evidence below. The specification owns behavior, ADRs own rationale, and the changelog owns unreleased and published changes. Link to those owners; read changing versions, thresholds and file inventories from configuration or discovery. Remove completed work from the active table when its acceptance is closed.
- Close with the result, verification and specific remaining work, including cross-repository adoption. State commit, release and installation status separately when relevant. Partial verification cannot close the whole outcome; external actions still require maintainer authorization.

## Quick local test

1. Update the spec and an executable scenario when behavior changes. Run `uv run --no-sync python script/check.py --quick` (or `make quick`), plus the Python tests for the changed behavior. For dashboard changes, complete the scoped rendered-browser acceptance below using the [automated isolated UI sweep](#automated-isolated-ui-sweep). Quick checks, full checks and CI do not run this sweep.
2. Copy the working tree's `custom_components/homeostatic` files to the local HA configuration. Stage a clean copy outside `custom_components`, excluding `__pycache__` and `.pyc`, then replace the installed component folder so removed files can't linger. Routine code and UI installs do not create or retain rollback copies or extra backups unless the maintainer asks. Remove temporary staging files after installation. Don't copy development files, modify `.storage`, create a release archive, bump the version, or tag the test.
3. Restart HA Core for Python changes. For frontend-only changes, hard-refresh the browser with the cache disabled and confirm it fetched the changed asset. For an updated frontend, advance its module/import versions and current panel and generated-card element names together. A fresh URL cannot replace a custom element already registered under the same name. Test with the previous element names already registered, then restart Core and verify both the panel name and fetched assets. Check the affected screen, the HA logs, the notification-request state, and the saved monitoring choices. Resolve failures before declaring the installation verified.

Before UI acceptance, choose the affected paths in the [executable control/path inventory](../tests/frontend/control-path-inventory.mjs). A contained presentation change needs its rendered fixtures and visual inspection. Changes to interaction, saving or Home Assistant lifecycle need the affected real-HA groups; include the layout group when navigation, reconnect or shared layout changes. Use all groups for app-wide changes or full product acceptance. Include each in-scope entry point, rendered control and meaningful outcome, including menus, dialogs, keyboard paths and distinct save scopes. Reuse existing fixtures. Each inventory row names the expected visible result and expected persisted state or absence of a mutation. Equivalent controls may share a case only when their behavior and saved scope are the same. Keep the detailed pass/fail/untested receipt as a generated run artifact and link it from Current work; do not create another maintained acceptance document.

Exercise each path through the rendered browser controls and record the result. Calling a handler or backend API directly can support a check but cannot establish that its UI path works. After a save, inspect confirmed settings and reopen the editor; verify the intended change persisted and unrelated settings stayed intact. Include cancellation, invalid input, failed saves, stale revisions, navigation and reconnect where those states apply. Record the build and browser/device used, with evidence and a reason for failed or untested rows. A passing subset does not close an inventory containing untested promised paths.

Inspect the rendered result as well as the assertions, using the page or captured screenshots. First confirm that the page or dialog owns the task it presents and reuses existing workflows for other tasks. Check clarity, repeated information and action placement against the [product goals](spec.md#user-goals) and [UI purpose test](spec.md#purpose-before-controls), including narrow layouts and enlarged text when layout changes. Compare each changed disclosure or navigation step with what is already visible: identify the useful information or distinct task it adds, and remove layers that only repeat the current view. For a shared workflow, exercise the affected entry points and return paths, checking target identities, contextual controls and restored context. Verify that selection controls offer a real choice and grouping makes repeated type labels unnecessary. For collective actions, include master and individual selection, subset and zero selection, updates during submission, partial failure and later arrivals without inherited selection or controls; singular entry needs no selection controls. Trace configuration warnings to relevant configuration evidence and distinguish fixture examples from live installation state. Record task ownership, user benefit, any retained disclosure's purpose and the inspected evidence in the same receipt; do not create a separate design checklist. If visual inspection is unavailable, keep that acceptance untested; passing interaction checks alone cannot close it.

For changes requiring real-HA coverage, exercise every in-scope interaction path against isolated Home Assistant and mocked destinations first, including notification, destructive and failure cases where applicable. Then perform a bounded live check of the authorized paths and compare saved settings before and after. Request real notifications only when explicitly authorized, identifying the configured destination and distinguishing a delivery request from confirmed receipt. Physical Safari requires a separate result on an actual iPhone or iPad, with the device and Safari version recorded; keep it untested until that check occurs.

A local test build can include uncommitted changes. When you report the result, record the source branch and revision, whether the tree was dirty, and which files you copied. Keep notification requests off and monitoring within the existing pilot scope. Don't use this path for stored-data migrations, dependency upgrades, or a change that activates delivery. Test those in isolation, and use the release safeguards below for the live house. Routine code and UI installs do not require a separate backup inventory check or rollback-preparation workflow.

For an explicitly authorized local pilot that requires an unpublished library, stage a uniquely versioned wheel in persistent HA configuration and reference that exact wheel from the installed manifest. Run the full local checks and rehearse clean installation and copied-state restoration on the installed HA version before deployment. Keep a full backup and paired component, library and state rollback; restoring a public version pin alone may retain a local-version package. Leave repository release pins unchanged and record the pilot separately from publication in Current work.

## Automated isolated UI sweep

Run the existing fixture inventory and real browser workflows with `script/ui_acceptance.mjs`. It starts a temporary Home Assistant configuration on loopback, copies the current component, seeds synthetic sources and captures notification requests in local mock services. Each invocation owns its configuration and removes its temporary authentication file on exit. It never accepts a household HA URL.

Use the Linux development environment described in [Development](development.md). The runner needs Node.js 22 or newer and Playwright. Reuse an installed Playwright module through `PLAYWRIGHT_MODULE` or `--playwright-module`; a fresh test-only installation can live in the ignored tools directory:

```bash
npm install --prefix .tools/ui-acceptance --no-save playwright@1.57.0
node .tools/ui-acceptance/node_modules/playwright/cli.js install --with-deps chromium
uv run --no-sync node script/ui_acceptance.mjs --python "${UV_PROJECT_ENVIRONMENT:-.venv}/bin/python" --output build/ui-acceptance/desktop
```

For a stable sweep while other work continues, freeze the current component and existing browser fixtures first. Choose an unused snapshot directory for each build, then give every worker the same snapshot:

```bash
node script/ui_acceptance.mjs --freeze build/ui-acceptance/candidate
uv run --no-sync node script/ui_acceptance.mjs --snapshot build/ui-acceptance/candidate --python "${UV_PROJECT_ENVIRONMENT:-.venv}/bin/python" --output build/ui-acceptance/desktop
```

The snapshot records the source revision, dirty state and content hashes. Both browser fixtures and temporary HA use the frozen files. The runner checks that they stayed unchanged and separately reports whether the working checkout still matches.

Use `--group issues`, `--group policies`, `--group notifications` or `--group layout` to select the affected areas or divide work between agents. The layout group covers cross-page navigation, keyboard, reconnect and responsive behavior. Give concurrent invocations distinct `--port` and `--output` values. `--mode fixtures` runs the existing synthetic browser scenarios; `--mode live` exercises the temporary HA backend through pointer and keyboard actions. The default runs both. `--width`, `--height`, `--theme` and `--browser` select the browser matrix; the requested browser must be installed. For example, `--width 390 --height 844 --theme dark` checks a phone-sized viewport. This does not establish physical-device coverage.

Each output directory contains `report.md`, `report.json`, fixture receipts, failure screenshots and the real-HA browser trace and log. Reports separate fixture results from real-backend results and distinguish the complete inventory from narrower additional cases. Exit status 1 means a failure or run diagnostic; 2 means coverage remains untested. A scoped run can return 2 because unrelated inventory rows remain untested. Review every declared in-scope row and run diagnostic before closing the change; retain the other rows as untested and report the bounded result. A passing retry does not erase a failure when reports are merged. Inspect traces locally because they describe the disposable authenticated test session.

For a bounded real-HA retry, set `HOMEOSTATIC_UI_CASES` to comma-separated exact case IDs from the report. The report records that selection and leaves other paths untested. Preserve the original report and explain any corrected fixture assumptions alongside the retry.

Merge completed shards from the same component contents with repeated `--merge` arguments:

```bash
node script/ui_acceptance.mjs --merge build/ui-acceptance/issues/report.json --merge build/ui-acceptance/policies/report.json --merge build/ui-acceptance/notifications/report.json --merge build/ui-acceptance/layout/report.json --output build/ui-acceptance/combined
```

Agents executing a report-only sweep may correct the runner or fixture setup, keeping earlier diagnostics and identifying the correction. They report product defects without changing application behavior. Keep skipped states and unimplemented paths visible; neither a successful mocked fixture nor a narrower real-HA case closes a broader untested inventory row.

## Full release

Release builds require the published health-tree version pinned in the integration manifest and lockfile. [Current work](roadmap.md#current-work) identifies any unpublished library prerequisite. Follow [Changes spanning both repositories](development.md#changes-spanning-both-repositories) for isolated development with the sibling checkout. Release library changes first, update the adapter pins and lockfile, and pass the clean-install checks below. An editable checkout or local test result does not satisfy that release requirement.

1. Finish the behavior documentation, scenarios, changelog, and version changes. Run the quick checks and focused tests while you work. Commit and push the release candidate only when the maintainer asks.
2. Let GitHub CI run `script/check.py` without `--quick`, including strict typing, the complete Python suite, coverage, and frontend tests. CI also builds the archive from the clean commit, checks installation in a fresh HA environment, and runs hassfest. Don't repeat the full suite locally just because CI will run it. Run it locally to track down a specific failure.
3. Publish the release tag and the CI-validated archive only after the exact candidate commit passes. If the owner separately authorizes installation, install that archive on the local HA instance, then check the version, the affected UI, notification requests, and saved monitoring choices. Routine code-only installations do not retain a separate component rollback copy unless the maintainer asks.

Ordinary code-only upgrades need no manual backup or rollback preparation. Before a stored-data migration, options-schema or dependency change, check for a suitable backup and take a fresh full HA backup when needed. If stored data changes, recovery needs the paired HA backup and the matching component. Never put old code over newer stored data.
