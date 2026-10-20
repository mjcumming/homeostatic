# ADR 0108: Use category availability policies with focused source selection and configurable waits

**Status:** Accepted
**Date:** 2026-10-19

**Supersedes in part:** The fresh-install General/Important equipment split and identical qualification holds in [ADR 0099](0099-two-supplied-entity-availability-policies.md), and the corresponding fresh-install policy list in [ADR 0106](0106-enable-supplied-battery-and-vacuum-policies.md). Focused categories use flat source lists and new custom entity-availability policies start empty, refining [ADR 0103](0103-entity-availability-with-grouped-selection.md). Direct flat lists replace the other policy editors' inclusion radios and separate source pickers. Existing selections, entity evidence, independent overlap and affected-equipment notification assignments remain binding.

**Related decision:** [ADR 0107](0107-add-new-supplied-policies-disabled-on-upgrade.md) governs addition to existing installations, preservation of saved policies and deletion, and explicit restoration.

## Context

Equipment can warrant prompt attention while tolerating a brief interruption. A camera's short Wi-Fi outage may need no household response, while another category may justify reporting sooner. The Important equipment default groups cameras, locks, alarm panels and several detector types under one availability policy, making those different tolerances difficult to configure.

Category names make coverage clear and allow each category to choose a qualification wait and notification assignment. A newly created custom availability policy usually serves a focused purpose; starting with every eligible entity selected makes that task harder and can introduce unintended overlap.

General entity selection needs the integration and device hierarchy to find entries in a large inventory. Cameras, batteries and other focused equipment selections usually offer a short list. Giving those lists a tree or a separate scrolling picker adds work without helping the selection task. Policy names cannot determine the editor because owners can rename and duplicate them.

## Decision

### Supply a small set of category policies

Use the existing entity-availability check, displayed as **Unavailable entities**, for these ordinary editable policies:

| Supplied policy | Initial source scope | Initial named notification |
| --- | --- | --- |
| Cameras | Eligible operational entities in domain `camera` | Immediate |
| Locks | Eligible operational entities in domain `lock` | Immediate |
| Alarm panels | Eligible operational entities in domain `alarm_control_panel` | Immediate |
| Safety sensors | Eligible operational `binary_sensor` entities with device class `smoke`, `carbon_monoxide`, `gas` or `moisture` | Immediate |
| General entity availability | Other eligible operational entities outside those four category scopes | Morning summary |

Use independent saved metadata expressions, retaining future matching and explicit inclusion and exclusion overrides. The untouched supplied entity scopes are disjoint and cover all eligible operational entities, including entities without devices. General's complement is a saved expression; it never depends on another policy's existence, enabled state or current edits. Preserve disabled-source and diagnostic/configuration eligibility rules.

The new stable identities are `default_cameras`, `default_locks`, `default_alarm_panels` and `default_safety_sensors`, respectively. General retains `default_entities`. Reserve the retired `default_important_equipment` identity in the historical introduction baseline; never reuse it for a category or recreate it through addition tracking.

Retire Important equipment from fresh setup and the current supplied restoration catalog. Preserve any existing saved Important equipment policy in full. Existing General policies also retain their saved scope and assignments. Introduce the four new category identities on existing installations once, disabled, under ADR 0107. Fresh setup enables the category policies and General when their defaults are complete, preserving the other supplied monitoring and notification-sending safeguards.

An upgrade does not split, disable or remove the existing Important equipment policy or move its entities. Its current notification behavior continues until the owner edits it. Adoption uses the existing policy editors: configure and enable the desired categories and adjust overlapping existing coverage explicitly. No automatic winner, transfer wizard or cross-policy rewrite is introduced.

Further categories are justified when their detection or reporting needs differ. A supplied policy for every entity domain is outside this decision. Smoke/CO, gas and moisture availability can be separated later through ordinary custom policies if a household needs different settings.

### Choose the equipment category in the existing form

