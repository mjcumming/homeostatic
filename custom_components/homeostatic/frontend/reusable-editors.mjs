import {REPORTED_CONDITIONS} from "./reported-conditions.mjs?v=115";
import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=115";
import {destinationChoices,editDestinationPicker,focusDestinationPicker} from "./delivery-picker.mjs?v=115";
import {initializeScopedConfiguration,scopedDirty,saveScopedConfiguration,discardScopedConfiguration} from "./scoped-configuration.mjs?v=115";
import {entitySelection,entityScopeSummary,entitySelected,editEntitySelection} from "./entity-selection.mjs?v=115";
import {leftOpenFields,leftOpenValidation,leftOpenSummary,leftOpenEndText} from "./left-open.mjs?v=115";

import {SOURCE_CATEGORIES,sourceCategory,sourceNoun,sourceScopeSummary,flatSourceSelection,editSourceSelection} from "./source-selection.mjs?v=115";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const METHOD_MODES = {fixed:"Fixed destinations", home_away:"Home or away", home_people:"People currently home"};
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const checked = value => value ? " checked" : "";
const selected = value => value ? " selected" : "";
const option = (value,name,current) => `<option value="${esc(value)}"${selected(value===current)}>${esc(name)}</option>`;
const button = (action,label,kind="",id="",extra="",className="") => `<button type="button" class="button${className?` ${className}`:""}" data-definition-action="${action}" data-definition-kind="${kind}" data-definition-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const attrs = (kind,id,field) => `data-definition-kind="${kind}" data-definition-id="${esc(id)}" data-definition-field="${esc(field)}"`;
const input = (kind,id,field,label,value,type="text",extra="") => `<label class="installation-field"><span>${esc(label)}</span><input ${attrs(kind,id,field)} type="${type}" value="${esc(value??"")}" ${extra}></label>`;
const select = (kind,id,field,label,value,choices) => `<label class="installation-field"><span>${esc(label)}</span><select ${attrs(kind,id,field)}>${Object.entries(choices).map(([id,name])=>option(id,name,value)).join("")}</select></label>`;

export function scopedEditorFooter(card,scope,label) {
  initializeScopedConfiguration(card.editors);
  const key=scope.id?`${scope.kind}:${scope.id}`:scope.kind,status=card.editors.scopedStatusScope===key;
  const feedback=`${status&&card.editors.scopedError&&!(scope.kind==="policy"&&card.editors.policyValidation?.id===scope.id)?`<p class="config-error" role="alert">${esc(card.editors.scopedError)}</p>`:""}${status&&card.editors.scopedNotice?`<p role="status">${esc(card.editors.scopedNotice)}</p>`:""}`;
  const kind={policy:"policies",method:"methods",profile:"profiles",settings:"settings"}[scope.kind],disabled=card.editors.scopedBusy?"disabled":"";
  const actions=scopedDirty(card.editors,scope)?`<footer class="installation-actions"><span class="small">Unsaved changes</span><div class="actions">${button("discard-scoped","Discard changes",kind,scope.id||"",disabled)}${button("save-scoped",card.editors.scopedBusy===key?"Saving…":label,kind,scope.id||"",disabled,"primary")}</div></footer>`:"";
  return `<div data-scoped-editor="${esc(key)}" data-scope-kind="${esc(scope.kind)}" data-scope-id="${esc(scope.id||"")}" data-save-label="${esc(label)}">${feedback}${actions}</div>`;
}

function editableMethod(card,id) {
  return card.editors.settingsDraft.notification_definitions.methods[id];
}
const compactNames=names=>names.slice(0,2).join(", ")+(names.length>2?` +${names.length-2} more`:"");
const useCount=uses=>uses.length?`${uses.length} ${uses.length===1?"use":"uses"}`:"Not used yet";
const hasAvailabilityWait=policy=>policy.check==="availability"&&policy.match?.kind?.length===1&&policy.match.kind[0]==="entity";
function policyScopeSummary(card,policy) {
  if(policyType(policy)==="entity"&&sourceCategory(policy)==="any")return entityScopeSummary(policy);
  if(policy.check==="repair")return "All Repairs";
  if(policy.check==="broken_automation")return "All automations";
  return sourceScopeSummary(policy);
}
function policyDetectionSummary(policy) {
  const p=policy.parameters||{};
  if(hasAvailabilityWait(policy))return p.duration_seconds?`Unavailable for at least ${formatPolicyDuration(p.duration_seconds)}`:"Unavailable without waiting";
  if(policy.check==="battery")return `Battery at or below ${p.threshold??20}%`;
  if(policy.check==="left_open")return leftOpenSummary(policy);
  if(policy.check==="entity_not_provided")return `Not provided for at least ${formatPolicyDuration(p.duration_seconds??86400)}`;
  if(policy.check==="temperature_limit")return [p.minimum!=null?`Below ${p.minimum}${p.unit}`:"",p.maximum!=null?`Above ${p.maximum}${p.unit}`:"",p.duration_seconds?`for ${formatPolicyDuration(p.duration_seconds)}`:""].filter(Boolean).join(" · ")||"Temperature bounds need configuration";
  if(policy.check==="thermostat")return `${p.margin}${p.unit} deviation · ${p.progress_seconds/60} minute progress window`;
  if(policy.check==="ups_reserve")return [p.charge_low!==undefined?`Charge at or below ${p.charge_low}%`:"",p.runtime_low_minutes!==undefined?`Runtime at or below ${p.runtime_low_minutes} minutes`:""].filter(Boolean).join(" · ");
  return REPORTED_CONDITIONS[policy.check]?`Home Assistant reports ${REPORTED_CONDITIONS[policy.check].report}`:"";
}
function rowDefinition(definitions,row) {
  return row.profile ? definitions.profiles?.[row.profile] : row;
}
function reminderMinutes(value) {
  if(typeof value==="number")return value/60;
  const parts=[...String(value).matchAll(/([0-9]+(?:\.[0-9]+)?)\s*([smhd])/g)];
  return parts.length?parts.reduce((total,[,amount,unit])=>total+Number(amount)*{s:1/60,m:1,h:60,d:1440}[unit],0):Number(value)/60;
}
function timingSummary(timing={mode:"immediate"}) {
  if(timing.mode==="report") {
    const days=timing.weekdays||[];
    return `${timing.at} · ${DAYS.every((_,day)=>days.includes(day))?"Every day":days.map(day=>DAYS[day].slice(0,3)).join(", ")||"No days selected"}`;
  }
  const collection=timing.collection_delay_seconds===undefined?"":timing.collection_delay_seconds===0?"; no collection wait":`; collect for ${timing.collection_delay_seconds} seconds`;
  const eligible=timing.collection_delay_seconds===undefined?"Immediately":"When eligible";
  if(timing.mode==="acknowledge")return `${eligible}${collection}; remind every ${reminderMinutes(timing.remind_every)} minutes until acknowledged`;
  if(timing.mode==="window")return `${timing.start}–${timing.end} daily; hold outside these hours${collection}`;
  return `${eligible}${collection}`;
}
function notificationChoices(profiles) {
  const order={acknowledge:0,immediate:1,window:2,report:3};
  return Object.entries(profiles).sort(([leftId,left],[rightId,right])=>{
    const a=left.timing,b=right.timing;
    return order[a.mode]-order[b.mode]
      || (a.mode==="report"&&b.mode==="report"?b.weekdays.length-a.weekdays.length||a.at.localeCompare(b.at):0)
      || left.name.localeCompare(right.name)||leftId.localeCompare(rightId);
  });
}
function notificationSummary(definitions,row) {
  const entry=rowDefinition(definitions,row);
  if(!entry)return "Unavailable notification";
  const methods=(entry.methods||[]).map(id=>definitions.methods?.[id]?.name||"Unavailable method").join(", ");
  return `${timingSummary(entry.timing)} → ${methods||"No delivery method selected"}`;
}
function savedNotificationSummary(card,policy) {
  if(!policy.notifications?.length)return "Dashboard only";
  const definitions=card.editors.configuration.settings.notification_definitions;
  return policy.notifications.map(row=>{
    const entry=rowDefinition(definitions,row);
    const methodStatus=!entry?.methods?.length?" · No delivery method selected":entry.methods.some(id=>!definitions.methods?.[id])?" · Unavailable delivery method":"";
    const summary=row.profile?entry?`${entry.name}${methodStatus}`:"Unavailable notification":`Custom notification · ${notificationSummary(definitions,row)}`;
    return `${row.when?`${row.when==="backup"?"Backup power":"Mains power"}: `:""}${summary}`;
  }).join("; ");
}

export function nextDefinitionId(existing,prefix) {
  const ids = new Set(Array.isArray(existing) ? existing.map(item=>item.id) : Object.keys(existing));
  let number = 1;
  while(ids.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

export const MONITORING_TYPES = {
  ...Object.fromEntries(Object.entries(REPORTED_CONDITIONS).map(([key,value])=>[key,value.name])),
  integration: "Integration availability", entity: "Unavailable entities",
  battery: "Low battery", vacuum: "Vacuum error", lock_jam: "Jammed lock", repair: "Repairs", broken_automation: "Broken automations",
  thermostat: "Thermostat progress", temperature_limit: "Temperature limits", entity_not_provided: "Missing entities", left_open:"Left open",
  host_storage:"Low storage", host_memory:"Memory pressure", host_io:"Storage I/O pressure", host_cpu:"CPU pressure",
  ups_power: "UPS backup power", ups_reserve: "UPS low reserve", ups_battery_replacement: "UPS battery replacement", ups_fault: "UPS faults",
};
export function policyType(policy) {
  return policy.check === "availability" ? policy.match?.kind?.[0]||"entity" : policy.check;
}
export function newMonitoringPolicy(existing,type="entity",profiles=null,category="any") {
  if(type==="availability")type="entity";
  const check=["integration","entity"].includes(type)?"availability":type;
  const parameters = check === "thermostat" ? {unit:"°F",margin:2,progress:2,worsening:2,progress_seconds:3600}
    : check === "left_open" ? {unit:"°F",duration_seconds:null,use_temperature:false} : check === "temperature_limit" ? {unit:"°F",duration_seconds:0} : check === "battery" ? {threshold:20} : check === "entity_not_provided" ? {duration_seconds:86400} : ({host_storage:{threshold:5,recovery:6,duration_seconds:1800,recovery_seconds:1800},host_memory:{threshold:5,recovery:2,duration_seconds:600,recovery_seconds:600},host_io:{threshold:5,recovery:2,duration_seconds:900,recovery_seconds:600},host_cpu:{threshold:20,recovery:10,duration_seconds:900,recovery_seconds:600}}[check]||{});
  const kind = check==="lock_jam"?"lock":check.startsWith("ups_")?"ups":check.startsWith("host_")||["thermostat","temperature_limit","entity_not_provided","left_open"].includes(check)?"entity":type;
  const reported=REPORTED_CONDITIONS[check];
  const choices=reported?[[reported.profile||"immediate"]]:check==="ups_reserve"?[["morning","mains"],["acknowledge","backup"]]:[[{thermostat:"urgent",temperature_limit:"acknowledge",left_open:"acknowledge",vacuum:"evening",lock_jam:"immediate",ups_power:"urgent",ups_fault:"urgent"}[check]||"morning"]];
  const notifications=choices.filter(([profile])=>profiles?.[profile]).map(([profile,when],index)=>({id:`notification-${index+1}`,profile,...(when?{when}:{})}));
  const sourceCategory=type==="entity"?SOURCE_CATEGORIES[category]||SOURCE_CATEGORIES.any:SOURCE_CATEGORIES.any;
  return {id:nextDefinitionId(existing,"policy"),name:sourceCategory.match?sourceCategory.name:MONITORING_TYPES[type],check,match:{kind:[kind],...(sourceCategory.match?structuredClone(sourceCategory.match):{}),...(["entity","left_open"].includes(type)||check.startsWith("host_")||reported&&!reported.all?{entity:[]}: {})},parameters,enabled:false,notifications};
}

export function emptyNotificationDefinitions(timezone="UTC") {
  return {timezone,methods:{},profiles:{},default:[],repairs:[],broken_automations:[],assignments:{},automation_profiles:{}};
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
  const groups=notificationRowGroups(draft);
  if(kind==="profiles")return groups.filter(group=>group.rows.some(row=>row.profile===id)).map(group=>group.label);
  const profiles=Object.values(draft.notification_definitions?.profiles||{}).filter(profile=>profile.methods.includes(id)).map(profile=>profile.name);
  return [...new Set([...profiles,...groups.filter(group=>group.rows.some(row=>row.methods?.includes(id))).map(group=>group.label)])];
}

function nextRowId(draft) {
  return nextDefinitionId(notificationRowGroups(draft).flatMap(group=>group.rows),"notification");
}

function rowsFor(card,scope) {
  if(scope.startsWith("policy:"))return card.editors.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.notifications;
  return card.editors.settingsDraft.notification_definitions?.[scope];
}

export function applicablePolicyLinks(card,source) {
  const detail=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  const policies=detail?.monitoring_policies||source?.monitoring_policies||[];
  return policies.length?`<section class="source-section"><h3>Monitoring policies</h3>${policies.map(policy=>button("open-policy",`Edit policy: ${policy.name}`,"policies",policy.id)).join("")}</section>`:"";
}

function nextPolicySummary(card,row,scope) {
  const policyId=scope.slice(7),saved=card.editors.configuration.settings;
  const policy=card.editors.settingsDraft.monitoring_policies.find(item=>item.id===policyId);
  const savedPolicy=saved.monitoring_policies?.find(item=>item.id===policyId);
  const savedRow=savedPolicy?.notifications.find(item=>item.id===row.id);
  const zone=card.editors.settingsDraft.notification_definitions.timezone;
  if(!savedRow||row.profile!==savedRow.profile||!equal(rowDefinition(card.editors.settingsDraft.notification_definitions,row)?.timing,rowDefinition(saved.notification_definitions,savedRow)?.timing)||zone!==saved.notification_definitions.timezone)return "Next summary time is available after saving this schedule.";
  if(policy?.enabled!==savedPolicy.enabled)return "Summary scheduling changes after you save this policy.";
  const report=card.current?.data?.policy?.reports?.find(item=>item.name===`entry:policy_${policyId}_${row.id}`);
  const next=report?.next_at?new Date(report.next_at):null;
  if(!policy?.enabled||!savedPolicy.enabled||!next||!Number.isFinite(next.getTime()))return "No summary is currently scheduled for this policy.";
  return `Next summary: ${new Intl.DateTimeFormat(undefined,{timeZone:zone,dateStyle:"medium",timeStyle:"short"}).format(next)} · ${zone}.`;
}

export function notificationRowsEditor(card,rows,scope) {
  const definitions=card.editors.settingsDraft.notification_definitions,profiles=card.editors.configuration.settings.notification_definitions?.profiles||{};
  const reserve=card.editors.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.check==="ups_reserve";
  const choices=current=>notificationChoices(profiles).map(([id,profile])=>option(id,profile.name,current)).join("");
  const choice=(row,index)=> {
    const attr=field=>`data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-field="${field}"`;
    const current=row.profile||"",entry=rowDefinition(definitions,row);
    const methods=entry?.methods?.map(id=>definitions.methods?.[id]?.name||"Unavailable method").join(", ");
    const name=entry?.name||(row.profile?"Unavailable notification":"Custom notification");
    return `<div class="policy-notification-row"><div class="policy-notification-controls"><label class="installation-field"><span class="sr-only">Notification ${index+1}</span><select ${attr("profile")}>${option("",row.profile?"Dashboard only":"Custom notification — keep current settings",current)}${row.profile&&!profiles[row.profile]?option(row.profile,"Unavailable notification",current):""}${choices(current)}</select></label>${button("remove-row","Remove","",row.id,`data-row-scope="${esc(scope)}" aria-label="${esc(`Remove notification ${index+1}: ${name}`)}"`)}</div>${reserve?`<label class="installation-field policy-notification-condition"><span>When reserve is low</span><select ${attr("when")}>${[["mains","Mains power confirmed"],["backup","Backup power confirmed"]].map(([id,name])=>option(id,name,row.when||"mains")).join("")}</select></label>`:""}${entry?`<dl class="policy-notification-facts"><div><dt>When</dt><dd>${esc(timingSummary(entry.timing))}</dd></div><div><dt>Send to</dt><dd>${esc(methods||"No delivery method selected")}</dd></div></dl>${entry.timing?.mode==="report"?`<p class="policy-notification-next">${esc(nextPolicySummary(card,row,scope))}</p>`:""}`:`<p class="policy-notification-next">Choose an available notification or remove this assignment.</p>`}</div>`;
  };
  return `<div class="policy-notifications">${rows.length?rows.map(choice).join(""):`<div class="policy-notification-empty"><strong>No notifications</strong><p>Issues still appear in Open issues.</p></div>`}<label class="installation-field policy-notification-add"><span>Add notification</span><select data-row-scope="${esc(scope)}" data-row-id="" data-row-field="profile"${Object.keys(profiles).length?"":" disabled"}>${option("","Choose a notification…","")}${choices("")}</select></label>${Object.keys(profiles).length?"":`<p class="policy-notification-next">Create a notification in Notifications to add it here.</p>`}</div>`;
}

function methodSummary(card,method) {
  if(method.mode!=="fixed")return METHOD_MODES[method.mode];
  const destinations=method.destinations||[],targets=card.editors.configuration.delivery_targets;
  if(!destinations.length)return "No destinations selected";
  if(!targets)return `${destinations.length} saved ${destinations.length===1?"destination":"destinations"}`;
  const names=destinations.map(channel=>{
    const target=targets.find(item=>item.channel===channel);
    return target?.destination_name||target?.name||(channel.startsWith("sms:")?`SMS ${decodeURIComponent(channel.split(":").slice(2).join(":"))}`:"Unavailable destination");
  });
  const unavailable=destinations.filter(channel=>{const target=targets.find(item=>item.channel===channel);return target?target.available===false:!channel.startsWith("sms:");}).length;
  if(names.length===1&&names[0]===method.name&&!unavailable)return "";
  return compactNames(names)+(unavailable?` · ${unavailable} unavailable`:"");
}


function watchEditor(card,policy) {
  if(policy.check==="entity_not_provided"||policyType(policy)==="entity"&&sourceCategory(policy)==="any")return entitySelection(card,policy);
  if(policy.check==="repair")return '<p>Watches all Home Assistant Repairs.</p>';
  if(policy.check==="broken_automation")return '<p>Checks all automations for references to entities that no longer exist.</p>';
  return flatSourceSelection(card,policy);
}

const DURATION_UNITS={minutes:60,hours:3600,seconds:1};
function formatPolicyDuration(seconds) {
  const unit=seconds>0&&seconds%3600===0?"hours":seconds>0&&seconds%60===0?"minutes":"seconds",value=seconds/DURATION_UNITS[unit];
  return `${value} ${value===1?unit.slice(0,-1):unit}`;
}
function durationValidation(seconds) {
  return !Number.isInteger(seconds)||seconds<0||seconds>31536000?{field:"duration_seconds",message:"Enter a duration from 0 to 365 days that equals a whole number of seconds."}:null;
}
function temperatureValidation(policy) {
  const p=policy.parameters;
  if(p.minimum==null&&p.maximum==null)return {field:"minimum",message:"Enter at least one limit: Below, Above, or both."};
  for(const field of ["minimum","maximum"])if(p[field]!=null&&!Number.isFinite(p[field]))return {field,message:"Enter a valid temperature limit."};
  if(p.minimum!=null&&p.maximum!=null&&p.minimum>p.maximum)return {field:"minimum",message:"Below must be less than or equal to Above."};
  return durationValidation(p.duration_seconds);
}
function hostValidation(policy) {
  const p=policy.parameters||{},storage=policy.check==="host_storage";
  for(const field of ["threshold","recovery"])if(!Number.isFinite(p[field])||p[field]<0||!storage&&p[field]>100)return {field,message:storage?"Enter a nonnegative storage limit.":"Enter a pressure limit from 0 to 100%."};
  if(storage?p.recovery<=p.threshold:p.recovery>=p.threshold)return {field:"recovery",message:storage?"The recovery limit must be higher than the problem limit.":"The recovery limit must be lower than the problem limit."};
  for(const field of ["duration_seconds","recovery_seconds"])if(!Number.isInteger(p[field])||p[field]<0||p[field]>31536000)return {field,message:"Enter a duration from 0 to 365 days in whole seconds."};
  return null;
}
function policyFieldError(card,id,field) {
  return card.editors.policyValidation?.id===id&&card.editors.policyValidation.field===field?`aria-invalid="true" aria-describedby="policy-error-${esc(id)}"`:"";
}
function temperatureRule(policy) {
  const p=policy.parameters;
  const bounds=[p.minimum!=null?`below ${p.minimum}${p.unit}`:"",p.maximum!=null?`above ${p.maximum}${p.unit}`:""].filter(Boolean).join(" or ");
  return temperatureValidation(policy)?"Enter a lower limit, an upper limit, or both, and a valid duration.":`${policy.enabled?"Open an issue":"When enabled, open an issue"} when the temperature ${p.duration_seconds?"stays":"is"} ${bounds}${p.duration_seconds?` for ${formatPolicyDuration(p.duration_seconds)}`:", without waiting"}.`;
}
function durationField(card,policy,label,seconds,field="duration_seconds") {
  const {id}=policy,key=`${id}:${field}`;
  const unit=card.editors.policyDurationUnits?.[key]||(seconds==null||seconds%60===0?"minutes":"seconds"),duration=seconds==null?"":seconds/DURATION_UNITS[unit];
  return `<div class="policy-duration">${input("policies",id,`parameters:${field}`,label,duration,"number",`data-duration-unit="${unit}" min="0" max="${31536000/DURATION_UNITS[unit]}" step="any" required ${policyFieldError(card,id,field)}`)}${select("policies",id,`duration-unit:${field}`,"Duration unit",unit,{minutes:"Minutes",hours:"Hours",seconds:"Seconds"})}</div>`;
}
function policyValidationMessage(card,id) {
  return card.editors.policyValidation?.id===id?`<p class="config-error" role="alert" id="policy-error-${esc(id)}">${esc(card.editors.policyValidation.message)}</p>`:"";
}
function availabilityDuration(policy) {
  return Object.hasOwn(policy.parameters,"duration_seconds")?policy.parameters.duration_seconds:0;
}
function availabilityRule(policy) {
  const seconds=availabilityDuration(policy);
  return durationValidation(seconds)?"Enter a valid duration.":`${policy.enabled?"Open an issue":"When enabled, open an issue"} when an entity ${seconds?`stays unavailable for ${formatPolicyDuration(seconds)}`:"is unavailable, without waiting"}.`;
}
function otherAvailabilityCoverage(card,policy) {
  const entities=(card.current?.data?.inventory?.catalog?.candidates||[]).filter(source=>source.kind==="entity"&&!source.disabled&&entitySelected(policy,source));
  const overlapping=(card.editors.configuration.settings.monitoring_policies||[]).filter(other=>other.id!==policy.id&&other.enabled&&policyType(other)==="entity"&&entities.some(source=>entitySelected(other,source)));
  return overlapping.length?`<p class="small">Other enabled policies also monitor selected entities. Each uses its own wait.</p><div class="actions">${overlapping.map(other=>button("open-policy",[other.name,policyDetectionSummary(other)].filter(Boolean).join(": "),"policies",other.id)).join("")}</div>`:"";
}
function temperatureFields(card,policy) {
  const {id,parameters:p}=policy;
  const summary=temperatureRule(policy);
  return `<div class="policy-temperature-unit">${select("policies",id,"parameters:unit","Temperature unit",p.unit,{"°F":"°F","°C":"°C",K:"K"})}</div><div class="policy-limits">${[["minimum","Below (optional)"],["maximum","Above (optional)"]].map(([field,label])=>input("policies",id,`parameters:${field}`,label,p[field],"number",`step="any" ${policyFieldError(card,id,field)}`)).join("")}</div><p class="small policy-help">Enter either limit or both. Leave a limit blank if it does not apply.</p>${durationField(card,policy,"For at least",p.duration_seconds)}<p class="small policy-help">The timer resets when the temperature returns within the limits. Use 0 for no waiting period.</p>${policyValidationMessage(card,id)}<p class="policy-rule" role="status">${esc(summary)}</p>`;
}

function policyFields(card,policy) {
  const {id,check,parameters}=policy;
  let parameterFields="";
  if(hasAvailabilityWait(policy))parameterFields=durationField(card,policy,"Report unavailable after",availabilityDuration(policy))+'<p class="small policy-help">The wait restarts if the entity becomes available. Use 0 for no waiting period.</p>'+policyValidationMessage(card,id)+`<p class="policy-rule" role="status">${esc(availabilityRule(policy))}</p>`;
  if(check==="battery")parameterFields=input("policies",id,"parameters:threshold","Battery level at or below (%)",parameters.threshold??20,"number",'min="0" max="100" step="1" required');
  if(check==="ups_reserve") {
    const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
    const selected=inventory.filter(source=>source.kind==="ups"&&!policy.excluded_sources?.includes(source.monitoring_source||source.node_id)&&Object.entries(policy.match||{}).every(([field,values])=>values.some(value=>source.attributes?.[field]?.includes(value))));
    const hasRole=role=>selected.some(source=>(source.ups_entities||[]).some(([key])=>key===role));
    const fields=[...(hasRole("charge")||parameters.charge_low!==undefined?[["charge_low","Raise at or below (%)"],["charge_clear","Clear at or above (%)"]]:[]),...(hasRole("runtime")||parameters.runtime_low_minutes!==undefined?[["runtime_low_minutes","Raise at or below (minutes)"],["runtime_clear_minutes","Clear at or above (minutes)"]]:[])];
    parameterFields=fields.length?fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'min="0" step="any"')).join("")+`<p class="small">Optional thresholds supplement the UPS warning. Set both raise and clear values. Leave them blank to use the device’s low setpoint when available. Charging alone does not clear low reserve.</p>`:"";
  }
  if(check==="entity_not_provided")parameterFields=input("policies",id,"parameters:duration_seconds","For at least (hours)",(parameters.duration_seconds??86400)/3600,"number",'data-duration-unit="hours" min="0" max="8760" step="any" required')+'<p class="small policy-help">The owning integration must be loaded. Startup and reload gaps restart the wait. Open the entity in Home Assistant to inspect it. Use 0 for no waiting period.</p>';
  if(check==="temperature_limit")parameterFields=temperatureFields(card,policy);
  if(check.startsWith("host_")) {
    const unit=check==="host_storage"?"GiB":"%",direction=check==="host_storage"?"Below":"Above",clear=check==="host_storage"?"Above":"Below";
    parameterFields=`<div class="policy-limits">${input("policies",id,"parameters:threshold",`${direction} (${unit})`,parameters.threshold,"number",`min="0" step="any" required ${policyFieldError(card,id,"threshold")}`)}${input("policies",id,"parameters:recovery",`Clear ${clear.toLowerCase()} (${unit})`,parameters.recovery,"number",`min="0" step="any" required ${policyFieldError(card,id,"recovery")}`)}</div>${durationField(card,policy,"Problem wait",parameters.duration_seconds)}${durationField(card,policy,"Recovery wait",parameters.recovery_seconds,"recovery_seconds")}${policyValidationMessage(card,id)}<p class="small policy-help">${check==="host_storage"?"Choose limits that leave enough room for this installation.":"The five-minute average shows time spent waiting for this resource."} Missing reports do not clear an issue.</p>`;
  }
  if(check==="left_open")parameterFields=durationField(card,policy,"Open for at least",parameters.duration_seconds)+leftOpenFields(card,policy)+policyValidationMessage(card,id)+`<div class="policy-rule" role="status"><p>${esc(leftOpenSummary(policy))}</p><p>${esc(leftOpenEndText(policy))}</p></div>`;
  if(check==="thermostat") {
    parameterFields=select("policies",id,"parameters:unit","Temperature unit",parameters.unit,{"°F":"°F","°C":"°C",K:"K"});
    const fields=[["margin","Deviation from target"],["progress","Required progress"],["worsening","Worsening threshold"],["progress_seconds","Progress window (seconds)"]];
    parameterFields+=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'step="any" min="0" required')).join("");
    parameterFields+='<p class="small">Deviation and progress are differences in the selected unit. Heating and cooling are evaluated separately.</p>';
  }
  const notificationStatus=card.editors.configuration.settings.notifications===false?'<p class="policy-notification-status">Notifications are turned off globally. This policy can still monitor and show issues.</p>':"";
  return `<div class="policy-identity">${input("policies",id,"name","Policy name",policy.name,"text","required")}<div class="policy-type"><span>Monitoring type</span><strong>${esc(MONITORING_TYPES[policyType(policy)])}</strong></div>${policyType(policy)==="entity"?`<div class="policy-type"><span>Source category</span><strong>${esc(SOURCE_CATEGORIES[sourceCategory(policy)].name)}</strong></div>`:""}</div><section class="policy-section"><h3>${esc(sourceNoun(policy)[0].toUpperCase()+sourceNoun(policy).slice(1))}</h3>${watchEditor(card,policy)}${policyType(policy)==="entity"?otherAvailabilityCoverage(card,policy):""}</section>${parameterFields?`<section class="policy-section"><h3>When it becomes a problem</h3>${parameterFields}</section>`:""}<section class="policy-section"><h3>Notifications</h3>${notificationStatus}${notificationRowsEditor(card,policy.notifications,`policy:${id}`)}</section>`;
}

export function namedPolicies(card) {
  initializeScopedConfiguration(card.editors);
  const policies=card.editors.settingsDraft?.monitoring_policies||[];
  const active=policies.find(item=>card.definitionSelection?.kind==="policies"&&item.id===card.definitionSelection.id);
  const templates=card.editors.configuration.monitoring_policy_templates||[];
  const missing=templates.filter(template=>!policies.some(policy=>policy.id===template.id));
  if(card.editors.policyCreating)return `<section class="definition-editor installation-editor policy-create"><h2>Add policy</h2><p>Choose what to watch. The monitoring type stays fixed after creation.</p><label class="installation-field"><span>Monitoring type</span><select data-definition-template>${Object.entries(MONITORING_TYPES).sort(([,a],[,b])=>a.localeCompare(b)).map(([id,name])=>option(id,name,card.editors.definitionTemplate||"entity")).join("")}</select></label>${(card.editors.definitionTemplate||"entity")==="entity"?`<label class="installation-field"><span>Source category</span><select data-definition-category>${Object.entries(SOURCE_CATEGORIES).map(([id,value])=>option(id,value.name,card.editors.definitionCategory||"any")).join("")}</select></label><p class="small">Reports when Home Assistant marks a selected entity as unavailable.</p>`:""}${button("create","Continue","policies")}${button("close","Cancel","policies")}</section>`;
  if(active) {
    return `<section class="definition-editor installation-editor unified-policy-editor" aria-label="Edit monitoring policy"><header><div><h1>${esc(active.name)}</h1><p class="small">Changes take effect when you save.</p></div><label class="method-switch policy-enabled"><input type="checkbox" role="switch" aria-label="Policy enabled" ${attrs("policies",active.id,"enabled")}${checked(active.enabled)}><span>Policy ${active.enabled?"enabled":"disabled"}</span></label>${button("close","Back to policies","policies",active.id,"","editor-back")}</header>${policyFields(card,active)}${deletePrompt(card)}${scopedEditorFooter(card,{kind:"policy",id:active.id},"Save policy")}</section>`;
  }
  const list=policies.map(draft=>{
    const saved=card.editors.configuration.settings.monitoring_policies?.find(item=>item.id===draft.id),policy=saved||draft;
    const state=saved?(saved.enabled?"On":"Off"):"Not saved";
    const pending=scopedDirty(card.editors,{kind:"policy",id:policy.id}),detection=policyDetectionSummary(policy);
    const menuId=`policy-actions-${policy.id}`;
    return `<article class="definition-list-item"><div><h3>${esc(policy.name)} <span class="small">${state}</span></h3><p class="small">${esc(MONITORING_TYPES[policyType(policy)])} · ${esc(policyScopeSummary(card,policy))}</p>${detection?`<p class="small">${esc(detection)}</p>`:""}<p class="small">${esc(savedNotificationSummary(card,policy))}</p>${pending?`<p class="source-setting-pending" role="status">Unsaved changes</p>`:""}</div><div class="actions">${button("edit","Edit policy","policies",policy.id)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(policy.name)}" title="More actions"${card.editors.settingsBusy||card.editors.configBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(policy.name)}">${button("duplicate","Duplicate","policies",policy.id)}${button("delete","Delete","policies",policy.id)}</div></div></article>`;
  }).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><div class="actions">${missing.length?button("restore","Restore defaults","policies"):""}${button("add","Add policy","policies","","","primary")}</div></div>${card.editors.policyRestoring?`<section class="policy-restoration" aria-label="Restore default policies"><h3>Restore defaults</h3><p>Choose deleted policies to restore, then edit and save each restored policy.</p>${missing.map(policy=>`<label class="installation-toggle"><input type="checkbox" data-definition-restore="${esc(policy.id)}"${checked(card.editors.policyRestoreIds?.includes(policy.id))}>${esc(policy.name)}</label>`).join("")}${button("confirm-restore","Restore selected","policies","",card.editors.policyRestoreIds?.length?"":"disabled")}${button("cancel-restore","Cancel","policies")}</section>`:""}<div class="definition-list">${list||'<p>No policies yet.</p>'}</div>${deletePrompt(card)}${card.editors.scopedError?`<p class="config-error" role="alert">${esc(card.editors.scopedError)}</p>`:""}</section>`;
}

