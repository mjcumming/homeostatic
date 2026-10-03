# Changelog

## [Unreleased]

## [1.4.0] - 2026-10-03

### Added

- Watch a vacuum for the error activity. Cleaning, docked, idle, paused, and returning end the issue. The notice is Immediate unless you set a source preference for that vacuum, and it names the Home Assistant area assigned to the vacuum when there is one.

## [1.3.2] - 2026-10-02

### Changed

- Open a device issue only when every entity you selected on the device is unavailable, or its connectivity sensor reports disconnected, following Home Assistant's device availability proposal. One unavailable entity on a device whose other entities still report no longer opens a device issue. Issues still open for a partly unavailable device end when Homeostatic first starts after the update, and History lists them as **Monitoring ended** rather than **Cleared**.
- Add a maintainer page, Home Assistant states, on how Home Assistant reports entity, device and integration state and how Homeostatic reads it.

## [1.3.1] - 2026-10-01

### Changed

- Make the device issue's monitoring choices easier to scan on a phone, keep the expanded list within the dialog, and explain that stopping a check opens a draft to review and save in Sources.
- Show why an entity exclusion could not be staged when several direct monitoring rules apply.

## [1.3.0] - 2026-10-01

### Added

- Turn every Home Assistant Repair into an issue, whichever integration raised it. The issue uses the Repair's title, names the integration and severity, and links to the automation or the Repairs page. It ends when Home Assistant stops reporting the Repair or you ignore it there, and goes into History like any other issue.
- Add one reporting choice for all Repairs under **Notifications → Household default**. It starts at **Morning summary**.

### Changed

- Replace the separate automation failure cards with ordinary Repair issues. Repairs now support Acknowledge, Pause alerts, History and notifications.
- Open the README with what goes wrong in a Home Assistant install and how Homeostatic tells you about it.

## [1.2.0] - 2026-10-01

### Removed

- Remove the native Configure form and its YAML settings. Adding Homeostatic is one step, and the panel is the only settings editor. Saved notification policies, consumer automations and situation declarations keep working but can no longer be edited there.
- Set household functions aside. Saved definitions are kept but inactive. Function readiness sensors and event entities are disabled, so automations that use them stop updating, and the function card view now opens Overview. The function services, previews and the Function status light blueprint are gone.

### Changed

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

- Clear built-in phone notifications when requests turn off and accept battery condition reporting exceptions.

## [1.1.5] - 2026-10-01

### Changed

- Show all five Homeostatic demo screenshots directly in the README.
- Treat a current `off` report from a device's connectivity-class binary sensor
  as disconnection evidence in device availability and selected monitoring.
  Show the reported condition and affected entities prominently in device
  problem details, with repeated names shortened and diagnostics collapsed.

## [1.1.4] - 2026-10-01

### Changed

- Explain equipment issues, household situations, and reporting choices through concrete examples in the README.
- Make TopoMation's optional house tree discoverable beside the Sources grouping control, with a direct link to the integration.

## [1.1.3] - 2026-09-30

### Changed

- Simplify cleared device History details to an availability summary and compact
  observed time range. Remove the redundant original finding dropdown.

## [1.1.2] - 2026-09-30

### Changed

- Pin the published health-tree 0.5.1 release in the integration manifest and
  package lockfile.
- Show the saved device name after monitoring ends, and shorten History details
  around the observed condition and outcome. Keep the original finding available
  under a disclosure without repeating the explanation.

## [1.1.1] - 2026-09-30

### Changed

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

- Rewrite the README for a Home Assistant user arriving cold: the problem in house
  terms, what the panel, issues, functions, alerts, and notifications give you, how
  the dependency graph and Health Tree work, and an honest note on what availability
  evidence cannot prove. Shorten the alert walkthrough, keep its anchor, drop the
  stale phone-acknowledgment limit, and list the alert blueprint first.

### Fixed

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

- Separate group monitoring policies from individual source selections in Settings.
  Show readable group scopes, direct individual choices to Sources, and keep the
  complete rule editor under Advanced rule details. Existing monitoring choices
  stay intact; every edit still requires review and save.
