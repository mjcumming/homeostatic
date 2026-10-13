import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=69";
import {MATCH_FIELDS, MATCH_LABELS} from "./configuration.mjs?v=69";

export const POLICY_CHECKS = {
  availability: "HA availability", battery: "Battery condition", vacuum: "Vacuum error",
  repair: "Repairs", broken_automation: "Broken automations", thermostat: "Thermostat progress",
  temperature_limit: "Temperature limits",
  ups_power:"UPS backup power", ups_reserve:"UPS low reserve", ups_battery_replacement:"UPS battery replacement", ups_fault:"UPS faults",
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MODES = {immediate:"Immediate once", acknowledge:"Until acknowledged", report:"Scheduled report"};
const METHOD_MODES = {fixed:"Fixed destinations", home_away:"Home or away", home_people:"People currently home"};
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const checked = value => value ? " checked" : "";
const selected = value => value ? " selected" : "";
const option = (value,name,current) => `<option value="${esc(value)}"${selected(value===current)}>${esc(name)}</option>`;
const button = (action,label,kind="",id="",extra="") => `<button type="button" class="button" data-definition-action="${action}" data-definition-kind="${kind}" data-definition-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const attrs = (kind,id,field) => `data-definition-kind="${kind}" data-definition-id="${esc(id)}" data-definition-field="${esc(field)}"`;
const input = (kind,id,field,label,value,type="text",extra="") => `<label class="installation-field"><span>${esc(label)}</span><input ${attrs(kind,id,field)} type="${type}" value="${esc(value??"")}" ${extra}></label>`;
const select = (kind,id,field,label,value,choices) => `<label class="installation-field"><span>${esc(label)}</span><select ${attrs(kind,id,field)}>${Object.entries(choices).map(([id,name])=>option(id,name,value)).join("")}</select></label>`;

export function nextDefinitionId(existing,prefix) {
  const ids = new Set(Array.isArray(existing) ? existing.map(item=>item.id) : Object.keys(existing));
  let number = 1;
  while(ids.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

export function newMonitoringPolicy(existing,check="availability") {
  const parameters = check === "thermostat" ? {unit:"°F",margin:2,progress:2,worsening:2,progress_seconds:3600}
    : check === "temperature_limit" ? {unit:"°F"} : {};
  const kind = check.startsWith("ups_")?"ups":{availability:"device",thermostat:"entity",temperature_limit:"entity"}[check] || check;
  return {id:nextDefinitionId(existing,"policy"),name:POLICY_CHECKS[check],check,match:{kind:[kind]},parameters,enabled:false,notifications:[]};
}

export function emptyNotificationDefinitions(timezone="UTC") {
  return {
    timezone,
    schedules:{
      immediate:{name:"Immediate",mode:"immediate"},
      acknowledge:{name:"Until acknowledged",mode:"acknowledge",remind_every:1800},
      morning:{name:"Morning report",mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},
      evening:{name:"Evening report",mode:"report",at:"18:00",weekdays:[0,1,2,3,4,5,6]},
      weekly:{name:"Weekly report",mode:"report",at:"08:00",weekdays:[0]},
    },methods:{},default:[],repairs:[],broken_automations:[],assignments:{},
  };
}

/** Every assignment stays explicit, including source and condition exceptions. */
export function notificationRowGroups(draft) {
  const definitions=draft.notification_definitions;
  const groups=(draft.monitoring_policies||[]).map(policy=>({label:policy.name,rows:policy.notifications,owner:policy,key:"notifications"}));
  if(!definitions)return groups;
  for(const [key,label] of [["default","Default reporting"],["repairs","Repairs"],["broken_automations","Broken automations"]])groups.push({label,rows:definitions[key]||[],owner:definitions,key});
  for(const [source,assignment] of Object.entries(definitions.assignments||{})) {
    if(assignment.default)groups.push({label:source,rows:assignment.default,owner:assignment,key:"default"});
    for(const [check,rows] of Object.entries(assignment.checks||{}))groups.push({label:`${source} · ${check}`,rows,owner:assignment.checks,key:check});
  }
  for(const [profile,rows] of Object.entries(definitions.automation_profiles||{}))groups.push({label:`Automation profile · ${profile}`,rows,owner:definitions.automation_profiles,key:profile});
  return groups;
}

export function definitionUses(draft,kind,id) {
  return notificationRowGroups(draft).filter(group=>group.rows.some(row=>kind==="schedules"?row.schedule===id:row.methods.includes(id))).map(group=>group.label);
}

function nextRowId(draft) {
  return nextDefinitionId(notificationRowGroups(draft).flatMap(group=>group.rows),"notification");
}

/** Delete only after selecting a replacement or explicitly removing the rows. */
export function deleteNotificationDefinition(draft,kind,id,resolution) {
  const definitions=draft.notification_definitions;
  if(!definitions?.[kind]?.[id])return;
  const uses=definitionUses(draft,kind,id);
  if(uses.length&&resolution!=="remove-rows"&&(!definitions[kind][resolution]||resolution===id))throw Error("Choose a replacement or explicitly remove the affected notification rows.");
  for(const group of notificationRowGroups(draft)) {
    const matches=row=>kind==="schedules"?row.schedule===id:row.methods.includes(id);
    if(resolution==="remove-rows")group.owner[group.key]=group.rows.filter(row=>!matches(row));
    else for(const row of group.rows.filter(matches)) {
      if(kind==="schedules")row.schedule=resolution;
      else row.methods=[...new Set(row.methods.map(method=>method===id?resolution:method))];
    }
  }
  delete definitions[kind][id];
}

export function reusableChanges(before,after) {
  const result=[];
  const beforePolicies=before.monitoring_policies||[],afterPolicies=after.monitoring_policies||[];
  for(const id of new Set([...beforePolicies,...afterPolicies].map(item=>item.id))) {
    const a=beforePolicies.find(item=>item.id===id),b=afterPolicies.find(item=>item.id===id);
    if(equal(a,b))continue;
    const reset=a&&b&&(!equal(a.match,b.match)||a.check!==b.check||!equal(a.parameters,b.parameters));
    result.push([b?.name||a.name,a?(a.enabled?"Monitoring":"Disabled"):"Not configured",!b?"Deleted; monitoring ends":reset?"Detection changed; existing alerts end and qualification restarts":b.enabled?"Monitoring with updated settings":"Disabled"]);
  }
  const a=before.notification_definitions,b=after.notification_definitions;
  for(const kind of ["schedules","methods"])for(const id of new Set([...Object.keys(a?.[kind]||{}),...Object.keys(b?.[kind]||{})])) {
    const old=a?.[kind]?.[id],item=b?.[kind]?.[id];
    if(equal(old,item))continue;
    const uses=definitionUses(after,kind,id);
    result.push([item?.name||old.name,old?"Saved definition":"Not configured",item?`Updated${uses.length?` · used by ${uses.join(", ")}`:" · no assignments"}`:"Deleted"]);
  }
  if(a?.timezone!==b?.timezone)result.push(["Reporting time zone",a?.timezone||"Current policy",b?.timezone||"Current policy"]);
  for(const key of ["default","repairs","broken_automations","assignments"])if(!equal(a?.[key],b?.[key]))result.push([({default:"Default reporting",repairs:"Repairs reporting",broken_automations:"Broken automation reporting",assignments:"Source reporting"})[key],"Previous notification rows","Updated notification rows"]);
  return result;
}

function rowsFor(card,scope) {
  if(scope.startsWith("policy:"))return card.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.notifications;
  if(scope.startsWith("source:")) {
    const [source,check]=JSON.parse(scope.slice(7));
    const assignment=card.settingsDraft.notification_definitions.assignments[source];
    return check?assignment?.checks?.[check]:assignment?.default;
  }
  return card.settingsDraft.notification_definitions?.[scope];
}

export function sourceNotificationDefinitions(card,source) {
  const definitions=card.settingsDraft.notification_definitions,assignment=definitions.assignments[source.node_id]||{};
  const check={battery:"battery",vacuum:"vacuum",situation:"condition",repair:"repair",broken_automation:"broken_automation"}[source.kind]||"availability";
  const inherited={repair:"repairs",broken_automation:"broken_automations"}[source.kind]||"default";
  const scope=(condition)=>`source:${JSON.stringify([source.node_id,condition,inherited])}`;
  const section=(condition,title)=>{
    const rows=condition?assignment.checks?.[condition]:assignment.default;
    const extra=`data-row-scope="${esc(scope(condition))}"`;
    const body=rows?notificationRowsEditor(card,rows,scope(condition))+button("inherit-rows","Use inherited reporting","","",extra)
      :`<p class="small">Following ${condition?"the source preference":"the default notification rows"}.</p>${button("override-rows","Choose notification rows","","",extra)}`;
    return `<h4>${title}</h4>${body}`;
  };
  return `<section class="source-section"><h3>Notifications</h3>${section("","Source preference")}<details><summary>Condition exception</summary>${section(check,POLICY_CHECKS[check]||"Configured condition")}</details><p class="small">Named monitoring policies use their own notification rows.</p>${applicablePolicyLinks(card,source)}<button type="button" class="link" data-page="notifications">Manage schedules and delivery methods</button></section>`;
}

export function applicablePolicyLinks(card,source) {
  const detail=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  const policies=detail?.monitoring_policies||source?.monitoring_policies||[];
  return policies.length?`<section class="source-section"><h3>Monitoring policies</h3>${policies.map(policy=>button("open-policy",policy.name,"policies",policy.id)).join("")}</section>`:"";
}

export function notificationRowsEditor(card,rows,scope) {
  const definitions=card.settingsDraft.notification_definitions;
  if(!definitions)return '<p class="note">Create schedules and delivery methods in Notifications, then return to this policy. Pending changes are retained.</p><button type="button" class="button" data-page="notifications">Open Notifications</button>';
  const schedules=definitions.schedules,methods=definitions.methods;
  const reserve=scope.startsWith("policy:")&&card.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.check==="ups_reserve";
  const rowHTML=rows.map(row=>`<div class="definition-notification-row">${reserve?`<label>When reserve is low<select data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-field="when">${[["mains","Mains power confirmed"],["backup","Backup power confirmed"]].map(([id,name])=>option(id,name,row.when||"mains")).join("")}</select></label>`:""}<label>Schedule<select data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-field="schedule">${!schedules[row.schedule]?option(row.schedule,"Choose a schedule",row.schedule):""}${Object.entries(schedules).map(([id,schedule])=>option(id,schedule.name,row.schedule)).join("")}</select></label><fieldset><legend>Delivery methods</legend>${Object.entries(methods).map(([id,method])=>`<label class="installation-toggle"><input type="checkbox" data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-method="${esc(id)}"${checked(row.methods.includes(id))}>${esc(method.name)}<small>${esc(METHOD_MODES[method.mode])}</small></label>`).join("")||'<p>No delivery methods yet.</p>'}${row.methods.filter(id=>!methods[id]).map(id=>`<p role="alert">Missing delivery method: ${esc(id)}</p>`).join("")}</fieldset>${button("remove-row","Remove notification","",row.id,`data-row-scope="${esc(scope)}"`)}</div>`).join("");
  return `${rowHTML||'<p class="sub">Dashboard only. No outgoing requests for this policy.</p>'}${button("add-row","Add notification","","",`data-row-scope="${esc(scope)}"`)}<p class="small">Each row pairs one schedule with its selected methods. Immediate delivery includes overnight.</p><button type="button" class="link" data-page="notifications">Manage schedules and delivery methods</button>`;
}

function policyFields(card,policy) {
  const {id,check,parameters}=policy;
  const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
  let parameterFields='<p class="sub">This check uses the configured Home Assistant evidence and installation timing.</p>';
  if(check==="ups_reserve") {
    const selected=inventory.filter(source=>source.kind==="ups"&&Object.entries(policy.match||{}).every(([field,values])=>values.some(value=>source.attributes?.[field]?.includes(value))));
    const hasRole=role=>selected.some(source=>(source.ups_entities||[]).some(([key])=>key===role));
    const fields=[...(hasRole("charge")||parameters.charge_low!==undefined?[["charge_low","Raise at or below (%)"],["charge_clear","Clear at or above (%)"]]:[]),...(hasRole("runtime")||parameters.runtime_low_minutes!==undefined?[["runtime_low_minutes","Raise at or below (minutes)"],["runtime_clear_minutes","Clear at or above (minutes)"]]:[])];
    parameterFields=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'min="0" step="any"')).join("")+`<p class="small">Optional numeric thresholds supplement the UPS warning. Set both raise and clear values for each measurement. Without a custom threshold, a reported device low setpoint is used when readable.</p><label class="installation-toggle"><input type="checkbox" ${attrs("policies",id,"parameters:replace_battery_check")}${checked(parameters.replace_battery_check)}>Transfer overlapping battery monitoring to this reserve policy</label><p class="small">Review lists the existing battery checks that will end. Charging alone does not clear low reserve.</p>`;
  }
  if(check==="thermostat"||check==="temperature_limit") {
    parameterFields=select("policies",id,"parameters:unit","Temperature unit",parameters.unit,{"°F":"°F","°C":"°C"});
    const fields=check==="thermostat"?[["margin","Deviation from target"],["progress","Required progress"],["worsening","Worsening threshold"],["progress_seconds","Progress window (seconds)"]]:[["minimum","Minimum (optional)"],["maximum","Maximum (optional)"],["duration_seconds","Must persist for (seconds)"]];
    parameterFields+=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",`step="any" ${["minimum","maximum"].includes(field)?"":'min="0" required'}`)).join("");
    parameterFields+=`<p class="small">${check==="thermostat"?"Deviation and progress are differences in the selected unit. Heating and cooling are evaluated separately.":"Choose a minimum, a maximum, or both. Qualification restarts when evidence no longer satisfies the limit."}</p>`;
  }
  const matches=MATCH_FIELDS.map(field=> {
    const registry={area:card.configuration.areas,floor:card.configuration.floors,label:card.configuration.labels}[field];
    const choices=registry?.map(item=>[item.id,item.name])||[...new Map(inventory.flatMap(source=>(source.attributes?.[field]||[]).map(value=>[value,source.name]))).entries()];
    const listId=`policy-${id}-${field}`;
    return input("policies",id,`match:${field}`,MATCH_LABELS[field],(policy.match[field]||[]).join(", "),"text",`list="${esc(listId)}" placeholder="Any"`)+`<datalist id="${esc(listId)}">${choices.map(([value,name])=>`<option value="${esc(value)}">${esc(name)}</option>`).join("")}</datalist>`;
  }).join("");
  return `<h3>What to watch</h3>${input("policies",id,"name","Name",policy.name,"text","required")}${select("policies",id,"check","Check",check,POLICY_CHECKS)}<label class="installation-toggle"><input type="checkbox" ${attrs("policies",id,"enabled")}${checked(policy.enabled)}>Enable monitoring</label><details class="definition-scope" open><summary>Sources and groups</summary><div class="config-fields">${matches}</div><p class="small">All filled conditions must match. Separate alternatives with commas. Area, label and integration groups include future matching sources. Individual selections belong to this named policy.</p></details><h3>When it is a problem</h3>${parameterFields}<h3>Notifications</h3>${notificationRowsEditor(card,policy.notifications,`policy:${id}`)}`;
}

export function namedPolicies(card) {
  const policies=card.settingsDraft?.monitoring_policies||[];
  const active=policies.find(item=>card.definitionSelection?.kind==="policies"&&item.id===card.definitionSelection.id);
  const list=policies.map(policy=>`<article class="definition-list-item"><div><h3>${esc(policy.name)}</h3><p class="small">${esc(POLICY_CHECKS[policy.check])} · ${policy.enabled?"On":"Off"} · ${policy.notifications.length?`${policy.notifications.length} notification rows`:"Dashboard only"}</p></div><div class="actions">${button("edit","Edit","policies",policy.id)}${button("duplicate","Duplicate","policies",policy.id)}${button("delete","Delete","policies",policy.id)}</div></article>`).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><h2>Named monitoring policies</h2>${button("add","Add monitoring policy","policies")}</div><p class="sub">Configure independent checks, their sources and notification rows. Copies start disabled.</p><div class="definition-workspace${active?" has-selection":""}"><div class="definition-list">${list||'<p>No named policies yet. Add a check or start from a template.</p>'}<label class="installation-field"><span>Starting template</span><select data-definition-template>${Object.entries(POLICY_CHECKS).map(([id,name])=>option(id,name,card.definitionTemplate||"availability")).join("")}</select></label></div>${active?`<section class="definition-editor installation-editor" aria-label="Edit monitoring policy"><header><h2>${esc(active.name)}</h2>${button("close","Back to policies","policies",active.id)}</header>${policyFields(card,active)}</section>`:""}</div>${deletePrompt(card)}</section>`;
}