function methodFields(card,id,method,allowTest=true) {
  const people=card.editors.configuration.notification_people||[];
  const personId=person=>person.entity_id||person.id;
  let body=input("methods",id,"name","Name",method.name,"text","required");
  if(!card.editors.configuration.delivery_targets)return body+`<p role="status">${esc(card.editors.deliveryError||"Loading notification destinations…")}</p>${card.editors.deliveryError?button("load-delivery","Retry loading destinations","methods",id):""}`;
  if(method.mode==="fixed")body+=destinationChoices(card,method,id,"destinations","Send to");
  body+=`<details class="method-presence" data-ui-key="method-presence-${esc(id)}"${method.mode!=="fixed"?" open":""}><summary>Change destinations based on who’s home <span class="small">Optional</span></summary>${select("methods",id,"mode","Presence selection",method.mode,METHOD_MODES)}`;
  if(method.mode!=="fixed") {
    body+=`<fieldset><legend>People whose presence is checked</legend>${people.map(person=>`<label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"people")} data-person="${esc(personId(person))}"${checked((method.people||[]).includes(personId(person)))}>${esc(person.name||personId(person))}</label>`).join("")||'<p>No Home Assistant people are configured.</p>'}</fieldset>`;
    if(method.mode==="home_away")body+=destinationChoices(card,method,id,"home","When someone is home")+destinationChoices(card,method,id,"away","When everyone is away");
    else body+=(method.people||[]).map(person=>destinationChoices(card,method,id,`person_destinations:${person}`,people.find(item=>personId(item)===person)?.name||person)).join("");
    body+=`<h3>When no recipient can be chosen</h3><p class="small">Includes unknown presence. Presence is checked when sending.</p><label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"skip")}${checked(method.skip)}>Skip notification</label>${method.skip?"":destinationChoices(card,method,id,"fallback","Send to instead")}`;
  }
  return body+'</details>'+(allowTest?methodTest(card,id,method):'');
}

