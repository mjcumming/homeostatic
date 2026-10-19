# Changelog

## [Unreleased]

### Changed

- Use one response area wherever an issue opens. An exact issue from a notification, Monitoring or History now offers the device dialog's Acknowledge and Pause, with Pause for 1, 4 or 24 hours, and both offer Resume while a pause is active. Acknowledging no longer opens a confirmation, and pausing no longer asks for an end date, time or reason.
- Link Monitoring entity and device details to their related issues with View issue instead of repeating each issue's acknowledgment and pause controls there.
- Use sentence case for Open entity, Open device and Stop monitoring…, which ends in an ellipsis because it opens a confirmation.
- Remove Standard notification batching from Settings. It applied only to retired Custom assignments; the saved value is kept.

### Removed

- Remove the automation and template blueprints: Companion notifications, problem logbook, alert, situation report and diagnostic state. Automations can still use Homeostatic's events and actions directly.

### Documentation

- Rewrite the README and the manual in fewer, shorter pages, and trim the roadmap to open work.

## [1.11.0] - 2026-10-18

### Upgrade notes

- Saved device availability policies become entity policies while preserving their identities, names, enabled states, exclusions and notification assignments. Broad device scopes retain the existing devices and their future entity members. Take a full Home Assistant backup before upgrading; recovery requires the matching backup and component version.

### Changed

- Remove device availability policies and inferred device status. Existing policies retain their coverage and notifications as entity availability policies.
- Select entity availability in one searchable list grouped by integration and device, with individual and group checkboxes, ordinary Save/Discard and no nested picker.

- Add an Entities not provided policy for enabled registrations that a loaded integration persistently fails to provide. Its configurable wait starts at 24 hours; issues link to the entity in Home Assistant without deletion controls. The supplied policy is enabled on fresh setup with Morning summary; existing saved policy lists remain unchanged.

- Device dialogs identify unavailable entities and missing or restored readings even when no issue is open, and include policies covering the device's entities. Availability saves accept unchanged settings returned with a different JSON field order while retaining conflict checks for changed values.

- Shorten device issue actions to Acknowledge and Pause, and use consistent accent-colored outlined buttons throughout issue dialogs.

- Keep availability issues with only missing or restored current readings out of Open issues, even when an earlier failure remains in Monitoring. Current warnings and failures remain visible.
- Apply the same current-evidence rule to Monitoring issue badges: a retained earlier availability failure followed only by missing or restored readings does not mark the device or its location as a current problem. Unmonitored entities remain neutral.

- Compact device rows in Open issues keep the device, problem and opening time together, omit redundant entity headings and single-issue counts, and retain one View action per device.

### Fixed

- Keep the supported reset of older named-notification settings working when those settings contain a published device availability policy. Invalid settings still fail without reset.

## [1.10.0] - 2026-10-18

### Upgrade notes

- This release replaces older Homeostatic settings that lack collection delays with a fresh default configuration. Custom policies, notification assignments and delivery methods are replaced; notification sending starts off. Review the new policies and configure destinations before enabling sending. Saved issue history is retained. Take a full Home Assistant backup before upgrading; rollback requires the matching backup and component version.
- Use the published health-tree 0.10.0 package. The manual archive now includes this changelog alongside its installation guide.

### Changed

- Supply editable General entity availability using Morning and Important equipment availability using Immediate. Their saved metadata selections cover future entities independently, and confirmed integration failures retain affected equipment's configured availability notifications.
- Collect requests using the same saved notification, recipient and destination during a fixed, editable delay. Immediate starts at 60 seconds, Immediate with acknowledgment at 5 seconds and daily-hours delivery at 60 seconds; zero sends without waiting and scheduled reports have no extra delay. Pending membership, accepted destinations and deadlines survive restart.
- Replace the minute reconciliation with a sweep every 15 minutes and observe only the sources whose events arrived in between: a config-entry update that changes nothing visible no longer refreshes, and the startup hold ends on its own clock. Idle work falls to the rate of real changes.
- Persist route signatures as digests and evidence as the last known failure only, rebuild the current observation on the first refresh after a restart, and skip a save whose content equals the last verified write. The saved state of a large installation shrinks by about a third.
- Keep one map of each source's latest observation for every detail view, persisted as a single evidence section that keeps a continuing failure's first report; earlier snapshots with two evidence sections still load.
- Use health-tree snapshots that hold durable state only, so a quiet refresh produces the same bytes as the last save and writes nothing; earlier saved state restores.
- Stop copying the runtime before every settings save. A save whose write or verification fails now reports the error and reloads the integration from the last saved state instead of rolling back in place.

### Documentation

- Record the core design audit and the durable-facts persistence boundary, and note in the install guide that the saved state grows with the installation.

## [1.9.0] - 2026-10-17

### Changed

- Save evidence-only refreshes at most every 15 seconds while requests, issue changes, settings and shutdown still save at once, and verify saves by comparing the stored bytes, parsing the file only when they differ.
- Patch the monitoring catalog in place when a small change arrives instead of reloading every page, and keep the catalog revision when a refresh republishes equal content.
- Use the same device issue dialog from Open issues and Monitoring. One View opens the current issues belonging to that device, including partial availability and other conditions. Acknowledge or pause them together, with individual exceptions and direct controls when only one issue remains. Entities without a device retain their own issue view.
- Limit policy source picker rendering while keeping search complete, reuse unchanged source indexes, and coalesce detail refreshes. Open issues loads its current context before the full monitoring catalog is needed.
- Simplify opened issues with visible evidence and named Policies and Notifications buttons with a return to the issue. Keep Open device secondary, align the action pair and editor rows, and omit the combined opening date, Details expander and generic Monitoring link.
- Name contextual availability-stopping actions Stop Monitoring throughout the interface. Use an outlined button in opened issues and show the exact entities directly in the confirmation, without a Details expander or repeated policy list; other checks continue.
- Separate whole-device selection from ignored entities in device availability policies. Group ignored entities under their device and retain those choices when changing device scope.

### Fixed

- Re-evaluate the last registry scan when a monitoring edit changes only exclusions, keeping the decisions of candidates the edit does not name, instead of reading every registry entry and deciding every candidate again.
- Reuse unchanged candidate rows when a monitoring edit changes enrollment rules instead of serializing every candidate again, which was most of the remaining save time on large installations.
- Read each device's owning integration through the current Home Assistant registry field. On Home Assistant 2026.10 every save and every minute's background refresh spent most of its time in deprecation reporting for each of the installation's devices, which held up the panel for several seconds.
- Keep Monitoring and the evidence-gap sensor available when coverage contains stale or never-observed checks.
- Keep settings and their revision consistent when another editor reads during a save or rollback, preventing an accepted edit from being silently overwritten.
- Avoid installation-wide source discovery for ordinary temperature readings, unrelated climate updates and policy renames. Preserve issue history, queued evidence and notification instructions.

### Documentation

- Record the accepted refresh and configuration-read boundaries and finalize the catalog-loading decision.
- Define the built-in policy scope around Home Assistant and equipment problems plus common household monitoring needs; leave specialized conditions and individual command-completion checks to Home Assistant automations.

## [1.8.3] - 2026-10-16

### Fixed

- Keep unavailable devices independent when their integration is working. Preserve genuine integration-outage grouping, then separate remaining failures after recovery. Existing grouped issues retain their history and active controls through an explicit separation that does not claim device recovery.
- Remove inactive problem-grouping controls from Settings and show separated issues truthfully in History, with links to their continuing issues.

### Upgrade notes

