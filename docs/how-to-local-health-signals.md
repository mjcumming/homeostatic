# Alert on a device's own diagnostic sensor

Some integrations report a fault through the value of a diagnostic entity while the device itself stays available. The ISY integration's **Device Communication Errors** sensor for an Insteon device is one. It reads `1` while the ISY reports a communication error with the device and `0` when it doesn't, and Home Assistant shows the light as available the whole time. Homeostatic's availability check sees an available device, so it never raises this on its own.

You can turn a value like that into an alert in two parts. A template binary sensor turns the raw value into on for the fault, off once it has cleared, and unavailable for anything else. Then an alert made from the Homeostatic alert blueprint watches that binary sensor.

## Before you start

You need to know two values: the one that means the fault is happening now, and the one that means it has cleared. An error count, a log entry, or a value that stays set after the fault ends can't tell you the fault is over, so it can't drive an alert this way.

The alert stays separate from the device's health. It doesn't mark the light as failed. [How it works](how-it-works.md) explains why alerts and equipment are kept apart.

You also need the Homeostatic alert blueprint imported, and Notifications set up unless the alert uses Dashboard only. The alert guide's [Before you start](automation-situations.md#before-you-start) covers both.

## Example: an ISY communication error

Despite the plural name, the ISY's `ERR` value behind this sensor is a current status rather than a count. The [ISY developer's explanation](https://forum.universal-devices.com/topic/21043-control-err-in-event-stream/) describes both values. Home Assistant [marks the entity as diagnostic and disables it by default](https://github.com/home-assistant/core/blob/2026.9.3/homeassistant/components/isy994/sensor.py).

1. Find the source entity. In **Settings → Devices & services → Entities**, search for "communication errors" and open the one for your device. If it's disabled, open its settings, turn on **Enabled** and wait for it to get a state. A hidden entity works, as long as it isn't disabled. Note its entity ID, and check in **Developer tools → States** that it reads `0` or `1`.

2. Add the template binary sensor. Copy [diagnostic_state.yaml](../blueprints/template/homeostatic/diagnostic_state.yaml) to `<config>/blueprints/template/homeostatic/diagnostic_state.yaml`. Then add this to `configuration.yaml`, using your entity ID:

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

   If `configuration.yaml` already has a `template:` key, add the entry to that list. Quote the two values so they're compared as text, and give each device its own `unique_id`. Home Assistant's [template documentation](https://www.home-assistant.io/integrations/template/#using-blueprints) explains template blueprints.

   The result is a binary sensor with the Problem device class:

   | Source value | Binary sensor |
   | --- | --- |
   | The fault value (`1`) | On (Problem) |
   | The clear value (`0`) | Off (OK) |
   | Anything else: missing, `unknown`, `unavailable`, restored at startup, or an unexpected value | Unavailable |

   Losing the source makes the binary sensor unavailable, so it can never look like the fault clearing.

3. Reload template entities under **Developer tools → YAML**, or restart Home Assistant. Find the new binary sensor in **Developer tools → States**. Home Assistant usually names it `binary_sensor.north_bedroom_ceiling_light_communication_error`, but use the ID it actually shows. To test it, set the source entity's state to `1`, then `0`, then `unavailable` in **Developer tools → States** and check that the binary sensor shows on, off and unavailable. The integration overwrites your test value on its next update.

4. Create the alert. In **Settings → Automations & scenes → Blueprints**, select **Homeostatic alert** and fill it in:

   | Field | Value |
   | --- | --- |
   | Alert name | North Bedroom Ceiling Light communication error |
   | Notification message | The ISY reports a communication error with the north bedroom ceiling light. |
   | Reporting preference | Morning summary |
   | Required evidence | The binary sensor from step 3 |
   | Active when | State: that binary sensor is Problem |

   Save the automation and leave it on. Homeostatic opens an issue while the binary sensor is on and closes it when the sensor turns off. While the sensor is unavailable the alert is unknown, which keeps an open issue open. Only the ISY reporting `0` closes it. Acknowledge in Homeostatic doesn't.

[Alerts from automations](automation-situations.md) explains the blueprint's fields, evidence expiry and timing.

## Without the template blueprint

For a single device, a Template helper does the same job without editing `configuration.yaml`. Go to **Settings → Devices & services → Helpers → Create helper → Template → Template a binary sensor** and set:

- State template: `{{ is_state('sensor.YOUR_ENTITY_ID', '1') }}`
- Availability template: `{{ states('sensor.YOUR_ENTITY_ID') in ['0', '1'] and not state_attr('sensor.YOUR_ENTITY_ID', 'restored') }}`
- Device class: Problem

Replace the entity ID and the two values with ones you've checked. Then use the helper's entity ID for **Required evidence** and **Active when** in step 4. Home Assistant documents [template helpers](https://www.home-assistant.io/integrations/template/#creating-a-template-helper-from-the-user-interface).

## Use another diagnostic entity

The same steps work for other integrations once you've checked a few things:

- If the integration already provides a binary sensor that's on for the fault, off when it clears, and unavailable when it can't tell, skip the template. Use that binary sensor as the evidence, with a State condition for on.
- Find out what each value means from the integration's documentation, or by watching the device fail and recover. An entity called "error" doesn't tell you which values mean what.
- Make sure the clear value is something the device reports when the fault is over, and not just the absence of news. If you can't confirm a clear value, don't map anything to off.
- Every other value of the source, including missing, `unknown`, `unavailable` and restored, has to come out as unavailable. Test that losing the source can't clear an open alert.
- Check the binary sensor again after a Home Assistant restart, and after a real fault and recovery. A template can only pass on what its source reports. It can't tell you whether the device has physically recovered.
