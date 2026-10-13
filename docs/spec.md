# Homeostatic integration specification

Date: 2026-09-27. Development baseline: Home Assistant 2026.9.3 and Python 3.14.

This is the integration implementation contract. [Homeostatic ADRs](adr/README.md) explain adapter decisions. The library design of record remains `health-tree/docs/rfp.md`; its accepted ADRs govern engine and policy behavior. This implementation includes situations, delivery and passive monitoring rules; the remaining release work is tracked in [roadmap.md](roadmap.md). HealthTree owns all attention decisions, including activation and reminder holds.

## Acknowledgment and early cancellation

Administrator actions `acknowledge(episode_id)` and `cancel_control(control_id)` use public HealthTree APIs under the runtime lock and save before confirming success. Acknowledgment uses the authenticated HA context user id; callers cannot supply an actor. The library owns the first time/actor, cross-recipient effect and restart persistence. An explicit rule option `require_acknowledgment: true` stops acknowledgment-dependent attention only. Recovery, dismissal, shelving and awareness remain distinct. Canceling a control ends only that request; overlapping maintenance and quiet hours remain effective. Missing, expired, removed or replaced control ids are rejected. A storage failure leaves monitoring unavailable and returns an ambiguous result that must be inspected before retrying.

The dashboard exposes these controls only when `inventory.attention_controls_supported` is true, displays acknowledgment from the read-only policy explanation, and disables actions when disconnected or for non-administrators. No notification consumer response is treated as acknowledgment implicitly. Built-in Companion delivery can provide an explicit phone Acknowledge action. The optional event-consumer blueprint does not provide that action; administrators can also acknowledge through the dashboard or native action.

The manifest pins a published health-tree package that provides acknowledgment and cancellation. The adapter checks API support before exposing the controls and reports a clear dependency error if an incompatible installation requests them.

## Ordered observation work slices

Queued observations retain their timestamps, ordering and atomic batch boundaries. The adapter yields to the HA loop after eight captured batches or 20 ms of elapsed processing, whichever comes first, while retaining its runtime lock. Elapsed processing uses a monotonic clock, independently of observation UTC timestamps. The budget is checked after each complete batch and its policy work; it cannot interrupt one synchronous engine call. New arrivals join the queue and are drained before current-state reconciliation, controls, persistence and publication. The current time is read after draining, preventing time from moving backward when new evidence arrives during a yield. No transition is dropped or collapsed by this scheduling change. Graph evaluation, reconciliation, serialization and catalog transfer still require measurement.

## Scope and setup

One Homeostatic config entry per installation. Fresh setup installs ordinary editable policies for integration, device and entity availability, Repairs and broken automations, enabled with no notification entries. Battery and vacuum policies start disabled. Temperature, thermostat and UPS templates require configuration. Global notification sending starts off. The catalog uses HA config-entry state and entity availability evidence only. Registered entities use registry identity; state-only entities use the explicitly weaker `entity_id:` identity. Homeostatic's own entities and config entries are ineligible.

### Conversion helpers and groups

`switch_as_x` (Change device type of a switch) config entries are ineligible. They wrap an existing switch to expose it as another entity type, so counting the helper entry as another monitored device duplicates the underlying capability. The converted light, fan, or other entity remains eligible for its own HA availability check, without a dependency on the omitted helper entry. This exclusion applies by source type, including installations whose saved attach rules match everything; it is not a name-based display filter ([ADR 0001](adr/0001-omit-switch-conversion-helper-entries.md)).

`group` config entries and their group entities remain eligible because an owner can use a group as an aggregate control target in automations. The config-entry check can report whether HA loaded that helper, and the entity check can report whether HA currently exposes the aggregate entity. The Group row counts those HA sources, not the devices inside the group. It is not a physical device or a member-health rollup. In the pinned HA implementation, a light or binary-sensor group can remain available when at least one member is available, while another member is unavailable. Thus a passing group check never clears, replaces, or mutes an individual member's problem. Monitor the member entities separately when their operation matters. Homeostatic does not create dependency edges or infer device health from group membership. Keeping Group sources is a [proposed decision](adr/0002-retain-group-sources-as-limited-aggregate-evidence.md) pending review of their place and explanation in the list.

### Catalog rules

The rule contract below remains available for existing configurations and low-level catalog operations. Fresh setup uses the unified policy model described under Reusable monitoring and notification definitions. Its policies own their detection and notification settings; overlapping policies remain independent.

Rules have a unique slug `id`, `enabled` (default true), `action` (`attach` or `exclude`), `match` mapping, and `checks` (currently only `availability`). Omitting `checks` excludes all supported checks for an exclude rule, or attaches availability for an attach rule. Unknown fields/checks and empty match values are errors. Fields are ANDed; values within a field are ORed; an empty match matches existing integration and entity source types. New device summaries require an explicit `kind: device` match so saved broad rules never expand silently. Attach rules are additive. Ordinary matching exclusions win independently of order; the guided integration device default has the narrow exception described below. Disabled rules have no effect. Catalog timings come from house settings; per-rule duration overrides and active probes are not supported.

Match fields are `domain`, `device_class`, `integration` (config-entry id), `device` (registry id), `entity` (`registry:<id>` or `entity_id:<id>`), `area`, `floor`, and `label` (registry ids), plus `kind` (`entity`, `device`, or `integration`) to restrict source type. Entity match input also accepts a current entity id, converted to registry identity on save/preview. Display names never drive matching. Entity area overrides device area; floor comes from the effective area. Labels are the union of entity, device, and effective-area labels. Integration nodes have only domain, integration and kind attributes. An exclusion with `device` but no `kind` affects associated entities; an explicit `kind: device` exclusion affects the device summary. An integration exclusion affects the entry and all its owned entities, while device summaries require their own explicit kind match. The guided integration device choice writes an exclusion with `overridable: true`, valid only with `kind: device` and one or more integration ids. A matching exact device attach defeats that integration default; every ordinary exclusion still wins. No association introduces a causal edge except an entity's owning entry.

Existing development selections are translated into narrow attach rules, including their owning entries, without expanding enrollment. The Homeostatic monitoring editor exposes the resulting rules rather than a second override system. Existing stored selections remain readable until saved. Stored function requirements are dormant. Situation checks are independent of the equipment catalog and cannot be disabled by equipment exclusions.

New matching sources enroll at the next registry event, state appearance, or 60-second reconciliation. Registry area/label/device changes re-evaluate rules. `inventory` exposes all eligible candidates, attributes and attach/exclude rule ids, including excluded candidates. `preview_rules` accepts a candidate rule list and reports matches and resulting enrollment without saving, changing episodes, or delivering notifications. The Homeostatic editor validates the complete proposed catalog as part of Save changes. Inventory retains at most 50 activity records in the current runtime. The first record states the complete count of sources matching at load and lists up to 50 of them; it is a scope snapshot, not an enrollment change. Later records include before/after source and rule details and a reconciliation id that groups changes from one pass. Activity is not persisted across reloads.

Monitoring summaries distinguish watched integration instances, device availability summaries, entities associated with a current Home Assistant device, and entities without one. These are inventory groupings, not physical or software classifications.

### Monitoring policy presentation

Home Assistant creates the integration entry in one step. It exposes no Configure flow or integration YAML fields. Policies is the monitoring editor for fresh setup. Supplied and user-created policies appear in one list with the same edit, duplicate, enable, disable and delete actions. Sources shows applicable policies and links to their editors. Notifications manages reusable delivery methods and activation. Each saved method has its own explicit Send test action.

Choose Monitoring type when adding a policy. The saved type is immutable; use a new policy for a different type. A duplicate keeps the type, receives its own identity and starts disabled. Source selectors and detection fields depend on the selected type's actual capabilities. Notification entries keep timing and selected methods together inside the policy editor.

Rendering changes no configuration. Navigation retains the complete pending draft. Every configuration editor uses one Save changes action without a separate Review button, review screen or preview prerequisite. Save validates the exact submitted draft, checks the saved revision, serializes changes and rolls back options if applying them fails. Existing internal preview/token checks may run within that action; public read-only preview APIs remain available. Validation and save failures explain the problem and preserve the draft. This applies to Policies, Notifications, Settings, retained source/rule/reporting editors and maintenance controls. Selective restoration adds explicitly chosen missing supplied policies to the draft without overwriting surviving policies; Save applies it. Reloads and updates preserve edits and deletions. The detailed model and first-run choices are specified below.

### Home Assistant device availability

Device details implement [ADR 0035](adr/0035-align-device-availability-with-ha-proposal.md), following HA architecture discussion 1400: Available, Partially available, Unavailable, Unknown, and Disabled. [ADR 0038](adr/0038-connectivity-evidence-and-device-problem-card.md) supersedes its generic entity fallback for a current `off` report from an enabled `binary_sensor` with device class `connectivity`: the device assessment is Unavailable with the reason `connectivity_disconnected`. Device availability is read on demand from all enabled registry entities, including hidden, diagnostic and configuration entities, independently of monitoring exclusions. Disabled devices take precedence. Without a disconnection report, any current non-unavailable state, including an HA unknown value, establishes Available. Every enabled entity currently unavailable establishes Unavailable. An empty set, no current states, or unavailable states mixed with missing/restored evidence establishes Unknown. Restored values do not establish current availability. The latter mixed-evidence rule is Homeostatic's explicit conservative completion of an unspecified upstream case.

The pure report reducer gives attached, loaded integration reports precedence: matching reports establish Available or Unavailable, and mixed reports establish Partially available. Only actual reports participate; absent reports are not negative reports. It retains provenance and consumes a current snapshot, so unloaded or detached entries cannot contribute. The supported HA version has no report API, so production uses entity fallback and never manufactures Partially available from mixed entity states. Native integration-report ingestion remains pending upstream.

The `homeostatic/source` and `homeostatic/node` replies carry `device_availability` with status, basis, reason, entity ids/counts, current connectivity ids, and integration reports. Non-device replies carry null. Disabled and empty registry devices remain browsable without acquiring monitoring checks. The Sources device view and issue detail display availability separately from selected-entity findings. The selected Sources view refreshes when HA access or connectivity evidence changes, including unmonitored members; other ordinary value changes do not refresh availability. This assessment itself creates no episodes, dependency edges, notification requests, or saved settings. The selected-entity monitoring contract below remains separate.

[ADR 0012](adr/0012-monitoring-expectations-and-persistent-exclusions.md) defines availability expectations. [ADR 0025](adr/0025-follow-home-assistant-availability-semantics.md) supersedes its member eligibility and status mapping: an HA `unknown` value is not an availability fault. [ADR 0045](adr/0045-device-issue-requires-every-selected-entity-unavailable.md) limits the device warning to total unavailability.

Selecting an entity's availability check declares that it is expected to be available. Selecting a device summary extends that expectation to its eligible members. Discovery alone makes no such declaration. Fresh setup enables separate supplied integration, device and entity availability policies with notifications off. Existing saved configurations retain their scope until explicitly edited.

Each device summary uses enabled ordinary entities, including buttons, or enabled diagnostic entities only when no ordinary entities exist. A button's unknown last-pressed value is not an availability problem. Configuration entities are not included. Hidden entities remain eligible; disabled entities and disabled devices do not. A device with no eligible entities has no device availability check, even when a device summary choice is saved; the choice remains visible for later eligible entities. Apply entity exclusions after choosing that base set, to both direct entity checks and device summaries. Excluding all ordinary members must not silently select diagnostics instead. If every member is deliberately excluded, attach no device check; exclusion is not passing evidence. No brand, entity-name, or unique-id-suffix exception determines health.

