# Runtime bursts and device enrollment assessment

Measured 2026-09-25 on the development WSL host with Python 3.14.7, Home
Assistant 2026.9.3, health-tree 0.3.0 and Homeostatic 0.1.0b3 (`24b45dd`).
This assessment adds tests and records limitations; it changes no integration
behavior or live configuration. Broad enrollment is **not qualified**.

## 0.1.0b6 synthetic follow-up

Measured 2026-09-25 after implementing the scheduling, cached catalog, compact
subscription and bounded table changes. These are isolated synthetic results;
they contain no household configuration or traffic. The earlier measurements
below remain as the baseline. Broad enrollment is still **not qualified**.

| Measurement | 60 entity checks | All 6,000 entity checks |
| --- | ---: | ---: |
| Initial setup | 0.408 s | 0.803 s |
| Initial serialized catalog | 3.27 MB | 6.90 MB |
| 300 ordinary available-value changes | 0.0036 s | 0.0026 s |
| 60 unavailable transitions | 0.083 s | 3.512 s |
| Longest callback gap during outage | 0.077 s | 3.507 s |
| Scans / saves / publications during outage | 0 / 1 / 1 | 0 / 1 / 1 |
| Compact serialized outage update | 71.1 kB | 71.1 kB |
| 60 recovery transitions | 0.072 s | 3.426 s |
| Unchanged reconciliation | 0.070 s | 0.301 s |
| Reload with a controller problem | 0.217 s | 1.080 s |

The first table still uses the HA test helpers and mocked Store persistence.
The update-size comparison is deliberately labeled: the baseline sent full
snapshots; this client requests compact schema 2. Legacy schema-1 clients still
receive full snapshots. Initial catalogs are still several megabytes.

A separate running HA 2026.9.3 process used actual Store writes/read-back and an
authenticated WebSocket client on loopback, with 6,000 generated entities, 300
devices, ten synthetic controllers and 60 monitored capabilities. Setup took
0.190 s; the initial WebSocket event was 3.10 MB. Outage and recovery took 0.083
and 0.078 s, with longest callback gaps of 0.065 and 0.062 s. Each performed one
save, no inventory scan and delivered one compact event (68.1 and 55.8 kB).
Sixty independent episodes opened and cleared; two later open episode ids
survived an integration reload. The owned storage file was about 219 kB.

At phone width, the actual HA frontend loaded the full catalog and found its
last synthetic entity by name. The panel hamburger opened the native sidebar
and navigated to Settings. The component scenario also exercises keyboard
activation and navigation while monitoring is disconnected/unavailable.

The narrow scope meets the proposed 100 ms callback and one-second burst lab
budgets in these individual runs. This supports a bounded two-capability pilot,
not automatic enrollment of every device entity. Broad enrollment still spends
seconds applying ordered transitions through the full graph; changing that
requires separate engine/adapter work without discarding transitions. These
development-host results do not qualify sustained household traffic or HA
appliance performance. Initial transfer and catalog invalidation also remain
full-size operations. Device-first grouping and capability profiles remain
separate presentation work.

Run `uv run python script/runtime_lab.py` for the actual-storage measurement;
it creates a temporary loopback-only synthetic HA installation and exits after
the checks. Use `--serve` to inspect its dashboard on port 8126, then stop it
with Ctrl+C. It uses a synthetic local owner and loopback trusted-network login;
never copy this lab configuration to a household instance. The report defaults
to `build/runtime-profile/real-storage.json`. Multimedia/system-package warnings
from the development Core environment are outside these availability checks.

## 2026-09-26 device-sized scope experiment

The current 0.1.0b10 pilot was tested with 6,000 generated entity candidates,
300 generated devices and ten loaded integration entries. Exactly one stable
entity reference per device was attached for this measurement, giving 310
watched checks. This selects the first generated entity solely to measure
scale; it is **not** a validated rule for choosing real device evidence.