function methodTest(card,id,method) {
  const saved=card.editors.configuration.settings.notification_definitions?.methods?.[id];
  if(!saved)return "";
  const test=card.editors.deliveryMethodTest,showResult=test?.id===id&&test.signature===JSON.stringify(saved);
  if(JSON.stringify(saved)!==JSON.stringify(method))return '<p class="note">Save this delivery method before testing it.</p>';
  return `<div class="method-test">${button("test-method",card.editors.deliveryMethodBusy&&test?.id===id?"Sending test…":"Send test","methods",id,card.editors.deliveryMethodBusy?"disabled":"")}<p class="small">Sends only to this method’s saved destinations, using current presence when configured.</p>${showResult&&card.editors.deliveryMethodError?`<p class="error" role="alert">${esc(card.editors.deliveryMethodError)}</p>`:""}${showResult&&card.editors.deliveryMethodNotice?`<p role="status">${esc(card.editors.deliveryMethodNotice)}</p>`:""}</div>`;
}

export async function testDeliveryMethod(card,id) {
  const editors=card.editors,hass=card._hass;
  const draft=editors.settingsDraft.notification_definitions?.methods?.[id],saved=editors.configuration.settings.notification_definitions?.methods?.[id];
  if(!saved||editors.scopedBusy||editors.deliveryMethodBusy||editors.settingsBusy||editors.configBusy||JSON.stringify(draft)!==JSON.stringify(saved))return;
  const revision=editors.configuration.revision,signature=JSON.stringify(saved);
  const current=()=>card.editors===editors;
  editors.deliveryMethodTest={id,signature};
  editors.deliveryMethodBusy=true;editors.deliveryMethodError=null;editors.deliveryMethodNotice=null;card.render();
  try {
    const preview=await hass.callWS({type:"homeostatic/preview_delivery_method",method_id:id,revision});
    if(!current())return;
    if(editors.configuration.revision!==revision||JSON.stringify(editors.settingsDraft.notification_definitions?.methods?.[id])!==signature)throw Error("Settings changed. Save this method before testing it.");
    if(preview.targets.some(target=>target.available===false))throw Error("A configured destination is unavailable. Update this method before testing it.");
    if(!preview.targets.length&&!preview.skipped)throw Error("No destination is available for this method.");
    const result=await hass.callWS({type:"homeostatic/test_delivery_method",method_id:id,revision,preview_token:preview.preview_token});
    if(!current())return;
    const targetName=channel=>{const target=preview.targets.find(item=>item.channel===channel);return target?.destination_name||target?.name||"Configured destination";};
    const requested=(result.requested||[]).map(targetName),failures=result.failed||[];
    editors.deliveryMethodNotice=result.skipped?"The test was skipped because no recipient qualified under the saved presence rules.":`${requested.length?`Test requested for ${requested.join(", ")}. This confirms the request, not receipt.`:"No test requests succeeded."}${failures.length?` Failed requests: ${failures.map(item=>`${targetName(item.channel)}: ${item.error}`).join("; ")}.`:""}`;
  }catch(error){if(current())editors.deliveryMethodError=error.message||String(error);}
  finally{if(current()){editors.deliveryMethodBusy=false;card.render();}}
}