For passive availability, an HA `unknown` state means the entity's value is unknown, not that HA has lost access. It counts as available for this check while its raw value remains visible. Following the entity rule in [HA architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400), as adopted by [ADR 0045](adr/0045-device-issue-requires-every-selected-entity-unavailable.md), a device summary warns only when every selected entity is `unavailable` (`all_unavailable`). One selected entity with a current state, including an HA `unknown` value, makes the summary pass even when others are unavailable. Total unavailability does not assert a physical failure. A selected current `off` report from a registry-associated binary sensor with device class `connectivity` warns as `connectivity_disconnected`, even when other selected entities have current states. When no selected entity has a current state and not every one is unavailable, because some states are missing or restored, the summary is unknown (`incomplete_evidence`). These are observations against a monitoring expectation, not proof of physical freshness or an unexpected outage. `off` and `idle` are ordinary available states for other entity classes. A watched device depends on its watched associated integration entries for issue grouping, without changing the device's own observation.

The current device monitoring summary describes availability through Home Assistant across the selected entities. It is an adapter-owned check, not an HA device-registry state, the ADR 0035 device availability assessment, or an overall equipment-health verdict. The two scopes differ even without exclusions: the ADR 0035 assessment reads every enabled entity, including configuration entities and every connectivity sensor, while the summary reads only the selected set. The current observation follows these rules; episode activation and recovery still use the library holds.

| Selected entity evidence | Summary meaning | Observation |
| --- | --- | --- |
| A selected connectivity-class binary sensor has a current `off` state | Connectivity reports disconnected | `warn/connectivity_disconnected` |
| At least one member has a current state, including an HA `unknown` value | Reachable through Home Assistant | `pass/available` |
| Every member is unavailable | All monitored entities unavailable | `warn/all_unavailable` |
| No member has a current state, and not every member is unavailable | Insufficient current evidence | `unknown/incomplete_evidence` |

A passing summary does not prove that every member is available: some may be unavailable, missing or restored. Their states stay visible in device details. `warn/some_unavailable` is no longer produced; History still shows it for issues recorded before ADR 0045. On the first evaluation after restore, retire each stored open device episode whose anchor finding is `availability/some_unavailable` as `removed` through the public engine API and register the node anew, as for an exclusion change. The rule change is not recovery. An empty selected set attaches no check; an unmonitored or disabled device is not assessed as available. These distinctions do not add library statuses or change HA entity states.

**Stop checking** from an issue creates an ordinary catalog exclusion using the entity's stable registry identity where available. It opens a draft in Sources; select Save changes to apply it there. The exclusion survives entity renaming and reload, applies to both individual and summary checks, and can be removed in What to monitor. It changes neither HA entity state nor another situation check. When exclusions change an open summary's evidence set, retire that episode as `removed` using the public engine API and evaluate the remaining expectation anew. Do not report recovery based on removal of evidence. Persist the adapter's excluded-member identities beside opaque engine persistence so reload preserves this distinction. Acknowledgment means awareness; temporary shelving means postponing attention; neither changes monitoring expectations.

An entity without an HA device remains an independent candidate. A device source uses its stable registry id and has no edge to its selected member entities. Its edges to watched integration entries group simultaneous control-path failures. Device issue cards lead with the affected entity or reported disconnection and observed condition; they omit a generic availability label. Device problem details lead with the HA device name, the reported condition and other affected selected entities, then the device-page action. The integration type is quiet context shown once. Entity labels omit a repeated device-name prefix; a name identical to the device becomes Selected entity. When selected-entity findings and the all-enabled-entity device status conflict, a plain-language disclosure explains the different scopes. Working entities and reporting counts stay out of the problem brief and remain available in the collapsed selection. Acknowledge and Pause alerts precede optional monitoring choices. Complete selected-entity counts remain available in the collapsed selection. Monitoring choices and Technical details start collapsed. Technical details contain diagnostics and raw data without a standing assessment-rule essay. Device details list up to 50 current selected entity names and HA states, affected first, with the total and a route to all monitoring choices. The expanded choices stay bounded within the issue dialog, and each entity can open a draft exclusion in Sources. This on-demand list is current evidence, not historical proof of the episode's cause.

The runtime indexes each eligible entity to its watched device source, captures
every change in the device summary's status or reason in order, and reuses the
queued refresh worker. Repeated entity changes leaving that condition unchanged
do not create redundant observations.
Registry changes and periodic reconciliation rebuild membership. Automatically
selected device summaries leave monitoring when their last eligible registry
entity disappears, even if the HA device record remains. An exact device-id
attach rule retains the selected device as unknown without eligible members.
Deliberate exclusion or removal from monitoring also ends its check. The
initial catalog and rule preview show the device candidate and the
effective check count before a new rule is saved. The Monitoring page also
counts enabled HA device-registry records and lists enabled records without
an eligible entity separately. Disabled device records are counted apart
from the monitoring scope. Those records have no availability check or
fault episode; a broad device rule cannot infer their health. The list is
searchable and links to HA device details so the owner can add an enabled
operational or diagnostic entity where the integration supports one.
Notifications retain their separate activation setting.

### Settings and monitoring choices (legacy guided enrollment)

This section describes the older rule-based source editor. Fresh setup uses the unified Policies editor, with source details linking to the policies that apply. Existing configurations are not automatically converted.

The administrator dashboard includes a monitoring editor alongside read-only Coverage. Its independently collapsible navigation has only integration, device, and entity levels, with no nested scroll window or pagination. Children render when a branch opens, and search reveals full parent paths without narrowing a monitoring choice. Sources without a known integration remain under Other sources. The focused panel offers integration connection, discovered-device default, and separate-entity choices; device and entity panels offer their individual availability choices. Each control shows its current effective state and a draft choice. Integration device defaults apply to current and future matching device summaries. An integration-level device exclusion is overridable by an exact device watch; ordinary exclusions, including entity exclusions, still win. This avoids brand-specific client exceptions while allowing important equipment to be watched. Existing broad device rules remain active until the owner saves a change. The saved policies disclosure gives readable scope summaries and hides internal rule ids in technical details. A persistent Save changes action validates and applies the pending draft. The editor uses the existing catalog and guarded save path, with no second configuration store. Excluding a source does not infer health or recovery. Save rejects concurrent option changes and reports reload failure rather than claiming success.

An overall readiness sensor preserves `ready`, `unknown`, `degraded`, and `blocked` for watched equipment; no selections yield unknown. Diagnostic sensors show open episode and evidence-gap counts. The raw coverage query retains the library no-checks list. Queries/actions expose inventory, explain, readiness, impact, coverage, and rollup through public library APIs. Episode presentation is persisted independently of engine snapshot internals.

### Live dashboard

The integration registers a Homeostatic sidebar dashboard at `/homeostatic`, a reusable `custom:homeostatic-card`, and a `custom:homeostatic` dashboard strategy. The strategy creates Overview, Issues, Sources, Policies, Notifications, Settings and History views. The card's `view` accepts those page names; `functions` opens Overview for older cards. Existing user dashboards are not rewritten.

Every active Home Assistant Repair, except those Homeostatic raises, is a `repair` source with its own episode. Its name is the Repair's translated title, its finding names the raising integration and severity, and its link is the automation editor when the Repair carries one and the Repairs page otherwise. The episode ends when Home Assistant deletes the Repair or the owner ignores it. During the startup hold, a stored Repair that its integration hasn't raised again keeps its episode open. In the unified model, each Repairs policy owns its notification entries and supplied defaults have none. Older generated reporting configurations use the `repairs` reporting choice. Up to 500 Repairs are tracked. Trace-only run errors stay outside this contract ([ADR 0044](adr/0044-report-home-assistant-repairs-as-issues.md)).

Each loaded automation that names an entity id present in neither the entity registry nor the state machine is one `broken_automation` source. The issue uses the automation's name, lists the missing ids, and links to that automation in the editor. The check runs after startup, when automations reload, when an entity registry removal or an id change asks which automations still name that id, and when a created entity id is named by an open issue. Other registry updates do not run it. If the automation component is not loaded, the check does nothing and does not end issues it already opened. The issue ends when the automation no longer names a missing id, the automation is gone, or the entity exists again. It is outside the dependency map and does not change enrollment or edit the automation. In the unified model, enabled Broken automations policies select this check and own their notification entries; the supplied policy has none. Older rule-based configurations keep the check on until a broad `broken_automation` exclusion is saved and use their saved reporting choice. Turning Repairs off leaves this check on. Unavailable, unknown, and disabled entities do not open it. Template-only ids, device triggers that never resolved to an entity id, and scripts stay out ([ADR 0050](adr/0050-flag-automations-that-name-missing-entities.md)).

Home, History and problem detail are read-only. Sources, Policies and Settings provide guarded monitoring, timing and notification edits in the panel. All dashboard WebSocket commands enforce administrator access. The integration exposes no native Configure form.

Without `compact: true` or `paged: true`, `homeostatic/subscribe` sends a schema-version-1 snapshot after subscription acknowledgement and on runtime publication. It contains availability, current equipment readiness, inventory, active episodes, operator controls, coverage, policy explanations, and HA location names. It never reads engine snapshot internals or advances time. Startup, storage error and unload publish `available: false`. Subscriptions survive entry reload and end on client unsubscribe or disconnect.

`homeostatic/node` accepts one `node_id` and returns its source, public explanation, potential impact and readiness (null for situations). Unknown nodes return `not_found`; unavailable monitoring returns `not_ready`. Subscription, node detail, configuration read and previews do not mutate state. `homeostatic/save_configuration` changes catalog rules; `homeostatic/save_alerts` changes notification activation and the consumer. Enabling requests can authorize messages for already-open episodes after reload. No dashboard endpoint acknowledges problems, starts maintenance, shelves, or directly sends a notification.

The shipped frontend requests `paged: true` on `homeostatic/subscribe` (schema 3).
It receives current evidence and source names for open episodes and active
controls without the full discovered catalog. `catalog_revision` and
`catalog_sections` identify a coherent set of static lists. Sources and views
that need the complete inventory load it on demand with `homeostatic/catalog`:
revision, section, offset and limit (1–200, default 200). Each response contains
the same revision, section, offset, total, items and next offset, or null when
complete. Stale revisions return `stale_catalog`; unavailable monitoring returns
`not_ready`. This endpoint is administrator-only and read-only.

One shared client fetches pages sequentially and installs the completed catalog
atomically, merging the latest dynamic evidence. Partial pages never imply a
complete search or empty healthy inventory. The first Sources visit waits for a
complete catalog. Once loaded, a new revision keeps the previous complete tree
available with an updating notice while replacement pages arrive; the notice
identifies results as potentially out of date and offers retry if loading fails.
No partial new catalog is shown. Unavailability, disconnect and final unsubscribe
discard in-flight results. Revision changes coalesce into one replacement fetch;
errors require explicit retry. Once the replacement finishes, search again
covers every source in the current revision; the tree has no visible pagination. Settings and
Notifications render from the administrator configuration response without
waiting for the full source catalog; monitoring policy area and floor names are
supplied with that response. Existing full and compact subscriptions retain
their contracts. See ADR 0029.

An inventory signal starts rediscovery but advances the catalog revision only
when source metadata, candidates, targets, enrollment history, or browsing
locations actually change. Unchanged rediscovery keeps the loaded Sources tree
and does not repeat the catalog download. Area, floor, and device browsing-name
changes still advance the revision even if monitored sources are unchanged.

Coverage and house source rows show monitoring status and evidence without displaying catalog rule ids. Rule ids remain available in administrator inventory and configuration previews for tracing enrollment decisions.

### Sources workspace target