function destinationChoices(card,method,id,field,label) {
  const saved=field.startsWith("person_destinations:")?method.person_destinations?.[field.slice(20)]||[]:method[field]||[];
  const targets=card.configuration.delivery_targets||card.configuration.notification_destinations||[];
  const known=new Set(targets.map(item=>item.channel));
  return `<fieldset class="definition-destinations"><legend>${esc(label)}</legend>${targets.map(target=>target.channel.startsWith("sms:")&&target.channel.endsWith(":")?`<label class="installation-field"><span>${esc(target.name)} · SMS recipient</span><input type="tel" placeholder="+15551234567" data-sms-method="${esc(id)}" data-sms-field="${esc(field)}" data-sms-service="${esc(target.channel)}"><button type="button" class="button" data-definition-action="add-sms" data-definition-kind="methods" data-definition-id="${esc(id)}" data-sms-field="${esc(field)}" data-sms-service="${esc(target.channel)}">Add recipient</button></label>`:`<label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,field)} data-destination="${esc(target.channel)}"${checked(saved.includes(target.channel))}>${esc(target.name)} <small>${esc(target.type||"Notification")}${target.available===false?" · unavailable":""}</small></label>`).join("")}${saved.filter(channel=>!known.has(channel)).map(channel=>`<label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,field)} data-destination="${esc(channel)}" checked>${esc(channel.startsWith("sms:")?decodeURIComponent(channel.split(":").slice(2).join(":")):channel)} <small>${channel.startsWith("sms:")?"SMS recipient":"Saved destination unavailable"}</small></label>`).join("")}${!targets.length?'<p class="note">No supported destinations discovered. Configure a notification integration, Companion app or voice target in Home Assistant.</p>':""}</fieldset>`;
}