- Show each Companion phone once in notification destinations when HA also exposes its notify entity, preserving saved route selections and keeping distinct device registrations separate.
- Keep the dashboard subscription during immediate card/page replacement, and prevent a late connection-ready event from hiding a received snapshot. Initial loading now describes fetching the dashboard instead of implying monitoring must run again.
- Move the installation-wide monitoring policy editor out of individual source settings into Settings → Monitoring policies. Keep source monitoring and reporting together, and show reporting types, schedules, and recipients directly on Notifications even when an older policy is saved. Opening a page changes nothing; edits still require review and save.

## [0.1.0b17] - 2026-09-28

### Changed

- Make the integration name prominent in device problem details, with affected entities immediately below it and working entities kept in the collapsed selection. Space the monitoring and Sources links apart, wrapping them on narrow screens.

## [0.1.0b16] - 2026-09-28

### Added

- Add a standalone interactive reporting prototype with Notifications and Sources settings, synthetic data, desktop/phone and light/dark previews, bulk assignment, guarded sample review/save, and configuration error scenarios. Dashboard only appears as a regular option in the reporting selector. It does not connect to Home Assistant or send notifications.

### Changed

- Document the owner-agreed five reporting preferences in ADR 0026 and draft the Notifications/Sources interface: retain Notifications for shared settings, put assignments in Sources Settings, and remove old level filters and quiet-hour controls from the new workflow. Include wireframes, migration safeguards, and prototype acceptance cases. Implement per-profile recipients and shared destinations, weekly household defaults, recurring open-problem summaries, per-source/check preferences, and an Overview forecast. Preserve existing policies until reviewed migration. Both immediate choices include overnight; acknowledgement reminders repeat every 30 minutes.

## [0.1.0b15] - 2026-09-28

### Changed

- Follow Home Assistant availability semantics in passive checks: an `unknown` entity value does not create an issue, and an `unavailable` entity raises a warning. Buttons remain eligible for device summaries; an unpressed Identify button no longer raises a device issue. Device choices with no eligible entity remain saved without an open availability check.
- Explain in the README which selected Home Assistant entity states produce a device availability warning and what the summary cannot prove.
- Make device issue cards name a sole affected entity, and shorten device details to the observed states and the next step.

- Show the selected entity ID beneath its name in Sources and identify the entity and saved choice in the monitoring review. Explain when a draft does not add or stop any watched sources, including the possible effect on device availability membership and future monitoring.
- Offer Topomation as a separate Sources grouping when its hierarchy is available, alongside Integration and Home Assistant location.

## [0.1.0b14] - 2026-09-28

### Changed

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

- Sources now keeps one tree beside Source, Settings, and History views for the selected item. Empty integration names receive readable labels and repeated page headings are removed.

- Monitoring setup now uses an integration → device → entity tree without nested paging, clearer saved-policy summaries, and integration-level device defaults. New installations leave device summaries unmonitored until selected; an individual device can override its integration's device default. Existing saved monitoring choices are preserved until reviewed and saved.

- Add a quick local check (`script/check.py --quick`, `make quick`) for lint, format, and frontend checks. The commit hook uses it. CI still runs the full suite.
- Readiness sensors are enum sensors, so the automation editor offers their states.
- Hold notification requests while Home Assistant starts. The hold lasts at least the startup grace and ends when every watched integration has finished loading, or after the new `startup_quiet_max` option (default 10 minutes). Setup retry and setup errors count as finished. Alerting requests made during the hold, including reminders that fell due while HA was down, reach each recipient as one startup summary. A restart with nothing new sends nothing, and reloading the integration while HA is running does not hold requests.

## [0.1.0b13] - 2026-09-27

### Fixed

- Remove automatically selected registry entities and device summaries from monitoring when HA removes their backing evidence; end active episodes as removed while keeping explicit selections visible as unknown.

