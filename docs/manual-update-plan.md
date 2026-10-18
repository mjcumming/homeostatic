# Manual update after 1.10.0

Work outline · October 18, 2026

The [October 15 rewrite](manual-rewrite-plan.md) documented Homeostatic 1.8.0. Since then 1.8.1, 1.8.2 and 1.8.3 (October 16), 1.9.0 (October 17) and 1.10.0 (October 18) have shipped, with 27 new decision records: ADRs 0085 to 0100 and 0102 are accepted, and 0075 to 0084 are proposed. This outline lists what those changes mean for the manual and the work needed to bring it up to date. It changes no product behavior.

## Summary

Each release patched the manual pages it touched, so the issue, policy and notification pages already cover most of 1.10.0. The gaps are on pages nobody revisited and in what a newcomer reads first:

- Pages untouched since the rewrite still describe 1.8.0. Troubleshooting suggests maintenance for planned work and says multi-issue notifications open the full issue list. How it works describes the retired device-based message grouping. The four equipment recipes name the old **Include** dropdown options. The manual home lists Problem grouping under Settings, and the settings reference says the registry recheck runs every 60 seconds.
- The 1.9.0 device dialog was added to `issues.md` as a new section beside the older single-issue procedures. Its pause procedure describes the single-issue form (an end date and time, with an optional reason) and says it also covers selected device issues, but the device dialog only offers 1, 4 or 24 hours.
- The two ideas behind 1.10.0 aren't explained where a newcomer looks: why a lock or leak detector going offline notifies at night while a lamp waits for the morning summary, and why an Immediate notification waits a minute and can list several unrelated issues.
- All seven manual screenshots were captured from 1.8.0. Three of the six in use show controls that no longer exist, the seventh is no longer referenced, and the device dialog, now the main way to respond to a problem, has no picture.
- Four pages still say that updates preserve saved choices, but 1.10.0 replaced earlier settings with fresh defaults. The README and the upgrade page carry release-specific text about that reset.
- The manual's 16,000 words contain one contraction, inside quoted UI help text, and use "establish" 33 times, mostly in repeated recovery caveats. The write-project-docs rules flag both.

Recommendation: a focused update rather than another rewrite. Keep the page structure, file names and anchors. Six pages need real rework, about fifteen need corrections, and four to six screenshots need capturing.

## What changed for readers