function deletePrompt(card) {
  const request=card.editors.definitionDelete;
  if(!request)return "";
  const {kind,id}=request,isPolicy=kind==="policies",isProfile=kind==="profiles";
  const item=isPolicy?card.editors.settingsDraft.monitoring_policies.find(policy=>policy.id===id)||card.editors.configuration.settings.monitoring_policies?.find(policy=>policy.id===id):card.editors.configuration.settings.notification_definitions?.[kind]?.[id]||card.editors.settingsDraft.notification_definitions[kind]?.[id];
  if(!item)return "";
  const uses=isPolicy?[]:definitionUses(card.editors.configuration.settings,kind,id);
  const definitions=card.editors.configuration.settings.notification_definitions?.[kind]||{};
  const replacements=isProfile?notificationChoices(definitions):Object.entries(definitions);
  const noun=isProfile?"notification":"delivery method";
  const removal=isProfile?"Remove this notification from affected policies":"Remove this method from affected notifications";
  return `<section class="settings-preview" role="region" aria-label="Confirm deletion"><h3>Delete ${esc(item.name)}?</h3>${isPolicy?'<p>Deleting this policy ends its monitoring and pending requests. Other policies keep monitoring their selections.</p>':uses.length?`<p>Used by ${uses.map(esc).join(", ")}. Choose a replacement or explicitly remove these assignments.${isProfile?" Policies with no remaining notification stay on the dashboard.":" Named notifications with no delivery method remain unconfigured."}</p><label class="installation-field"><span>Replace or remove assignments</span><select data-definition-delete-resolution>${option("","Choose an action",request.resolution)}${option("remove-rows",removal,request.resolution)}${replacements.filter(([other])=>other!==id).map(([other,value])=>option(other,`Replace with ${value.name}`,request.resolution)).join("")}</select></label>`:'<p>This definition has no assignments.</p>'}${button("confirm-delete",isPolicy?"Delete policy":uses.length?`Delete ${noun} and update its uses`:`Delete ${noun}`,kind,id,card.editors.scopedBusy||uses.length&&!request.resolution?"disabled":"")}${button("cancel-delete","Cancel",kind,id)}</section>`;
}

