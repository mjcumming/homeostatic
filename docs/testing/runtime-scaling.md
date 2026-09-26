# Runtime bursts and device enrollment assessment

Measured 2026-09-25 on the development WSL host with Python 3.14.7, Home
Assistant 2026.9.3, health-tree 0.3.0 and Homeostatic 0.1.0b3 (`24b45dd`).
This assessment adds tests and records limitations; it changes no integration
behavior or live configuration. Broad enrollment is **not qualified**.

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

The next implementation should proceed in this order:

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

Burst profiling is opt-in because the baseline takes roughly three minutes.
The ordinary suite always runs the inventory and bounded pilot scenarios.
The profile writes one JSON result per scope; it asserts behavior rather than
machine-dependent timing thresholds. Treat its timings as a qualification
report, not a passing performance test.