- Use health-tree 0.8.0 for independent issues and preserved controls during separation. Existing settings remain supported. Saved history now includes separation metadata that older versions cannot read, even when no issue separates; any rollback must restore matching saved state and component/library versions together.

## [1.8.2] - 2026-10-16

### Changed

- Simplify entity details with linked device and integration names, concise condition and monitoring text, and one Monitoring policies action for contributing policies and their editors.

- Remove repeated Shared issue labels from Open issues. Keep the complete affected scope beside acknowledgment and notification-pause controls.

- Remove Working on this equipment and its maintenance-creation form from the panel. Existing maintenance windows remain visible and can be ended; Home Assistant maintenance actions remain available.

- Show affected names and conditions directly in issue and source details. Keep supporting information in one flat Details section, retain entity names that match their device, use readable notification names and remove repeated findings and navigation links.

- Group shared availability findings under their devices, show checks waiting for information as supporting context, and retain previously reported problems through unavailable states and reloads. Vacuum messages now identify the actual Home Assistant state. Shared device rows no longer infer recovery from a loaded integration.
- Add a small help icon beside Delivery type with a brief popover explaining which destinations appear and linking to Home Assistant email and SMS setup.

## [1.8.1] - 2026-10-16

### Changed

- Replace the policy Include dropdown with visible radio choices and a selection action beside the chosen scope, with full-row touch targets on phones.

### Documentation

- Replace the accumulated user guide with a task-based manual covering first setup, issues, monitoring policies, notifications, equipment checks, History and installation maintenance. Lead the README with practical reasons to use Homeostatic, separate everyday settings from advanced interfaces, refresh navigation and illustrations, and retire automation-alert setup instructions while that feature remains unfinished.

## [1.8.0] - 2026-10-15

### Upgrade notes

- Publish the unified-policy interface as a stable release. Existing unified-policy settings, Custom notification assignments and disabled sending remain unchanged. The retired pre-policy configuration used by 1.7.x requires a backup and fresh setup; it is not automatically converted or erased.
- Newly recorded history includes original source ownership. Existing history loads unchanged, but rolling back to an older build after new records are written requires restoring the matching backup.

### Fixed

- Retain unfinished editor drafts when leaving Homeostatic and returning in the same browser tab, including completion of an already pending save without sending it twice. Separate users and browser reloads start a new draft session.
- Keep removed sources in their recorded parent's history, preserving original names and ownership across later registry changes and reloads. Older records without that metadata retain their existing limited association.
- Wrap navigation tabs when the available width or enlarged text requires another row. Keep the complete Summary time control readable by allowing its timezone label to wrap.
- Restore availability-removal feedback after reconnecting when the opened issue has already ended, with confirmation disabled and cancellation still available.
- Let embedded dashboard cards load again after their connection or permissions change, clearing stale editing state and ignoring obsolete pending responses.

- Keep availability removal inside an opened issue, with confirmation scoped to its current unavailable entities. Remove the separate count and action footer from integration groups; closing the issue discards an unsaved review.

- Group Open issues by registry device beneath every integration, with each device named once and its individual findings indented underneath. Preserve separate issue actions, standalone entities, shared integration findings, search and bounded pagination.

- Make policy notifications compact, with grouped timing and delivery details, an explicit Add notification choice and Remove on every row. Removing the last entry shows No notifications and saves that choice. Adding back to an empty UPS reserve policy supplies its required power condition.

- Reduce policy-save work by reusing unchanged serialized source and catalog presentation, while preserving current discovery, detection, queued observations, verified storage and rollback.

- Simplify Monitoring to one Issues badge on affected tree rows, with no numerical tree totals. Selecting a row lists each related issue once and explains shared issues across groups.

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Keep Monitoring tree arrows beside the first line of the source name. Align wrapped device details beneath that name and keep issue badges within narrow rows.

- Explain individual temperature issues with their reported reading, limits and duration instead of “Limited in Home Assistant.” Keep the source name, acknowledgment and pause actions prominent, with compact policy links and optional navigation under Details.

- Avoid a full inventory scan on every acknowledgment and operator action when the inventory is current. Preserve queued evidence, due timers and verified storage before confirming success.

- Show temperature policies, waiting intervals and current findings on their sensor and device. Keep temperature checks out of the separate Other sources group while preserving existing issue links and independent policy timing.

- Omit unset temperature limits from policy summaries instead of displaying null as a temperature.

### Changed

- Simplify entity details to the current condition, actual monitoring coverage and visible policy actions. Open the complete related issue for acknowledgment and notification pauses; place destination-specific Home Assistant links beside the source identity and keep history on its own page.

- Separate Monitoring search and filters from tree grouping and collapse controls. Keep More filters in an anchored panel, name the status filter clearly, and make Collapse groups apply visibly to the tree.

- Use Pause notifications and Acknowledge issue consistently, and name availability monitoring in removal and resumption actions so other checks remain clear.

- Use compact source and issue dialogs throughout Homeostatic, with consistent spacing and clear action dialogs. Entity details keep policies and actions visible; issue and other source dialogs retain supporting details where useful. Show acknowledgment and active controls once without nested panels.

- Give battery and device details a compact layout with direct single readings and optional evidence under Details, and open Policies from battery monitoring configuration. Entity details state current evidence and monitoring in plain language.

- Put policy enablement beside the editor heading, bring labels next to their controls, and give temperature policies equal optional lower and upper limits. Show duration in minutes by default with exact unit conversion, a live rule summary, nearby validation and global sending status. Preserve sensor-picker scroll and focus, and use readable durations in policy summaries.

- Keep all monitoring states browsable with a visible All / Monitored / Not monitored filter. Show actual entity coverage and preserve inspection when filtering hides the selected source.

- Expand History entries directly in the list with concise recorded conditions and times. Remove the history dialog, repeated findings and generic clearing explanations while preserving source links, related issues and navigation.

- Clarify policy source choices with area context and searchable names, locations and identities. Show relevant area and label counts, retain selected empty groups, and compact the picker with full-width search and keyboard focus return.

- Order the Notifications list and notification pickers by saved delivery timing, with acknowledgment reminders first and scheduled summaries ordered by frequency and time.

- Return quietly to the matching Notifications list after saving a notification or delivery method. Keep failed saves and newer edits in the editor, simplify new-method headings, and keep test feedback tied to the method and saved destinations it tested.

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.

- Simplify Sources, Policies, Notifications, History and Settings: remove repeated actions and explanations, shorten list summaries, keep one editor return route, and put optional filters, technical timings and history information behind disclosures.

- Simplify the Issues list to one clickable entry per issue, with a recognizable name, condition and short opening time. Move recorded sources into issue details and remove duplicate list actions and reporting status.

- Simplify Working on this equipment with one explanation, explicit duration choices and optional custom time and settings. Show date errors only after editing and keep the chosen expiry during live updates.

- Simplify grouped availability issue details with one device action, collapsed entity lists, linked entity names and optional monitoring and connection details. Preserve standalone source names, mixed conditions and contributing checks.

- Restore History as a separate top-level page and remove Undo after saved monitoring changes. Use the shared accent for final Save actions and restrict hover surfaces to devices with hover input.

- Register new panel and generated-card versions with the updated frontend so an open Home Assistant session can load the corrected controls without reusing its old component.

- Compact the destination picker on phones: left-aligned selectable rows, a separate speech-provider step, one Close control and one scrolling area. Keep editor header styles inside their own editor.

- Remove unwanted availability monitoring from opened issue details. Show a short count-based confirmation with entity and policy details collapsed, and finish the saved policy change without retaining Undo.
- Simplify source removal wording and confirmation while preserving other checks and existing save safeguards.

