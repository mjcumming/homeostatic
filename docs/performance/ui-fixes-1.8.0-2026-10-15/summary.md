# Stable 1.8.0 UI verification

The release candidate corrects the draft, removed-source history, narrow navigation and enlarged Summary time findings from the [earlier sweep](../ui-acceptance-expanded-2026-10-15/summary.md). It also restores availability-removal feedback when an opened issue ends during a connection outage.

## Behavior verified

Unfinished editor drafts survive leaving Homeostatic and returning in the same browser tab under the same administrator connection. A save already in progress completes once and updates the returning panel. Reloading, closing the tab or changing users ends this in-memory draft session. Embedded cards have separate editing state.

New history records retain source ownership and the original source name after removal or later registry changes. Existing records load unchanged, with their previous association limits. Focused scenarios cover more than 100 simultaneous removals, reload, verification failures and rollback without lost or duplicated history. Returning to an older build after writing the new metadata requires the matching backup.

Navigation wraps when the tabs need another row. Ordinary desktop and phone navigation retain their previous geometry; the narrow and enlarged-text cases remain inside the available width. The Summary time input keeps its complete native control while the adjacent timezone label can wrap.

Availability-removal review recovers after a connection outage even when the issue has ended. Confirmation stays disabled for stale evidence; cancellation, pending-state guards and error feedback remain available.

Final review also reproduced a stuck loading state in embedded dashboard cards when the connection changed during a request. The correction resets their independent editing state on connection or permission changes. Five actual-method regressions cover pending settings reads, destination discovery and saves, including stale responses arriving while a replacement request is busy.

## Checks and evidence

| Coverage | Passed | Failed | Untested |
| --- | ---: | ---: | ---: |
| Real HA interaction inventory | 65 | 1 | 1 |
| Additional bounded real HA cases | 45 | 0 | 0 |
| Synthetic fixture inventory | 63 | 0 | 4 |

The final matrix contains 15 runs. The real-HA groups executed 354 cases: 351 passes and three repetitions of the Home Assistant reconnect error described below. All 15 runs verified unchanged candidate contents and a matching component checkout.

Required Linux quick checks pass, including 748 frontend tests. Strict typing passes for all 39 production modules. Focused history/save tests pass, including the large-removal and rollback scenarios. Draft and lifecycle regressions cover retained edits, conflicts, authentication changes and late completion of pending saves.

The final browser matrix uses isolated Home Assistant at desktop (1440 × 1000, light), phone (390 × 844, dark) and narrow (320 × 844, light) sizes. Fixture and real-backend results remain separate in the [generated report](report.md) and [machine-readable report](report.json). The [matrix receipt](matrix.json) records each run and its unchanged-candidate checks. The [layout measurements](layout-matrix.json) and [enlarged 320-pixel editor](enlarged-summary-time-320.png) document the responsive correction.

The [candidate manifest](candidate.json) identifies the tested working-tree contents: component SHA-256 `f6b3d6121c09c58ea0b9982778ff420a8af0e100ed9fdae650fdd948dc569612`. The frontend uses module version 83, panel version 35 and card version 31. Browser runs use Home Assistant 2026.9.3, Python 3.14.7, health-tree 0.7.0 and Chromium 143.0.7499.4. CI separately validates the committed release and its clean package installation.

## Remaining limits

The reconnect check still records an unhandled `not_found: Subscription not found.` error. The same failure was reproduced on the plain Home Assistant Overview without mounting Homeostatic or making any Homeostatic request. The [independent reproduction](upstream-ha-reconnect.json) records Home Assistant frontend 20260826.7 and its bundle fingerprint. The failing row remains visible in the generated report; it is not suppressed or counted as passing. Homeostatic's retained view, draft, focus, selection and read-only checks pass in that scenario.

Physical Safari remains untested. Captured synthetic notification requests establish routing and payload behavior, not receipt from a real provider. These checks do not establish full accessibility or representative household load.

All tests use disposable Home Assistant configurations. The household installation and existing Docker development container remain unchanged. Raw traces and authentication-bearing browser files stay in ignored local build directories.