Sources combines the former source browsing and monitoring views under [ADR 0017](adr/0017-one-sources-workspace.md). Grouping changes presentation only; they do not change enrollment or notification state.

The target navigation is **Overview, Issues, Sources, Policies, Notifications, Settings, History**, with History at the far right in both the Homeostatic header and generated Home Assistant dashboard. Sources combines discovery, current evidence, and source-specific monitoring choices in one workspace. A persistent source selection drives one detail panel with **Source**, **Settings**, and **History** views. Source summarizes identity and current evidence; Settings shows saved monitoring and its guarded editor; History shows retained events linked to the selected source. Switching views retains tree selection and any monitoring draft. Overview and Issues retain their existing responsibilities. Policies owns the installation-wide monitoring catalog. The top-level Notifications page owns guided delivery choices and activation; Settings holds Timing and Problem grouping. ADR 0022 established the earlier destinations and page ownership; ADR 0047 gives Policies its own page.

Sources provides **By integration**, **By Home Assistant location**, and, when its read-only tree is available, **By Topomation** views. Integration is the initial default; remember the owner's grouping thereafter. Home Assistant location uses HA floors and areas. A floor lists its areas. Devices and entities appear under the area they belong to. A grouping switch preserves the selected source by stable identity and reveals its new path. Unlocated sources, floorless areas, entities without devices, and sources without a known integration remain explicitly reachable. Integration entries and other non-location sources have a suitable Other sources fallback rather than a fabricated area or device. Location grouping creates no dependency. The watched device-to-integration edge follows the HA entry association described above.

When Topomation's read-only `topomation/locations/list` response supplies a usable tree, the Group by menu offers Topomation explicitly. That view uses its ordered parent-child hierarchy, explicit entity placements and HA area mappings. Unplaced sources remain under Unassigned. Home Assistant location always uses HA floors and areas. If Topomation becomes unavailable while selected, return to Home Assistant location. This changes presentation only; it never changes monitoring, dependency, readiness or attention decisions ([ADR 0024](adr/0024-explicit-topomation-grouping.md)).

Sources describes the optional TopoMation hierarchy beside Group by and links to its integration page whether or not the tree is available. When available, the note identifies the TopoMation choice and whether it is selected. The link is informational and does not install or configure another integration.

Search stays above the tree and covers the complete inventory. **Needs review** is a filter with branch counts, not a flat preamble of repeated findings. Initially render compact collapsed groups; gaps alone do not expand them. A source link or search reveals only the necessary ancestor path. The disclosure control changes expansion independently of selecting the row. Live evidence updates retain selection, expansion, search focus, and reading position. Large branches render on demand with a bounded visible working set, using windowing if necessary; do not reintroduce nested pagination, a separately scrolling tree window, or new grouping levels just to divide a long integration list. All matches remain reachable through whole-inventory search. Filtering never changes the scope of an edit. An opened tree offers Collapse all.

Integration rows place device counts beside their names. Device rows place included/total entity counts beside their names. Open issue counts follow the source name on the same line; scope counts stay secondary and may wrap on narrow screens. Entity rows distinguish a separate check, inclusion in a device check, an explicit exclusion, and an unselected source. These labels do not change monitoring enrollment or imply that an unselected entity has a problem. When an integration has multiple HA config entries, show its devices first and its labeled integration connections as direct children; do not insert a Connections tier. The integration panel lists its connections in a collapsed section and explains that they are HA registrations rather than devices. A connection with its own issue remains reachable directly in the tree.

A collapsed explanation above the Sources tree tells owners what a new installation monitors, how an enabled device check selects eligible Home Assistant entities, and why battery conditions, vacuum errors, and separate entity checks need their own choices. It links the explanation to source Settings without changing saved choices. Opening it stays open through live evidence updates and search rerenders.

The selected panel answers what/where, what HA currently reports, what is monitored, and the available next action. Group selection shows compact counts and shared explanations. Device details lead with a selected connectivity-class sensor reporting disconnected, then selected entities unavailable or lacking a current state. They list those entities first and collapse the other selected entities. They offer direct routes to device settings in HA and monitoring choices without generic next-step paragraphs. The independent HA device availability status stays visible in a compact line and is never relabeled as a selected-entity issue. An entity detail shows its HA availability, current value when present, and effective monitoring relationship once; it does not repeat its own name in a one-row list or turn that name into a self-link. HA `unknown` is an available entity with an unknown value. An entity that is unavailable in HA but not monitored is presented as a state, not an open Homeostatic issue. Preserve the distinctions among integration connection, device-summary membership, separate entity checks, excluded/unselected sources, evidence gaps and open issues. An unselected source alone is not a problem; an unavailable HA entity alone is not proof of physical failure. Internal ids and raw rule/evidence data remain in Technical details.

In the Source view's Home Assistant entities list, names of other entities open their Source details. An entity's own detail does not repeat its name in a one-row entity list. The explicit Open in Home Assistant action remains the route to HA.

**Edit monitoring** opens an administrator-only draft beside the same source. Integration connection choices, current/future device defaults, exact device exceptions, entity choices, and advanced saved policies retain ADR 0016 and the existing catalog behavior. Browsing is read-only; a control change stages a draft. Show saved effective monitoring separately from proposed choices. Selection, regrouping, filtering, and navigation away must preserve the draft or require explicit discard; they must never save or silently discard it. Save validates the complete proposed rules and their effects against the unchanged saved revision; no separate review step is shown. Edits invalidate any internal validation token. Existing reload failure and rollback behavior remains. No new preference store is introduced.

Entity Settings leads with the effective state, **Follow device monitoring**, and **Exclude this entity**. When the entity is already included by a device check, **Monitor this entity separately** remains under **More monitoring choices**; a saved separate choice opens that disclosure. When no device check includes it, show **Monitor this entity** directly. These choices retain their existing catalog actions and exact-payload save guard. Exclusion removes both device membership and any separate check; an individual attach does not override an ordinary broader exclusion.

Existing Explore, Monitoring, settings-source links, source links from issues/history, and reusable-card views route into Sources with their stable source/location identity and intended filter or editor state. The old public view identifiers remain compatibility aliases during migration. Navigating from an issue preserves a useful return path. Disconnection removes current-status claims and prevents saving until fresh evidence/configuration is available; it does not imply an empty healthy installation.

Sources regression criteria:

- With 78 evidence gaps, show grouped counts and a Needs review filter; no repeated 78-row or first-20-row introductory report, and no auto-expansion of every gap branch.
- With 6,000 sources, including a large device and sources without integration/location/device associations, every identity remains searchable and reachable. Initial rendering is compact and opening a large branch remains responsive without nested scrolling or pagination.
- Open a source from an issue, switch integration/location grouping, search, and receive live updates without losing its identity or the expected navigation state. A source without a location remains reachable rather than acquiring invented membership.
- Stage an entity exclusion and a device-default exception, change selection/grouping, then save. Confirm the exact catalog scope, unchanged saved state before Save, stale-revision rejection, and correct save/reload failure handling.
- Verify keyboard expansion and selection separately, a narrow viewport, unsafe names as text, non-administrator access, old reusable-card entry points, and disconnect/reconnect behavior.

Client disconnect/error replaces any current-status claim with an explicit unavailable/stale message. Reconnection waits for a fresh subscribed snapshot. An open detail view refreshes against updates, and removed/resolved selections are identified rather than left as current problems. Frontend content treats names, findings and reasons as text, including when creating links to native HA configuration. Cards share one subscription per HA connection while mounted and release it when the last card is removed. When embedded with navigation tabs hidden, a drill-down to another page offers a return button to the card's configured view; selecting an already-active HA dashboard tab is not required to reset the card.

Routine subscribed updates retain the current page, selected location, open disclosures, search focus and cursor, and reading position. An unavailable or disconnected banner replaces current health claims while the page's navigation state is held for the next fresh snapshot. A deliberate page or location change starts with that destination's own disclosure state.

Dashboard navigation does not request monitoring evaluation. A new subscription receives the adapter's already-completed snapshot immediately. Cards replaced within the same JavaScript turn retain their shared subscription and current view; final cleanup runs at the next microtask when no card remains. A full browser reload opens a new subscription and briefly says Loading dashboard while receiving that snapshot, without claiming monitoring has never completed. A connection-ready event cannot replace a snapshot or error already received after reconnection with loading. Disconnect invalidates the compact baseline; only a new full baseline can restore current status.

Modal details and operator forms scroll within their dialog. Scrolling past either end of a dialog does not move the dashboard behind it.

Previously enrolled identities and their last match attributes are persisted independently of the opaque engine snapshot. A registered entity with missing state remains monitored with unknown evidence. An exact entity-id attach rule, a legacy explicit entity selection, or a function requirement retains its entity expectation even after registry deletion; an exact device-id attach rule retains a saved device choice without an availability check until eligible members exist. Explicitly required config entries likewise remain unknown when absent. A config entry that remains registered but is not loaded is unknown. When HA removes an automatically selected registry entity, the last eligible member of an automatically selected device summary, or an automatically selected config entry, Homeostatic removes that source, resolves any active episode as `removed`, and retains the resolution in history. The removal event does not identify user intent and never establishes recovery. Ordinary live metadata replaces retained metadata when a selected identity is present again. A state-derived device class is retained while state evidence is missing, unknown, restored or unavailable. State-only identities are retained while state evidence is absent, but do not promise continuity across entity-id changes.

The first catalog checks config-entry state and entity availability. Disabled, temporarily not loaded, explicitly required but missing, startup, or restored sources are unknown evidence. An HA entity state of `unknown` has an unknown value but passes the passive availability check; it is not an issue or stale evidence by itself. A loaded config entry passes; setup retry warns for a configurable retry hold, then fails; setup/migration errors and failed unload fail. Pending reauthentication fails with `auth_required`. Confirmed deletion of an automatically selected registry source is a scope removal, not unknown evidence. An entity reporting `unavailable` warns. A valid state value does not prove physical freshness or the correctness of that value. Device freshness, Frigate liveness, command completion, update catalogs, and external probes require separate producer contracts and real traces. The battery and vacuum producers below have their own bounded contracts.

### Battery maintenance producer

Homeostatic discovers battery percentage (`sensor` or `number` with battery device
class), explicit low-battery (`binary_sensor` with battery device class), and
charging (`binary_sensor` with battery-charging device class) from HA metadata.
Charging alone is context, not a monitored battery. Battery candidates appear in
Sources and remain unmonitored until a saved catalog rule selects their
`battery` check. Each rule selects one check: `availability`, `battery`, or
`vacuum`. A rule enrolls only the check it names. The battery candidate is an
edgeless maintenance node, separate from HA availability.

One percentage and one explicit warning on the same HA device are offered as one
reviewable battery candidate. When several percentage or warning entities belong
to one device, each is offered separately; charging is associated automatically
only when there is one battery candidate and one charging entity. An entity
without an HA device remains its own candidate. The source uses its primary
entity's registry identity where available. A changed source grouping retires
the old monitoring identity as removed, never as physical recovery. Source details
show all paired entity ids so an owner can leave a mistaken pairing unmonitored.

A current percentage at or below the policy threshold (20% by default) or an explicit low warning is `warn` /
`battery_low`; contradictory low and normal reports remain a warning with a
conflict marker. A current, confirmed charging report for that battery is
`pass` / `charging` even while a low report remains. A current percentage above
the policy threshold and an explicit normal warning clear the low condition when all configured
low signals are current and normal. Missing, unavailable, invalid, or restored
low evidence is `unknown` unless another current signal reports low or charging
is confirmed. Missing charging evidence cannot itself clear a low condition.
If charging stops while low evidence remains, the warning can open again. Battery
checks have zero raise and clear hold and no physical-freshness TTL; HA state
updates do not establish a device-originated heartbeat. A charging clearance
means this monitored condition ended, not that the battery was replaced or is
fully charged. Current readings, entity ids and conflicts remain available as
evidence; replacement type remains unknown without verified metadata. Existing
reporting preferences and attention rules govern delivery.