| Change | Release | Decisions | What the reader sees now | Manual status |
| --- | --- | --- | --- | --- |
| Policy scope radios | 1.8.1 | Spec | **Include** is a radio group: All *sources*, All except selected, Selected *sources*, In selected areas, With selected labels. **Choose *sources*** or **Change selection** sits beside the chosen option. | `policies.md` current. The battery, UPS, temperature and thermostat recipes still name the old dropdown options, such as **Selected batteries…** |
| Entity inspector | 1.8.2 | 0089 | A small Entity label, linked Device and Integration names, and one **Monitoring policies** dialog listing each contributing policy's role with **Edit policy** | `policies.md` current; `monitoring.md` still describes "links beside its name" |
| Evidence shown directly | 1.8.2, 1.9.0 | 0085, 0086, 0088, 0091 | Opened issues show names, conditions and evidence without a Details expander or View in Monitoring. Entity issues offer **Open Entity** and **Open Device**. **Policies:** and **Notifications:** buttons open their editors with **Back to issue**. | `issues.md` current |
| Maintenance creation removed | 1.8.2 | 0087 | The panel can't start maintenance. Active windows show **Working on equipment** with **End maintenance…**; `homeostatic.start_maintenance` still creates them. | `maintenance.md` current but never says where windows come from; troubleshooting still recommends maintenance for planned work |
| Independent issues | 1.8.3 | 0090 | Failures under a working integration stay separate. After a failed integration recovers, remaining failures become separate issues and History shows **Issues separated**. Settings lost Problem grouping. | `how-it-works.md` and `history.md` current; the manual home's Settings row and the settings reference's History sentence are stale |
| One device dialog | 1.9.0 | 0093, 0094 | **View** at each device heading in Open issues, and in the Monitoring device inspector, opens the same dialog: **All issues**, a checkbox per issue, **Acknowledge selected** and **Pause notifications…**. A single issue gets direct buttons. The device inspector shows "2 of 3 monitored entities available". | `issues.md` patched but needs restructuring; `monitoring.md` partly current and its screenshot shows the old inspector; `ups.md` doesn't mention View; the README image shows per-finding Open links |
| Stop Monitoring | 1.9.0 | 0091, 0094 | One name for every contextual stopping action. The confirmation lists the exact entities, with no Details. | `policies.md` and `issues.md` current; troubleshooting links to "remove that availability selection" |
| Device policy exclusions | 1.9.0 | Spec | Device selection and **Ignored entities** are separate sections | `policies.md` current |
| Two entity availability policies | 1.10.0 | 0099 | **General entity availability** uses Morning summary. **Important equipment availability** uses Immediate and starts with cameras, locks, alarm panels and smoke, carbon monoxide, gas and moisture binary sensors. Both offer **Matching entity types** and **All except selected entity types**. | `first-run.md`, `policies.md` and both references current; the README, how it works and limitations don't mention it |
| Outages keep equipment notifications | 1.10.0 | 0099 | A failed integration's issue still requests each affected source's own notification, so a lock using Immediate isn't held back for the integration's Morning summary | One sentence in `policies.md`; how it works says nothing |
| Collection delay and collected messages | 1.10.0 | 0102 | **Collection delay (seconds)** on Immediate (60), Immediate with acknowledgment (5) and Urgent (60). Requests using the same saved notification and destination arrive together ("Homeostatic: 3 issues need attention"). Tapping one opens **Issues in this notification**, with **Show all open issues**. | `notifications.md`, the settings reference and `first-run.md` current; how it works and troubleshooting stale; `reference.md` lacks the new panel address |
| 15-minute sweep | 1.10.0 | 0098 | Events update their source at once. The full recheck of registries, Repairs and integrations runs every 15 minutes instead of every minute. | The settings reference says 60 seconds; nothing explains how Homeostatic stays current |
| Failed save reloads | 1.10.0 | 0100 | "Could not save settings; monitoring is reloading from the last saved state", followed by a reload | Troubleshooting and the settings reference don't mention it |
| Saved state size | 1.10.0 | 0096, 0097 | The state file grows with the installation; large installations should use an SSD | `install.md` current, though the paragraph sits after "Choose one installation method below" |
| Configuration reset | 1.10.0 | 0102 release transition | Upgrading from the earlier format replaces policies, notifications and delivery methods with fresh defaults and turns sending off. History is kept. | The README and `maintain-installation.md` carry release text; `first-run.md`, `policies.md` and both references still say updates preserve choices |

The proposed ADRs 0075 to 0084 (jammed locks, problem, tamper, safety, moisture, smoke, gas and carbon monoxide sensors, lawn mower errors and triggered alarms) stay out of the manual until they ship. One exception: the limitations page should say plainly that Homeostatic doesn't report those conditions yet, because 1.10.0 now puts smoke and leak detectors in a policy whose name could suggest it does. ADRs 0092, 0095 and 0096 change performance rather than anything a reader does.

## Page-by-page work

### Rework

#### `manual/issues.md`: Review and respond to an issue

