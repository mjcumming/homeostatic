import {escapeHtml as esc} from "./model.mjs?v=84";

const label = id => ({immediate:"Immediately",acknowledge:"Until acknowledged",morning:"Morning",evening:"Evening",weekly:"Weekly",dashboard:"Dashboard only"}[id] || id);

/** Explain reporting owned by an alert automation without duplicating its editor. */
export function sourceReporting(card,node) {
  const source=node.source;
  if(source?.automation_url)return `<section class="source-section"><h3>Reporting</h3><p>${esc(label(source.alert_profile))} · Managed by its HA automation</p>${source.alert_reporting_status==="requests_disabled"?'<p class="note">Outgoing requests are disabled.</p>':source.alert_reporting_status==="missing_destinations"?'<p class="note">This profile has no configured destination. Set up people and destinations in Notifications.</p>':""}<a href="${esc(source.automation_url)}">Edit automation</a><p>Reusable delivery methods are configured in Notifications.</p></section>`;
  return "";
}

export function reportingStatus(data,episode) {
  if(!data.policy.notifications_enabled)return "Notifications off";
  const decision=data.policy.episodes?.find(item=>item.episode_id===episode.episode_id);
  if(!decision)return "";
  if(decision.acknowledgment)return "Acknowledged · problem remains open";
  if(decision.require_acknowledgment&&decision.sent_to?.length)return "Notification requested · awaiting acknowledgment";
  if(decision.loudness==="digest")return label(decision.digest);
  if(decision.sent_to?.length)return "Notification requested";
  return decision.loudness==="record"?"Dashboard only":"Awaiting notification";
}