function methodFields(card,id,method) {
  const people=card.configuration.notification_people||[];
  const personId=person=>person.entity_id||person.id;
  let body=input("methods",id,"name","Name",method.name,"text","required")+select("methods",id,"mode","Destination selection",method.mode,METHOD_MODES);
  if(method.mode==="fixed")body+=destinationChoices(card,method,id,"destinations","Destinations");
  else {
    body+=`<fieldset><legend>People whose presence is checked</legend>${people.map(person=>`<label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"people")} data-person="${esc(personId(person))}"${checked((method.people||[]).includes(personId(person)))}>${esc(person.name||personId(person))}</label>`).join("")||'<p>No Home Assistant people are configured.</p>'}</fieldset>`;
    if(method.mode==="home_away")body+=destinationChoices(card,method,id,"home","When someone is home")+destinationChoices(card,method,id,"away","When everyone is away");
    else body+=(method.people||[]).map(person=>destinationChoices(card,method,id,`person_destinations:${person}`,people.find(item=>personId(item)===person)?.name||person)).join("");
    body+=`<h3>No qualifying recipient or unknown presence</h3><label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"skip")}${checked(method.skip)}>Explicitly skip this request</label>${method.skip?'<p class="small">No request is sent when presence cannot select a recipient.</p>':destinationChoices(card,method,id,"fallback","Fallback destinations")}<p class="small">Presence is evaluated for each new request. Unknown presence uses the fallback or explicit skip choice.</p>`;
  }
  return body+'<p class="small">Saving or previewing a method sends nothing. Tests request a message; they do not prove receipt.</p>'+methodTest(card,id,method);
}