- Reorganize around where the reader starts. A short table of entry points: a device's **View** in Open issues or Monitoring opens the device dialog; a notification about one issue opens that exact issue; a notification about several opens **Issues in this notification**; an entity without a device, an integration failure, a Repair or a broken automation opens its own issue.
- Replace the separate acknowledge and pause sections with one "Respond" section holding two procedures. The device dialog: selection, **Acknowledge selected**, then **Pause notifications…** with **Pause for** (1, 4 or 24 hours) and **Apply pause**; one issue gets **Acknowledge issue** and **Pause notifications…** directly. A single issue: **Acknowledge issue…** with a confirmation, and **Pause notifications…** with **End date and time** within seven days and an optional reason under **More options**.
- Keep the consequences readers need: acknowledgment stops reminders while summaries continue, a pause holds everything for the chosen issues, and later issues inherit neither. Cut mechanics the dialog already shows, such as how the master checkbox reflects partial selection.
- Name **Stop Monitoring** in the "normal for that equipment" pointer.
- Add one sentence on integration failures: one issue lists the affected devices, and each device keeps its own notifications. Link to how it works.
- Add a screenshot of the device dialog with several issues selected.

#### `manual/monitoring.md`: Inspect equipment and its monitoring

- Describe the two inspectors as they look now. Entity: the Entity label, linked Device and Integration names, the condition wording ("Home Assistant reports this entity as unavailable", "Not currently provided by…"), coverage, **Monitoring policies**, **Stop Monitoring** and **Resume availability monitoring…**. Device: the availability summary, one **View** while issues are open, entity names linked to Home Assistant, coverage, one **Open device** and **Select entities…** for member changes.
- Move "find the policies watching an entity" here from `policies.md`, since this page owns understanding coverage, and link back. `policies.md` keeps editing.
- Mention active maintenance (**Working on equipment**) and link to its page.
- Replace the screenshot. It shows the old device layout, with a fact grid and a Details disclosure, and lacks the availability summary and **View**.

#### `how-it-works.md`: How Homeostatic works

- Rewrite "How a policy reaches a person" around collection. The first eligible request opens a window as long as the notification's collection delay. Requests for the same saved notification and destination join it, and later arrivals don't extend it. The message can list unrelated issues. Different notifications stay separate, so one issue can arrive immediately and again in the morning summary. Say once that a long outage can still produce more than one message; ADR 0102 asks user docs to state that boundary.
- Remove the device-message paragraph. Device messages now apply only to older Custom assignments, which one sentence in the settings reference can cover.
- Add the ADR 0099 rule to "Why related problems appear together": the integration's issue lists its affected equipment, and each affected source's own notifications still apply. A basement leak detector under a failed Zigbee integration is the obvious example.
- Add a short "How Homeostatic stays current" section. A state change updates its source at once, timed transitions run on their own deadlines, and a full recheck every 15 minutes catches anything missed: sources that disappeared and a sign-in request that arrives without a state change. This also covers the integration quality scale's "how data updates" item.
- Update the Open issues paragraph for the device **View** and selection.

#### `manual/first-run.md`: Your first monitoring setup

- Step 2: reach an open issue through its device's **View**, and an entity's policies through **Monitoring policies**.
- Step 5 connects only Morning summary, so Important equipment availability stays silent after the tutorial. Decide whether the tutorial also adds the phone to Immediate (open question 2). Immediate requests iPhone critical alerts, so the reader should make that choice knowingly.
- Step 1: drop "updates preserve your choices".

#### `README.md`

- "What it watches": describe the split. Important equipment such as locks, cameras, alarm panels and smoke or leak detectors is reported immediately if Home Assistant loses it, and other equipment appears in the morning summary. Keep the point that this is about Home Assistant reaching the equipment.
- "Why use Homeostatic?": add a bullet for hearing at night when important equipment drops off, and check that the other bullets still hold.
- Replace the hero screenshot. Its caption says "open a finding"; readers now select **View** beside a device.
- Resolve the release-specific upgrade sentence (open question 1).

#### `troubleshooting.md`

- Too many issues or messages: link **Stop Monitoring** and drop the maintenance suggestion. For bursts, raise the notification's collection delay. For unwanted overnight messages, take the entity out of Important equipment availability or change that policy's notification.
- No notifications arriving: add the collection delay to step 3, and note that Important equipment availability uses Immediate, which needs its own delivery method.
- A save failed: add the reload message and what to do after it: wait for the panel to come back, compare the saved values and apply the draft again.
- A phone tap does not open the issue: messages about several issues open **Issues in this notification**. Device messages and summaries no longer open the full Open issues list.
- Add "settings look reset after an upgrade" if the reset text leaves the README (open question 1).

