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

Since Core doesn't model device availability, the only written design is [architecture discussion 1400](https://github.com/home-assistant/architecture/discussions/1400), "Device availability reporting", opened in May 2026 and still open. It lets integrations report a device's availability directly, and when none does, derives it from the device's enabled entities:

- **Disabled** when the device is disabled.
- **Unknown** when it has no enabled entities.
- **Available** when any enabled entity has a state other than `unavailable`.
- **Unavailable** when every enabled entity is `unavailable`.

"Partially available" comes only from integration reports that disagree, never from entity states. Homeostatic follows this rule for the device status in Sources (ADR 0035, with ADR 0038 adding connectivity sensors) and, over each device's selected entities, for device issues (ADR 0045).

## How integrations use it

The documented meaning of `unavailable` is "can't reach it". In practice it also means "can't use it right now":

- **Mode-dependent controls marked unavailable.** Some integrations mark a control `unavailable` when the device's current mode or program doesn't support it. The frontend then greys it out, which is the only way the standard toggle can be disabled. To anything reading states, that control looks the same as lost contact.
- **Mode-dependent controls kept available.** Other integrations keep the state and refuse an invalid change with `ServiceValidationError`. The SmartThings Samsung dishwasher wash-option switches (`homeassistant/components/smartthings/switch.py`, `_validate_before_execute`) refuse when remote control is off, when the dishwasher isn't stopped, or when the selected cycle doesn't support the option. Their availability follows only the device's online status. The NeoPool filtration switch (`homeassistant/components/neopool/switch.py`) reports on or off and refuses a change outside manual mode or during boost.

Both patterns are in Core, so Homeostatic can't assume either. An unavailable entity on a device that otherwise has current states can be a feature switched off by mode rather than lost contact. Discussion 1400 itself treats entity availability as imperfect evidence of device availability.

## How Homeostatic reads each signal

**Entities.**

| Home Assistant reports | Homeostatic reads it as | Result |
| --- | --- | --- |
| A value, including `off` and `idle` | Available | No issue |
| `unknown` | Available with no value | No issue |
| `unavailable` | Home Assistant can't read or control it | Warning issue |
| `unavailable` with `restored: true` | Missing information while the integration loads | An issue only if it lasts past **Wait for unknown evidence** |
| No state at all | Missing information | Same as restored |

**Devices.** A watched device's check uses its selected entities: enabled ordinary entities, including buttons and hidden ones, or diagnostic entities when the device has no ordinary ones, less any the owner excluded. Configuration entities are never selected. The check warns when a selected connectivity sensor reports `off` or every selected entity is unavailable, passes when any selected entity has a current state, and is unknown when no selected entity has a current state and they aren't all unavailable. The device status in Sources counts every enabled entity, so the two can differ without any exclusion. The status reads Available while the issue is open when only a configuration entity or an unselected diagnostic entity still reports, and Unavailable with no issue when an unselected connectivity sensor reports `off`. ADR 0045 records the decision.

**Integrations.** A loaded config entry passes. Setup retry is a warning that becomes a failure after **Wait before reporting setup retries**. Setup errors, migration errors, failed unloads and a pending sign-in are failures. Disabled, not-yet-loaded and loading entries are missing information.

**Severity.** `unavailable` is a warning because it says Home Assistant can't reach something, not why: the device, its battery, the network, a hub, a cloud service or a reload. Integration setup failures are failures because Home Assistant reports them as errors.

**Vacuums.** The vacuum entity's state is an activity. Core's `VacuumActivity` lists six: `cleaning`, `docked`, `idle`, `paused`, `returning`, and `error` (`homeassistant/components/vacuum/const.py`). The entity state is that activity (`homeassistant/components/vacuum/__init__.py`). The state translation describes `error` as the vacuum encountering an error. Homeostatic fails on `error` and passes on the other five. `unavailable`, `unknown`, a missing state, a restored state, and any other value are unknown, so they leave an open vacuum issue open. An integration that maps a vendor status such as offline onto `error` produces the issue while the entity state is `error`. A fault that stays on some other entity never becomes this check.

**Lawn mowers.** `LawnMowerActivity` is the other core activity enum with an `error` value (`homeassistant/components/lawn_mower/const.py`). On the 2026.9.3 tag the activities are `mowing`, `docked`, `paused`, `returning`, and `error`. The dev branch, for Core 2026.10, adds `idle` for a mower that is stopped and neither docked nor paused. Developer docs describe `error` as the mower encountering an error while active and needing assistance. Homeostatic does not read this activity yet. The [roadmap](roadmap.md) tracks that check. Rechecked October 3, 2026.

**Problem and tamper sensors.** A binary sensor with device class `problem` or `tamper` is `on` or `off` (`homeassistant/components/binary_sensor/const.py`). Core describes `problem` as problem detected or OK, and `tamper` as tampering detected or clear. Homeostatic does not read these yet. The [roadmap](roadmap.md) tracks an issue while the sensor is on.

**Alarm panels.** `AlarmControlPanelState` is `disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `pending`, `arming`, `disarming`, and `triggered` (`homeassistant/components/alarm_control_panel/const.py`). `triggered` means the alarm is going off. The [roadmap](roadmap.md) tracks an issue while the panel is `triggered`. The arming states are ordinary operation.

**Locks.** `LockState` is `jammed`, `locked`, `unlocked`, `locking`, `unlocking`, `open`, and `opening` (`homeassistant/components/lock/const.py`). `jammed` means the lock tried to move and got stuck before it finished. The [roadmap](roadmap.md) tracks an issue while the lock is `jammed`.

**Other entity states.** An update entity is `on` or `off`, with install progress in attributes (`homeassistant/components/update/const.py`). Valve and cover states are `open`, `opening`, `closed`, and `closing`. Speech-to-text uses `error` as the result of one recognition (`SpeechResultState` in `homeassistant/components/stt/const.py`).

## Limits that follow

- A watched entity that an integration marks unavailable by mode looks like lost contact. Exclude it, or don't watch it on its own.
- `available` doesn't prove the device works. A sensor can stay available with a frozen value (ADR 0005).
- One failed entity on a device whose other selected entities have states doesn't open a device issue. Watch that entity on its own if it matters.

## Keeping this page right

Check Home Assistant behavior against its documentation and Core's source, not against one integration's implementation. Integrations disagree with each other, as the examples above show. When Home Assistant ships native device availability or changes these rules, update this page first, then the decision records that cite it.