### UPS condition producer

Homeostatic maps NUT and APC UPS Daemon entities into one UPS producer. Discovery uses the integration's full entity unique ids and the device identifier's integration and id, including separate devices on one server. Further identifier fields are ignored. A candidate requires mapped raw status and battery charge or remaining runtime. Entity names never identify roles. Disabled diagnostics remain disabled and are shown as optional missing evidence. Conditions begin unmonitored until a named policy selects them.

Each UPS condition is an independent edgeless node: `ups_power`, `ups_reserve`, `ups_battery_replacement`, or `ups_fault`. Named policies create stable device/condition identities qualified by policy identity and detection settings. Backup operation warns, replacement warns, and explicit faults fail; NUT bypass warns about lost protection. Mains input alone cannot prove output to connected equipment. No power wiring or equipment dependency is inferred.

NUT reads raw `ups.status` flags. `OB` and `OL` establish backup and mains mode; `LB` and `RB` report reserve and replacement warnings. `OVER`, `OFF`, `FSD`, and `ALARM` report faults; `BYPASS` reports lost protection. `TRIM` and `BOOST` alone pass the fault check, and calibration/test flags remain context. APC UPS Daemon maps `ONLINE`, `ONBATT`, `LOWBATT`, `REPLACEBATT`, `OVERLOAD` and `NOBATT`. Its `COMMLOST` report invalidates cached condition measurements rather than asserting a hardware failure. Unrecognized flags are retained in technical evidence.

Reserve can supplement an explicit warning with owner-selected charge or runtime threshold pairs. Values at or below the low threshold warn. Once low, values must reach the higher recovery threshold to clear. Without a custom pair, a readable mapped device low setpoint is used, and recovery requires a value above it. Runtime is normalized from its reported seconds, minutes or hours into minutes. Explicit warnings cannot be canceled by a conflicting numeric value. All enrolled reserve signals must be current and normal for recovery. Charging alone clears none of the UPS conditions. Checks have zero raise hold, the configured clear hold, no physical-freshness TTL, and the existing unknown hold.

Missing, unavailable, restored, disabled, invalid or contradictory mode evidence never clears a condition. Retain enrolled signal bindings while their HA device and owning entry exist, including through restart; registry removal of a signal and an orphaned state under its former name are unknown evidence. Explicit device or entry removal ends monitoring as removed. Persist last confirmed power mode, numeric hysteresis and device thresholds independently of the opaque engine snapshot.

Reserve notification rows explicitly select `when: mains` or `when: backup`. Templates start with no notification entries. Owners can add a scheduled mains summary and immediate backup delivery, with acknowledgment reminders if desired. Before any confirmed mode, reserve is dashboard-only with a visible evidence gap. Missing mode evidence retains the last confirmed reporting mode while low reserve is established. A confirmed transition into backup mode rearms an earlier acknowledgment through the public `Policy.rearm` API, preserving the issue and its shelf. Returning to mains disables backup-route reminders and leaves the reserve issue open until its own recovery.

Unified policies allow UPS reserve and generic battery monitoring to overlap independently, without ownership transfer. In the older unversioned configuration, an enabled reserve policy overlapping generic battery monitoring requires explicitly selected `replace_battery_check` ownership. The editor identifies the battery checks and issues whose monitoring will end. The saved policy suppresses those checks without rewriting the original rules or stored notification preferences. The UPS policy has its own explicitly configured notification rows. Disabling the policy retains the transfer. Clearing its transfer choice or deleting the policy can restore checks selected by the original battery rules; the editor identifies those additions before saving.

Issues groups conditions under one UPS, with active urgent conditions ahead of recovery and uncertainty. Each issue retains separate acknowledgment and pause actions. Counts represent conditions consistently across pages. Sources lists applicable policies; Policies owns thresholds and condition-specific notification rows, and Notifications owns reusable delivery methods; policies own timing. The compact card shows useful readings with runtime labeled as an estimate. Details lead with the reported condition and next step, with flags and ids under Technical details. Partial recovery keeps the remaining conditions visible.

### Vacuum error producer

Homeostatic offers every `vacuum` entity as its own candidate
([ADR 0046](adr/0046-report-vacuum-error-activity.md)). Candidates stay
unmonitored until a saved catalog rule selects the `vacuum` check. An
availability rule leaves that check off, and a vacuum rule leaves availability
off. A broad rule may cover current and future vacuums. An exclusion wins.

The check reads the entity's current activity. `cleaning`, `docked`, `idle`,
`paused`, and `returning` pass. `error` fails with reason `vacuum_error`.
`unavailable`, `unknown`, a missing state, a restored state, and any other
value are `unknown`. Unknown keeps an open issue open. The check has no raise
hold and no clear hold. The finding says Home Assistant reports the vacuum in
error. When Home Assistant has an area for that vacuum, the notification names
it. That area is the device's assignment in Home Assistant.

The source is its own node and has no dependency edges, so a failed integration
does not absorb it. Availability of the same entity, when watched, stays a
separate issue. A change from one ordinary activity to another, including
`cleaning` to `error`, is observed even though both are available states.

On a generated reporting policy, a vacuum error uses Immediate unless that
vacuum has its own source preference. The fallback matches check `vacuum` and
sits immediately ahead of the empty household rule, so a source preference
still wins. Immediate sends once, including overnight. When Immediate has no
recipients, the issue is recorded in the panel. Custom policies are left as
written. Discovering a vacuum sends nothing. Homeostatic does not command the
vacuum.

### Configured temperature producers

Each selected source and named policy has an independent temperature monitor. Temperature limits require a finite minimum, maximum or both, an explicit duration from zero to 365 days, and °C, °F or K. Minimum cannot exceed maximum. Thermostat defaults are a 2 °F permitted margin, 2 °F meaningful progress, 2 °F worsening and a one-hour progress interval; the interval must be positive. Policy copies have independent identities. Detection edits retire the affected check and its pending qualification before starting the replacement; renaming leaves monitoring untouched.

