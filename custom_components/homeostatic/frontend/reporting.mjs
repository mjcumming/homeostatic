import {escapeHtml as esc} from "./model.mjs?v=99";

const labels = {immediate:"Immediately",acknowledge:"Until acknowledged",morning:"Morning",evening:"Evening",weekly:"Weekly",dashboard:"Dashboard only"};
const label = id => Object.hasOwn(labels,id) ? labels[id] : "Configured notification";

/** Name the alert's named notification without duplicating its automation's editor. */
export function sourceReporting(card,node) {
  const source=node.source;
  if(!source?.automation_url)return "";
  const named=source.alert_profile!=="dashboard"&&card.configuration?.settings?.notification_definitions?.profiles?.[source.alert_profile]?.name;
  const name=named||label(source.alert_profile);
  const note=source.alert_reporting_status==="requests_disabled"?"Notifications are off.":source.alert_reporting_status==="missing_destinations"?`${name} has no delivery method. Add one in Notifications.`:"";
  return `<section class="source-section"><h3>Reporting</h3><p>${esc(name)} · Managed by its automation</p>${note?`<p class="note">${esc(note)}</p>`:""}</section>`;
}

export function reportingStatus(data,episode) {
  if(!data.policy.notifications_enabled)return "Notifications off";
  const decision=data.policy.episodes?.find(item=>item.episode_id===episode.episode_id);
  if(!decision)return "";
  if(decision.acknowledgment)return "Acknowledged · problem remains open";
  if(decision.require_acknowledgment&&decision.sent_to?.length)return "Notification requested · awaiting acknowledgment";
  if(decision.loudness==="digest")return Object.hasOwn(labels,decision.digest) ? labels[decision.digest] : "Scheduled summary";
  if(decision.sent_to?.length)return "Notification requested";
  return decision.loudness==="record"?"Dashboard only":"Awaiting notification";
}
