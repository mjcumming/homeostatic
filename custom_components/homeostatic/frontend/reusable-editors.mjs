import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=74";
import {destinationChoices,editDestinationPicker,focusDestinationPicker} from "./delivery-picker.mjs?v=74";
import {initializeScopedConfiguration,scopedDirty,saveScopedConfiguration,discardScopedConfiguration} from "./scoped-configuration.mjs?v=74";

export const POLICY_CHECKS = {
  availability: "HA availability", battery: "Battery condition", vacuum: "Vacuum error",
  repair: "Repairs", broken_automation: "Broken automations", thermostat: "Thermostat progress",
  temperature_limit: "Temperature limits",
  ups_power:"UPS backup power", ups_reserve:"UPS low reserve", ups_battery_replacement:"UPS battery replacement", ups_fault:"UPS faults",
};
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
  initializeScopedConfiguration(card);
  const key=scope.id?`${scope.kind}:${scope.id}`:scope.kind,status=card.scopedStatusScope===key;
  const feedback=`${status&&card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}${status&&card.scopedNotice?`<p role="status">${esc(card.scopedNotice)}</p>`:""}`;
  const kind={policy:"policies",method:"methods",profile:"profiles",settings:"settings"}[scope.kind],disabled=card.scopedBusy?"disabled":"";
  const actions=scopedDirty(card,scope)?`<footer class="installation-actions"><span class="small">Unsaved changes</span><div class="actions">${button("discard-scoped","Discard changes",kind,scope.id||"",disabled)}${button("save-scoped",card.scopedBusy===key?"Saving…":label,kind,scope.id||"",disabled,"primary")}</div></footer>`:"";
  return `<div data-scoped-editor="${esc(key)}" data-scope-kind="${esc(scope.kind)}" data-scope-id="${esc(scope.id||"")}" data-save-label="${esc(label)}">${feedback}${actions}</div>`;
}

function editableMethod(card,id) {
  return card.settingsDraft.notification_definitions.methods[id];
}
function policyScopeSummary(card,policy) {
  const mode=watchMode(policy);
  if(mode==="all")return watchChoices(policy).all;
  const field=mode==="selected"?sourceField(policy):mode,choices=policySelectionChoices(card,policy,mode);
  const values=mode==="all_except"?policy.excluded_sources||[]:policy.match[field]||[];
  const names=values.map(id=>choices.find(item=>item.id===id)?.name||(mode==="all_except"?"Unavailable excluded source":"Unavailable selection"));
  if(mode==="all_except")return names.length?`All ${sourceNoun(policy)} except: ${names.join(", ")}`:`All ${sourceNoun(policy)}; no exclusions`;
  const summary=names.length?`${mode==="selected"?"Selected "+sourceNoun(policy):mode==="area"?"Areas":"Labels"}: ${names.join(", ")}`:"No sources selected";
  return `${summary}${policy.excluded_sources?.length?`; ${policy.excluded_sources.length} excluded`:""}`;
}
function policyDetectionSummary(policy) {
  const p=policy.parameters||{};
  if(policy.check==="battery")return `Battery at or below ${p.threshold??20}%`;
  if(policy.check==="temperature_limit")return [p.minimum!==undefined?`Below ${p.minimum}${p.unit}`:"",p.maximum!==undefined?`Above ${p.maximum}${p.unit}`:"",p.duration_seconds?`for ${p.duration_seconds} seconds`:""].filter(Boolean).join(" · ")||"Temperature bounds need configuration";
  if(policy.check==="thermostat")return `${p.margin}${p.unit} deviation · ${p.progress_seconds/60} minute progress window`;
  return {availability:"Reported Home Assistant availability",repair:"Reported Home Assistant Repairs",broken_automation:"References to missing entities",vacuum:"Reported vacuum error",ups_power:"UPS running on backup power",ups_reserve:"Reported low reserve warning and configured thresholds",ups_battery_replacement:"Reported battery replacement warning",ups_fault:"Reported UPS fault"}[policy.check]||POLICY_CHECKS[policy.check];
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
  if(timing.mode==="report")return `${timing.at} · ${(timing.weekdays||[]).map(day=>DAYS[day].slice(0,3)).join(", ")}`;
  if(timing.mode==="acknowledge")return `Immediately; remind every ${reminderMinutes(timing.remind_every)} minutes until acknowledged`;
  if(timing.mode==="window")return `${timing.start}–${timing.end} daily; hold outside these hours`;
  return "Immediately";
}
function notificationSummary(definitions,row) {
  const entry=rowDefinition(definitions,row);
  if(!entry)return "Unavailable notification";
  const methods=(entry.methods||[]).map(id=>definitions.methods?.[id]?.name||"Unavailable method").join(", ");
  return `${row.profile?entry.name:"Custom notification"} · ${timingSummary(entry.timing)} → ${methods||"No delivery method selected"}`;
}
function savedNotificationSummary(card,policy) {
  if(!policy.notifications?.length)return "Dashboard only";
  return policy.notifications.map(row=>notificationSummary(card.configuration.settings.notification_definitions,row)).join("; ");
}

