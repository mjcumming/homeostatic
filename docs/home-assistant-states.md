# Home Assistant states

Homeostatic's checks rest on what Home Assistant reports. This page records what Home Assistant documents about entity states and availability, what Core actually does, how integrations use it in practice, and how Homeostatic reads each signal. It's for maintainers. Read it before changing how Homeostatic interprets an entity, device or integration.

Checked against Home Assistant 2026.9.3 and the Core `dev` branch on October 2, 2026. Quotes are from the linked pages on that date.

## What Home Assistant documents

**Entity states.** Every entity has exactly one state. The [state objects](https://www.home-assistant.io/docs/configuration/state_object/) page gives two of them a special meaning:

- `unavailable`: "The entity cannot provide its state right now. For example, Home Assistant cannot reach the device or service, or the integration of the entity has not been set up."
- `unknown`: "The entity has no value for its state."

**The `available` property.** Integrations don't write `unavailable` themselves. They set an entity's [`available`](https://developers.home-assistant.io/docs/core/entity/) property, described as whether Home Assistant "is able to read the state or control the underlying device", and Core writes `unavailable` when it's false.

**When to use each.** The quality-scale rule [entity-unavailable](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/entity-unavailable/) tells integrations: "If we can't fetch data from a device or service, we should mark it as unavailable. We do this to reflect a better state, than just showing the last known state." And: "If we can successfully fetch data but are temporarily missing a few pieces of data, we should mark the entity state as unknown instead." One exception: a device that can still be turned on another way, such as an IR blaster or Wake-on-LAN, should report `off` rather than `unavailable`.

**What Home Assistant does when something goes unavailable.** The rule [log-when-unavailable](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/log-when-unavailable/) asks integrations to log once at info level when a device or service becomes unavailable, and once when it's back. Nothing else tells the owner. That gap is why Homeostatic exists.

**Refusing an action.** [Raising exceptions](https://developers.home-assistant.io/docs/core/platform/raising_exceptions/) and the rule [action-exceptions](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/action-exceptions) separate two failures. `ServiceValidationError` is for "incorrect usage (for example incorrect input or referencing something that does not exist)". `HomeAssistantError` is for "an error in the service action itself (for example, a network error or a bug in the service)". Background: [Exception handling during service calls](https://developers.home-assistant.io/blog/2023/11/30/service-exceptions-and-translations).

**Choosing an entity type.** A [button](https://developers.home-assistant.io/docs/core/entity/button/) "remains stateless from the Home Assistant perspective"; anything with an on/off state should be a switch. A [select](https://developers.home-assistant.io/docs/core/entity/select/) "should only be used in cases there is no better fitting option available", such as a mode the entity's own platform can't express.

## What Core does

These are behaviors in Core's source, cited by file because line numbers move.

| Behavior | Where |
| --- | --- |
| An entity whose `available` is false is written as `unavailable`; a value of `None` is written as `unknown`. | `homeassistant/helpers/entity.py` (`_stringify_state`) |
| When Home Assistant starts, every registered, enabled entity that has no state yet is written as `unavailable` with the attribute `restored: true`. It stays that way until its integration loads. | `homeassistant/helpers/entity_registry.py` (`write_unavailable_state`, `_write_unavailable_states`) |
| A select whose current option isn't in its options list reports `unknown`. Choosing an option outside the list raises `ServiceValidationError`. | `homeassistant/components/select/__init__.py` |
| Only persistent Repairs survive a restart. The rest are loaded inactive until their integration raises them again. | `homeassistant/helpers/issue_registry.py` |
| The standard toggle is disabled only for `unavailable`. For `unknown` it shows separate on and off buttons. | Frontend `src/components/entity/ha-entity-toggle.ts` |
| Core has no device availability. The device registry has no availability field or report. | `homeassistant/helpers/device_registry.py` |

## Device availability

Core does not model generic device availability. [Architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400) proposes integration-reported availability and an entity fallback, but this is not a supported API. Rechecked against Core's current device registry on October 18, 2026.

Homeostatic monitors selected entities independently and groups their evidence under registry devices. It does not derive a device availability verdict or implement the proposal in advance. Saved device policies migrate to entity coverage under [ADR 0103](adr/0103-entity-availability-with-grouped-selection.md). Current connectivity `off` remains a provided entity state, not an availability failure.

## How integrations use it

The documented meaning of `unavailable` is "can't reach it". In practice it also means "can't use it right now":

- **Mode-dependent controls marked unavailable.** Some integrations mark a control `unavailable` when the device's current mode or program doesn't support it. The frontend then greys it out, which is the only way the standard toggle can be disabled. To anything reading states, that control looks the same as lost contact.
- **Mode-dependent controls kept available.** Other integrations keep the state and refuse an invalid change with `ServiceValidationError`. The SmartThings Samsung dishwasher wash-option switches (`homeassistant/components/smartthings/switch.py`, `_validate_before_execute`) refuse when remote control is off, when the dishwasher isn't stopped, or when the selected cycle doesn't support the option. Their availability follows only the device's online status. The NeoPool filtration switch (`homeassistant/components/neopool/switch.py`) reports on or off and refuses a change outside manual mode or during boost.

Both patterns are in Core, so Homeostatic can't assume either. An unavailable entity on a device that otherwise has current states can be a feature switched off by mode rather than lost contact. Discussion 1400 itself treats entity availability as imperfect evidence of device availability.

## How Homeostatic reads each signal

Automatic entity availability selects enabled operational entities, including those without a device. Home Assistant's [entity categories](https://developers.home-assistant.io/docs/core/entity/) identify diagnostics and configuration entities; broad, area and label availability selection leaves both out. Exact entity selection opts that entity in. Battery, UPS and temperature checks retain their configured diagnostic inputs. Registry categories and explicit `disabled_by` fields determine eligibility; no state value implies disablement. These selection rules were reviewed against Home Assistant documentation and registry definitions on October 14, 2026.

**Entities.**

| Home Assistant reports | Homeostatic reads it as | Result |
| --- | --- | --- |
| A value, including `off` and `idle` | Available | No issue |
| `unknown` | Available with no value | No issue |
| `unavailable` | Home Assistant can't read or control it | Warning issue |
| `unavailable` with `restored: true` | Missing information while the integration loads | An issue only if it lasts past **Wait for unknown evidence** |
| No state at all | Missing information | Same as restored |

**Devices.** A device availability check uses enabled operational members, including buttons and hidden entities, minus that policy's excluded members. Diagnostic and configuration entities never supply this check, and there is no diagnostic fallback. No eligible members means no check. It warns when every selected member is unavailable, passes when any member has a current state, and is unknown when current evidence is absent or restored without every member being unavailable. Current `unknown`, `off` and `idle` pass, including `off` from connectivity sensors. Each independently monitored entity retains its own findings. A passing device or sibling does not clear an entity's unavailable or missing evidence.

The separate device assessment in Sources also uses enabled operational entities and these state meanings. Policy-specific evidence and counts honor that policy's exclusions; canonical device details combine its enabled device checks. Read-only inspection of a device without a policy shows operational evidence without enrolling it. An inventory assessment may differ from a policy with exclusions, but diagnostics and connectivity off values cannot invent an availability failure. ADR 0064 records this boundary.

**Integrations.** A loaded config entry passes. Setup retry is a warning that becomes a failure after **Wait before reporting setup retries**. Setup errors, migration errors, failed unloads and a pending sign-in are failures. Disabled config entries remain visible in Sources but are outside availability monitoring. Not-yet-loaded and loading entries are missing information. Core uses `disabled_by` to skip entry setup and propagates disablement to device and entity registries; an unloaded entry alone is not disabled. Homeostatic has no separate Supervisor add-on runtime check, and does not interpret stopped add-ons or disabled automatic startup as disablement.

**Severity.** `unavailable` is a warning because it says Home Assistant can't reach something, not why: the device, its battery, the network, a hub, a cloud service or a reload. Integration setup failures are failures because Home Assistant reports them as errors.

**Repairs.** Home Assistant's [Repairs API](https://contributors.home-assistant.io/core/integrations/repairs/) and [issue registry](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/helpers/issue_registry.py) define explicitly raised issues with `warning`, `error` or `critical` severity. An entity's fault state does not automatically create a Repair. Homeostatic's [Repair reader](../custom_components/homeostatic/repairs.py) maps every active Repair to `fail` and retains Home Assistant's original severity in its message and evidence. Repair findings and direct condition findings keep independent identities, so they can describe overlapping problems. Checked against Core 2026.10.0 and the current reader on October 25, 2026.

**Vacuums.** The vacuum entity's state is an activity. Core's `VacuumActivity` lists six: `cleaning`, `docked`, `idle`, `paused`, `returning`, and `error` (`homeassistant/components/vacuum/const.py`). The entity state is that activity (`homeassistant/components/vacuum/__init__.py`). The state translation describes `error` as the vacuum encountering an error. Homeostatic fails on `error` and passes on the other five. `unavailable`, `unknown`, a missing state, a restored state, and any other value are unknown, so they leave an open vacuum issue open. An integration that maps a vendor status such as offline onto `error` produces the issue while the entity state is `error`. A fault that stays on some other entity never becomes this check.

**Lawn mowers.** The [lawn mower contract](https://contributors.home-assistant.io/core/entities/lawn-mower/) and [Core activity enum](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/lawn_mower/const.py) define `error` as needing assistance. Homeostatic fails on a current `error` report and passes on `mowing`, `docked`, `paused`, `returning` or `idle`. Core 2026.9.3 lacks the `idle` enum member; Core 2026.10.0 includes it. Missing, restored, unknown, unavailable and unrecognized reports remain unknown and preserve an open condition. Idle or paused activity supplies no evidence of a missed task or stuck mower. Rechecked October 25, 2026.

**Binary conditions.** Homeostatic reads the exact `problem`, `tamper`, `safety`, `moisture`, `smoke`, `gas` and `carbon_monoxide` device classes on `binary_sensor` entities. The [binary-sensor contract](https://contributors.home-assistant.io/core/entities/binary-sensor/) and [Core classes](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/binary_sensor/const.py) give `on` and `off` their class-specific meanings. A current `on` fails the selected condition; `off` passes. Missing, restored, unknown, unavailable and unrecognized reports remain unknown and cannot clear an open condition. Enabled diagnostic sensors remain eligible. The class supplies neither a cause nor notification urgency: Homeostatic reports the named condition and uses the saved policy notification. Water leak requires selection of moisture sensors used for leak detection. Rechecked October 25, 2026.

**Alarm panels.** The [alarm panel contract](https://contributors.home-assistant.io/core/entities/alarm-control-panel/) defines `triggered` as an alarm going off. Homeostatic fails on that current report and passes on `disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `pending`, `arming` or `disarming`. Missing, restored, unknown, unavailable and unrecognized reports remain unknown and preserve an open condition. These readings establish the reported alarm condition, without establishing that security equipment works or the home is secured. Rechecked October 25, 2026.

**Locks.** The [lock entity contract](https://contributors.home-assistant.io/core/entities/lock/) and [supported Core implementation](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/lock/__init__.py) define `jammed`, `locked`, `unlocked`, `locking`, `unlocking`, `open` and `opening`. Core gives `is_jammed` precedence over movement and position. Homeostatic's Jammed lock check fails on a current `jammed` report and passes on the six other recognized states. Missing, restored, unknown, unavailable and unrecognized readings remain unknown, preserving an open jam. No separate feature flag establishes jam-reporting support. Passing does not establish completed movement, physical freshness or a secured door. Rechecked October 24, 2026.

**Covers.** The [cover contract](https://contributors.home-assistant.io/core/entities/cover/) and [Core implementation](https://github.com/home-assistant/core/blob/2026.10.0/homeassistant/components/cover/__init__.py) report `open`, `opening`, `closed` and `closing`, including for garage doors. They define no standard obstruction or jam property. Additional fault reporting depends on the entities the integration supplies. The lock contract's optional `is_jammed` property therefore provides a fault signal that the cover contract lacks. Rechecked October 25, 2026.

**Other entity states.** An update entity is `on` or `off`, with install progress in attributes (`homeassistant/components/update/const.py`). Valve states are `open`, `opening`, `closed`, and `closing`. Speech-to-text uses `error` as the result of one recognition (`SpeechResultState` in `homeassistant/components/stt/const.py`).

## Opening and outdoor-temperature reports

The [binary-sensor contract](https://contributors.home-assistant.io/core/entities/binary-sensor/) and [supported Core implementation](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/binary_sensor/__init__.py) map `is_on` to `on` and `off`; door, window, garage-door and opening classes give those states their open/closed meaning. Homeostatic selects those classes explicitly, excludes covers and accepts only current non-restored `on` or `off` evidence.

An explicitly selected temperature-class sensor supplies its current numeric state and `unit_of_measurement`. The [supported weather implementation](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/weather/__init__.py) exports current `temperature` with `temperature_unit`, converted to the configured weather unit. Homeostatic reads that pair, never a forecast or apparent-temperature attribute. Missing, disabled, restored, unknown, unavailable, nonfinite or unsupported-unit readings interrupt pending qualification. These reports establish neither outdoor placement nor physical freshness. Rechecked October 25, 2026.

## Entities not provided

The separate Entities not provided policy assesses whether an enabled registered entity has a live provider. After HA has started and the owning config entry is loaded, a missing state or restored placeholder supplies warning evidence qualified by that policy's configured wait. A live non-restored state passes this condition even when its value is unavailable or unknown. Missing ownership or an unloaded owner is unknown and cannot establish recovery. Disabled entities, devices and integrations are ineligible. This condition does not change ordinary availability observations and makes no claim that an entity is obsolete. ADR 0104 owns the policy decision.

## UPS reports

UPS operating status is integration-specific. Homeostatic maps verified registry signals from NUT and APC UPS Daemon within one HA device. Core types a device identifier as a pair and stores longer tuples without rejecting them. Matching reads the integration and the id. A current usable report can establish its mapped condition. Missing, disabled, restored, unknown or unavailable signals cannot establish recovery. APC communication loss invalidates cached status and numeric readings. HA state timestamps do not establish a physical heartbeat.

The [UPS decision](adr/0051-monitor-ups-conditions-through-shared-mappings.md) records the checked entity identifiers and upstream status contracts.

## Limits that follow

- A watched entity that an integration marks unavailable by mode looks like lost contact. Exclude it from the relevant policies if that absence is expected.
- `available` doesn't prove the device works. A sensor can stay available with a frozen value (ADR 0005).
- A current sibling does not clear another entity’s availability issue. Broad entity availability covers enabled operational entities independently.

## Keeping this page right

Check Home Assistant behavior against its documentation and Core's source, not against one integration's implementation. Integrations disagree with each other, as the examples above show. When Home Assistant ships native device availability or changes these rules, review the supported signal and record a new decision before adding device monitoring.
