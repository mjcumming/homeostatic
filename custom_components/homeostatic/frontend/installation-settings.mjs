import {escapeHtml as esc} from "./model.mjs?v=27";

export const TIMINGS = [
  ["Recovery", "settle", "Wait for related failures", "Allow dependencies that are still uncertain to settle before opening a separate problem."],
  ["Detection", "unknown_hold", "Wait for unknown entities", "Allow unknown or missing entity states this long before reporting them."],
  ["Detection", "retry_hold", "Allow connection retries", "Give an integration time to reconnect before reporting its retry state."],
  ["Recovery", "clear_hold", "Confirm recovery", "Require passing availability evidence for this long before clearing its check."],
  ["Recovery", "rejoin_grace", "Allow reconnecting devices", "Give a dependent source time to recover when its dependency returns."],
  ["Startup", "startup_grace", "Wait after startup", "Allow Home Assistant to start before evaluating startup health."],
  ["Startup", "startup_quiet_max", "Maximum startup wait", "Stop extending startup quiet time after this limit."],
  ["Grouping", "coalesce_count", "Group related problems", "Minimum number of related problems to combine."],
  ["Grouping", "coalesce_window", "Grouping window", "Look for related problems opened within this time."],
  ["Notifications", "batch", "Notification delay", "Collect requests briefly before handing them to a destination."],
];

export function durationSeconds(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const units = {d:86400,h:3600,m:60,s:1};
  const parts = [...String(value).matchAll(/(\d+)([dhms])/g)];
  return parts.map(part=>part[0]).join("")===value ? parts.reduce((sum,part)=>sum+Number(part[1])*units[part[2]],0) : null;
}

const timingField=(path,label,seconds,help="",count=false)=>{
  const scale=count||path.endsWith(".batch")||seconds%60!==0?1:60;
  const unit=count?"failures":scale===60?"min":"sec";
  return `<div class="timing-row">${field(path,label,seconds/scale,"number",help,`min="${count?2:0}" step="1" required data-setting-scale="${scale}" aria-label="${esc(label)} ${unit}"`)}<span class="timing-unit">${unit}</span></div>`;
};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const timeLabel = value => value ? `${value} seconds` : "No wait";
const ruleLabel = (rule,index) => {
  const match=Object.entries(rule.match||{}).map(([name,value])=>`${name.replaceAll("_"," ")}: ${Array.isArray(value)?value.join(", "):typeof value==="object"?Object.entries(value).map(([k,v])=>`${k} ${v}`).join(", "):value}`);
  return match.length?match.join(" · "):`All other matching problems (rule ${index+1})`;
};
const field = (path,label,value,type="text",help="",attributes="") => `<label class="installation-field"><span><strong>${esc(label)}</strong>${help?`<small>${esc(help)}</small>`:""}</span><input type="${type}" data-setting-path="${esc(path)}" value="${esc(value??"")}" ${attributes}></label>`;

export function settingsChanges(before,after) {
  const changes=[];
  for(const [,key,label] of TIMINGS)if(before.timings[key]!==after.timings[key])changes.push([label,key==="coalesce_count"?before.timings[key]:timeLabel(before.timings[key]),key==="coalesce_count"?after.timings[key]:timeLabel(after.timings[key])]);
  if(before.notifications!==after.notifications)changes.push(["Notification requests",before.notifications?"On":"Off",after.notifications?"On":"Off"]);
  if(before.consumer!==after.consumer)changes.push(["Notification automation",before.consumer||"None",after.consumer||"None"]);
  if(before.policy.timezone!==after.policy.timezone)changes.push(["Time zone",before.policy.timezone,after.policy.timezone]);
  if(!same(before.simple_notifications,after.simple_notifications))changes.push(["People and destinations","Previous choices","Updated choices"]);
  for(const [id,recipient] of Object.entries(after.policy.recipients))if(!same(before.policy.recipients[id]?.quiet_hours,recipient.quiet_hours)){
    const label=q=>q?`${q.start} – ${q.end}`:"Off";
    changes.push([`Quiet hours · ${id}`,label(before.policy.recipients[id]?.quiet_hours),label(recipient.quiet_hours)]);
  }
  after.policy.rules.forEach((rule,index)=>{for(const key of ["remind_every","escalate_after"])if(!same(before.policy.rules[index]?.[key],rule[key]))changes.push([`${key==="remind_every"?"Reminder":"Escalation"} · ${ruleLabel(rule,index)}`,before.policy.rules[index]?.[key]||"Off",rule[key]||"Off"]);});
  return changes;
}

