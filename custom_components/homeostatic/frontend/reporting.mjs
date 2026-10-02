import {escapeHtml as esc, sourceMap} from "./model.mjs?v=46";

export const REPORTING = [
  ["immediate","Immediate","Notify once, including overnight."],
  ["acknowledge","Immediate with acknowledgment","Notify including overnight. Repeat every 30 minutes until acknowledged or resolved."],
  ["morning","Morning summary","Include open problems in the next morning report."],
  ["evening","Evening summary","Include open problems in the next evening report."],
  ["weekly","Weekly summary","Include open problems on the chosen weekday."],
  ["dashboard","Dashboard only","Keep monitoring. Do not send notifications or reports."],
];
const label = id => REPORTING.find(row=>row[0]===id)?.[1] || id;
const weekdays=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const options = (value,inherit=null) => (inherit?`<option value=""${!value?' selected':''}>${esc(inherit)}</option>`:"")+REPORTING.map(([id,name])=>`<option value="${id}"${value===id?' selected':''}>${esc(name)}</option>`).join("");
const defaults = timezone => ({timezone,default:"weekly",repairs:"morning",people:{},profiles:{immediate:{people:[]},acknowledge:{people:[]},morning:{people:[],at:"08:00"},evening:{people:[],at:"18:00"},weekly:{people:[],at:"09:00",weekday:6}},assignments:{}});

export function reportingChoices(card) {
  if(card.settingsDraft.reporting)return card.settingsDraft.reporting;
  const choices=defaults(card._hass?.config?.time_zone||card.settingsDraft.policy.timezone);
  for(const [id,person] of Object.entries(card.settingsDraft.simple_notifications?.people||{}))choices.people[id]=[...(person.channels||[])];
  return choices;
}

export function prepareReporting(card) {
  if(card.settingsDraft.reporting)return;
  card.settingsDraft.reporting=reportingChoices(card);
  card.settingsDraft.simple_notifications=null;
  card.settingsDraft.consumer=null;
  card.settingsDraft.notifications=false;
}

export function reportingChanges(before,after,context=null) {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(!before&&after)return [["Reporting preferences","Existing notification policy","Fixed reporting preferences"],...reportingChanges(defaults(after.timezone),after,context)];
  if(!after)return [["Reporting preferences","Fixed reporting preferences","Existing notification policy"]];
  const changes=[];
  if(before.default!==after.default)changes.push(["Household default",label(before.default),label(after.default)]);
  if((before.repairs||"morning")!==(after.repairs||"morning"))changes.push(["Home Assistant Repairs",label(before.repairs||"morning"),label(after.repairs||"morning")]);
  if(before.timezone!==after.timezone)changes.push(["Reporting time zone",before.timezone,after.timezone]);
  for(const [id,profile] of Object.entries(after.profiles)) {
    const a=before.profiles[id];
    if(JSON.stringify(a)!==JSON.stringify(profile))changes.push([label(id),description(a,before,context?.configuration?.notification_people),description(profile,after,context?.configuration?.notification_people)]);
  }
  for(const id of new Set([...Object.keys(before.people),...Object.keys(after.people)]))
    if(JSON.stringify(before.people[id])!==JSON.stringify(after.people[id]))changes.push(["Destinations",before.people[id]?.join(", ")||"None",after.people[id]?.join(", ")||"None"]);
  for(const id of new Set([...Object.keys(before.assignments),...Object.keys(after.assignments)]))
    if(JSON.stringify(before.assignments[id])!==JSON.stringify(after.assignments[id]))changes.push([`Reporting · ${context?sourceMap(context.current.data).get(id)?.name||id:id}`,assignmentText(before.assignments[id]),assignmentText(after.assignments[id])]);
  return changes;
}
function assignmentText(a) {
  if(!a)return "Use household default";
  return [a.default?label(a.default):"Use household default",...Object.entries(a.checks||{}).map(([check,id])=>`${check==="condition"?"Situation":check==="battery"?"Battery condition":"Availability"}: ${label(id)}`)].join("; ");
}
function description(p,choices,people=[]) {
  const names=p.people.map(id=>people.find(person=>person.id===id)?.name||id).join(", ")||"No recipients";
  return [p.weekday!==undefined?weekdays[p.weekday]:null,p.at,names].filter(Boolean).join(" · ");
}
export function destinationChoices(routes,userId,selected) {
  const groups=new Map();
  for(const route of routes) {
    const key=route.phone_channel||route.channel;
    if(!groups.has(key))groups.set(key,[]);
    if(!groups.get(key).some(item=>item.channel===route.channel))groups.get(key).push(route);
  }
  return [...groups.values()].filter(group=>group.some(route=>selected.includes(route.channel))||
    group.some(route=>route.channel.startsWith("phone:")?route.user_id===userId:!route.phone_channel))
    .map(group=>{
      const phone=group.find(route=>route.channel.startsWith("phone:"));
      const chosen=group.find(route=>selected.includes(route.channel))||phone||group[0];
      return {...chosen,name:phone?.name||chosen.name,channels:group.map(route=>route.channel),
        selected:group.filter(route=>selected.includes(route.channel)).length};
    });
}

