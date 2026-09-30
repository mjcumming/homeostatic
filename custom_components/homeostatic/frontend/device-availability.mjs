import {escapeHtml as esc} from "./model.mjs?v=46";

const labels = {available:"Available",partially_available:"Partially available",unavailable:"Unavailable",unknown:"Unknown",disabled:"Disabled"};

/** Explain device access independently of monitored entity findings. */
export function deviceAvailability(value, compact=false) {
  if(!value)return "";
  const label=labels[value.status]||"Unknown";
  if(compact)return `<p class="device-availability small" aria-label="Device availability">Device availability: ${esc(label)}</p>`;
  const summary=value.status==="disabled"?"This device is disabled in Home Assistant.":
    value.basis==="integration_reports"?value.status==="partially_available"?"Some integrations report this device available; others report it unavailable.":`Reporting integrations agree that this device is ${value.status==="available"?"available":"unavailable"}.`:
    value.status==="available"?"At least one enabled entity is available through Home Assistant. Other entities may still have issues.":
    value.status==="unavailable"?"Every enabled entity is unavailable through Home Assistant.":
    value.reason==="device_missing"?"This device is no longer in the Home Assistant registry.":
    value.reason==="no_entities"?"This device has no enabled entities to establish availability.":
    "Current entity states do not yet establish whether this device is available.";
  return `<section class="source-condition device-availability" aria-label="Device availability"><h3>Device availability: ${esc(label)}</h3><p>${esc(summary)}</p><p class="small">${value.basis==="entities"?"Based on all enabled entities, independently of monitoring choices. ":""}Availability does not establish overall device health.</p></section>`;
}

/** Refresh a selected device when HA access changes, without reacting to value churn. */
export function deviceAvailabilityStamp(value, states) {
  return JSON.stringify((value?.entity_ids||[]).map(id=>{
    const state=states?.[id];
    return [id,!state?"missing":state.attributes?.restored?"restored":state.state==="unavailable"?"unavailable":"available"];
  }));
}