function peopleSettings(card) {
  const choices=card.settingsDraft.simple_notifications;
  if(!choices)return `<section class="installation-group"><h3>Custom notification policy</h3><p>This policy was edited outside this page. Review it in Home Assistant, or reset it to configure people here.</p><button type="button" class="button" data-notification-reset>Reset to person settings</button></section>`;
  const people=card.configuration.notification_people||[];
  const routes=card.configuration.notification_destinations||[];
  const failures=card.current?.data?.inventory?.delivery_failures||[];
  const selected=choices.people||{};
  const available=people.filter(person=>!selected[person.id]);
  const add=available.length?`<label class="installation-field"><span><strong>Add person</strong><small>People linked to a Home Assistant user.</small></span><select data-notification-add><option value="">Choose a person</option>${available.map(person=>`<option value="${esc(person.id)}">${esc(person.name)}</option>`).join("")}</select></label>`:'<p class="sub">All linked people are listed.</p>';
  const cards=Object.entries(selected).map(([id,choice])=>{
    const person=people.find(item=>item.id===id);
    const name=person?.name||id,admin=person?.administrator;
    const phones=routes.filter(route=>route.channel.startsWith("phone:")&&route.user_id===person?.user_id);
    const other=routes.filter(route=>route.channel.startsWith("notify:"));
    const destinations=(items)=>items.map(route=>`<div class="notification-route"><label class="installation-toggle"><input type="checkbox" data-notification-channel="${esc(route.channel)}" data-notification-person="${esc(id)}"${choice.channels?.includes(route.channel)?' checked':''}${!route.available?' disabled':''}> ${esc(route.name)}${route.available?'':' · unavailable'}</label>${route.available?`<button type="button" class="link" data-notification-test="${esc(route.channel)}">Send test</button>`:''}</div>`).join("");
    const levels=admin?["Everything","Important","Urgent only","Off"]:["All","Urgent only","Off"];
    const quiet=choice.quiet_hours;
    return `<section class="installation-group notification-person"><h4>${esc(name)} <small>${admin?'Administrator':'Household member'}</small></h4><label class="installation-field"><span><strong>${admin?'Tell me about':'Home alerts'}</strong><small>${admin?'Faults and home alerts':'Situations the household can act on'}</small></span><select data-notification-level="${esc(id)}">${levels.map(level=>`<option value="${esc(level)}"${choice.level===level?' selected':''}>${esc(level)}</option>`).join("")}</select></label><h5>Phones</h5>${phones.length?destinations(phones):'<p class="sub">No Companion app phone is registered to this person.</p>'}<details><summary>Other message destinations</summary>${other.length?destinations(other):'<p class="sub">No notify entities are available.</p>'}</details><label class="installation-toggle"><input type="checkbox" data-notification-quiet="${esc(id)}"${quiet?' checked':''}> Quiet hours</label>${quiet?`<div class="quiet-times"><label>From<input type="time" data-notification-quiet-time="start" data-notification-person="${esc(id)}" value="${esc(quiet.start)}" required></label><label>Until<input type="time" data-notification-quiet-time="end" data-notification-person="${esc(id)}" value="${esc(quiet.end)}" required></label></div>`:''}<button type="button" class="link" data-notification-remove="${esc(id)}">Remove person</button></section>`;
  }).join("");
  const latest=new Map(failures.map(item=>[item.channel,item.error]));
  const failed=[...latest].map(([channel,error])=>`<li>${esc(routes.find(route=>route.channel===channel)?.name||channel)}: ${esc(error)}</li>`).join("");
  return `<section class="installation-group"><h3>People</h3><p class="sub">Choose who can act on each kind of problem and where to reach them. A test requests delivery to one destination; it does not prove receipt.</p>${failed?`<div role="status"><strong>Recent delivery request failures</strong><ul>${failed}</ul></div>`:''}${cards||'<p>No people are configured yet.</p>'}${add}</section>`;
}