function methodTest(card,id,method) {
  const saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(JSON.stringify(saved)!==JSON.stringify(method))return '<p class="note">Save this delivery method before previewing or testing it.</p>';
  const review=card.deliveryMethodReview?.method_id===id&&card.deliveryMethodReview.revision===card.configuration.revision?card.deliveryMethodReview:null;
  return `<section class="settings-preview" aria-label="Test delivery method">${button("preview-method","Preview delivery method","methods",id,card.deliveryMethodBusy?"disabled":"")}${review?`<h3>Current destinations</h3><ul>${review.targets.map(target=>`<li>${esc(target.name)} · ${esc(target.type)}${target.available===false?" · unavailable":""}</li>`).join("")}</ul>${Object.keys(review.presence).length?`<p>Presence: ${Object.entries(review.presence).map(([person,value])=>`${esc(person)}: ${esc(value.restored?"restored (unknown)":value.state||"unknown")}`).join("; ")}</p>`:""}${review.skipped?'<p>This method explicitly skips the current request.</p>':button("test-method","Send test to these destinations","methods",id,card.deliveryMethodBusy||!review.targets.length||review.targets.some(target=>target.available===false)?"disabled":"")}`:""}${card.deliveryMethodError?`<p class="error" role="alert">${esc(card.deliveryMethodError)}</p>`:""}${card.deliveryMethodNotice?`<p role="status">${esc(card.deliveryMethodNotice)}</p>`:""}</section>`;
}