## [1.8.0b7] - 2026-10-14

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Require health-tree 0.7.0 for compatible device notification grouping.
- Put source conditions and actions first, collapse policy explanations and technical details, and compact the phone header. Add scoped Stop monitoring availability, Resume, Undo, selected-device-member actions and an availability-exclusions filter. Related issue controls identify their complete scope.
- Monitor enabled operational entities automatically, including entities without devices. Diagnostic and configuration entities require explicit individual availability selection; device checks use operational members without a diagnostic fallback. Current off values remain available, including connectivity sensors.
- Apply the same operational-entity and current-state semantics in Sources and current issue details. Policy-specific evidence and counts honor exclusions; browsing alone does not label entities monitored.
- Add All except these to policy selection, retaining future matching sources and missing exclusions. Device policies can exclude whole devices or individual evidence members independently.
- Combine compatible device notifications into one continuing message while preserving separate issues, timing and controls. Partial recovery retains outstanding findings, and phone acknowledgment covers only the issues shown in that request.
- Hide disabled sources by default in Sources, with a Show disabled sources option and an explanation of paused monitoring and retained choices.
- Remove superseded Overview, coverage, source-enrollment and fixed-reporting screens, their handlers and unused modules. Retain supported links as routes into the current workspace.
- Remove the pre-policy configuration runtime, conversion helpers and obsolete configuration endpoints. Current unified policies and saved delivery methods retain their behavior; unsupported test schemas fail explicitly without resetting settings.
- Rebuild the dashboard around Issues, Sources, Policies and Notifications, with investigation groups, canonical source details, browser history and a persistent notification switch.
- Save policy, reusable-notification and delivery-method drafts independently; retain unrelated edits and omit save actions from clean editors.
- Add six reusable named notifications with editable timing and delivery choices, including a daytime urgent window and supplied policy assignments. On fresh setup, leave destinations unconfigured and global sending off. Preserve existing Custom notification assignments until explicitly changed; remove the obsolete inline timing and method editors.

### Documentation

- Remove retired notification-focused policy-view guidance and require a bounded UI control/path inventory with actual browser interactions, persisted-result checks and pass/fail/untested receipts. Keep isolated testing, bounded live checks and physical Safari acceptance explicit.
- Correct the historical save benchmark to identify inherited mocked storage. Record separate real-runtime-storage measurements, live endpoint timings and actual-button checks; distinguish the measured profile-save improvement from remaining shared-method reload and household-load costs. Keep fresh UI coverage separate from earlier acceptance evidence.
- Accept six reusable named notifications that own timing and delivery choices, policy assignments and supplied defaults, including a daytime urgent window. Record supported-inline preservation and the limited authorization for existing dashboard-only defaults; validation and installation remain tracked in the roadmap.
- Reconcile implementation status in the roadmap and require one owner across repositories, explicit handoffs for overlapping work, binding accepted decisions, retirement and complete-workflow verification.
- Consolidate development setup around the selected environment and preserve an explicitly installed sibling library during local checks; retain locked published dependencies for releases.
- Guard against restoring retired modules in the existing frontend checks.
- Discover frontend tests and packaged smoke-test assets from the files present, removing obsolete module and branch references.
- Remove an unused notification-method deletion implementation and leftover state from retired interface controls.
- Record the accepted operational monitoring and device-notification decision, update current selection and event contracts, and identify the health-tree library release required before publishing the adapter. Preserve the legacy-removal boundary and current navigation workflows.
- Consolidate the accepted Issues-first product specification, shared UI standards and policy/notification workflows. Record the earlier UI decisions superseded by the redesign and a phased refactor plan.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Preserve a device's open issue, acknowledgment, pauses and reporting clocks through entity additions, removals, disablement and re-enablement while monitored members remain, including across restarts. Saved exclusions that change its evidence still replace the affected check. Reject malformed saved continuity metadata and restore it with issue controls after a failed save.
- Keep unrelated check identities, open issues, acknowledgment, pauses and reporting clocks intact when excluding individual sources. Preserve existing persisted check IDs through a validated storage-envelope upgrade; stop/resume saves retain unrelated drafts and expose safe refresh after an uncertain response.
- Use Home Assistant person entity IDs for delivery-method presence choices, preserving separate internal person and user identities.
- Restore Working on this equipment and active-control cancellation in eligible Sources details, preserving the existing source scope, expiry and overlapping controls.
- Avoid forced source rediscovery for notification-only saves, read dynamic inventory once per dashboard publication and skip direct-destination discovery when no direct phone or notify channel is configured. Retain fresh checks for direct destinations, dirty-inventory reconciliation, pending observations, policy evaluation and verified persistence.
- Reuse unchanged integration catalog metadata for lifecycle updates while retaining failure and recovery observations; continue reconciling real catalog changes.
- Keep the panel registered through settings-save reload and rollback. Retain the active editor and Saving state during its own reload, with pending fields disabled; preserve truthful save errors, disconnects and unavailable states outside the transaction. Ordinary unload and removal still remove the panel.
- Apply named-notification and delivery-method edits in place with assignment-only policy changes. Preserve unaffected reporting clocks, queued delivery identities and original cleanup targets. Combined definition and source/detection or policy-list changes use the guarded reload path; policy-only edits retain their existing behavior.
- Use problem terminology throughout History. Default Issues to newest first across investigation groups and their contents. Keep availability evidence gaps in Sources and record-only attention while showing and notifying current warnings and failures; this does not resolve episodes or change health observations.
- Retain pages, editor focus and open menus through unchanged updates, and keep the last view visibly stale and read-only during reconnection. Remove raw JSON and diagnostic-copy controls from ordinary issue details.
- Load policy selection choices on direct entry, retain selections through loading and retry, and search by source name or entity ID.
- Keep action menus compact in Safari and explain shared notification timing and delivery ownership in the editors.
- Show the next summary time for an unchanged saved policy assignment using the running policy’s forecast. Keep new or edited timing explicit until saved, and identify policies without a current summary schedule.
- Explain grouped issues under loaded integrations with distinct device, entity and check counts, canonical source names and complete contributing findings. Show each device once with its affected entities, and lead investigation to those sources instead of the loaded connection.
- Exclude unmonitored catalog aliases from evidence-gap counts while retaining watched checks and required function evidence.
- Keep disabled integrations visible in Sources without opening availability issues; retain monitoring choices for re-enablement.

- Explain entity registrations no longer provided by an integration and distinguish missing device readings from unavailable states. Move Home Assistant links and accurately labeled update times into source headers, and explain each monitoring policy's role.
- Prevent focused delivery-method fields from triggering repeated redraws that leave the dashboard stuck during editing or a monitoring reload. Retain the draft and cursor when monitoring reconnects.

## [1.8.0b6] - 2026-10-13

### Documentation

- Record recovery-confirmation visibility and wording in ADR 0060, and align the explanation with the issue lists and grouped-source details.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Focus delivery-method editing on selected destinations, with aligned fields, a searchable destination dialog, optional presence controls, visible save/cancel actions, and a More actions menu. Retain drafts when returning to the list and confirm before discarding method edits. Use the same form inside policies.
- Apply ordinary monitoring edits without restarting the integration; Save changes waits for verified storage and an updated dashboard.
- Refresh the complete source catalog with up to four pages in flight. Retained editors save the complete draft and keep newer edits made during a save.
- Move Duplicate and Delete into each policy's More actions menu, keeping on/off and Edit visible.
- Give Turn on an accent button in Policies, show saved state beside each name, and identify on/off changes that still need saving.
- Use plain tree rows with neutral labels, consistent child indentation, whole-row hover and selection, and wrapping secondary counts in Sources.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Omit availability issues awaiting recovery confirmation from Overview and Issues, while keeping their source details available. Describe loaded integrations with outstanding related-source problems accurately and list the affected sources in details.
- Keep disabled entities browsable without attaching availability checks, preventing disabled Sun sensors and other optional entities from becoming stale issues.
- Clear the previous save confirmation when editing a policy or delivery method again.
- Highlight only the selected source in the Sources tree, including paired connection details. Empty or stale selections no longer highlight unrelated rows.

