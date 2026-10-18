# Homeostatic UI standards

Status: Accepted interaction baseline, October 14, 2026.

This reference defines the shared interaction standards for the [product specification](product-specification.md). Apply them across pages, embedded editors and narrow layouts during refactoring. The [integration specification](spec.md) owns current behavior, and the [roadmap](roadmap.md#current-work) owns implementation and acceptance status. The [design decision](adr/0061-issues-first-product-workflows.md) records the changed presentation and action scopes.

## Purpose before controls

First identify the user's task and the page or dialog that owns it, using the [page responsibilities](product-specification.md#navigation-and-page-responsibilities). Reuse that workflow from other contexts instead of building a second place to perform it. Shared workflows retain their action semantics while adapting controls to the context; show selection controls only when there is a real choice. Then, for every heading, label, count, control, section and navigation step, ask: why is it here? What does it tell the user? How does it help them make a decision or take an action? What would they lose if it were removed? Name the concrete benefit. Available data, a reusable component or a familiar design pattern is insufficient reason to show something. Use grouping to establish relationships before adding labels to individual rows. Remove elements that add no useful information or capability; keep necessary evidence, action scope and state visible.

Do not add expandable sections by default. A disclosure needs substantive supporting content and a reason that hiding it helps the current task. A refresh timestamp alone, repeated evidence or the same buttons do not justify Technical details or another layer. An allowance for at most one Details section is a limit, not a requirement. Keep short useful information inline and omit information without a purpose. Inventory branches and large affected lists can justify expansion when it makes the complete set manageable.

Before adding a detail link or chevron, compare the starting view with its destination. The destination must add useful evidence or open the workflow that owns the next task. A Home Assistant link or contextual coverage action can stay beside the source it serves; issue response opens the shared issue dialog. Preserve separate issue identities and complete action scopes while removing repeated presentation. Apply this test to prototypes, implementation and review.

## Control selection

| Control | Use | State and label |
| --- | --- | --- |
| Switch | An immediately applied binary operational setting, such as global notification sending | Stable subject label, explicit On/Off text, and a position reflecting confirmed state. Pending action is separately labelled. |
| Checkbox | A draft boolean field, optional feature or explicit selection for an action | The label describes the selected option. Save applies a draft field; a named action applies the selected scope. Use an indeterminate state only for an actual partially selected group. |
| Radio group | One choice among a small visible set | Label the group and each alternative; show the saved or draft context. |
| Select or searchable picker | Longer supported choices, including source and destination selection | Preserve selections through search; show the selected set and any unavailable saved choices. |
| Action button | A command, such as Save policy, Acknowledge issue or Send test | Name the result or operation. Do not use its fill as the indication of current enabled state. |
| Link | Navigation to an issue, source, editor, history record or Home Assistant page | Name the destination. Give meaningful destinations real routes and link semantics. |
| Disclosure | Substantive optional content that passes the purpose test above | Its label describes the useful hidden content and the task it supports. Required names, conditions and actions remain visible. Opening it reveals its contents without nested disclosures. Expansion does not select, save or change monitoring. |
| Contextual help | A brief explanation of a field or choice, with optional setup links | Use a small help icon beside the label and a compact popover. Opening it overlays the form without moving fields or changing the draft. |
| Tabs or segmented navigation | Sibling views with distinct useful content | Show selection separately from keyboard focus; preserve the selected object. Do not create an empty tab just to redirect elsewhere. |

Use a stable label such as Notifications for its switch; the accompanying state changes between On and Off. Do not alternate the switch's accessible name between Turn on and Turn off. This follows the [W3C switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/). Choosing switches for immediate settings and checkboxes for draft fields or explicit action selection is a Homeostatic design convention.

Keep field-level help brief and on demand. Give its icon a descriptive accessible name and a usable touch target. The popover opens by click, touch or keyboard, supports keyboard access to its links, and closes on Escape, outside interaction or a second activation of the icon. Escape returns focus to the icon without closing the containing editor. Keep the popover within the viewport on narrow screens. Do not turn field help into an expanding Help section that pushes the form down. Disclosures remain appropriate for substantive optional task details. Required instructions, validation and warnings stay visible beside their fields.

In a policy editor, Enabled belongs to the draft and takes effect on Save policy. Immediate policy-list switches were not part of the reviewed workflow. If introduced, they need a defined saved-state scope and handling for a pending draft of the same policy before implementation. Continue editing instead of a competing quick toggle is a proposed pattern. The accepted global Notifications switch has its own independent scope.

## Operational controls and saved state

The application-wide notification indicator uses confirmed runtime state. It is not bound directly to an unsaved editor field. On means ordinary issue notification requests are enabled; policy configuration and current eligibility still determine requests.

| Operation state | Presentation and behavior |
| --- | --- |
| Confirmed On or Off | Show the matching switch position and text. Name the scope, such as All Homeostatic issue notifications. |
| Action pending | Keep the last confirmed state identified, show Turning on or Turning off, and prevent duplicate submission. |
| Confirmed success | Update the switch and state from the accepted response. Announce the result accessibly without moving focus or adding a routine success banner. |
| Known failure | Retain the last confirmed state, explain the failure and offer an applicable retry. |
| Result uncertain | Say the outcome is not confirmed; refresh the saved state before permitting a blind repeat. |
| Disconnected or unavailable | Label any displayed value Last known and make unsafe mutations unavailable with a reason. |

Global sending changes only global sending. It must not apply policy drafts, create delivery methods or discard edits. Explain that monitoring continues while sending is off. Enabling permits requests according to current policy eligibility; it does not promise an immediate notification. Place pending or error feedback beside or directly below the control. Do not show a routine banner about existing issues each time sending is enabled. Saved-state quick controls require authorization, conflict protection and a confirmed result through the normal configuration owner.

## Forms, saving and cancellation

Each editor names its object and save scope. Use Save policy, Save notification, Save delivery method or Save settings as appropriate. A read-only panel and an unchanged editor have no save footer, disabled Save, Cancel or No changes message. Navigation remains available independently of editing actions.

| Editor state | Actions and feedback |
| --- | --- |
| Unchanged | Show saved values and contextual navigation; no dirty-state controls. |
| Changed | Show Unsaved changes, Discard changes and the scoped Save action. |
| Saving | Identify the submitted scope, preserve its draft, and disable editing and repeated submission while its request is pending. |
| Saved | Notifications and delivery-method editors return to their matching list and focus the saved object's Edit action. Other editors remove dirty controls and retain contextual return. Do not leave persistent saved messages or success banners. Newer edits or navigation during saving prevent an automatic return. |
| Edited again after saving | Restore dirty controls. |
| Discarded | Restore an existing object's saved baseline in place and remove dirty controls. For a new object, abandon the unsaved draft and return to its origin. Earlier completed saves remain saved. |
| Failed or conflicted | Retain the draft, name the error and keep correction or reconciliation available. |

Show Unsaved changes beside the editing task. Field labels stay visible; placeholders supplement labels. Provide required indicators, units and supported ranges next to inputs. Put validation beside the field and an error summary where useful. Move focus to the relevant error after submission; keep the draft and correctable input intact.

Save validates and applies the submitted draft once. A confirmed policy save finishes the action; do not retain an Undo control or a separate reversal record. Keep concurrency and rollback protection behind that action, with no compulsory review screen. Show Saving while pending. When saved settings are reconciled, preserve any draft state newer than the submitted values and keep it visibly unsaved. If applying succeeds but refreshing fails, say that settings were saved and current data could not be refreshed. [Configuration saving](spec.md#configuration-saving) defines the pending request and runtime transition behavior.

Discard changes restores only the named existing object's unsaved scope in place. It does not undo a completed save. A new object's draft counts as unsaved; discarding it returns to its origin and leaves no empty saved object. Back and ordinary navigation preserve the current-session draft with a visible route to resume it. Monitoring settings and notification assignments belong to one policy editor and draft. Refresh preserves a draft when the chosen storage mechanism supports it; otherwise use the browser's supported unsaved-change protection. Do not promise recovery across a restart unless implemented and tested. Cancel is reserved for abandoning a bounded dialog or nested edit whose scope is explicit.

Conflicts preserve the draft and explain what became stale. Offer reload/reconciliation of the named object without overwriting newer saved changes silently. A network timeout after a mutation may be ambiguous; inspect current state before repeating the action.

### Shared notifications and delivery methods

Each shared editor makes its save scope explicit and shows Used by before applying a change. A reusable notification lists affected policies; a delivery method lists its notification and supported inline uses. Use Discard changes and Save notification or Save delivery method only while dirty. Saving the shared definition changes its saved uses without applying a pending policy assignment or another editor's draft.

Opening a shared notification or delivery method from another editor retains the originating draft and a contextual return. Save policy applies only the policy. Discard restores only the named object; abandoning a new definition leaves no blank saved entry. Explain shared effects before saving and surface concurrent conflicts without overwriting another editor's changes. Supported inline assignments remain Custom notification until the owner explicitly selects a named notification.

Delete identifies the object and consequences. An assigned notification or method requires explicit replacement or removal of its references; deletion cannot leave dangling references. Removing the last method from a reusable notification keeps that notification and its policy assignments visibly unconfigured. Removing the last method from a supported inline assignment removes that assignment. Any combined operation names its complete scope and applies atomically without saving unrelated drafts. Pending edits to affected definitions or policies must be resolved first. Cancel leaves the definitions and assignments intact. Ordinary saves and reversible operational changes do not require a generic confirmation sequence.

## Action hierarchy and color

Use Home Assistant's theme colors and component conventions. Map product roles to shared tokens rather than assigning one-off colors in each page. Keep navigation labels and status text neutral, with readable contrast on colored surfaces. Review both light and dark themes.

| Role | Visual treatment | Meaning |
| --- | --- | --- |
| Primary action | Filled theme accent with readable text | The main next action in this task, such as Save policy. |
| Secondary action | Neutral outlined or text control | Another available action, such as Discard changes or Edit policy. |
| Destructive action | Explicit label and danger treatment where appropriate | An action such as Delete policy with consequences described in context. |
| Switch On | Accent track, consistent thumb position and On text | Confirmed enabled state. |
| Switch Off | Neutral track, opposite thumb position and Off text | Confirmed disabled state. Off is not itself an error. |
| Selected navigation | Subtle accent surface or indicator, neutral text and semantic selection | The current destination or item. |
| Focus | Distinct visible outline | Keyboard focus; it remains distinguishable from selected state. |
| Warning | Warning surface or icon with specific neutral text | A condition requiring attention or a material evidence limitation. |
| Error | Error surface or icon with specific neutral text | A failed operation or established problem condition, according to its meaning. |
| Success | Success surface or icon with neutral text | A confirmed successful operation or a specifically established state. |
| Neutral status | Readable neutral text | Not monitored, dashboard-only, disabled by choice, or other ordinary context. |

Blue does not mean Off. A filled Turn on button would describe an available action, but it must never be the only indication of present state. Replace alternating Turn on/Turn off status buttons with the consistent switch pattern where immediate toggling is supported. Show policy status explicitly regardless of control styling.

Color never carries status by itself. Acknowledged, paused, cleared, unavailable and unmonitored remain textually distinct. Do not use a green general-purpose Healthy badge for a loaded integration or an empty issue list.

## Typography, spacing and surfaces

Use the Home Assistant font family and a shared type scale. The initial proposed roles are page title, section heading, item title, body and supporting text. Starting sizes are 24, 18, 16, 14 and 12 CSS pixels respectively, implemented with scalable units. Use 400 for body and 500 for emphasis. These are proposed design tokens, subject to prototype review at normal and enlarged text sizes; pages must not invent intermediate sizes.

Essential conditions, action labels and validation use body size or larger. Supporting text contains secondary context; it is never the sole location for a warning or required instruction. Editable fields on narrow touch layouts use at least 16 CSS pixels. Use tabular figures for aligned counts and times, and ordinary text for prose.

Use a 4-pixel spacing basis with a shared set of 4, 8, 12, 16, 24 and 32 pixels. Use smaller gaps within a control or row and larger gaps between tasks. Related content should be visibly closer together than unrelated sections. Use theme surfaces and shared border-radius roles; reserve elevation for overlays. Avoid cards nested inside cards and large empty bordered panels around a few lines of content. Source, issue and action dialogs share 24-pixel desktop and 16-pixel narrow insets, 16-pixel section gaps and a visible header while scrolling. Issue dialogs show supporting evidence directly, with no Details expander. Non-entity source dialogs can use one optional Details region containing ordinary headings and lists, with no nested source, check or technical disclosures. Affected names, conditions and short source lists stay visible. Entity details keep relevant actions and one Monitoring policies action visible without a Details disclosure. State each active control and expiry once. Keep the destination picker's single scrolling body.

Keep page content, headings, field labels and row text left-aligned. Use consistent row anatomy: name and useful context, current condition or saved state, then applicable actions. Prefer quiet separators over repeated boxes. Keep primary actions visible; put infrequent actions such as Duplicate and Delete in a labelled menu. A policy name that opens its editor is a link, not an unexplained badge-shaped button.

## Navigation and continuity

Every meaningful page, source, issue, policy, method and retained history record has a stable destination. Browser Back and Forward restore the previous task. Refresh and direct links restore the intended object or show a useful unavailable state. Preserve supported notification links during the transition.

Opening an editor from a source provides Back to [source name]; opening it from a list returns to that list. Preserve grouping, filter, search, expanded branches and reading position during that journey. Do not put each search keystroke or disclosure toggle into browser history; retain these as view state. Navigation does not imply save or discard. Leaving Homeostatic for another Home Assistant page and returning in the same tab retains the signed-in administrator's pending drafts. Drafts stay in memory; browser reload, tab closure or a different signed-in user ends that session.

Issue entry points in Monitoring and Open issues use one shared dialog. A known device has one View opening its current issues whose complete ownership resolves to that registry device, whether the problem is partial availability, missing evidence or another condition. An unattached entity and exact episode link retain the original issue scope. Wider or unknown issue scopes must not join a device response. Preserve exact issue identities and complete action scopes. The Monitoring device inspector and shared dialog each provide one outlined Open device action, without a second link to that destination in either view. Closing returns to the source or list with filters, grouping, expansion and reading position intact, and restores focus to the initiating control. Selecting a tree row and expanding its children are distinct actions. Live updates preserve selection, focused field, cursor position and scroll position without reordering the item being investigated or moving keyboard focus.

On narrow screens, the list and detail become successive views with a clear return route. Page tabs wrap into additional rows when needed, keeping every destination visible. Avoid horizontal scrolling for ordinary forms and nested scroll areas that trap navigation. A bounded destination picker or modal can scroll when its context and actions remain accessible.

## Identity, counts and terminology

Names describe real sources. Use available friendly names and location to disambiguate; keep raw identifiers in secondary or technical detail unless no useful name exists. Within a device, shorten repeated prefixes where the child stays identifiable. Do not fabricate a room, name or relationship.

List labels and counts must help identify a problem, assess its evidence, or choose an action. Omit internal grouping labels and repeated cross-device counts when they add no decision value. Open issues does not label each device finding Shared issue. Keep useful affected-source counts, and show the complete acknowledgment and notification-pause scope beside those controls in the opened issue.

Under a healthy integration, device issues and their controls remain independent. Opening a device's issue must not introduce unrelated devices. A confirmed integration failure may include its affected devices; its evidence and controls retain that complete scope.

Source details share compact spacing and a clear reading order. Entity details lead with a small Entity label, the full name, meaningful location and current Home Assistant condition in plain language. Labeled Device and Integration names link to their actual Home Assistant destinations, independently of tree grouping; omit unknown relationships and repeated destination actions. Show actual monitoring coverage concisely, preserving device-only contributions and other conditions, followed by related issues and contextual availability actions. One quiet Monitoring policies action opens a contextual dialog with contributing policy roles and editing links. Omit unassigned location placeholders and Availability/Monitoring fact grids. Keep current evidence distinct from monitoring coverage: an excluded entity can still be unavailable in Home Assistant. Keep missing evidence, independent condition checks and active equipment controls visible. Entity details have no Details disclosure, raw technical block or history footer. Other source types retain their visible policy actions and show useful affected-member evidence directly. Additional readings or technical information may share one Details section only when both the content and its disclosure pass the purpose test. In grouped lists, keep a full entity name when it matches the device name; shorten a repeated prefix only when the remainder still identifies the entity. Use Entity availability for the entity availability policy in examples; actual saved policy names remain user-defined.

The Monitoring toolbar presents Search, Monitoring status and More filters in that order. More filters opens a labelled anchored panel without rearranging the toolbar; its active state stays visible, Escape dismisses it and returns focus, and updates preserve its controls. Group by and a stable Collapse groups button belong immediately above the tree. Collapse groups affects only tree expansion. On narrow screens, keep these controls with the tree view and retain the selected source when returning from details.

The Monitoring tree uses an Issues badge and omits numerical totals. The device inspector orders identity and availability, monitored entity rows, then monitoring coverage. Its availability summary reads x of y monitored entities available, with one View opening the same current device issue set as Open issues. It stays available without an aggregate availability issue, including when only entity or other condition issues remain. The denominator is the device's monitored availability membership and the numerator follows existing evidence classification. Preserve separate unavailable and missing/restored findings. An entity count never substitutes for an issue count or evidence of another condition.

Use one compact row per monitored entity with its actual name linked to Home Assistant and useful current status; allow wrapping on narrow screens. These rows have no separate View buttons or Homeostatic issue popups. Individual response exceptions use selection in the combined dialog. Omit repeated Unavailable row labels only when the summary already conveys that uniform current state. Keep concise row status where it distinguishes mixed availability or missing/restored evidence, and never infer availability from the absence of an issue. Unattached entities and exact episode links retain their original scope; wider issues can remain visible in several contexts. Entity, device, integration and group inspectors do not duplicate acknowledgment, notification-pause or issue-response forms. Those controls belong to the shared issue dialog. Source status, coverage, contextual policy editing and supported availability changes remain in Monitoring. The badge never asserts that a containing device or integration is unavailable.

Open issues indents each device beneath its integration and its findings beneath that device. Group by Home Assistant registry identity, never its name. Show the device name once, with one View at the heading; findings retain their capability or check labels and conditions without separate popup controls. Integration summaries name affected devices; device summaries count distinct issues. Only an issue's complete, known single-device ownership permits it to join that device's response set. Wider integration failures and unknown or cross-device issue scopes retain their complete original view. Registry connection ownership determines the integration. Entities without a device remain directly reachable. Pagination retains one heading per device and identifies any partially shown set; View opens the whole device set, not just the visible page or search matches. Keep the queue free of separate availability counts and Stop monitoring actions. Place outlined Stop monitoring after acknowledgment and pause in the dialog, with its exact availability scope in a separate confirmation. Policies: and Notifications: sit beside named outlined editor buttons and wrap naturally. Deduplicate saved identities, preserve Back to issue and show unconfigured or disabled notification status only when established by relevant configuration. Omit the generic View in Monitoring action.

Counts name their unit and scope: investigation groups, unique issues, devices, distinct entities or checks. Deduplicate real entity identity before displaying an entity total. Independent policy checks retain their own identities in check details. An investigation group can contain several issues; one engine issue can contain several recorded findings. Label those measures separately and make each advertised set inspectable. An issue shown in multiple contexts contributes once to the global issue total.

| Avoid as a standalone message | Prefer |
| --- | --- |
| Related sources need attention | The affected names and their specific reported conditions, grouped under a device where known. Count devices separately from entities without a device; avoid a combined total of device summaries and their entities. |
| Separate check | Checked by [policy name], with the check type and its purpose. |
| Included with device | Used by this device's availability check, with the responsible policy. |
| Not selected | Not included in this check; show any other checks separately. |
| Problem actions | Direct actions such as View issue, Acknowledge issue or Pause notifications. |
| Change monitoring leading to a generic policy list | Edit policy beside its name, or a choice among the applicable policies. Follow the [policy editor layout](policy-editors.md#policies). |
| Delivered | Notification requested, Request failed or another outcome supported by the provider evidence. |

Use notification consistently for outgoing messages and their controls. Use Acknowledge issue for one issue and Acknowledge selected for a collective selection; show the count with the issue selection. Use Pause notifications with the same explicit selected scope. Use Stop monitoring for contextual stopping actions and confirmations, separately from issue selection. A button that opens a confirmation or a choice ends in an ellipsis, such as Pause notifications…, Stop monitoring… or End maintenance…; the button that completes it does not. Explain its exact availability scope and continuing independent checks in the confirmation. Resume availability monitoring retains its existing label. Reserve Remove and Delete for actual removal of an assignment or definition. Use sentence case, plain verbs and one consistent term for each concept. Explain technical distinctions at the point they affect a decision. Avoid generic Next step paragraphs when a named action is available. Help and optional integration promotion must not occupy the main path through every task.

## Issue and history presentation

The agreed investigation-group direction is defined in the [product specification](product-specification.md#issue-identity-and-investigation-groups). A group summary names its context, observed condition and typed affected counts. Its disclosure reveals the underlying issues without changing their identity or action state. Label a failed integration differently from an integration containing unavailable devices. Grouping alone never establishes a failure of the parent.

An issue begins with the affected object or scope and the observed condition. Follow with affected entities or other explicitly named types, notification behavior and actions. Include times only when they help interpret that evidence; omit the combined device header's earliest-issue Opened date. Exact issue and History views retain individual chronology. Technical detail is secondary. Prefer a concise observed fact such as Home Assistant reports this light unavailable to an unexplained entity fraction.

The shared device dialog shows one Device heading and its current independently owned issues, including availability and other conditions. It does not require an aggregate device issue. Group child rows under Entities on this device and show actual entity names in the same style; keep distinct conditions on one entity distinguishable. Omit special media-player labels and domain annotations. Keep each issue's acknowledgment and pause state visible. Several issues start selected. One current issue uses direct actions without a checkbox, selection count, repeated issue-name row or redundant issue heading. An unattached entity or exact episode link opens that issue alone with the same response area. Exclude other devices and wider or unknown ownership. [ADR 0094](adr/0094-one-device-issue-workflow.md) owns this shared entry boundary.

When several issues are shown, put one All issues master checkbox above all issue rows, with normal body-size text and the selected count alongside. Each issue row has a checkbox. The master selects or clears the currently shown actionable issues and displays checked, indeterminate or unchecked state for all, partial or zero selection. Provide one acknowledgment/pause action area with equal-width adjacent buttons, matching heights and padding. Keep Open device outlined. Use compact gaps, retaining a distinct Stop monitoring area. Preserve checked and unchecked choices while selection remains applicable and after actions. Later arrivals and replacement issues remain unchecked; ended issues are no longer actionable. Zero selected disables both actions. Submission captures the selected current issue IDs, or the displayed current issue ID when only one remains; changes to the view never alter a pending submission's captured IDs. Retain per-issue results, including failures. Acknowledgment does not clear issues; pause affects only the submitted IDs until the chosen expiry. Stop monitoring has its own availability confirmation and never takes its scope from these checkboxes. The confirmation heading names the operation and entity count, followed by the exact visible entity names and a concise statement that other checks continue. It has no Details disclosure or repeated policy list; the issue dialog retains policy editor access. [ADR 0093](adr/0093-explicit-device-availability-issue-selection.md) records this selection contract.

Affected lists include all recorded members relevant to the scope, even when another source heads the grouped issue. Large lists can use progressive loading or a dedicated list view; show the total and a usable route to every item. Avoid circular links between a shortened dialog and a source page that lacks the full set.

Current unavailability can exist without a separate open device issue, for example when the finding belongs to a grouped issue or the check is not monitored. Say which relationship applies when known. Do not invent an issue solely from the displayed current value.

History rows lead with condition and outcome, followed by the date/time and useful duration. Use readable dates, installation time zone where relevant, and an absolute timestamp available alongside any relative time. Separate Opened, Last observed and Outcome recorded; a page refresh time is not a failure start time. Preserve historical names and findings.

Show open related issues separately from retained ended issues. Use plain outcomes such as Condition cleared, Monitoring ended or Grouped into another issue. Retention and collection limits belong in a compact History coverage disclosure. If collection or association is incomplete, say No retained problems found and expose the applicable coverage; do not state that the source never had a problem. Do not fill empty history screens with paragraphs of repeated caveats.

## Notification and temporary-control explanations

For a source, explain configured behavior per check. For an open issue, list the saved named notifications assigned through its covering policies, each once, with a button opening its editor. A Custom notification opens its owning policy. Show absent assignments, disabled sending and unconfigured delivery when established by actual relevant configuration. Configuration warnings require that evidence; if configuration is unavailable, describe only that limitation. Prototype fixtures must be identified as examples and cannot establish live installation state. Evaluated timing status and internal route or check identities never substitute for a saved notification name. Scheduled summaries can continue after acknowledgment of reminders. Presence can change before a future request, so a current destination preview does not guarantee a later destination.

| Action | Required explanation |
| --- | --- |
| Acknowledge issue / Acknowledge selected | Records awareness for the selected issue identities and stops their acknowledgment-dependent repeats; issues remain open and other applicable notification behavior can continue. |
| Pause notifications | Applies only to the selected issue identities and their recipients for the chosen 1, 4 or 24 hours; issues remain open and later issues inherit no pause. |
| Resume notifications | Ends this named pause; other overlapping controls can remain effective. |
| End maintenance | Ends this named maintenance period; problems still present may open immediately, and other overlapping periods can remain effective. |
| Send test | Uses this saved unchanged method and current presence. It can request a test while ordinary issue notifications are off. |

Pause forms disclose target and duration before submission. Show the confirmed applied scope and expiry afterward. Maintenance creation has no panel entry point or form. Active maintenance periods remain visible with their target, expiry and End maintenance action. Unsupported actions are absent; temporarily unavailable actions include a reason. Request failures and destinations currently unavailable are different information and must not be conflated.

## Loading, empty and error states

| State | Required response |
| --- | --- |
| Loading initial data | Name what is loading; do not briefly present zero issues as a completed result. |
| Refreshing with previous data | Keep useful content, identify its age or last-known status, and preserve the user's task. |
| No open issues | State the monitoring scope and keep sending/current-data status visible. |
| No matching results | Identify the active filter and offer to clear it without changing monitoring. |
| Nothing monitored | Explain the absence of active monitoring and offer the relevant policy setup action. |
| Notifications intentionally off | Show the saved state neutrally and the scoped enable action; monitoring context remains visible. |
| No current evidence | Name what cannot be determined and when evidence was last available, if known. |
| Validation failure | Keep inputs, identify the field and explain how to correct it. |
| Permission or capability limit | Explain the actual limit and a supported destination or action. |
| Read or action failure | Identify the failed operation and preserve useful context; retry only when its outcome and safety are known. |

## Accessibility and responsive review

Target WCAG 2.2 AA. Use native or accessible Home Assistant controls with visible labels and correct roles. Switches support Space and expose their state. Navigation, trees, disclosures and dialogs support keyboard operation without requiring hover. Dialogs manage focus, close predictably, and restore focus to the initiating control. Mark selected tabs and expanded branches semantically.

Normal text needs at least 4.5:1 contrast; qualifying large text needs at least 3:1. Required control boundaries, meaningful icons and state indicators need the applicable non-text contrast. Verify actual light and dark theme combinations. These thresholds come from [text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Use 44 by 44 CSS pixel effective targets for primary touch interactions as the product target. WCAG's AA minimum is 24 by 24 CSS pixels with specified exceptions; do not confuse the two. Dense desktop layouts still need adequate target size and separation. See [target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Review ordinary content at 320 CSS pixels wide and at enlarged text/zoom without loss of information or required horizontal scrolling. Reflow lists and forms while preserving reading order. See [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Use polite status announcements for saves and state changes; reserve alerts for actionable errors and avoid announcing every live update.

## Component review checklist

Before a pattern enters the shared UI, identify the page or dialog that owns its task, then apply the [purpose test](#purpose-before-controls) to its visible elements and destinations. In the existing review record, state what the change adds to the user's understanding or ability to act, which existing workflow it reuses, and why any retained disclosure or extra screen is useful. Remove duplication found by comparing the starting view with its destinations. A working control does not establish that it belongs in the interface.

Document the retained pattern's variants, states, labels, keyboard behavior, narrow layout and confirmation of saved state. Review a switch, a policy row, an issue summary, an affected-entity list, a source detail, a method editor and a history row together so their conventions agree.

Validate each against the [product review journeys](product-specification.md#review-scenarios-and-completion-criteria), including unavailable data, pending operations, failed saves, shared-method changes and unsaved navigation. Use the same criteria for automated scenarios, isolated browser walkthroughs and authorized pilot review.