export function nextDefinitionId(existing,prefix) {
  const ids = new Set(Array.isArray(existing) ? existing.map(item=>item.id) : Object.keys(existing));
  let number = 1;
  while(ids.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

export const MONITORING_TYPES = {
  integration: "Integration availability", device: "Device availability", entity: "Entity availability",
  battery: "Low battery", vacuum: "Vacuum error", repair: "Repairs", broken_automation: "Broken automations",
  thermostat: "Thermostat progress", temperature_limit: "Temperature limits",
  ups_power: "UPS backup power", ups_reserve: "UPS low reserve", ups_battery_replacement: "UPS battery replacement", ups_fault: "UPS faults",
};
export function policyType(policy) {
  return policy.check === "availability" ? policy.match?.kind?.[0]||"device" : policy.check;
}
export function newMonitoringPolicy(existing,type="device",profiles=null) {
  if(type==="availability")type="device";
  const check=["integration","device","entity"].includes(type)?"availability":type;
  const parameters = check === "thermostat" ? {unit:"°F",margin:2,progress:2,worsening:2,progress_seconds:3600}
    : check === "temperature_limit" ? {unit:"°F",duration_seconds:0} : check === "battery" ? {threshold:20} : {};
  const kind = check.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(check)?"entity":type;
  const choices=check==="ups_reserve"?[["morning","mains"],["acknowledge","backup"]]:[[{thermostat:"urgent",temperature_limit:"acknowledge",vacuum:"evening",ups_power:"urgent",ups_fault:"urgent"}[check]||"morning"]];
  const notifications=choices.filter(([profile])=>profiles?.[profile]).map(([profile,when],index)=>({id:`notification-${index+1}`,profile,...(when?{when}:{})}));
  return {id:nextDefinitionId(existing,"policy"),name:MONITORING_TYPES[type],check,match:{kind:[kind]},parameters,enabled:false,notifications};
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
  if(scope.startsWith("policy:"))return card.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.notifications;
  return card.settingsDraft.notification_definitions?.[scope];
}

export function applicablePolicyLinks(card,source) {
  const detail=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  const policies=detail?.monitoring_policies||source?.monitoring_policies||[];
  return policies.length?`<section class="source-section"><h3>Monitoring policies</h3>${policies.map(policy=>button("open-policy",`Edit policy: ${policy.name}`,"policies",policy.id)).join("")}</section>`:"";
}

function nextPolicySummary(card,row,scope) {
  const policyId=scope.slice(7),saved=card.configuration.settings;
  const policy=card.settingsDraft.monitoring_policies.find(item=>item.id===policyId);
  const savedPolicy=saved.monitoring_policies?.find(item=>item.id===policyId);
  const savedRow=savedPolicy?.notifications.find(item=>item.id===row.id);
  const zone=card.settingsDraft.notification_definitions.timezone;
  if(!savedRow||row.profile!==savedRow.profile||!equal(rowDefinition(card.settingsDraft.notification_definitions,row)?.timing,rowDefinition(saved.notification_definitions,savedRow)?.timing)||zone!==saved.notification_definitions.timezone)return "Next summary time is available after saving this schedule.";
  if(policy?.enabled!==savedPolicy.enabled)return "Summary scheduling changes after you save this policy.";
  const report=card.current?.data?.policy?.reports?.find(item=>item.name===`entry:policy_${policyId}_${row.id}`);
  const next=report?.next_at?new Date(report.next_at):null;
  if(!policy?.enabled||!savedPolicy.enabled||!next||!Number.isFinite(next.getTime()))return "No summary is currently scheduled for this policy.";
  return `Next summary: ${new Intl.DateTimeFormat(undefined,{timeZone:zone,dateStyle:"medium",timeStyle:"short"}).format(next)} · ${zone}.`;
}

export function notificationRowsEditor(card,rows,scope) {
  const definitions=card.settingsDraft.notification_definitions,profiles=card.configuration.settings.notification_definitions?.profiles||{};
  const reserve=card.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.check==="ups_reserve";
  const choice=(row,index)=> {
    const attr=field=>`data-row-scope="${esc(scope)}" data-row-id="${esc(row?.id||"")}" data-row-field="${field}"`;
    const current=row?.profile||"";
    const options=Object.entries(profiles).map(([id,profile])=>option(id,profile.name,current)).join("");
    const entry=row&&rowDefinition(definitions,row);
    return `<div class="definition-notification-row">${reserve&&row?`<label>When reserve is low<select ${attr("when")}>${[["mains","Mains power confirmed"],["backup","Backup power confirmed"]].map(([id,name])=>option(id,name,row.when||"mains")).join("")}</select></label>`:""}<label class="installation-field"><span>${rows.length>1?`Notification ${index+1}`:"Notification"}</span><select ${attr("profile")}>${option("",row&&!row.profile?"Custom notification — keep current settings":"Dashboard only",current)}${row?.profile&&!profiles[row.profile]?option(row.profile,"Unavailable notification",current):""}${options}</select></label>${row?`<p class="small">${esc(notificationSummary(definitions,row))}</p>${entry?.timing?.mode==="report"?`<p class="small">${esc(nextPolicySummary(card,row,scope))}</p>`:""}${rows.length>1||!row.profile?button("remove-row","Remove notification","",row.id,`data-row-scope="${esc(scope)}"`):""}`:""}</div>`;
  };
  return `${rows.length?rows.map(choice).join(""):choice(null,0)}${rows.length?button("add-row","Add another notification","","",`data-row-scope="${esc(scope)}"${Object.keys(profiles).length?"":" disabled"}`):""}<p class="small">Manage named notifications and their delivery methods in Notifications.</p>`;
}

function methodSummary(card,method) {
  if(method.mode!=="fixed")return METHOD_MODES[method.mode];
  return (method.destinations||[]).map(channel=>card.configuration.delivery_targets?.find(target=>target.channel===channel)).map(target=>target?.destination_name||target?.name).filter(Boolean).join(", ")||METHOD_MODES[method.mode];
}


function sourceNoun(policy) {
  const type=policyType(policy);
  return {integration:"integrations",device:"devices",entity:"entities",battery:"batteries",vacuum:"vacuums",thermostat:"thermostats",temperature_limit:"temperature sensors"}[type]||(type.startsWith("ups_")?"UPS devices":"sources");
}
function sourceKind(policy) {
  const type=policyType(policy);
  return policy.match?.kind?.[0]||(type.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(type)?"entity":type);
}
export function watchChoices(policy) {
  const type=policyType(policy),noun=sourceNoun(policy);
  if(["repair","broken_automation"].includes(type))return {all:type==="repair"?"All Repairs":"All automations"};
  return {all:`All ${noun}`,all_except:"All except these…",selected:`Selected ${noun}…`,...(type==="integration"?{}:{area:`${noun[0].toUpperCase()+noun.slice(1)} in areas…`,label:`${noun[0].toUpperCase()+noun.slice(1)} with labels…`})};
}
function sourceField(policy) {
  return {integration:"integration_domain",device:"device",ups:"device"}[sourceKind(policy)]||"entity";
}
export function watchMode(policy) {
  return policy.match.area?"area":policy.match.label?"label":policy.match[sourceField(policy)]||policy.match.integration?"selected":Object.hasOwn(policy,"excluded_sources")?"all_except":"all";
}
export function policySelectionChoices(card,policy,mode) {
  if(mode==="area"||mode==="label")return (card.configuration[mode==="area"?"areas":"labels"]||[]).map(item=>({...item,group:mode==="area"?(card.configuration.floors||[]).find(floor=>floor.id===item.floor_id)?.name||"Other areas":"Labels"}));
  const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
  if(mode==="all_except") {
    const kind=sourceKind(policy);
    return [...new Map(inventory.filter(source=>source.kind===kind||kind==="device"&&source.kind==="entity"&&source.attributes?.device?.length).filter(source=>(policy.check!=="thermostat"||source.attributes?.domain?.includes("climate"))&&(policy.check!=="temperature_limit"||source.attributes?.device_class?.includes("temperature"))).map(source=>{
      const id=source.monitoring_source||source.node_id;
      return [id,{id,name:source.name,...(source.entity_id?{entity_id:source.entity_id}:{}),group:kind==="device"?(source.kind==="device"?"Whole devices":"Individual device entities"):kind==="integration"?"Integration connections":"Sources"}];
    })).values()];
  }
  if(policyType(policy)==="integration") {
    const domains=[...new Set(inventory.filter(source=>source.kind==="integration").flatMap(source=>source.attributes?.integration_domain||source.attributes?.domain||[]))];
    return domains.map(id=>({id,name:card._hass?.localize?.(`component.${id}.title`)||({mobile_app:"Mobile App",esphome:"ESPHome",nut:"Network UPS Tools (NUT)"})[id]||id.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()),group:"Integrations"}));
  }
  const field=sourceField(policy),noun=sourceNoun(policy),group=noun[0].toUpperCase()+noun.slice(1);
  return [...new Map(inventory.filter(source=>source.kind===sourceKind(policy)&&(policy.check!=="thermostat"||source.attributes?.domain?.includes("climate"))&&(policy.check!=="temperature_limit"||source.attributes?.device_class?.includes("temperature"))).map(source=>{
    const id=source.attributes?.[field]?.[0];
    return [id,{id,name:source.name,...(source.entity_id?{entity_id:source.entity_id}:{}),group}];
  }).filter(([id])=>id)).values()];
}
function watchEditor(card,policy) {
  if(policy.check==="repair")return '<p>Watches all Home Assistant Repairs.</p>';
  if(policy.check==="broken_automation")return '<p>Checks all automations for references to entities that no longer exist.</p>';
  const mode=watchMode(policy),choices=watchChoices(policy),field=mode==="selected"?sourceField(policy):mode,excluding=mode==="all_except";
  const noun=mode==="area"?"areas":mode==="label"?"labels":excluding&&sourceKind(policy)==="device"?"devices or entities":excluding&&sourceKind(policy)==="integration"?"integration connections":sourceNoun(policy);
  const data=card.current?.data,sourceChoices=["selected","all_except"].includes(mode);
  const catalogPending=sourceChoices&&data?.schema_version===3&&!data.catalog_loaded;
  const catalogStale=sourceChoices&&data?.catalog_stale;
  const catalogStatus=catalogPending||catalogStale?`<p class="note" role="status">${card.current.catalogError?`Could not ${catalogPending?"load":"update"} available sources: ${esc(card.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry loading sources</button>`:catalogPending?"Loading available sources…":"Updating available sources. You can keep using the previous complete list until the update finishes."}</p>`:"";
  const values=excluding?policy.excluded_sources||[]:policy.match[field]||[],items=catalogPending?[]:policySelectionChoices(card,policy,mode);
  const names=values.map(id=>items.find(item=>item.id===id)?.name||(catalogPending?excluding?"Saved exclusion":"Saved selection":excluding?"Unavailable excluded source":"Unavailable selection"));
  const oldConnections=policyType(policy)==="integration"&&policy.match.integration;
  const picker=card.policyPicker?.id===policy.id?card.policyPicker:null;
  const filtered=picker?items.filter(item=>(!picker.selectedOnly||values.includes(item.id))&&[item.name,item.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(picker.query.trim().toLocaleLowerCase())):[];
  const groups=[...new Set(filtered.map(item=>item.group))];
  const verb=excluding?"excluded":"selected",choose=excluding?`Exclude ${noun}`:`Choose ${noun}`;
  const description=excluding?`Includes current and future ${sourceNoun(policy)}, except the sources chosen here. Exclusions apply only to this policy.`:mode==="selected"?policyType(policy)==="integration"?"Includes all current and future connections for each selected integration.":`Only the selected ${sourceNoun(policy)} are included.`:`Includes current and future matching ${sourceNoun(policy)} in any selected ${mode==="area"?"area":"label"}.`;
  const excludedChoices=!excluding&&policy.excluded_sources?.length?policySelectionChoices(card,policy,"all_except"):[];
  const additionalExclusions=!excluding&&policy.excluded_sources?.length?`<p class="small">This scope also excludes: ${policy.excluded_sources.map(id=>esc(excludedChoices.find(item=>item.id===id)?.name||"Unavailable excluded source")).join(", ")}. Saved exclusions remain in effect.</p>`:"";
  const availabilityNote=policy.check==="availability"&&["entity","device"].includes(sourceKind(policy))?'<p class="small">Diagnostic and configuration entities are excluded unless individually selected. Disabled sources are not monitored.</p>':"";
  return `${select("policies",policy.id,"watch","Watch",mode,choices)}${catalogStatus}${mode!=="all"?`<div class="policy-selection"><p>${oldConnections?"Saved individual connections. Choose integrations to replace this selection.":names.length?esc(names.slice(0,2).join(", "))+(names.length>2?` +${names.length-2} more`:""):excluding?"No exclusions":"Nothing selected"}</p>${button("pick",choose,"policies",policy.id)}${picker?`<section class="policy-picker" aria-label="${choose}">${excluding?'<p>Check sources to exclude them from this policy.</p>':""}<label class="installation-field"><span>Search ${noun}</span><input type="search" data-definition-picker-search value="${esc(picker.query)}"></label><label class="installation-toggle"><input type="checkbox" data-definition-picker-selected${checked(picker.selectedOnly)}>Show ${verb} only</label><p role="status">${values.length} ${verb}</p><div class="policy-picker-options">${groups.map(group=>`<fieldset><legend>${esc(group)}</legend>${filtered.filter(item=>item.group===group).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>`<label class="installation-toggle"><input type="checkbox" ${attrs("policies",policy.id,"selection")} data-definition-value="${esc(item.id)}"${checked(values.includes(item.id))}>${esc(item.name)}</label>`).join("")}</fieldset>`).join("")||(catalogPending?"":'<p>No matching choices.</p>')}${values.filter(id=>!catalogPending&&!items.some(item=>item.id===id)).map(id=>`<label class="installation-toggle"><input type="checkbox" ${attrs("policies",policy.id,"selection")} data-definition-value="${esc(id)}" checked>${excluding?"Unavailable excluded source — clear to include if it returns":"Unavailable selection — clear to remove"}</label>`).join("")}</div>${button("finish-pick","Done","policies",policy.id)}</section>`:""}<p class="small">${description}</p></div>`:`<p class="small">Includes current and future ${sourceNoun(policy)}.</p>`}${additionalExclusions}${availabilityNote}`;
}

function policyFields(card,policy) {
  const {id,check,parameters}=policy;
  const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
  let parameterFields='<p class="sub">Uses the reported Home Assistant state and configured timing.</p>';
  if(check==="battery")parameterFields=input("policies",id,"parameters:threshold","Battery level at or below (%)",parameters.threshold??20,"number",'min="0" max="100" step="1" required');
  if(check==="ups_reserve") {
    const selected=inventory.filter(source=>source.kind==="ups"&&!policy.excluded_sources?.includes(source.monitoring_source||source.node_id)&&Object.entries(policy.match||{}).every(([field,values])=>values.some(value=>source.attributes?.[field]?.includes(value))));
    const hasRole=role=>selected.some(source=>(source.ups_entities||[]).some(([key])=>key===role));
    const fields=[...(hasRole("charge")||parameters.charge_low!==undefined?[["charge_low","Raise at or below (%)"],["charge_clear","Clear at or above (%)"]]:[]),...(hasRole("runtime")||parameters.runtime_low_minutes!==undefined?[["runtime_low_minutes","Raise at or below (minutes)"],["runtime_clear_minutes","Clear at or above (minutes)"]]:[])];
    parameterFields=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'min="0" step="any"')).join("")+`<p class="small">Optional numeric thresholds supplement the UPS warning. Set both raise and clear values for each measurement. Without a custom threshold, a reported device low setpoint is used when readable.</p><p class="small">Charging alone does not clear low reserve.</p>`;
  }
  if(check==="thermostat"||check==="temperature_limit") {
    parameterFields=select("policies",id,"parameters:unit","Temperature unit",parameters.unit,{"°F":"°F","°C":"°C"});
    const fields=check==="thermostat"?[["margin","Deviation from target"],["progress","Required progress"],["worsening","Worsening threshold"],["progress_seconds","Progress window (seconds)"]]:[["minimum","Minimum (optional)"],["maximum","Maximum (optional)"],["duration_seconds","Must persist for (seconds)"]];
    parameterFields+=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",`step="any" ${["minimum","maximum"].includes(field)?"":'min="0" required'}`)).join("");
    parameterFields+=`<p class="small">${check==="thermostat"?"Deviation and progress are differences in the selected unit. Heating and cooling are evaluated separately.":"Choose a minimum, a maximum, or both. Qualification restarts when evidence no longer satisfies the limit."}</p>`;
  }
  return `${input("policies",id,"name","Name",policy.name,"text","required")}<div class="policy-type"><span>Monitoring type</span><strong>${esc(MONITORING_TYPES[policyType(policy)])}</strong></div>${watchEditor(card,policy)}${["repair","broken_automation"].includes(check)?"":`<h3>When it becomes a problem</h3>${parameterFields}`}<h3>Notifications</h3>${notificationRowsEditor(card,policy.notifications,`policy:${id}`)}<label class="installation-toggle"><input type="checkbox" ${attrs("policies",id,"enabled")}${checked(policy.enabled)}>Enabled</label>`;
}

export function namedPolicies(card) {
  initializeScopedConfiguration(card);
  const policies=card.settingsDraft?.monitoring_policies||[];
  const active=policies.find(item=>card.definitionSelection?.kind==="policies"&&item.id===card.definitionSelection.id);
  const templates=card.configuration.monitoring_policy_templates||[];
  const missing=templates.filter(template=>!policies.some(policy=>policy.id===template.id));
  if(card.policyCreating)return `<section class="definition-editor installation-editor"><h2>Add policy</h2><p>Choose the monitoring type. It stays fixed after creation.</p><label class="installation-field"><span>Monitoring type</span><select data-definition-template>${Object.entries(MONITORING_TYPES).map(([id,name])=>option(id,name,card.definitionTemplate||"device")).join("")}</select></label>${button("create","Continue","policies")}${button("close","Cancel","policies")}</section>`;
  if(active) {
    return `<section class="definition-editor installation-editor unified-policy-editor" aria-label="Edit monitoring policy"><header><h2>Edit policy: ${esc(active.name)}</h2>${button("close","Back to policies","policies",active.id)}</header>${policyFields(card,active)}${deletePrompt(card)}${scopedEditorFooter(card,{kind:"policy",id:active.id},"Save policy")}</section>`;
  }
  const list=policies.map(draft=>{
    const saved=card.configuration.settings.monitoring_policies?.find(item=>item.id===draft.id),policy=saved||draft;
    const state=saved?(saved.enabled?"On":"Off"):"Not saved";
    const pending=scopedDirty(card,{kind:"policy",id:policy.id});
    const menuId=`policy-actions-${policy.id}`;
    return `<article class="definition-list-item"><div><h3>${esc(policy.name)} <span class="small">${state}</span></h3><p class="small">${esc(MONITORING_TYPES[policyType(policy)])} · ${esc(policyScopeSummary(card,policy))}</p><p class="small">${esc(policyDetectionSummary(policy))}</p><p class="small">${esc(savedNotificationSummary(card,policy))}</p>${pending?`<p class="source-setting-pending" role="status">Unsaved changes · continue editing to apply</p>`:""}</div><div class="actions">${button("edit","Edit policy","policies",policy.id)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(policy.name)}" title="More actions"${card.settingsBusy||card.configBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(policy.name)}">${button("duplicate","Duplicate","policies",policy.id)}${button("delete","Delete","policies",policy.id)}</div></div></article>`;
  }).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><h2>Monitoring policies</h2><div class="actions">${button("restore","Restore defaults","policies","",missing.length?"":"disabled")}${button("add","Add policy","policies")}</div></div>${card.policyRestoring?`<section class="policy-picker" aria-label="Restore default policies"><h3>Restore defaults</h3><p>Choose deleted policies to restore, then edit and save each restored policy.</p>${missing.map(policy=>`<label class="installation-toggle"><input type="checkbox" data-definition-restore="${esc(policy.id)}"${checked(card.policyRestoreIds?.includes(policy.id))}>${esc(policy.name)}</label>`).join("")}${button("confirm-restore","Restore selected","policies","",card.policyRestoreIds?.length?"":"disabled")}${button("cancel-restore","Cancel","policies")}</section>`:""}<div class="definition-list">${list||'<p>No policies. Add a policy or restore defaults to start monitoring.</p>'}</div>${deletePrompt(card)}${card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}</section>`;
}

function methodFields(card,id,method,allowTest=true) {
  const people=card.configuration.notification_people||[];
  const personId=person=>person.entity_id||person.id;
  let body='<p class="small">Timing and reminders are set in the named notifications that use this method.</p>'+input("methods",id,"name","Name",method.name,"text","required");
  if(!card.configuration.delivery_targets)return body+`<p role="status">${esc(card.deliveryError||"Loading notification destinations…")}</p>${card.deliveryError?button("load-delivery","Retry loading destinations","methods",id):""}`;
  if(method.mode==="fixed")body+=destinationChoices(card,method,id,"destinations","Send to");
  body+=`<details class="method-presence" data-ui-key="method-presence-${esc(id)}"${method.mode!=="fixed"?" open":""}><summary>Change destinations based on who’s home <span class="small">Optional</span></summary>${select("methods",id,"mode","Presence selection",method.mode,METHOD_MODES)}`;
  if(method.mode!=="fixed") {
    body+=`<fieldset><legend>People whose presence is checked</legend>${people.map(person=>`<label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"people")} data-person="${esc(personId(person))}"${checked((method.people||[]).includes(personId(person)))}>${esc(person.name||personId(person))}</label>`).join("")||'<p>No Home Assistant people are configured.</p>'}</fieldset>`;
    if(method.mode==="home_away")body+=destinationChoices(card,method,id,"home","When someone is home")+destinationChoices(card,method,id,"away","When everyone is away");
    else body+=(method.people||[]).map(person=>destinationChoices(card,method,id,`person_destinations:${person}`,people.find(item=>personId(item)===person)?.name||person)).join("");
    body+=`<h3>No qualifying recipient or unknown presence</h3><label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"skip")}${checked(method.skip)}>Skip this request</label>${method.skip?'<p class="small">No request is sent when presence cannot select a recipient.</p>':destinationChoices(card,method,id,"fallback","Fallback destinations")}<p class="small">Presence is checked when sending. Unknown presence uses the fallback or skips the request.</p>`;
  }
  return body+'</details>'+(allowTest?methodTest(card,id,method):'');
}

function methodTest(card,id,method) {
  const saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(JSON.stringify(saved)!==JSON.stringify(method))return '<p class="note">Save this delivery method before testing it.</p>';
  return `<div class="method-test">${button("test-method",card.deliveryMethodBusy?"Sending test…":"Send test","methods",id,card.deliveryMethodBusy?"disabled":"")}<p class="small">Sends only to this method’s saved destinations, using current presence when configured.</p>${card.deliveryMethodError?`<p class="error" role="alert">${esc(card.deliveryMethodError)}</p>`:""}${card.deliveryMethodNotice?`<p role="status">${esc(card.deliveryMethodNotice)}</p>`:""}</div>`;
}

export async function testDeliveryMethod(card,id) {
  const current=card.settingsDraft.notification_definitions?.methods?.[id],saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(!saved||card.scopedBusy||card.deliveryMethodBusy||card.settingsBusy||card.configBusy||JSON.stringify(current)!==JSON.stringify(saved))return;
  const revision=card.configuration.revision,signature=JSON.stringify(saved);
  card.deliveryMethodBusy=true;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();
  try {
    const preview=await card._hass.callWS({type:"homeostatic/preview_delivery_method",method_id:id,revision});
    if(card.configuration.revision!==revision||JSON.stringify(card.settingsDraft.notification_definitions?.methods?.[id])!==signature)throw Error("Settings changed. Save this method before testing it.");
    if(preview.targets.some(target=>target.available===false))throw Error("A configured destination is unavailable. Update this method before testing it.");
    if(!preview.targets.length&&!preview.skipped)throw Error("No destination is available for this method.");
    const result=await card._hass.callWS({type:"homeostatic/test_delivery_method",method_id:id,revision,preview_token:preview.preview_token});
    const targetName=channel=>{const target=preview.targets.find(item=>item.channel===channel);return target?.destination_name||target?.name||"Configured destination";};
    const requested=(result.requested||[]).map(targetName),failures=result.failed||[];
    card.deliveryMethodNotice=result.skipped?"The test was skipped because no recipient qualified under the saved presence rules.":`${requested.length?`Test requested for ${requested.join(", ")}. This confirms the request, not receipt.`:"No test requests succeeded."}${failures.length?` Failed requests: ${failures.map(item=>`${targetName(item.channel)}: ${item.error}`).join("; ")}.`:""}`;
  }catch(error){card.deliveryMethodError=error.message||String(error);}
  finally{card.deliveryMethodReview=null;card.deliveryMethodBusy=false;card.render();}
}

function deletePrompt(card) {
  const request=card.definitionDelete;
  if(!request)return "";
  const {kind,id}=request,isPolicy=kind==="policies",isProfile=kind==="profiles";
  const item=isPolicy?card.settingsDraft.monitoring_policies.find(policy=>policy.id===id)||card.configuration.settings.monitoring_policies?.find(policy=>policy.id===id):card.configuration.settings.notification_definitions?.[kind]?.[id]||card.settingsDraft.notification_definitions[kind]?.[id];
  if(!item)return "";
  const uses=isPolicy?[]:definitionUses(card.configuration.settings,kind,id);
  const noun=isProfile?"notification":"delivery method";
  const removal=isProfile?"Remove this notification from affected policies":"Remove this method from affected notifications";
  return `<section class="settings-preview" role="region" aria-label="Confirm deletion"><h3>Delete ${esc(item.name)}?</h3>${isPolicy?'<p>Deleting this policy ends its monitoring and pending requests. Other policies keep monitoring their selections.</p>':uses.length?`<p>Used by ${uses.map(esc).join(", ")}. Choose a replacement or explicitly remove these assignments.${isProfile?" Policies with no remaining notification stay on the dashboard.":" Named notifications with no delivery method remain unconfigured."}</p><label class="installation-field"><span>Replace or remove assignments</span><select data-definition-delete-resolution>${option("","Choose an action",request.resolution)}${option("remove-rows",removal,request.resolution)}${Object.entries(card.configuration.settings.notification_definitions?.[kind]||{}).filter(([other])=>other!==id).map(([other,value])=>option(other,`Replace with ${value.name}`,request.resolution)).join("")}</select></label>`:'<p>This definition has no assignments.</p>'}${button("confirm-delete",isPolicy?"Delete policy":uses.length?`Delete ${noun} and update its uses`:`Delete ${noun}`,kind,id,card.scopedBusy||uses.length&&!request.resolution?"disabled":"")}${button("cancel-delete","Cancel",kind,id)}</section>`;
}

function notificationProfileFields(card,id,profile) {
  const kind="profiles",timing=profile.timing,zone=card.settingsDraft.notification_definitions.timezone;
  let body=input(kind,id,"name","Name",profile.name,"text","required");
  body+=select(kind,id,"timing:mode","When to notify",timing.mode,{immediate:"Immediately",acknowledge:"Immediately, with acknowledgment",window:"During daily hours",report:"Scheduled summary"});
  if(timing.mode==="acknowledge")body+=input(kind,id,"timing:minutes","Remind every (minutes)",reminderMinutes(timing.remind_every),"number",'min="1" step="1" required')+'<p class="small">Reminders stop after the problem is acknowledged.</p>';
  else if(timing.mode==="window")body+=input(kind,id,"timing:start",`Start · ${zone}`,timing.start,"time","required")+input(kind,id,"timing:end",`End · ${zone}`,timing.end,"time","required")+'<p class="small">Notify during these hours every day. Outside them, hold the request until the next opening.</p>';
  else if(timing.mode==="report")body+=input(kind,id,"timing:at",`Summary time · ${zone}`,timing.at,"time","required")+`<fieldset class="policy-weekdays"><legend>Days</legend>${DAYS.map((day,index)=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"timing:weekdays")} data-definition-value="${index}"${checked(timing.weekdays.includes(index))}>${day}</label>`).join("")}</fieldset><p class="small">Includes open problems, even after acknowledgment. Empty summaries are skipped.</p>`;
  else body+='<p class="small">Notify when the problem begins, including overnight.</p>';
  const methods=card.configuration.settings.notification_definitions.methods||{};
  body+=`<fieldset><legend>Send using</legend>${Object.entries(methods).map(([methodId,method])=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(methodId)}"${checked(profile.methods.includes(methodId))}>${esc(method.name)}</label>`).join("")||'<p>No saved delivery methods yet. Add one in Delivery methods.</p>'}${profile.methods.filter(method=>!methods[method]).map(method=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(method)}" checked>Unavailable delivery method — clear to remove</label>`).join("")}</fieldset>${profile.methods.length?"":'<p class="note">No delivery method selected. This notification will not send until a method is assigned.</p>'}`;
  return body;
}

