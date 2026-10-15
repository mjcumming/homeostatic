# Homeostatic UI standards

Status: Accepted interaction baseline, October 14, 2026.

This reference defines the shared interaction standards for the [product specification](product-specification.md). Apply them across pages, embedded editors and narrow layouts during refactoring. The [integration specification](spec.md) owns current behavior, and the [roadmap](roadmap.md#current-work) owns implementation and acceptance status. The [design decision](adr/0061-issues-first-product-workflows.md) records the changed presentation and action scopes.

## Control selection

| Control | Use | State and label |
| --- | --- | --- |
| Switch | An immediately applied binary operational setting, such as global notification sending | Stable subject label, explicit On/Off text, and a position reflecting confirmed state. Pending action is separately labelled. |
| Checkbox | A draft boolean field, optional feature or independent selection within an editor | The label describes the selected option. Save applies it. Use an indeterminate state only for an actual partially selected group. |
| Radio group | One choice among a small visible set | Label the group and each alternative; show the saved or draft context. |
| Select or searchable picker | Longer supported choices, including source and destination selection | Preserve selections through search; show the selected set and any unavailable saved choices. |
| Action button | A command, such as Save policy, Acknowledge issue, Send test or Start maintenance | Name the result or operation. Do not use its fill as the indication of current enabled state. |
| Link | Navigation to an issue, source, editor, history record or Home Assistant page | Name the destination. Give meaningful destinations real routes and link semantics. |
| Disclosure | Optional detail within the current task | Its label describes the hidden content. Expansion does not select, save or change monitoring. |
| Tabs or segmented navigation | Sibling views with distinct useful content | Show selection separately from keyboard focus; preserve the selected object. Do not create an empty tab just to redirect elsewhere. |

Use a stable label such as Notifications for its switch; the accompanying state changes between On and Off. Do not alternate the switch's accessible name between Turn on and Turn off. This follows the [W3C switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/). Choosing switches for immediate actions and checkboxes for draft fields is a Homeostatic design convention.

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
| Saving | Identify the submitted scope, prevent duplicate submission and preserve any newer draft edits. |
| Saved | Notifications and delivery-method editors return to their matching list and focus the saved object's Edit action. Other editors remove dirty controls and retain contextual return. Do not leave persistent saved messages or success banners. Newer edits or navigation during saving prevent an automatic return. |
| Edited again after saving | Restore dirty controls. |
| Discarded | Restore an existing object's saved baseline in place and remove dirty controls. For a new object, abandon the unsaved draft and return to its origin. Earlier completed saves remain saved. |
| Failed or conflicted | Retain the draft, name the error and keep correction or reconciliation available. |

Show Unsaved changes beside the editing task. Field labels stay visible; placeholders supplement labels. Provide required indicators, units and supported ranges next to inputs. Put validation beside the field and an error summary where useful. Move focus to the relevant error after submission; keep the draft and correctable input intact.

Save validates and applies the submitted draft once. A confirmed policy save finishes the action; do not retain an Undo control or a separate reversal record. Keep concurrency and rollback protection behind that action, with no compulsory review screen. Show Saving while pending. Do not attribute changes typed after submission to the completed save; retain them as a newer draft. If applying succeeds but refreshing fails, say that settings were saved and current data could not be refreshed.

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

Use a 4-pixel spacing basis with a shared set of 4, 8, 12, 16, 24 and 32 pixels. Use smaller gaps within a control or row and larger gaps between tasks. Related content should be visibly closer together than unrelated sections. Use theme surfaces and shared border-radius roles; reserve elevation for overlays. Avoid cards nested inside cards and large empty bordered panels around a few lines of content. Source, issue and action dialogs share 24-pixel desktop and 16-pixel narrow insets, 16-pixel section gaps and a visible header while scrolling. Issue and non-entity source dialogs can use one optional Details region for supporting information. Entity details keep policies and relevant actions visible without a Details disclosure. State each active control and expiry once. Preserve affected-member disclosures and the destination picker's single scrolling body.

Keep page content, headings, field labels and row text left-aligned. Use consistent row anatomy: name and useful context, current condition or saved state, then applicable actions. Prefer quiet separators over repeated boxes. Keep primary actions visible; put infrequent actions such as Duplicate and Delete in a labelled menu. A policy name that opens its editor is a link, not an unexplained badge-shaped button.

## Navigation and continuity

Every meaningful page, source, issue, policy, method and retained history record has a stable destination. Browser Back and Forward restore the previous task. Refresh and direct links restore the intended object or show a useful unavailable state. Preserve supported notification links during the transition.

Opening an editor from a source provides Back to [source name]; opening it from a list returns to that list. Preserve grouping, filter, search, expanded branches and reading position during that journey. Do not put each search keystroke or disclosure toggle into browser history; retain these as view state. Navigation does not imply save or discard.

Opening a grouped issue from a device does not lose the device context. Selecting a tree row and expanding its children are distinct actions. Live updates preserve selection, focused field, cursor position, expanded details and scroll position. Updates do not unexpectedly reorder the item being investigated or move keyboard focus.

On narrow screens, the list and detail become successive views with a clear return route. Avoid horizontal scrolling for ordinary forms and nested scroll areas that trap navigation. A bounded destination picker or modal can scroll when its context and actions remain accessible.

## Identity, counts and terminology

Names describe real sources. Use available friendly names and location to disambiguate; keep raw identifiers in secondary or technical detail unless no useful name exists. Within a device, shorten repeated prefixes where the child stays identifiable. Do not fabricate a room, name or relationship.

Source details share compact spacing and a clear reading order. Entity details lead with the name, meaningful location and current Home Assistant condition in plain language. Show actual monitoring coverage in a concise sentence, followed by related issues, policy links and contextual availability actions. Omit unassigned location placeholders, repeated type labels and Availability/Monitoring fact grids. Keep current evidence distinct from monitoring coverage: an excluded entity can still be unavailable in Home Assistant. Keep missing evidence, independent condition checks, supported equipment maintenance and active equipment controls visible. Entity details have no Details disclosure, raw technical block or history footer. Native links near identity name their actual destination and preserve known device/integration context. Other source types retain useful evidence and affected-member disclosures. Use Entity availability for the entity availability policy in examples; actual saved policy names remain user-defined.

The Monitoring toolbar presents Search, Monitoring status and More filters in that order. More filters opens a labelled anchored panel without rearranging the toolbar; its active state stays visible, Escape dismisses it and returns focus, and updates preserve its controls. Group by and a stable Collapse groups button belong immediately above the tree. Collapse groups affects only tree expansion. On narrow screens, keep these controls with the tree view and retain the selected source when returning from details.

The Monitoring tree uses an Issues badge and omits numerical totals. Selected details list each related issue once; a shared issue can appear in several groups. The badge never asserts that a containing device or integration is unavailable.

Open issues indents each device beneath its integration and each individual finding beneath that device. Group by Home Assistant device identity, never by its name. Show the device name once and use capability or check labels for its findings. Integration summaries name affected devices; device summaries count their independent issues. A reported integration failure or an issue spanning several devices, standalone sources or unknown recorded sources remains at integration level. A loaded integration issue whose complete recorded membership belongs to one device joins that device heading. Registry connection ownership determines its integration. Entities without a known device remain directly reachable. Pagination retains one heading per device and identifies any partially shown set. Keep availability-monitoring removal after the findings as a secondary group action.

Counts name their unit and scope: investigation groups, unique issues, devices, distinct entities or checks. Deduplicate real entity identity before displaying an entity total. Independent policy checks retain their own identities in check details. An investigation group can contain several issues; one engine issue can contain several recorded findings. Label those measures separately and make each advertised set inspectable. An issue shown in multiple contexts contributes once to the global issue total.

| Avoid as a standalone message | Prefer |
| --- | --- |
| Related sources need attention | The specific reported condition and a link to Affected entities, Affected devices or the relevant named type. Separate unlike types when needed; avoid the generic Items label. |
| Separate check | Checked by [policy name], with the check type and its purpose. |
| Included with device | Used by this device's availability check, with the responsible policy. |
| Not selected | Not included in this check; show any other checks separately. |
| Problem actions | Direct actions such as View issue, Acknowledge issue or Pause notifications. |
| Change monitoring leading to a generic policy list | Edit policy beside its name, or a choice among the applicable policies. The editor title is Edit policy: [name]. |
| Delivered | Notification requested, Request failed or another outcome supported by the provider evidence. |

Use notification consistently for outgoing messages and their controls. Use Acknowledge issue because it records awareness of the issue; use Pause notifications because it temporarily holds messages for that issue. Name contextual removal and resumption as availability monitoring so the label does not imply that independent condition checks stop. Related issues in entity details open the complete issue before showing issue controls. Use sentence case, plain verbs and one consistent term for each concept. Explain technical distinctions at the point they affect a decision. Avoid generic Next step paragraphs when a named action is available. Help and optional integration promotion must not occupy the main path through every task.

## Issue and history presentation

The agreed investigation-group direction is defined in the [product specification](product-specification.md#issue-identity-and-investigation-groups). A group summary names its context, observed condition and typed affected counts. Its disclosure reveals the underlying issues without changing their identity or action state. Label a failed integration differently from an integration containing unavailable devices. Grouping alone never establishes a failure of the parent.

An issue begins with the affected object or scope and the observed condition. Follow with relevant times, affected entities or other explicitly named types, notification behavior and actions. Technical detail is secondary. Prefer a concise observed fact such as Home Assistant reports this light unavailable to an unexplained entity fraction.

Affected lists include all recorded members relevant to the scope, even when another source heads the grouped issue. Large lists can use progressive loading or a dedicated list view; show the total and a usable route to every item. Avoid circular links between a shortened dialog and a source page that lacks the full set.

Current unavailability can exist without a separate open device issue, for example when the finding belongs to a grouped issue or the check is not monitored. Say which relationship applies when known. Do not invent an issue solely from the displayed current value.

History rows lead with condition and outcome, followed by the date/time and useful duration. Use readable dates, installation time zone where relevant, and an absolute timestamp available alongside any relative time. Separate Opened, Last observed and Outcome recorded; a page refresh time is not a failure start time. Preserve historical names and findings.

Show open related issues separately from retained ended issues. Use plain outcomes such as Condition cleared, Monitoring ended or Grouped into another issue. Retention and collection limits belong in a compact History coverage disclosure. If collection or association is incomplete, say No retained problems found and expose the applicable coverage; do not state that the source never had a problem. Do not fill empty history screens with paragraphs of repeated caveats.

## Notification and temporary-control explanations

For a source, explain configured behavior per check. For an open issue, show each applicable notification entry's current evaluated outcome, including the timing and named method. Scheduled summaries can continue after acknowledgment of reminders. Presence can change before a future request, so a current destination preview does not guarantee a later destination.

| Action | Required explanation |
| --- | --- |
| Acknowledge issue | Records awareness and stops acknowledgment-dependent repeats; other applicable notification behavior can continue. |
| Pause notifications | Applies to this issue and every recipient until the specified time; the issue remains open. |
| Start maintenance | Holds new problems for the supported selected scope until the specified time; current issues and their notifications continue. |
| End pause or maintenance | Ends this named control; other overlapping controls can remain effective. |
| Send test | Uses this saved unchanged method and current presence. It can request a test while ordinary issue notifications are off. |

Forms disclose target and duration before submission. Show the confirmed applied scope and expiry afterward. Unsupported actions are absent; temporarily unavailable actions include a reason. Request failures and destinations currently unavailable are different information and must not be conflated.

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

Before a pattern enters the shared UI, document its purpose, variants, states, labels, keyboard behavior, narrow layout and confirmation of saved state. Review a switch, a policy row, an issue summary, an affected-entity list, a source detail, a method editor and a history row together so their conventions agree.

Validate each against the [product review journeys](product-specification.md#review-scenarios-and-completion-criteria), including unavailable data, pending operations, failed saves, shared-method changes and unsaved navigation. Use the same criteria for automated scenarios, isolated browser walkthroughs and authorized pilot review.
