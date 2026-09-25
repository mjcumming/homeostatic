# Graph construction and enrollment preview scaling

Measured 2026-09-25 using Python 3.14.7 on the development WSL host, with Home
Assistant 2026.9.3. These are isolated synthetic measurements, not timings from
the house or a responsiveness guarantee.

## Change and scope

HealthTree `register_many` validates all graph additions/replacements before
mutating state or time, preserves matching check state, and evaluates once.
Homeostatic uses it for function graph validation, initial setup, changed source
registration and isolated function preview. An unchanged reconciliation does not
register nodes again. With no functions, preview only counts enrollment; it
does not construct a graph or instantiate an engine. Removing all functions
still reports their removed requirement edges.

Graph membership remains intentional: monitored healthy sources can detect a
later failure; missing or unwatched explicit requirements preserve unknown
evidence; unrelated unwatched inventory is not enrolled. Existing source checks,
dependency semantics and ordered observation processing remain in place.

## Measurements

The registration comparison used 100 integration roots and enough entity nodes
to reach each total, one availability check per node and one owning-entry edge
per entity. All node records were created before timing. Single registration
used the released 0.2.0 code; batch registration used the 0.3.0 release.

| Nodes | Released repeated registration | 0.3.0 batch registration |
| --- | --- | --- |
| 1,000 | 0.796 seconds | 0.0032 seconds |
| 2,000 | 3.400 seconds | 0.0063 seconds |
| 10,000 | Not measured | 0.0333 seconds |

The integration's four new scenarios pass with the real HA helpers and library:

- Native preview counts 10,000 light sources and leaves no config entry. The
  test forbids engine creation. The complete test call, including source creation
  and flow initialization, took about 0.31 seconds.
- Startup enrolls 10,000 initially healthy lights plus one function and its
  unwatched requirement. Reconciliation retains the graph without registration;
  an unavailable light opens one problem and blocks readiness. The complete test
  call, including setup, reconciliation, state change and unload, took about
  2.78 seconds.
- Removing every function reports removed edges without inventory discovery.
- Function preview batches registration and preserves missing required evidence.

The library also tests a 10,000-node forward dependency chain, invalid-batch
rollback, valid simultaneous rewiring, pending holds, retained observations,
episode identity through restart, and randomized equivalence of subsequent
observation histories. Full validation passed: 344 library tests at 99.64%
coverage, 307 integration tests at 98.79%, and 8 frontend tests. Lint, formatting,
strict types and library distribution validation passed, including the larger
500-example randomized CI profile. That final run exposed an existing 0.2.0
rejoin inconsistency: dissolving a group could emit stale findings after resetting
their clocks. Version 0.3.0 fixes it and adds scenario 75; the complete adapter
suite also passes with that fix.

## Reproduce

The 0.1.0b2 integration candidate pins published HealthTree 0.3.0 in its manifest,
project and lockfile. No sibling checkout or editable dependency is needed.

```bash
uv sync --locked
uv run pytest tests/test_scaling.py -q --durations=4
uv run python script/check.py
uv run python script/build_pilot.py
```

The package installation check uses a separate HA-only environment and lets HA
install the manifest requirement. Its results and official hassfest status are
recorded in [pilot validation](pilot-validation.md).

The live pilot remains at 127 integration instances with notifications off.
This increment does not qualify sustained event bursts, many simultaneous
independent failures, synchronous reconciliation latency, dashboard payload size
or browser rendering at whole-house scale. Those are the next isolated checks;
broader live enrollment waits for them.