- Make Explore's empty locations concise, keep its discovered inventory secondary, and return from Monitoring or Settings to the selected location. Function setup now points to the Homeostatic integration entry instead of the general integrations list.
- Keep open dashboard sections, search focus, and reading position through live monitoring updates and reconnection.
- Contain scrolling at the top and bottom of dashboard pop-up panels so the page behind them stays put.

### Changed

- Shorten open-problem details to one condition, current retry or recovery state, next action, and open-since time. Show confirmed function effects only when present, group attention controls, and keep error reports and raw data under Technical details.
- Split the Home screen into a global Overview with issue and monitoring counts and three recent items, plus an Issues page for the full open list.
- Rebuild Monitoring choices as a compact source tree and focused settings panel, with an Other sources catchall, entity-type grouping, and bounded navigation and detail lists. Explain integration status, device-summary membership, individual checks, and matching-rule choices separately; keep bulk changes collapsed and review/save controls within reach.
- Remove the runtime Monitoring changes panel from History so the page focuses on ended problems; keep current scope and evidence review in Monitoring.
- Make Alerts & delivery an administrator editor for notification requests and the consumer automation, with a no-delivery preview and exact preview-before-save checks. Show the saved routing summary and open Homeostatic's own HA entry for detailed options; remove settings tabs that only repeated generic navigation.

## [0.1.0b12] - 2026-09-27

### Added

- Administrator acknowledgment and early cancellation of shelves and maintenance, with dashboard controls and durable library-owned attention state. Pins HealthTree 0.4.0, which supplies the shared acknowledgment and cancellation APIs.

### Changed

- Introduce the project through household functions, useful problem explanations, attention controls and visible evidence limits in the README.

- Yield between bounded groups of ordered observations so outage processing can share the Home Assistant loop while retaining every captured transition.


## [0.1.0b11] - 2026-09-26

### Fixed

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

- Simplify problem details to a directly visible Pause alerts action for that problem only. Keep equipment maintenance on source details, and group diagnostic copying and optional raw data under Technical details.
- Reorganized the dashboard into Home, Explore, Monitoring, History, and Settings with distinct purposes. Monitoring now leads with selected HA checks and evidence to review, History holds resolved problems and the current-run monitoring log, and Settings groups monitoring choices with links to native function, situation, and alert options. Source rows name what HA checks and what those checks cannot establish.

## [0.1.0b10] - 2026-09-26

### Added

- Administrator What to monitor page with guided rule choices, advanced editing, current-inventory and function previews, and guarded save to native options.

### Changed

- Monitoring activity distinguishes the scope found at load from later changes, groups arrivals by reconciliation, shows affected sources and current evidence by integration and device, and opens those sources in Coverage.
- Equipment maintenance now starts from a plain-language device action with short duration choices, a custom end time, and a readable preview of the equipment and functions covered. The preview still gates submission and existing problems remain visible.
- Problem details now summarize monitoring, check limits, current assessment and configured household impact before the optional raw diagnostic record.

## [0.1.0b9] - 2026-09-26

### Changed

- Group Browse the house by current Home Assistant devices, place entities without a device in a secondary Area signals section, and show configured functions through their direct requirements. Floor and area branches can be collapsed without changing monitoring or dependency meaning.
- Summarize watched integration instances, device-associated entities and entities without an HA device in native setup/options preview, while stating that registry association does not prove physical hardware.

### Fixed

- Replace the unbounded Coverage inventory table with a gap-first integration, Home Assistant device and capability hierarchy. Groups with missing evidence open automatically and provide specific guidance and function impact; the full discovered catalog remains searchable with a 50-result render bound. Remove the Coverage self-link and unrelated notification/control JSON.
- Version dashboard custom elements as well as module files so an already-open Home Assistant app replaces the obsolete enrollment JSON view after an upgrade. Monitoring changes move from the household overview to Coverage, where owner-readable explanations keep what changed, why and when primary and the complete payload remains in a secondary technical record.

## [0.1.0b8] - 2026-09-26

### Changed

- Replace raw enrollment-event JSON on the overview with concise recent activity, grouped enrollment bursts, current evidence context and source or coverage navigation. Complete payloads remain available under technical details.