export function reportingSettings(card) {
  const choices=reportingChoices(card);
  const people=card.configuration.notification_people||[],routes=card.configuration.notification_destinations||[];
  const selected=Object.keys(choices.people),assigned=Object.keys(choices.assignments).length;
  const failures=card.current?.data?.inventory?.delivery_failures||[];
  const failureNote=failures.length?`<div role="status"><h3>Recent delivery request failures</h3><ul>${[...new Map(failures.map(f=>[f.channel,f.error]))].map(([channel,error])=>`<li>${esc(routes.find(r=>r.channel===channel)?.name||channel)}: ${esc(error)}</li>`).join("")}</ul></div>`:"";

  const peopleRows=selected.map(id=>{
    const person=people.find(item=>item.id===id);
    const available=destinationChoices(routes,person?.user_id,choices.people[id]);
    const missing=choices.people[id].filter(channel=>!available.some(route=>route.channels.includes(channel)));
    return `<section class="installation-group"><h4>${esc(person?.name||id)}</h4>${available.map(route=>`<div class="notification-route"><label class="installation-toggle"><input type="checkbox" data-reporting-channel="${esc(route.channel)}" data-reporting-person="${esc(id)}"${route.selected?' checked':''}${!route.available&&!route.selected?' disabled':''}> ${esc(route.name)}${route.selected>1?' — multiple saved routes; clear and reselect to use one':''}${route.available?'':' — unavailable'}</label>${route.available?`<button type="button" class="link" data-notification-test="${esc(route.channel)}">Send test</button>`:""}</div>`).join("")}${missing.map(channel=>`<label class="installation-toggle"><input type="checkbox" checked data-reporting-channel="${esc(channel)}" data-reporting-person="${esc(id)}"> ${esc(channel)} — unavailable; remove this destination</label>`).join("")}${!choices.people[id].length?'<p class="note">Choose a destination for this person.</p>':''}<button type="button" class="link" data-reporting-remove="${esc(id)}">Remove person</button></section>`;
  }).join("");
  const profiles=REPORTING.filter(([id])=>id!=="dashboard").map(([id,name,help])=>{
    const profile=choices.profiles[id];
    const count=Object.values(choices.assignments).filter(a=>a.default===id||Object.values(a.checks||{}).includes(id)).length;
    return `<details class="installation-group reporting-profile" data-profile-id="${id}"${card.reportingExpanded?.includes(id)?' open':''}><summary><strong>${esc(name)}</strong><span class="sub">${esc(description(profile,choices,people))}</span></summary><p>${esc(help)}</p>${profile.at?`<label class="installation-field"><span>Report time</span><input type="time" required data-reporting-time="${id}" value="${esc(profile.at)}"></label>`:""}${id==="weekly"?`<label class="installation-field"><span>Weekday</span><select data-reporting-weekday>${weekdays.map((name,n)=>`<option value="${n}"${profile.weekday===n?' selected':''}>${name}</option>`).join("")}</select></label>`:""}<fieldset><legend>Recipients</legend>${selected.length?selected.map(person=>`<label class="installation-toggle"><input type="checkbox" data-reporting-recipient="${esc(person)}" data-reporting-profile="${id}"${profile.people.includes(person)?' checked':''}> ${esc(people.find(p=>p.id===person)?.name||person)}</label>`).join(""):'<p>Add people below, then choose who receives this report.</p>'}</fieldset><p class="small">${count} explicit source assignments${choices.default===id?'; also the household default':''}. Changes apply to everyone using this profile.</p></details>`;
  }).join("");
  return `<p class="sub">Choose when a problem should reach someone. Immediate always includes overnight.</p><section class="installation-group"><h3>Reporting profiles</h3>${profiles}<p class="small">Summaries contain new and still-outstanding problems. No resolved entries or empty reports are sent.</p></section><section class="installation-group"><h3>People and destinations</h3>${failureNote}<p class="sub">Choose destinations once, then select these people in each reporting profile. A request does not prove receipt.</p>${peopleRows||'<p>No people configured.</p>'}<label class="installation-field"><span>Add person</span><select data-reporting-add><option value="">Choose a person</option>${people.filter(p=>!selected.includes(p.id)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label></section><section class="installation-group"><h3>Household default</h3><label class="installation-field"><span>Newly monitored sources</span><select data-reporting-default>${options(choices.default)}</select></label><p class="small">Individual preferences are set in Sources. ${assigned} ${assigned===1?"source has":"sources have"} explicit preferences.</p><label class="installation-field"><span>Home Assistant Repairs</span><select data-reporting-repairs>${options(choices.repairs||"morning")}</select></label><p class="small">Every Repair Home Assistant raises is an issue. If nobody receives the chosen report, Repairs show only in the panel.</p><label class="installation-field"><span>Time zone</span><input required data-reporting-zone value="${esc(choices.timezone)}"></label></section>`;
}
export function sourceReporting(card,node) {
  const source=node.source;
  if(source?.automation_url)return `<section class="source-section"><h3>Reporting</h3><p>${esc(label(source.alert_profile))} · Managed by its HA automation</p>${source.alert_reporting_status==="requests_disabled"?'<p class="note">Outgoing requests are disabled.</p>':source.alert_reporting_status==="missing_destinations"?'<p class="note">This profile has no configured destination. Set up people and destinations in Notifications.</p>':""}<a href="${esc(source.automation_url)}">Edit alert automation</a><p>Shared recipients and schedules are configured in Notifications.</p></section>`;
  if(!card.settingsDraft)return "";
  const choices=reportingChoices(card);
  const setup=!card.settingsDraft.reporting?'<p class="note">Choose a preference, then review and save to apply it. The current policy stays active until then.</p>':"";
  if(node.family){
    const devices=node.children.filter(child=>child.source?.kind==="device").map(child=>child.source.node_id);
    if(!devices.length)return "";
    return `<section class="source-section"><h3>Device reporting</h3>${setup}<p>Apply one default to these ${devices.length} devices. Condition exceptions stay in place.</p><label>Device default <select data-reporting-bulk="${esc(JSON.stringify(devices))}"><option value="">Choose a preference</option>${options(null)}</select></label><button type="button" class="link" data-page="notifications">Shared schedules and recipients</button>${reportingFooter(card)}</section>`;
  }
  if(!source||source.kind==="function")return "";
  const assignment=choices.assignments[source.node_id]||{},check=source.kind==="situation"?"condition":source.kind==="battery"?"battery":"availability";
  const checkName=check==="condition"?"Configured situation":check==="battery"?"Battery condition":"Availability";
  return `<section class="source-section"><h3>Reporting</h3>${setup}${card.settingsDraft.reporting&&!card.settingsDraft.notifications?'<p class="note">Requests are off. These preferences take effect when reporting is enabled.</p>':''}<p class="small">Monitoring determines what is checked. Reporting determines when someone hears about it.</p><label class="installation-field"><span>Source preference</span><select data-reporting-node="${esc(source.node_id)}" data-reporting-check="">${options(assignment.default,`Use household default — ${label(choices.default)}`)}</select></label><details><summary>Condition exceptions</summary><label class="installation-field"><span>${checkName}</span><select data-reporting-node="${esc(source.node_id)}" data-reporting-check="${check}">${options(assignment.checks?.[check],"Use source preference")}</select></label><p class="small">Only supported checks are listed. Battery condition reports the HA signal, not physical battery recovery.</p></details><button type="button" class="link" data-page="notifications">Change shared schedules and recipients</button>${reportingFooter(card)}</section>`;
}
function reportingFooter(card) {
  if(!card.settingsDraft.reporting)return '<p class="small">Shared schedules and recipients are configured in Notifications.</p>';
  const changes=reportingChanges(card.configuration.settings.reporting,card.settingsDraft.reporting,card),preview=card.settingsPreview;
  if(!changes.length)return "";
  return `<div class="installation-actions"><p>${changes.length} reporting changes awaiting review.</p>${preview?`<section class="settings-preview"><h4>Review reporting changes</h4><ul>${changes.map(([name,from,to])=>`<li>${esc(name)}: ${esc(from)} → ${esc(to)}</li>`).join("")}</ul><p>Applies to ${preview.reporting_assignments} explicit source preferences. ${preview.requests_now} requests would be produced now. Requests ${card.settingsDraft.notifications?'enabled':'remain off'}.</p></section>`:""}${card.settingsError?`<p role="alert">${esc(card.settingsError)}</p>`:""}<button type="button" class="button" data-action="${preview?'save-settings':'preview-settings'}"${card.settingsBusy?' disabled':''}>${preview?'Save reporting':'Review reporting changes'}</button></div>`;
}
export function editReporting(card,event) {
  const target=event.target.closest?.("[data-reporting-review],[data-reporting-remove]")||event.target;
  if(!card.settingsDraft||!Object.keys(target.dataset||{}).some(key=>key.startsWith("reporting")))return false;
  if(event.type==="click"&&!target.matches("[data-reporting-review],[data-reporting-remove]"))return false;
  if(card.settingsBusy||card.configBusy)return true;
  if(target.dataset.reportingBulk&&!target.value)return true;
  card.sourceSettingsReview=null;card.sourceSettingsNotice=null;card.sourceSettingsError=null;
  card.reportingExpanded=[...(target.getRootNode?.().querySelectorAll?.("details[data-profile-id][open]")||[])].map(item=>item.dataset.profileId);
  prepareReporting(card);
  const choices=card.settingsDraft.reporting;
  if(target.hasAttribute("data-reporting-review")){
    card.settingsPreview=null;card.settingsError=null;card.settingsNotice=null;
    card.previewSettings();return true;
  }else if(target.dataset.reportingRemove){const id=target.dataset.reportingRemove;delete choices.people[id];for(const p of Object.values(choices.profiles))p.people=p.people.filter(x=>x!==id);}
  else if(target.hasAttribute("data-reporting-add")){if(target.value)choices.people[target.value]=[];}
  else if(target.hasAttribute("data-reporting-default"))choices.default=target.value;
  else if(target.hasAttribute("data-reporting-repairs"))choices.repairs=target.value;
  else if(target.hasAttribute("data-reporting-zone"))choices.timezone=target.value;
  else if(target.dataset.reportingTime)choices.profiles[target.dataset.reportingTime].at=target.value;
  else if(target.hasAttribute("data-reporting-weekday"))choices.profiles.weekly.weekday=Number(target.value);
  else if(target.dataset.reportingChannel){
    const id=target.dataset.reportingPerson,channel=target.dataset.reportingChannel;
    const group=destinationChoices(card.configuration.notification_destinations||[],null,choices.people[id]).find(route=>route.channels.includes(channel));
    const remaining=choices.people[id].filter(c=>!(group?.channels||[channel]).includes(c));
    choices.people[id]=target.checked?[...remaining,channel]:remaining;
  }
  else if(target.dataset.reportingRecipient){const p=choices.profiles[target.dataset.reportingProfile],id=target.dataset.reportingRecipient;p.people=target.checked?[...new Set([...p.people,id])]:p.people.filter(x=>x!==id);}
  else if(target.dataset.reportingNode){
    const id=target.dataset.reportingNode,check=target.dataset.reportingCheck;
    const a=choices.assignments[id] ||= {checks:{}};
    if(check){a.checks ||= {};if(target.value)a.checks[check]=target.value;else delete a.checks[check];}
    else if(target.value)a.default=target.value;else delete a.default;
    if(!a.default&&!Object.keys(a.checks||{}).length)delete choices.assignments[id];
  }else if(target.dataset.reportingBulk){if(target.value)for(const id of JSON.parse(target.dataset.reportingBulk)){const a=choices.assignments[id] ||= {checks:{}};a.default=target.value;}}
  else return false;
  card.settingsPreview=null;card.settingsError=null;card.settingsNotice=null;card.render();return true;
}
export function reportingOverview(data) {
  const policy=data.policy, missing=data.coverage.notification_consumer_missing||policy.reporting_missing?.length||policy.unavailable_destinations?.length||data.inventory.delivery_failures?.length;
  const reports=[...(policy.reports||[])].sort((a,b)=>a.next_at.localeCompare(b.next_at));
  const next=reports.find(report=>report.episodes.length);
  let title="Reporting is off",text="Problems are monitored and appear here. No messages are sent.",action="Set up reporting";
  if(policy.notifications_enabled){
    title=missing?"Reporting needs attention":"Reporting is on";
    action=missing?"Review destinations":"Manage reporting";
    text=missing?"A destination is missing or a delivery request failed. Review reporting settings.":next?`${label(next.name)}: ${new Date(next.next_at).toLocaleString()}. ${next.episodes.length} open problems currently eligible; this may change before sending.`:"No problems awaiting a report. Immediate preferences remain active.";
  }
  return `<section class="panel body reporting-overview"><h2>${esc(title)}</h2><p>${esc(text)}</p><button type="button" class="link" data-page="notifications">${action}</button></section>`;
}


export function reportingStatus(data,episode) {
  if(!data.policy.notifications_enabled)return "Reporting off";
  const decision=data.policy.episodes?.find(item=>item.episode_id===episode.episode_id);
  if(!decision)return "";
  if(decision.acknowledgment)return "Acknowledged · problem remains open";
  if(decision.require_acknowledgment&&decision.sent_to?.length)return "Notification requested · awaiting acknowledgment";
  if(decision.loudness==="digest")return label(decision.digest);
  if(decision.sent_to?.length)return "Notification requested";
  return decision.loudness==="record"?"Dashboard only":"Awaiting notification";
}
