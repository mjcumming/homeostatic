# A new Homeostatic manual

Agreed outline and rewrite record · October 15, 2026

## Recommendation

Rebuild the manual around the work of running Home Assistant: notice a problem, understand what Home Assistant reported, decide what needs attention, and arrange for the right people to hear about it. Start with a short guided setup, then offer focused instructions for everyday tasks and configuration. Keep detailed settings and automation interfaces available through reference pages.

Use the existing Markdown documentation and repository links for the first edition. Keep `docs/guide.md` as the manual's front door, with focused pages under `docs/manual/`. Preserve established installation, troubleshooting and automation-guide addresses where they still have a clear job. A documentation website can render these same files later; choosing a site generator is not a prerequisite for good content.

This is a plan for a user manual. The integration specification, accepted decisions, roadmap and contributor instructions retain their existing responsibilities. The rewrite does not change product behavior.

## Reader and promise

The primary reader administers a Home Assistant installation and knows what integrations, devices, entities and automations are. They should not need to understand Homeostatic's implementation to use it. New users need a guided first success; existing users need answers they can find quickly when something breaks or a setting needs changing.

The manual should help that reader answer:

- What can Homeostatic watch, and what starts enabled?
- What does this issue mean, what is affected, and what should happen next?
- Which policies watch this equipment, and how can that scope change?
- Who will hear about a problem, when, and through which destination?
- How can notifications pause during a known problem?
- What does recovery look like, and what can History establish?
- How can another supported check be added?
- What should be checked when the expected result does not happen?

The opening explanation should connect familiar examples to actual features: an unavailable switch reported in a morning summary, a low battery that needs replacing, or a configured temperature limit that needs prompt attention. Automation-defined alerts are unfinished and are excluded from the current manual's setup paths. Their experimental implementation does not establish a usable product workflow.

## Authoring approach

The installed **engineering:documentation** skill supplies a useful general discipline: write for a specific reader, lead with the useful information, show concrete examples, and link instead of duplicating. The installed **homeostatic-explanation-review** skill adds a product-specific review of source choices, evidence, reporting and menu wording. Use these together; no additional plugin installation is necessary for this plan.

Apply the repository's Diátaxis rule: each page primarily teaches a guided exercise, helps complete a task, explains a concept, or supplies reference facts. Separate those jobs when they make a page difficult to use. Page titles should name a reader's goal, rather than mirror modules or implementation layers.