### Fixed

- Stop monitoring automatically enrolled config entries when Home Assistant confirms their deletion, including entries deleted before an upgrade. Their active episodes resolve as removed instead of remaining as permanent missing connections. Explicit requirements and missing entity evidence retain their existing unknown semantics.

## [0.1.0b7] - 2026-09-25

### Changed

- Entity problem cards and details now identify the light or sensor, explain the missing reading or control path, suggest a relevant first check and link to native entity/device details. Current evidence distinguishes unknown, missing, restored, disabled and recovering states; a known connection problem remains separate from the device symptom.

## [0.1.0b6] - 2026-09-25

### Added

- A persistent Home Assistant menu button in the standalone panel, including on phones and while monitoring is unavailable.

### Changed

- Combine redundant runtime refreshes while retaining every captured transition, reuse unchanged inventory and index state-event lookup. Deadline, storage, shutdown and notification ordering retain their existing contracts.
- Offer compact dashboard updates that resend catalog metadata only when it changes, with an explicit baseline on connection/reload and compatibility for existing full-snapshot clients. House and coverage tables search the full catalog while rendering at most 50 source rows per page.

## [0.1.0b5] - 2026-09-25

### Changed

- Rebuilt problem cards and details around the reported problem, confirmed household impact, a relevant action and recovery progress. NuHeat and receiver timeouts, explicit sign-in requests, disabled connections and recovery have distinct guidance. Maintenance, alert controls, raw errors and diagnostic policy data move out of the main reading path; active controls remain visible by expiry.
- Version frontend module URLs together so a refreshed client loads a consistent release.

## [0.1.0b4] - 2026-09-25

### Added

- Recently resolved dashboard history with search, outcome filters, bounded pages, stored evidence and related-problem links. Recovery, removal from monitoring and absorption remain distinct.
- Administrator dashboard forms for shelving alerts and previewing scoped equipment maintenance, with explicit expiry, active-control summaries, preserved drafts and guarded submissions.

### Changed

- House browsing now follows Home Assistant's floor-to-area hierarchy, preserves empty registry locations, summarizes child areas at the floor level, and distinguishes areas without a floor from sources without an area.

### Fixed

- Problem cards and details separate current integration activity from the last reported failure, preserving timestamped context through retries and reloads without changing health or alert decisions. Disabled entries remain unknown but have a distinct, neutral presentation.
- Overview summaries omit raw exceptions; integration identity, recovery progress, next steps and reported-error details remain accessible. Expanded details stay open during live updates.

### Known limitations

- Runtime burst qualification found repeated full inventory scans, saves and dashboard publications after simultaneous availability changes. Whole-house enrollment remains unqualified despite fast initial construction. Added isolated inventory-shape, two-device pilot and opt-in runtime profiling scenarios; measurements and proposed rollout gates were recorded for that release. No live enrollment or integration behavior changed.

## [0.1.0b3] - 2026-09-25

### Fixed

- Integration problem cards and details now explain setup, retry, authentication and disabled states, preserve HA's reported error, and link to the relevant integration entry or filtered logs. Empty dependency text and unrelated notification/verification detail no longer obscure the next step.

## [0.1.0b2] - 2026-09-25

### Changed

- Pin published HealthTree 0.3.0, including atomic graph registration and the correction for spurious stale episodes after grouped problems dissolve.

### Fixed

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

- Keep a return path after opening coverage or house details from an embedded Homeostatic card with page tabs hidden, including the generated dashboard.

- Repeated reminder requests are preserved even when their text is unchanged; summary resolutions update the remaining group.

- Excluded registered entities remain unwatched terminal requirements instead of appearing ready through a healthy owning integration.

- Preserve source transitions while storage is busy instead of replacing them with the latest state.
- Preserve setup-retry onset across unsuccessful attempts.
- Retain useful notification content when observations become unknown and policy requests no update.
- Complete unload cleanup even when the final storage write fails, with a visible storage error.
