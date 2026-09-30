# Homeostatic user guide

The full reference for installing, configuring and operating Homeostatic. Start with the [README](../README.md) for an overview and the [pilot guide](pilot.md) for a first install.

## Contents

- [Monitoring in three steps](#monitoring-in-three-steps)
- [What works now](#what-works-now)
- [Install and configure](#install-and-configure)
- [Fixed reporting preferences](#fixed-reporting-preferences)
- [Operator controls](#operator-controls)
- [Awareness and ending controls early](#awareness-and-ending-controls-early)
- [Recently resolved problems](#recently-resolved-problems)
- [Scaling validation](#scaling-validation)
- [Beyond the pilot](#beyond-the-pilot)

## Monitoring in three steps

1. **Choose what to watch.** A new installation watches integration connection state. In **Sources → Settings**, select a particular connection, device, entity, or battery. **Settings → Monitoring policies** sets group choices that can also cover future sources. A discovered source is not automatically a monitored source.
2. **Read what HA knows.** Homeostatic compares the selected checks with Home Assistant's reports. For availability, `unavailable` is a warning; `unknown` means HA does not know the value and is not an availability warning. Missing evidence can leave an assessment unknown. A device's overall HA availability and a warning on a selected entity are separate findings. These reports do not prove physical health or a successful command.
3. **Choose when someone hears.** A problem can appear in **Issues** even when notification requests are off. Set a reporting preference in **Sources → Settings** and the people, destinations, and schedules in **Notifications**. Review and save before enabling requests. A request does not prove phone receipt; acknowledging means someone saw the problem, not that it cleared.

For example, selecting a garage door entity's availability check means Homeostatic expects HA to keep that entity available. If HA reports it `unavailable`, Homeostatic can open or update a problem after its configured waits. Its reporting preference decides whether someone hears immediately, in a summary, or only sees it on the dashboard. If the state later becomes available, recovery follows the configured confirmation time. Removing the check instead ends monitoring; it is not recovery.

A **monitoring policy** is a saved rule that selects or excludes checks. It can match a group and later sources that join it. A **reporting preference** chooses a delivery schedule for problems from a monitored source; the **notification policy** decides which requests are due under that preference. Neither changes what HA reports or whether the source is monitored. Review shows the effective result where policies and individual choices overlap.

## What works now

- Automatically populated Homeostatic sidebar dashboard, reusable cards and a dashboard strategy, with live problems, functions, HA location browsing, coverage, rule provenance and current problem details. The first aggregate surface requires an administrator.
- Guided monitoring choices in Homeostatic's Sources and Monitoring policies, with previews, passive enrollment of future matching sources, and explanations of attachments and exclusions. Registered sources keep their identity across renames. Native setup/options do not expose catalog YAML.
- Integration setup, retries and authentication evidence; one HA availability summary per device with optional individual entity checks; dependency correlation into episodes.
- Named functions with entity, integration, function and external capability requirements; editable importance; per-function automation suggestions and confirmed/rejected decisions; each exporting readiness as `ready`, `unknown`, `degraded`, or `blocked`.
- Named situation alerts bound to existing HA entities: `on` is active, `off` is clear, missing/unknown/unavailable is unknown. A situation remains independent of equipment readiness.
- Guided reporting preferences, schedules, people, destinations, and activation in Notifications. The advanced notification policy remains available in native options.
- Overall readiness, open-problem and evidence-gap sensors, plus `inventory`, `explain`, `readiness`, `impact`, `coverage`, and `rollup` response actions.
- Notifications off by default, one activation summary, versioned `homeostatic_notification` events, and a [Companion app consumer blueprint](../blueprints/automation/homeostatic/companion_notification.yaml).
- Ordered observation capture during storage writes, retry continuity, restart persistence, durable delivery outbox, and unload cleanup.

A passing availability check shows that HA currently reports an available control path. It does not verify physical-device freshness, detector progress, command completion, or phone receipt. Those require their own evidence producers and real traces.

Richer evidence checks, specific Repairs links, optional TopoMation enrichment, and the external watchdog are tracked in the [build roadmap](roadmap.md). Structured YAML for functions, situations, and advanced notification policy remains in native options.

## Install and configure

Follow the [pilot installation guide](pilot.md): confirm a usable HA backup, keep the prior component for rollback, copy the packaged `custom_components/homeostatic` folder into your HA configuration directory, and restart. HA installs the pinned published HealthTree dependency automatically. Add **Homeostatic** through **Settings > Devices & services > Add integration**, or let the existing entry reload after an upgrade. No sibling library checkout is needed. The [quick local test cycle](development-workflows.md) copies a working component without publishing a release.

Review the current monitoring choices in **Sources**. New installations watch integration setup state; device summaries and individual entity checks require a choice. A device shows selected entities needing review first, with other entities collapsed. An entity shows whether it is included through its device, monitored separately, excluded, or unselected. Its Settings normally offer following the device or excluding the entity; a separate check remains available when needed. Existing saved rules retain their scope until edited. Notifications remain off until activated.

Sources uses Home Assistant's configuration entry and device registry links to group connections, devices, and entities. When one connection owns one device, they share one tree row with separately labeled connection and device availability status; each keeps its own detail and monitoring choice. A connection that owns several devices stays above them. A connection without a device can still have entities. Names alone never establish a link.

An enabled device summary uses ordinary entities, including buttons, or diagnostic entities when there are no ordinary ones. Hidden but enabled entities can supply evidence, while disabled devices and entities do not. An HA `unknown` value does not create an availability issue; `unavailable` creates a warning, even when all selected entities are unavailable. Missing entity evidence and explicitly required sources remain separate coverage questions across restarts. When Home Assistant confirms that an automatically enrolled config entry was deleted, Homeostatic removes it from scope and resolves its episode as removed. Startup grace and recovery confirmation default to two minutes; ordinary notification batching defaults to thirty seconds. See the [specification](spec.md) for every timing and its meaning.

### Open the dashboard

After setup, administrators can open **Homeostatic** in the HA sidebar. Use the hamburger beside the Homeostatic title to reopen the HA menu, including on phones.

| Page | Use it for |
| --- | --- |
| **Overview** | Current issue and monitoring counts, plus the three newest issues. |
| **Issues** | Every open problem, its evidence, impact, and next action. |
| **Sources** | Browse discovered connections, devices, entities, and batteries; choose specific checks and reporting preferences in a source's **Settings**. |
| **Notifications** | Choose reporting types, schedules, people, destinations, and whether to request delivery. |
| **Settings** | Set installation-wide Timing, Problem grouping, and Monitoring policies for groups. |
| **History** | Review ended problems and distinguish recovery from removal. |

Turning requests on can alert about already-open problems. The pages and problem/function details use one shared live subscription. Sources searches all discovered sources while keeping rendered branches bounded. Startup, monitoring errors and a disconnected browser are explicitly unavailable.

The monitoring catalog omits **Change device type of a switch** helper entries because they wrap an existing switch; the converted entity can still be monitored. **Group** entries stay because a group can be an automation control target. A healthy Group entry or group entity does not establish that every member works. Monitor important members directly; the Group row's source count is not a device count.

Problem details identify the integration and instance, show Home Assistant's reported setup reason when available, and link to that entry or its filtered logs. Sign-in instructions appear for a pending HA reauthentication request. A setup error without a reported cause is labeled as such; it does not guess that a password is wrong. During retries, the last reported failure remains available with its timestamp while the current setup activity is shown separately. Disabled entries have a distinct explanation and remain unknown. Dependency causes appear only when present, with technical and notification details available below.

The integration also registers a **Homeostatic** community dashboard strategy in HA's new-dashboard dialog. Add it there for a separate dashboard, or add the Homeostatic card to an existing dashboard:

```yaml
type: custom:homeostatic-card
view: overview
```

Supported views are `overview` (Overview), `sources`, `history`, `notifications`, `configuration` (Settings), `functions`, and `problems`. Older `house` and `coverage` view settings open Sources. The last two are focused cards. Set `navigation: false` to hide internal page tabs; drill-downs retain a return button to the configured view. Local frontend resources are registered automatically; existing dashboards are not modified.

The dashboard is administrator-only because it includes installation-wide configuration, inventory and routing. Readiness entities retain their ordinary HA access controls. Problem cards and details explain the reported condition, confirmed effects on configured functions, a relevant next step and recovery progress. NuHeat and receiver timeouts, sign-in requests, disabled connections and recovery have distinct guidance. **Pause alerts** is directly visible in problem details and applies only to that problem; other problems on the equipment are unaffected. Equipment **Working on this equipment** is available from source details. Active controls keep a visible expiry notice. **Technical details** holds timestamped original errors, filtered logs, **Copy diagnostic data** and optional **View raw data**. Pausing alerts and maintenance each require an end time within seven days. Maintenance previews affected capabilities, functions and existing problems before applying. Existing alerts remain active during maintenance; shelving holds new alerts, including urgent ones, for every recipient. Administrators can use **Acknowledge** to record awareness and **End now** to cancel a temporary control. Active controls show their expiry and reason. Both forms use the existing administrator actions and keep unfinished entries through live updates. Availability does not prove physical freshness or command completion.

**History** shows up to 100 ended episodes within 30 days, with search, outcome filtering and twenty rows per page. Details explain what Home Assistant reported, how the issue ended, and the time range when Homeostatic observed it. A cleared device availability issue does not establish why the device changed state or whether it was physically repaired. The saved finding remains searchable but is not repeated in a separate dropdown. Removal from monitoring and absorption into another problem do not establish recovery. Collection start and retention limits are visible. Current monitoring scope and evidence gaps appear in **Sources**. TopoMation is not required or read by this increment. Notification event/blueprint links and automatic Repairs remedies remain follow-up work.

### Choose what to watch

Open an integration's **Settings** in Sources. **Allow monitoring for this integration** stops
or allows its connection, device and separate entity checks while retaining
individual choices. When allowed, only checks selected by the saved policies and source choices run. **What to monitor** shows current counts; **Change** opens
connection or device choices. Saved exclusions and individual choices remain
visible. Review shows the effect of an unsaved choice before it is applied.

**When to notify** shows device reporting preferences and check-specific
exceptions. A bulk reporting edit applies to the listed current devices; new
devices use the household reporting default. Manage shared times, recipients
and activation in **Notifications**. The single **Review changes** footer
includes all pending monitoring and settings changes. Nothing is saved until
**Save changes**, and notification activation is never implicit.

Use **Sources → Settings** for a specific connection, device, entity, or battery. Use
**Settings → Monitoring policies** for group choices that also cover future
sources. Review the effective scope before saving. **Advanced rule details**
there retains every saved condition when policies overlap.

### Battery condition

Sources lists battery candidates discovered from Home Assistant battery percentage,
low-warning, and charging entity classes. They are unmonitored until a saved
policy selects them, either **Monitor this battery** in Sources or the group
choice below. A battery condition is
separate from entity and device availability. A percentage of **20% or less** or
an explicit low warning opens a battery finding. A current charging report
clears that low condition even if the low reading remains; if charging stops
while the low reading remains, the finding can return. Missing or restored
readings do not prove recovery. Homeostatic does not know whether the battery
was replaced or fully charged.

Open the candidate in Sources to review every paired entity and its current
reading before selecting it. If a device exposes several battery signals,
Homeostatic offers separate candidates when their pairing is ambiguous. Use
the ordinary reporting preference for the selected battery to choose when its
finding reaches someone. Homeostatic does not infer battery chemistry or a
replacement part from the entity name.

To watch every current and future battery candidate, open **Settings →
Monitoring policies** and choose **Monitor all batteries** above the group
policy list. **Review changes** shows the current scope; **Save choices** applies
it. Individual battery exclusions still take precedence. This action drafts a
policy and does not itself save choices or change notification activation.

On a new installation, the default policy watches integration connection state.
The native Home Assistant setup and options forms do not ask for catalog YAML.
Open Homeostatic after setup to choose additional monitoring.

New installations leave device summaries and separate entity checks unmonitored. Choose an integration to watch its current and future devices, or select individual devices and entities. Existing saved broad rules keep their scope until you review and save a change.

Each selected device creates one availability check over enabled ordinary entities, or diagnostics if no ordinary entities exist. Hidden entities are still included; disabled and configuration entities are not. Entity exclusions also remove those entities from device summaries. All selected members available passes. Some unavailable produces a warning explaining partial unavailability; all unavailable produces a warning explaining total unavailability through Home Assistant. An HA `unknown` value counts as available for this passive check, while its raw value remains visible. Missing or restored evidence without an unavailable member leaves the assessment unknown. If unavailable members coexist with missing or restored evidence, the warning reports the known unavailability without claiming the remaining members are available. Excluding every member leaves no check and is not evidence of health. There are no manufacturer-specific exceptions.

### What an availability problem means

Device details show **Available**, **Unavailable**, **Unknown**, or **Disabled**, following the entity fallback in [HA architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400) and [ADR 0035](adr/0035-align-device-availability-with-ha-proposal.md). One available enabled entity makes the device Available, even if another entity has a monitoring warning. All enabled entities unavailable makes it Unavailable. Missing or restored evidence without any available member leaves it Unknown; a disabled device is Disabled. This assessment includes enabled entities excluded from monitoring. **Partially available** is reserved for conflicting explicit integration reports, which require the proposed upstream reporting API. Selected-entity warnings below remain separate.

Home Assistant does not provide one error status that rolls down from system to integration to device. An **integration** connects software or equipment to HA. A **device** groups related **entities**, each representing a capability or value. Integration setup state, entity availability, explicit problem sensors, and Repairs issues are different signals; a loaded integration does not guarantee that all its entities work.

`off` or `idle` normally means an entity is available but inactive. `unknown` means its value is not known. `unavailable` means HA currently cannot supply that entity's functionality or data. It can accompany communication failure, but an integration can also use it for an optional capability that is absent in the current operating mode. That state alone does not tell Homeostatic whether anything needs repair. Hiding an entity changes its presentation, not its availability or monitoring.

Homeostatic checks an **expectation**: selecting an entity says it should be available; selecting a device summary applies that expectation to the selected members. New setups monitor integration connections and let you opt in to device summaries by integration or device. Existing saved choices stay in force until you change them. Problems describe the reported availability and show the contributing entity names and current states. They do not claim the hardware is broken. See HA's [entities and devices](https://www.home-assistant.io/getting-started/concepts-terminology/) and [availability guidance](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/entity-unavailable/) for the underlying model.

If an unavailable capability is normal or unimportant in your home, choose **Ignore availability** in its details, review the monitoring preview, and **Save**. This records a persistent exclusion for that entity, including its contribution to device summaries. Its HA state stays unchanged. Registry identity keeps the choice through renames and restarts; remove the exclusion in **What to monitor** to watch it again. Removing evidence ends the old problem as removed from monitoring, not recovered. Acknowledging a problem means you have seen it; shelving temporarily postpones attention. Neither means the source recovered or should be permanently ignored.

### Advanced: rule matching and exclusions

A saved broad rule without `kind: device` does not implicitly enroll device summaries. Edit or pause a rule in Monitoring policies; an empty catalog intentionally watches no equipment. Exclusions normally win regardless of rule order. An integration device default can leave current and future devices unmonitored while an exact device choice watches one device. Check timings are installation settings under Timing.

For example, keep the integration policy, add a group policy that leaves
workbench-area sources unmonitored, and exclude one experimental entity from
its Source Settings. Review shows the current sources affected by all three
choices. Catalog rules support one check per row:
`availability` or `battery`. Omitting `checks` selects `availability`.
Battery rules apply to battery candidates and do not alter availability
monitoring. Other checks/parameters are rejected. Equipment exclusions do not
suppress situation alerts.

| Match field | Value |
| --- | --- |
| `domain` | Entity domain (`sensor`, `light`, etc.), or integration domain for an integration node |
| `device_class` | Effective HA device class, such as `temperature` |
| `integration` | Config-entry id; matches that instance and its entities |
| `device` | Device registry id; matches its entities, and a device summary when `kind: device` is explicit |
| `entity` | Current entity id on input, saved as `registry:<id>` when registered |
| `area` | Effective area id: entity override, otherwise device area |
| `floor` | Floor id of that effective area |
| `label` | Label id on the entity, device, or effective area |
| `kind` | `entity`, `device`, `integration`, or `battery`; device summaries require an explicit device kind match |

A field accepts a string or a list of alternatives. Different fields must all match. Names never drive matching. Get exact ids and matching attributes from `homeostatic.inventory`; entity display names can change without changing rule identity. State-only entities use the weaker `entity_id:` reference and need edits after a rename.

Use **Review changes** to see the proposed watched-source count and current
sources starting or stopping monitoring. **Save choices** applies only that
reviewed proposal. A zero change in watched-source count can still change
device-summary membership or how future sources match. Advanced rule details
shows exact conditions and overlapping policies. The read-only
`homeostatic.inventory` action gives full per-source attachment and exclusion
explanations.

Device/area/label moves trigger matching again; the periodic reconciliation also catches new integration instances. Inventory includes `attached_by`, `excluded_by`, and the last 50 enrollment changes from the current runtime, with before/after attributes. It includes excluded candidates so an absent check can be explained. Previously enrolled missing identities retain their last known attributes for matching until explicitly excluded or unmatched by edited rules.

Existing saved monitoring rules retain their scope when native options are edited. Review or change that scope in **Sources** and **Settings → Monitoring policies**; the native options form has no catalog-rule editor.

### Define a function

In **Functions (YAML list)**:

```yaml
- id: garage_access
  name: Garage access
  importance: high
  requires:
    - cover.garage_door
    - binary_sensor.garage_obstruction

- id: arriving_home
  name: Arriving home
  importance: critical
  requires:
    - function:garage_access
    - entry:YOUR_CONFIG_ENTRY_ID
```

Keep `id` stable; it identifies the function and its readiness entity. Names may change. Importance is `low`, `normal`, `high`, or `critical`, and HealthTree propagates it upstream to shared causes. It does not directly choose notification routing.

Requirements may name an entity, an integration (`entry:<id>`), another function (`function:<id>`), or an external capability (`external:<id>`). Entity inputs are saved as `entity:registry:<id>` when registered; already-saved references are accepted too. The earlier `entities` list still works alongside `requires`. Cycles and situation-node requirements are rejected before saving.

Catalog rules decide which checks watch each requirement. Missing, excluded or unmatched requirements remain explicit unknowns. An excluded entity cannot borrow readiness from its healthy integration. A function with no requirements is an unwatched draft. Any answer other than `ready` means the requirements are not all proven ready. Availability checks still do not prove successful command completion or physical-device freshness.

For a capability outside HA, enter this in **External capabilities (YAML list)**:

```yaml
- id: backyard_network
  name: Backyard network service
  importance: high
```

Then add `external:backyard_network` to a function's `requires`. This declares an unwatched requirement, so the function stays unknown until an appropriate evidence producer exists. This increment implements declarations and dependencies; it does not probe the external service or accept external health reports. Deleting a declaration that a function still requires leaves a visible missing requirement.

### Review automation suggestions

Associate existing automations with the function whose needs you are defining:

```yaml
- id: basement_lighting
  name: Basement motion lighting
  importance: high
  automations:
    - automation.basement_motion_lighting
  accept:
    - binary_sensor.basement_motion
    - light.basement
  reject:
    - input_boolean.optional_mode
```

Start with `automations` and preview before choosing `accept` or `reject`. The preview lists statically discoverable entity references and current members of device/area/floor/label targets. Every suggestion identifies the automation and reference type. Conditions, optional actions and notification targets can all appear; **accept only a capability whose failure prevents this function from working**. Listing an automation does not itself create a dependency on its availability.

Accepted candidates become required edges for this function. Rejected and unreviewed candidates create no edges. Decisions use stable entity identities and survive refresh/reload. If an automation stops referencing an accepted entity, the requirement remains until explicitly removed; the preview marks it as no longer suggested. Automations outside a function contribute no suggestions to that function and no inferred dependency edges.

Candidate discovery is deliberately marked incomplete: runtime templates and downstream scripts/scenes are not recursively analyzed. Declare any missing requirement explicitly. Situation alerts remain independent of this equipment graph.

### Preview function changes

Turn on **Preview without saving** in setup/options for the current rule counts and proposed function readiness, gaps, and candidate decisions. Catalog changes are reviewed and saved in Homeostatic, not in this native form. Correct any validation error, review the result, then turn Preview off to save other option changes. For full explanations, use `homeostatic.functions` for current monitoring, or preview an unsaved replacement list:

```yaml
action: homeostatic.preview_functions
data:
  functions:
    - id: garage_access
      name: Garage access
      importance: high
      requires:
        - cover.garage_door
        - binary_sensor.garage_obstruction
response_variable: preview
```

The response includes added/removed requirement edges, rule attachment/exclusion explanations, missing requirements, effective upstream importance and affected functions. Optional `external_capabilities` and `rules` fields replace those settings for the preview; omitting them retains current settings. The `functions` list replaces the entire function list in the preview.

Preview uses current observations in an isolated HealthTree model. It does not reproduce previous hold timers or episode history, save options, fire notifications, or execute automations. `present` means a current HA state/entry exists, or that a function/external declaration exists; it does not establish health. Readiness and monitoring status are separate fields.

### Bind a situation

Create the condition in HA first, using a template, binary sensor, or an automation-maintained helper. In **Situation alerts (YAML list)**:

```yaml
- id: garage_open_at_night
  name: Garage open at night
  importance: critical
  entity: binary_sensor.garage_open_at_night
```

The entity owns the condition, schedule, and delay. Homeostatic owns the episode and attention lifecycle. The source must report **unavailable when its evidence disappears**, not off; otherwise a dead source looks like a cleared situation. Its availability contract is not automatically verified in this increment. Restored or unexpected values are unknown. Only a genuine `off` clears the alert. Situation nodes have no dependency edges and never enter the overall readiness selection.

### Activate notifications

Open **Notifications** to review reporting types and schedules, add a person and a Companion phone destination, and check which routes are ready. Set a source's reporting preference in **Sources → Settings**. Leave requests off while checking monitoring and reporting; when ready, turn on **Enable notification requests**, review the effect on current open problems, and save. Immediate preferences include overnight. A notification request is not proof that the phone received it.

Existing open problems can produce requests when you activate notifications. Scheduled problems wait for their report, and resolved problems are omitted. Acknowledging records awareness but does not resolve a problem. See [Fixed reporting preferences](#fixed-reporting-preferences) for the six choices and their default times.

### Advanced: consumer automation

An existing custom consumer can still receive `homeostatic_notification` events. Install the [consumer blueprint](../blueprints/automation/homeostatic/companion_notification.yaml), create an enabled automation using your Companion `notify.mobile_app_...` action, and set its recipient and channel to match the advanced policy. Select it in native Homeostatic options under **Notification consumer automation** before activating events. This is an alternative to the guided person and phone setup.

Under a custom policy, open problems are summarized per recipient when policy permits delivery, then followed by live changes. Quiet hours and batch delays can defer the summary; digest-only problems wait for their digest. Record-only problems and an empty activation send nothing. The selected consumer is checked for being present and enabled; arbitrary consumer logic and phone receipt are not verified. A missing or disabled consumer appears as an evidence gap.

The integration emits events and retains the last requested content. A consumer owns tags, replacements, clearing, sound, and transport-specific behavior. Unknown evidence does not blank the previous failure message. Dismissing a phone message does not resolve its episode. The [event contract](events.md) describes payloads and at-least-once replay after interrupted storage acknowledgement.

### Advanced: configure notification policy

Edit **Notification policy (YAML mapping)** in native setup/options. The default is `owner`
on the `event` channel, with critical problems urgent and other problems notified
after the house's notification delay. This example uses phone consumers:

```yaml
timezone: America/Chicago
recipients:
  owner:
    channels: [phone]
    quiet_hours: {start: "22:00", end: "07:00"}
  backup:
    channels: [phone]
digests:
  morning: {at: "08:00", to: owner}
rules:
  - match: {importance: critical}
    loudness: urgent
    to: [owner, backup]
    remind_every: 15m
  - match: {category: situation}
    loudness: notify
    to: owner
    remind_every: 1h
    escalate_after: 2h
  - match: {status: unknown}
    loudness: digest
    digest: morning
    remind_every: 1d
  - match: {}
    loudness: notify
    to: owner
    remind_every: 4h
    escalate_after: 1d
```

For each reason, the first matching rule wins; HealthTree chooses the loudest
result across reasons. Supported matches are `status`, `importance`, `reason`,
`category`, `labels`, `age`, and `due_within`. Omitted fields match anything;
values within a field are alternatives. Labels must all match. Durations accept
integer seconds or strings such as `1d2h30m`; reminders must be positive. Clock
times must be quoted `HH:MM`. Set `timezone` explicitly for the house.

`record` retains a problem without sending it. `digest` requires a named digest;
`notify` and `urgent` require recipients. Urgent requests pass quiet hours. Notify
reminders wait through that recipient's quiet hours. Escalation raises one level
when a destination is available; it does not repeatedly climb the ladder.
Recipients and channels are opaque ids, not notification service names. Configure
a blueprint instance for `owner`/`phone` and another for `backup`/`phone` in the
example. The selected consumer check cannot verify every route or actual receipt.

Call `homeostatic.policy` to inspect current winning rule indexes (zero based),
recipients, pending times, and the next deadline. Call `homeostatic.preview_policy`
with the proposed mapping under `policy` to simulate activation against current
open episodes. Preview returns proposed requests and decisions without saving,
sending, or changing live timers. The options Preview also displays those decisions.

Activation preserves problem history and starts escalation afresh. Each recipient's
reminders begin with their first request. Ordinary restart preserves these clocks.
Editing policy or notification delay while enabled clears old requests and starts
attention under the replacement policy. Summaries and digests update silently as
members resolve; the last resolution clears the group. An individual reminder or
escalation replaces that episode's membership with its own message.

Presence-dependent recipients and phone acknowledgment wiring remain future integration work. Administrator acknowledgment is available through the dashboard and native HA actions.
Shelving is available through the administrator action described below. Policies cannot execute corrective actions.

### Inspect the model

In **Developer tools → Actions**, call `homeostatic.inventory` for node ids, rule explanations, recent enrollment changes, episodes, and notification requests. Pass a node id to `homeostatic.explain` or `homeostatic.impact`. `homeostatic.readiness` and `homeostatic.rollup` default to selected capabilities/functions and accept `node_ids`. These actions are read-only. Situation ids are `situation:<id>`, function ids are `function:<id>`, and external capability ids are `external:<id>`.

## Operator controls

Use **Developer Tools > Actions** while the monitor is running. `homeostatic.inventory` supplies stable node and episode ids; `homeostatic.operator_controls` lists active controls and their expiry/reason. Mutations require administrator access for user calls; HA automations can use the same actions. All expiries must include a timezone, be in the future, and be within seven days.

Preview a scope before creating maintenance. Replace the example node and expiry with your actual selection:

```yaml
action: homeostatic.preview_maintenance
data:
  node_id: "entity:entity_id:sensor.observed"
  include_dependents: true
  until: "2026-09-25T22:00:00Z"
response_variable: maintenance_preview
```

The response names the current scope, functions and existing problems. Use the same fields with `homeostatic.start_maintenance` and an optional `reason` to apply it. Dependents follow the graph during the window. Maintenance prevents new equipment problems from opening; readiness, existing alerts and independent situation alerts remain active.

To pause alerts for an already-open problem across every recipient:

```yaml
action: homeostatic.shelve
data:
  episode_id: "<current episode id from inventory>"
  until: "2026-09-25T22:00:00Z"
  reason: "Working on this problem"
```

Shelving leaves the problem and its current message visible. Silent updates and resolution still work. The shelf holds reminders and escalation, including urgent alerts, until expiry; other policy holds still apply. Shelves and maintenance survive restarts. A shelf can be extended. Shelving and maintenance dashboard forms are available. Administrator acknowledgment and early cancellation use the same durable native actions. If an action reports a storage error, inspect active controls after the monitor recovers before retrying.

## Awareness and ending controls early

Administrators can use
**Acknowledge** on a problem and **End now** on an active temporary control.
Acknowledgment records awareness; the problem remains until observed recovery.
Add `require_acknowledgment: true` to a notification policy rule when its repeated
alerts should stop once acknowledged. Other rules keep their configured behavior.
Native actions are `homeostatic.acknowledge` (`episode_id`) and
`homeostatic.cancel_control` (`control_id`). Their replies confirm durable state.

HealthTree 0.4.0 provides these APIs and HA installs it automatically. Acknowledgment
records the first actor and time across recipients and survives restarts. Phone
action wiring remains separate consumer work; receipt and dismissal do not count
as acknowledgment.

## Recently resolved problems

`homeostatic.resolved_history` returns the latest 100 terminal episodes observed within 30 days, newest first. The same response is available under `homeostatic.inventory` → `resolved_history`. It includes collection start time and retention limits. History survives a restart and includes problems that cleared before a notification was requested.

Each row retains the original episode id, opening time, findings and display labels under `episode`, plus `resolved_at`, `resolution`, `absorbed_into` and a source display snapshot when available. `cleared` means the library observed recovery; `removed` means monitoring ended; `absorbed` links to a larger problem. Resolution time is when Homeostatic learned of the event, including after downtime. Old findings describe the past episode, not current device health. Upgrading starts collection from that point; earlier resolutions are not reconstructed. This is bounded problem history, not a full activity or delivery journal.

## Scaling validation

This candidate skips health graph construction for enrollment previews with
no functions, and uses HealthTree's atomic registration for setup, function
validation, function preview and graph changes. Healthy monitored sources remain
in the graph; explicit missing or unwatched requirements remain coverage gaps.
Unrelated inventory stays outside monitoring.

Graph construction has passed isolated 10,000-source scenarios. The 0.1.0b13
pilot pins HealthTree 0.4.0. In ten synthetic device-summary outage cycles,
settlement took 0.358-0.502 seconds; one event-loop gap reached 186 ms, above
the proposed 100 ms target. All 6,000 individual entity checks still miss the
burst budgets. These results do not qualify broad enrollment or HA appliance
performance. See [runtime qualification](testing/runtime-scaling.md).

## Fixed reporting preferences

Each Companion phone appears once under People and destinations, even when Home Assistant exposes both a phone action and a notify entity for it. Saved selections are retained. Separate device registrations remain separate choices; matching names do not prove they are the same device.

Open Notifications to see reporting types and schedules directly, select people and their destinations, and review
before enabling requests. Assign Immediate, Immediate with acknowledgement, Morning,
Evening, Weekly, or Dashboard only in Sources Settings. Both immediate choices
include overnight; only acknowledgement repeats every 30 minutes. Acknowledgement
records awareness and never clears a problem.

New sources inherit Weekly (Sunday 09:00). Morning is 08:00; evening 18:00.
Summaries show new and still-outstanding open problems with age. Empty reports and
resolved entries are omitted. Destinations without silent replacement support receive
no update or resolution messages. A notification request is not proof of receipt.

Existing notification policies stay active until you review a migration. Source
defaults can be changed in bulk while condition exceptions remain intact. Shared
root problems use the strongest explicit affected-source preference, preserving one
episode. Overview shows readiness and the next nonempty report's provisional count.

The reporting controls remain visible when an older notification policy is saved.
Opening them does not change it. Editing or reviewing the initial setup creates a
draft with requests off; review and save applies it. Global monitoring policies
are under **Settings → Monitoring policies**, not inside an individual source.

Monitoring policies lists group rules, such as watching integration connections
or device availability for an integration type. These can match future sources
as well as current ones. Watch rules appear first; open **Leave unmonitored
policies** to review group exclusions. Open **Edit group policy** to change a
group's conditions.
For specific integrations, devices, or entities, open **Sources**, select the
source by name, and use its **Settings**. **Advanced rule details** contains the
complete catalog for inspecting exact conditions or correcting overlapping rules.
Opening either page preserves your choices; edits require **Review changes** and
**Save choices**. Removing a rule does not stop monitoring if another rule still
selects that source.

## Beyond the pilot

Complete product presentation; capture healthy/failure/recovery traces for detector liveness, device-originated freshness and command completion; verify an external watchdog and notification consumers; validate the actual deployment. Synthetic fixtures and high coverage do not satisfy the real-house evidence gates.

### Report situations from HA automations

Use the native **Homeostatic: Report situation** action or the supplied blueprint
with HA condition and trigger editors. See [automation situation setup](automation-situations.md)
for water, temperature and motion/time/moon examples, refresh requirements, and notification setup.

## Open a phone alert

Tap an individual Companion notification to open its Homeostatic issue. Summaries
and digests open Issues. If the issue ended, the link shows retained history; if
that history expired, the page says so. Acknowledge is a separate action inside
the issue. You must be signed into the sending HA server with access to Homeostatic.
Route-test notifications open Notifications. Notifications sent before this
feature need a new push to gain a tap destination.