export function installationSettings(card) {
  const notificationsPage=card.page==="notifications";
  const intro=`<div class="intro"><h1>${notificationsPage?"Notifications":"Settings"}</h1></div>`;
  if(!card.configuration||!card.settingsDraft)return `${intro}<section class="panel body"><p>${esc(card.configError||"Loading settings…")}</p><button type="button" class="button" data-action="load-configuration">Reload settings</button></section>`;
  const draft=card.settingsDraft,section=notificationsPage?"notifications":card.settingsSection==="grouping"?"grouping":"timing";
  const nav=notificationsPage?"":`<nav class="installation-nav" aria-label="Installation settings">${[["timing","Timing"],["grouping","Problem grouping"]].map(([id,label])=>`<button type="button" data-settings-section="${id}" aria-current="${section===id?'page':'false'}">${label}</button>`).join("")}</nav>`;
  let body="";
  if(section==="timing"||section==="grouping") {
    const rows=TIMINGS.filter(row=>section==="grouping"?row[0]==="Grouping":row[0]!=="Grouping");
    body=`<h2>${section==="grouping"?"Problem grouping":"Timing"}</h2><p class="sub">${section==="grouping"?"Combine related failures when they share a dependency.":"Set the waits used for detection, recovery, startup, and notification requests. Zero removes a wait."}</p>`+[...new Set(rows.map(row=>row[0]))].map(group=>`<section class="installation-group"><h3>${group}</h3>${rows.filter(row=>row[0]===group).map(([,key,label,help])=>timingField(`timings.${key}`,label,draft.timings[key],help,key==="coalesce_count")).join("")}</section>`).join("");
  }
  if(section==="notifications") {
    const routeReady=Object.values(draft.simple_notifications?.people||{}).some(choice=>choice.level!=="Off"&&choice.channels?.some(channel=>card.configuration.notification_destinations?.some(route=>route.channel===channel&&route.available)));
    body=`<p class="sub">Choose who hears about a problem, where it goes, and when to keep quiet. A delivery request is not proof of receipt.</p>${draft.consumer?'<p class="config-error">An older notification automation is selected. It remains saved. Clear it in Home Assistant options before setting up person delivery.</p>':peopleSettings(card)}<section class="installation-group"><h3>Quiet hours schedule</h3>${field("policy.timezone","Time zone",draft.simple_notifications?.timezone||draft.policy.timezone,"text","Used for quiet hours. For example, America/Chicago.",'required')}</section><section class="installation-group"><h3>Turn on requests</h3><label class="installation-toggle"><input type="checkbox" data-setting-path="notifications"${draft.notifications?' checked':''}${(!routeReady||Boolean(draft.consumer))&&!draft.notifications?' disabled':''}> Enable notification requests</label><p class="sub">Review and save first. Current open problems may be summarized when requests are enabled.</p></section>`;
  }
  const optionsUrl=`/config/integrations/integration/homeostatic#config_entry=${encodeURIComponent(card.current.data.entry_id)}`;
  if(section==="notifications"&&draft.consumer)body+=`<section class="installation-group"><a href="${optionsUrl}">Open Home Assistant options to clear the saved automation</a></section>`;
  const changes=settingsChanges(card.configuration.settings,draft),preview=card.settingsPreview;
  const review=preview?`<section class="settings-preview" aria-live="polite"><h3>Review changes</h3><ul>${settingsChanges(preview.before,preview.after).map(([label,from,to])=>`<li><strong>${esc(label)}</strong>: ${esc(from)} → ${esc(to)}</li>`).join("")}</ul><p>Homeostatic will reload to apply these settings.</p><p>Right now: ${preview.open_problems} open problems would produce ${preview.requests_now} notification requests under this policy. This preview sends nothing; quiet hours and current evidence affect actual timing.</p></section>`:"";
  return `${intro}<div class="installation-layout${notificationsPage?' notification-layout':''}">${nav}<section class="panel installation-content"><fieldset class="installation-editor"${card.settingsBusy?' disabled':''}>${body}</fieldset>${card.settingsError?`<p class="config-error" role="alert">${esc(card.settingsError)}</p>`:''}${review}${card.settingsNotice?`<p role="status">${esc(card.settingsNotice)}</p>`:''}<footer class="installation-actions"><span class="small">${changes.length?`${changes.length} unsaved ${changes.length===1?'change':'changes'}`:'All changes saved'}</span><button type="button" class="button primary" data-action="${preview?'save-settings':'preview-settings'}"${card.settingsBusy||!changes.length?' disabled':''}>${preview?'Save settings':'Review changes'}</button>${changes.length?'<button type="button" class="link" data-action="discard-settings">Discard</button>':''}</footer></section></div>`;
}

