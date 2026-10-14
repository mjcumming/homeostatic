# Save performance in an isolated Home Assistant instance

Measured on 2026-10-13 with Python 3.14.7, Home Assistant 2026.9.3 and the published health-tree 0.6.0. The fixture creates 10 integration entries, 300 devices, 6,000 entities and 10 Repairs. Registry and storage files live in the Windows checkout accessed through Ubuntu on WSL. All requests use the real integration, verified HA Store and authenticated WebSocket API. Notification requests stay off. No household installation participates.

The baseline forces the retained integration-reload path and sequential catalog requests in the same checkout. The changed path applies monitoring edits in the existing runtime and fetches at most four catalog pages concurrently. Each direction is measured three times; the table gives medians in seconds. Results depend on machine, storage and Home Assistant scheduling.

| Change | Baseline: applied | In place: applied | Baseline: catalog ready | In place: catalog ready |
| --- | ---: | ---: | ---: | ---: |
| Device off | 0.883 | 0.399 | 2.214 | 0.914 |
| Device on | 0.861 | 0.452 | 2.375 | 0.979 |
| Entity off | 1.271 | 0.581 | 2.655 | 1.119 |
| Entity on | 1.931 | 1.412 | 6.590 | 3.247 |
| Repair off | 0.915 | 0.440 | 2.212 | 0.925 |
| Repair on | 0.834 | 0.437 | 2.347 | 0.950 |

Applied ends when the save response arrives, after the runtime verifies durable storage and updates the dashboard publication. Catalog ready includes receiving every catalog page and draining HA tasks. Catalog requests run in batches of four in the harness; the frontend uses four workers that replenish individually. It does not measure a browser paint or the time a physical device takes to report. The real browser fixtures independently exercise direct saving, failed saves, retained drafts and phone/desktop rendering.

Validation takes less than a millisecond in these runs. Full reload adds stopping/draining, snapshot loading and startup. The in-place path removes those lifecycle steps, retains one verified state write when no notification outbox needs draining, and still performs source discovery and engine/policy work. Large removals restore the final registered graph once through public library APIs. Activity history serializes only the 50 records it retains. The rollback checkpoint retains references to catalog views that discovery replaces instead of copying those views.

The detailed report records inclusive timings for validation, stopping/draining, storage, snapshot loading, discovery, engine/policy evaluation, startup and dashboard publication. Inclusive phases overlap: discovery is inside evaluation, and evaluation/storage are inside startup in the baseline. Do not sum them. Catalog refresh time is the difference between catalog-ready and applied totals. The remaining unclassified time includes HA task scheduling, transport, platform lifecycle and transaction checkpoint creation.

Ordinary rule and monitoring-policy edits qualify for in-place application. Installation timing, shared delivery methods, global notification activation and other installation changes retain full reload and its rollback path. Policy-owned notification timing edits apply in place and restart only the affected entries. Unchanged notification entries retain their clocks even when another policy changes the generated fallback rules. Failed writes restore options and runtime state; failed rollback storage leaves a visible unavailable monitor. Requests already published before an outbox-cleanup error retain unique delivery ids; publication cannot be retracted from an external event consumer.

Reproduce on Linux or WSL from the repository root:

```sh
HOMEOSTATIC_SAVE_PROFILE=1 HOMEOSTATIC_SAVE_BASELINE=1 HOMEOSTATIC_PROFILE_DIR=tmp/save-before uv run pytest -q tests/test_save_performance.py
HOMEOSTATIC_SAVE_PROFILE=1 HOMEOSTATIC_PROFILE_DIR=tmp/save-after uv run pytest -q tests/test_save_performance.py
```

The opt-in scenario writes separate JSON files for each source type. [Retained raw measurements](performance/save-latency.json) include all repetitions and phase timings. Browser fixtures are `tests/frontend/integration-settings.html` and `tests/frontend/reusable-editors.html`; serve them on localhost only. Reload the reusable-editor fixture before rerunning its stateful scenario.