function notificationProfileFields(card,id,profile) {
  const kind="profiles",timing=profile.timing,zone=card.editors.settingsDraft.notification_definitions.timezone;
  let body=input(kind,id,"name","Name",profile.name,"text","required");
  body+=select(kind,id,"timing:mode","When to notify",timing.mode,{immediate:"Immediately",acknowledge:"Immediately, with acknowledgment",window:"During daily hours",report:"Scheduled summary"});
  if(timing.mode==="acknowledge")body+=input(kind,id,"timing:minutes","Remind every (minutes)",reminderMinutes(timing.remind_every),"number",'min="1" step="1" required')+'<p class="small">Reminders stop after the problem is acknowledged.</p>';
  else if(timing.mode==="window")body+=input(kind,id,"timing:start",`Start · ${zone}`,timing.start,"time","required")+input(kind,id,"timing:end",`End · ${zone}`,timing.end,"time","required")+'<p class="small">Notify during these hours every day. Outside them, hold the request until the next opening.</p>';
  else if(timing.mode==="report")body+=input(kind,id,"timing:at",`Summary time · ${zone}`,timing.at,"time","required")+`<fieldset class="policy-weekdays"><legend>Days</legend>${DAYS.map((day,index)=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"timing:weekdays")} data-definition-value="${index}"${checked(timing.weekdays.includes(index))}>${day}</label>`).join("")}</fieldset><p class="small">Includes open problems, even after acknowledgment. Empty summaries are skipped.</p>`;
  else body+='<p class="small">Notify when the problem becomes eligible, including overnight.</p>';
  if(timing.mode!=="report")body+=input(kind,id,"timing:collection_delay_seconds","Collection delay (seconds)",timing.collection_delay_seconds,"number",`min="0" step="1" required aria-describedby="collection-help-${esc(id)}"`)+`<p class="small" id="collection-help-${esc(id)}">Wait this long to combine requests using this notification. Later requests don’t extend the wait. 0 sends without waiting.</p>`;
  const methods=card.editors.configuration.settings.notification_definitions.methods||{};
  body+=`<fieldset><legend>Send using</legend>${Object.entries(methods).map(([methodId,method])=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(methodId)}"${checked(profile.methods.includes(methodId))}>${esc(method.name)}</label>`).join("")}${profile.methods.filter(method=>!methods[method]).map(method=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(method)}" checked>Unavailable delivery method — clear to remove</label>`).join("")}${profile.methods.length?"":`<p class="note">${Object.keys(methods).length?"No delivery method selected.":"Add a delivery method first."} This notification will not send until a method is assigned.</p>`}</fieldset>`;
  return body;
}