The sensor producer reads the current state and its `unit_of_measurement`. The thermostat producer reads `current_temperature`, `temperature`, or the `target_temp_low` and `target_temp_high` pair. In the supported HA 2026.9 Core, climate attributes are converted into the installation temperature unit; the caller supplies `hass.config.units.temperature_unit`. The producer does not infer units from the thermostat hardware. These contracts follow the [sensor documentation](https://developers.home-assistant.io/docs/core/entity/sensor/) and [the supported climate implementation](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/climate/__init__.py).

Normalize absolute readings and targets into Celsius and round comparisons to six decimal places. Difference conversion applies the scale only, with no absolute-temperature offset. Equivalent normalized targets do not reset progress. The check observes reported values; repeating a cached value at a deadline does not establish physical freshness. No sensor placement, equipment defect or physical freeze prediction is inferred.

A temperature-limit reading outside either bound starts continuous qualification. Equality is in range. At the duration deadline, an ongoing violation warns; duration zero warns immediately. An in-range reading cancels qualification or clears the condition. A direct low-to-high or high-to-low jump without an observed in-range reading preserves qualification and issue identity, while updating the violated bound. There is no additional recovery threshold.

Thermostat `heat` checks below target minus margin; `cool` checks above target plus margin; `heat_cool` uses its low and high targets respectively. Equality is permitted. HVAC action is context and never a prerequisite or reset trigger. A new target, mode or conditioning direction starts a new comparison context without crediting the smaller target gap as measured progress. Off and unsupported modes return a removal instruction: retire the check as monitoring ended, without issuing a passing observation. Missing or unavailable modes are unknown evidence instead.

Within an unchanged thermostat context, retain the best temperature reached, a last-credited comparison temperature and its time. Improving the best temperature by the configured progress amount credits one new interval from that observation. Smaller steps accumulate; returning to an already reached temperature earns no credit. A fall away from the best temperature by the configured worsening threshold warns immediately. Cooling reverses these comparisons. This best-temperature baseline allows deterioration after useful recovery to qualify. Missing the progress deadline warns as stalled. A usable observation at exact deadline equality is evaluated for recovery and meaningful progress before stall; progress first observed after an elapsed deadline cannot erase the stall. Timers revisit current evidence at the returned deadline.

Once qualified, thermostat progress alone does not clear an issue; entering the margin does. A later worsening observation updates the same issue. A changed target that already satisfies the margin clears with a target-satisfied reason, distinguishing the changed expectation from measured improvement. An open issue remains open when the new target still lies outside the margin.

Missing, unknown, unavailable, restored, nonnumeric, nonfinite, unsupported-unit and malformed target-range evidence emits unknown and discards pending qualification and progress history. It never clears a qualified finding. Current usable evidence starts a fresh observation interval; an already-qualified condition remains qualified until its own recovery evidence or monitoring removal. Persistence retains only the qualified reason. Restart discards pending intervals and temperature comparisons so unobserved downtime cannot qualify a new issue or manufacture progress. The adapter restores the library's issue independently and supplies fresh producer observations. Producer observations have no freshness timeout; check enrollment owns the existing unknown-evidence hold. Availability monitoring remains independent.

Producer evidence includes source identity, normalized temperature, configured bounds or targets, thresholds, current observed interval and an explicit unverified physical-freshness flag. The temperature timeline fixture covers duration equality, gaps, restart, conversion, oscillation, changed targets and progress. Monitoring and reporting configuration use the validated single-save path; these producers do not request delivery directly.

## Time and lifecycle

Create or restore the engine only after HA has started. Load listeners and entities earlier, reporting unavailable until startup completes. One adapter owns calls into engine and policy on the HA event loop. Observations arriving together are ingested atomically. State and entry callbacks capture observations with their receipt time before queuing work. Every captured transition is applied in order, even if storage is busy. Each transition is its own observation batch; reconciliation must not erase it. Registry changes trigger an inventory refresh; a 60-second reconciliation interval catches missed lifecycle changes and pending reauthentication. A deadline timer uses the earlier engine/policy deadline, independently of reconciliation. No delay is added to batch unrelated observations. One queued refresh worker drains captured transitions in receipt order; redundant wakeups share that worker. New observations during persistence request another pass. A failed pass is retried by subsequent evidence or reconciliation, without a busy retry loop. Shutdown drains captured evidence under the same serialization lock and cannot rearm work.

Availability-only events use an entity-to-source index and the existing catalog. Entity registry changes, config-entry additions/removals, state arrival/removal, source-name/device-class changes and explicit/60-second reconciliation rediscover inventory; periodic reconciliation still captures missed config-entry and reauthentication changes. An observation callback does not rebuild unchanged inventory or reread every entity. Deadlines reobserve enrolled integration conditions to preserve retry escalation, and advance engine/policy timing. Public inventory queries remain detached from the cached metadata.

[ADR 0010](adr/0010-large-inventory-updates.md) records the ordered runtime and compact-transport decision. Catalog metadata has an in-memory revision. The optional `compact: true` dashboard subscription uses schema version 2: its first available event includes the complete catalog, areas and floors with `inventory_changed: true` and a `catalog_revision`; subsequent events at that revision omit those static fields and set `inventory_changed: false`. Dynamic problem, readiness, coverage, history and control fields remain complete replacements. A catalog change, reconnection, runtime replacement or recovery from unavailability sends a full baseline. Clients reject a delta without a matching available baseline. Legacy subscriptions remain full schema-version-1 snapshots. This reduces repeated transfer; the initial catalog remains a full snapshot. House/coverage source tables render at most 50 rows per page and search the complete received inventory by name, identity, kind or monitoring label. Search and page survive evidence updates; a location change resets the source selection. Cached client lookup/location models are replaced with the catalog baseline.

Initial settings: settle 120 seconds, rejoin grace 60 seconds, startup grace 120 seconds, longest startup wait for integrations 600 seconds, coalescing count 3 and window 60 seconds, notification batch 30 seconds, clear hold 120 seconds, unknown hold 900 seconds. Availability failures have zero raise hold; setup retry has a 120-second warning period across unsuccessful setup attempts. SETUP_IN_PROGRESS does not reset the retry onset; leaving the retry cycle does. The panel edits these durations. Availability checks use no observation expiry because they read HA's current state; physical freshness is explicitly unsupported. The reconciliation timer is adapter plumbing, not a physical heartbeat. Apply startup grace when Home Assistant starts; a Homeostatic integration reload while HA is running, including a panel save, skips it. Preserve the configured startup duration for the next full HA start.

Reconciliation reads all enrolled sources into one observation batch. It registers new or changed nodes together through `Engine.register_many` before ingesting observations, preserving existing check state and validating the final topology. Initial setup likewise registers its graph in one batch; unchanged reconciliation does not register nodes again. It keeps missing selected nodes as unknown. Explicit unenrollment removes their nodes; a removal notice is not presented as physical recovery.

Ordinary available-value changes do not trigger a new availability observation or snapshot write. Changes between available, unavailable, unknown, missing, and restored evidence do. A vacuum activity change is observed even when that availability signature stays the same. Periodic reconciliation still refreshes the available HA evidence.

## Presentation and queries

The standalone Homeostatic panel includes a keyboard-accessible hamburger button in its persistent header, with a 44-pixel touch target. The header, including its title and page tabs, stays at the top of the panel's scrolling viewport while content scrolls beneath it on phones and desktops. It dispatches Home Assistant's native `hass-toggle-menu` event to open or close the HA sidebar, including on narrow screens and while monitoring is loading, disconnected or unavailable. Internal Homeostatic page tabs remain separate. Embedded dashboard cards rely on their containing HA dashboard for global navigation and retain an ordinary scrolling card header.

An overall readiness sensor preserves `ready`, `unknown`, `degraded`, and `blocked` for watched equipment; no selections yield unknown. Diagnostic sensors show open episode and evidence-gap counts. The raw coverage query retains the library no-checks list. Queries/actions expose inventory, explain, readiness, impact, coverage, and rollup through public library APIs. Episode presentation is persisted independently of engine snapshot internals.

### Live dashboard

The integration registers a Homeostatic sidebar dashboard at `/homeostatic`, a reusable `custom:homeostatic-card`, and a `custom:homeostatic` dashboard strategy. The strategy creates Overview, Issues, Sources, Policies, Notifications, Settings and History views. The card's `view` accepts those page names; `functions` opens Overview for older cards. Existing user dashboards are not rewritten.

The dashboard is administrator-only because the aggregate view includes installation-wide inventory, configuration and notification routing. Read and configuration WebSocket commands enforce administrator access; hiding the sidebar is not the authorization boundary. Operator forms call the existing HA administrator services, which enforce authorization independently. Non-administrators get an explicit access message. Existing readiness entities remain available through HA's entity access controls.

Without `compact: true` or `paged: true`, `homeostatic/subscribe` sends a schema-version-1 snapshot after subscription acknowledgement and on runtime publication. It contains availability, current equipment readiness, inventory, active episodes, operator controls, coverage, policy explanations, and HA location names. It never reads engine snapshot internals or advances time. Startup, storage error and unload publish `available: false`. Subscriptions survive entry reload and end on client unsubscribe or disconnect.

`homeostatic/node` accepts one `node_id` and returns its source, public explanation, potential impact and readiness (null for situations). Unknown nodes return `not_found`; unavailable monitoring returns `not_ready`. These read endpoints do not change configuration, acknowledge problems, start maintenance, shelve, or send notifications.

`homeostatic/preview_delivery_method` is administrator-only and accepts `{method_id, revision}` for a saved reusable delivery method. It returns `{method_id, name, targets, presence, skipped, preview_token}`. Each target contains `{channel, name, type, available}`; presence maps each selected person entity to `{state, restored}`, with null state for missing evidence. Preview reads current evidence without advancing attention, changing configuration, writing the delivery outbox or making any transport request. Unsaved or missing methods and stale configuration revisions return `invalid_method`; unavailable monitoring returns `not_ready`.

`homeostatic/test_delivery_method` is administrator-only and accepts `{method_id, revision, preview_token}`. It recomputes the preview and requires its token to match the saved revision, method definition, current presence evidence and resolved target list including availability. Changed evidence or destinations returns `preview_required`; an unavailable selected target returns `invalid_route` before any request. The method editor runs target resolution and validation within its single Send test action, without a preview screen or separate testing area. Only a saved unchanged method can be tested. An explicit test requests a fixed message for exactly the resolved configured targets, independently of outgoing issue notifications. The response is `{requested: [channel], failed: [{channel, error}], skipped: boolean}`; a provider failure does not turn into presence fallback or imply failure of another target. An explicit skip selection sends nothing. Test requests do not create episodes or use the issue outbox, and success reports a request rather than receipt or speech heard.

Integration problem details identify the integration and entry, explain the reported condition and link to its native HA connection. The catalog preserves `ConfigEntry.reason` in the finding message for setup/retry/migration/unload errors and pending reauthentication; it never reads entry credentials or parses logs to infer a cause. This message remains part of the episode, including history and notification content. Native integration links highlight the specific config entry when its domain is known. Raw evidence, dependency explanations, potential impact, readiness and notification policy remain inspectable in secondary details.

The adapter retains a separate integration presentation record containing the current observed HA condition and the last reported setup/authentication failure, each with an observation timestamp. Captured transitions update this record in the same order as engine ingestion. Unknown/startup/disabled evidence retains the last failure as historical context; a loaded observation clears that context, and explicit unenrollment removes it. The record survives reload in the verified storage envelope; older envelopes begin collecting without inventing previous evidence. It never rewrites library findings, readiness, episodes or notification content. Inventory includes these records for integration anchors of open episodes as `integration_evidence`; node detail includes the selected integration's record, or null.

Setup-in-progress after a failure distinguishes HA's current retry from the previous reported error. Technical details label and timestamp that previous report. A missing integration presentation record uses available findings without guessing a cause.

Problem cards and details use an owner-facing brief: recognizable source and integration, plain-language condition, one relevant next action or an explicit wait state, and current progress. Normal importance, raw exception strings, empty dependency explanations, and generic physical-verification disclaimers do not lead this view. Missing household impact is not replaced with invented device failures. Disabled entries remain visible and counted, use neutral styling, and do not imply intentional disablement. Loaded entries with an open episode say recovery is being confirmed rather than announcing a resolved problem. Loaded entries without an open episode simply report an available connection.

Timeout wording is a deterministic presentation of recognized timeout exception signatures in HA's reported setup error, never a new health verdict. Only setup-error/retry activity can use this wording; pending reauthentication, disablement and recovery take precedence over historical errors. NuHeat timeouts suggest trying the NuHeat app and reviewing its HA connection; Denon AVR timeouts suggest checking receiver power/network and its HA connection. Other integrations receive a generic timeout explanation without assuming local/cloud transport. Sign-in instructions require HA's explicit reauthentication state, never an authentication URL or error-text guess. Unrecognized or absent errors use an honest connection-status fallback, with the unmodified report in Technical details.

Entity problem briefs identify the capability from HA domain/device class and show its known area and integration. They explain the missing reading or control path and give a relevant first check without diagnosing a physical fault or inventing affected automations. Light and occupancy/motion guidance is specific; unrecognized capabilities use conservative guidance. Disabled, missing, restored, stale and unknown evidence remain distinct. An entity newly reporting an available state with an open episode says Checking recovery; this does not mean the library's clear hold has finished or its readiness is ready. A current non-passing watched owner keeps the connection problem visible; a non-passing watched owner is shown separately, without claiming it caused the entity symptom. Cards receive the current observed HA reason and public explanation/readiness for open entity anchors in `inventory.entity_status`; detail uses the same record and queries. The adapter captures the entity reason at the same ordered ingestion boundary, since the engine deliberately suppresses unknown findings during its hold. This current-only record is rebuilt from startup observations, pruned on unenrollment and never used to make health or notification decisions. Current observed availability can explain a pending recovery while library readiness still waits out its clear hold. Neither view announces resolution before the library closes the episode; without a current observation, public stale findings remain evidence gaps. Missing context never falls back to historical episode reasons or implies recovery. Native entity details and known device pages are navigation only.

The primary action opens the relevant native HA entry; reauthentication opens that entry's sign-in prompt. It never performs a retry, enablement, credential change or equipment command automatically. Open-problem details show the source once, the reported condition and current retry or recovery state once, a relevant next step, and when the problem opened. Generic monitoring, check-limit, readiness and no-impact rows do not repeat the brief. Source details without an open problem retain the readable monitoring and evidence summary. Problem details show Pause alerts directly, without a management disclosure. It applies only to the selected episode using the existing shelving contract; other problems on the same equipment are unaffected. Equipment maintenance is available directly from source details without an episode. Active direct-target shelves/maintenance retain a compact visible expiry notice. Maintenance offers explicit short duration choices or a custom end time, defaults to the selected equipment, and saves directly after validating the form. The form explains the selected scope and effect on already-open problems; it never calls a quiet window a repair. One collapsed Technical details section contains filtered logs, timestamped reported errors and Copy diagnostic data. The internal-identifier warning sits with the copy action. Complete raw query/policy data remain available through View raw data inside that section. Clipboard failures explain how to copy from the raw view manually. Open disclosures survive live updates. Every frontend module URL is versioned together for release cache invalidation; an already-open app must still refresh after installation.

Overview shows the number of open Homeostatic episodes, including Home Assistant Repairs, notification state, and the newest issues. Issues links each one to its source, or for a Repair to its automation or the Repairs page. Sources and Explore use Home Assistant registries to browse current monitoring evidence. Function definitions and external capabilities do not appear in these views.

Coverage leads with watched, evidence-gap, excluded and other-discovered counts. Its evidence-review preview renders at most 20 sources and directs the owner to search when more exist. It groups the current model by integration, Home Assistant device and capability; groups containing gaps open automatically while healthy groups remain collapsed. A registry device is only a Home Assistant grouping and is not presented as proof of physical hardware. Disabled, no-check, never-observed and stale evidence each receive specific guidance and current availability evidence. Area references are secondary location detail and create no monitoring or dependency meaning. Technical attach/exclude provenance remains collapsed. Search evaluates the complete discovered inventory but renders at most the first 50 matches, so unselected candidates remain available without creating unbounded DOM work. Excluded and other-discovered sources are summarized outside the current model rather than listed by default. The Coverage view has no self-link and does not expose notification routes or operator-control JSON.

History presents persisted ended problems with twenty per page. Search matches the retained source name or episode label, identity and findings; filtering distinguishes clearing, removal from monitoring and absorption. The page uses one History heading and an Ended problems list. When a source has gone, its saved episode label supplies the list and detail title; a raw node id is not used as a display name. Details lead with the observed condition and outcome in plain language. A cleared device availability finding says Home Assistant reported an availability problem for the device, without asserting that the whole device was offline, identifying its physical cause, or implying a repair. A removal means monitoring stopped without observed recovery. Finding text appears in the explanation when it adds specific information; a second original-finding disclosure does not repeat it. Details show a compact observed start-to-end time range and approximate duration; these are Homeostatic observation times, not physical device event times. Absorbed entries link to an open or retained absorbing episode only when available. An absent history field is explicitly unavailable; an empty history states when collection began and its retention limits. No earlier history is reconstructed. The last-50 runtime enrollment log remains diagnostic data and is not displayed on History.

Client disconnect/error replaces any current-status claim with an explicit unavailable/stale message. Reconnection waits for a fresh subscribed snapshot. An open detail view refreshes against updates, and removed/resolved selections are identified rather than left as current problems. Frontend content treats names, findings and reasons as text, including when creating links to native HA configuration. Cards share one subscription per HA connection while mounted and release it when the last card is removed. When embedded with navigation tabs hidden, a drill-down to another page offers a return button to the card's configured view; selecting an already-active HA dashboard tab is not required to reset the card.

## Attention and persistence

Notifications default to off. The integration emits `homeostatic_notification` events for policy deliveries. Selected `phone:<HA device registry id>` and `notify:<HA entity registry id>` channels also request delivery through Home Assistant notification actions. Other channel ids remain consumer-owned; the optional automation blueprint continues to use the event. Persistent notifications are reserved for failures of Homeostatic itself. Delivery means requested, never received or read.

The stored `policy` data defines a timezone, named recipients with opaque channels and optional daily quiet hours, named daily digests, and ordered rules. Match fields are status, effective importance, reason, category, labels, minimum episode age, and due-within duration. Each reason uses its first matching rule; the library chooses the loudest result. Rules choose record, digest, notify, or urgent, destinations, optional reminders and one-step escalation. Durations accept nonnegative integer seconds or ordered `d`, `h`, `m`, `s` strings; reminders must be positive. Clock times are quoted `HH:MM` strings in an IANA timezone. Unknown keys, invalid enum values, empty channels, duplicate destinations and undefined names fail before saving. The default retains owner/event routing, critical urgent and other notify behavior. Presence-dependent recipients and acknowledgment are not implemented.

The legacy notification configuration requires either an enabled consumer automation or a selected built-in phone or notify-entity route. Its administrator-only editor lists linked Home Assistant people and their registered phones, plus notify entities. It offers simple levels, destinations and quiet hours, generates ordered policy rules in the existing `policy` option, and validates the exact draft when Save changes is selected. A generated policy carries a version and content hash. Switching from the legacy automation route to simple person delivery requires clearing that automation in the same save, so its route is not silently replaced. An edited custom YAML policy stays read-only in the simple editor until the owner explicitly chooses and saves a reset. The UI exposes delivery tests only within saved reusable methods. Retained route-test APIs are administrator-only and request a fixed message without creating an episode, changing policy clocks or enabling notifications; no standalone destination-test area is shown. Test results describe requests, never receipt. Built-in Companion delivery supports an explicit Acknowledge action for eligible individual issues. Reusable delivery methods are specified below.

On activation, the integration asks the library to restart attention for current open episodes after reconciling current observations. Episode history and age matches remain unchanged. Escalation starts at activation; reminders start with the first delivery request. Initial deliveries are combined per recipient into summaries as their batch/quiet-hour/shelf deadlines allow. Urgent and delayed recipients can receive summaries at different times. Digest-only problems wait for their named digest, and record-only problems produce no event. An empty activation produces no problem notification. Subsequent deliveries are live. Ordinary reload restores clocks without replaying openings. Changing a legacy policy or batch settings while enabled withdraws previous requests and activates under the new configuration, so removed routes cannot retain active messages. Reusable notification definitions restart only changed routes; name-only edits retain their clocks and delivered state. Built-in phone routes process withdrawal requests even when outgoing requests are off and clear the previous tag; optional event consumers receive the same withdrawal event.

Events include opaque channels and distinguish open, update, remind, escalate, resolve, summary, and digest actions. Identical reminders are still emitted; silent identical replacements are deduplicated. A digest groups library deliveries for the same digest and recipient into one request. Group summaries retain per-episode membership; a resolution refreshes the remaining group silently, and the last resolution clears its tag. A later individual reminder or escalation moves that episode out of its summary. Stable tags include recipient identity, with the original owner tag retained for compatibility. See [events.md](events.md).

`policy` returns public library explanations for current episodes. `preview_policy` validates an unsaved policy and restores an isolated copy through the opaque public snapshot API, then simulates activation at the current time. It returns initial delivery requests, evaluated rules, recipients, pending times and the next deadline, without saving or sending, including while notifications are off. It is an activation preview, not a forecast of future evidence. The panel validates policy changes during Save changes. The read-only preview API does not impose a separate UI step. Physical receipt remains outside the request contract.

A Home Assistant start holds notification requests until watched integrations have finished loading (at least the startup grace, at most `startup_quiet_max`), then publishes one startup summary per recipient for alerting requests made meanwhile. See [events.md](events.md#restart-and-activation). Reloading the integration while HA runs has no hold.

Persist engine state, policy state, episode presentation, last requested messages, delivery attempts, and a delivery outbox in a versioned HA Store. Restore policy before feeding engine restore events. Reconcile current observations before releasing pending openings; cancel an unsent opening when its episode has resolved. Save before firing events and save the cleared outbox afterwards. A crash between emission and acknowledgement can replay the same delivery id: delivery is at least once. The built-in sender saves one attempt per delivery id and channel before calling the HA service, so a plain message is not repeated after replay; this can lose a message if the process stops after the attempt is saved and before the service call. Phone requests use a stable tag for replacement. At the built-in phone sender and Companion blueprint boundaries, tags exceeding 64 UTF-8 bytes become the lowercase SHA-256 hexadecimal digest of the complete tag. Shorter tags remain unchanged. Opening, updating and clearing use the same transformation, preserving recipient separation and Apple APNs collapse-id limits. Public event tags and persisted delivery identity remain unchanged. HA mobile-app services can log provider errors without raising them; absence of a caught service error does not prove provider acceptance. Event consumers must replace by tag or deduplicate by delivery id. Event publication and a successful service call are not acknowledgements of receipt.

Use atomic Store writes and read-back verification because Store can log a write failure without raising. Invalid snapshots remain visible failures and must not silently discard history. Native invalid-JSON handling remains with HA and its storage-corruption Repair. The original development envelope is migrated without inventing new episode identities; obsolete native episode notifications are dismissed after a successful save.

Unload and shutdown cancel all callbacks, drain captured observations, and attempt a final save. A failed final save leaves the last durable snapshot and creates a visible Homeostatic storage error; cleanup still completes so there is no stopped runtime registered as a failed unload. A platform refusal to unload keeps monitoring running. Work already saving cannot create a new timer after shutdown starts.

Phone destination choices group a Companion phone route and its mobile-app notify entity by their shared HA device registry identity, never by display name. Each device appears once per person. Existing selected route ids remain unchanged on viewing; a selected notify-entity route remains selected and usable. A new choice prefers the Companion phone route. Clearing a phone removes all selected aliases for that device in the draft; selecting it again chooses one route. Distinct device registrations remain separate even when their names match. Other notify entities remain independent destinations. These presentation changes do not edit HA registrations or send messages.

## Detected facts

Homeostatic publishes `homeostatic_episode` and `homeostatic_control` events for every opened, meaningfully updated and resolved episode and every operator control start and end, independent of notification settings ([ADR 0014](adr/0014-publish-detected-facts-for-owner-automations.md)). Facts publish after the durable save and before notification requests from the same change, at most once, without replay on reload. Readiness sensors are enum sensors. Function event entities are dormant. [events.md](events.md#detected-facts-for-owner-automations) is the payload contract.

## Recently resolved problems

Sources History explains each related open or retained ended problem with its source name, recorded finding, outcome, opening time, and (for ended problems) observed resolution time and recorded duration. Entries sort newest first by opening or observed resolution time. It uses the shared clearing, monitoring-ended, and absorption labels without repeating the clearing outcome in a second sentence; removal and absorption never imply recovery. Retained names and findings remain historical even when current source names or states change. Missing findings and unavailable history are explicit. The view states the retention limits and observation-time boundary and opens the existing problem or history details.

The read-only `resolved_history` action and additive `inventory.resolved_history` field return `{started_at, retention, episodes}`. `retention` contains `max_episodes: 100` and `max_age_days: 30`. Entries are newest resolution first. The adapter keeps only the latest 100 terminal episodes whose resolution was observed less than 30 days ago; expiry is applied to queries immediately and to persistence at reconciliation. This is bounded terminal history, not a full transition, configuration, operator-action or delivery journal.

Each entry contains `episode` (the public serialized library Episode, retaining its stable id, original opening time, findings and display labels), `resolved_at` (UTC ISO), `resolution` (`cleared`, `removed` or `absorbed`), `absorbed_into` (episode id or null), and `source` (a `{node_id, name, kind}` display snapshot or null if the source no longer exists). Episode findings/status describe the last episode evidence, not a current health claim. Source display text can fall back to the episode's labels when no current source exists. A rename or later fault does not rewrite an earlier history entry.

Only a library `EpisodeResolved` event creates an entry. Unknown evidence, shelving, maintenance and notification disablement are not resolutions. `cleared` records the library's recovery decision; `removed` records the end of monitoring, not recovery; `absorbed` links to the absorbing episode, which may remain open or later fall outside retention. Resolution time is when the adapter handles the event. After downtime it does not claim when the physical problem ended. A problem that clears before any notification was requested still appears in history.

History is saved in the same atomic, verified envelope as engine/policy state and the outbox. Restore loads it before handling engine restore events. Duplicate episode ids are not appended on replay. Malformed stored history fails setup visibly and leaves the stored envelope intact. Older envelopes with no history field start an empty history at their first running evaluation; `started_at` identifies when collection began, without reconstructing earlier resolutions. Read responses are detached, produce no notifications and do not advance the engine or policy. Removing the Homeostatic entry deletes history with the rest of its owned storage. Existing `inventory.episodes` remains the open-episode list.

## Dormant functions and existing situations

Function definitions remain stored but are inactive in production ([ADR 0039](adr/0039-mothball-functions-and-native-options.md)). Their graph nodes, readiness, importance effects, entities, previews and suggestions are not published. Internal code remains available for a future design. Existing function entity registry entries are disabled by the integration. New installations have no function setup path or native Configure form.

A situation has its own immutable `id`, name, importance, and one bound entity. `on` means active/fail, `off` means clear/pass. Missing, disabled, restored, unavailable, unknown, or unexpected states mean unknown. Unknown never clears an open situation. The situation has no dependency edges and is excluded from readiness targets and function requirements. HealthTree owns its episode and policy lifecycle. Situation checks use zero raise/clear holds, an explicit `ttl: null`, and the configured unknown hold.

The owner supplies condition logic in Home Assistant. Its template/helper must expose source loss as unavailable, not off. Setup documentation and inventory expose this unverified availability contract. Automatic template inspection is not implemented. Equipment maintenance must never use the global quiet scope or suppress situations; operator actions below use only scoped windows.

## Operator controls

`homeostatic.shelve` holds new alerts for one current episode until an explicit time. It applies to every recipient, including urgent alerts, reminders and escalations; it does not acknowledge or resolve the problem. Existing messages remain visible, and the library may update them silently or clear them on resolution. Pending library deliveries remain subject to their other holds. A shelf can be extended or ended early with the explicit cancel-control action. Situation episodes can be explicitly shelved by their own episode id.

`homeostatic.start_maintenance` creates an engine quiet window for one equipment capability (`entity`, `integration`, or `external`), optionally including its dependency-graph dependents. No global scope is exposed. `preview_maintenance` returns the current scope, already-open episode ids without changing anything. The start action recomputes and returns the scope applied. Dependents follow the graph as it changes during the window. Situations have no edges to or from equipment; both graph validation and maintenance scope validation enforce their separation. Situation roots and any scope containing a situation are rejected.

Maintenance prevents new episodes in scope. It keeps observations, readiness, existing episodes and their alerts active. A continuing fault opens after expiry subject to the library's normal rules; a fault that recovers inside the window produces no later episode. Shelving an existing episode is a separate explicit action.

Both mutations require HA administrator access when called with a user context; HA-owned automations without a user context follow HA's standard admin-service authorization. Both accept `until` as an ISO timestamp with a timezone, normalized to UTC, strictly in the future and at most seven days away. There is no default expiry. Optional `reason` is at most 500 characters. Actions serialize with observation processing, reconcile captured evidence first, and persist before returning success or publishing resulting notification requests. Requests already authorized in the durable outbox retain their replay identity; controls do not retract previously authorized events. A storage failure returns an error and makes monitoring unavailable until persistence recovers; an errored request may remain in memory or on disk, so inspect controls after recovery before retrying.

`operator_controls` and inventory list active requested controls with a generated id, target, start/expiry, actor user id (null for system context), reason and dependent-scope flag. This presentation is persisted separately from opaque library snapshots. Expired controls, shelves for resolved episodes and maintenance for removed nodes are removed. Deadline scheduling includes control expiry, even when no alert is due. Reload restores the library's holds and the adapter's control records together. These are current controls, not a permanent audit history. Early cancellation and acknowledgment use the actions defined above.

The dashboard offers shelving from an open episode and maintenance from an equipment node. Sources exposes maintenance for eligible integration and entity checks. Each form requires an explicit local end date/time, converts it to zoned UTC, and allows an optional reason of at most 500 characters. Shelving explains that it holds new alerts for every recipient, including urgent alerts, without resolving the problem or removing existing messages. Equipment maintenance defaults to the selected node only; including graph dependents is an explicit choice. The form saves directly after validating scope and expiry, with no Review action or preview screen. The start service remains authoritative and recomputes its scope; the returned applied scope is shown on success. Read-only maintenance previews remain available to API callers. Situations never offer maintenance as a root.

Live updates preserve form values. A disconnected, unavailable or non-admin view cannot submit; a resolved shelf target or removed maintenance target cannot submit. Duplicate clicks while a request is pending cannot send duplicate actions. There is no automatic retry after an ambiguous action failure: the form asks the owner to inspect active controls after recovery. Successful actions show the returned saved control, expiry and reason. Active controls are readable on overview and in node/problem details; eligible problems offer Acknowledge, and current temporary controls offer End now. Controls and history use existing schema-version-1 fields and native service responses without adding another runtime update path.

## Acceptance scenarios

Tests use real Home Assistant helpers and the real health-tree engine. They cover one-step setup, singleton setup, startup deferral, failure/notification/recovery, dependency correlation, startup/restored unknowns, setup retry escalation, missing sources, stable entity rename, enrollment changes, notification disablement, service validation, unload cleanup, corruption, and restart without a duplicate episode, captured transitions during storage, retry cycles, storage-error cleanup, functions, situation unknown/recovery, consumer events, every catalog match field, order-independent exclusions, future enrollment, registry moves, missing enrolled identities across reload, disabled devices, read-only service previews, function graphs and cycles, external and draft unknowns, persisted automation decisions, static target expansion, owned-entity exclusion gaps, isolated function previews, policy validation and previews, quiet-hour reminders, activation clocks, repeated reminders, restart escalation, digest membership, removed notification routes and consumer channel filters, admin authorization, bounded controls, maintenance scope previews, situation isolation, shelf/reminder expiry, reload, concurrent observations and failed control persistence, durable bounded resolution history, replay deduplication, removal/absorption distinctions, delayed recovery observation and corruption rejection. Tests advance time explicitly. Real-house traces remain a release gate.

## Development dependency

The integration manifest and project dependency pin the same published health-tree version; the current version is recorded in those files and checked during release packaging. Home Assistant installs the manifest requirement through its normal dependency mechanism. The reproducible manual-install archive includes dashboard assets and build identity, without a sibling library checkout. Home Assistant 2026.9.3 is the tested baseline. See [Install and first run](install.md) for deployment and the [roadmap](roadmap.md) for remaining large-installation qualification.

## HA registry references

The integration uses the public automation-reference helpers in the [pinned HA automation component](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/automation/__init__.py) for suggestions, and Home Assistant's [entity registry](https://developers.home-assistant.io/docs/entity_registry_index/) and [device registry](https://developers.home-assistant.io/docs/device_registry_index/) interfaces for identity and metadata. Runtime contracts are tested against the pinned Home Assistant version above; registry associations do not imply physical-device health.

## Dashboard behavior

The dashboard follows [ADR 0019](adr/0019-accepted-dashboard-baseline.md) and the later Sources, Notifications, and Settings decisions.

- Overview shows open issues, notification activation and up to three newest Homeostatic episodes. Active Home Assistant automation validation and missing-action Repair errors also appear in the issue list.
- Issues has one heading and an explicit sort choice: oldest, newest, device name, or configured importance. Discovered sources default to normal importance; the interface does not imply inferred urgency. Existing problem actions remain available.
- Source uses supported HA observations and useful next actions. A missing observation is reported as unknown, never silently presented as healthy. Ordinary views omit raw node IDs and empty technical disclosures. Device evidence shows actual selected HA entities and their current states, with full evidence available on demand.
- In the legacy rule-based model, Source Settings shows monitoring choices immediately. Integration connection monitoring and device defaults are separate. Defaults apply to current and future devices, including devices belonging to subsequently added connections of that family. Device overrides and ordinary exclusions retain their precedence. Existing enrollment is unchanged until an administrator saves a change; no Eero-specific exception or automatic migration is introduced.
- In that legacy editor, an integration-wide off choice precedes those narrower controls. It excludes current and future connection, device-summary, and separately monitored entity checks across the integration family, including exact device watches. Narrower choices remain saved and resume when the owner removes the off choice. Save validates the affected scope ([ADR 0020](adr/0020-integration-monitoring-master-control.md)).
- Catalog rules accept `integration_domain` alongside the existing stable instance matcher. Sources expose their associated integration domains. An overridable exclusion is permitted only for device defaults matched by `integration` or `integration_domain` plus `kind: device`. Exact device attachment can defeat that default; every ordinary exclusion still wins.
- The main navigation is Overview, Issues, Sources, Policies, Notifications, Settings and History. Policies holds the installation-wide monitoring catalog. Settings contains Timing and Problem grouping. The Notifications page guides person destinations and activation. Saved consumer automations remain in stored options; saving built-in person delivery clears that route.
- Administrator-only `homeostatic/source` reads a discovered source without enrolling it. It returns current HA readings (up to 50, with complete availability counts), captured monitoring context when present, and the observation timestamp. Missing observations remain explicit; browsing cannot create checks, episodes, or delivery.
- A previously selected notification automation remains saved until explicitly saved built-in delivery setup replaces it. The native Configure path is unavailable.

- `configuration` returns editable settings in addition to existing rules/alerts. Administrator-only `preview_settings` and `save_settings` accept the supported settings object and saved revision. Preview changes no live state or delivery. Save validates the exact payload, serializes with other saves, rejects stale revisions, reloads, and restores previous options on reload failure. The UI performs any required internal preview/token exchange within one Save changes action. Changing notification settings does not prove delivery. Enabling notifications or changing an active consumer requires the selected automation to be enabled.

Acceptance covers integration-family grouping with multiple connections, future matching devices and individual exceptions, separate mobile navigation, full-inventory search, live-update scroll retention, clean Overview/Issues, timing edits across sections, exact-preview validation, stale saves, invalid settings, preservation of unrelated options, and reload rollback. Tests use synthetic data or an isolated HA instance and send no live notifications.

## Integration settings presentation and saving

The source-level monitoring and reporting controls in this section describe the older rule-based configuration. Unified policies use the Policies editor and its notification entries. Exact-payload validation, revision, save-lock and rollback guarantees apply to both models. ADR 0059 supersedes the separate review workflow.

Integration Settings leads with one monitoring on/off control, then **What to
monitor** and **When to notify**. Show actual saved connection/device monitoring
counts before exposing choices through Change. Label those counts as current;
unsaved policy choices are separate and their effective result comes from the
server preview. Following policies, explicit watches, individual exclusions and
multiple direct policies remain distinct. Turning the integration off retains
narrower choices and hides their editors. A saved broad exclusion must never be
presented as overridden by an individual watch.

Reporting shows current device preference counts, check-specific exceptions with
source names, and household notification activation. Before reporting setup,
show that existing notification policy remains active rather than presenting
prospective defaults as saved preferences. Bulk edits affect only the listed
current device summaries; future devices use the household default. Device
monitoring defaults still cover future matching devices. Reading or expanding
settings changes no draft, monitoring, or notification state.

One Save changes action applies the full pending monitoring and installation-settings draft, including edits made elsewhere. `preview_settings` and `save_settings` accept optional `rules` inside `settings`; validation normalizes these rules and saves both through the revision check, save lock, single reload and whole-options rollback. Read-only preview APIs remain available for callers that need enrollment or policy information, and any required internal token exchange stays behind Save. No review dialog or preview button is required.

Save captures the exact complete proposal so edits made while validation is running cannot reuse a token for different content. Conflicts and errors retain pending edits with an actionable explanation. Save and discard cover the full proposal; notification activation is never implicit.

## Reusable monitoring and notification definitions

Fresh setup uses `monitoring_policy_version: 1` and one list of ordinary policies. Each has a stable id, name, immutable monitoring type, supported source selection and detection parameters, enabled state and zero or more notification entries. Supplied policies have the same lifecycle as user-created policies. Duplication gives the copy a new id and starts it disabled. Deletion is allowed; only explicit selective restoration recreates a missing supplied policy. Software updates and normal reloads preserve edits and deletions.

Integration, device and entity availability, Repairs and broken automations start enabled. Battery and vacuum policies start disabled. Temperature limits, thermostat deviation and UPS conditions are templates requiring source/settings selection. Every supplied policy has zero notification entries, and global notification sending is off. Monitoring therefore produces dashboard issues without unsolicited notification requests. Restoring a default does not enable sending.

Monitoring type determines the available selectors and parameters. Supported selectors include all eligible sources, selected sources, areas and labels; values within an area or label selection match any selected value. Integration sources lack area and label attributes, so those selectors are not offered for them. Matching groups include future eligible sources. Selected integrations use integration domain/family identity, displayed with the integration name, and include every current and future configured connection of that family. Account and phone names may supply context but are not separate integration choices. Existing connection-specific selections must not silently broaden to a family during reading or saving unrelated edits. Picker labels, headings and help name the selected type, such as Choose integrations, Choose devices or Choose entities. Repairs always covers all Repairs and Broken automations always covers all automations; their editors use explanatory text and omit the single-choice Watch dropdown and generic condition filler. Temperature policies select climate entities or temperature-class sensors. Configurable battery thresholds and independently evaluated overlaps are part of this model. Deliberately overlapping policies, including generic battery and UPS reserve policies, require no conflict wizard or ownership transfer; findings identify their policy.

Names and notification edits preserve detection identity. Changes to detection settings or source selection end the previous expectation and begin qualification for its replacement. Removed expectations end as monitoring removed, never observed recovery. Independent policies retain their own findings and notification choices even when dependency grouping organizes their issues. Unsupported thermostat modes remove the applicable expectation; later heat, cool or heat_cool evidence re-enrolls it. Producer-specific evidence and restart boundaries remain in effect.

Each notification entry stores `id`, `timing` and a nonempty `methods` list. Timing is local to that entry: `mode: immediate`; `mode: acknowledge` with a positive `remind_every`; or `mode: report` with one `at` time in HH:MM format and nonempty distinct `weekdays` numbered Monday 0 through Sunday 6. The editor presents immediate delivery with optional reminders, or a scheduled summary. Immediate delivery includes overnight. Reports use the configured IANA time zone. UPS reserve entries also select `when: mains` or `when: backup`. Entry ids are stable across edits, ordering and restart. A saved schedule library and schedule-name references are invalid in this schema.

One policy may contain several entries, each selecting several methods. Changing one entry's timing affects only that entry. Zero entries means dashboard-only monitoring. Notifications owns reusable named delivery methods and global activation, labeled Enable notifications. Monitoring continues when notifications are off. Send test appears only in the editor of a saved unchanged method; there is no separate test area or global destination list. A method contains selected Home Assistant destinations and optional presence selection; its transport and presence behavior is described in the notification event contract. Fixed methods can combine phone, notify-entity, Assist announcement, TTS and configured SMS action targets. Optional integrations are not runtime package dependencies.

The delivery editor starts with a name, the destinations selected for that method and Add destination. New unsaved methods do not appear as saved list entries beside their editor. Add destination first selects a supported delivery type, then a searchable destination list with friendly names and area context where available. Generic notification entities/actions have no inferred email or SMS capability. Only a verified SMS provider offers recipient-number fields; an unclassified notification route remains generic. Speaker selection precedes an optional speech-provider choice; do not display every provider/player combination as its own row. Available targets must meet the transport's capability requirements. Unavailable saved targets remain visible for repair; new-selection lists hide unavailable targets by default. Optional presence controls are collapsed until requested.

Each entry compiles to an opaque health-tree attention route and its own report group. Several routes can independently report the same issue. Acknowledgment is issue-scoped and stops acknowledgment-dependent reminders; scheduled summaries continue to include eligible open issues, including acknowledged ones. Reports omit resolved problems and empty messages. Temperature unknown-evidence findings do not send another availability warning. Message keys, replacement tags and report groups preserve entry identity; controls remain issue-scoped. Delivery requests remain requests, not proof of delivery.

All edits use one complete draft and a single Save changes action with administrator authorization, exact-payload validation, revision check, save lock and reload/rollback protection. Shared-method uses remain visible as context. Reading, editing and internal validation send nothing. A concise deletion confirmation may identify affected uses without introducing a general review workflow. A referenced method can be deleted only after its entries are removed or changed to valid methods in the same save. Renaming preserves references. Timing and destination edits apply to open issues on save: superseded requests are withdrawn where supported and changed reporting is activated. Immediate reporting can notify again; reports wait for their scheduled occurrence. A name-only edit does not activate reporting again.

Existing configurations are not automatically converted or reset on upgrade. This testing redesign requires no migration implementation; fresh setup is the supported way to try the unified model. Older saved schedule-library definitions are not accepted by the new inline timing validator. Retained legacy helpers and rule-based runtime paths do not constitute a promise that every earlier test configuration can run unchanged. Normal save, reload and restart of the new model must preserve its policies and runtime state. The implementation must never silently erase settings to obtain a fresh setup.

The adapter uses the independent attention-route API in its pinned published health-tree dependency. No change to the library's generic scheduling model is required.

### Legacy reporting configuration

The following contract applies to retained reporting-v1 configurations and helpers. It does not supply defaults or source-override controls for the unified policy editor.

Generated reporting-v1 policies provide Immediate, Immediate with acknowledgment,
Morning, Evening, Weekly and Dashboard only. Both immediate profiles bypass quiet
hours. Acknowledgment repeats every 30 minutes until acknowledged or resolved.
Weekly is the household default, Sunday 09:00; morning is 08:00 and evening 18:00.
A vacuum error on a generated policy uses Immediate unless that source has its
own preference; the fallback is applied when the policy is compiled and is not
stored in the generated rules. Custom policies are unchanged.
Requests stay off until explicitly enabled and saved. Profiles select people explicitly.
Reports include new and ongoing open problems only, no empty or resolved messages.
Device assignments and supported-check exceptions use affected-node matching;
explicit conflicts favor acknowledgment, immediate, morning, evening, weekly,
then dashboard. Existing custom policies are preserved until an explicitly saved replacement.
Overview provides read-only reporting readiness and provisional next-report counts.
Configuration uses one generated policy with integrity hash and existing guarded
preview/save revision checks. Bulk device defaults preserve condition exceptions.

### Settings scope and initial reporting setup (ADR 0028)

This section records the retained legacy reporting setup; fresh setup follows the unified policy and delivery-method model above.

Source Settings shows scoped monitoring choices and reporting assignments. It
does not embed the installation-wide catalog editor. Policies holds that
editor and its Save changes action; multiple direct source policies
link there. Timing and Problem grouping remain in Settings.

The legacy reporting editor shows fixed reporting types, schedules, people, destinations,
household defaults, and activation. When reporting choices have not been saved,
the page displays defaults and explains the pending setup; it does not render the
retired person-level editor or require a setup/reset action to reveal controls.
Source assignment controls are also visible before initial setup. Reading these
pages leaves saved settings and drafts untouched. The first edit creates a reporting draft with requests off, carries over known
person destinations, and clears any previous consumer in the draft. Save validates and replaces the previous policy only when explicitly requested. Timing-only edits do not
stage a reporting replacement. Browser scenarios cover global/source separation,
old-policy visibility, retained drafts, and exact-payload saves.

## Automation-reported situations (ADR 0032)

A situation declares either an `entity` or a `report_timeout` integer from 60 to
86400 seconds, never both. The latter accepts the administrator action
`homeostatic.report_situation` with its configured `situation_id` and `state`
(`active`, `clear`, `unknown`). HA automations without a user context use the
normal administrator-service convention. Reports never create configuration.
Only one automation should own each id; calls are applied in serialized arrival
order using adapter UTC acceptance time. Retrying the same state retains the
episode and refreshes evidence; it is not a new occurrence.

The existing condition check uses report_timeout as its TTL. Reports map to
fail/pass/unknown; expiration never resolves an open episode. The normal
unknown_hold then governs stale attention. Ordinary reconciliation never renews
a report. Every setup/reload requires a fresh report: a restored open episode
retains its identity and receives unknown before current reports arrive.
The source is edgeless, excluded from readiness, and protected from equipment
maintenance, like an entity-bound situation.

Actions use the same serialized persistence-before-publication path as operator
controls. Storage failure returns an error, publishes no new delivery, and marks
monitoring unavailable; inspect state after recovery before retrying. No separate
report store, lifecycle or notification bypass is introduced. Reports do not
enable notifications, create recipients, or prove delivery. One-shot informational
events are outside this increment.

The supplied automation blueprint checks all declared evidence entities, reports
unknown for missing/unknown/unavailable/restored evidence, otherwise evaluates
native HA conditions and reports active or clear. It reevaluates on source
changes, HA start, each minute, and optional owner triggers. Configure timeout
longer than this cadence. Disabling/removing the reporter causes expiry, never
clear. Conditions run inside the action sequence so a false result reports clear
rather than skipping the automation. Startup races retry on the next minute.
Owners must list every entity needed as evidence and use one reporter per id.
Conditions describe continuing states; trigger-specific event predicates require
an owner-maintained state source instead. HA owns timer/restart semantics.

Condition evaluation errors (such as nonnumeric temperature values) report unknown.
The blueprint checks both the positive condition and its explicit negation;
falling through an errored condition does not report clear.

## Notification tap destinations

Companion notification taps navigate without acknowledging, clearing or changing
monitoring (ADR 0033). Individual requests link to
`/homeostatic/episode/<percent-encoded episode id>`. Group summaries and digests
link to `/homeostatic/issues`; route tests open `/homeostatic/notifications`.
Both the built-in sender and shipped Companion blueprint provide iOS `url` and
Android `clickAction` using relative paths on the sending HA server. Notification
text, urgency, replacement identity and recipient choices remain independent.

The panel waits for current data before opening an individual issue. Open issues
show current detail and explicit acknowledgment controls. Ended issues open their
retained historical detail, preserving the distinction between recovery, removal
and absorption. Missing/expired history is stated explicitly with links to Issues
and History; absence never asserts recovery. A detail already open when its issue
ends follows the same history behavior. Disconnection shows unavailable evidence.
Malformed destinations fall back to Issues. Existing HA authentication and admin
authorization still apply; the link grants no access. Tapping does not acknowledge.

## Automation-owned alerts and Companion acknowledgment (ADR 0034)

`report_alert` accepts a saved HA automation entity, optional stable alert_key
(default `default`), name, rendered message, profile, active/clear/unknown state,
and report_timeout (default 300 seconds). First valid reports register a durable
source without separate YAML. HA registry unique_id plus alert_key identifies the
condition; changes to entity id, alias, text or profile preserve identity. Duplicate
automations have different unique_ids. Reports remain administrator services;
HA-owned automation calls use HA's existing service authorization convention.

Registration and its observation use the existing serialized snapshot transaction.
Invalid inputs mutate nothing. Storage failures publish no new delivery and mark
the runtime unavailable until a durable retry. Registration does not enable requests.
Outgoing profiles require existing generated reporting settings; missing profile
destinations record the issue without fallback and return a visible status. Dashboard
only requires no recipient configuration. Sources links to the owning automation
and shows its profile without a second editable assignment. Metadata updates occur
on the next report; report text is limited to 2000 characters and names to 200.

Active registrations are capped at 1000 per installation; retired records do not use
that capacity. `manage_alert` explicitly retires/resumes an owner/key. Retirement
removes monitoring (not recovery) and blocks refresh from re-enrolling it until
resumed. Disabling an automation alone expires evidence to unknown. When HA removes
the owning automation from its entity registry, reconciliation deletes its declaration
and ends any open issue as removed from monitoring. Optional administrator
`adopt_situation_id` transfers an existing report-only declaration to automation
ownership while preserving its node and episode; entity-bound declarations must
remain entity-bound. The old declaration is retained but shadowed, including while
retired. The old report_situation action rejects transferred identities.

Built-in phone delivery adds Acknowledge only to active individual episodes. Each
opaque callback reference is private to a delivery/recipient/phone/episode and
persisted before transport. One integration listener accepts only remote events
with HA-authenticated, active user context matching the current phone owner and a
still-permitted recipient route. Payload actor/device values grant no permission.
Intended recipients need no admin role for this narrowly scoped callback; existing
administrator services keep their authorization. References expire after 30 days,
are capped at 2000 (oldest evicted), and survive restart. Duplicate acknowledgments
are idempotent; old or ended episode callbacks cannot acknowledge a new occurrence.
Callbacks while delivery is disabled, or after a route is removed, do nothing.

Phone dismissal and clear requests are not acknowledgment or receipt. Main taps
retain ADR 0033 behavior. Summaries/resolution notices have no acknowledgment button.
Legacy event-only consumers retain their existing behavior; authenticated phone
actions are provided by the built-in person/phone sender. Evidence alone resolves
conditions. Tests use isolated HA and mocked phone transports.

### Dashboard connection guidance during updates

A subscription rejected because the backend does not accept the dashboard's
`paged` option is a version mismatch, not a health finding or proof of slow startup.
Show plain-language guidance to let any HA restart finish and refresh the page,
then check matching installed versions if it persists. Keep unrelated connection
errors distinguishable. An unavailable runtime without a reported error explains
that startup updates will appear automatically when monitoring becomes ready.
Neither message changes monitoring, retries mutations, or hides a stored error.
