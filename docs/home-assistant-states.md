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

"Partially available" comes only from integration reports that disagree, never from entity states. Homeostatic follows this rule for the device status in Sources (ADR 0035, with ADR 0038 adding connectivity sensors) and, over the owner's selected entities, for device issues (ADR 0045).

## How integrations use it

The documented meaning of `unavailable` is "can't reach it". In practice it also means "can't use it right now":

- **Mode-dependent controls marked unavailable.** Some integrations mark a control `unavailable` when the device's current mode or program doesn't support it. The frontend then greys it out, which is the only way the standard toggle can be disabled. To anything reading states, that control looks the same as lost contact.
- **Mode-dependent controls kept available.** Other integrations keep the state and refuse an invalid change with `ServiceValidationError`. The SmartThings Samsung dishwasher wash-option switches (`homeassistant/components/smartthings/switch.py`, `_validate_before_execute`) refuse when remote control is off, when the dishwasher isn't stopped, or when the selected cycle doesn't support the option. Their availability follows only the device's online status. The NeoPool filtration switch (`homeassistant/components/neopool/switch.py`) reports on or off and refuses a change outside manual mode or during boost.

Both patterns are in Core, so Homeostatic can't assume either. An unavailable entity on a device that otherwise has current states is usually a feature switched off by mode, not lost contact.

## How Homeostatic reads each signal

**Entities.**

| Home Assistant reports | Homeostatic reads it as | Result |
| --- | --- | --- |
| A value, including `off` and `idle` | Available | No issue |
| `unknown` | Available with no value | No issue |
| `unavailable` | Home Assistant can't read or control it | Warning issue |
| `unavailable` with `restored: true` | Missing information while the integration loads | An issue only if it lasts past **Wait for unknown evidence** |
| No state at all | Missing information | Same as restored |

**Devices.** A watched device's check uses only the entities the owner selected. It passes when any selected entity has a current state, warns when every selected entity is unavailable or a selected connectivity sensor reports `off`, and is unknown when no selected entity has a current state and they aren't all unavailable. Excluded entities don't count. ADR 0045 records the decision.

**Integrations.** A loaded config entry passes. Setup retry is a warning that becomes a failure after **Wait before reporting setup retries**. Setup errors, migration errors, failed unloads and a pending sign-in are failures. Disabled, not-yet-loaded and loading entries are missing information.

**Severity.** `unavailable` is a warning because it says Home Assistant can't reach something, not why: the device, its battery, the network, a hub, a cloud service or a reload. Integration setup failures are failures because Home Assistant reports them as errors.

## Limits that follow

- A watched entity that an integration marks unavailable by mode looks like lost contact. Exclude it, or don't watch it on its own.
- `available` doesn't prove the device works. A sensor can stay available with a frozen value (ADR 0005).
- One failed entity on a device whose other selected entities have states doesn't open a device issue. Watch that entity on its own if it matters.

## Keeping this page right

Check Home Assistant behavior against its documentation and Core's source, not against one integration's implementation. Integrations disagree with each other, as the examples above show. When Home Assistant ships native device availability or changes these rules, update this page first, then the decision records that cite it.