export async function previewDeliveryMethod(card,id) {
  card.deliveryMethodBusy=true;card.deliveryMethodReview=null;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();
  try {
    const revision=card.configuration.revision;
    const result=await card._hass.callWS({type:"homeostatic/preview_delivery_method",method_id:id,revision});
    card.deliveryMethodReview={...result,revision};
  }catch(error){card.deliveryMethodError=error.message||String(error);}
  finally{card.deliveryMethodBusy=false;card.render();}
}

export async function testDeliveryMethod(card,id) {
  const review=card.deliveryMethodReview;
  const current=card.settingsDraft.notification_definitions?.methods?.[id],saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(card.deliveryMethodBusy||review?.method_id!==id||review.revision!==card.configuration.revision||JSON.stringify(current)!==JSON.stringify(saved))return;
  card.deliveryMethodBusy=true;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();
  try {
    const result=await card._hass.callWS({type:"homeostatic/test_delivery_method",method_id:id,revision:review.revision,preview_token:review.preview_token});
    card.deliveryMethodNotice=result.skipped?"The current request was skipped.":`${result.requested.length} test message requests; ${result.failed.length} failed requests.${result.failed.length?` ${result.failed.map(item=>`${item.channel}: ${item.error}`).join("; ")}`:""}`;
  }catch(error){card.deliveryMethodError=error.message||String(error);}
  finally{card.deliveryMethodReview=null;card.deliveryMethodBusy=false;card.render();}
}

function scheduleForecast(card,id,schedule,timezone) {
  const preview=card.sourceSettingsReview?.result.reports;
  const saved=card.configuration.settings.notification_definitions;
  const changed=JSON.stringify(schedule)!==JSON.stringify(saved?.schedules?.[id])||timezone!==saved?.timezone;
  if(changed&&!preview)return '<p class="note">Review changes to see the next scheduled time for this draft.</p>';
  const reports=(preview||card.current.data.policy.reports||[]).filter(report=>report.name.startsWith(`schedule:${id}:`)).sort((a,b)=>a.next_at.localeCompare(b.next_at));
  if(!reports.length)return '<p class="small">No notification row currently uses this schedule.</p>';
  let next;
  try{next=new Date(reports[0].next_at).toLocaleString(undefined,{timeZone:timezone,timeZoneName:"short"});}
  catch(error){if(!(error instanceof RangeError))throw error;return '<p class="note">Choose a valid time zone before reviewing this schedule.</p>';}
  return `<p class="note">${preview?"After saving, next":"Next"} scheduled time: ${esc(next)}. Only eligible open problems are included.</p>`;
}

function scheduleFields(card,id,schedule,timezone) {
  let body=input("schedules",id,"name","Name",schedule.name,"text","required")+select("schedules",id,"mode","When to request",schedule.mode,MODES);
  if(schedule.mode==="acknowledge")body+=input("schedules",id,"remind_every","Repeat every (seconds)",schedule.remind_every,"number",'min="1" step="1" required');
  if(schedule.mode==="report")body+=input("schedules",id,"at",`Report time · ${timezone}`,schedule.at,"time","required")+`<fieldset><legend>Weekdays</legend>${DAYS.map((day,index)=>`<label class="installation-toggle"><input type="checkbox" ${attrs("schedules",id,"weekdays")} data-weekday="${index}"${checked(schedule.weekdays?.includes(index))}>${day}</label>`).join("")}</fieldset><p class="small">Reports include eligible open problems. Empty reports and resolved problems are omitted.</p>`;
  else body+='<p class="small">Immediate requests include overnight delivery.</p>';
  if(schedule.mode==="report")body+=scheduleForecast(card,id,schedule,timezone);
  return body;
}

