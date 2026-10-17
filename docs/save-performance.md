# Save performance measurements

## Policy name and temperature-limit saves

The [October 15 isolated measurement](performance/policy-save-2026-10-15.json) uses 6,000 registered entities, 300 devices and two selected temperature sensors. Each case makes three saves through the normal WebSocket handler, with real runtime Store writes and read-back of an approximately 12.3 MB snapshot. Registry storage remains mocked and notifications remain off.

| Edit | Before median | After median |
| --- | ---: | ---: |
| Policy name | 1.151 seconds | 0.613 seconds |
| Temperature limit | 1.379 seconds | 0.785 seconds |

Policy edits previously serialized the full source graph and catalog again even when most display records were unchanged. The correction reuses unchanged serialized source rows and retains catalog output only when both candidates and enrollment rules remain equal. Full discovery, detection evaluation, queued observations, revisions, verified storage and rollback remain in the transaction. Regression scenarios compare the resulting view against full fresh serialization and verify that renames preserve findings while threshold changes replace the applicable detection expectation.

These are three-sample isolated endpoint medians, not a household latency distribution or browser-paint measurement. The reported five-to-ten-second live delay has not been measured with this candidate. Installation and live acceptance are tracked in the [roadmap](roadmap.md#current-work).

## Historical monitoring-edit measurements

Measured on 2026-10-13 with Python 3.14.7, Home Assistant 2026.9.3 and the published health-tree 0.6.0. The fixture creates 10 integration entries, 300 devices, 6,000 entities and 10 Repairs. The run used the Windows checkout through Ubuntu on WSL. Requests exercised the integration and authenticated WebSocket API, but the inherited Home Assistant test fixture replaced HA Store load/write operations with an in-memory JSON roundtrip. These historical timings include application work and mocked persistence; they do not measure disk I/O or durable-write latency. Notification requests stay off. No household installation participates.

The baseline forces the retained integration-reload path and sequential catalog requests in the same checkout. The changed path applies monitoring edits in the existing runtime and fetches at most four catalog pages concurrently. Each direction is measured three times; the table gives medians in seconds. Results depend on machine and Home Assistant scheduling.

| Change | Baseline: applied | In place: applied | Baseline: catalog ready | In place: catalog ready |
| --- | ---: | ---: | ---: | ---: |
| Device off | 0.883 | 0.399 | 2.214 | 0.914 |
| Device on | 0.861 | 0.452 | 2.375 | 0.979 |
| Entity off | 1.271 | 0.581 | 2.655 | 1.119 |
| Entity on | 1.931 | 1.412 | 6.590 | 3.247 |
| Repair off | 0.915 | 0.440 | 2.212 | 0.925 |
| Repair on | 0.834 | 0.437 | 2.347 | 0.950 |

Applied ends when the save response arrives, after the runtime completes its write/read-back sequence against mocked storage and updates the dashboard publication. Catalog ready includes receiving every catalog page and draining HA tasks. Catalog requests run in batches of four in the harness; the frontend uses four workers that replenish individually. It does not measure a browser paint or the time a physical device takes to report. The real browser fixtures independently exercise direct saving, failed saves, retained drafts and phone/desktop rendering.

Validation takes less than a millisecond in these runs. Full reload adds stopping/draining, snapshot loading and startup. The in-place path removes those lifecycle steps, retains one mocked write/read-back sequence when no notification outbox needs draining, and still performs source discovery and engine/policy work. Large removals restore the final registered graph once through public library APIs. Activity history serializes only the 50 records it retains. The rollback checkpoint retains references to catalog views that discovery replaces instead of copying those views.

The detailed report records inclusive timings for validation, stopping/draining, storage, snapshot loading, discovery, engine/policy evaluation, startup and dashboard publication. Inclusive phases overlap: discovery is inside evaluation, and evaluation/storage are inside startup in the baseline. Do not sum them. Catalog refresh time is the difference between catalog-ready and applied totals. The remaining unclassified time includes HA task scheduling, transport, platform lifecycle and transaction checkpoint creation.

## Notification editor saves with real runtime storage

A separate 2026-10-14 run measured five notification editor changes against the local checkout in the prepared WSL environment, using the sibling health-tree source. The fixture had 6,000 entities, 300 devices, 30 existing issues and a runtime snapshot of about 13 MB. Notifications remained off and destinations were mocked.

This scenario restores the original bound HA Store load/write methods for the integration's runtime store, directs that store to a temporary filesystem path, and checks that the saved file exists. Runtime snapshot writes and read-back therefore use real file I/O. Home Assistant's entity/device registries remain mocked. This is an isolated filesystem measurement, not a household hardware or full-HA storage benchmark.

Each cell below is one save response measurement in seconds, not a median. The table compares the same scenario before and after the local correction. The harness also records one first sample after completed fixture startup. The settled sample reverses that edit. The burst sample queues 50 actual HA state transitions to unavailable immediately before the save; those transitions increase the fixture to 80 issues. It does not simulate a busy household startup.

| Change | Settled before | Settled after | Burst before | Burst after |
| --- | ---: | ---: | ---: | ---: |
| Notification name | 0.635 | 0.357 | 2.119 | 1.744 |
| Notification time | 0.667 | 0.439 | 2.225 | 1.901 |
| Policy notification assignment | 0.684 | 0.328 | 2.303 | 1.987 |
| Notification delivery-method choice | 0.769 | 0.413 | 2.730 | 2.621 |
| Shared delivery-method name, with reload | 1.311 | 1.623 | 3.335 | 3.499 |

The four in-place after samples avoid forced source discovery. The shared-method edit retains its reload path and did not improve in this comparison. These individual samples do not establish a distribution or guarantee under household load. Both sets measure the whole save response; the instrumented publication subphase changed scope when inventory was computed once before snapshot construction, so its isolated before/after duration is not directly comparable.

The subsequent settings read took 2.0–3.7 milliseconds across both runs. In the before run, pending observation processing accounted for 1.24–1.70 seconds within the four in-place burst saves; the reload case included 1.72 seconds. Phases are inclusive and overlap, so their sum is not an end-to-end latency. The saved settings are checked against the submitted draft, and the harness verifies that the four eligible edits retain the runtime while the shared-method edit reloads it.

These isolated samples do not reproduce or attribute the reported 14.4-second live Save action. They exclude browser interaction, household load and the live transport. The bounded endpoint probe below measures live behavior separately; it still does not measure the browser interaction or establish a corrected live latency.

## Bounded live endpoint probes

On 2026-10-14, an authorized WebSocket probe changed one notification name and then restored it. Global sending stayed off; the subsequent verification found the expected settings, a loaded integration, no pending messages and no outbox requests. The local diagnostic build was `ui-20261014225752`. These are endpoint request/response timings, not timings from an actual browser button or paint.

| Probe | Client endpoint response | Server request total | Evaluation | Storage write/read/compare | Runtime lock wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Temporary name change | 13.991 s | 8.040 s | 5.724 s | 0.135 s | <0.001 s |
| Restore original name | 11.667 s | 11.412 s | 6.080 s | 0.195 s | 2.129 s |

Pending-observation draining was below 0.001 seconds in both saves. Snapshot creation was another 0.087 and 0.090 seconds respectively, outside the storage column. Evaluation dominated the measured save work; this evidence does not support treating disk writes as the main delay.

The dedicated DEBUG logger records only fixed phase names and elapsed durations. Its runtime storage phases also appear during background persistence, so unrelated lines cannot be summed into the selected save. About 1.8 seconds passed between the completed save phase and the server request total in each probe. The code synchronously publishes the dashboard in that interval and previously read the dynamic inventory twice. The first response also arrived about 5.95 seconds after the server total; queued synchronous refresh work can delay transport, but the existing logs do not identify that interval completely.

The local correction avoids forced source rediscovery for notification-only edits and reuses one dynamic inventory read within each dashboard publication. The endpoint receipts are `diagnostic-probe-save.json` and `diagnostic-probe-restore.json` in the generated deployment evidence directory. The baseline phase values above were captured in the session record; the original raw log file was subsequently overwritten and is not retained baseline evidence. `final-state-verification.json` records the subsequent settings and runtime check.

The repeat on `ui-20261014231138` did not resolve live latency:

| Probe | Client endpoint response | Server request total | Evaluation | Storage write/read/compare | Runtime lock wait |
| --- | ---: | ---: | ---: | ---: | ---: |
| Temporary name change | 12.573 s | 5.213 s | 0.091 s | 0.253 s | 2.067 s |
| Restore original name | 22.516 s | 16.803 s | 6.273 s | 0.141 s | 8.332 s |

The first evaluation reused clean inventory, but most endpoint delay fell before the measured handler or while waiting for the runtime lock. The restore encountered dirty inventory and another long evaluation. About 1.6 seconds followed the completed save phase before each server total; the restore endpoint also arrived about 5.7 seconds after its server total. These measurements leave event-loop contention and repeated background reconciliation open. They do not establish improved live latency or browser-button responsiveness. Receipts are `optimized-probe-save.json`, `optimized-probe-restore.json` and `optimized-save-timing-logs.json`.

A subsequent read-only 45-second event sample recorded 266 state changes and two config-entry updates affecting only state and reason; it recorded no catalog-relevant state metadata, climate or registry events. Home Assistant emits both the generic entry-update signal and the dedicated entry-state callback for those lifecycle changes. The generic handler was forcing rediscovery even when entry catalog metadata was unchanged. This identified a redundant trigger: the follow-up correction keeps a clean refresh while rebuilding only for catalog changes. The aggregate receipt is `catalog-event-counts.json` and retains no source identifiers or values.

After that correction, the installed candidate `ui-20261014232908` passed the same bounded endpoint repeat:

| Probe | Client endpoint response | Server request total | Evaluation | Storage write/read/compare | Runtime lock wait | Pending observations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Temporary name change | 3.115 s | 2.654 s | 0.099 s | 0.129 s | <0.001 s | <0.001 s |
| Restore original name | 6.468 s | 6.132 s | 0.090 s | 0.126 s | 2.027 s | 1.809 s |

The subsequent settings read took 0.085 seconds. Both evaluations reused unchanged inventory. The restore still waited for the runtime and processed captured observations; about 2.0 and 1.7 seconds respectively passed between the completed save phase and each server total. These single samples demonstrate a bounded improvement, with remaining queueing and publication costs. They do not establish instant saves, a latency distribution or acceptance under sustained household load. The endpoint and raw phase receipts are `lifecycle-guard-probe-save.json`, `lifecycle-guard-probe-restore.json`, `lifecycle-guard-probe-after.json` and `lifecycle-guard-save-timing-logs.json`. Actual-button continuity is recorded separately in the [UI control/path receipt](performance/ui-control-paths-2026-10-14.json). On that candidate, profile name save and restore retained the editor. Shared-method save and restore stayed on the same route and returned to the same editor after temporary monitoring unavailability; an unrelated draft survived both reloads and was discarded through its actual control. Visible success was observed by 15.459 and 9.906 seconds for the profile, and by 16.116 and 13.311 seconds for the method. Those browser observations are upper bounds that include tooling and polling intervals, not precise endpoint latencies. A stale editor from before the API probe correctly rejected its first save; reloading current settings allowed the successful repeat. The final saved-state check at 23:39:57 UTC confirmed the requested settings, a loaded integration, global sending off and no pending messages or outbox requests. Diagnostic logging returned to its prior setting; `final-browser-save-timing-logs.json` retains the final live trace.

## Destination lookup follow-up

The next measured cost was destination discovery during policy reads. A policy using only reusable `method:` routes has no direct `phone:` or `notify:` channels for the unavailable-destination helper to report, yet the helper still enumerated all destinations. On Home Assistant 2026.10.0, a synthetic registry containing 701 actual DeviceEntry records and one phone took 0.106–0.112 seconds per helper call across three samples. Profiling attributed 0.248 of 0.253 seconds to deprecation frame inspection while reading device ownership. This was a helper measurement with synthetic lookups, not a runtime save or live installation.

The correction collects the configured direct channels first and returns an empty result without discovery when that set is empty. The same three-sample helper measurement fell to 0.5–2.6 microseconds. Mixed and direct-channel policies still discover current destinations on each read, including disappearance, recovery and disablement. No cache or observation-order change was introduced. Raw helper receipts are `save-publication-destination-before.json` and `save-publication-destination-after.json` in the generated deployment evidence directory.

The existing Home Assistant 2026.9.3 real-runtime-storage benchmark showed no material end-to-end improvement: the settled name save measured 0.339 seconds before and 0.342 after, and the burst sample 1.733 before and 1.742 after. Those are single samples with mocked registries; that HA version does not reproduce the newer deprecation cost.

The installed candidate `ui-20261015000210` was verified running with unchanged saved choices before the following endpoint repeat. The fresh before samples used the preceding accepted build. Each cell is one request in seconds; the final two columns are server phases from the corrected build.

| Probe | Before endpoint | After endpoint | After server total | After evaluation | After completed save to request total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Temporary name change | 2.262 | 1.446 | 1.423 | 0.084 | 0.068 |
| Restore original name | 3.141 | 0.683 | 0.594 | 0.085 | 0.067 |

The interval from completed save to server request total fell from 1.677 and 1.725 seconds respectively. That interval includes dashboard publication; it is not an isolated publication benchmark. The settings read took 0.017 seconds. Runtime lock waiting and pending-observation draining were each below 0.001 seconds in both final samples. Checkpoint creation took 0.846 seconds for the name change and 0.071 seconds for restoration, showing that other variable work remains. These measurements support the bounded destination-lookup correction, without establishing instant saves or a latency distribution under sustained load.

The generated `save-followup-20261014` evidence directory retains the before/after endpoint receipts, `timing-comparison.json` summary including the observed settings read, and separate `before-followup-save-timing-logs.json` and `after-followup-save-timing-logs.json` traces. The API probe restored the complete saved settings with global sending off.

Final actual-button checks on this candidate retained the editor through profile and shared-method save/restore, with guarded progress during the owned reload. An unrelated draft survived the reloads and its Discard action restored the saved value. The shared-method requests still took 8.151 and 7.450 seconds of server handling because they retain the full reload boundary. Visible completion was observed by 17.209 and 22.688 seconds respectively; those upper bounds include browser calls, polling and screenshot delays and are not precise save latencies. The remaining reload/setup interval is not attributed to individual phases by this trace; further optimization requires that measurement. The profile fast path does not establish that all saves are fast. `final-browser-save-timing-logs.json` retains these server totals.

The final October 15 00:10:24 UTC check confirmed the complete saved baseline, a loaded integration, global sending off, no pending messages or outbox requests, matching served assets and no Homeostatic errors. The [UI control/path receipt](performance/ui-control-paths-2026-10-14.json) distinguishes 33 freshly repeated affected browser paths from the prior full inventory and carried-forward evidence. Physical Safari remains untested; the browser and endpoint results do not establish sustained-load or all-provider acceptance.


## In-place delivery-method follow-up

After the method transaction was extended under [ADR 0067](adr/0067-save-delivery-methods-in-place.md), the isolated Home Assistant 2026.9.3 harness repeated the method-name journey with 6,000 entities, 300 devices and 30 existing issues. Runtime storage used real file I/O; registries and destinations remained mocked. Each cell is one save response in seconds.

| Load | Previous reload path | In-place method save |
| --- | ---: | ---: |
| First after completed fixture startup | 1.397 | 0.377 |
| Settled | 1.343 | 0.353 |
| 50 queued state changes | 2.876 | 1.787 |

The changed path has no stop, snapshot-load or source-discovery phase. It still drained the burst's captured observations, taking 1.169 seconds within that save, and performed verified storage. Settings reads after the three saves took 2.3–2.9 milliseconds. These are whole-response comparisons, not medians or independent sums of inclusive phases. The before/after artifacts are `save-methods-before/notification-save-method_definition.json` and `save-methods-after/notification-save-method_definition.json` in the generated deployment evidence directory. The corrected installed candidate `ui-20261015004931` then passed all six actual-button saves below. Each edit was restored before moving to the next; all values are seconds.

| Method edit | Server save | Server restore | Browser save bound | Browser restore bound |
| --- | ---: | ---: | ---: | ---: |
| Name | 0.799 | 1.465 | 6.920 | 2.047 |
| Destinations | 0.934 | 0.662 | 2.572 | 1.800 |
| Presence selection | 0.635 | 0.643 | 1.812 | 1.850 |

Server values are the dedicated request-total phases, not browser paint timings. The same-invocation browser observations include tooling overhead and are completion bounds. The first name change included about six seconds before the measured handler; these traces do not attribute that delay. This is a bounded local improvement, not a guarantee of instant saves or a sustained-load latency distribution.

The entry observer recorded one initial loaded state and six settings updates, all loaded, with no reload state over 327.889 seconds. Saved presence choices reopened with their actual Home Assistant entity identity. The original method and complete saved settings were restored; an unrelated profile draft survived and was explicitly discarded. Final verification at October 15 00:58:33 UTC found the exact saved baseline, global sending off, no pending messages or outbox requests, matching served assets and no Homeostatic errors. Diagnostic logging returned to its prior setting.

The generated `method-presence-20261014` directory retains `save-timing-logs.json`, per-pair captures and `timing-comparison.json`. The [UI receipt](performance/ui-control-paths-2026-10-14.json) keeps the earlier rejected presence-catalog attempt, the corrected 33-path isolated run and the six live saves separate from earlier full-inventory evidence. The correction adds the actual person entity ID to the catalog while preserving its internal identity; the existing presence contract is unchanged. Physical Safari remains untested, and live notification delivery was not exercised.

## Scoped refresh and saving follow-up

The October 17 implementation under [ADR 0092](adr/0092-scoped-refresh-and-coherent-saves.md) removes unnecessary discovery, repeated picker scans and overlapping detail reads. Configuration reads now preserve the correspondence between saved settings and their revision during saves and rollback. The [acceptance and measurement receipt](performance/refresh-save-2026-10-17.json) records the source build, isolated checks, raw artifact paths and remaining limits.

The backend probes used Python 3.14.7, Home Assistant 2026.9.3 and published health-tree 0.8.0 in WSL. Refresh probes used 6,002 entities; save probes used 6,000 entities and 300 devices. Runtime storage performed real writes and read-back verification; registry storage and destinations were mocked. Backend values below are medians of three samples. Frontend values are warmed JavaScript generation measurements from the 6,000-entity, 600-device fixture, excluding browser paint.

| Work | Before | After |
| --- | ---: | ---: |
| Selected temperature reading | 567 ms; one discovery | 305 ms; no discovery |
| Climate reading outside thermostat selection | 560 ms; discovery, save and publication | 2 ms; none of those operations |
| Policy rename | 706 ms; one discovery | 401 ms; no discovery |
| Empty Issues summary | 314,008 bytes | 1,423 bytes |
| Closed device-policy editor generation | 208 ms | Less than 0.1 ms |
| Open ignored-entity picker generation | 239 ms | 1.7 ms |

The picker renders 50 choices initially and adds 50 with Show 50 more. Search still includes the complete catalog and missing saved selections stay removable. Initial Issues loading uses its current source context. Inventory browsing and availability edits still require a complete, revision-bound catalog. Existing subscription formats retain their payloads; the smaller summary is an explicit panel option.

These measurements establish reduced work in the tested cases, not a household latency guarantee. Temperature updates still performed one durable save, and their median maximum event-loop gap fell from 461 ms to 195 ms. Snapshots remained roughly 14.5–15.4 MB. Threshold changes retained discovery and measured 955 ms in the retained follow-up, compared with 846 ms before. Settled notification-name and method-name saves measured 540 ms and 599 ms; with 50 queued observations they took 2.10 and 2.40 seconds, including 1.30 and 1.54 seconds draining observations. Inclusive phase timings overlap and must not be added together. Verified persistence and ordered observation processing remain the measured costs to investigate before any storage redesign.

## Live attribution of a Stop Monitoring action

On 2026-10-17 the household installation was measured directly: a Raspberry Pi 5 running Home Assistant 2026.10.0 with 4,977 registry entities, 702 devices, 3,507 catalog nodes and 5,785 candidates, and the installed component identical to this working tree. No code changed. The debug loggers were switched on through the logger service and returned to warning afterwards; the Profiler integration was added for one asyncio debug window and two cProfile captures. The [receipt](performance/live-latency-2026-10-17.json) records the method, and [its directory](performance/live-latency-2026-10-17/) keeps the raw captures.

### Background duty cycle with nobody using the panel

Over 17 minutes the runtime saved its 7.8 MB snapshot 47 times, 2.8 saves per minute. The 60 second reconcile timer fires at about :46.7 of every minute; the other saves follow state changes. Each save logged a snapshot build, a durable write, a read-back and a compare:

| Phase | Median | Maximum |
| --- | ---: | ---: |
| Snapshot | 0.149 s | 1.020 s |
| Storage write | 0.068 s | 0.231 s |
| Storage read | 0.048 s | 0.069 s |
| Storage compare | 0.025 s | 0.034 s |

Six of the 47 snapshots took about 1.0 s instead of 0.15 s; the same 1.0 s pause appeared once inside checkpoint creation during a save. The cause is not attributed.

With asyncio debug mode on for three minutes, Home Assistant logged every callback that held the event loop for more than 0.1 s. The Homeostatic refresh task accounted for 17.5 of the 19.6 blocked seconds, 9.6% of wall time. Each reconcile cycle blocked the loop for 4.6 to 5.5 s from the tick until the first storage await; each state-driven refresh blocked it for 0.23 to 0.27 s plus a 0.13 to 0.15 s completion step. Nothing else on the installation exceeded 0.9 s. The catalog revision did not change during idle ticks, so idle rebuilds of the panel do not come from the reconcile timer.

### One action, every second attributed

Three Stop and three Resume actions on a healthy device with two watched entities went through the rendered controls, each Stop reversed by a Resume, with the saved configuration back at its original revision after every Resume. Times are seconds after the confirm click.

| Action | Confirm at | Save evaluation (server) | Save total (server) | Save response (client) | Catalog reload | Panel settled |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Stop | :50.8, 4 s after the tick | 5.50 | 6.44 | 8.19 | 2.95 | 13.09 |
| Resume | :27.6, clear | 5.24 | 5.84 | 6.05 | 1.49 | 7.61 |
| Stop | :44.0, 2.7 s before the tick | 5.55 | 7.77 | 12.61 | 2.02 | 14.69 |
| Resume | :30.3, clear | 5.32 | 5.98 | 6.13 | 1.81 | 8.00 |
| Stop | :10.2, clear | 6.26 | 6.89 | 7.00 | 1.56 | 8.62 |
| Resume | :56.0, right after the tick | 6.40 | 7.04 | 7.60 | 1.73 | 9.39 |

The first Stop, 13.1 s from click to a settled panel, breaks down as follows.

| Share | Seconds | What happened |
| --- | ---: | --- |
| 42% | 5.50 | The save's own evaluation: a full discovery because availability exclusions changed |
| 23% | 2.95 | Full catalog reload: 63 pages, 11,810 rows, four workers |
| 15% | 1.94 | Five source reads, one configuration read and rendering after the catalog arrived |
| 11% | 1.41 | Event loop still busy with the background reconcile cycle before the handler started |
| 6% | 0.78 | Checkpoint, lock wait, snapshot and storage |
| 4% | 0.51 | Response transport and the rest |

In a clear slot the save alone takes 6 to 7 s, and evaluation is 85 to 90% of it. When a save is confirmed just before the tick, the tick's cycle queues behind the save and runs its own 4.6 s discovery before the WebSocket response is flushed, which is why the second Stop took 12.6 s on the client but 7.8 s on the server. Validation, lock waits, pending observations and the read-back compare were each under 0.3 s in every sample.

### Where the discovery time goes

The idle cProfile capture covered one reconcile tick. Discovery took 6.83 s, of which the inventory scan took 6.02 s, and 5.65 s of that was Home Assistant's `report_usage` frame inspection: each read of `DeviceEntry.config_entries`, a deprecated compatibility property in Home Assistant 2026.10, walks the call stack to find the offending integration, 1,213 times per discovery at about 4.7 ms each. The reads are in `enrollment.py` at the device ownership scan and the device-member scan, with a third in `notification_routes.py`. The second capture, spanning a tick, a Stop and a Resume, charged 20.1 of 59.3 profiled seconds to the same path across three discoveries. Serialization of snapshots and publications took 4.2 s in that capture, snapshot builds 0.47 s each, and deep copies 0.7 s; the health-tree engine stayed under 1 s.

### Ranking for the next change

The server refresh cycle outranks the catalog reload. It costs 70 to 85% of a Stop action and freezes the event loop for about 5 s every minute whether or not anyone is using the panel. Inside it, the deprecated property read is the measured bulk of discovery and is a bounded code change. The catalog reload is 15 to 23% of the action and remains the next item.

These are single-device, single-browser measurements over the LAN from a PC. Debug mode and cProfile inflate durations inside their windows, so the six unprofiled actions are the latency evidence. py-spy was not run, the 1.0 s pauses remain unattributed, and phase 3 still owes the five-sample medians the plan asks for.

### After replacing the deprecated property reads

Later on 2026-10-17 the same installation was measured again with the working tree that reads each device's owning entry through `DeviceEntry.config_entry_id` and looks phone devices up through the registry's config-entry index. The build was installed over the Samba share, Core restarted at 21:18Z, and the same loggers switched on. Six Stop and six Resume actions on the same fan entity went through its Monitoring detail controls between 21:24Z and 21:29Z, each Resume returning the configuration to its original revision, followed by a 220 s asyncio debug window with nobody using the panel. The [receipt](performance/live-latency-after-2026-10-17.json) records the method and [its directory](performance/live-latency-after-2026-10-17/) keeps the raw captures. The journal contains no deprecation report naming Homeostatic since the restart.

| Measure (medians) | Before, 6 actions | After, 12 actions |
| --- | ---: | ---: |
| Save evaluation (server) | 5.53 s | 1.62 s |
| Save total (server) | 6.66 s | 3.02 s |
| Save response (client) | 7.30 s | 3.18 s |
| Catalog reload | 1.77 s | 1.81 s |
| Panel settled | 8.80 s | 5.31 s |
| Reconcile cycle loop block, each minute | 4.6 to 5.5 s | 0.81 to 0.82 s, once 1.70 s |

Panel settle is over eleven actions; the first Stop was recorded before the render observer reached the panel's shadow roots. Per action, the save response was 2.4 to 4.0 s and the settled panel 3.9 to 7.7 s; the slowest Resume coincided with a 4.4 s catalog reload. Stop evaluations split into two groups, 1.6 s and 2.5 s, and Resume evaluations were 1.5 s with one 2.4 s. The reconcile cycle runs the same discovery and now blocks the loop for 0.8 s from the tick to the first storage await, so the extra 1 to 2 s inside a save's evaluation belongs to the policy and catalog work that follows an exclusion change, which this pass did not attribute further. Homeostatic's refresh task held the loop for 7.6 of the 220 s window, 3.5% of wall time, against 9.6% before; state-driven refreshes still block 0.22 to 0.27 s plus a 0.14 s completion step.

The unattributed 1.0 s pauses remain: one Resume carried a 1.05 s snapshot, two actions a 1.0 s checkpoint, and four idle saves a 1.0 s snapshot. With discovery cheap, the catalog reload and the follow-up reads are now the largest shares of a Stop action, and the reconcile cadence and catalog delta remain the next changes in the plan.

## Runtime boundary

Policy-only monitoring edits retain the existing in-place path. [ADR 0067](adr/0067-save-delivery-methods-in-place.md) extends the bounded definition transaction to named-notification profiles and delivery methods, including their generated policy. Accompanying policy edits may change notification assignments only, preserving policy identities, order and every other field. Combined definition and source/detection edits, policy additions or deletions, or other policy-field changes use the normal reload path. Eligible in-place definition saves keep the runtime, panel and subscriptions active; the roadmap records implementation and installation status. Notification-only edits reuse unchanged source discovery while honoring existing dirty inventory and still rebuilding the generated policy; source/detection changes continue to reconcile. Captured observations, queued refreshes, attention clocks and durable rollback retain their existing ordering. Each dashboard publication shares one current dynamic inventory result across its wire formats, without caching it across updates. Policy availability reads skip destination discovery when there are no configured direct phone or notify channels; direct destinations still use fresh discovery on each read. This introduces no persistent result cache. Time zone, legacy default/Repair/automation assignment definitions, global sending, installation timings and other settings retain full reload and its rollback path. Those settings transactions retain panel registration while publishing monitoring as unavailable. The editor retains its own pending draft and Saving state through that transition, with guarded inputs and ordinary progress wording; confirmed saves can wait read-only for the first current update. Disconnects remain explicit. Failed or uncertain saves and terminal runtime errors remain visible. Normal unloading and removal still remove the panel. The roadmap distinguishes the implemented follow-up from its validation and live acceptance. Lifecycle-only integration updates use a clean refresh when the existing entry catalog metadata matches, preserving ordered observations without forcing rediscovery. Additions, removals, unknown candidates and catalog metadata changes still reconcile. Effective route signatures reactivate only affected reporting; names and unchanged instructions preserve clocks, delivered state and pending identities. Changed destinations or presence rules retire obsolete delivery against the original resolved targets without retargeting queued requests. The historical table covers monitoring edits; the real-storage table covers the named-notification extension and the then-required shared-method reload. Failed writes restore options and runtime state; failed rollback storage leaves a visible unavailable monitor. Requests already published before an outbox-cleanup error retain unique delivery ids; publication cannot be retracted from an external event consumer.

## Reproduce the measurements

To run the measurement harness against the current checkout, follow [development setup](development.md) first, including any required sibling-library override. Run from the repository root on Linux or WSL. The table above remains a historical measurement of the stated versions; a current run produces new evidence:

```sh
HOMEOSTATIC_SAVE_PROFILE=1 HOMEOSTATIC_SAVE_BASELINE=1 HOMEOSTATIC_PROFILE_DIR=tmp/save-before uv run --no-sync pytest -q tests/test_save_performance.py -k save_to_visible_profile
HOMEOSTATIC_SAVE_PROFILE=1 HOMEOSTATIC_PROFILE_DIR=tmp/save-after uv run --no-sync pytest -q tests/test_save_performance.py -k save_to_visible_profile
```

The historical scenario above keeps the inherited mocked storage. Run the notification editor scenario separately to restore real runtime Store I/O; no additional storage flag is needed because `real_runtime_storage()` applies it within that scenario:

```sh
PYTHONPATH=../health-tree/src HOMEOSTATIC_SAVE_PROFILE=1 HOMEOSTATIC_PROFILE_DIR=tmp/notification-save uv run --no-sync pytest -q tests/test_save_performance.py -k notification_editor_save_profile
```

For the destination-discovery follow-up, set `HOMEOSTATIC_PROFILE_PHONES=1` to add one synthetic phone and select `-k "notification_editor_save_profile and profile-name"`. Record the HA version with the result; the 2026.9 harness does not reproduce 2026.10 deprecation-frame overhead. The generated `measure_destination_scan.py` helper used a separate 2026.10 environment and retains its exact synthetic scope in each JSON result.

The notification run writes `notification-save-profile_name.json`, `notification-save-profile_timing.json`, `notification-save-policy_assignment.json`, `notification-save-profile_methods.json` and `notification-save-method_definition.json` in the selected output directory. Each file identifies real runtime storage, mocked registry storage, snapshot size, load condition, save response, settings read and inclusive phases. The historical scenario writes separate JSON files for each source type. [Retained raw measurements](performance/save-latency.json) include all repetitions and phase timings. Current browser fixtures are linked from `tests/frontend/preview.html`; serve them on localhost only. Reload the reusable-editor fixture before rerunning its stateful scenario.

To repeat the live attribution, set `custom_components.homeostatic.save_timing` to debug with the logger service, add the Profiler integration, call `profiler.set_asyncio_debug` for a bounded window and `profiler.start` for 60 seconds spanning a reconcile tick and one edit, and read the core log from the Supervisor journal. Under Supervisor, Home Assistant keeps no `home-assistant.log` file. Install `live-latency-2026-10-17/inpage-timing.js` in the panel page before the edit to time the save, the catalog pages and render settle, and reverse every edit afterwards. Return the loggers to warning when done. To repeat the isolated method journey, keep `HOMEOSTATIC_SAVE_PROFILE=1`, select `-k "notification_editor_save_profile and method-definition"`, and choose a separate `HOMEOSTATIC_PROFILE_DIR` for each candidate.
