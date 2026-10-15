# Homeostatic product specification

Status: Accepted design baseline, October 14, 2026.

This specification consolidates the reviewed Open issues, Monitoring, monitoring-policy and notification workflows. It defines the intended experience and acceptance criteria. The [integration specification](spec.md) owns current behavior. [UI standards](ui-standards.md) owns interaction patterns, [policy and notification editors](policy-editors.md) owns form layout, and the [roadmap](roadmap.md#current-work) owns implementation and acceptance status. The [design decision](adr/0061-issues-first-product-workflows.md) records the approval boundary and earlier interface decisions it supersedes.

## Product purpose and audience

Homeostatic helps you run Home Assistant by identifying problems in monitored integrations, devices, entities and reported situations, and requesting notifications according to your policies. You should be able to understand a problem, act on it and determine what will happen with notifications without reconstructing the system's internal structure.

The initial redesign serves the administrator who configures monitoring and investigates issues. Notification recipients need understandable messages and useful destinations within their existing access permissions. Access for household members who are not administrators remains separate planned work. These are design roles, not findings from a usability study.

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

These observable outcomes guide review. Every screen, control or summary should contribute to one of them.

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

The Open issues page starts with integration groups, one indented heading per registry device and independently openable findings underneath. Device names appear once; child rows name the capability or check and its observed condition. Reported integration failures and issues spanning several devices or standalone or unknown recorded sources remain directly under the integration, as do entities without a known device. A loaded integration issue confined to one known device joins that device heading. Registry connection ownership keeps all findings for a device under the same integration. Repairs, automations and situations retain their own groups. Integration summaries count affected devices separately from standalone entities, and device headings count their independent issues. Search includes device names; pagination preserves one heading per device and makes partial sets explicit. Monitoring-removal actions follow the findings. Equipment hierarchy helps answer where to investigate. Policies answer why a source is watched, what constitutes a problem and what notifications are configured. Policies provide context and filtering; they are not the default investigation hierarchy.

A device summary can collect entity problems without creating a device issue. An integration group can contain device problems without creating an integration-outage issue. Opening an issue through another source or group reaches the same identity and action state. The engine determines actual correlation, dependency grouping and lifecycle; the interface does not merge issues merely to shorten the queue.

### Investigation paths

| Observed situation | Required presentation |
| --- | --- |
| One unavailable monitored entity with a device | Lead with the entity condition and identify its device and integration. |
| Several entity problems on one device | Use a device summary with typed counts and reachable underlying issues. A count alone does not establish whole-device unavailability. |
| Several device problems in one integration | Use an integration group, show its own reported condition separately and expose the affected devices and issues. |
| An established integration issue contains dependent findings | Show the integration's current evidence and complete recorded affected set; lead with its failure only when current evidence establishes one. Preserve independent issues alongside it. |
| An entity has no device | Place it directly under its known integration where useful; keep it searchable and reachable when ownership is unknown. |
| Broken automations, Repairs or other independent problems | Use a relevant named group with a direct path to each problem. Do not invent an equipment relationship. |

Even every monitored device becoming unavailable does not prove that the integration failed. Separate the integration's evidence, observed affected entities and devices, and potential dependency impact. Use Affected entities for an entity list; name other types accurately. Counts of groups, unique issues, devices, entities and checks remain separate. Global totals count each issue identity once.

The reviewed layout starts with collapsed, compact group summaries on an initial visit. Returning restores prior expansion; search and direct links reveal their target without requiring every branch to be opened. Every advertised affected count leads to its complete set. Preserve selection, expansion and reading position during navigation and updates. Acknowledgment and notification pauses act on the named issue. Monitoring removal is available inside an opened issue and changes only its reviewed policy exclusions.

### Recovery and monitoring boundaries

Display confirmed engine outcomes as findings recover, monitoring ends or issues regroup. An integration reporting loaded again does not establish that its members recovered. Outstanding member findings remain visible; genuine recovery confirmation follows the existing active-list rules. Keep the problem being read, its retained outcome and any recorded successor reachable as the active queue changes.

Removing monitoring ends the monitoring expectation; it does not repair equipment. Removing one policy's contribution preserves other policies and the current Home Assistant report. Re-enrollment follows the engine's qualification and identity rules. A new issue period does not silently inherit an earlier period's acknowledgment or pause.

The noisy eero case must distinguish missing evidence, current state values and entity unavailability. A connectivity sensor's current off value does not create an availability failure; diagnostic entities require explicit individual availability selection. Investigation leads to the responsible policy when an expectation needs adjustment. Grouping does not silently change that expectation. Changing correlation thresholds or lifecycle rules requires separate specification work.

## Navigation and page responsibilities

Open issues is the opening page. The primary destinations are Open issues, Monitoring, Policies, Notifications and History. The Policies tab opens the Monitoring policies page. Retained history has its own page and remains reachable from issue links and supported source-history routes. General configuration has a labelled Settings utility. There is no separate Overview destination.

| Destination | User task | Required information and actions |
| --- | --- | --- |
| Open issues | Find, understand and respond to problems | Investigation groups, exact issues, observed conditions, typed affected lists, contributing checks, notification behavior, acknowledge, pause, active controls. |
| Monitoring | Understand a source and its coverage | One source identity, current evidence, applicable checks and policies, related issue links, contextual policy editing and supported Home Assistant links. |
| Policies | Define monitoring and notification behavior | Supplied and user-created policies together; saved enabled state; scope, detection and notification summaries; add, edit, duplicate, enable/disable, delete and selective restoration. |
| Notifications | Configure named notifications and inspect their use | Reusable timing and delivery choices, saved policy assignments, destination methods, optional presence, saved-method tests and request outcomes. |
| History | Review ended problems | Recorded condition, outcome, time range, retention coverage and retained issue details. |
| Settings utility | Adjust installation-wide behavior | Supported general timing and grouping settings with their scope explained; no duplicate policy, source-selection or method editors. |

Notifications opens with named reusable notifications. Each owns timing and selected delivery methods; policies choose their assignments. Delivery methods is a secondary view. The accepted defaults and preservation boundary are defined in [ADR 0066](adr/0066-reusable-notifications-own-timing-and-delivery.md).

Entity details begin with the name, useful location and plain current condition, followed by concise monitoring coverage, related issues and contributing policies. Omit repeated Availability and Monitoring field labels, unassigned location placeholders, the Details accordion and the history footer. Keep policy editing, availability controls, independent condition findings and supported maintenance visible. Native links beside identity name their actual destinations and known device/integration context. Device and other source details retain the evidence needed to understand their scope. History remains available through its page, issue links and existing source-history routes.

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

Go to Open issues or follow a notification directly to its issue. Identify the reported condition, relevant times, affected entities or other named types, and current notification behavior. Inspect a source, open a supported Home Assistant destination, acknowledge the exact issue or pause its notifications with a visible expiry.

Acknowledgment stops applicable acknowledgment-dependent reminders; eligible scheduled summaries may continue. A pause names the issue and recipient scope while monitoring continues. Show the confirmed result and remaining behavior. Neither action affects every issue in the investigation group.

An opened issue with eligible availability findings offers Remove from availability monitoring. It selects the currently unavailable monitored entities represented by that issue and deduplicates them across availability policies. A short confirmation shows the count and says that availability checks will stop; Details contains the entity and policy names. Closing the issue discards an unsaved review. Save the policy exclusions once, close the dialog and show the resulting issue list without a persistent success message. Failures remain inside the issue for review. Later adjustments belong to the saved policy settings. Other checks and Home Assistant state meanings remain unchanged.

If the issue has ended, show its retained outcome. If unavailable or expired, explain that and provide a useful route to Open issues. Existing permissions apply; an inaccessible target must not imply new rights or silently redirect to an unrelated page.

### Inspect a source and change monitoring

Find a source from an issue, search or grouping. Read its identity, current evidence and contributing checks and policies. The same light entity may participate in device availability and a separate entity availability policy. Show both contributions without duplicate source rows or unexplained Separate check labels.

Use Edit policy in the relevant policy context. The editor title is Edit policy: [name]. It retains the originating source or issue and shows the policy's complete shared scope. Monitoring settings and notification assignments share that policy draft. Selecting a source from an issue does not imply that the whole policy applies only to that source.

Entity details offer Remove this entity from availability monitoring and Resume availability monitoring through scoped changes to the owning policies. A device's explicitly selected entity rows can use the same action together. The confirmation names the availability scope and keeps entity/policy details available; unrelated drafts and other check types remain intact. A confirmed save shows the resulting monitoring scope without a persistent success message or Undo. Resumption removes explicit exclusions while preserving policy scope and eligibility. Related issues open their complete view with View issue; acknowledgment and notification pauses are available there with the actual issue scope. This follows the [entity-first decision](adr/0073-entity-first-monitoring-details.md) and preserves the guarded saves in the [contextual control decision](adr/0068-contextual-availability-monitoring-controls.md).

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

### Reduce unwanted attention or perform maintenance

Match the action to the problem: change an inappropriate expectation, adjust timing or destinations, acknowledge applicable reminders, or pause a named issue temporarily. Show other applicable entries and policies so one adjustment does not imply that all attention has stopped.

Maintenance retains existing semantics: it holds new problems in a supported scope while existing issues and notifications continue. Name actual checks or a server-confirmed scope, expiry and optional reason. Do not imply an equipment-wide operation the runtime cannot perform. Detailed maintenance layout remains follow-up work.

### Investigate a past problem

Open History from the top navigation or follow a retained issue link. Existing source-history routes remain supported. Lead with condition, recorded outcome and useful time or duration. Separate open related problems from retained ended issues. Show Condition cleared, Monitoring ended and Grouped into another issue distinctly. Associations use recorded membership; current device placement must not rewrite the past. When older records identify the issue source but do not record its parent device or integration, source history shows exact source records and explains that other retained outcomes remain available in the full issue history.

Retention and collection limits belong in a concise History coverage disclosure. Missing associations or expired records get explicit limitations. Return restores the filtered list or source context.

## Save, navigation and live-update contract

An unchanged editor has no save footer, disabled Save, Cancel or No changes message. A dirty editor shows Unsaved changes, Discard changes and the scoped Save action. Saving retains validation, authorization, exact-payload, revision, serialization and rollback protections. There is no compulsory review screen.

Successful notification and delivery-method saves return to their matching Notifications list after saved settings are refreshed, with focus on the saved row's Edit action. Navigation elsewhere or newer edits prevent an automatic return. Other editors remove dirty controls and preserve contextual return. Successful saves leave no persistent success message; pending work, newer edits and failures stay explicit. Discard restores an existing object's unsaved changes in place; it does not undo a completed save. A newly created draft has no saved baseline: Discard abandons it and returns to its origin without creating an empty saved object. Failed or conflicting saves retain the draft. Changes made during an in-flight save remain a newer unsaved draft.

Meaningful destinations support browser Back and Forward, direct links and refresh. Navigation preserves current-session drafts and the originating selection, filters, expansion and reading position. It never implicitly saves or discards. Live updates preserve focus, text entry and the problem being inspected. [UI standards](ui-standards.md#navigation-and-continuity) defines details and the limits of draft restoration across reloads.

## Review scenarios and completion criteria

These are refactor acceptance criteria. Reviewed prototypes establish intent; implementation must pass against real adapter data and isolated actions. Use the [UI acceptance procedure](development-workflows.md#quick-local-test) to record control paths, actual interactions, persisted results and pass/fail/untested evidence. Original screenshots supply concrete questions rather than verified diagnoses of the installation.

| Scenario | Observable completion criterion |
| --- | --- |
| Matter contains the Back Deck Table Light problem | Reach its exact issue from the group and source, inspect affected entities and return without losing context. Loaded Matter is not labelled failed because devices are unavailable. |
| eero has a large independent queue | Compact groups retain search and complete affected lists. Every issue remains reachable without changing expectations or treating absence as established equipment failure. |
| Confirmed integration outage and partial recovery | Show its own evidence and recorded affected members. Outstanding findings remain visible according to engine results; no premature all-clear. |
| Entity without a device; broken automations; Repairs | Each has a useful investigation path and exact identity without invented equipment membership. |
| One entity has device and entity policy coverage | Display one entity and both contributions, with explicit Entity, Device and Integration labels where known. |
| Remove one monitoring contribution | Explain the check that ends, preserve other policies and current evidence, and record Monitoring ended rather than recovery. |
| Resume availability monitoring after an earlier issue period | Follow engine qualification and identity; prior acknowledgment and pause do not silently transfer to a new issue. |
| Edit a shared policy from a source or issue | Show its full scope and one policy draft containing monitoring settings and notification assignments. Clean/dirty/save/discard states and contextual return agree. |
| Change global sending during a draft | Only global sending changes. The draft stays intact and unsaved; pending, failed and uncertain results never masquerade as confirmed state. |
| Edit a shared definition during a policy draft | The policy assignment stays unsaved; shared changes name their own scope. Discarding one draft does not erase another saved definition. |
| Save a standalone method | Show shared uses and apply only that method. Policy drafts remain unsaved and conflicts are surfaced. |
| Change a notification or assignment | Shared definition edits apply only to its saved uses; changing one policy assignment preserves others. Window boundaries, summary days/time and reminders validate; no assignments yields Dashboard only. |
| Test a method with sending off | Only explicit testing requests messages. Dirty methods cannot be tested; saved tests report requested, failed or skipped outcomes. |
| Acknowledge and pause | Operate on the exact issue. Applicable reminder/summary behavior, pause scope and expiry remain visible. |
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
| Initial setup, Settings and maintenance layouts | Apply shared standards and existing capability boundaries. |
| Refresh, restart and concurrent drafts | Preserve drafts and surface conflicts within the supported session. Restart recovery of unsaved edits requires separately verified storage. |
| Final type scale, density and responsive details | Use shared tokens and verify keyboard, touch, zoom and both themes. Prototype approval is not an accessibility audit. |

The panel remains administrator-only. Equipment repair and reauthentication remain in Home Assistant. Missing, unknown, unavailable and failed-to-retrieve evidence stay distinct. Ended-issue history retains at most 100 entries from the past 30 days across the installation; a full settings and notification audit journal is separate scope.

Prototype inventories, counts, names, hardcoded times, simulated issues, saves, presence and provider outcomes are examples. They do not establish new runtime capabilities, performance, concurrency safety or delivery receipt. No engine correlation change, new monitoring type, broad migration/reset, live test, release or deployment follows from this design approval.