### Correct

| Page | Corrections |
| --- | --- |
| `guide.md` | The Settings row becomes "Adjust installation timing". |
| `install.md` | Move the state-file paragraph into "Before you start", ahead of "Choose one installation method below". |
| `manual/batteries.md`, `ups.md`, `temperature.md`, `thermostats.md` | Use the radio labels and the selection button, for example "Under **Include**, select **Selected batteries**, then **Choose batteries**". In `ups.md`, add that **View** beside the UPS opens all its conditions together. |
| `manual/policies.md` | Give the scope table the radio labels and the two entity-type rows, and name the selection button. Change "Updates preserve…" to cover ordinary updates only. |
| `manual/maintenance.md` | Say once that automations or scripts start windows with `homeostatic.start_maintenance`, linking the advanced reference, or merge the page (open question 4). |
| `manual/settings-reference.md` | Replace the 60-second registry recheck with the 15-minute recheck. Add **Issues separated** to the History sentence. Add **Acknowledge selected**, **Stop Monitoring** and the device dialog's pause durations to the controls table, and Stop Monitoring and resuming to "Scope of saved changes", since both save policy exclusions. Qualify "Updates preserve…". Link failed-save behavior to troubleshooting. |
| `manual/monitoring-reference.md` | Qualify the update sentence. Say that checks waiting for current information can appear as supporting lines under a device's issue, while gap-only findings still aren't issues. |
| `manual/limitations.md` | Say in one sentence that Homeostatic doesn't yet report smoke, carbon monoxide, gas, water, tamper, jammed locks or triggered alarms, and that Important equipment availability only covers whether Home Assistant can reach those devices. Add the collection boundary: a long outage can produce several messages. |
| `manual/maintain-installation.md` | Turn "This release replaces…" into guidance that doesn't depend on a release (open question 1). |
| `manual/notifications.md` | Say when changing a collection delay helps. Check both screenshots; an Immediate editor would show the new field. |
| `manual/history.md` | Check the labels on links to separated issues in the rendered page. |
| `reference.md` | Add `/homeostatic/issues/notification/<episode ids>` to Panel addresses. |
| `CHANGELOG.md` | Add a Documentation entry under Unreleased when the update lands. |

### No change expected

`manual/dashboards.md`, `automation-situations.md` and `how-to-local-health-signals.md`. `events.md` was updated in 1.10.0; give it one read during verification.

## Screenshots

| Image | Status | Fixture under `tests/frontend/` | Should show |
| --- | --- | --- | --- |
| `manual-open-issues.png` (README) | Stale: per-finding Open links | `issues-layout.html` or `device-issues.html` | An expanded integration with device headings and **View** |
| New device dialog image (`issues.md`) | Missing | `device-issue-selection.html` | **All issues** with three issues selected, **Acknowledge selected**, **Pause notifications…**, **Stop Monitoring**, **Policies:** and **Notifications:** |
| `manual-monitoring.png` | Stale: old device layout | `monitoring-inspector.html` or `device-issues.html` | The device inspector with its availability summary, **View**, entity rows, coverage and **Open device** |
| `manual-temperature-policy.png` | Stale: Include dropdown | `temperature-policy-editor.html` | Radio **Include** options and **Choose temperature sensors** |
| `manual-notification.png` | Probably current, since summaries hide the new field | `reusable-editors.html` | Consider Immediate instead, to show **Collection delay (seconds)** |
| Entity inspector image (optional) | Missing | `source-details.html` | The **Monitoring policies** dialog open |
| `manual-delivery-method.png`, `manual-history.png` | Probably current | `reusable-editors.html`, `source-history.html` | Check against current rendering |
| `manual-issue-detail.png` | Unreferenced since 1.9.0 | | Delete it or reuse the name for the device dialog |