function notificationProfiles(card) {
  const items=card.settingsDraft.notification_definitions.profiles||{},saved=card.configuration.settings.notification_definitions?.profiles||{};
  const id=card.definitionSelection?.kind==="profiles"?card.definitionSelection.id:null,active=items[id];
  if(active) {
    const uses=definitionUses(card.configuration.settings,"profiles",id);
    return `<section class="definition-editor installation-editor notification-profile-editor" aria-label="Edit notification"><header><h2>${saved[id]?"Edit notification":"New notification"}: ${esc(active.name)}</h2></header>${notificationProfileFields(card,id,active)}<p class="method-usage">${uses.length?`Changes apply to: ${uses.map(esc).join(", ")}.`:"No policies use this notification yet."}</p>${deletePrompt(card)}${scopedEditorFooter(card,{kind:"profile",id},"Save notification")}</section>`;
  }
  const list=Object.entries(saved).map(([profileId,profile])=>{
    const uses=definitionUses(card.configuration.settings,"profiles",profileId),menuId=`notification-actions-${profileId}`;
    return `<article class="definition-list-item"><div><h3>${esc(profile.name)}</h3><p>${esc(timingSummary(profile.timing))}</p><p class="small">${profile.methods.map(method=>esc(card.configuration.settings.notification_definitions.methods[method]?.name||"Unavailable method")).join(", ")||"No delivery method selected"}${uses.length?` · Used by ${uses.map(esc).join(", ")}`:""}${scopedDirty(card,{kind:"profile",id:profileId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit notification","profiles",profileId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(profile.name)}" title="More actions"${card.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(profile.name)}">${button("duplicate","Duplicate","profiles",profileId)}${button("delete","Delete","profiles",profileId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([profileId])=>!saved[profileId]).map(([profileId,profile])=>`<p class="note">Unsaved notification: ${esc(profile.name)} ${button("edit","Continue editing","profiles",profileId)}</p>`).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><div><p class="sub">Choose when to notify and which delivery methods to use. Policies select these named notifications.</p></div>${button("add","Add notification","profiles","","","primary")}</div><div class="definition-list">${list||'<p>No saved notifications yet.</p>'}</div>${unsaved}${deletePrompt(card)}${card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}</section>`;
}

export function namedNotifications(card) {
  initializeScopedConfiguration(card);
  const view=card.definitionSelection?.kind==="methods"?"methods":card.definitionSelection?.kind==="profiles"?"profiles":card.notificationSection==="methods"?"methods":"profiles";
  const nav=`<nav class="installation-nav" aria-label="Notifications views">${button("notification-view","Notifications","profiles","",`aria-current="${view==="profiles"?"page":"false"}"`)}${button("notification-view","Delivery methods","methods","",`aria-current="${view==="methods"?"page":"false"}"`)}</nav>`;
  if(view==="profiles")return nav+notificationProfiles(card);
  const definitions=card.settingsDraft.notification_definitions;
  const kind="methods",items=definitions.methods;
  const active=card.definitionSelection?.kind===kind?items[card.definitionSelection.id]:null,id=active?card.definitionSelection.id:null;
  const saved=card.configuration.settings.notification_definitions?.methods||{};
  const list=Object.entries(saved).map(([itemId,item])=>{
    const menuId=`method-actions-${itemId}`,uses=definitionUses(card.configuration.settings,kind,itemId);
    return `<article class="definition-list-item"><div><h3>${esc(item.name)}</h3><p class="method-summary">${esc(methodSummary(card,item))}</p><p class="small">${uses.length?`Used by ${uses.map(esc).join(", ")}`:"No notifications use this method yet"}${scopedDirty(card,{kind:"method",id:itemId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit delivery method",kind,itemId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(item.name)}" title="More actions"${card.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(item.name)}">${button("duplicate","Duplicate",kind,itemId)}${button("delete","Delete",kind,itemId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([itemId])=>!saved[itemId]).map(([itemId,item])=>`<p class="note">Unsaved delivery method: ${esc(item.name)} ${button("edit","Continue editing",kind,itemId)}</p>`).join("");
  const uses=active?definitionUses(card.configuration.settings,kind,id):[];
  const editor=active?`<div class="method-breadcrumb">${button("close-method","‹ Delivery methods",kind,id)}</div><section class="definition-editor installation-editor delivery-method-editor" aria-label="Edit delivery method"><header><h2>${saved[id]?"Edit delivery method":"New delivery method"}: ${esc(active.name)}</h2><p class="sub">Choose the destinations this method sends to.</p></header>${methodFields(card,id,active,false)}<p class="method-usage">${uses.length?`Used by ${uses.map(esc).join(", ")}.`:"No notifications use this method yet."}</p>${methodTest(card,id,active)}${scopedEditorFooter(card,{kind:"method",id},"Save delivery method")}</section>`:`<div class="policy-check-head"><div><h2>Delivery methods</h2><p class="sub">Choose where notifications go. Choose timing and reminders in Notifications.</p></div>${button("add","Add delivery method",kind,"","","primary")}</div><div class="definition-list method-list">${list||'<p>No saved delivery methods yet. Add a method to choose where notifications go.</p>'}</div>${unsaved}`;
  return `${nav}<section class="reusable-definitions notification-methods">${editor}${deletePrompt(card)}${!active&&card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}</section>`;
}


/** Restore destination selection after a dashboard render. */
export function restoreMethodDialogs(card) {
  for(const dialog of card.main.querySelectorAll?.("dialog.delivery-picker")||[]) {
    dialog.showModal();
    dialog.oncancel=event=>{
      event.preventDefault();
      const picker=card.deliveryPicker;
      card.deliveryPicker=null;
      card.render();
      if(picker)focusDestinationPicker(card,picker.id,picker.field);
    };
  }
}

function invalidate(card) {
  card.settingsError=null;
  card.scopedError=null;card.scopedNotice=null;
}

function renderAfterEdit(card,element) {
  const dataset={...element.dataset},start=element.selectionStart,end=element.selectionEnd;
  card.render();
  const replacement=[...(card.main?.querySelectorAll?.("[data-definition-field],[data-row-field],[data-definition-picker-search],[data-definition-picker-selected],[data-definition-delivery-search]")||[])].find(item=>Object.entries(dataset).every(([key,value])=>item.dataset[key]===value));
  replacement?.focus?.({preventScroll:true});
  if(start!==null&&start!==undefined)replacement?.setSelectionRange?.(start,end);
}

export function editReusable(card,event) {
  const element=event.type==="click"?event.target.closest?.("[data-definition-action]"):event.target;
  if(!element)return false;
  const d=element.dataset||{};
  if(!card.settingsDraft) {
    if(d.definitionAction!=="open-policy")return false;
    card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection=d.definitionId?{kind:"policies",id:d.definitionId}:null;card.page="policies";
    void card.loadConfiguration();return true;
  }
  initializeScopedConfiguration(card);
  const draft=card.settingsDraft;
  if(!Object.keys(d).some(key=>key.startsWith("definition")||key.startsWith("row")))return false;
  if(card.settingsBusy||card.configBusy)return true;
  const policies=draft.monitoring_policies||[];
  let definitions=draft.notification_definitions;
  const kind=d.definitionKind,id=d.definitionId,action=d.definitionAction;
  if(editDestinationPicker(card,event,element,invalidate,renderAfterEdit))return true;
  if(event.type==="click") {
    if(action==="save-scoped"||action==="discard-scoped") {
      const scope={kind:{policies:"policy",methods:"method",profiles:"profile",settings:"settings"}[kind],...(id?{id}:{})};
      if(card.scopedBusy)return true;
      if(action==="save-scoped") {
        if([...(card.main.querySelectorAll?.(".installation-editor input, .installation-editor select")||[])].some(input=>!input.reportValidity()))return true;
        const policy=scope.kind==="policy"?policies.find(item=>item.id===id):null;
        if(policy&&Object.values(policy.match||{}).some(values=>Array.isArray(values)&&!values.length)) {
          card.scopedStatusScope=`policy:${id}`;card.scopedError="Choose at least one source, area, or label, or choose All.";card.scopedNotice=null;card.render();return true;
        }
        void saveScopedConfiguration(card,scope);
      }
      else {
        const exists=scope.kind==="policy"?card.configuration.settings.monitoring_policies?.some(policy=>policy.id===id):["method","profile"].includes(scope.kind)?Boolean(card.configuration.settings.notification_definitions?.[scope.kind==="method"?"methods":"profiles"]?.[id]):true;
        discardScopedConfiguration(card,scope);
        if(!exists)card.definitionSelection=null;
        card.deliveryPicker=null;card.render();
      }
      return true;
    }
    if(action==="notification-view") {card.notificationSection=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="policy-actions") {
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
          menu.style.left=`${Math.max(left+8,Math.min(rect.right-size.width,left+width-size.width-8))}px`;
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
      card.notificationSection="methods";card.definitionSelection=null;card.deliveryPicker=null;card.methodCancel=null;card.render();
      [...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionId===id)?.focus({preventScroll:true});return true;
    }
    if(action==="test-method"){void testDeliveryMethod(card,id);return true;}
    if(action==="tab"){card.notificationSection=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="edit"){if(["methods","profiles"].includes(kind))card.notificationSection=kind;card.definitionSelection={kind,id};card.deliveryPicker=null;card.methodCancel=null;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();if(kind==="methods"){card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]')?.focus({preventScroll:true});void card.loadDeliveryConfiguration?.(true);}return true;}
    if(action==="open-policy"){card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection=id?{kind:"policies",id}:null;card.page="policies";card.render();return true;}
    if(action==="close"){card.definitionSelection=null;card.policyCreating=false;card.policyPicker=null;card.render();return true;}
    if(action==="add"&&kind==="policies"){card.policyCreating=true;card.definitionSelection=null;card.render();return true;}
    if(action==="pick"){const policy=policies.find(item=>item.id===id);if(policyType(policy)==="integration"&&policy.match.integration){policy.match={kind:["integration"],integration_domain:[]};}card.policyPicker={id,query:"",selectedOnly:false};card.render();return true;}
    if(action==="finish-pick"){card.policyPicker=null;card.render();return true;}
    if(action==="restore"){card.policyRestoring=true;card.policyRestoreIds=[];card.render();return true;}
    if(action==="cancel-restore"){card.policyRestoring=false;card.render();return true;}
    if(action==="delete"){card.definitionDelete={kind,id,resolution:"",before:kind==="policies"?structuredClone(policies.find(item=>item.id===id)):null};card.render();return true;}
    if(action==="cancel-delete"){card.definitionDelete=null;card.render();return true;}
    if(action==="add"||action==="create"||action==="duplicate") {
      if(kind==="policies") {
        draft.monitoring_policies??=[];
        const original=policies.find(item=>item.id===id);
        const policy=action==="duplicate"?{...structuredClone(original),id:nextDefinitionId(policies,"policy"),name:`${original.name} copy`,enabled:false}:newMonitoringPolicy(policies,card.definitionTemplate||"device",definitions.profiles);
        card.policyCreating=false;
        draft.monitoring_policies.push(policy);card.definitionSelection={kind,id:policy.id};
      }else {
        definitions[kind]??={};
        const newId=nextDefinitionId(definitions[kind],kind==="profiles"?"notification":"method");
        const original=definitions[kind][id];
        definitions[kind][newId]=action==="duplicate"?{...structuredClone(original),name:`${original.name} copy`}:kind==="profiles"?{name:"New notification",timing:{mode:"immediate"},methods:[]}:{name:"New delivery method",mode:"fixed",destinations:[]};
        card.definitionSelection={kind,id:newId};
        void card.loadDeliveryConfiguration?.(true);
      }

    }else if(action==="confirm-restore") {
      for(const template of card.configuration.monitoring_policy_templates||[])if(card.policyRestoreIds.includes(template.id)&&!policies.some(policy=>policy.id===template.id)) {
        const restored=structuredClone(template);
        restored.notifications=restored.notifications.filter(row=>!row.profile||card.configuration.settings.notification_definitions?.profiles?.[row.profile]);
        policies.push(restored);
      }
      card.policyRestoring=false;card.policyRestoreIds=[];
    }else if(action==="confirm-delete") {
      if(card.scopedBusy)return true;
      const scope={kind:kind==="policies"?"policy":kind==="profiles"?"profile":"method",id},resolution=card.definitionDelete?.resolution;
      const saved=kind==="policies"?card.configuration.settings.monitoring_policies?.some(policy=>policy.id===id):card.configuration.settings.notification_definitions?.[kind]?.[id];
      if(!saved) {
        discardScopedConfiguration(card,scope);card.definitionDelete=null;card.definitionSelection=null;card.render();return true;
      }
      if(kind==="policies")draft.monitoring_policies=policies.filter(item=>item.id!==id);
      const value=kind==="policies"?undefined:{delete:true,...(resolution==="remove-rows"?{removeReferences:true}:resolution?{replacement:resolution}:{})};
      void saveScopedConfiguration(card,scope,value).then(success=>{if(success){card.definitionDelete=null;card.definitionSelection=null;}card.render();});
      return true;
    }else if(action==="add-row") {
      const rows=rowsFor(card,d.rowScope);
      const reserve=d.rowScope.startsWith("policy:")&&policies.find(item=>item.id===d.rowScope.slice(7))?.check==="ups_reserve";
      const profile=Object.keys(card.configuration.settings.notification_definitions?.profiles||{})[0];
      if(profile)rows.push({id:nextRowId(draft),profile,...(reserve?{when:rows.some(row=>row.when==="mains")?"backup":"mains"}:{})});
    }else if(action==="remove-row") {
      const rows=rowsFor(card,d.rowScope),index=rows.findIndex(row=>row.id===id);
      if(index>=0)rows.splice(index,1);
    }else if(action==="add-sms") {
      const target=[...card.main.querySelectorAll("[data-sms-method]")].find(item=>item.dataset.smsMethod===id&&item.dataset.smsField===d.smsField&&item.dataset.smsService===d.smsService);
      if(!/^\+?[0-9]{5,15}$/.test(target?.value||"")){card.settingsError="Enter an SMS recipient with 5–15 digits, optionally starting with +.";card.render();return true;}
      const method=editableMethod(card,id),field=d.smsField;
      const owner=field.startsWith("person_destinations:")?(method.person_destinations??={}):method,key=field.startsWith("person_destinations:")?field.slice(20):field;
      owner[key]=[...new Set([...(owner[key]||[]),d.smsService+encodeURIComponent(target.value)])];
    }else return false;
  }else {
    if(d.definitionPickerSearch!==undefined){card.policyPicker.query=element.value;renderAfterEdit(card,element);return true;}
    if(d.definitionPickerSelected!==undefined){card.policyPicker.selectedOnly=element.checked;renderAfterEdit(card,element);return true;}
    if(d.definitionRestore!==undefined){card.policyRestoreIds=element.checked?[...card.policyRestoreIds,d.definitionRestore]:card.policyRestoreIds.filter(value=>value!==d.definitionRestore);card.render();return true;}
    if(d.definitionTemplate!==undefined){card.definitionTemplate=element.value;return true;}
    if(d.definitionDeleteResolution!==undefined){card.definitionDelete.resolution=element.value;card.render();return true;}
    if(d.rowScope) {
      const rows=rowsFor(card,d.rowScope),index=rows?.findIndex(item=>item.id===d.rowId),row=rows?.[index];
      if(d.rowField==="profile") {
        if(element.value) {
          if(!card.configuration.settings.notification_definitions?.profiles?.[element.value])return true;
          const value={id:row?.id||nextRowId(draft),profile:element.value,...(row?.when?{when:row.when}:{})};
          if(index>=0)rows[index]=value;else rows.push(value);
        }else if(row?.profile)rows.splice(index,1);
      }else if(row&&d.rowField==="when")row.when=element.value;
      else return false;
    }else if(d.definitionField) {
      const item=kind==="policies"?policies.find(policy=>policy.id===id):kind==="profiles"?definitions.profiles[id]:editableMethod(card,id),field=d.definitionField;
      if(kind==="profiles"&&field.startsWith("timing:")) {
        const key=field.slice(7);
        if(key==="mode")item.timing=element.value==="report"?{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]}:element.value==="acknowledge"?{mode:"acknowledge",remind_every:1800}:element.value==="window"?{mode:"window",start:"08:00",end:"22:00"}:{mode:"immediate"};
        else if(key==="minutes")item.timing.remind_every=Number(element.value)*60;
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
      }else if(field==="watch") {
        const selector=element.value==="selected"?sourceField(item):element.value==="all_except"?"all":element.value;
        delete item.excluded_sources;
        if(element.value==="all_except")item.excluded_sources=[];
        item.match={kind:[sourceKind(item)],...(selector==="all"?{}:{[selector]:[]})};card.policyPicker=null;
      }else if(field==="selection") {
        const mode=watchMode(item),selector=mode==="selected"?sourceField(item):mode;
        const values=mode==="all_except"?item.excluded_sources||[]:item.match[selector]||[];
        const next=element.checked?[...new Set([...values,d.definitionValue])]:values.filter(value=>value!==d.definitionValue);
        if(mode==="all_except")item.excluded_sources=next;else item.match[selector]=next;
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
  invalidate(card);renderAfterEdit(card,element);
  if(event.type==="click"&&kind==="methods"&&["add","duplicate"].includes(action)) {
    card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});
    card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]')?.focus({preventScroll:true});
  }
  return true;
}