| Measurement | HA test helpers | Running HA with real Store and WebSocket |
| --- | ---: | ---: |
| Initial setup | 1.90 s | 0.25 s |
| Initial serialized dashboard/event | 3.42 MB | 3.24 MB |
| 60 independent device-representative outages | 0.25 s | 0.33 s |
| Longest event-loop gap during outage | 0.22 s | 0.30 s |
| 60 recoveries | 0.24 s | 0.21 s |
| Scans / saves / publications during outage | 0 / 1 / 1 | 0 / 1 / 1 |
| Compact outage update | 117 kB | 113 kB |

The running-HA lab retained two subsequent episode ids through a reload; its
owned storage file was 618 kB. The HA test-helper environment mocks persistence,
while the running-HA result includes actual Store and loopback WebSocket work.
This shows that a device-sized **check count** avoids the 6,000-check burst cost
in this synthetic workload. It does not show that one arbitrary entity reliably
reports each physical device's connectivity. The 0.30-second maximum event-loop
gap also exceeds the earlier proposed 100 ms per-slice lab budget. Neither run
replays household traffic or measures the installed HA appliance.

Reproduce with `HOMEOSTATIC_RUNTIME_PROFILE=1 uv run pytest
tests/test_runtime_scaling.py::test_one_capability_per_device_runtime_load -q`
and `uv run python script/runtime_lab.py --device-representatives`. The latter
writes `build/runtime-profile/device-representatives.json`.

## 2026-09-26 ordered processing slices

The unpublished `codex/attention-controls` branch, based on 0.1.0b11, yields to
HA after every eight queued observation batches while retaining the runtime
lock. Each batch keeps its captured timestamp and order. A regression scenario
injects another observation during a yield, retains ten intervening recoveries,
and verifies the final open episode survives reload. No live settings changed.

The running-HA lab used the accompanying local HealthTree candidate, Python
3.14.7 and HA 2026.9.3 on WSL. It selected 300 device summaries among 6,000
registered entities and ten controllers, with real Store writes and a loopback
WebSocket client. Ten consecutive cycles each generated 1,200 entity transitions
for 60 complete device outages and then recovered all 60 devices.

| Measurement | Ten-cycle result |
| --- | ---: |
| Outage settlement, min / mean / max | 0.358 / 0.379 / 0.502 s |
| Recovery settlement, min / mean / max | 0.339 / 0.347 / 0.357 s |
| Longest outage event-loop gap | 0.186 s |
| Longest recovery event-loop gap | 0.043 s |
| Saves / inventory scans per burst | 1 / 0 |
| Episodes after each outage / recovery | 60 / 0 |
| Initial WebSocket event | 3.91 MB |
| Final owned storage | 670 kB |

Nine outage cycles had maximum gaps of 43–48 ms; cycle seven reached 186 ms.
The cause of that outlier has not been isolated. This improves on the earlier
roughly 300 ms device-summary gap, but does **not** consistently meet the proposed
100 ms slice budget. Subsequent outage updates reached 200 kB as bounded history
filled. Episode ids remained stable through the final reload.

The separate HA-helper profile with all 6,000 individual entity checks still
took 3.77 s for 60 failures and 3.52 s for recovery, with maximum loop gaps of
0.79 s; unchanged reconciliation took 0.30 s and initial serialization was
7.86 MB. It uses mocked storage and measures serialized bytes, not network
transfer. Processing slices improve scheduling but do not eliminate full-graph
evaluation cost or large initial catalogs. Broad entity enrollment remains
unqualified. Ten synthetic cycles are not a sustained household traffic replay.

Reproduce the actual-storage run against the local library candidate with
`PYTHONPATH=/mnt/c/GitHub/health-tree-batch/src python script/runtime_lab.py
--device-summaries --cycles 10`. The script writes
`build/runtime-profile/device-summaries.json`; the profile tests use
`HOMEOSTATIC_RUNTIME_PROFILE=1 HOMEOSTATIC_PROFILE_DIR=build/runtime-profile`.
The candidate is not a published dependency or a deployment instruction.

## Registry shape

A read-only assessment of saved registries found 6,651 registered entities and
695 device records. Of those records, 472 have entities and 223 have none;
1,184 entities have no device association. All non-null device references
resolved. Deleted records are excluded. These are registry counts, not a count
of physical devices or the complete runtime inventory.