No fixture uses the 1.10.0 policy names; the device dialog fixture still calls the entity policy "Entities". Update fixture data before capturing so the pictures match what a new installation shows. Record the new commit, fixtures and captions in [Manual screenshot provenance](testing/manual-images.md) and keep its capture rules: synthetic fixtures, no live destinations. The pre-rewrite README images (`overview.png`, `sources.png`, `issue.png`, `notifications.png`, `history.png`) are now referenced only by `testing/readme-demo.md`; that cleanup is separate (open question 6).

## Labels to settle before writing

The manual can describe these as they are, but the write-project-docs rules ask for mismatches to be raised first:

- The device dialog says **Open device**; an entity issue says **Open Entity** and **Open Device**.
- **Acknowledge issue** in the device dialog acts at once; **Acknowledge issue…** in a single issue opens a confirmation.
- The device dialog pauses for 1, 4 or 24 hours with no reason. The single-issue form takes any end time within seven days and an optional reason. The settings reference documents only the second.

## Voice

The write-project-docs rules now apply to these pages. While each page is open: use contractions where they read naturally, keep each caveat in `limitations.md` or at the one place it changes a decision, and cut sentences written in spec voice, such as selection mechanics and identity rules the UI already makes obvious. The recovery caveats are densest in how it works (4), History (4) and troubleshooting (4). Run the skill's scan and its fresh-reader test on the README, the first-run tutorial and `issues.md`.

## Fix the owners first

The rewrite plan's rule still applies: settle the owning documents before writing instructions that depend on them.

- The first bullet of "What works now" in `roadmap.md` says fresh setup enables "entity availability" and doesn't mention notification collection.
- The device-workflow paragraph in the roadmap's Current work says the changes "remain unreleased"; 1.9.0 shipped them. ADRs 0093 and 0094 carry the same status, although the ADR index says implementation status belongs in the roadmap.

## Sequence and checks

1. Answer the open questions and fix the owners.
2. Make the corrections in the table and the troubleshooting changes. These are small, independent diffs and can land first; separate writers can take disjoint pages.
3. Rework `issues.md`, `monitoring.md`, `how-it-works.md`, `first-run.md` and the README, in that order, since later pages link to earlier ones. One writer should take the first three because they share terms.
4. Capture the screenshots and update their provenance.
5. Do the voice pass on each page while it's open, if agreed.
6. Verify:
   - Walk each changed procedure against the rendered fixtures at desktop and phone widths, and check every bold label against the frontend strings.
   - Follow the first-run tutorial on a fresh isolated Home Assistant installation, including the 1.10.0 policies. Last week's rewrite didn't do this walk-through.
   - Check links and anchors across the README, `docs/*.md` and `docs/manual/*.md`. Keep the inbound anchors, including `#7-upgrade-and-roll-back`, `#stop-availability-monitoring` and `#issue-and-equipment-controls`.
   - Run `uv run --no-sync python script/check.py --quick`, and confirm the release builder still packages the manual and its new images.

## Open questions

1. Should the 1.10.0 reset text stay in the README and the upgrade page until the next release? The alternative is the CHANGELOG only, with a general "some releases replace settings; read the upgrade notes" in the manual.
2. Should the first-run tutorial add the phone to Immediate, so Important equipment availability can notify at night with iPhone critical alerts? Or should that stay a follow-up step after the tutorial?
3. Should the pause forms and button labels above be documented as they are, or aligned in the UI first?
4. Should `manual/maintenance.md` stay a separate page, or should ending maintenance move into `monitoring.md` with a short pointer left behind?
5. Should the voice pass happen in this update or separately? Doing it now avoids a second review of nearly every page but makes the diff larger.
6. Should the unreferenced `manual-issue-detail.png` and the pre-rewrite README images be deleted?