function deletePrompt(card) {
  const request=card.definitionDelete;
  if(!request)return "";
  const {kind,id}=request;
  const item=kind==="policies"?card.settingsDraft.monitoring_policies.find(policy=>policy.id===id):card.settingsDraft.notification_definitions[kind][id];
  const uses=kind==="policies"?[]:definitionUses(card.settingsDraft,kind,id);
  return `<section class="settings-preview" role="region" aria-label="Review deletion"><h3>Delete ${esc(item.name)}?</h3>${kind==="policies"?'<p>Monitoring from this policy and its pending requests will end after review and save.</p>':uses.length?`<p>Used by ${uses.map(esc).join(", ")}. Choose what happens to every affected notification row.</p><label class="installation-field"><span>Replace or remove rows</span><select data-definition-delete-resolution>${option("","Choose an action",request.resolution)}${option("remove-rows","Remove affected notification rows",request.resolution)}${Object.entries(card.settingsDraft.notification_definitions[kind]).filter(([other])=>other!==id).map(([other,value])=>option(other,`Replace with ${value.name}`,request.resolution)).join("")}</select></label>`:'<p>This definition has no assignments.</p>'}${button("confirm-delete","Delete in draft",kind,id,uses.length&&!request.resolution?"disabled":"")}${button("cancel-delete","Cancel",kind,id)}</section>`;
}

export function namedNotifications(card) {
  const definitions=card.settingsDraft.notification_definitions;
  if(!definitions)return `<section class="reusable-definitions"><h2>Reusable notification settings</h2><p>The current custom policy stays active until a replacement is reviewed and saved. Start with empty destinations and assign schedules explicitly.</p>${button("start","Start reusable schedules")}</section>`;
  const kind=card.notificationDefinitionTab||"schedules",items=definitions[kind];
  const active=card.definitionSelection?.kind===kind?items[card.definitionSelection.id]:null;
  const id=active?card.definitionSelection.id:null;
  const list=Object.entries(items).map(([itemId,item])=>`<article class="definition-list-item"><div><h3>${esc(item.name)}</h3><p class="small">${esc(kind==="schedules"?MODES[item.mode]:METHOD_MODES[item.mode])}${item.mode==="report"?` · ${esc(item.at)}`:""} · Used by ${definitionUses(card.settingsDraft,kind,itemId).length}</p></div><div class="actions">${button("edit","Edit",kind,itemId)}${button("duplicate","Duplicate",kind,itemId)}${button("delete","Delete",kind,itemId)}</div></article>`).join("");
  const targets=card.configuration.delivery_targets||card.configuration.notification_destinations||[];
  return `<section class="reusable-definitions"><nav class="installation-nav" aria-label="Notification definitions">${[["schedules","Schedules"],["methods","Delivery methods"]].map(([value,label])=>button("tab",label,value,"",`aria-current="${kind===value?"page":"false"}"`)).join("")}</nav><div class="policy-check-head"><h2>${kind==="schedules"?"Schedules":"Delivery methods"}</h2>${button("add",kind==="schedules"?"Add schedule":"Add delivery method",kind)}</div><div class="definition-workspace${active?" has-selection":""}"><div class="definition-list">${list||'<p>No definitions yet.</p>'}</div>${active?`<section class="definition-editor installation-editor" aria-label="Edit ${kind==="schedules"?"schedule":"delivery method"}"><header><h2>${esc(active.name)}</h2>${button("close","Back to list",kind,id)}</header>${kind==="schedules"?`<label class="installation-field"><span>Time zone for all schedules</span><input required data-definition-zone value="${esc(definitions.timezone)}"></label>`+scheduleFields(card,id,active,definitions.timezone):methodFields(card,id,active)}<p class="small">Used by: ${definitionUses(card.settingsDraft,kind,id).map(esc).join(", ")||"No assignments"}</p></section>`:""}</div>${deletePrompt(card)}<details class="installation-group"><summary>Default notification rows</summary><p>Used by existing monitoring choices without a source override. Named policies use their own rows.</p>${[ ["default","Default"],["repairs","Repairs"],["broken_automations","Broken automations"]].map(([scope,label])=>`<h3>${label}</h3>${notificationRowsEditor(card,definitions[scope]||[],scope)}`).join("")}</details><section class="installation-group"><h3>Outgoing requests</h3><label class="installation-toggle"><input type="checkbox" data-definition-notifications${checked(card.settingsDraft.notifications)}>Enable notification requests</label><p class="small">Review and save to apply changes. Reporting edits can request messages for existing open problems.</p></section><details class="installation-group"><summary>Test a destination</summary><p>Only an explicit test action requests a message.</p>${targets.filter(target=>target.available!==false&&!target.channel.endsWith(":")).map(target=>`<div class="definition-list-item"><span>${esc(target.name)}</span><button type="button" class="button" data-notification-test="${esc(target.channel)}">Send test</button></div>`).join("")||'<p>No testable destination is available.</p>'}</details></section>`;
}

function invalidate(card) {
  card.settingsPreview=null;card.configPreview=null;card.sourceSettingsReview=null;
  card.settingsError=null;card.settingsNotice=null;card.sourceSettingsError=null;
}

