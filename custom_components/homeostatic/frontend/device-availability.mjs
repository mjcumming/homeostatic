import {escapeHtml as esc} from "./model.mjs?v=94";

const labels = {available:"Available",partially_available:"Partially available",unavailable:"Unavailable",unknown:"Unknown",disabled:"Disabled"};

/** Name the reported assessment without changing its evidence. */
export function deviceAvailabilityLabel(value) {
  return labels[value?.status]||"Unknown";
}

/** Count the complete inspected membership without treating absent evidence as available. */
export function deviceAvailabilitySummary(evidence, {monitored=true}={}) {
  const members=evidence?.members||[],total=evidence?.total??members.length;
  const completeCounts=Number.isInteger(evidence?.unavailable_count)&&Number.isInteger(evidence?.unknown_count);
  const unavailable=evidence?.unavailable_count??members.filter(member=>member.state==="unavailable"&&!member.restored).length;
  const unknown=evidence?.unknown_count??members.filter(member=>member.state==="missing"||member.restored).length;
  const available=completeCounts||members.length===total?Math.max(0,total-unavailable-unknown):null;
  const label=available===null?"Availability readings incomplete":`${available} of ${total} ${monitored?"monitored ":""}${total===1?"entity":"entities"} available`;
  return {total,available,unavailable,unknown,label};
}

/** Explain device access independently of monitored entity findings. */
export function deviceAvailability(value, compact=false) {
  if(!value)return "";
  const label=deviceAvailabilityLabel(value);
  if(compact)return `<p class="device-availability small" aria-label="Device availability">Device availability: ${esc(label)}</p>`;
  const summary=value.status==="disabled"?"This device is disabled in Home Assistant.":
    value.basis==="integration_reports"?value.status==="partially_available"?"Some integrations report this device available; others report it unavailable.":`Reporting integrations agree that this device is ${value.status==="available"?"available":"unavailable"}.`:
    value.status==="available"?"At least one enabled operational entity is available through Home Assistant. Other entities may still have issues.":
    value.status==="unavailable"?"Every enabled operational entity is unavailable through Home Assistant.":
    value.reason==="device_missing"?"This device is no longer in the Home Assistant registry.":
    value.reason==="no_entities"?"This device has no enabled operational entities to establish availability.":
    "Current entity states do not yet establish whether this device is available.";
  return `<section class="source-condition device-availability" aria-label="Device availability"><h3>Device availability: ${esc(label)}</h3><p>${esc(summary)}</p><p class="small">${value.basis==="entities"?"Based on enabled operational entities, independently of monitoring choices. Diagnostic and configuration entities are excluded. ":""}Availability does not establish overall device health.</p></section>`;
}

/** Refresh a selected device when HA access changes, without reacting to value churn. */
export function deviceAvailabilityStamp(value, states) {
  return JSON.stringify((value?.entity_ids||[]).map(id=>{
    const state=states?.[id];
    return [id,!state?"missing":state.attributes?.restored?"restored":state.state==="unavailable"?"unavailable":"available"];
  }));
}

/** Shorten a repeated device prefix only when the entity keeps a useful name. */
export function deviceEntityName(name, deviceName) {
  const remaining=name.startsWith(`${deviceName} `)?name.slice(deviceName.length+1).trim():"";
  return remaining||name;
}
