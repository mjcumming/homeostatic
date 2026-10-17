# Homeostatic product specification

Status: Accepted design baseline, October 14, 2026.

This specification consolidates the reviewed Open issues, Monitoring, monitoring-policy and notification workflows. It defines the intended experience and acceptance criteria. The [integration specification](spec.md) owns current behavior. [UI standards](ui-standards.md) owns interaction patterns, [policy and notification editors](policy-editors.md) owns form layout, and the [roadmap](roadmap.md#current-work) owns implementation and acceptance status. The [design decision](adr/0061-issues-first-product-workflows.md) records the approval boundary and earlier interface decisions it supersedes.

## Product purpose and audience

Homeostatic helps you run Home Assistant by identifying problems in monitored integrations, devices, entities and reported situations, and requesting notifications according to your policies. You should be able to understand a problem, act on it and determine what will happen with notifications without reconstructing the system's internal structure.

The initial redesign serves the administrator who configures monitoring and investigates issues. Notification recipients need understandable messages and useful destinations within their existing access permissions. Access for household members who are not administrators remains separate planned work. These are design roles, not findings from a usability study.

### Product scope

Homeostatic's core scope is operating Home Assistant and its connected equipment: integration, device and entity availability, reported faults and errors, Repairs, battery problems and broken configuration. Checks should help someone recognize a problem and decide what to do about it.

Additional built-in policy types must address common household monitoring needs with a reusable condition, understandable settings and credible evidence of both the problem and its recovery. Thermostat progress and temperature limits meet this test: inadequate heating or cooling, freeze risk and refrigeration warming are common concerns. These checks assess reported temperatures against configured expectations; Home Assistant does not have to report an explicit error first.

Review a proposed policy by asking: who needs to know, why does the condition matter, and what useful action could they take? Identify the common use across households, the evidence available and the setup burden. A condition being technically detectable is insufficient reason to add a policy type.

Specialized conditions, household-specific sequences and individual command-completion checks belong in Home Assistant automations. Verifying that a cover reached a commanded position is outside the built-in policy scope. A fault explicitly reported by that equipment remains a candidate for core monitoring. Automation authors own custom detection and recovery logic; the unfinished workflow for bringing their alerts into Homeostatic is tracked in the [roadmap](roadmap.md).

### User goals

| Goal | Successful outcome |
| --- | --- |
| Find what needs attention | Identify a concrete condition and its affected entities, devices, automations or other named sources from Open issues or a notification. |
| Understand the evidence | Distinguish the current Home Assistant report, the monitoring expectation and the issue that expectation created. |
| Understand coverage | Identify each check on a source, why it applies and the policy to change. |
| Understand notifications | Distinguish saved configuration from the evaluated notification behavior for an open issue. |
| Make a deliberate change | Predict its scope, save it once and see a confirmed result or a useful error. |
| Reduce unwanted attention | Adjust monitoring, timing, destinations or a temporary pause while understanding what continues. |
| Investigate earlier problems | Read retained outcomes without treating missing history as proof that nothing happened. |
| Keep your place | Move between an issue, source, policy and method, then return with context and drafts intact. |

These observable outcomes guide review. Establish which page or dialog owns the task before choosing its controls; other pages open that workflow with the relevant context. Reuse its action semantics while adapting controls to the task. Selection controls need a real choice, and grouping should establish relationships before individual rows gain extra labels. Every UI element, including headings, controls, sections, disclosures and navigation steps, must help someone understand useful information, make a decision or take an action. Apply the [UI purpose test](ui-standards.md#purpose-before-controls) before adding it and during rendered review. Internal grouping labels and counts do not earn space merely because the system tracks them. Explain an action's complete effect where the action is offered.

## Concepts and ownership

| Concept | Meaning in the interface | Owner |
| --- | --- | --- |
| Source | An identifiable integration, device, entity, automation or reported situation being inspected. | Home Assistant owns equipment identity and configuration; Homeostatic shows evidence and monitoring context. |
| Check | One monitoring assessment applied to a source. Several checks may use the same source. | Its policy, or the owning Home Assistant automation for automation-defined situations. |
| Issue | An engine-established problem with a stable identity, evidence, recorded members and lifecycle. | Issue details expose actions on that exact issue. |
| Investigation group | Related issues presented together to help locate and investigate problems. | View state; expanding or filtering it performs no monitoring or issue action. |
| Policy | A named definition of what to watch, what constitutes a problem and its notification assignments. | One policy editor and draft. |
| Notification | Reusable name, timing and delivery-method choices for eligible problems. | Notifications owns the shared definition; each policy owns its assignments. |
| Delivery method | A reusable destination choice, optionally including presence behavior. | Its shared editor and explicit save scope. |
| Global notification sending | Whether ordinary issue notification requests are enabled for the installation. | An independently applied operational control available throughout the interface. |

One actual source has one navigational identity. Its independent checks and policies appear inside its details. A second check must not produce a second apparent light or sensor. Policies may intentionally overlap; expose their contributions without silent merging or replacement. The accepted coverage and device-notification decision is recorded in [ADR 0064](adr/0064-monitoring-coverage-and-device-evidence.md). It owns monitoring eligibility and notification consolidation; this interface design owns presentation and editing.

## Issue identity and investigation groups

The Open issues page starts with integration groups, one indented heading per registry device and its findings underneath. One View at the device heading opens the shared device dialog; child rows explain the capability or check and its condition without separate popups. Registry connection ownership keeps a device's findings under the same integration. Only issues whose complete recorded source membership resolves to that single device enter its response set. Reported integration failures and issues with cross-device, standalone or unknown ownership retain their complete original view. An entity without a device stays directly reachable. Repairs, automations and situations retain their relevant groups. Integration summaries count affected devices separately from standalone entities, and device headings count distinct issues affecting that device. Search includes device names; pagination preserves one heading per device and makes partial sets explicit. Stop Monitoring belongs inside the opened issue. Equipment hierarchy answers where to investigate; policies explain why a source is watched and what notifications are configured.

A device summary can collect entity problems without creating a device issue. An integration group can contain device problems without creating an integration-outage issue. Opening an issue through another source or group reaches the same identity and action state. The engine determines actual correlation, dependency grouping and lifecycle; the interface does not merge issues merely to shorten the queue.

### Investigation paths

| Observed situation | Required presentation |
| --- | --- |
| One current issue on a known device | Open the device dialog with the specific condition and direct controls; no selection checkbox is needed. |
| Several issues on one device | Open the same device dialog with its current independently owned issues, all initially selected, and one response area. Keep each issue's condition, identity and state. No aggregate device issue is required. |
| Several device problems in one integration | Use an integration group, show its own reported condition separately and expose the affected devices and issues. |
| An established integration issue contains dependent findings | Show the integration's current evidence and complete recorded affected set; lead with its failure only when current evidence establishes one. Preserve independent issues alongside it. |
| An entity has no device | Place it directly under its known integration where useful; keep it searchable and reachable when ownership is unknown. |
| Broken automations, Repairs or other independent problems | Use a relevant named group with a direct path to each problem. Do not invent an equipment relationship. |

Even every monitored device becoming unavailable does not prove that the integration failed. Separate the integration's evidence, observed affected entities and devices, and potential dependency impact. Opened issues show affected names and conditions directly, grouped under their device where known. Keep short lists visible, including a single affected entity. A known entity name must remain recognizable even when it matches its device. Headline scope counts devices and entities without a device separately; device summaries and their entities must not inflate one source count. Counts of unique issues and independent checks retain their distinct meanings. Global totals count each issue identity once.

The issue list starts with collapsed, compact group summaries on an initial visit. Returning restores prior expansion; search and direct links reveal their target without requiring every branch to be opened. Opening an issue reveals its essential evidence, action scope and useful supporting information directly, without a Details expander. Preserve earlier recorded members and independent check contributions when they add information absent from the brief; their presence does not imply a current problem. Every advertised affected count leads to its complete set, with large sets bounded and reachable. Preserve selection, expansion and reading position during navigation and updates. Acknowledgment and notification pauses act only on the chosen issue identities in a collective view or the original issue in a singular view. Stop Monitoring remains a separate edit to reviewed availability policy exclusions.

### Recovery and monitoring boundaries

Display confirmed engine outcomes as findings recover, monitoring ends or issues regroup. An integration reporting loaded again does not establish that its members recovered. Outstanding member findings remain visible; genuine recovery confirmation follows the existing active-list rules. Keep the problem being read, its retained outcome and any recorded successor reachable as the active queue changes.

Stopping monitoring ends the monitoring expectation; it does not repair equipment. Stopping one policy's contribution preserves other policies and the current Home Assistant report. Re-enrollment follows the engine's qualification and identity rules. A new issue period does not silently inherit an earlier period's acknowledgment or pause.

The noisy eero case must distinguish missing evidence, current state values and entity unavailability. A connectivity sensor's current off value does not create an availability failure; diagnostic entities require explicit individual availability selection. Investigation leads to the responsible policy when an expectation needs adjustment. Grouping does not silently change that expectation. Changing correlation thresholds or lifecycle rules requires separate specification work.

## Navigation and page responsibilities

Open issues is the opening page. The primary destinations are Open issues, Monitoring, Policies, Notifications and History. The Policies tab opens the Monitoring policies page. Retained history has its own page and remains reachable from issue links and supported source-history routes. General configuration has a labelled Settings utility. There is no separate Overview destination.

| Destination | User task | Required information and actions |
| --- | --- | --- |
| Open issues | Find, understand and respond to problems | Investigation groups and a shared issue dialog with exact issue identity, evidence, action scope, acknowledgment, notification pauses, active controls and policy/notification access. |
| Monitoring | Understand source status and coverage | One source identity, current evidence, applicable checks and policies, related issues opening the shared issue dialog, contextual coverage editing and supported Home Assistant links. |
| Policies | Define monitoring and notification behavior | Supplied and user-created policies together; saved enabled state; scope, detection and notification summaries; add, edit, duplicate, enable/disable, delete and selective restoration. |
| Notifications | Configure named notifications and inspect their use | Reusable timing and delivery choices, saved policy assignments, destination methods, optional presence, saved-method tests and request outcomes. |
| History | Review ended problems | Recorded condition, outcome, time range, retention coverage and retained issue details. |
| Settings utility | Adjust installation-wide behavior | Supported general timing settings with their scope explained; no duplicate policy, source-selection or method editors. |

Notifications opens with named reusable notifications. Each owns timing and selected delivery methods; policies choose their assignments. Delivery methods is a secondary view. The accepted defaults and preservation boundary are defined in [ADR 0066](adr/0066-reusable-notifications-own-timing-and-delivery.md).

Every Monitoring inspector presents related issues as concise findings and opens the same dialog used from Open issues. Entity, device, integration and group inspectors have no duplicate acknowledgment or notification-pause workflow. Closing the dialog returns to the selected source and its reading position. Contextual coverage editing remains available without requiring an open issue.

The device inspector presents identity and availability, then monitored entity rows, then monitoring coverage. Its availability summary reads x of y monitored entities available. One View opens the same current device issue set as Open issues, including partial availability, missing evidence that still belongs to an issue, and other conditions when the aggregate availability issue is absent or cleared. Count entities in the device's monitored availability membership using the existing evidence classification; missing and restored evidence retains its distinct meaning. Entity totals are separate from issue totals.

Each compact entity row shows its actual name linked to Home Assistant and useful current status, wrapping on narrow screens. These rows have no separate View buttons or issue popups; individual response exceptions belong to selection in the combined dialog. Omit repeated Unavailable row labels when the summary already conveys a uniform current state; retain concise status for mixed availability and missing/restored evidence. Absence of an issue never establishes availability. Entities without a known device and exact episode deep links retain their original issue scope.

The Monitoring device inspector and shared device dialog each have one clearly labelled outlined Open device action, with no additional device-name link or second link to that destination in the same view. The dialog keeps its action for direct entry from Open issues. Entity and integration destinations remain separate.

Entity details begin with a small Entity label, the full name, useful location and plain current condition, followed by concise monitoring coverage and related issues. Known Device and Integration names link directly to their Home Assistant pages independently of tree grouping. Omit repeated destination actions, Availability and Monitoring field labels, unassigned location placeholders, the Details accordion and the history footer. Keep availability controls, independent condition findings and active maintenance visible. One quiet Monitoring policies action opens a contextual dialog listing contributing policies, their roles and editing links, with a return to the selected entity. Maintenance creation has no panel entry point or form. Device and other source details retain visible policy actions and show affected names, conditions and short source lists directly, with at most one flat Details section for supporting information that passes the purpose test. Use concise contextual destinations such as Open Device, Open integration and View integration logs, without duplicate links to the same target. Opened issues provide direct policy and notification editor buttons, as described in the workflow below. Source notification summaries retain readable evaluated status; internal identities remain hidden. Routine statements that an integration loaded belong only where they explain a relevant distinction. History remains available through its page, issue links and existing source-history routes.

Useful operating context from Overview remains: current-data status, confirmed sending state, a next eligible report when established, and a route to active pauses and maintenance. Keep this compact so it supports the issue workspace.

### Page structures considered

| Structure | Benefit | Tradeoff and decision |
| --- | --- | --- |
| Issues first | Starts with problems and keeps configuration directly reachable. | Selected through the walkthroughs; the quiet state must still explain operating status. |
| Operational home | Makes readiness and setup prominent. | Would require combining the issue workspace into Home or maintaining competing starting pages. Useful status is retained in Open issues. |
| Daily work plus a Configure area | Reduces primary destinations. | Adds a layer between source investigation, policy edits and notification configuration. |
| Sources first | Starts with known equipment. | Cross-source issues, Repairs and automations still need a global queue. Monitoring remains directly reachable. |

The walkthroughs establish the chosen direction. They do not establish measured usability or performance across real installations.

## User workflows

### Establish initial monitoring

Inspect supplied policies and discovered sources. Enable or create appropriate monitoring, confirm saved scope and available evidence, and choose dashboard-only operation or notification entries. Testing a method and enabling ordinary sending are separate deliberate actions. A policy with no eligible sources or an unusable destination stays visible with a useful next step. Preserve existing unified-model choices unless changed deliberately. Earlier test configuration models have no compatibility editor or migration requirement. A mandatory setup wizard is outside this baseline.

### Find and respond to a problem

Go to Open issues and select View for the device, or follow a notification to its exact issue. Read the condition and relevant evidence directly. A combined device view omits an earliest-issue Opened date; individual chronology remains available through exact issue and History routes. Keep Open device outlined and present once. The acknowledgment/pause pair has equal widths and matching control heights and padding. Policies: and Notifications: sit beside their named editor buttons, wrapping as needed on a narrow screen. Use compact spacing while keeping Stop Monitoring visibly separate. Each editor returns with Back to issue. Custom notification assignments open their owning policy. Show absent assignments, disabled sending or unconfigured delivery only when relevant configuration establishes them, following the [evidence requirement](ui-standards.md#notification-and-temporary-control-explanations).

A device entry opens all current issues whose complete source membership belongs to that one registry device, from either Open issues or Monitoring. An aggregate availability issue is optional; independent conditions belong here too. Identify one device and group its entities beneath it under Entities on this device. Show actual entity names in the same style, including a name shared with the device; omit special media-player labels or domain annotations. Keep each condition and control state distinct, including separate checks on one entity. Exclude other devices and wider or unknown issue scopes. An unattached entity or exact episode link keeps the original issue view. Several issues start selected; one current issue uses direct actions without a checkbox, selection count or redundant issue list. [ADR 0094](adr/0094-one-device-issue-workflow.md) defines entry and ownership boundaries; [ADR 0093](adr/0093-explicit-device-availability-issue-selection.md) defines exact selection semantics.

When several issues are shown, one All issues master checkbox appears above all issue rows in normal body-size text, with the selected count alongside. Individual checkboxes allow exceptions or a single-issue response. The master selects or clears the currently shown actionable issues and reflects all, partial or zero selection. Provide one acknowledgment and pause area; disable both actions when none are selected. Preserve choices while selection remains applicable and after actions. Later arrivals and replacement identities remain unselected, and ended issues cease to be actionable. Submission captures the exact selected current issue IDs, or the displayed current issue ID when only one remains; changes to the view never alter a pending submission's captured IDs. Results and failures remain per issue. Acknowledgment records awareness and stops applicable acknowledgment-dependent reminders without clearing issues; eligible scheduled summaries may continue. A pause applies the chosen expiry only to those issues and their recipients while monitoring continues. Neither operation creates a permanent device-wide rule. Singular issues retain their complete existing scope, including wider affected membership when applicable.

An opened issue with eligible availability findings offers Stop Monitoring as a separate coverage action. It selects the currently unavailable monitored entities represented by that issue and deduplicates them across availability policies. The acknowledgment/pause checkboxes never determine this scope. The collective device view keeps coverage editing separate. Its confirmation asks Stop monitoring these N entities? or Stop monitoring this entity?, shows the exact entity names directly, and states that availability checks stop while other checks continue. Omit the Details disclosure and repeated policy list; the issue dialog already provides policy editors. Those exclusions can also end other availability issues for the same entities. Closing the issue discards an unsaved review. Save the policy exclusions once, close the dialog and show the resulting issue list without a persistent success message. Failures remain inside the issue for review. Later adjustments belong to the saved policy settings. Other checks and Home Assistant state meanings remain unchanged.

If the issue has ended, show its retained outcome. If unavailable or expired, explain that and provide a useful route to Open issues. Existing permissions apply; an inaccessible target must not imply new rights or silently redirect to an unrelated page.

### Inspect a source and change monitoring

Find a source from an issue, search or grouping. Read its identity, current evidence and contributing checks and policies. The same light entity may participate in device availability and a separate entity availability policy. Show both contributions without duplicate source rows or unexplained Separate check labels.

Use Edit policy in the relevant policy context. The editor retains the originating source or issue and shows the policy's complete shared scope. Monitoring settings and notification assignments share that policy draft. Selecting a source from an issue does not imply that the whole policy applies only to that source. [Policy editor layout](policy-editors.md#policies) defines its heading and fields.

Entity details offer Stop Monitoring and Resume availability monitoring through scoped changes to the owning policies. A device's explicitly selected entity rows can use the same action together. The confirmation names the availability scope and shows the exact entities directly; unrelated drafts and other check types remain intact. A confirmed save shows the resulting monitoring scope without a persistent success message or Undo. Resumption removes explicit exclusions while preserving policy scope and eligibility. Related issues open the shared dialog; acknowledgment and notification pauses apply to the original singular issue or the chosen collective issue identities. That response scope is separate from contextual coverage editing. This extends the [entity-first decision](adr/0073-entity-first-monitoring-details.md) through [explicit issue selection](adr/0093-explicit-device-availability-issue-selection.md) and preserves the guarded saves in the [contextual control decision](adr/0068-contextual-availability-monitoring-controls.md).

Type is fixed after creation. Selectors follow the monitoring type's actual capabilities. Device availability retains existing eligible-member and connectivity rules; the redesign introduces neither a per-policy device-member picker nor an any-entity-unavailable trigger. Broken automations retains fixed scope and explicit missing-entity-reference detection; it does not become a general automation debugger.

The Monitoring toolbar orders Search, Monitoring status and More filters. All / Monitored / Not monitored remains visible and intersects with search and additional filters. More filters opens an anchored panel without rearranging the toolbar and restores keyboard focus when dismissed. Group by and a stable Collapse groups button sit immediately above the tree. Collapse groups affects only tree expansion. Keep coverage based on actual checks and evidence inputs, preserve navigation state, and allow the selected source to remain inspectable after filtering removes its row.

When a change ends monitoring for a selection, show which contribution ends and which other policies remain. Save policy applies the intended draft and distinguishes Monitoring ended from recovery. Discard changes restores the draft's saved baseline in place. Return restores the originating source or issue and reading position.

### Configure policy notifications

Open a policy directly or from an issue or source, then select a named notification. Show its saved timing and destinations, including missing setup, and offer a contextual link to edit it in Notifications. The six supplied choices are Immediate, Immediate with acknowledgment, Urgent, Morning, Evening and Weekly. The reusable editor owns timing and methods. Policies retain their assignment identity and any UPS mains/backup condition. Supported inline assignments remain Custom notification until explicitly changed; a named selection preserves its row identity and UPS condition.

Summaries include eligible open issues, including acknowledged ones; ended issues and empty summaries are excluded. Editing a shared notification affects its saved uses. Changing a policy assignment affects only that policy. With no assignments, show Dashboard only and explain that monitoring continues. A notification without delivery methods is visibly unconfigured and sends nothing.

### Edit shared delivery methods

Start with a name, selected destinations and Add destination. Optional presence controls reveal explicit fallback or skip choices. Show affected policy uses before applying a shared change. Only supported destination capabilities appear; unavailable saved destinations remain visible for repair.

| Entry point | Draft and save behavior |
| --- | --- |
| From a policy or reusable notification | Retain the originating draft and a contextual return. The shared editor names its save scope and affected uses; saving it does not silently save the origin's pending assignment. |
| Standalone in Notifications | Save notification or Save delivery method applies only that definition to its saved uses. Discard changes restores its saved baseline without saving another draft. |

An unsaved new method does not appear as a saved library entry. Contextual and standalone layouts share controls and validation while making their save scope explicit. Concurrent edits surface a conflict instead of silently overwriting one another.

### Test a saved method

Send test is available only for a saved unchanged method and is always explicit. Resolve current presence and configured destinations when requested. Tests can run while ordinary sending is off. Report requested, failed or skipped outcomes supported by the result; do not claim receipt or that speech was heard. Opening, editing and saving never send tests. Presence changes alone send nothing.

### Control ordinary notification sending

Use the consistent Notifications On/Off switch available throughout the interface. It changes only saved global sending and preserves unrelated drafts. Monitoring continues while sending is off. On permits requests according to policy and current eligibility; it does not promise an immediate message.

Pending or failed feedback belongs beside or directly below the control. Confirmed success appears in the saved state and an accessible announcement. Do not add a routine page-wide success banner or announcement about existing issues each time sending is enabled.

### Reduce unwanted attention

Match the action to the problem: change an inappropriate expectation, adjust timing or destinations, acknowledge applicable reminders, or pause explicitly selected issues temporarily. Show other applicable entries and policies so one adjustment does not imply that all attention has stopped.

Maintenance creation is omitted from the panel under [ADR 0087](adr/0087-remove-maintenance-creation-from-ui.md): its preventive use case does not justify another household workflow. Published Home Assistant actions retain the existing semantics. Active windows remain visible with their actual scope, expiry, optional reason and End maintenance action.

### Investigate a past problem

Open History from the top navigation or follow a retained issue link. Existing source-history routes remain supported. Lead with condition, recorded outcome and useful time or duration. Separate open related problems from retained ended issues. Show Condition cleared, Monitoring ended and Grouped into another issue distinctly. Associations use recorded membership; current device placement must not rewrite the past. When older records identify the issue source but do not record its parent device or integration, source history shows exact source records and explains that other retained outcomes remain available in the full issue history.

Retention and collection limits belong in a concise History coverage disclosure. Missing associations or expired records get explicit limitations. Return restores the filtered list or source context.

## Save, navigation and live-update contract

Each editor applies only its named scope and preserves unrelated drafts. Users can distinguish unsaved work, a pending save, a confirmed result and a failure. Failed or conflicting saves retain the draft, and confirmation must not overwrite newer draft state. [UI standards](ui-standards.md#forms-saving-and-cancellation) defines the save, discard and return interactions. [Configuration saving](spec.md#configuration-saving) defines validation, concurrency, reload and rollback behavior.

Meaningful destinations support browser Back and Forward, direct links and refresh. Navigation preserves current-session drafts and the originating selection, filters, expansion and reading position. It never implicitly saves or discards. Live updates preserve focus, text entry and the problem being inspected. [UI standards](ui-standards.md#navigation-and-continuity) defines details and the limits of draft restoration across reloads.

## Review scenarios and completion criteria

These are refactor acceptance criteria. Reviewed prototypes establish intent; implementation must pass against real adapter data and isolated actions. Use the [UI acceptance procedure](development-workflows.md#quick-local-test) to record control paths, actual interactions, persisted results and pass/fail/untested evidence. Original screenshots supply concrete questions rather than verified diagnoses of the installation.

| Scenario | Observable completion criterion |
| --- | --- |
| Matter contains the Back Deck Table Light problem | Open the same device dialog from Open issues and Monitoring with all current issues wholly owned by that registry device. Source inspectors have no duplicate response controls; closing restores context, focus and reading position. Loaded Matter is not labelled failed because devices are unavailable. |
| eero has a large independent queue | Compact groups retain search and complete affected lists. Every issue remains reachable without changing expectations or treating absence as established equipment failure. |
| Confirmed integration outage and partial recovery | Show its own evidence and recorded affected members. Outstanding findings remain visible according to engine results; no premature all-clear. |
| Entity without a device; broken automations; Repairs | Each has a useful investigation path and exact identity without invented equipment membership. |
| One device has an aggregate issue and three entity availability issues | Monitoring orders identity/availability, linked entities and coverage. Its sole View and the queue's device View open the same four issues, all initially selected. Exercise individual exceptions, all/subset/zero selection, acknowledgment, pause, cancellation, partial failure and updates during submission. Clear the aggregate issue and then all but one entity issue: the same device view remains reachable, with direct controls for one issue. Exact episode links retain their original scope. |
| A device has partial availability and an independent condition | Both device entry points include its current independently owned issues, with accurate availability evidence and distinct condition labels. Other devices, cross-device issues and unknown ownership are excluded. One queue View opens the complete device set despite filtering or pagination. |
| Stop one monitoring contribution | Explain the check that ends, preserve other policies and current evidence, and record Monitoring ended rather than recovery. |
| Resume availability monitoring after an earlier issue period | Follow engine qualification and identity; prior acknowledgment and pause do not silently transfer to a new issue. |
| Edit a shared policy from a source or issue | Show its full scope and one policy draft containing monitoring settings and notification assignments. Clean/dirty/save/discard states and contextual return agree. |
| Change global sending during a draft | Only global sending changes. The draft stays intact and unsaved; pending, failed and uncertain results never masquerade as confirmed state. |
| Edit a shared definition during a policy draft | The policy assignment stays unsaved; shared changes name their own scope. Discarding one draft does not erase another saved definition. |
| Save a standalone method | Show shared uses and apply only that method. Policy drafts remain unsaved and conflicts are surfaced. |
| Change a notification or assignment | Shared definition edits apply only to its saved uses; changing one policy assignment preserves others. Window boundaries, summary days/time and reminders validate; no assignments yields Dashboard only. |
| Test a method with sending off | Only explicit testing requests messages. Dirty methods cannot be tested; saved tests report requested, failed or skipped outcomes. |
| Acknowledge and pause | One action area operates on exact selected current issue IDs. Verify all, subset and zero selection, mixed states, cancellation, partial failure, partial recovery and later arrivals without selection expansion or inherited controls. Stop Monitoring retains its separate coverage confirmation. |
| Back, Forward, refresh or a direct issue link | Restore the meaningful destination and supported context, or explain a missing target. Never silently substitute Overview. |
| No visible issues | Distinguish quiet monitored sources, filters, no monitoring, loading and unavailable current data. |
| History and existing source-history links | Use recorded membership and expose retention limits. Missing records do not imply that no problem occurred. |
| Keyboard, phone layout and live updates | Complete the same tasks without color-only state, lost focus, discarded input or inaccessible affected lists. |
| Save failure or concurrent edit | Keep the exact draft, explain the named failure/conflict and avoid overwriting another save. |

## Remaining implementation questions and limits

Primary navigation, investigation grouping, canonical source presentation, scoped dirty-only editors, reusable named notifications and contextual method editing are settled. Planning should not reopen them as unanswered choices. The boundaries below constrain implementation; the [roadmap](roadmap.md#current-work) identifies remaining work.

| Design detail | Required boundary |
| --- | --- |
| Ordering, pagination and very large catalogs | Preserve exact totals, complete reachability and selection. Measure representative data before choosing thresholds. |
| Group labels for less common source types | Preserve known relationships and provide an independent-problem fallback. No invented parent failure. |
| Data for affected lists, history and notification decisions | Verify recorded membership and evaluated decisions are exposed. Missing data stays explicit; backend additions need behavior coverage. |
| Shared-definition deletion | Preserve reference integrity and explicit scope. Offer replacement or removal and block relevant pending drafts. Removing the last method leaves a reusable notification and its assignments unconfigured; an empty supported inline assignment is removed. Validate atomic application and concurrent changes through the runtime save path. |
| Optional policy-list quick controls | The reviewed Enabled checkbox saves with the policy draft. A list switch and its handling of a pending draft of that same policy remain proposals; independent global sending is already accepted. |
| Initial setup, Settings and active-control layouts | Apply shared standards and existing capability boundaries. Maintenance creation stays outside the panel. |
| Refresh, restart and concurrent drafts | Preserve drafts and surface conflicts within the supported session. Restart recovery of unsaved edits requires separately verified storage. |
| Final type scale, density and responsive details | Use shared tokens and verify keyboard, touch, zoom and both themes. Prototype approval is not an accessibility audit. |

The panel remains administrator-only. Equipment repair and reauthentication remain in Home Assistant. Missing, unknown, unavailable and failed-to-retrieve evidence stay distinct. Ended-issue history retains at most 100 entries from the past 30 days across the installation; a full settings and notification audit journal is separate scope.

Prototype inventories, counts, names, hardcoded times, simulated issues, saves, presence and provider outcomes are examples. They do not establish new runtime capabilities, performance, concurrency safety or delivery receipt. No engine correlation change, new monitoring type, broad migration/reset, live test, release or deployment follows from this design approval.
