# Core design audit: how a change becomes a monitored condition

Read-only review of the runtime loop on 2026-10-18, after the latency series and the [footprint measurement](performance/snapshot-footprint-2026-10-18.json). It covers the part of Homeostatic that turns a Home Assistant change into a condition and persists it. Policy types, notification routing and the panel sit on top of this loop and are out of scope here.

## The loop today

| Step | What happens | Idle cost on the household installation |
| --- | --- | --- |
| Input | State changes for indexed entities, four registry event types, repairs events, automation reloads, config-entry changes, a 60 s reconcile timer and episode deadlines each request a refresh; most of them also set a dirty flag. | 1.8 refreshes a minute: 33 reconcile ticks, 17 config-entry rewrites, 5 state changes, 4 deadlines, 1 registry change in 33 minutes |
| Discover | When the inventory is dirty or the tick fires: read every registry entry, retain vanished candidates, evaluate the rules for every candidate, compose sources, diff them against the engine, rebuild the static inventory and the catalog rows. | 0.46 s every minute, all on the event loop |
| Observe | Build an observation for every integration source on every refresh, and for every other source when discovering; write each into up to four adapter stores; feed them to the engine. | Included above; a refresh without discovery evaluates in 0.03 s |
| Handle | Mirror episode views into a dict, record history, controls, facts and deliveries. | Small |
| Persist | Build a 23-section snapshot, write 7.7 MB, verify the bytes. | 1.55 writes a minute, about 17 GB a day; one generation-2 collection every 3 to 4 minutes |

The refreshes themselves are cheap. The cost is that every minute the loop rediscovers the whole installation, re-observes every check and rewrites the whole state, whether or not anything changed.

## What the runtime holds

The runtime initializes about 90 attributes and persists 23 sections. Sorted by what the product needs:

| Kind | Sections | Size | Needed because |
| --- | --- | ---: | --- |
| Durable facts | episodes, resolved history, operator controls, delivery ledger, monitoring identities and scopes, enrollment, retry starts, phone actions, automation alerts, repairs, broken automations, temperature and UPS monitor progress, notification flags, policy settings | about 1.0 MB | Issue identity across restarts, acknowledgments and pauses, at-least-once delivery, history, monitoring of registered entities that have no state |
| Library working memory, persisted whole | engine (1,757 check records each with its full last observation, 3,505 node records, 58 episodes), policy route states | 2.8 MB | Only the onsets, grace windows and episodes in it are durable; the observations are re-made within a minute of startup |
| Caches, persisted | attention route signatures (eight copies of the rule content), check and integration evidence (the last observation's reason, message, time and status) | 1.8 MB | Change detection and presentation; both are re-derived by the first refresh |
| Caches, in memory | sources, candidates, static inventory and catalog rows, entity-to-source index, device signatures, scan cache, entity evidence, temperature observations, UPS latest observations | not persisted | Correct as caches |

Between two idle saves one minute apart only observation times changed; every durable section was identical.

## Four stores for one observation

Each observation of a source is written to several places in slightly different shapes:

- The engine keeps the full observation on its check record and persists it.
- `check_evidence` keeps reason, message, time and status plus the last failure, for every non-integration source, and persists it. One reader: the source detail view.
- `integration_evidence` is the same class for integration entries; persisted; two readers.
- `entity_evidence` holds a `ReportedCondition` for entity sources; not persisted; one reader.
- Temperature and UPS keep their own latest observation per source for their detail views.

The product needs one answer: the latest observation of a source, and, for the history goal, whether the last failure is known. One in-memory map keyed by source, with the last failure as the only persisted part, serves every reader.

## Change detection by recomputation

The loop knows what changed when the event arrives, then throws that away. Handlers set `_inventory_dirty`, `_repairs_dirty` or the broken-automation flags, and the evaluation recomputes everything and compares: the scan cache key, candidate dictionaries, source dictionaries, device signatures, the catalog revision from row identity, and route signatures that store the full rule content eight times. The reuse layers added this month (candidate rows, scan and decision reuse, catalog deltas) make the global recomputation cheaper; they would not exist if the refresh handled only the subject of the event.

## The reconcile

The minute tick exists as a safety net for missed events, stale metadata and time-based expiries. Expiries already have the deadline timer. Registry, config-entry, repairs and automation changes already have events. What remains for a sweep is defence against a missed event, which does not need to run every minute or rediscover everything.

## The persistence transaction

A settings save deep-copies most runtime attributes as a rollback checkpoint, saves, verifies the bytes, and traces each phase; background saves coalesce into a 15 s window. Each layer answers a problem created by saving everything often. When saves hold only durable facts and happen a few times an hour, the stored file is the checkpoint and most of the transaction can go.

## The minimal core

1. Persist durable facts only. Route signatures become digests, observation times leave persisted evidence, and health-tree is asked for a snapshot that holds episodes, onsets, grace windows and windows but not check observations or route content. Expected file: about 1 MB instead of 7.7 MB.
2. One latest-observation map replaces the four evidence stores; readers take it from there or from the engine.
3. Events update their subject. A state change re-observes its sources; a registry or config-entry event re-evaluates the affected candidates; nothing recomputes the installation. The reuse layers and most comparisons become unnecessary and can be removed.
4. The reconcile becomes a rare sweep, on the order of tens of minutes, that rediscovers only when a sweep finds a difference.
5. Saves happen on durable change: an episode opens, changes or clears, an owner acts, settings change, shutdown. Idle writes fall from one a minute to a few an hour; the checkpoint copy and most of the save transaction are retired.

What this keeps: the ordered observation queue, stable issue identities, the startup hold, at-least-once delivery, and the dependency graph. What it removes: the per-minute rediscovery, three of four evidence stores, content-comparison change detection and the reuse machinery built to make it affordable, and about 6 MB of every write.

## Order of work

Each step is measurable on its own with the existing trace and the store file size.

1. Stop persisting caches (route digests, evidence times); adapter only.
2. Collapse the evidence stores into one map.
3. Make the reconcile rare and the event handlers targeted; delete the reuse layers as they stop being needed.
4. Ask health-tree for a durable-only snapshot.
5. Retire the checkpoint copy and simplify the save transaction once saves are small and rare.