There are 2,232 diagnostic, 1,676 configuration and 2,743 uncategorized entities.
Of the total, 5,459 are enabled and 1,192 are disabled through their entity or
device. Only 2,202 are both enabled and uncategorized; that is a review pool,
not an automatic monitoring recommendation. Categorized entities can contain
essential connectivity evidence, while uncategorized entries can be helpers,
mirrors or virtual capabilities.

The anonymous fixture retains domain/category counts, disabled flags, empty
device records, device group sizes and unassigned entities. It contains no
household identities, platform names, locations, state values or credentials.
The test generates new identities and ten synthetic owners. It does not replay
the household's dependency topology or traffic.

`test_inventory_shape.py` creates those registries with real HA helpers and
confirms a three-capability selection watches exactly those capabilities plus
the ten controllers, retains the entire candidate inventory and preserves all
1,192 disabled sources. `test_device_pilot.py` separately models two devices
with 12 and 15 registered entities, selecting one capability on each. Both
already-unavailable capabilities are detected; one can recover independently;
unknown evidence does not clear the other problem; reload preserves its id;
eventual recovery clears it. Unselected sibling entities do not create problems.
Both tests passed.

## Runtime measurements

The opt-in runtime test uses a separate, uniform synthetic shape: 6,000 entities,
300 devices and ten loaded controllers. The narrow scope attaches 60 entity
checks on three devices plus ten controllers. The broad scope attaches all
6,000 entities plus the fixture's state-only consumer and ten controllers.

| Measurement | 60 entity checks | All 6,000 entity checks |
| --- | ---: | ---: |
| Initial setup | 0.53 s | 0.90 s |
| Initial serialized dashboard | 3.27 MB | 6.90 MB |
| 300 ordinary available-value changes | 0.004 s | 0.029 s |
| 60 unavailable transitions | 12.74 s | 40.70 s |
| Longest callback gap during outage | 12.70 s | 40.68 s |
| Full scans / saves / publications during outage | 60 / 60 / 60 | 60 / 60 / 60 |
| Total serialized dashboard bytes during outage | 198.51 MB | 416.00 MB |
| 60 recovery transitions | 13.90 s | 43.65 s |
| Full scans / saves / publications during recovery | 60 / 60 / 60 | 61 / 61 / 61 |
| Unchanged reconciliation | 0.21 s | 0.45 s |
| Reload with a controller problem | 0.23 s | 0.83 s |

MB means decimal megabytes. These are individual development-machine runs,
not distributions or target-hardware service levels. Both scenarios passed
their functional assertions: normal value changes do not save, failures are
detected, recovery clears, a failed owning controller correlates its children,
and reload preserves the remaining episode. Passing assertions do not qualify
responsiveness. The extra broad-scope recovery refresh was observed but its
individual trigger was not instrumented.

The callback probe repeatedly schedules `call_soon`; it never sleeps. Setup
timing excludes creating the source registries. Each dashboard signal serializes
the real cached dashboard once, representing one test client. Bytes are JSON
serialization volume, **not measured network transfer**. Browser paint, actual
websocket framing/compression, physical storage latency, multiple clients and
sustained household traffic have not been measured. HA's storage fixtures mock
disk persistence; the counters measure save attempts and associated snapshot
work. Notifications are disabled. Failure/recovery holds are zero and the
coalescing threshold is deliberately raised to keep 60 independent problems
visible, rather than hide the workload in a group. This differs from live
default timings and is an explicit stress case.

## What the result means

The earlier batch-registration change solved construction. Runtime callbacks
still schedule a full refresh per relevant event. The first refresh can drain
many captured observations, but the redundant queued refreshes each rediscover,
reconcile, save and publish again. State callbacks also scan monitored sources
to find an entity. The dashboard publishes the full inventory even when very
few candidates are monitored. Narrow enrollment limits graph work but does
not eliminate catalog and presentation costs.

The baseline identified these implementation steps (steps 1–3 are addressed by the follow-up above):