## [1.8.0b5] - 2026-10-13

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Answer saved policy configuration directly in the WebSocket handler, avoiding an additional task queued behind monitoring work. Delivery discovery remains asynchronous and separate.

## [1.8.0b4] - 2026-10-13

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Load saved policies without rediscovering notification destinations, people or automations. Discover delivery choices when a method editor opens, retaining drafts on discovery failure.
- Create and edit delivery methods inside a policy. Keep the policy selected, restore only the method's pre-open draft on Cancel, select the method on Use method, and save the complete draft once. Show the policies affected by shared-method edits.

## [1.8.0b3] - 2026-10-13

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Reuse compiled notification policies during ordinary evidence updates, reconciliation with unchanged sources, and diagnostic reads. Rebuild after source or settings changes, preserving attention clocks.
- Group consecutive sources with identical notification choices into shared rules, preserving source override order, condition exceptions, independent schedules, acknowledgment, and saved delivery identity.
- Serialize saved health snapshots and compare read-back data outside the Home Assistant event loop, keeping the UI and API responsive during large snapshot saves while preserving write verification and queued evidence.

## [1.8.0b2] - 2026-10-13

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Save configuration through one Save changes action throughout the dashboard, including retained editors. Maintenance also applies directly from its completed form. Keep validation, stale-revision protection and rollback within the action, preserve pending edits on failure, and remove separate review screens.
- Select integrations by integration name, covering all current and future connections. Keep monitoring type fixed, name source pickers for their type, and remove single-choice scope dropdowns from Repairs and Broken automations.
- Configure delivery methods with a compact list of selected destinations, an Add destination picker, optional presence settings and friendly target names. Classify email and SMS only when the configured provider supports them; choose speakers before speech providers.
- Test only a saved unchanged delivery method from its editor. Remove the global test-destination list and separate preview step, and simplify the global switch to Enable notifications.

### Documentation

- Record the single-save workflow and focused delivery-method editor in ADR 0059. Update the specification and guides while retaining earlier ADRs with supersession notices.

## [1.8.0b1] - 2026-10-13

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Show supplied and user-created monitoring policies in one editable list. Fix the monitoring type at creation, support independent duplicates and overlapping policies, and allow deletion and selective restoration of supplied defaults.
- Configure notification timing inside each policy. Add several entries with immediate delivery, optional acknowledgment reminders or scheduled summaries; select one or more reusable delivery methods for each. Remove the separate schedule library and default-assignment editor.
- Use capability-based source selectors and detection fields, including configurable battery thresholds and independently evaluated overlapping battery policies. UPS reserve and generic battery policies can coexist without ownership transfer.
- Start fresh installations with integration, device and entity availability, Repairs and broken automations enabled. Batteries and vacuums start off. Every supplied policy has no notification entries and global sending starts off.
- Preserve new-model edits and deletions through reloads and updates. Existing test configurations are not automatically converted or reset. Older schedule-library settings require fresh setup for this prerelease; back up before explicitly replacing a test configuration.

### Documentation

- Record policy-owned timing and the unified lifecycle in ADRs 0057 and 0058, with supersession notices on the earlier decisions. Align the specification, editor design, roadmap and user guides with the new workflow and fresh-setup testing requirement.

## [1.7.1] - 2026-10-13

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Continue health checks when a device identifier has extra fields, including a HomeKit bridge. UPS matching still uses the integration and device id.

## [1.7.0] - 2026-10-13

### Added

- Monitor NUT and APC UPS Daemon with shared mappings for backup operation, low reserve, battery replacement and faults. Group independent issues under each UPS, preserve missing evidence and restart state, and review transfers from overlapping battery checks.
- Show both reserve schedules: summary on mains and immediate acknowledgment on backup. A confirmed move to backup renews attention for acknowledged low reserve without ending the issue or removing pauses.
- Add named monitoring policies with independent inactive copies, source and group selection, effective-policy links, detection settings and reviewed save. Preserve pending drafts across page navigation and allow overlapping custom temperature policies.
- Add thermostat deviation checks with configurable progress and worsening thresholds, plus temperature limits with explicit bounds and duration. Keep unknown evidence separate from recovery, preserve qualified problems across restart, and restart qualification when detection settings change.
- Add reusable notification schedules and delivery methods with explicit policy rows, independent immediate and scheduled reporting, editable acknowledgment reminder intervals, stable identities and reviewed shared-definition changes. Preserve generated source, condition and automation assignments during conversion; leave custom policies active until reviewed replacement.
- Request app, voice, email and SMS delivery through configured Home Assistant targets. Support fixed destinations and presence selection with explicit fallback or skip, preserve resolved targets during replay, and use prior destinations for cleanup without generating speech, email or SMS.
- Add administrator-only saved-method previews and explicit delivery tests bound to reviewed configuration, presence evidence and exact targets. Report requests and per-destination failures. Tests use isolated Home Assistant instances; live-provider validation remains separate.

### Documentation

- Record the accepted reusable monitoring-policy editor, separate notification schedules and delivery methods, and explicit schedule/method pairings on each policy. Use health-tree independent attention routes for these assignments.
- Record app, voice, email and SMS delivery scope with fixed destinations and optional presence selection. Document the three lists and their implemented editors.
- Record thermostat deviation defaults and independent temperature limits with explicit duration, recovery evidence and configurable thresholds.
- Document UPS policies, mode-dependent reserve schedules, shared mappings and reviewed battery ownership transfer.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Pin published health-tree 0.6.0 for independent notification routes and explicit renewed attention.

## [1.6.0] - 2026-10-04

### Added

- Flag an automation that names an entity that no longer exists. The issue uses the automation's name, lists the missing entity ids, and opens that automation in the editor. It ends when the entity exists again, the automation no longer names it, or the automation is removed.
- Add **Broken automations** on Policies, on until you turn it off. **Notifications → Household default → Broken automations** chooses when to report them, and starts at **Morning summary**.

## [1.5.0] - 2026-10-04

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- In Sources grouped by Home Assistant location, a floor lists its areas. Devices and entities appear under the area they belong to.
- Give monitoring policies their own **Policies** page. It lists Integrations, Devices, Batteries, Vacuums, and Repairs as on or off. Repairs stay on until turned off. Settings keeps Timing and Problem grouping. A narrower match, such as an area or a label, is added under **Other policies**.

## [1.4.0] - 2026-10-03

### Added

- Watch a vacuum for the error activity. Cleaning, docked, idle, paused, and returning end the issue. The notice is Immediate unless you set a source preference for that vacuum, and it names the Home Assistant area assigned to the vacuum when there is one.

## [1.3.2] - 2026-10-02

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Open a device issue only when every entity you selected on the device is unavailable, or its connectivity sensor reports disconnected, following Home Assistant's device availability proposal. One unavailable entity on a device whose other entities still report no longer opens a device issue. Issues still open for a partly unavailable device end when Homeostatic first starts after the update, and History lists them as **Monitoring ended** rather than **Cleared**.
- Add a maintainer page, Home Assistant states, on how Home Assistant reports entity, device and integration state and how Homeostatic reads it.