Current implementation and executable scenarios establish what a reader can do. The [specification](spec.md) owns the behavior contract; [accepted decisions](adr/README.md) constrain it; [Current work](roadmap.md#current-work) identifies implementation and acceptance status. Resolve discrepancies at those owners before writing dependent instructions. A proposal, screenshot or successful local experiment alone does not establish released support.

The relevant decisions include [issue workflows](adr/0061-issues-first-product-workflows.md), [removal of superseded configuration](adr/0063-remove-superseded-configuration-and-ui.md), [availability evidence](adr/0064-monitoring-coverage-and-device-evidence.md), [evidence gaps](adr/0065-separate-availability-evidence-gaps-from-issues.md), [reusable notifications](adr/0066-reusable-notifications-own-timing-and-delivery.md), and the later [History](adr/0070-saved-monitoring-and-history-navigation.md), [save completion](adr/0072-quiet-save-completion.md), [entity details](adr/0073-entity-first-monitoring-details.md), [opened-issue removal](adr/0074-availability-removal-inside-open-issues.md) and [maintenance creation removal](adr/0087-remove-maintenance-creation-from-ui.md) decisions. Follow their supersessions rather than combining incompatible generations of instructions.

## What the audit found

| Finding | Consequence for the rewrite |
| --- | --- |
| The [README](../README.md) repeats installation, first run, alert creation, controls, notification timing, cards and removal. | Make it a concise introduction with requirements, an installation entry point, a useful screenshot and links into the manual. Detailed procedures have one owner. |
| [Install and first run](install.md) mixes release/development procedures, ordinary installation, a custom-alert exercise, notification setup and upgrades. Some instructions still say Issues or Sources. | Separate installation from the first-run tutorial and ongoing maintenance. Verify every navigation instruction against the current frontend. |
| The [guide](guide.md) mixes procedures, conceptual explanations, defaults and long descriptions of interface behavior. | Redistribute by reader task, then rewrite each destination as a coherent page. Moving paragraphs unchanged would retain the current problem. |
| [Reference](reference.md) combines normal settings with raw identities, query actions and blueprint interfaces. | Give everyday settings their own reference. Keep automation and integration interfaces in a clearly marked advanced reference. |
| Earlier alert guides offered setup instructions despite an unfinished end-to-end workflow. The maintainer confirmed that automation alerts are not built or ready. | Exclude alert recipes, blueprint installation and diagnostic-sensor mappings from the manual. Preserve old addresses as status notices, and mark experimental interfaces as developer-only. Completing alerts is separate product work. |
| Existing scale limitations and installation examples span different development and release states. | Recheck requirements, package links, limits and screenshots against the chosen documentation baseline. Avoid copying either older blanket performance claims or narrower local measurements as general guarantees. |

The initial planning audit used `main` at `2cc33ab`. Writing and screenshot review used `main` at `e2e1f325fb51e7f7bd69e31fd24d81596f0a83d0`, tagged `v1.8.0`, with manifest `1.8.0` and health-tree `0.7.0`. Existing uncommitted contributor-document changes were preserved. This identifies the source baseline; it does not establish which version is running in a household installation.

## Manual outline

The sections below are navigation groups. Each row identifies a page's job and its substantive outline. The pages are now drafted and linked from the [manual home](guide.md).

### Start here

| Page | Job | Content |
| --- | --- | --- |
| **Homeostatic manual** — `guide.md` | Manual home | What Homeostatic contributes to running HA; a small policy → notification → delivery-method diagram; links for first setup, responding to a problem and changing configuration. A compact map uses the actual labels Open issues, Monitoring, Policies, Notifications, History and Settings. |
| **Install Homeostatic** — `install.md` | How-to | Requirements and administrator access; HACS installation; manual installation alternative; add the integration; confirm that the panel loads. End with a link to the first-run tutorial. Contributor builds and deployment receipts stay in contributor documentation. |
| **Your first monitoring setup** — `manual/first-run.md` | Tutorial | Start with sending off; inspect the supplied policies and one real source; review an issue if one exists; make one deliberate monitoring choice; save and test a delivery method; connect it to a named notification; check policy assignments; enable sending when ready. Show an expected result at each milestone and a useful path when there are no issues. |

### Use Homeostatic day to day

| Page | Job | Content |
| --- | --- | --- |
| **Review and respond to an issue** — `manual/issues.md` | How-to | Read the reported condition and affected sources; open the relevant HA screen; acknowledge or pause when appropriate; follow evidence and recovery; find an ended issue in History. Explain the consequence of each action where the reader chooses it. Link to monitoring changes for an unwanted availability check. |
| **Inspect equipment and its history** — `manual/monitoring.md` | How-to | Find a source in Monitoring; use integration, HA location or optional TopoMation grouping; inspect current evidence and contributing policies; distinguish discovered equipment from monitored equipment; inspect gaps, disabled sources and related history. Grouping changes how the tree is viewed. |
| **Review ended problems** — `manual/history.md` | How-to | Browse History, find a recorded issue and follow related-source links. Distinguish clearing, monitoring ending and an issue joining another issue. Explain recorded observation times, incomplete historical associations and an expired or unavailable history link; link to the reference for retention limits. |
| **End an active maintenance period** — `manual/maintenance.md` | How-to | Find an active period and its expiry on the source, then end it early when appropriate. Explain that maintenance holds new issues while existing issues and their notifications continue. Link to Pause notifications when the purpose is quieting an existing issue. Creation through Home Assistant actions belongs in the advanced reference. |

### Choose what to watch

| Page | Job | Content |
| --- | --- | --- |
| **Choose what to monitor** — `manual/policies.md` | How-to | Review supplied policies; add or duplicate a policy; choose eligible sources, areas or labels; use exclusions and all-except selections; understand independent overlaps; save, disable, delete or selectively restore a policy. Explain fixed monitoring types, future matching sources and the scope of contextual availability removal. |
| **Watch batteries** — `manual/batteries.md` | How-to | Choose battery sources, enable the policy, set a threshold, select notifications, and inspect low/charging evidence. State what ends the issue. Keep availability monitoring distinct from battery condition. |
| **Watch UPS conditions** — `manual/ups.md` | How-to | Supported NUT/APC evidence, source selection, backup power, reserve, replacement and fault checks; mains/backup notification conditions; unavailable or incomplete evidence; recovery. Explain each configured condition using the readings the reader can inspect. |
| **Watch temperature limits** — `manual/temperature.md` | How-to | Select a temperature sensor, set low and/or high limits and duration, choose notifications, save and enable. Explain Waiting, incomplete evidence, recovery and the effect of changing detection settings. |
| **Watch thermostat progress** — `manual/thermostats.md` | How-to | Select a thermostat, configure deviation and progress/worsening settings, choose notifications, and inspect the resulting finding. Explain supported operating modes and how this differs from watching a temperature limit. |

Repairs, broken automations and vacuum errors need clear coverage in the policy instructions and monitoring reference. Add a separate recipe only if setup involves meaningful choices beyond selecting and enabling a policy; avoid a page for every switch.

### Arrange notifications

| Page | Job | Content |
| --- | --- | --- |
| **Set up and change notifications** — `manual/notifications.md` | How-to | Create and save a delivery method; explicitly Send test; choose or edit a named notification; assign it to a policy; enable sending. Then cover changing shared definitions, multiple assignments, dashboard-only operation, presence with fallback/skip, removing references and interpreting phone actions. Explain that shared edits affect saved uses and each editor saves its own scope. |

The first-run tutorial follows one simple phone route. This how-to owns alternate destinations and later changes. Its troubleshooting links distinguish no policy assignments, a notification with no delivery method, a method with no eligible destination, a closed time window and global sending off.

### Understand, troubleshoot and look things up

| Page | Job | Content |
| --- | --- | --- |
| **How issues and notifications work** — `how-it-works.md` | Explanation | Follow one reported failure through an issue, related findings, notification decisions and recovery. Explain integration grouping versus a shared device message, availability versus usable readings, current evidence gaps, acknowledgment, restart and ended-history outcomes. Explain these in ordinary product terms. |
| **Troubleshooting** — `troubleshooting.md` | How-to collection | Symptom → checks → expected evidence → next step. Cover setup/panel failure, old screens, absent or excessive notifications, excessive issues, unexpected missing monitoring, failed saves, phone links and an apparently contradictory device finding. Link to the owning procedure or reference rather than repeating it. |
| **Upgrade, roll back or remove Homeostatic** — `manual/maintain-installation.md` | How-to | Check the supported upgrade path and backup needs; install an update; confirm the version, monitoring choices and notification state; restore paired code and saved state when required; remove the integration and its files when intended. Keep these procedures outside first run. |
| **Monitoring types and defaults** — `manual/monitoring-reference.md` | Reference | For each supported type: eligible HA sources, fresh-install enabled state, required configuration, problem and recovery evidence, editable fields and supplied notification assignment. Include availability, batteries, UPS, temperatures, thermostats, vacuums, Repairs and broken automations. |
| **Notification and control settings** — `manual/settings-reference.md` | Reference | Six editable named-notification defaults, local-time behavior, destination capabilities, presence choices, scope of shared edits, acknowledgment and pause effects, ending active maintenance, installation timing and History retention. Distinguish fresh defaults from preserved existing choices. Use labels and units from the UI. |
| **What Homeostatic cannot establish** — `manual/limitations.md` | Reference | One owned limitations list: physical freshness and command completion, HA outages while Homeostatic runs inside HA, unsupported automation detection, current alert setup gap, administrator-only access, history bounds and evidence-backed scale/platform limitations. Link here from relevant tasks without repeating the whole list. |

An **Advanced use** area links to [dashboard/card setup](manual/dashboards.md), [automation actions and identities](reference.md) and [events](events.md). Keep schema details and event payloads in advanced reference. Experimental alert interfaces are marked unfinished and developer-only, with no setup recipes or manual `report_alert` examples. The old diagnostic-sensor mapping address explains why that recipe is unavailable.

## The first-run tutorial in detail

The tutorial is the first writing milestone because it tests the organization across the real product.

1. **Confirm the starting state.** Open the administrator panel after installation. Identify the enabled availability, Repairs and broken-automation policies, optional checks that need enabling or setup, existing notification assignments, empty delivery methods and global sending off.
2. **Inspect something familiar.** Find one device or entity in Monitoring, identify the policies that watch it, and read its current evidence. If Open issues is empty, continue with the source; a real fault is not required to finish setup.
3. **Review scope.** Show how to keep or change one deliberate selection in its policy. Explain that stopping monitoring does not record recovery. Do not manufacture an equipment failure or disable a real integration to demonstrate the screen.
4. **Prepare one destination.** Save a Companion phone delivery method. Select Send test explicitly and verify what the result says. The reader checks the phone separately; the UI's request result does not establish receipt.
5. **Connect timing and destination.** Select that method in a named notification, inspect its saved uses, and review the intended policy assignment. Use Morning summary for the ordinary example; explain when its next report is due.
6. **Enable normal sending deliberately.** Explain that already-open problems become eligible under their saved instructions. A scheduled summary waits for its scheduled occurrence; no immediate summary should be promised.
7. **Know where to return.** Open issues for current reported problems, Monitoring for equipment and missing evidence, History for ended issues, and Policies or Notifications for later changes. Link to the first optional recipe.

Provide a compact diagram next to this tutorial:

```text
Monitoring policy             Named notification          Delivery method
What to watch                 When to report              Where to request delivery
Example: Batteries     →      Morning summary      →      Selected phone
```

That example illustrates the configuration relationship; the tutorial uses an already-enabled policy unless the reader deliberately enables battery monitoring. Explain once that monitoring continues when sending is off.

## Examples, screenshots and writing rules

Use synthetic examples of unavailable equipment, a temperature limit, integration grouping and ended issues. Existing browser fixtures supply separate examples of the current interface; do not imply that they are successive states of one installation. Keep household identifiers and live destinations out of screenshots.

The screenshot set covers Open issues and its opened detail, Monitoring, a temperature policy, a named notification and delivery method, and History. Capture production frontend elements with isolated synthetic fixtures and meaningful alternative text. Record the source, state and capture limits in [Manual screenshot provenance](testing/manual-images.md). The current captures establish desktop rendering; they do not establish live setup, phone-browser behavior or provider receipt.

Follow the repository's writing rules throughout: product as subject, direct instructions to the reader, ordinary language, current UI vocabulary, and no maintainer anecdotes. Keep issue, source, problem and Repair where appropriate. Keep internal nodes, episodes, adapters and dormant functions out of ordinary user chapters. Omit inline decision/scenario numbers, version-history commentary and test counts. Put limitations in their owning page, with a short task-specific consequence only where it affects a choice.

Each procedure states its prerequisites, numbered actions, expected result and next useful destination. Explain a failed or uncertain save where the reader encounters it; do not promise a success banner or automatic retry. Document draft survival only for its verified session boundary, not across reload or tab closure. Published screenshots and instructions must agree with each other.

## Rewrite sequence and completion conditions

One documentation owner coordinates the rewrite and final integration. Writers work on disjoint pages; UI, terminology and source reviews can run in parallel. Overlapping edits need an explicit handoff. The rewrite changes documentation and screenshots only, preserving existing product work.

| Pass | Work | Completion condition |
| --- | --- | --- |
| 1. Establish the baseline | Choose the documentation target; inventory reader-facing files, inbound links and conflicting claims. Build a small working claim-to-source checklist from code, tests and the specification. Separate product gaps from writing gaps. | Every proposed chapter has a purpose, an owner and identified behavior sources. Unresolved claims are recorded before dependent instructions are drafted. |
| 2. Prove the starting path | Draft the manual home, concise README, installation page and first-run tutorial. Use one phone method and one existing policy. | A fresh isolated installation can follow the tutorial using the visible controls. A no-current-issues installation also reaches the expected outcome. |
| 3. Write everyday operation | Draft issues, Monitoring, policies, notifications, maintenance and the lifecycle explanation. Apply the current save scopes and action consequences. | A reader can investigate a fault, change scope, distinguish temporary controls and arrange reporting without consulting implementation material. |
| 4. Add specific setups and reference | Write the equipment recipes, settings/defaults, troubleshooting, limitations and advanced entry points. Derive values and examples from current sources. | Each recipe has a usable setup and identifiable recovery condition. Every supported monitoring type is covered, and every documented option has one reference owner. |
| 5. Verify the manual as used | Walk through instructions from fresh and configured isolated installations; review screenshots, keyboard/phone paths where relevant, Markdown links, anchors, example syntax and packaging. | Every promised path has evidence or an explicit remaining limitation. Mocked notification requests establish request behavior; actual provider receipt is a separate result. |
| 6. Replace the old entry points | Update navigation, incoming links and release-package pointers. Remove superseded prose when its replacement is verified. Retain a small compatibility link only for an externally useful old address or anchor. | Readers have one current manual. Old entry points reach the appropriate replacement and the packaged documentation includes its assets. |

Keep the source checklist as a working review artifact rather than another permanent product specification. Record implementation or acceptance changes in the existing roadmap owner. Behavior changes discovered during writing need their own specification, executable scenario and validation; they are not silently folded into editorial work.

## Existing-file disposition

| Current material | Treatment |
| --- | --- |
| `README.md` | Rewrite as the front door; retain a short install entry and direct manual link. |
| `docs/guide.md` | Become the manual home. Replace accumulated prose with task navigation and a compact orientation. |
| `docs/install.md` | Keep its established address for installation. Move updates, rollback and removal into `docs/manual/maintain-installation.md`; link both directions. That how-to owns backup/paired-restore instructions and verification after an update. |
| `docs/how-it-works.md` | Rewrite as the conceptual explanation, with ordinary-reader examples and links to tasks. |
| `docs/troubleshooting.md` | Rewrite around symptoms; move the full limitations list to its single owner. |
| `docs/automation-situations.md` | Retain the address as an unfinished-feature notice and remove the blueprint procedure. Preserve useful old anchors or update their callers. |
| `docs/reference.md` and `docs/events.md` | Keep as advanced interface references; move ordinary settings/defaults into the manual references. Update links and eliminate duplicated ownership. |
| `docs/how-to-local-health-signals.md` | Replace the recipe with a status notice because it depends on unfinished alerts. |
| `docs/policy-editors.md`, `docs/product-specification.md`, `docs/ui-standards.md` | Keep as design/contributor material. Review their current purpose separately; they should not be prerequisites for operating the product. |
| Specification, roadmap, ADRs, development and performance records | Keep their established roles and contributor navigation. Do not turn them into manual chapters or delete decision history as part of a user-doc rewrite. |

The release builder currently inserts an `INSTALL.md` link to `docs/install.md` and packages tracked documentation. Verify [the builder](../script/build_release.py), [smoke checks](../script/smoke_release.py), README links, blueprint links, screenshots and old guide anchors during the replacement pass. Updating only the manual's table of contents would leave other entry points stale.

## Acceptance checklist

- A newcomer can explain what is watched, what is enabled, and why notifications may not yet arrive.
- The first-run path works without a real equipment failure, YAML editing or an implementation document.
- Policy scope, named-notification timing and delivery-method destinations are clear, including shared edits and independent saves.
- Readers can choose among acknowledgment, pause and stopping monitoring based on their actual consequences, and end an active maintenance period when needed.
- No current issues, available equipment, missing evidence and observed recovery retain their different meanings. History distinguishes clearing from monitoring ending or an issue joining another issue.
- Automation alerts do not appear as a supported setup path. Old entry points and advanced interfaces clearly identify their unfinished status.
- Requirements, defaults, retention and example fields match the intended code baseline. Planned backup, host-health and external-watchdog features do not appear as available setup options.
- Navigation, labels and screenshots match the target interface. Examples, links and local anchors work, including in the packaged documentation.
- The README remains a useful introduction; each substantial explanation or procedure has one owner; obsolete instructions are removed once replacements are verified.

## Draft completion and verification

The manual home, installation and first-run path, daily-use chapters, equipment recipes, references, troubleshooting and maintenance instructions are written. The README and old guide entry points route readers into that manual. Seven current screenshots illustrate synthetic examples; their [provenance](testing/manual-images.md) records the captured states and limits. Automation-alert recipes have been removed from user documentation.

Source and independent editorial reviews checked the instructions against current frontend labels, configuration defaults, service contracts and existing tests. Linux/WSL quick checks passed, including frontend validation, and the focused configuration-flow, delivery-method-test and control tests passed. Markdown links, local anchors and image references were checked separately. The release builder includes tracked documentation and images; a new package was not built for this documentation change.

A complete fresh-install tutorial walkthrough in an isolated Home Assistant instance and a phone-layout walkthrough were not performed for this documentation change. Browser fixtures and focused tests provide narrower evidence and are not described as end-to-end acceptance. Product behavior, deployment and release status are unchanged.