Keep the alphabetical **Monitoring type** menu. Display the existing entity-availability type as **Unavailable entities** and the existing entities-not-provided type as **Missing entities**. Internal check identities, saved policy names and detection meanings stay unchanged. Unavailability means Home Assistant reports an unavailable state; it does not prove that equipment is offline. Missing entities means a loaded integration does not provide a registered entity, including a missing state or restored placeholder; it does not measure reading age or establish that a registration is obsolete.

When **Unavailable entities** is selected, show **Source category** on the same Add policy form: **Any entity type**, **Cameras**, **Locks**, **Alarm panels** or **Safety sensors**. This choice narrows the candidate list without creating another monitoring type or navigation step. Other monitoring types already identify their eligible equipment and do not show the field.

Represent category selection through the existing saved `domain`, `device_class` and `match_any` selector metadata. Do not add a category configuration field or infer one from a name or policy identity. The editor displays the category as read-only beside the immutable monitoring type; source scope remains editable. Recognize only supported category expressions; unfamiliar compound scopes retain the general tree. Opening, renaming or duplicating a policy preserves its complete saved selector. Saved choices outside a recognized category remain visible and removable.

### Use a flat list when the equipment category is focused

General **Unavailable entities** and **Missing entities** keep the searchable integration → device → entity tree. The focused camera, lock, alarm-panel and safety-sensor categories use direct flat checkbox lists. Low battery, Vacuum error, Temperature limits, Thermostat progress, UPS and Integration availability use flat lists of their eligible sources as well. Layout follows the selection task and never switches because the source count crosses a threshold.

Checked always means monitored. Show recognizable names and location context, with search for longer lists. The policy editor owns these choices: use page scrolling and its existing **Save policy** action, with no inclusion radios, nested scrolling picker, Done action or manual pagination. Repairs and Broken automations retain their fixed scopes and explanations.

Flat lists keep saved scope and future inclusion explicit and editable in the source-selection group. They use a native **Future sources** select with **Do not include automatically**, **Include automatically**, **In selected areas** and **With selected labels** where supported; integration selection offers the first two. Area and label choices appear inline. Existing all-except scopes display automatic inclusion with excluded equipment unchecked, preserving their meaning without reversed checkbox semantics. Entity-availability lists retain positive membership overrides. Other equipment lists show sources allowed by the saved scope and saved exceptions, with individual exclusions; area or label choices broaden those scopes. Integration lists show configured connections, and exact choices retain connection identities. Existing `integration_domain` scopes continue to include future same-family connections. Changing an individual checkbox must not silently replace a future matching rule with today's exact list. Selecting every current source alone does not authorize future enrollment. Opening, searching and loading an incomplete catalog never changes scope or manufactures selections.

Remove the superseded radio and picker paths, handlers, styles and fixtures once their replacement is covered. Reuse existing selector and saving behavior; this presentation change adds no migration or runtime category behavior.

### Configure how long unavailability must last

Entity availability policies expose **Report unavailable after** in the existing **When it becomes a problem** group. The setting is a nonnegative whole-number duration, stored in seconds and displayed with appropriate units using the existing duration-control pattern. Zero preserves immediate qualification.

Each entity-availability policy owns its complete unavailability qualification setting. Show this control only in its policy editor, with its effective value in the policy summary. Do not add an installation-wide counterpart, inheritance choice or global fallback. This places the wait beside the sources it affects and lets cameras and locks use different tolerances through the same editor.

Before this change, entity availability used a fixed zero raise hold and Settings offered no configurable counterpart. Its other timing controls have distinct purposes: **Report setup problems after** concerns integration setup retries, **Wait for unknown evidence** concerns missing or uncertain evidence, and **Clear recovered issues after** concerns recovery. Those controls, startup waits and dependency coordination remain in Settings under this decision. Adding a policy's unavailability duration does not move or remove any of them.