## [1.3.1] - 2026-10-01

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Make the device issue's monitoring choices easier to scan on a phone, keep the expanded list within the dialog, and explain that stopping a check opens a draft to review and save in Sources.
- Show why an entity exclusion could not be staged when several direct monitoring rules apply.

## [1.3.0] - 2026-10-01

### Added

- Turn every Home Assistant Repair into an issue, whichever integration raised it. The issue uses the Repair's title, names the integration and severity, and links to the automation or the Repairs page. It ends when Home Assistant stops reporting the Repair or you ignore it there, and goes into History like any other issue.
- Add one reporting choice for all Repairs under **Notifications → Household default**. It starts at **Morning summary**.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Replace the separate automation failure cards with ordinary Repair issues. Repairs now support Acknowledge, Pause alerts, History and notifications.
- Open the README with what goes wrong in a Home Assistant install and how Homeostatic tells you about it.

## [1.2.0] - 2026-10-01

### Removed

- Remove the native Configure form and its YAML settings. Adding Homeostatic is one step, and the panel is the only settings editor. Saved notification policies, consumer automations and situation declarations keep working but can no longer be edited there.
- Set household functions aside. Saved definitions are kept but inactive. Function readiness sensors and event entities are disabled, so automations that use them stop updating, and the function card view now opens Overview. The function services, previews and the Function status light blueprint are gone.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Show Home Assistant automation validation and missing-action Repair errors in Overview and Issues, with a link back to Home Assistant.
- Group watched device availability findings under a failed watched integration when both report problems.
- Remove deleted automations' alert definitions and stop counting retired definitions toward the 1000 active-alert limit.
- Apply the two-minute issue grace only after a full Home Assistant start, not after a panel save or another integration reload while Home Assistant is running.
- Show readable choices in Homeostatic's actions, rename timing labels in the panel, and hide custom notification batching while the six reporting choices are in use.
- Draft new group policies paused, expose supported maintenance controls in Sources, and generate current dashboard page paths.
- Call the acknowledgment reporting choice "Immediate with acknowledgment" in the panel, matching the alert blueprint.
- Name the card's `view` values after the pages they show: `issues` and `settings`. The earlier `problems` and `configuration` still work.
- Rewrite the README around what Homeostatic watches and what you get, with removal steps, the card `view` names and a plain writing style.
- Rewrite the user documentation: a step-by-step install tutorial, a task-based user guide, new reference, how-it-works and troubleshooting pages, and plain-language alert, events and roadmap pages.
- Rename the installation guide and release packaging commands, remove obsolete pilot results, proposals, prototype, and superseded UI notes, and correct current alert, acknowledgment, and release guidance.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Clear built-in phone notifications when requests turn off and accept battery condition reporting exceptions.

## [1.1.5] - 2026-10-01

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Show all five Homeostatic demo screenshots directly in the README.
- Treat a current `off` report from a device's connectivity-class binary sensor
  as disconnection evidence in device availability and selected monitoring.
  Show the reported condition and affected entities prominently in device
  problem details, with repeated names shortened and diagnostics collapsed.

## [1.1.4] - 2026-10-01

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Explain equipment issues, household situations, and reporting choices through concrete examples in the README.
- Make TopoMation's optional house tree discoverable beside the Sources grouping control, with a direct link to the integration.

## [1.1.3] - 2026-09-30

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Simplify cleared device History details to an availability summary and compact
  observed time range. Remove the redundant original finding dropdown.

## [1.1.2] - 2026-09-30

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Pin the published health-tree 0.5.1 release in the integration manifest and
  package lockfile.
- Show the saved device name after monitoring ends, and shorten History details
  around the observed condition and outcome. Keep the original finding available
  under a disclosure without repeating the explanation.

## [1.1.1] - 2026-09-30

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Group each Home Assistant connection with its sole registry-owned device in
  Sources, while keeping connection and device evidence and monitoring choices
  separate. Show connections with several devices as parents and retain
  connection-only entries and entities without devices.
- Label History's issue start and observed end separately, with outcome-specific
  wording for clearance, monitoring removal, and absorption. Keep the exact
  saved finding collapsed and remove misleading last-evidence copy.
- Show watch policies first and collapse group exclusions on Monitoring policies,
  so repeated exception rules do not obscure what the installation watches.
- Explain the monitoring, evidence, and reporting path in the README and user
  guide; align Sources and Monitoring policies copy with the actual menu and
  clarify that allowing an integration does not select every check.
- Put a direct **Monitor all batteries** action at the top of Monitoring
  policies. It drafts a broad battery check for review without requiring a
  source-type value or changing notification activation.
- Move monitoring catalog editing entirely into Homeostatic's guided Monitoring
  policies and Sources settings. Native Home Assistant setup/options no longer
  expose catalog YAML and preserve saved rules when other options change.

- Keep the Sources tree compact with inline device, entity, and issue counts and
  a Collapse all control. Distinguish excluded and unselected entities from
  entities included in a device check or monitored separately.
- Explain default monitoring and device entity selection beside the Sources
  tree, with the explanation available through live updates and search.
- Put issue counts beside source names, show labeled integration connections
  without another tree tier, and shorten device and entity details around HA
  status, effective monitoring, and direct actions. Keep separate entity checks
  available as a secondary choice when device monitoring already includes them.

## [1.1.0] - 2026-09-30

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Discover reviewable battery maintenance sources from HA battery and charging
  entity classes. A selected battery warns at 20% or on an explicit low report;
  confirmed charging clears the condition without claiming replacement.
- Place History at the far right of the Homeostatic page tabs and generated
  Home Assistant dashboard.
- Explain the observed condition and clearance rule in History details, with a
  single statement of what the retained record cannot establish. Collapse raw
  findings, combine the opening and ending times, and remove a repeated cleared
  status from Sources History rows.
- Simplify open device-problem details: lead with the integration and affected
  entity, show device availability as a compact separate status, and place alert
  controls before optional monitoring choices. Keep assessment caveats in
  Technical details.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Keep the Sources catalog loaded when an inventory signal finds no actual
  changes. Browsing-location changes still refresh the catalog so their names
  and grouping stay current.
- Open Settings without downloading the complete Sources catalog. When a loaded
  Sources catalog changes, keep the previous tree usable with an updating notice
  until the replacement is complete.

## [1.0.0] - 2026-09-29

### Added

- Bundle a light and dark Homeostatic brand icon with the custom integration so
  Home Assistant shows it locally. Document installation from the GitHub release
  through HACS or the verified manual archive.

- Add a repeatable fictional Willow House frontend demo and five README screenshots
  covering an open issue, source evidence, resolved history, and reporting.

- Document the maintenance and health roadmap, distinguishing planned battery,
  action-detail, household-access and presentation work from future options.
  The roadmap builds on the existing health-tree architecture and changes no
  runtime behavior or access permissions.

- Show device availability separately from selected-entity monitoring: Available,
  Unavailable, Unknown, or Disabled using all enabled HA entities. Reserve Partially
  available for explicit integration reports when supported upstream. Keep empty
  and disabled devices browsable and refresh selected device access evidence.

- Configure alerts entirely in HA with automatic source registration, shared reporting profiles, explicit retirement/conversion, and authenticated Acknowledge buttons on individual phone notifications.

- Open Homeostatic issue details from phone notification taps, including retained
  details after resolution. Summaries open Issues and route tests open Notifications.
  Tapping never acknowledges or clears a problem.