function notificationProfiles(card) {
  const items=card.editors.settingsDraft.notification_definitions.profiles||{},saved=card.editors.configuration.settings.notification_definitions?.profiles||{};
  const id=card.definitionSelection?.kind==="profiles"?card.definitionSelection.id:null,active=items[id];
  if(active) {
    const uses=definitionUses(card.editors.configuration.settings,"profiles",id);
    return `<section class="definition-editor installation-editor notification-profile-editor" aria-label="Edit notification"><header><h1>${saved[id]?`Edit notification: ${esc(active.name)}`:"New notification"}</h1>${button("close","Back to notifications","profiles",id,"","editor-back")}</header>${notificationProfileFields(card,id,active)}<p class="method-usage">${uses.length?`Changes apply to: ${uses.map(esc).join(", ")}.`:"No policies use this notification yet."}</p>${deletePrompt(card)}${scopedEditorFooter(card,{kind:"profile",id},"Save notification")}</section>`;
  }
  const list=notificationChoices(saved).map(([profileId,profile])=>{
    const uses=definitionUses(card.editors.configuration.settings,"profiles",profileId),menuId=`notification-actions-${profileId}`;
    return `<article class="definition-list-item"><div><h3>${esc(profile.name)}</h3><p>${esc(timingSummary(profile.timing))}</p><p class="small">${profile.methods.map(method=>esc(card.editors.configuration.settings.notification_definitions.methods[method]?.name||"Unavailable method")).join(", ")||"No delivery method selected"} · ${useCount(uses)}${scopedDirty(card.editors,{kind:"profile",id:profileId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit notification","profiles",profileId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(profile.name)}" title="More actions"${card.editors.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(profile.name)}">${button("duplicate","Duplicate","profiles",profileId)}${button("delete","Delete","profiles",profileId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([profileId])=>!saved[profileId]).map(([profileId,profile])=>`<p class="note">Unsaved notification: ${esc(profile.name)} ${button("edit","Continue editing","profiles",profileId)}</p>`).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head">${button("add","Add notification","profiles","","","primary")}</div><div class="definition-list">${list||'<p>No saved notifications yet.</p>'}</div>${unsaved}${deletePrompt(card)}${card.editors.scopedError?`<p class="config-error" role="alert">${esc(card.editors.scopedError)}</p>`:""}</section>`;
}

export function namedNotifications(card) {
  initializeScopedConfiguration(card.editors);
  const view=card.definitionSelection?.kind==="methods"?"methods":card.definitionSelection?.kind==="profiles"?"profiles":card.notificationSection==="methods"?"methods":"profiles";
  const selection=card.definitionSelection,editing=selection?.kind===view&&Boolean(card.editors.settingsDraft.notification_definitions[view]?.[selection.id]);
  const nav=editing?"":`<nav class="installation-nav" aria-label="Notifications views">${button("notification-view","Notifications","profiles","",`aria-current="${view==="profiles"?"page":"false"}"`)}${button("notification-view","Delivery methods","methods","",`aria-current="${view==="methods"?"page":"false"}"`)}</nav>`;
  if(view==="profiles")return nav+notificationProfiles(card);
  const definitions=card.editors.settingsDraft.notification_definitions;
  const kind="methods",items=definitions.methods;
  const active=card.definitionSelection?.kind===kind?items[card.definitionSelection.id]:null,id=active?card.definitionSelection.id:null;
  const saved=card.editors.configuration.settings.notification_definitions?.methods||{};
  const list=Object.entries(saved).map(([itemId,item])=>{
    const menuId=`method-actions-${itemId}`,uses=definitionUses(card.editors.configuration.settings,kind,itemId),summary=methodSummary(card,item);
    return `<article class="definition-list-item"><div><h3>${esc(item.name)}</h3>${summary?`<p class="method-summary">${esc(summary)}</p>`:""}<p class="small">${useCount(uses)}${scopedDirty(card.editors,{kind:"method",id:itemId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit delivery method",kind,itemId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(item.name)}" title="More actions"${card.editors.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(item.name)}">${button("duplicate","Duplicate",kind,itemId)}${button("delete","Delete",kind,itemId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([itemId])=>!saved[itemId]).map(([itemId,item])=>`<p class="note">Unsaved delivery method: ${esc(item.name)} ${button("edit","Continue editing",kind,itemId)}</p>`).join("");
  const uses=active?definitionUses(card.editors.configuration.settings,kind,id):[];
  const editor=active?`<section class="definition-editor installation-editor delivery-method-editor" aria-label="Edit delivery method"><header><h1>${saved[id]?`Edit delivery method: ${esc(active.name)}`:"New delivery method"}</h1>${button("close-method","Back to delivery methods",kind,id,"","editor-back")}</header>${methodFields(card,id,active,false)}<p class="method-usage">${uses.length?`Used by ${uses.map(esc).join(", ")}.`:"No notifications use this method yet."}</p>${methodTest(card,id,active)}${scopedEditorFooter(card,{kind:"method",id},"Save delivery method")}</section>`:`<div class="policy-check-head">${button("add","Add delivery method",kind,"","","primary")}</div><div class="definition-list method-list">${list||'<p>No saved delivery methods yet.</p>'}</div>${unsaved}`;
  return `${nav}<section class="reusable-definitions notification-methods">${editor}${deletePrompt(card)}${!active&&card.editors.scopedError?`<p class="config-error" role="alert">${esc(card.editors.scopedError)}</p>`:""}</section>`;
}


/** Restore destination selection after a dashboard render. */
export function restoreMethodDialogs(card) {
  for(const input of card.main.querySelectorAll?.("[data-indeterminate]")||[])input.indeterminate=true;
  for(const dialog of card.main.querySelectorAll?.("dialog.delivery-picker")||[]) {
    dialog.showModal();
    dialog.oncancel=event=>{
      event.preventDefault();
      const picker=card.editors.deliveryPicker;
      card.editors.deliveryPicker=null;
      card.render();
      if(picker)focusDestinationPicker(card,picker.id,picker.field);
    };
  }
}

function invalidate(card) {
  card.editors.policyValidation=null;
  card.editors.settingsError=null;
  card.editors.scopedError=null;card.editors.scopedNotice=null;
  card.editors.deliveryMethodTest=null;
}

const keyboardSelects=new WeakSet();

/** Remember how a native editor picker was opened without platform detection. */
export function trackEditorSelectInput(event) {
  const element=event.target;
  if(element?.tagName!=="SELECT")return;
  if(event.type==="keydown")keyboardSelects.add(element);
  else if(event.type==="pointerdown")keyboardSelects.delete(element);
}

function renderAfterEdit(card,element) {
  const dataset={...element.dataset},start=element.selectionStart,end=element.selectionEnd;
  const restoreFocus=element.tagName!=="SELECT"||keyboardSelects.has(element);
  if(element.tagName==="SELECT")element.blur();
  delete dataset.indeterminate;
  card.render();
  const replacement=[...(card.main?.querySelectorAll?.("[data-definition-field],[data-row-field],[data-definition-delivery-search],[data-definition-template],[data-definition-category]")||[])].find(item=>Object.entries(dataset).every(([key,value])=>item.dataset[key]===value));
  if(restoreFocus)(replacement||(dataset.definitionField?.startsWith("entity-")?card.main?.querySelector?.('[data-definition-field="entity-selected-only"]'):dataset.definitionField?.startsWith("source-")?card.main?.querySelector?.('[data-definition-field="source-selected-only"]'):null))?.focus?.({preventScroll:true});
  if(start!==null&&start!==undefined)replacement?.setSelectionRange?.(start,end);
}

async function saveEditor(card,scope) {
  const selection=card.definitionSelection,page=card.page;
  const saved=await saveScopedConfiguration(card,scope);
  if(!saved||card.current?.status!=="current"||page!=="notifications"||card.page!==page||card.definitionSelection!==selection||
    !["method","profile"].includes(scope.kind)||scopedDirty(card.editors,scope))return;
  const kind=scope.kind==="method"?"methods":"profiles",definition=card.editors.configuration.settings.notification_definitions?.[kind]?.[scope.id];
  if(!definition)return;
  const previous=card.navigation?.capture();
  card.notificationSection=kind;card.definitionSelection=null;card.editors.deliveryPicker=null;
  card.editors.scopedNotice=null;card.render();card.navigation?.finish(previous);
  const edit=[...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionKind===kind&&element.dataset.definitionId===scope.id);
  edit?.scrollIntoView?.({block:"nearest"});edit?.focus?.({preventScroll:true});
}

export function editReusable(card,event) {
  const element=event.type==="click"?event.target.closest?.("[data-definition-action]"):event.target;
  if(!element)return false;
  const d=element.dataset||{};
  if(!card.editors.settingsDraft) {
    if(d.definitionAction!=="open-policy")return false;
    card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection=d.definitionId?{kind:"policies",id:d.definitionId}:null;card.page="policies";
    void card.loadConfiguration();return true;
  }
  initializeScopedConfiguration(card.editors);
  const draft=card.editors.settingsDraft;
  if(!Object.keys(d).some(key=>key.startsWith("definition")||key.startsWith("row")))return false;
  // Native pickers must commit before the editor replaces their controls.
  if(event.type==="input"&&(element.tagName==="SELECT"||element.type==="radio"))return true;
  if(element.type==="radio"&&!element.checked)return true;
  const restoreSelectFocus=element.tagName!=="SELECT"||keyboardSelects.has(element);
  if(card.editors.settingsBusy||card.editors.configBusy)return true;
  const policies=draft.monitoring_policies||[];
  let definitions=draft.notification_definitions;
  const kind=d.definitionKind,id=d.definitionId,action=d.definitionAction;
  let notificationFocus;
  if(editDestinationPicker(card,event,element,invalidate,renderAfterEdit))return true;
  if(editEntitySelection(card,event,element,invalidate,renderAfterEdit))return true;
  if(editSourceSelection(card,event,element,invalidate,renderAfterEdit))return true;
  if(event.type==="click") {
    if(action==="save-scoped"||action==="discard-scoped") {
      const scope={kind:{policies:"policy",methods:"method",profiles:"profile",settings:"settings"}[kind],...(id?{id}:{})};
      if(card.editors.scopedBusy)return true;
      if(action==="save-scoped") {
        const policy=scope.kind==="policy"?policies.find(item=>item.id===id):null;
        const validation=policy?.check==="left_open"?leftOpenValidation(policy):policy?.check==="temperature_limit"?temperatureValidation(policy):policy?.check?.startsWith("host_")?hostValidation(policy):policy&&hasAvailabilityWait(policy)?durationValidation(availabilityDuration(policy)):null;
        if(validation) {
          card.editors.policyValidation={id,...validation};card.editors.scopedStatusScope=`policy:${id}`;card.editors.scopedError=validation.message;card.editors.scopedNotice=null;card.render();
          card.main.querySelector?.(`[data-definition-field="parameters:${validation.field}"]`)?.focus?.();return true;
        }
        if([...(card.main.querySelectorAll?.(".installation-editor input, .installation-editor select")||[])].some(input=>!input.reportValidity()))return true;
        if(policy&&["area","label"].some(field=>Array.isArray(policy.match?.[field])&&!policy.match[field].length)) {
          card.editors.scopedStatusScope=`policy:${id}`;card.editors.scopedError="Choose at least one area or label, or change Future sources.";card.editors.scopedNotice=null;card.render();return true;
        }
        if(policy&&(policy.enabled||!REPORTED_CONDITIONS[policy.check]&&!policy.check.startsWith("host_"))&&!["entity","entity_not_provided"].includes(policyType(policy))&&Object.values(policy.match||{}).some(values=>Array.isArray(values)&&!values.length)) {
          card.editors.scopedStatusScope=`policy:${id}`;card.editors.scopedError="Choose at least one source, or change Future sources.";card.editors.scopedNotice=null;card.render();return true;
        }
        void saveEditor(card,scope);
      }
      else {
        const exists=scope.kind==="policy"?card.editors.configuration.settings.monitoring_policies?.some(policy=>policy.id===id):["method","profile"].includes(scope.kind)?Boolean(card.editors.configuration.settings.notification_definitions?.[scope.kind==="method"?"methods":"profiles"]?.[id]):true;
        discardScopedConfiguration(card.editors,scope);
        if(!exists)card.definitionSelection=null;
        card.editors.deliveryPicker=null;card.editors.policyValidation=null;card.render();
      }
      return true;
    }
    if(action==="notification-view") {card.notificationSection=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="policy-actions"||action==="contextual-help") {
      const menu=element.popoverTargetElement;
      menu.ontoggle=event=>{
        if(event.newState!=="open")return;
        window.requestAnimationFrame(()=>{
          if(!menu.matches(":popover-open"))return;
          const viewport=window.visualViewport,top=viewport?.offsetTop||0,left=viewport?.offsetLeft||0;
          const height=viewport?.height||window.innerHeight,width=viewport?.width||window.innerWidth;
          menu.style.maxHeight=`${Math.max(0,height-16)}px`;
          const rect=element.getBoundingClientRect(),size=menu.getBoundingClientRect();
          const below=rect.bottom+4,preferred=below+size.height<=top+height-8?below:rect.top-size.height-4;
          menu.style.top=`${Math.max(top+8,Math.min(preferred,top+height-size.height-8))}px`;
          const preferredLeft=action==="contextual-help"?rect.left:rect.right-size.width;
          menu.style.left=`${Math.max(left+8,Math.min(preferredLeft,left+width-size.width-8))}px`;
          menu.style.right="auto";
        });
      };
      menu.onkeydown=event=>{
        if(event.key!=="Escape")return;
        event.preventDefault();menu.hidePopover();element.focus();
      };
      return true;
    }
    if(action==="load-delivery"){void card.loadDeliveryConfiguration?.(true);return true;}
    if(action==="close-method") {
      card.notificationSection="methods";card.definitionSelection=null;card.editors.deliveryPicker=null;card.render();
      [...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionId===id)?.focus({preventScroll:true});return true;
    }
    if(action==="test-method"){void testDeliveryMethod(card,id);return true;}
    if(action==="tab"){card.notificationSection=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="edit"){if(["methods","profiles"].includes(kind))card.notificationSection=kind;card.definitionSelection={kind,id};card.editors.deliveryPicker=null;card.editors.deliveryMethodError=null;card.editors.deliveryMethodNotice=null;card.render();if(kind==="methods"){card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]')?.focus({preventScroll:true});void card.loadDeliveryConfiguration?.(true);}return true;}
    if(action==="open-policy"){card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection=id?{kind:"policies",id}:null;card.page="policies";card.render();return true;}
    if(action==="open-notification"){card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection={kind:"profiles",id};card.notificationSection="profiles";card.editors.deliveryPicker=null;card.page="notifications";card.render();return true;}
    if(action==="close"){card.definitionSelection=null;card.editors.policyCreating=false;card.render();return true;}
    if(action==="add"&&kind==="policies"){card.editors.policyCreating=true;card.definitionSelection=null;card.render();return true;}
    if(action==="restore"){card.editors.policyRestoring=true;card.editors.policyRestoreIds=[];card.render();return true;}
    if(action==="cancel-restore"){card.editors.policyRestoring=false;card.render();return true;}
    if(action==="delete"){
      card.editors.definitionDelete={kind,id,resolution:"",before:kind==="policies"?structuredClone(policies.find(item=>item.id===id)):null};card.render();
      const prompt=card.main.querySelector('[aria-label="Confirm deletion"]');
      prompt?.scrollIntoView({block:"center"});
      prompt?.querySelector('[data-definition-action="cancel-delete"]')?.focus({preventScroll:true});
      return true;
    }
    if(action==="cancel-delete"){
      card.editors.definitionDelete=null;card.render();
      const edit=[...card.main.querySelectorAll('[data-definition-action="edit"]')].find(item=>item.dataset.definitionKind===kind&&item.dataset.definitionId===id);
      edit?.scrollIntoView({block:"center"});edit?.focus({preventScroll:true});
      return true;
    }
    if(action==="add"||action==="create"||action==="duplicate") {
      if(kind==="policies") {
        draft.monitoring_policies??=[];
        const original=policies.find(item=>item.id===id);
        const policy=action==="duplicate"?{...structuredClone(original),id:nextDefinitionId(policies,"policy"),name:`${original.name} copy`,enabled:false}:newMonitoringPolicy(policies,card.editors.definitionTemplate||"entity",definitions.profiles,card.editors.definitionCategory||"any");
        card.editors.policyCreating=false;
        draft.monitoring_policies.push(policy);card.definitionSelection={kind,id:policy.id};
      }else {
        definitions[kind]??={};
        const newId=nextDefinitionId(definitions[kind],kind==="profiles"?"notification":"method");
        const original=definitions[kind][id];
        definitions[kind][newId]=action==="duplicate"?{...structuredClone(original),name:`${original.name} copy`}:kind==="profiles"?{name:"New notification",timing:{mode:"immediate",collection_delay_seconds:0},methods:[]}:{name:"New delivery method",mode:"fixed",destinations:[]};
        card.definitionSelection={kind,id:newId};
        void card.loadDeliveryConfiguration?.(true);
      }

    }else if(action==="confirm-restore") {
      for(const template of card.editors.configuration.monitoring_policy_templates||[])if(card.editors.policyRestoreIds.includes(template.id)&&!policies.some(policy=>policy.id===template.id)) {
        const restored=structuredClone(template);
        restored.notifications=restored.notifications.filter(row=>!row.profile||card.editors.configuration.settings.notification_definitions?.profiles?.[row.profile]);
        policies.push(restored);
      }
      card.editors.policyRestoring=false;card.editors.policyRestoreIds=[];
    }else if(action==="confirm-delete") {
      if(card.editors.scopedBusy)return true;
      const scope={kind:kind==="policies"?"policy":kind==="profiles"?"profile":"method",id},resolution=card.editors.definitionDelete?.resolution;
      const saved=kind==="policies"?card.editors.configuration.settings.monitoring_policies?.some(policy=>policy.id===id):card.editors.configuration.settings.notification_definitions?.[kind]?.[id];
      if(!saved) {
        discardScopedConfiguration(card.editors,scope);card.editors.definitionDelete=null;card.definitionSelection=null;card.render();return true;
      }
      if(kind==="policies")draft.monitoring_policies=policies.filter(item=>item.id!==id);
      const value=kind==="policies"?undefined:{delete:true,...(resolution==="remove-rows"?{removeReferences:true}:resolution?{replacement:resolution}:{})};
      void saveScopedConfiguration(card,scope,value).then(success=>{if(success){card.editors.definitionDelete=null;card.definitionSelection=null;}card.render();});
      return true;
    }else if(action==="remove-row") {
      const rows=rowsFor(card,d.rowScope),index=rows.findIndex(row=>row.id===id);
      if(index>=0)rows.splice(index,1);
      notificationFocus={scope:d.rowScope,id:(rows[index]||rows[index-1])?.id||""};
    }else if(action==="add-sms") {
      const target=[...card.main.querySelectorAll("[data-sms-method]")].find(item=>item.dataset.smsMethod===id&&item.dataset.smsField===d.smsField&&item.dataset.smsService===d.smsService);
      if(!/^\+?[0-9]{5,15}$/.test(target?.value||"")){card.editors.settingsError="Enter an SMS recipient with 5–15 digits, optionally starting with +.";card.render();return true;}
      const method=editableMethod(card,id),field=d.smsField;
      const owner=field.startsWith("person_destinations:")?(method.person_destinations??={}):method,key=field.startsWith("person_destinations:")?field.slice(20):field;
      owner[key]=[...new Set([...(owner[key]||[]),d.smsService+encodeURIComponent(target.value)])];
    }else return false;
  }else {
    if(d.definitionRestore!==undefined){card.editors.policyRestoreIds=element.checked?[...card.editors.policyRestoreIds,d.definitionRestore]:card.editors.policyRestoreIds.filter(value=>value!==d.definitionRestore);card.render();return true;}
    if(d.definitionTemplate!==undefined){card.editors.definitionTemplate=element.value;renderAfterEdit(card,element);return true;}
    if(d.definitionCategory!==undefined){card.editors.definitionCategory=element.value;return true;}
    if(d.definitionDeleteResolution!==undefined){card.editors.definitionDelete.resolution=element.value;card.render();return true;}
    if(d.rowScope) {
      const rows=rowsFor(card,d.rowScope),index=rows?.findIndex(item=>item.id===d.rowId),row=rows?.[index];
      if(d.rowField==="profile") {
        if(element.value) {
          if(!card.editors.configuration.settings.notification_definitions?.profiles?.[element.value])return true;
          const reserve=d.rowScope.startsWith("policy:")&&policies.find(item=>item.id===d.rowScope.slice(7))?.check==="ups_reserve";
          const when=row?.when||(reserve?(rows.some(item=>item.when==="mains")?"backup":"mains"):null);
          const value={id:row?.id||nextRowId(draft),profile:element.value,...(when?{when}:{})};
          if(index>=0)rows[index]=value;
          else {rows.push(value);element.value="";notificationFocus={scope:d.rowScope,id:value.id};}
        }else if(row?.profile){rows.splice(index,1);notificationFocus={scope:d.rowScope,id:(rows[index]||rows[index-1])?.id||""};}
      }else if(row&&d.rowField==="when")row.when=element.value;
      else return false;
    }else if(d.definitionField) {
      const item=kind==="policies"?policies.find(policy=>policy.id===id):kind==="profiles"?definitions.profiles[id]:editableMethod(card,id),field=d.definitionField;
      if(kind==="profiles"&&field.startsWith("timing:")) {
        const key=field.slice(7);
        if(key==="mode") {
          const collection_delay_seconds=item.timing.collection_delay_seconds??0;
          item.timing=element.value==="report"?{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]}:element.value==="acknowledge"?{mode:"acknowledge",remind_every:1800,collection_delay_seconds}:element.value==="window"?{mode:"window",start:"08:00",end:"22:00",collection_delay_seconds}:{mode:"immediate",collection_delay_seconds};
        }
        else if(key==="minutes")item.timing.remind_every=Number(element.value)*60;
        else if(key==="collection_delay_seconds")item.timing.collection_delay_seconds=element.value.trim()===""?"":Number.isFinite(Number(element.value))?Number(element.value):element.value;
        else if(key==="weekdays")item.timing.weekdays=element.checked?[...new Set([...item.timing.weekdays,Number(d.definitionValue)])].sort():item.timing.weekdays.filter(day=>day!==Number(d.definitionValue));
        else item.timing[key]=element.value;
      }else if(kind==="profiles"&&field==="methods") {
        item.methods=element.checked?[...new Set([...item.methods,d.definitionValue])]:item.methods.filter(value=>value!==d.definitionValue);
      }else if(d.destination||d.person||d.weekday!==undefined) {
        const owner=field.startsWith("person_destinations:")?(item.person_destinations??={}):item,key=field.startsWith("person_destinations:")?field.slice(20):field;
        const value=d.destination||d.person||Number(d.weekday);
        owner[key]=element.checked?[...new Set([...(owner[key]||[]),value])]:(owner[key]||[]).filter(existing=>existing!==value);
        if(d.person&&item.mode==="home_people") {
          item.person_destinations??={};
          if(element.checked)item.person_destinations[value]??=[];else delete item.person_destinations[value];
        }
      }else if(kind==="policies"&&field.startsWith("duration-unit:")) {
        const durationKey=field.slice("duration-unit:".length);
        if(Object.hasOwn(DURATION_UNITS,element.value)) {
          card.editors.policyDurationUnits??={};card.editors.policyDurationUnits[`${id}:${durationKey}`]=element.value;
          renderAfterEdit(card,element);
        }
        return true;
      }else if(field.startsWith("parameters:")) {
        const key=field.slice(11);
        if(item.check==="left_open"&&key==="monitoring_hours") {
          item.parameters.start=element.value==="daily"?item.parameters.start||"22:00":null;
          item.parameters.end=element.value==="daily"?item.parameters.end||"07:00":null;
          invalidate(card);renderAfterEdit(card,element);return true;
        }
        if(key==="unit"&&item.parameters.unit!==element.value) {
          const from=item.parameters.unit,to=element.value,difference=item.check==="thermostat";
          const keys=difference?["margin","progress","worsening"]:["minimum","maximum"];
          for(const threshold of keys)if(typeof item.parameters[threshold]==="number") {
            const value=item.parameters[threshold];
            const celsius=from==="°F"?(value-(difference?0:32))*5/9:from==="K"&&!difference?value-273.15:value;
            item.parameters[threshold]=to==="°F"?celsius*9/5+(difference?0:32):to==="K"&&!difference?celsius+273.15:celsius;
          }
        }
        if(["duration_seconds","recovery_seconds"].includes(key)&&Object.hasOwn(DURATION_UNITS,d.durationUnit)) {
          card.editors.policyDurationUnits??={};card.editors.policyDurationUnits[`${id}:${key}`]=d.durationUnit;
        }
        if(element.type==="checkbox")item.parameters[key]=element.checked;
        else if(element.value==="") {
          if(key==="duration_seconds"&&hasAvailabilityWait(item))item.parameters[key]=null;
          else delete item.parameters[key];
        }
        else if(["duration_seconds","recovery_seconds"].includes(key)&&Object.hasOwn(DURATION_UNITS,d.durationUnit)) {
          const seconds=Number(element.value)*DURATION_UNITS[d.durationUnit],nearest=Math.round(seconds);
          const exact=d.durationUnit!=="seconds"&&seconds>=0&&seconds<=31536000&&nearest>0&&Math.abs(seconds-nearest)<=Number.EPSILON*Math.max(1,Math.abs(seconds))*4;
          item.parameters[key]=exact?nearest:seconds;
        }else item.parameters[key]=element.type==="number"?Number(element.value):element.value;
      }else if(field==="check") {
        return true;
      }else if(field==="mode") {
        item.mode=element.value;
        const name=item.name;
        for(const key of Object.keys(item))delete item[key];
        Object.assign(item,{name,mode:element.value});
        if(item.mode==="fixed")item.destinations=[];
        else {item.people=[];item.fallback=[];item.skip=false;if(item.mode==="home_away"){item.home=[];item.away=[];}else item.person_destinations={};}
      }else {
        item[field]=element.type==="checkbox"?element.checked:element.type==="number"?Number(element.value):element.value;
        if(kind==="methods"&&field==="skip"&&element.checked)item.fallback=[];
      }
    }else return false;
  }
  invalidate(card);
  const editingDetection=event.type!=="click"&&kind==="policies"&&element.type==="number"&&policies.find(item=>item.id===id&&(["temperature_limit","left_open"].includes(item.check)||item.check.startsWith("host_")||hasAvailabilityWait(item)&&d.definitionField==="parameters:duration_seconds"));
  const editingCollection=event.type!=="click"&&kind==="profiles"&&d.definitionField==="timing:collection_delay_seconds";
  if(editingDetection||editingCollection) {
    // Keep native intermediate input such as a leading minus or trailing decimal.
    if(editingDetection) {
      const rule=card.main?.querySelector?.(".policy-rule");
      if(rule)rule.textContent=editingDetection.check==="left_open"?`${leftOpenSummary(editingDetection)} ${leftOpenEndText(editingDetection)}`:editingDetection.check==="temperature_limit"?temperatureRule(editingDetection):availabilityRule(editingDetection);
      card.main?.querySelector?.(".policy-section .config-error")?.remove?.();
      for(const field of card.main?.querySelectorAll?.('.unified-policy-editor [aria-invalid="true"]')||[]) {
        field.removeAttribute("aria-invalid");field.removeAttribute("aria-describedby");
      }
    }
    const footer=card.main?.querySelector?.("[data-scoped-editor]");
    if(footer) {
      const template=document.createElement("template");
      template.innerHTML=scopedEditorFooter(card,{kind:editingCollection?"profile":"policy",id},editingCollection?"Save notification":"Save policy");
      if(!footer.isEqualNode(template.content.firstElementChild))footer.replaceWith(template.content);
    }
    card.renderedContent=null;
    return true;
  }
  renderAfterEdit(card,element);
  if(notificationFocus&&restoreSelectFocus) {
    const target=[...(card.main?.querySelectorAll?.('[data-row-field="profile"]')||[])].find(item=>item.dataset.rowScope===notificationFocus.scope&&item.dataset.rowId===notificationFocus.id);
    const focus=target?.disabled?card.main?.querySelector?.('[data-definition-action="save-scoped"]'):target;
    focus?.focus?.({preventScroll:true});
  }
  if(event.type==="click"&&kind==="methods"&&["add","duplicate"].includes(action)) {
    card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});
    const name=card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]');
    name?.focus({preventScroll:true});name?.select?.();
  }
  return true;
}