1. Schedule bounded refresh work while retaining **every captured condition change**
   and its timestamp. Coalescing redundant refresh requests must not discard
   observations, delivery ordering, deadlines or observations arriving during
   persistence/shutdown. Index entity-to-source lookup.
2. Avoid rebuilding unchanged inventory on each observation. Invalidate on
   registry/ownership changes and retain periodic reconciliation and missing
   identities. Preserve unknown evidence and enrollment provenance.
3. Separate small problem/function updates from the large catalog. Page or
   request inventory details as needed, and bound frontend row rendering.
   Rendering fewer rows alone does not reduce backend payload work.
4. Present device summaries and optional separate entity checks through
   adapter-owned views. Grouping never introduces a causal dependency.

These are proposed adapter changes. Update the spec and add executable
ordering/lifecycle scenarios before implementing them. No library contract or
accepted ADR needs to change merely to present devices above capabilities.

## Qualification and live pilot

The first pilot should select one device availability summary on each of two
known offline devices, retain the existing integration checks and keep
notifications off. Individual entities remain available for separate checks
when a function needs one. Entity availability reports HA's control-path
evidence; it does not establish physical freshness or diagnose why a device
is disconnected.

Before expanding the live scope, repeat the burst tests after the runtime
changes. Proposed lab targets are under 100 ms for a synchronous work slice and
under one second to settle a 60-transition burst, with refresh counts bounded
by new work rather than one per queued event. These are proposed qualification
budgets, not an adopted spec or a target-hardware guarantee. Validate separately:

- Available/unavailable/unknown/restored/missing transitions, rapid recovery and
  refailure, events arriving during a suspended save, deadline overlap and unload.
- Controller outage, independent device outage, lost optional diagnostic and
  partial capability failure; grouping must not manufacture a root cause.
- Registry arrival/removal/rename, disabled devices, retained exclusions,
  unassigned sources, and unchanged reconciliation.
- Dashboard response and actual browser interaction with the full candidate
  inventory, and storage measurements on deployment-like hardware.
- A representative recorded event-rate distribution before calling the test a
  sustained household-load qualification; registry structure supplies no rate.

The device-summary prototype was measured with 6,000 registered entities on
300 HA devices and 10 controller entries, with 300 device summaries selected.
Powering down 60 complete synthetic devices produced 60 episodes from 1,200
entity transitions. Without filtering repeated device conditions, it took
3.1 seconds and blocked the loop for 2.93 seconds. Filtering same-condition
observations reduced this to 0.46 seconds overall, with a 0.30-second longest
loop gap, one save, zero catalog scans and a 109 KB update. Recovery took
0.34 seconds. The first WebSocket transfer was 3.3 MB. This meets the proposed
burst-settle budget but misses the proposed synchronous-slice budget. The lab
uses synthetic devices and WSL storage, so target-hardware and sustained-load
behavior remain unqualified.

Then preview the exact two-device rule, verify its two additional matches,
and apply only that bounded pilot with explicit deployment authorization.
Observe the already-offline devices first. Recovery testing should follow an
owner-restored device, without remotely toggling equipment to manufacture a
failure. Confirm the remaining problem stays visible, reload preserves identity,
and rollback removes only the added pilot rule. Expansion and notification
activation are separate later steps. No live enrollment was changed here.

## Reproduce

```bash
uv sync --locked
uv run pytest tests/test_inventory_shape.py tests/test_device_pilot.py -q
HOMEOSTATIC_RUNTIME_PROFILE=1 HOMEOSTATIC_PROFILE_DIR=build/runtime-profile \
  uv run pytest tests/test_runtime_scaling.py -q --show-capture=no --durations=2
uv run python script/check.py
```

Burst profiling is opt-in; the baseline took roughly three minutes and the optimized synthetic run took about twelve seconds.
The ordinary suite always runs the inventory and bounded pilot scenarios.
The profile writes one JSON result per scope; it asserts behavior rather than
machine-dependent timing thresholds. Treat its timings as a qualification
report, not a passing performance test.