export function editInstallation(card,event) {
  const element=event.target,draft=card.settingsDraft;
  if(!draft)return false;
  if(event.type==="click"&&!element.closest?.("[data-notification-reset],[data-notification-remove],[data-notification-test]"))return false;
  const control=element.closest?.("[data-notification-reset],[data-notification-remove],[data-notification-test]");
  if(event.type==="click"&&control?.dataset.notificationTest){
    card.settingsNotice="Requesting a test message…";card.render();
    card._hass.callWS({type:"homeostatic/test_notification",channel:control.dataset.notificationTest})
      .then(()=>{card.settingsNotice="Test requested. Check the selected destination.";card.render();})
      .catch(error=>{card.settingsNotice=`Test failed: ${error.message}`;card.render();});
    return true;
  }
  if(event.type==="click"&&control?.hasAttribute("data-notification-reset")){
    draft.simple_notifications={people:{},timezone:draft.policy.timezone};
  }else if(event.type==="click"&&control?.dataset.notificationRemove){
    delete draft.simple_notifications.people[control.dataset.notificationRemove];
  }else if(element.dataset.notificationAdd!==undefined){
    const person=card.configuration.notification_people.find(item=>item.id===element.value);
    if(!person)return false;
    const channels=(card.configuration.notification_destinations||[]).filter(route=>route.channel.startsWith("phone:")&&route.user_id===person.user_id&&route.available).map(route=>route.channel);
    draft.simple_notifications.people[person.id]={level:person.administrator?"Important":"All",channels};
  }else if(element.dataset.notificationLevel){
    draft.simple_notifications.people[element.dataset.notificationLevel].level=element.value;
  }else if(element.dataset.notificationChannel){
    const channels=draft.simple_notifications.people[element.dataset.notificationPerson].channels;
    if(element.checked&&!channels.includes(element.dataset.notificationChannel))channels.push(element.dataset.notificationChannel);
    if(!element.checked)draft.simple_notifications.people[element.dataset.notificationPerson].channels=channels.filter(channel=>channel!==element.dataset.notificationChannel);
  }else if(element.dataset.notificationQuiet){
    const person=draft.simple_notifications.people[element.dataset.notificationQuiet];
    if(element.checked)person.quiet_hours={start:"22:00",end:"07:00"};else delete person.quiet_hours;
  }else if(element.dataset.notificationQuietTime){
    draft.simple_notifications.people[element.dataset.notificationPerson].quiet_hours[element.dataset.notificationQuietTime]=element.value;
  }else if(control?.dataset.notificationTest)return true;
  else if(element.matches?.("[data-notification-add],[data-notification-level],[data-notification-channel],[data-notification-quiet],[data-notification-quiet-time]"))return false;
  else if(event.type==="click")return false;
  else {
  if(element.matches?.("[data-setting-path],[data-quiet-time]") && element.checkValidity && !element.checkValidity()) {
    card.settingsPreview=null;card.settingsError="Complete the highlighted setting before reviewing.";
    element.reportValidity();card.main.querySelector('[data-action="save-settings"]')?.setAttribute("disabled","");return true;
  }
  if(element.dataset.quietRecipient!==undefined){
    const recipient=draft.policy.recipients[element.dataset.quietRecipient];
    if(element.checked)recipient.quiet_hours={start:"22:00",end:"07:00"};else delete recipient.quiet_hours;
  }else if(element.dataset.quietTime){
    draft.policy.recipients[element.dataset.recipient].quiet_hours[element.dataset.quietTime]=element.value;
  }else if(element.dataset.settingPath){
    const path=element.dataset.settingPath.split("."),key=path.pop();
    let object=draft;for(const part of path)object=object[part];
    const value=element.type==="checkbox"?element.checked:element.type==="number"?Number(element.value)*Number(element.dataset.settingScale||1):element.value;
    if(["remind_every","escalate_after"].includes(key)&&value===0)delete object[key];
    else object[key]=key==="consumer"?value||null:value;
    if(element.dataset.settingPath==="policy.timezone"&&draft.simple_notifications)draft.simple_notifications.timezone=value;
  }else return false;
  }
  card.settingsPreview=null;card.settingsError=null;card.settingsNotice=null;card.render();return true;
}
