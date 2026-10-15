# Expanded isolated UI sweep — October 15, 2026

The existing runner now freezes the component and browser fixtures before agents test them. Policy, notification, issue and layout groups use separate disposable Home Assistant configurations, real rendered controls and captured notification services. This sweep changes test infrastructure and acceptance records only.

## Result

| Coverage | Passed | Failed | Untested |
| --- | ---: | ---: | ---: |
| Real HA interaction inventory | 62 | 4 | 1 |
| Additional bounded real HA cases | 44 | 1 | 0 |
| Synthetic fixture inventory | 63 | 0 | 4 |

The final matrix contains 15 runs: three fixture runs and four real-HA groups at three layouts. The real-HA groups executed 354 cases, with 339 passes and 15 failures. Repeated failures across layouts reduce to four inventory rows; the additional failed case reproduces the same pending-save draft loss. Visual review adds the enlarged-time-field finding within the failed layout row. Physical Safari is the sole untested real-HA inventory row. These counts are generated from the [accepted run matrix](matrix.json), without calibration trials.

Required WSL quick checks pass: formatting, lint and 731 frontend tests, including six runner regression tests. Final cleanup found no active sweep processes or temporary lab configurations. The current component still matches the frozen candidate after all runs.

## Findings

| Finding | Reproduction and observed result |
| --- | --- |
| An unrelated draft is lost across HA navigation | Edit a policy without saving, begin a delayed notification save, open HA Overview, then go Back. HA replaces the Homeostatic panel. The notification saves exactly once, but reopening the policy shows its saved name instead of the unsaved draft. This is a host-navigation lifetime boundary; same-instance reconnect preserves the draft. |
| Parent history omits a removed source | Resolve an entity problem, then remove its registry entry. Global History retains the recorded problem and original name, but the parent integration's history shows no retained problem. The stored source has its id, name and kind, without the ownership information needed to associate the removed member with its parent. |
| Reconnect raises an uncaught error | Close the browser's real HA WebSocket, hold authentication, then reconnect. Draft, DOM identity, focus and selection recover, and the disconnected editor is read-only. An unhandled `not_found: Subscription not found.` rejection still occurs. The responsible layer has not been established. |
| Navigation requires horizontal scrolling at 320px | History is partly outside the visible tab strip; a retained scroll position can also clip Open issues. The controls remain reachable by scrolling. This fails the inventory's no-required-horizontal-scroll expectation in both themes. |
| Enlarged text hides Summary time | With a test stylesheet doubling text, the Summary time field clips minutes and AM/PM at 390px and collapses to a nearly empty outline at 320px, in both themes. The timezone label occupies the available row width. This was found by visual review beyond the geometric overflow assertions. |

The generated receipt keeps failures even when another case or layout passes. Notification saves, failed and uncertain outcomes, exact shared-definition changes, captured delivery requests and the four pending-save outcome variants remain separately reported. A captured request does not establish provider delivery.

## Candidate and environment

Every final shard uses the same frozen component, SHA-256 `4163a06992a1b5902fa52f573f8b3a969d9c1e420d31c47de97bfdf21935aa9a`, from `main` at `2cc33ab69ff4ef3434cd58af35605a20b215d3de` with existing uncommitted changes included. The snapshot also records the fixture hash. Each run verifies its frozen files and separately compares the current component checkout.

The lab uses Home Assistant 2026.9.3, Python 3.14.7, health-tree 0.7.0 and Chromium 143.0.7499.4 in the prepared WSL environment. The existing Docker development container was left unchanged. Desktop is 1440 × 1000 light, phone is 390 × 844 dark, and narrow is 320px light; the narrow policy run is 740px tall and the other narrow runs are 844px tall. The layout group additionally examines all six pages at all three widths in both themes, plus doubled editor text.

## Calibration and limits

Earlier trials remain under `build/ui-sweep-v2/`. Harness corrections included request ordering during held WebSocket messages, settled catalog and focus waits, observed HA sidebar navigation, real coalescing setup, and exact source/filter/history assertions. A review tightened tests that previously checked only nonempty results. Startup stalls occurred before any acceptance case. The readiness watcher now retains file-change events received during an incomplete read; a deterministic regression test reproduces that race. Phase logs and bounded startup waits make other startup failures explicit. The accepted matrix excludes those calibration runs and preserves observed application failures.

One early notification trial logged `now must not go backwards` during a fixture reset. It did not recur in the three final notification runs; it remains an unclassified calibration diagnostic. Optional FFmpeg/jpeg warnings and absent optional TopoMation commands do not establish UI defects.

Physical iOS/Safari remains untested. Phone-sized Chromium, a test stylesheet and synthetic HA evidence do not establish physical-device behavior, native browser zoom, full accessibility conformance or actual notification receipt. The receipt covers the repository's bounded interaction inventory, not every possible sequence of clicks.

## Evidence and rerun

- [Generated detailed receipt](report.md) and [machine-readable receipt](report.json).
- [Frozen candidate](candidate.json), [navigation at 320px](navigation-320.png), [enlarged Summary time](enlarged-summary-time-320.png), [draft after HA navigation](draft-after-host-navigation.png), [removed-source history](removed-source-history.png) and [measured layout results](layout-matrix.json).
- [Quick-check output](quick-check.log).
- [Automated sweep instructions](../../development-workflows.md#automated-isolated-ui-sweep).
- Raw screenshots, traces, logs and captured requests are linked from the generated receipt. Traces describe disposable authenticated sessions and remain local run artifacts.

No application fixes, household notification requests, commits, publication or household deployment were performed by this sweep.
