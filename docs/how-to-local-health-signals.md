# How to alert on a device diagnostic that Homeostatic does not interpret

Some integrations expose a fault as the **value** of a diagnostic entity while leaving the device and entity available. Homeostatic's current equipment catalog checks availability, so it does not interpret that value. You can translate a documented, current fault state into a Home Assistant (HA) binary sensor and bind it to a Homeostatic situation alert.

Use this recipe only when you know both the fault value and the value that proves it cleared. A historical error count, a log entry, or a value with no defined recovery cannot use the `off` mapping below. The resulting alert is a situation; it does not change the equipment node's status or a function's readiness.

## Example: ISY device communication error

The ISY integration exposes **Device Communication Errors** for an Insteon load device. Despite the plural name, the underlying `ERR` value is a status: `1` means the ISY reports a communication error for that node, and `0` means no error. The [ISY developer's explanation](https://forum.universal-devices.com/topic/21043-control-err-in-event-stream/) describes both values. Home Assistant [classifies this as a diagnostic entity and disables it by default](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/isy994/sensor.py), so enable it in HA if necessary. An entity marked **Hidden** is still usable if it is enabled and has a state.

1. Find the exact entity ID and its raw `0` or `1` state in **Developer tools → States**. Replace the example source ID below with yours. Confirm that this entity belongs to the affected device.
2. Copy [diagnostic_state.yaml](../blueprints/template/homeostatic/diagnostic_state.yaml) to `<HA config>/blueprints/template/homeostatic/diagnostic_state.yaml`. Add this entry under the `template:` key in HA's `configuration.yaml` (or append it to an existing `template:` list):

   ```yaml
   template:
     - use_blueprint:
         path: homeostatic/diagnostic_state.yaml
         input:
           source_entity: sensor.north_bedroom_ceiling_light_device_communication_errors
           fault_value: "1"
           clear_value: "0"
       name: North Bedroom Ceiling Light Communication Error
       unique_id: north_bedroom_ceiling_light_communication_error
   ```

   Quote the values so HA passes them as strings. Use a different `unique_id` for every device. The blueprint accepts only the two distinct documented values from a non-restored source. A missing, restored, `unknown`, `unavailable`, or unexpected source value makes the new binary sensor unavailable instead of falsely clearing the fault. HA [documents template blueprints](https://www.home-assistant.io/integrations/template/#using-blueprints) under `blueprints/template/`.
3. Reload template entities or restart HA, then find the new binary sensor in **Developer tools → States**. HA normally creates `binary_sensor.north_bedroom_ceiling_light_communication_error` from the name, but use the actual entity ID shown there if it differs. Check that source `1` yields `on`, source `0` yields `off`, and source loss yields `unavailable`. Confirm recovery from the ISY's own state; an acknowledgement in Homeostatic is not recovery.
4. In Homeostatic's **Situation alerts (YAML list)**, add:

   ```yaml
   - id: north_bedroom_light_communication
     name: North Bedroom Ceiling Light communication error
     importance: normal
     entity: binary_sensor.north_bedroom_ceiling_light_communication_error
   ```

   Use the actual binary sensor ID from step 3 and keep any existing situation rows in the list. Homeostatic opens one episode while the binary sensor is `on`, clears it when it is `off`, and treats `unavailable` as unknown evidence. Review the alert and notification policy before enabling delivery. The ordinary availability check for the light or diagnostic entity may still pass while this situation is active; it answers a different question.

For one device, you can also create the same state-based binary sensor directly as a [Template helper](https://www.home-assistant.io/integrations/template/#creating-a-template-helper-from-the-user-interface). Set its state template to `{{ is_state('sensor.YOUR_ENTITY_ID', '1') }}` and its availability template to `{{ states('sensor.YOUR_ENTITY_ID') in ['0', '1'] and not state_attr('sensor.YOUR_ENTITY_ID', 'restored') }}`. Replace the source ID and values with ones you have verified; then bind the helper's actual entity ID in step 4.

## Adapt the recipe to another entity

- If the integration already provides a binary sensor with documented `on` = fault, `off` = clear, and suitable unavailable behavior, bind that entity directly as a situation. No template is needed.
- Identify the specific source entity and verify what each value means in that integration's documentation or observed device behavior. A diagnostic label alone is not a rule.
- Define an active value and an independently reported clear value. Check whether the value is a current condition, a counter, or a latched history. If clearing is not proven, do not map a guess to `off`.
- Make missing, restored, unknown, unavailable, and unexpected source values unavailable in the derived entity. Test that losing the source cannot clear an open alert.
- Check the derived entity after HA restart and after a real source transition. A local template can only report the evidence its source supplies; it cannot prove that a physical device has recovered.

See [Bind a situation](guide.md#bind-a-situation) for the Homeostatic binding contract and [HA's template documentation](https://www.home-assistant.io/integrations/template/) for template setup and reload instructions.
