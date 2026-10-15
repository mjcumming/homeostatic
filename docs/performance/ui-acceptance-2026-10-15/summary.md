# Automated UI sweep — October 15, 2026

The runner is operational. Three agents executed the issue/monitoring/history, policy/settings, and notification workflows against separate disposable Home Assistant instances. All 48 real-HA cases passed at desktop, phone and narrow-phone sizes: 144 successful case executions, with no unexpected browser errors or run diagnostics in the final matrix. No application behavior was changed.

Coverage remains partial. Eight real-HA cases cover their complete inventory contracts; 40 narrower cases exercise portions of other contracts. The remaining 59 of 67 broad real-HA contracts are explicitly untested as complete contracts; they are not 59 observed product failures. The existing synthetic fixtures report 63 passing inventory paths. Their results remain separate from real-backend evidence.

Application files changed concurrently during the later combined narrow run. The runner detected the change and rejected that run as evidence for a single candidate. The completed matrix below remains evidence for its recorded component fingerprint; it does not establish acceptance of the subsequent edits. An intermediate quick check failed one issue-selection test; the final quick check passed all 728 frontend tests. Both results are preserved below without changing application code.

## Results

| Suite | Desktop | Phone | Narrow phone |
| --- | --- | --- | --- |
| Existing synthetic fixtures | 63 passed, 4 untested | 63 passed, 4 untested | 63 passed, 4 untested |
| Real HA: issues, monitoring and history | 7 passed | 7 passed | 7 passed |
| Real HA: policies and settings | 20 passed | 20 passed | 20 passed |
| Real HA: notifications and delivery methods | 21 passed | 21 passed | 21 passed |

Desktop widths were 1200 or 1440 pixels; phone was 390 × 844 in dark mode; narrow phone was 320 × 740, 320 × 800 or 320 × 844 in light mode. Exact dimensions, browser versions and source identifiers are preserved in each receipt. All final matrix runs used the same component SHA-256, `f72d6105e0631b6f156c66d8c26341c35871e757ef0b02f89204c607e0ace3a7`.

The lab used Python 3.14.7, Home Assistant 2026.9.3, health-tree 0.7.0 and Chromium 143. The existing Docker dev container had Python 3.13.12 and Home Assistant 2026.2.3. The prepared WSL environment supplied the required versions without modifying that container. A small missing Chromium system library was extracted into the ignored tools directory.

## Findings

No functional product defect was established by the executed cases. Saves, reopening, independent drafts, deletion/replacement, all 13 policy types, issue acknowledgment, notification pauses, maintenance, availability removal/resumption, and the exercised history/navigation paths passed. Notification tests reached only captured synthetic services. Requested and deliberately failed requests were distinguished; no physical delivery is claimed.

One usability follow-up remains: at 320 pixels, the horizontal navigation strip can show only part of History or retain a scroll offset that clips the start of Open issues. All destinations remained reachable in the browser checks. Review the scrolling affordance against the project's narrow-screen reflow guidance. This is a visual observation, not a demonstrated inaccessible control. See the [settled narrow policy viewport](../../../build/ui-acceptance-policies-narrow-final/final-viewport.png).

Some final notification screenshots caught Home Assistant's transient launch overlay after a navigation reset. Those images do not establish settled visual acceptance. The runner now waits for the actual launch-screen element to disappear before its final screenshots. The later [combined narrow run](../../../build/ui-acceptance-all-narrow-final/report.md) produced a settled viewport, but concurrent application edits invalidated its combined acceptance result; it is excluded from the clean matrix. Full-page captures can also position sticky headers differently from the actual viewport, so both viewport and full-page images are retained.

## Remaining coverage

The four unclosed synthetic inventory contracts are complete navigation/deep-link history, complete keyboard navigation, the full theme/enlarged-text matrix, and physical Safari. Real-HA Back/Forward/refresh and selected keyboard paths did pass narrower assertions.

The detailed receipt identifies all 59 broad real-HA gaps. Important remaining combinations include larger issue hierarchies and pagination, all recovery/missing-evidence variants, every selector/filter/draft-preservation variant, complete keyboard and enlarged-text review, and the full set of interruption cases in each editor. Representative actions in these areas may have passed narrower cases without establishing the whole contract. Firefox, WebKit, physical iOS and real-provider receipt were not tested.

The runner deliberately returns an incomplete status while required coverage is untested. This sweep does not close full product acceptance or establish that every possible click sequence works.

## Harness corrections and verification

Initial probes exposed harness problems: the fresh HA HTTP-port confirmation dialog, missing Recorder in the minimal HA shell, versioned panel selection, asynchronous save acknowledgments, mobile tree/detail navigation, duplicate controls behind dialogs, coalesced WebSocket responses and overly broad authentication initialization. These were corrected in test infrastructure. The stale phone issue fixture now checks the device name in its parent heading and Related findings beneath it, matching the current UI; its recovery checks then completed. Earlier calibration receipts remain under `build/` and are excluded from the final clean matrix.

The final coverage audit reclassified 14 originally credited inventory paths as narrower cases. Examples include maintenance that checked visible expiry without verifying exact persisted scope, method deletion of an unused copy without shared-use deletion, and timing saves without every invalid-input variant. Original shard receipts retain their initial labels; the audited merged receipt and future runs use the corrected classification. This changes coverage accounting, not the 48 observed case outcomes.

The lab smoke check verified real save/reread/reload persistence, exact reset restoration and one captured notification request. The required Linux quick checks initially passed, including all 717 frontend tests. During concurrent application edits, an intermediate check reported 725 passes and one failure: `an opened device issue selects only its current unavailable members`, at `tests/frontend/issue-monitoring.test.mjs:114`, attempted to read `sourceIds` from a null plan. Its [failure log](../../../build/ui-sweep/quick-check-concurrent-edits.log) is retained. After the final coverage-accounting correction, the [final quick check](../../../build/ui-sweep/quick-check.log) passed all 728 frontend tests, including the three runner-specific tests. The browser sweep still needs a stable-candidate rerun before acceptance of the subsequent application edits.

Final cleanup checks found no remaining lab processes or temporary configuration/authentication directories. No commit, publication, household deployment or household notification was performed by this work.

## Evidence and rerun

- [Detailed merged receipt](report.md) and [machine-readable receipt](report.json).
- [Default single-command desktop run](../../../build/ui-acceptance-all-final/report.md).
- [Default single-command narrow run](../../../build/ui-acceptance-all-narrow-final/report.md).
- [Automated sweep instructions](../../development-workflows.md#automated-isolated-ui-sweep).

The default runner executes the fixture collection and real-HA workflows. For parallel execution, assign the three groups to agents with distinct ports and output directories, then merge their receipts. Reports preserve failure evidence and never promote a fixture pass into a real-HA pass. Traces, screenshots, logs and captured mock requests remain in the linked generated run directories.