- Report continuing situations from native Home Assistant automations using the
  Report situation action and a condition-editor blueprint. Reports expire to
  unknown, remain independent of equipment, and require fresh evidence after
  restart. Explicit clearing resolves through the existing notification policy.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Rewrite the README for a Home Assistant user arriving cold: the problem in house
  terms, what the panel, issues, functions, alerts, and notifications give you, how
  the dependency graph and Health Tree work, and an honest note on what availability
  evidence cannot prove. Shorten the alert walkthrough, keep its anchor, drop the
  stale phone-acknowledgment limit, and list the alert blueprint first.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Show the current entity's name as plain text in its Source evidence instead of
  a link that reopened the same page. Other entity names still open their Sources.

- Align device availability documentation with ADR 0025: partial and total
  unavailability both warn; unknown values differ from missing evidence. Clarify
  that device summaries describe selected HA entities, not physical health.

- Explain dashboard/backend update mismatches in plain language, with restart and
  refresh guidance, instead of showing a raw `paged` validation error.

- Bound Companion notification replacement tags to Apple's 64-byte limit in
  both the built-in phone sender and consumer blueprint. Long identifiers use
  a stable hash, so leak alerts, updates and clearing reach the push service
  without losing recipient separation.

- Clarify integration Settings with current monitoring counts, compact Change
  editors, named exceptions, notification activation and device reporting
  summaries. Review and save monitoring and reporting together, preserving
  existing rules and check-specific preferences with one guarded reload.

- Keep the standalone panel's hamburger, title, and page tabs visible at the top
  while scrolling on phones and desktops.

- Explain Sources History entries with source names, recorded findings, readable
  outcomes, opening and observed resolution times, and recorded duration. Show
  newest events first and distinguish recovery from monitoring ending or joining
  another problem, with explicit history limits and links to details.

- Yield ordered observation processing after 20 ms or eight batches, preserving
  every captured transition and its timestamp.
- Load source catalogs on demand in revision-bound pages. Overview receives
  current problems without the complete catalog; Sources installs all pages
  together before enabling full-inventory browsing and search. Disconnection,
  reload and catalog changes discard stale pages; failed reads offer retry.

## [0.1.0b18] - 2026-09-29

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Separate group monitoring policies from individual source selections in Settings.
  Show readable group scopes, direct individual choices to Sources, and keep the
  complete rule editor under Advanced rule details. Existing monitoring choices
  stay intact; every edit still requires review and save.
- Show each Companion phone once in notification destinations when HA also exposes its notify entity, preserving saved route selections and keeping distinct device registrations separate.
- Keep the dashboard subscription during immediate card/page replacement, and prevent a late connection-ready event from hiding a received snapshot. Initial loading now describes fetching the dashboard instead of implying monitoring must run again.
- Move the installation-wide monitoring policy editor out of individual source settings into Settings → Monitoring policies. Keep source monitoring and reporting together, and show reporting types, schedules, and recipients directly on Notifications even when an older policy is saved. Opening a page changes nothing; edits still require review and save.

## [0.1.0b17] - 2026-09-28

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Make the integration name prominent in device problem details, with affected entities immediately below it and working entities kept in the collapsed selection. Space the monitoring and Sources links apart, wrapping them on narrow screens.

## [0.1.0b16] - 2026-09-28

### Added

- Add a standalone interactive reporting prototype with Notifications and Sources settings, synthetic data, desktop/phone and light/dark previews, bulk assignment, guarded sample review/save, and configuration error scenarios. Dashboard only appears as a regular option in the reporting selector. It does not connect to Home Assistant or send notifications.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Document the owner-agreed five reporting preferences in ADR 0026 and draft the Notifications/Sources interface: retain Notifications for shared settings, put assignments in Sources Settings, and remove old level filters and quiet-hour controls from the new workflow. Include wireframes, migration safeguards, and prototype acceptance cases. Implement per-profile recipients and shared destinations, weekly household defaults, recurring open-problem summaries, per-source/check preferences, and an Overview forecast. Preserve existing policies until reviewed migration. Both immediate choices include overnight; acknowledgement reminders repeat every 30 minutes.

## [0.1.0b15] - 2026-09-28

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Follow Home Assistant availability semantics in passive checks: an `unknown` entity value does not create an issue, and an `unavailable` entity raises a warning. Buttons remain eligible for device summaries; an unpressed Identify button no longer raises a device issue. Device choices with no eligible entity remain saved without an open availability check.
- Explain in the README which selected Home Assistant entity states produce a device availability warning and what the summary cannot prove.
- Make device issue cards name a sole affected entity, and shorten device details to the observed states and the next step.

- Show the selected entity ID beneath its name in Sources and identify the entity and saved choice in the monitoring review. Explain when a draft does not add or stop any watched sources, including the possible effect on device availability membership and future monitoring.
- Offer Topomation as a separate Sources grouping when its hierarchy is available, alongside Integration and Home Assistant location.

## [0.1.0b14] - 2026-09-28

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Rewrite the README as a short landing page with badges, HACS and manual installation, and a quick start; move the full reference to `docs/guide.md` and developer setup to `docs/development.md`. Add `hacs.json` for installation as a HACS custom repository.
- Use Home Assistant's “entity” terminology for selectable and monitored sources in Sources and device problem details, while retaining “reading” for physical measurements and the act of retrieving values.
- Move Notifications to the main dashboard navigation, link Overview's request status to it, and leave Timing and Problem grouping in Settings.
- Defer guided notification automation routing: remove its picker and detailed-routing link, move notification delay to Timing and time zone beside quiet hours, and preserve existing automation selections.
- Keep notification dropdowns open on touch devices by waiting for a selection change before redrawing Settings.
- Lead device problem details with the integration, current-reading count, and named readings needing review; shorten repeated explanations and make the device page the primary action.
- Hide the link-only Household functions Settings section while preserving existing function definitions and monitoring behavior.
- Add an integration-wide monitoring off choice that covers its connection, devices, and separate readings while preserving narrower choices for later resumption.

- Make device availability details identify the selected entities lacking usable Home Assistant states, explain the assessment rule, and put the full selection and monitoring changes behind a disclosure.


- Implement the accepted dashboard baseline: concise Overview and Issues, integration-family Sources tree, persistent desktop details, mobile list/detail navigation, and immediately editable source monitoring.
- Add reviewed installation-wide timing and notification-policy editing while preserving arbitrary saved policies and unrelated options. Integration device defaults can cover future connections of the same integration type.

### Added

- Use Topomation's location hierarchy for the Sources location tree when its read-only location endpoint is available; retain the Home Assistant tree as fallback and keep unassigned sources visible.

- Add a person-based Notifications editor with phone and notify-entity destinations, simple alert levels, quiet hours, an isolated route test, and preview-before-save. Built-in service requests record attempts durably before sending; notification requests remain off until the owner enables them.

- Combine Explore, Monitoring, and source-specific choices in one Sources workspace ([ADR 0017](docs/adr/0017-one-sources-workspace.md)). Browse by integration or HA location, review evidence beside current monitoring, and edit in place with the existing preview and save guard. Existing source views route into Sources.

- Optional HA template blueprint for mapping a diagnostic entity's explicit fault and clear states to a problem binary sensor for situation binding; other or restored states remain unavailable.
- User how-to for translating a documented device diagnostic state into a local HA binary sensor and Homeostatic situation alert, including ISY communication errors and unknown-source handling.
- Publish detected facts for owner automations ([ADR 0014](docs/adr/0014-publish-detected-facts-for-owner-automations.md)): `homeostatic_episode` events for opened, updated and resolved problems and `homeostatic_control` events for shelving, maintenance and acknowledgment, independent of notification settings, with HA context for logbook attribution. Each function gains an event entity for its problems.
- Example blueprints: a function status light and a problem logbook.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Sources now keeps one tree beside Source, Settings, and History views for the selected item. Empty integration names receive readable labels and repeated page headings are removed.

