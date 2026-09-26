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

1. Schedule bounded refresh work while retaining **every captured transition**
   and its timestamp. Coalescing redundant refresh requests must not discard
   observations, delivery ordering, deadlines or observations arriving during
   persistence/shutdown. Index entity-to-source lookup.
2. Avoid rebuilding unchanged inventory on each observation. Invalidate on
   registry/ownership changes and retain periodic reconciliation and missing
   identities. Preserve unknown evidence and enrollment provenance.
3. Separate small problem/function updates from the large catalog. Page or
   request inventory details as needed, and bound frontend row rendering.
   Rendering fewer rows alone does not reduce backend payload work.
4. Implement device-first navigation and selective capability profiles using
   adapter-owned views. Grouping never introduces a causal dependency.

These are proposed adapter changes. Update the spec and add executable
ordering/lifecycle scenarios before implementing them. No library contract or
accepted ADR needs to change merely to present devices above capabilities.

## Qualification and live pilot

The first pilot should select one availability capability on each of two known
offline devices, retain the existing integration checks and keep notifications
off. Extra settings, firmware, battery thresholds and optional capabilities
remain separately reviewable. Entity availability reports HA's control-path
evidence; it does not establish physical freshness or diagnose why a device
is disconnected. A second independent capability is added when a function
needs it, not just because an entity exists.

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