The duration qualifies the availability issue before it opens or authorizes that policy's notification assignment. Continuous current unavailability must satisfy the configured interval. A return to an available state before qualification cancels the pending worsening; a later outage starts its own qualification. Missing or restored evidence cannot complete that interval or establish recovery. Existing unknown-evidence, startup, dependency, recovery and removal rules retain their meanings.

An absent duration on a previously saved entity-availability policy retains its existing zero raise hold. Do not rewrite existing policy records merely to insert a new default. Notification collection delays, reporting schedules, installation recovery waits and the Missing entities duration remain separately owned settings. This decision adds no new per-policy recovery control and does not alter integration availability detection.

Initial waits are five minutes for Cameras and zero for Locks, Alarm panels, Safety sensors and General entity availability. This gives intermittent camera reports time to settle while preserving the existing immediate qualification for other equipment. Every wait remains editable. Existing installations receive these waits only in the new disabled policies or through an explicit edit of an existing policy.

Homeostatic owns the policy setting, validation and mapping to public health-tree check configuration. health-tree owns qualification, deadlines, issue lifecycle, dependency grouping and attention. Positive waits use public `Check.raise_hold` with `Check.continuous` and gate affected equipment attention through `Match.qualified_nodes`; health-tree ADR 0043 defines those contracts and their preserving restore behavior. No adapter-owned qualification timer or snapshot query is permitted. Verify missing-evidence transitions, restart, detection edits and integration-issue absorption through adapter scenarios before release adoption.

### Start custom entity-availability policies empty

Add policy → Unavailable entities, with any source category, creates an unsaved disabled policy with zero selected entities and no automatic enrollment of future entities. Selecting a category alone never selects equipment. Selecting entities records an explicit scope. Saving zero selected entities remains valid. Loading inventory or adding a new entity must not manufacture selections.

Supplied category policies retain their category selectors, including future matching. Duplicate retains the original selections and detection settings in its independent disabled copy. Existing policies and other monitoring types retain their current creation behavior. Broader saved selectors remain supported when editing or duplicating them.

### Keep configuration in its existing workflow

Policies owns source selection, qualification waits and notification assignments. The existing editor explains the category's future scope and configured wait without another dialog or navigation step. Monitoring and source details expose actual contributing policies; the policy editor must make other enabled availability coverage understandable so a longer camera wait does not imply that every overlapping policy waits too. Reuse existing policy summaries and links, with no priority or conflict-resolution controls.

The supplied equipment categories monitor availability. Smoke, gas or water detection, a jammed lock and a triggered alarm remain separate conditions. An availability wait must never delay a separately configured condition alert. Existing shared integration issues retain each qualified affected-equipment assignment; category identity grants no special runtime behavior.

## Required verification

Before shipping, update the owning current specification, guide, events reference where affected, changelog and executable scenarios. Cover fresh disjoint scopes and future metadata changes; preserved existing General and Important equipment policies; disabled additions and repeat loads under ADR 0107; empty custom creation for every category, save/reopen and no future enrollment; category recognition after renaming and duplication; unfamiliar scopes and out-of-category saved choices; all, exact, area, label and all-except preservation; zero, invalid and nonzero durations; exact deadlines; brief and repeated outages; unknown and restored gaps; restart; detection edits; and independent overlapping waits.

Exercise confirmed integration failures in both observation orders, absorption before and after delivery, and later affected members. An assignment must not bypass its qualification or replay an opening because of grouping. Unrelated condition policies retain their existing timing. Test direct and optional event-consumer requests with isolated mocked services, including sending off and stable outbox replay identities.

Rendered review must cover the existing policy creation and editing paths, category summaries, flat and tree selection, effective checkbox meaning, future inclusion, area and label choices, overlap explanations, scoped save/discard, invalid input, keyboard operation and desktop/phone layouts. Confirm the category field, source controls and qualification control help the task in that editor and add no redundant navigation. Adoption of the required public library behavior must be verified before implementation acceptance. [Current work](../roadmap.md#current-work) records implementation and verification separately from this accepted decision.