- Monitoring setup now uses an integration → device → entity tree without nested paging, clearer saved-policy summaries, and integration-level device defaults. New installations leave device summaries unmonitored until selected; an individual device can override its integration's device default. Existing saved monitoring choices are preserved until reviewed and saved.

- Add a quick local check (`script/check.py --quick`, `make quick`) for lint, format, and frontend checks. The commit hook uses it. CI still runs the full suite.
- Readiness sensors are enum sensors, so the automation editor offers their states.
- Hold notification requests while Home Assistant starts. The hold lasts at least the startup grace and ends when every watched integration has finished loading, or after the new `startup_quiet_max` option (default 10 minutes). Setup retry and setup errors count as finished. Alerting requests made during the hold, including reminders that fell due while HA was down, reach each recipient as one startup summary. A restart with nothing new sends nothing, and reloading the integration while HA is running does not hold requests.

## [0.1.0b13] - 2026-09-27

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Remove automatically selected registry entities and device summaries from monitoring when HA removes their backing evidence; end active episodes as removed while keeping explicit selections visible as unknown.

- Make Explore's empty locations concise, keep its discovered inventory secondary, and return from Monitoring or Settings to the selected location. Function setup now points to the Homeostatic integration entry instead of the general integrations list.
- Keep open dashboard sections, search focus, and reading position through live monitoring updates and reconnection.
- Contain scrolling at the top and bottom of dashboard pop-up panels so the page behind them stays put.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Shorten open-problem details to one condition, current retry or recovery state, next action, and open-since time. Show confirmed function effects only when present, group attention controls, and keep error reports and raw data under Technical details.
- Split the Home screen into a global Overview with issue and monitoring counts and three recent items, plus an Issues page for the full open list.
- Rebuild Monitoring choices as a compact source tree and focused settings panel, with an Other sources catchall, entity-type grouping, and bounded navigation and detail lists. Explain integration status, device-summary membership, individual checks, and matching-rule choices separately; keep bulk changes collapsed and review/save controls within reach.
- Remove the runtime Monitoring changes panel from History so the page focuses on ended problems; keep current scope and evidence review in Monitoring.
- Make Alerts & delivery an administrator editor for notification requests and the consumer automation, with a no-delivery preview and exact preview-before-save checks. Show the saved routing summary and open Homeostatic's own HA entry for detailed options; remove settings tabs that only repeated generic navigation.

## [0.1.0b12] - 2026-09-27

### Added

- Administrator acknowledgment and early cancellation of shelves and maintenance, with dashboard controls and durable library-owned attention state. Pins HealthTree 0.4.0, which supplies the shared acknowledgment and cancellation APIs.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Introduce the project through household functions, useful problem explanations, attention controls and visible evidence limits in the README.

- Yield between bounded groups of ordered observations so outage processing can share the Home Assistant loop while retaining every captured transition.


## [0.1.0b11] - 2026-09-26

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Explain availability as a selected monitoring expectation, with current member names and states, rather than a diagnosis of physical failure. Use the same rules for every integration.
- Add persistent Ignore availability through the existing preview-and-save editor. Entity exclusions also apply to device summaries, survive renames and reload, and retire changed summary episodes as removed rather than recovered.
- Document Home Assistant integration, device and entity distinctions and the difference between recovery, temporary shelving and persistent exclusions.
- Omit Change device type of a switch helper entries from monitoring inventory while retaining their converted entities. Document why Group sources remain and why their HA state cannot establish the health of each member.
- Browse the house gives location names and counts separate lines in a wider, resizable rail; leads with linked problems, function context, and monitoring evidence; and keeps discovered entities collapsed in readable rows without rule columns. Versioned frontend assets allow the updated layout to replace cached files after installation.

### Added

- Device rules now select only enabled HA device records; hidden but enabled entities count as evidence, while disabled devices and entities do not. Coverage counts disabled device records separately.
- Offer one Home Assistant availability summary per device, based on its enabled operational entities, with individual entity checks remaining opt-in. New installations select device summaries and integration state; saved broad rules do not silently select device summaries.
- Show device summary choices, limited availability evidence and complete-unavailability problems in the dashboard.
- Show all HA device-registry records in monitoring coverage, including a searchable list of records that lack an eligible availability signal.
- Bound the Home problem list and summarize ordinary unknown-evidence episodes so large device inventories cannot bury confirmed outages.
- Bound the Monitoring evidence-review preview and show device-specific availability guidance and a Home Assistant device link.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Simplify problem details to a directly visible Pause alerts action for that problem only. Keep equipment maintenance on source details, and group diagnostic copying and optional raw data under Technical details.
- Reorganized the dashboard into Home, Explore, Monitoring, History, and Settings with distinct purposes. Monitoring now leads with selected HA checks and evidence to review, History holds resolved problems and the current-run monitoring log, and Settings groups monitoring choices with links to native function, situation, and alert options. Source rows name what HA checks and what those checks cannot establish.

## [0.1.0b10] - 2026-09-26

### Added

- Administrator What to monitor page with guided rule choices, advanced editing, current-inventory and function previews, and guarded save to native options.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Monitoring activity distinguishes the scope found at load from later changes, groups arrivals by reconciliation, shows affected sources and current evidence by integration and device, and opens those sources in Coverage.
- Equipment maintenance now starts from a plain-language device action with short duration choices, a custom end time, and a readable preview of the equipment and functions covered. The preview still gates submission and existing problems remain visible.
- Problem details now summarize monitoring, check limits, current assessment and configured household impact before the optional raw diagnostic record.

## [0.1.0b9] - 2026-09-26

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Group Browse the house by current Home Assistant devices, place entities without a device in a secondary Area signals section, and show configured functions through their direct requirements. Floor and area branches can be collapsed without changing monitoring or dependency meaning.
- Summarize watched integration instances, device-associated entities and entities without an HA device in native setup/options preview, while stating that registry association does not prove physical hardware.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Replace the unbounded Coverage inventory table with a gap-first integration, Home Assistant device and capability hierarchy. Groups with missing evidence open automatically and provide specific guidance and function impact; the full discovered catalog remains searchable with a 50-result render bound. Remove the Coverage self-link and unrelated notification/control JSON.
- Version dashboard custom elements as well as module files so an already-open Home Assistant app replaces the obsolete enrollment JSON view after an upgrade. Monitoring changes move from the household overview to Coverage, where owner-readable explanations keep what changed, why and when primary and the complete payload remains in a secondary technical record.

## [0.1.0b8] - 2026-09-26

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Replace raw enrollment-event JSON on the overview with concise recent activity, grouped enrollment bursts, current evidence context and source or coverage navigation. Complete payloads remain available under technical details.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Stop monitoring automatically enrolled config entries when Home Assistant confirms their deletion, including entries deleted before an upgrade. Their active episodes resolve as removed instead of remaining as permanent missing connections. Explicit requirements and missing entity evidence retain their existing unknown semantics.

## [0.1.0b7] - 2026-09-25

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Entity problem cards and details now identify the light or sensor, explain the missing reading or control path, suggest a relevant first check and link to native entity/device details. Current evidence distinguishes unknown, missing, restored, disabled and recovering states; a known connection problem remains separate from the device symptom.

## [0.1.0b6] - 2026-09-25

### Added

- A persistent Home Assistant menu button in the standalone panel, including on phones and while monitoring is unavailable.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Combine redundant runtime refreshes while retaining every captured transition, reuse unchanged inventory and index state-event lookup. Deadline, storage, shutdown and notification ordering retain their existing contracts.
- Offer compact dashboard updates that resend catalog metadata only when it changes, with an explicit baseline on connection/reload and compatibility for existing full-snapshot clients. House and coverage tables search the full catalog while rendering at most 50 source rows per page.