function renderAfterEdit(card,element) {
  const dataset={...element.dataset},start=element.selectionStart,end=element.selectionEnd;
  card.render();
  const replacement=[...(card.main?.querySelectorAll?.("[data-definition-field],[data-row-field]")||[])].find(item=>Object.entries(dataset).every(([key,value])=>item.dataset[key]===value));
  replacement?.focus?.({preventScroll:true});
  if(start!==null&&start!==undefined)replacement?.setSelectionRange?.(start,end);
}

export function editReusable(card,event) {
  const element=event.type==="click"?event.target.closest?.("[data-definition-action]"):event.target;
  if(!element)return false;
  const d=element.dataset||{};
  if(!card.settingsDraft) {
    if(d.definitionAction!=="open-policy")return false;
    card.definitionSelection={kind:"policies",id:d.definitionId};card.page="policies";
    void card.loadConfiguration();return true;
  }
  const draft=card.settingsDraft;
  if(!Object.keys(d).some(key=>key.startsWith("definition")||key.startsWith("row")))return false;
  if(card.settingsBusy||card.configBusy)return true;
  const policies=draft.monitoring_policies||[];
  const definitions=draft.notification_definitions;
  const kind=d.definitionKind,id=d.definitionId,action=d.definitionAction;
  if(event.type==="click") {
    if(action==="preview-method"){void previewDeliveryMethod(card,id);return true;}
    if(action==="test-method"){void testDeliveryMethod(card,id);return true;}
    if(action==="tab"){card.notificationDefinitionTab=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="edit"){card.definitionSelection={kind,id};card.render();return true;}
    if(action==="open-policy"){card.definitionSelection={kind:"policies",id};card.page="policies";card.render();return true;}
    if(action==="close"){card.definitionSelection=null;card.render();return true;}
    if(action==="delete"){card.definitionDelete={kind,id,resolution:""};card.render();return true;}
    if(action==="cancel-delete"){card.definitionDelete=null;card.render();return true;}
    if(action==="start")draft.notification_definitions=emptyNotificationDefinitions(draft.policy.timezone);
    else if(action==="add"||action==="duplicate") {
      if(kind==="policies") {
        draft.monitoring_policies??=[];
        const original=policies.find(item=>item.id===id);
        const policy=action==="duplicate"?{...structuredClone(original),id:nextDefinitionId(policies,"policy"),name:`${original.name} copy`,enabled:false}:newMonitoringPolicy(policies,card.definitionTemplate||"availability");
        if(action==="add"&&policy.check==="thermostat"&&definitions) {
          const schedule=Object.entries(definitions.schedules).find(([,item])=>item.mode==="immediate")?.[0];
          const methods=[...new Set((definitions.default||[]).flatMap(row=>row.methods))].filter(method=>definitions.methods[method]);
          if(schedule&&methods.length)policy.notifications=[{id:nextRowId(draft),schedule,methods}];
        }
        if(action==="add"&&policy.check.startsWith("ups_")&&definitions) {
          const methods=[...new Set((definitions.default||[]).flatMap(row=>row.methods))].filter(method=>definitions.methods[method]);
          const modes=policy.check==="ups_reserve"?[["mains","report"],["backup","acknowledge"]]:[[null,policy.check==="ups_power"?"immediate":policy.check==="ups_battery_replacement"?"report":"acknowledge"]];
          for(const [when,mode] of modes) {
            const schedule=Object.entries(definitions.schedules).find(([,item])=>item.mode===mode&&(mode!=="report"||item.at==="08:00"))?.[0];
            if(schedule&&methods.length)policy.notifications.push({id:nextDefinitionId([...notificationRowGroups(draft).flatMap(group=>group.rows),...policy.notifications],"notification"),schedule,methods,...(when?{when}:{})});
          }
        }
        draft.monitoring_policies.push(policy);card.definitionSelection={kind,id:policy.id};
      }else {
        const newId=nextDefinitionId(definitions[kind],kind==="schedules"?"schedule":"method");
        const original=definitions[kind][id];
        definitions[kind][newId]=action==="duplicate"?{...structuredClone(original),name:`${original.name} copy`}:kind==="schedules"?{name:"New schedule",mode:"immediate"}:{name:"New delivery method",mode:"fixed",destinations:[]};
        card.definitionSelection={kind,id:newId};
      }
    }else if(action==="confirm-delete") {
      if(kind==="policies")draft.monitoring_policies=policies.filter(item=>item.id!==id);
      else deleteNotificationDefinition(draft,kind,id,card.definitionDelete?.resolution);
      card.definitionDelete=null;card.definitionSelection=null;
    }else if(action==="add-row") {
      const rows=rowsFor(card,d.rowScope);
      const reserve=d.rowScope.startsWith("policy:")&&policies.find(item=>item.id===d.rowScope.slice(7))?.check==="ups_reserve";
      rows.push({id:nextRowId(draft),schedule:Object.keys(definitions.schedules)[0]||"",methods:[],...(reserve?{when:rows.some(row=>row.when==="mains")?"backup":"mains"}:{})});
    }else if(action==="override-rows"||action==="inherit-rows") {
      const [source,check,inherited="default"]=JSON.parse(d.rowScope.slice(7));
      const assignment=definitions.assignments[source]??={checks:{}};
      assignment.checks??={};
      const owner=check?assignment.checks:assignment,key=check||"default";
      if(action==="inherit-rows")delete owner[key];
      else {
        const inheritedRows=structuredClone(check?(assignment.default||definitions[inherited]):definitions[inherited]);
        owner[key]=[];
        for(const row of inheritedRows)owner[key].push({...row,id:nextRowId(draft)});
      }
    }else if(action==="remove-row") {
      const rows=rowsFor(card,d.rowScope),index=rows.findIndex(row=>row.id===id);
      if(index>=0)rows.splice(index,1);
    }else if(action==="add-sms") {
      const target=[...card.main.querySelectorAll("[data-sms-method]")].find(item=>item.dataset.smsMethod===id&&item.dataset.smsField===d.smsField&&item.dataset.smsService===d.smsService);
      if(!/^\+?[0-9]{5,15}$/.test(target?.value||"")){card.settingsError="Enter an SMS recipient with 5–15 digits, optionally starting with +.";card.render();return true;}
      const method=definitions.methods[id],field=d.smsField;
      const owner=field.startsWith("person_destinations:")?(method.person_destinations??={}):method,key=field.startsWith("person_destinations:")?field.slice(20):field;
      owner[key]=[...new Set([...(owner[key]||[]),d.smsService+encodeURIComponent(target.value)])];
    }else return false;
  }else {
    if(d.definitionTemplate!==undefined){card.definitionTemplate=element.value;return true;}
    if(d.definitionDeleteResolution!==undefined){card.definitionDelete.resolution=element.value;card.render();return true;}
    if(d.definitionNotifications!==undefined)draft.notifications=element.checked;
    else if(d.definitionZone!==undefined)definitions.timezone=element.value;
    else if(d.rowScope) {
      const row=rowsFor(card,d.rowScope)?.find(item=>item.id===d.rowId);
      if(!row)return false;
      if(notificationRowGroups(draft).some(group=>group.rows.some(other=>other!==row&&other.id===row.id)))row.id=nextRowId(draft);
      if(d.rowMethod)row.methods=element.checked?[...new Set([...row.methods,d.rowMethod])]:row.methods.filter(method=>method!==d.rowMethod);
      else row[d.rowField]=element.value;
    }else if(d.definitionField) {
      const item=kind==="policies"?policies.find(policy=>policy.id===id):definitions[kind][id],field=d.definitionField;
      if(d.destination||d.person||d.weekday!==undefined) {
        const owner=field.startsWith("person_destinations:")?(item.person_destinations??={}):item,key=field.startsWith("person_destinations:")?field.slice(20):field;
        const value=d.destination||d.person||Number(d.weekday);
        owner[key]=element.checked?[...new Set([...(owner[key]||[]),value])]:(owner[key]||[]).filter(existing=>existing!==value);
        if(d.person&&item.mode==="home_people") {
          item.person_destinations??={};
          if(element.checked)item.person_destinations[value]??=[];else delete item.person_destinations[value];
        }
      }else if(field.startsWith("match:")) {
        const key=field.slice(6),values=element.value.split(",").map(value=>value.trim()).filter(Boolean);
        if(values.length)item.match[key]=values;else delete item.match[key];
      }else if(field.startsWith("parameters:")) {
        const key=field.slice(11);
        if(key==="unit"&&item.parameters.unit!==element.value) {
          const toC=element.value==="°C";
          const keys=item.check==="thermostat"?["margin","progress","worsening"]:["minimum","maximum"];
          for(const threshold of keys)if(typeof item.parameters[threshold]==="number") {
            const value=item.parameters[threshold],offset=item.check==="thermostat"?0:32;
            item.parameters[threshold]=toC?(value-offset)*5/9:value*9/5+offset;
          }
        }
        if(element.type==="checkbox")item.parameters[key]=element.checked;
        else if(element.value==="")delete item.parameters[key];else item.parameters[key]=element.type==="number"?Number(element.value):element.value;
      }else if(field==="check") {
        const template=newMonitoringPolicy([],element.value);
        item.check=element.value;item.parameters=template.parameters;item.match=template.match;
      }else if(field==="mode") {
        item.mode=element.value;
        if(kind==="schedules") {
          delete item.remind_every;delete item.at;delete item.weekdays;
          if(item.mode==="acknowledge")item.remind_every=1800;
          if(item.mode==="report"){item.at="08:00";item.weekdays=[0,1,2,3,4,5,6];}
        }else {
          const name=item.name;
          for(const key of Object.keys(item))delete item[key];
          Object.assign(item,{name,mode:element.value});
          if(item.mode==="fixed")item.destinations=[];
          else {item.people=[];item.fallback=[];item.skip=false;if(item.mode==="home_away"){item.home=[];item.away=[];}else item.person_destinations={};}
        }
      }else {
        item[field]=element.type==="checkbox"?element.checked:element.type==="number"?Number(element.value):element.value;
        if(kind==="methods"&&field==="skip"&&element.checked)item.fallback=[];
      }
    }else return false;
  }
  invalidate(card);renderAfterEdit(card,element);return true;
}