## [0.1.0b5] - 2026-09-25

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Rebuilt problem cards and details around the reported problem, confirmed household impact, a relevant action and recovery progress. NuHeat and receiver timeouts, explicit sign-in requests, disabled connections and recovery have distinct guidance. Maintenance, alert controls, raw errors and diagnostic policy data move out of the main reading path; active controls remain visible by expiry.
- Version frontend module URLs together so a refreshed client loads a consistent release.

## [0.1.0b4] - 2026-09-25

### Added

- Recently resolved dashboard history with search, outcome filters, bounded pages, stored evidence and related-problem links. Recovery, removal from monitoring and absorption remain distinct.
- Administrator dashboard forms for shelving alerts and previewing scoped equipment maintenance, with explicit expiry, active-control summaries, preserved drafts and guarded submissions.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- House browsing now follows Home Assistant's floor-to-area hierarchy, preserves empty registry locations, summarizes child areas at the floor level, and distinguishes areas without a floor from sources without an area.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Problem cards and details separate current integration activity from the last reported failure, preserving timestamped context through retries and reloads without changing health or alert decisions. Disabled entries remain unknown but have a distinct, neutral presentation.
- Overview summaries omit raw exceptions; integration identity, recovery progress, next steps and reported-error details remain accessible. Expanded details stay open during live updates.

### Known limitations

- Runtime burst qualification found repeated full inventory scans, saves and dashboard publications after simultaneous availability changes. Whole-house enrollment remains unqualified despite fast initial construction. Added isolated inventory-shape, two-device pilot and opt-in runtime profiling scenarios; measurements and proposed rollout gates were recorded for that release. No live enrollment or integration behavior changed.

## [0.1.0b3] - 2026-09-25

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Integration problem cards and details now explain setup, retry, authentication and disabled states, preserve HA's reported error, and link to the relevant integration entry or filtered logs. Empty dependency text and unrelated notification/verification detail no longer obscure the next step.

## [0.1.0b2] - 2026-09-25

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Pin published HealthTree 0.3.0, including atomic graph registration and the correction for spurious stale episodes after grouped problems dissolve.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Enrollment-only previews skip health graph construction. Function previews and runtime graph changes use atomic HealthTree registration, preserving monitored healthy sources and explicit evidence gaps. Synthetic large-catalog validation is documented separately from the live pilot.

### Known limitations

- Whole-house responsiveness remains under qualification. This increment fixes initial graph construction and enrollment-only preview; sustained event bursts, many independent failures and dashboard inventory transfer/rendering still need isolated qualification. The live pilot remains integration-only.

## [0.1.0b1] - 2026-09-25

### Added

- Reproducible manual-install pilot archive, installation/rollback guide and published HealthTree 0.2.0 dependency; development and HA no longer require an editable library checkout.

- Persisted recently resolved episode history, capped at 100 entries and 30 days, with recovery/removal/absorption distinctions and detached read-only responses.

- Live administrator dashboard: automatic sidebar registration, reusable cards and a dashboard strategy; shared authenticated subscriptions for problems, functions, HA areas/floors, coverage and enrollment provenance.
- Read-only problem/function details, notification-request explanations, unavailable/disconnected states, reload-safe asset registration, and backend/frontend lifecycle tests.

- Administrator operator actions for episode shelving and bounded equipment maintenance, with scope previews, explicit expiry, reason/actor records and restart persistence.
- Current-control queries and expiry scheduling, with scenarios for situation isolation, continuing existing alerts, authorization, concurrent observations and storage failures.

- Owner YAML notification policy: recipients/channels, timezone, quiet hours, reminders, escalation, digests and strict validation.
- Read-only policy explanations and activation previews through native options and response actions.
- Grouped digest/activation messages with durable membership, replacement and clearing; channel-aware consumer blueprint.

- Function requirements for integration instances, other functions and declared external capabilities, with pre-save cycle validation.
- Per-function automation suggestions with stable accepted/rejected decisions, including static entity and device/area/floor/label targets.
- Current-function explanations and isolated function previews showing dependency changes, evidence gaps, rule provenance and upstream importance.

- Passive availability rule catalog with domain, device class, integration, device, entity, area, floor and label matching; additive attachments and order-independent exclusions.
- Automatic enrollment of future matching sources, stable match identities, retained missing-source evidence, and per-check attach/exclude explanations.
- Read-only rule previews in native setup/options and the `preview_rules` action, plus recent enrollment-change details in inventory.

- Initial Home Assistant integration with explicit source enrollment, native setup and options, dependency-aware monitoring, notification requests, health queries, and restart persistence.
- Python 3.14 development environment and integration tests against Home Assistant 2026.9.3.
- Named functions with stable entity requirements, editable importance, and individual readiness sensors.
- Entity-bound situation alerts, independent of equipment dependencies and readiness, preserving open episodes through unknown evidence.
- Versioned notification events, durable outbox replay, a Companion app consumer blueprint, activation summaries, and visible consumer gaps.
- One shared check command for local development, CI and commit hooks; expanded regression/blueprint tests, event documentation and an implementation roadmap.

### Changed

- Clarify navigation with Open issues and Monitoring, align notification lists and editors with page headings, and use theme-based selected navigation and labeled issue counts.
- Explain shared issue counts in Monitoring with their device, entity or connection scope, so one issue involving several devices is distinguishable from separate issues.

- Documented agreed dashboard and optional TopoMation product direction, enrollment behavior, location/dependency boundaries, and acceptance walkthroughs; implementation remains planned.
- Added a first dashboard design review with draft notification text for all ten library stories, evidence requirements, and presentation findings; no runtime or notification behavior changed.

- Activation uses the public library API, preserves episode history, starts escalation afresh and respects delivery holds. Policy edits withdraw old routes before activation.

- Owner-facing working notes were added as proposals; they were later retired after decisions moved into the specification and ADRs.
- Empty functions are explicit unwatched drafts; missing function/external declarations remain unknown requirements.
- Native setup/options preview now includes function requirements and candidate decisions, with readable graph validation errors.

- Setup defaults to the editable passive rule pack; existing development selections convert to narrow rules in options without broadening scope.
- Function requirements remain unwatched/unknown when catalog rules exclude them. Equipment exclusions do not suppress situations.

- New configurations default to notifications off. Consumer automations own episode notification delivery; native persistent notifications remain for Homeostatic errors.
- The original development snapshot upgrades to the current envelope without replacing episode identities.
- CI uses the reviewed HealthTree baseline including accepted situation ADRs.

### Fixed

- Show canonical equipment names in policy selections, with each selected source on its own row and room and floor beneath the name. Use the policy name as the editor heading and keep the selection action beside Include.

- Complete saves without persistent success messages across policy, notification, delivery-method, settings and contextual monitoring views. Preserve pending application, newer unsaved edits and failure feedback.

- Keep a return path after opening coverage or house details from an embedded Homeostatic card with page tabs hidden, including the generated dashboard.

- Repeated reminder requests are preserved even when their text is unchanged; summary resolutions update the remaining group.

- Excluded registered entities remain unwatched terminal requirements instead of appearing ready through a healthy owning integration.

- Preserve source transitions while storage is busy instead of replacing them with the latest state.
- Preserve setup-retry onset across unsuccessful attempts.
- Retain useful notification content when observations become unknown and policy requests no update.
- Complete unload cleanup even when the final storage write fails, with a visible storage error.
