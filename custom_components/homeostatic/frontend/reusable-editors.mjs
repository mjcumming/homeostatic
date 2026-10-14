import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=73";
import {destinationChoices,editDestinationPicker,focusDestinationPicker} from "./delivery-picker.mjs?v=73";

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
export function newMonitoringPolicy(existing,type="device") {
  if(type==="availability")type="device";
  const check=["integration","device","entity"].includes(type)?"availability":type;
  const parameters = check === "thermostat" ? {unit:"°F",margin:2,progress:2,worsening:2,progress_seconds:3600}
    : check === "temperature_limit" ? {unit:"°F",duration_seconds:0} : check === "battery" ? {threshold:20} : {};
  const kind = check.startsWith("ups_")?"ups":["thermostat","temperature_limit"].includes(check)?"entity":type;
  return {id:nextDefinitionId(existing,"policy"),name:MONITORING_TYPES[type],check,match:{kind:[kind]},parameters,enabled:false,notifications:[]};
}

export function emptyNotificationDefinitions(timezone="UTC") {
  return {timezone,methods:{},default:[],repairs:[],broken_automations:[],assignments:{},automation_profiles:{}};
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
  return notificationRowGroups(draft).filter(group=>group.rows.some(row=>row.methods.includes(id))).map(group=>group.label);
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
    const matches=row=>row.methods.includes(id);
    if(resolution==="remove-rows")group.owner[group.key]=group.rows.filter(row=>!matches(row));
    else for(const row of group.rows.filter(matches)) {
      row.methods=[...new Set(row.methods.map(method=>method===id?resolution:method))];
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
  for(const kind of ["methods"])for(const id of new Set([...Object.keys(a?.[kind]||{}),...Object.keys(b?.[kind]||{})])) {
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
  return `<section class="source-section"><h3>Notifications</h3>${section("","Source preference")}<details><summary>Condition exception</summary>${section(check,POLICY_CHECKS[check]||"Configured condition")}</details><p class="small">Monitoring policies use their own notifications.</p>${applicablePolicyLinks(card,source)}<button type="button" class="link" data-page="notifications">Manage delivery methods</button></section>`;
}

export function applicablePolicyLinks(card,source) {
  const detail=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  const policies=detail?.monitoring_policies||source?.monitoring_policies||[];
  return policies.length?`<section class="source-section"><h3>Monitoring policies</h3>${policies.map(policy=>button("open-policy",policy.name,"policies",policy.id)).join("")}</section>`:"";
}

export function notificationRowsEditor(card,rows,scope) {
  const definitions=card.settingsDraft.notification_definitions;
  if(!definitions && !scope.startsWith("policy:"))return '<p class="note">Add delivery methods in Notifications to configure sending.</p><button type="button" class="button" data-page="notifications">Open Notifications</button>';
  if(!definitions)return `<p class="sub">Dashboard only. No notifications configured.</p>${button("add-row","Add notification","","",`data-row-scope="${esc(scope)}"`)}`;
  const methods=definitions.methods,zone=definitions.timezone;
  const reserve=scope.startsWith("policy:")&&card.settingsDraft.monitoring_policies.find(item=>item.id===scope.slice(7))?.check==="ups_reserve";
  const rowHTML=rows.map(row=>{
    const timing=row.timing||{mode:"immediate"};
    const attr=field=>`data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-field="${field}"`;
    const immediate=timing.mode!=="report";
    return `<div class="definition-notification-row">${reserve?`<label>When reserve is low<select ${attr("when")}>${[["mains","Mains power confirmed"],["backup","Backup power confirmed"]].map(([id,name])=>option(id,name,row.when||"mains")).join("")}</select></label>`:""}<label class="installation-field"><span>When to notify</span><select ${attr("timing:mode")}>${option("immediate","Immediately",immediate?"immediate":"report")}${option("report","Scheduled summary",timing.mode)}</select></label>${immediate?`<p class="small">Notify when the problem begins, including overnight.</p><label class="installation-toggle"><input type="checkbox" ${attr("timing:remind")}${checked(timing.mode==="acknowledge")}>Remind until acknowledged</label>${timing.mode==="acknowledge"?`<label class="installation-field"><span>Remind every (minutes)</span><input type="number" min="1" step="1" required ${attr("timing:minutes")} value="${esc(timing.remind_every/60)}"></label>`:""}`:`<label class="installation-field"><span>Summary time · ${esc(zone)}</span><input type="time" required ${attr("timing:at")} value="${esc(timing.at)}"></label><fieldset class="policy-weekdays"><legend>Days</legend>${DAYS.map((day,index)=>`<label class="installation-toggle"><input type="checkbox" ${attr("timing:weekdays")} data-row-day="${index}"${checked(timing.weekdays?.includes(index))}>${day}</label>`).join("")}</fieldset><p class="small">Includes open problems, even after acknowledgment. Empty summaries are skipped.</p>`}<fieldset><legend>Send using</legend>${Object.entries(methods).filter(([id])=>card.policyMethodEditor?.id!==id||card.policyMethodEditor.before).map(([id,method])=>`<div class="definition-list-item"><label class="installation-toggle"><input type="checkbox" data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}" data-row-method="${esc(id)}"${checked(row.methods.includes(id))}>${esc(method.name)}<small>${esc(methodSummary(card,method))}</small></label>${scope.startsWith("policy:")?button("edit-policy-method","Edit","methods",id,`data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}"`):""}</div>`).join("")||'<p>No delivery methods yet.</p>'}${scope.startsWith("policy:")?button("new-policy-method","New method","methods","",`data-row-scope="${esc(scope)}" data-row-id="${esc(row.id)}"`):""}${row.methods.filter(id=>!methods[id]).map(()=>'<p role="alert">A selected delivery method is unavailable.</p>').join("")}</fieldset>${button("remove-row","Remove notification","",row.id,`data-row-scope="${esc(scope)}"`)}</div>`;
  }).join("");
  return `${rowHTML||'<p class="sub">Dashboard only. No notifications configured.</p>'}${button("add-row","Add notification","","",`data-row-scope="${esc(scope)}"`)}${scope.startsWith("policy:")?policyMethodEditor(card,scope):'<button type="button" class="link" data-page="notifications">Manage delivery methods</button>'}`;
}

function methodSummary(card,method) {
  if(method.mode!=="fixed")return METHOD_MODES[method.mode];
  return (method.destinations||[]).map(channel=>card.configuration.delivery_targets?.find(target=>target.channel===channel)).map(target=>target?.destination_name||target?.name).filter(Boolean).join(", ")||METHOD_MODES[method.mode];
}

function policyMethodEditor(card,scope) {
  const editor=card.policyMethodEditor;
  if(editor?.scope!==scope)return "";
  const method=card.settingsDraft.notification_definitions.methods[editor.id];
  const uses=definitionUses(card.settingsDraft,"methods",editor.id);
  return `<section class="definition-editor installation-editor delivery-method-editor inline-method-editor" aria-label="Delivery method in policy"><header><h3>${editor.before?"Edit delivery method":"New delivery method"}</h3></header><div class="delivery-method-body">${methodFields(card,editor.id,method,false)}${uses.length?`<p class="method-usage">Changes to this shared method apply to: ${uses.map(esc).join(", ")}.</p>`:""}</div><footer class="delivery-method-actions"><span class="small">Pending until the policy is saved</span><div class="actions">${button("cancel-policy-method","Cancel","methods",editor.id)}${button("use-policy-method","Use method","methods",editor.id,"","primary")}</div></footer></section>`;
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
  return {all:`All ${noun}`,selected:`Selected ${noun}…`,...(type==="integration"?{}:{area:`${noun[0].toUpperCase()+noun.slice(1)} in areas…`,label:`${noun[0].toUpperCase()+noun.slice(1)} with labels…`})};
}
function sourceField(policy) {
  return {integration:"integration_domain",device:"device",ups:"device"}[sourceKind(policy)]||"entity";
}
export function watchMode(policy) {
  return policy.match.area?"area":policy.match.label?"label":policy.match[sourceField(policy)]||policy.match.integration?"selected":"all";
}
export function policySelectionChoices(card,policy,mode) {
  if(mode==="area"||mode==="label")return (card.configuration[mode==="area"?"areas":"labels"]||[]).map(item=>({...item,group:mode==="area"?(card.configuration.floors||[]).find(floor=>floor.id===item.floor_id)?.name||"Other areas":"Labels"}));
  const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
  if(policyType(policy)==="integration") {
    const domains=[...new Set(inventory.filter(source=>source.kind==="integration").flatMap(source=>source.attributes?.integration_domain||source.attributes?.domain||[]))];
    return domains.map(id=>({id,name:card._hass?.localize?.(`component.${id}.title`)||({mobile_app:"Mobile App",esphome:"ESPHome",nut:"Network UPS Tools (NUT)"})[id]||id.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()),group:"Integrations"}));
  }
  const field=sourceField(policy),noun=sourceNoun(policy),group=noun[0].toUpperCase()+noun.slice(1);
  return [...new Map(inventory.filter(source=>source.kind===sourceKind(policy)&&(policy.check!=="thermostat"||source.attributes?.domain?.includes("climate"))&&(policy.check!=="temperature_limit"||source.attributes?.device_class?.includes("temperature"))).map(source=>{
    const id=source.attributes?.[field]?.[0];
    return [id,{id,name:source.name,group}];
  }).filter(([id])=>id)).values()];
}
function watchEditor(card,policy) {
  if(policy.check==="repair")return '<p>Watches all Home Assistant Repairs.</p>';
  if(policy.check==="broken_automation")return '<p>Checks all automations for references to entities that no longer exist.</p>';
  const mode=watchMode(policy),choices=watchChoices(policy),field=mode==="selected"?sourceField(policy):mode;
  const noun=mode==="area"?"areas":mode==="label"?"labels":sourceNoun(policy);
  const values=policy.match[field]||[],items=policySelectionChoices(card,policy,mode);
  const names=values.map(id=>items.find(item=>item.id===id)?.name||"Unavailable selection");
  const oldConnections=policyType(policy)==="integration"&&policy.match.integration;
  const picker=card.policyPicker?.id===policy.id?card.policyPicker:null;
  const filtered=picker?items.filter(item=>(!picker.selectedOnly||values.includes(item.id))&&item.name.toLocaleLowerCase().includes(picker.query.toLocaleLowerCase())):[];
  const groups=[...new Set(filtered.map(item=>item.group))];
  return `${select("policies",policy.id,"watch","Watch",mode,choices)}${mode!=="all"?`<div class="policy-selection"><p>${oldConnections?"Saved individual connections. Choose integrations to replace this selection.":names.length?esc(names.slice(0,2).join(", "))+(names.length>2?` +${names.length-2} more`:""):"Nothing selected"}</p>${button("pick",`Choose ${noun}`,"policies",policy.id)}${picker?`<section class="policy-picker" aria-label="Choose ${noun}"><label class="installation-field"><span>Search ${noun}</span><input type="search" data-definition-picker-search value="${esc(picker.query)}"></label><label class="installation-toggle"><input type="checkbox" data-definition-picker-selected${checked(picker.selectedOnly)}>Show selected only</label><p role="status">${values.length} selected</p><div class="policy-picker-options">${groups.map(group=>`<fieldset><legend>${esc(group)}</legend>${filtered.filter(item=>item.group===group).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>`<label class="installation-toggle"><input type="checkbox" ${attrs("policies",policy.id,"selection")} data-definition-value="${esc(item.id)}"${checked(values.includes(item.id))}>${esc(item.name)}</label>`).join("")}</fieldset>`).join("")||'<p>No matching choices.</p>'}${values.filter(id=>!items.some(item=>item.id===id)).map(id=>`<label class="installation-toggle"><input type="checkbox" ${attrs("policies",policy.id,"selection")} data-definition-value="${esc(id)}" checked>Unavailable selection — clear to remove</label>`).join("")}</div>${button("finish-pick","Done","policies",policy.id)}</section>`:""}<p class="small">${mode==="selected"?policyType(policy)==="integration"?"Includes all current and future connections for each selected integration.":`Only the selected ${sourceNoun(policy)} are included.`:`Includes current and future matching ${sourceNoun(policy)} in any selected ${mode==="area"?"area":"label"}.`}</p></div>`:`<p class="small">Includes current and future ${sourceNoun(policy)}.</p>`}`;
}

function policyFields(card,policy) {
  const {id,check,parameters}=policy;
  const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
  let parameterFields='<p class="sub">Uses the reported Home Assistant state and configured timing.</p>';
  if(check==="battery")parameterFields=input("policies",id,"parameters:threshold","Battery level at or below (%)",parameters.threshold??20,"number",'min="0" max="100" step="1" required');
  if(check==="ups_reserve") {
    const selected=inventory.filter(source=>source.kind==="ups"&&Object.entries(policy.match||{}).every(([field,values])=>values.some(value=>source.attributes?.[field]?.includes(value))));
    const hasRole=role=>selected.some(source=>(source.ups_entities||[]).some(([key])=>key===role));
    const fields=[...(hasRole("charge")||parameters.charge_low!==undefined?[["charge_low","Raise at or below (%)"],["charge_clear","Clear at or above (%)"]]:[]),...(hasRole("runtime")||parameters.runtime_low_minutes!==undefined?[["runtime_low_minutes","Raise at or below (minutes)"],["runtime_clear_minutes","Clear at or above (minutes)"]]:[])];
    parameterFields=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'min="0" step="any"')).join("")+`<p class="small">Optional numeric thresholds supplement the UPS warning. Set both raise and clear values for each measurement. Without a custom threshold, a reported device low setpoint is used when readable.</p>${card.configuration?.monitoring_policy_version===1?"":`<label class="installation-toggle"><input type="checkbox" ${attrs("policies",id,"parameters:replace_battery_check")}${checked(parameters.replace_battery_check)}>Transfer overlapping battery monitoring to this reserve policy</label><p class="small">Saving replaces the overlapping battery checks with this reserve policy.</p>`}<p class="small">Charging alone does not clear low reserve.</p>`;
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
  const policies=card.settingsDraft?.monitoring_policies||[];
  const active=policies.find(item=>card.definitionSelection?.kind==="policies"&&item.id===card.definitionSelection.id);
  const templates=card.configuration.monitoring_policy_templates||[];
  const missing=templates.filter(template=>!policies.some(policy=>policy.id===template.id));
  if(card.policyCreating)return `<section class="definition-editor installation-editor"><h2>Add policy</h2><p>Choose the monitoring type. It stays fixed after creation.</p><label class="installation-field"><span>Monitoring type</span><select data-definition-template>${Object.entries(MONITORING_TYPES).map(([id,name])=>option(id,name,card.definitionTemplate||"device")).join("")}</select></label>${button("create","Continue","policies")}${button("close","Cancel","policies")}</section>`;
  if(active)return `<section class="definition-editor installation-editor unified-policy-editor" aria-label="Edit monitoring policy"><header><h2>Edit policy</h2>${button("close","Back to policies","policies",active.id)}</header>${policyFields(card,active)}${deletePrompt(card)}</section>`;
  const list=policies.map(policy=>{
    const saved=card.configuration.settings.monitoring_policies?.find(item=>item.id===policy.id);
    const state=saved?(saved.enabled?"On":"Off"):"Not saved";
    const pending=saved?policy.enabled!==saved.enabled:policy.enabled;
    const menuId=`policy-actions-${policy.id}`;
    return `<article class="definition-list-item"><div><h3>${esc(policy.name)} <span class="small">${state}</span></h3><p class="small">${esc(MONITORING_TYPES[policyType(policy)])} · ${policy.notifications.length?`${policy.notifications.length} notification${policy.notifications.length===1?"":"s"}`:"Dashboard only"}</p>${pending?`<p class="source-setting-pending" role="status">Will turn ${policy.enabled?"on":"off"} when saved.</p>`:""}</div><div class="actions">${button("toggle",policy.enabled?"Turn off":"Turn on","policies",policy.id,"",policy.enabled?"":"primary")}${button("edit","Edit","policies",policy.id)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(policy.name)}" title="More actions"${card.settingsBusy||card.configBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(policy.name)}">${button("duplicate","Duplicate","policies",policy.id)}${button("delete","Delete","policies",policy.id)}</div></div></article>`;
  }).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><h2>Monitoring policies</h2><div class="actions">${button("restore","Restore defaults","policies","",missing.length?"":"disabled")}${button("add","Add policy","policies")}</div></div>${card.policyRestoring?`<section class="policy-picker" aria-label="Restore default policies"><h3>Restore defaults</h3><p>Choose deleted policies to restore. Existing policies keep their settings.</p>${missing.map(policy=>`<label class="installation-toggle"><input type="checkbox" data-definition-restore="${esc(policy.id)}"${checked(card.policyRestoreIds?.includes(policy.id))}>${esc(policy.name)}</label>`).join("")}${button("confirm-restore","Restore selected","policies","",card.policyRestoreIds?.length?"":"disabled")}${button("cancel-restore","Cancel","policies")}</section>`:""}<div class="definition-list">${list||'<p>No policies. Add a policy or restore defaults to start monitoring.</p>'}</div>${deletePrompt(card)}</section>`;
}

function methodFields(card,id,method,allowTest=true) {
  const people=card.configuration.notification_people||[];
  const personId=person=>person.entity_id||person.id;
  let body=input("methods",id,"name","Name",method.name,"text","required");
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
  if(!saved||card.deliveryMethodBusy||card.settingsBusy||card.configBusy||JSON.stringify(current)!==JSON.stringify(saved))return;
  const revision=card.configuration.revision,signature=JSON.stringify(saved);
  card.deliveryMethodBusy=true;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();
  try {
    const preview=await card._hass.callWS({type:"homeostatic/preview_delivery_method",method_id:id,revision});
    if(card.configuration.revision!==revision||JSON.stringify(card.settingsDraft.notification_definitions?.methods?.[id])!==signature)throw Error("Settings changed. Save this method before testing it.");
    if(preview.targets.some(target=>target.available===false))throw Error("A configured destination is unavailable. Update this method before testing it.");
    if(!preview.targets.length&&!preview.skipped)throw Error("No destination is available for this method.");
    const result=await card._hass.callWS({type:"homeostatic/test_delivery_method",method_id:id,revision,preview_token:preview.preview_token});
    const names=preview.targets.map(target=>target.destination_name||target.name).join(", ");
    card.deliveryMethodNotice=result.skipped?"The test was skipped because no recipient qualified under the saved presence rules.":`Test requested for ${names}. ${result.failed.length?`${result.failed.length} failed requests: ${result.failed.map(item=>item.error).join("; ")}`:"This confirms the request, not receipt."}`;
  }catch(error){card.deliveryMethodError=error.message||String(error);}
  finally{card.deliveryMethodReview=null;card.deliveryMethodBusy=false;card.render();}
}

function deletePrompt(card) {
  const request=card.definitionDelete;
  if(!request)return "";
  const {kind,id}=request;
  const item=kind==="policies"?card.settingsDraft.monitoring_policies.find(policy=>policy.id===id):card.settingsDraft.notification_definitions[kind][id];
  const uses=kind==="policies"?[]:definitionUses(card.settingsDraft,kind,id);
  return `<section class="settings-preview" role="region" aria-label="Confirm deletion"><h3>Delete ${esc(item.name)}?</h3>${kind==="policies"?'<p>Monitoring from this policy and its pending requests will end after saving.</p>':uses.length?`<p>Used by ${uses.map(esc).join(", ")}. Choose what happens to every affected notification row.</p><label class="installation-field"><span>Replace or remove rows</span><select data-definition-delete-resolution>${option("","Choose an action",request.resolution)}${option("remove-rows","Remove affected notification rows",request.resolution)}${Object.entries(card.settingsDraft.notification_definitions[kind]).filter(([other])=>other!==id).map(([other,value])=>option(other,`Replace with ${value.name}`,request.resolution)).join("")}</select></label>`:'<p>This definition has no assignments.</p>'}${button("confirm-delete","Delete in draft",kind,id,uses.length&&!request.resolution?"disabled":"")}${button("cancel-delete","Cancel",kind,id)}</section>`;
}

export function namedNotifications(card) {
  const definitions=card.settingsDraft.notification_definitions;
  if(!definitions)return `<section class="reusable-definitions"><h2>Delivery methods</h2>${button("start","Set up delivery methods")}</section>`;
  const kind="methods",items=definitions.methods;
  const active=card.definitionSelection?.kind===kind?items[card.definitionSelection.id]:null;
  const id=active?card.definitionSelection.id:null;
  const saved=card.configuration.settings.notification_definitions?.methods||{};
  const list=Object.entries(items).filter(([itemId])=>saved[itemId]).map(([itemId,item])=>{
    const menuId=`method-actions-${itemId}`,uses=definitionUses(card.settingsDraft,kind,itemId);
    return `<article class="definition-list-item"><div><h3>${esc(item.name)}</h3><p class="method-summary">${esc(methodSummary(card,item))}</p><p class="small">${uses.length?`Used in ${uses.length} ${uses.length===1?"place":"places"}`:"No policies use this method yet"}${equal(saved[itemId],item)?"":" · Unsaved changes"}</p></div><div class="actions">${button("edit","Edit",kind,itemId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(item.name)}" title="More actions"${card.settingsBusy||card.configBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(item.name)}">${button("duplicate","Duplicate",kind,itemId)}${button("delete","Delete",kind,itemId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([itemId])=>!saved[itemId]).map(([itemId,item])=>`<p class="note">Unsaved delivery method: ${esc(item.name)} ${button("edit","Continue editing",kind,itemId)}</p>`).join("");
  const sending=`<section class="method-activation"><div><h3>Enable notifications</h3><p class="small">Monitoring continues when notifications are off.</p></div><label class="method-switch"><input type="checkbox" role="switch" aria-label="Enable notifications" data-definition-notifications${checked(card.settingsDraft.notifications)}><span>${card.settingsDraft.notifications?"On":"Off"}</span></label></section>`;
  const uses=active?definitionUses(card.settingsDraft,kind,id):[];
  const editor=active?`<div class="method-breadcrumb">${button("close-method","‹ Delivery methods",kind,id)}<span>${saved[id]?"Edit delivery method":"New delivery method"}</span></div><section class="definition-editor installation-editor delivery-method-editor" aria-label="Edit delivery method"><header><h2>${saved[id]?"Edit delivery method":"New delivery method"}</h2><p class="sub">Choose the destinations this method sends to.</p></header>${methodFields(card,id,active,false)}<p class="method-usage">${uses.length?`Used by ${uses.map(esc).join(", ")}.`:"No policies use this method yet."}</p>${methodTest(card,id,active)}</section>`:`${sending}<div class="policy-check-head"><div><h2>Delivery methods</h2><p class="sub">Choose where notifications go. Set notification timing in each policy.</p></div>${button("add","Add delivery method",kind,"","","primary")}</div><div class="definition-list method-list">${list||'<p>No saved delivery methods yet. Add a method to choose where notifications go.</p>'}</div>${unsaved}`;
  const cancel=active&&card.methodCancel===id?`<dialog class="method-discard-dialog" aria-labelledby="method-discard-title"><h2 id="method-discard-title">Discard this method’s changes?</h2><p>Other pending policy and notification edits will stay available.</p><div class="actions">${button("keep-method","Keep editing",kind,id)}${button("discard-method","Discard changes",kind,id)}</div></dialog>`:"";
  return `<section class="reusable-definitions notification-methods">${editor}${deletePrompt(card)}${cancel}</section>`;
}


/** Restore modal destination selection and cancellation after a dashboard render. */
export function restoreMethodDialogs(card) {
  for(const dialog of card.main.querySelectorAll?.("dialog.delivery-picker,dialog.method-discard-dialog")||[]) {
    dialog.showModal();
    dialog.oncancel=event=>{
      event.preventDefault();
      const picker=card.deliveryPicker;
      if(dialog.classList.contains("delivery-picker"))card.deliveryPicker=null;
      else card.methodCancel=null;
      card.render();
      if(picker)focusDestinationPicker(card,picker.id,picker.field);
      else card.main.querySelector('[data-definition-action="cancel-method"]')?.focus({preventScroll:true});
    };
  }
}

function invalidate(card) {
  card.settingsPreview=null;card.configPreview=null;card.sourceSettingsReview=null;
  card.settingsError=null;card.settingsNotice=null;card.sourceSettingsError=null;card.sourceSettingsNotice=null;
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
    card.dialog?.close();card.definitionSelection=d.definitionId?{kind:"policies",id:d.definitionId}:null;card.page="policies";
    void card.loadConfiguration();return true;
  }
  const draft=card.settingsDraft;
  if(!Object.keys(d).some(key=>key.startsWith("definition")||key.startsWith("row")))return false;
  if(card.settingsBusy||card.configBusy)return true;
  const policies=draft.monitoring_policies||[];
  let definitions=draft.notification_definitions;
  const kind=d.definitionKind,id=d.definitionId,action=d.definitionAction;
  if(editDestinationPicker(card,event,element,invalidate,renderAfterEdit))return true;
  if(event.type==="click") {
    if(action==="policy-actions") {
      const menu=element.popoverTargetElement,rect=element.getBoundingClientRect();
      menu.style.top=`${Math.max(8,Math.min(rect.bottom+4,window.innerHeight-110))}px`;
      menu.style.right=`${Math.max(8,window.innerWidth-rect.right)}px`;
      menu.onkeydown=event=>{
        if(event.key!=="Escape")return;
        event.preventDefault();menu.hidePopover();element.focus();
      };
      return true;
    }
    if(action==="load-delivery"){void card.loadDeliveryConfiguration?.(true);return true;}
    if(action==="new-policy-method"||action==="edit-policy-method") {
      if(card.policyMethodEditor){card.sourceSettingsError="Finish or cancel the delivery method first.";card.render();return true;}
      const methodId=action==="new-policy-method"?nextDefinitionId(definitions.methods,"method"):id;
      const before=definitions.methods[methodId]?structuredClone(definitions.methods[methodId]):null;
      if(!before)definitions.methods[methodId]={name:"New delivery method",mode:"fixed",destinations:[]};
      card.policyMethodEditor={id:methodId,scope:d.rowScope,rowId:d.rowId,before};
      card.deliveryPicker=null;invalidate(card);card.render();card.main.querySelector(".inline-method-editor")?.scrollIntoView?.({block:"nearest"});card.main.querySelector(".delivery-method-editor [data-definition-field=\"name\"]")?.focus({preventScroll:true});void card.loadDeliveryConfiguration?.(true);return true;
    }
    if(action==="use-policy-method"||action==="cancel-policy-method") {
      const editor=card.policyMethodEditor;
      if(!editor)return true;
      if(action==="cancel-policy-method") {
        if(editor.before)definitions.methods[editor.id]=editor.before;else delete definitions.methods[editor.id];
      }else {
        if([...(card.main.querySelectorAll?.(".delivery-method-editor input, .delivery-method-editor select")||[])].some(input=>!input.reportValidity()))return true;
        const method=definitions.methods[editor.id];
        if(!method.name.trim()||method.mode==="fixed"&&!method.destinations.length){card.sourceSettingsError="Name the delivery method and choose a destination.";card.render();return true;}
        const row=rowsFor(card,editor.scope).find(row=>row.id===editor.rowId);
        if(row)row.methods=[...new Set([...row.methods,editor.id])];
      }
      card.policyMethodEditor=null;card.deliveryPicker=null;invalidate(card);card.render();(card.main.querySelector(`[data-row-id="${editor.rowId}"][data-row-method="${editor.id}"]`)||card.main.querySelector(`[data-definition-action="new-policy-method"][data-row-id="${editor.rowId}"]`))?.focus();return true;
    }
    if(action==="close-method") {
      card.definitionSelection=null;card.deliveryPicker=null;card.methodCancel=null;card.render();
      [...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionId===id)?.focus({preventScroll:true});return true;
    }
    if(action==="keep-method") {card.methodCancel=null;card.render();card.main.querySelector?.('[data-definition-action="cancel-method"]')?.focus({preventScroll:true});return true;}
    if(action==="cancel-method"||action==="discard-method") {
      const saved=card.configuration.settings.notification_definitions?.methods?.[id];
      const pristine=saved||{name:"New delivery method",mode:"fixed",destinations:[]};
      if(action==="cancel-method"&&!equal(pristine,definitions.methods[id])){card.methodCancel=id;card.deliveryPicker=null;card.render();return true;}
      card.methodCancel=null;
      if(!saved&&definitionUses(draft,"methods",id).length){card.settingsError="Remove this unsaved method from its policies before cancelling it.";card.render();return true;}
      if(saved)definitions.methods[id]=structuredClone(saved);else delete definitions.methods[id];
      card.definitionSelection=null;card.deliveryPicker=null;card.deliveryMethodError=null;card.deliveryMethodNotice=null;invalidate(card);card.render();[...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionId===id)?.focus({preventScroll:true});return true;
    }
    if(action==="test-method"){void testDeliveryMethod(card,id);return true;}
    if(action==="tab"){card.notificationDefinitionTab=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="edit"){card.definitionSelection={kind,id};card.deliveryPicker=null;card.methodCancel=null;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();if(kind==="methods"){card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]')?.focus({preventScroll:true});void card.loadDeliveryConfiguration?.(true);}return true;}
    if(action==="open-policy"){card.dialog?.close();card.definitionSelection=id?{kind:"policies",id}:null;card.page="policies";card.render();return true;}
    if(action==="close"&&card.policyMethodEditor){card.sourceSettingsError="Use or cancel the delivery method before leaving this policy.";card.render();return true;}
    if(action==="close"){card.definitionSelection=null;card.policyCreating=false;card.policyPicker=null;card.render();return true;}
    if(action==="add"&&kind==="policies"){card.policyCreating=true;card.definitionSelection=null;card.render();return true;}
    if(action==="pick"){const policy=policies.find(item=>item.id===id);if(policyType(policy)==="integration"&&policy.match.integration){policy.match={kind:["integration"],integration_domain:[]};}card.policyPicker={id,query:"",selectedOnly:false};card.render();return true;}
    if(action==="finish-pick"){card.policyPicker=null;card.render();return true;}
    if(action==="restore"){card.policyRestoring=true;card.policyRestoreIds=[];card.render();return true;}
    if(action==="cancel-restore"){card.policyRestoring=false;card.render();return true;}
    if(action==="delete"){card.definitionDelete={kind,id,resolution:""};card.render();return true;}
    if(action==="cancel-delete"){card.definitionDelete=null;card.render();return true;}
    if(action==="start")draft.notification_definitions=emptyNotificationDefinitions(draft.policy.timezone);
    else if(action==="add"||action==="create"||action==="duplicate") {
      if(kind==="policies") {
        draft.monitoring_policies??=[];
        const original=policies.find(item=>item.id===id);
        const policy=action==="duplicate"?{...structuredClone(original),id:nextDefinitionId(policies,"policy"),name:`${original.name} copy`,enabled:false}:newMonitoringPolicy(policies,card.definitionTemplate||"device");
        card.policyCreating=false;
        draft.monitoring_policies.push(policy);card.definitionSelection={kind,id:policy.id};
      }else {
        const newId=nextDefinitionId(definitions[kind],"method");
        const original=definitions[kind][id];
        definitions[kind][newId]=action==="duplicate"?{...structuredClone(original),name:`${original.name} copy`}:{name:"New delivery method",mode:"fixed",destinations:[]};
        card.definitionSelection={kind,id:newId};
        void card.loadDeliveryConfiguration?.(true);
      }
    }else if(action==="toggle") {
      const policy=policies.find(item=>item.id===id);policy.enabled=!policy.enabled;
    }else if(action==="confirm-restore") {
      for(const template of card.configuration.monitoring_policy_templates||[])if(card.policyRestoreIds.includes(template.id)&&!policies.some(policy=>policy.id===template.id))policies.push(structuredClone(template));
      card.policyRestoring=false;card.policyRestoreIds=[];
    }else if(action==="confirm-delete") {
      if(kind==="policies")draft.monitoring_policies=policies.filter(item=>item.id!==id);
      else deleteNotificationDefinition(draft,kind,id,card.definitionDelete?.resolution);
      card.definitionDelete=null;card.definitionSelection=null;
    }else if(action==="add-row") {
      if(!definitions)definitions=draft.notification_definitions=emptyNotificationDefinitions(draft.policy.timezone);
      const rows=rowsFor(card,d.rowScope);
      const reserve=d.rowScope.startsWith("policy:")&&policies.find(item=>item.id===d.rowScope.slice(7))?.check==="ups_reserve";
      rows.push({id:nextRowId(draft),timing:{mode:"immediate"},methods:[],...(reserve?{when:rows.some(row=>row.when==="mains")?"backup":"mains"}:{})});
    }else if(action==="override-rows"||action==="inherit-rows") {
      const [source,check,inherited="default"]=JSON.parse(d.rowScope.slice(7));
      const assignment=definitions.assignments[source]??={checks:{}};
      assignment.checks??={};
      const owner=check?assignment.checks:assignment,key=check||"default";
      if(action==="inherit-rows")delete owner[key];
      else {
        const inheritedRows=structuredClone(check?(assignment.default||definitions[inherited]):definitions[inherited]);
        owner[key]=[];
        for(const row of inheritedRows||[])owner[key].push({...row,id:nextRowId(draft)});
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
    if(d.definitionPickerSearch!==undefined){card.policyPicker.query=element.value;renderAfterEdit(card,element);return true;}
    if(d.definitionPickerSelected!==undefined){card.policyPicker.selectedOnly=element.checked;renderAfterEdit(card,element);return true;}
    if(d.definitionRestore!==undefined){card.policyRestoreIds=element.checked?[...card.policyRestoreIds,d.definitionRestore]:card.policyRestoreIds.filter(value=>value!==d.definitionRestore);card.render();return true;}
    if(d.definitionTemplate!==undefined){card.definitionTemplate=element.value;return true;}
    if(d.definitionDeleteResolution!==undefined){card.definitionDelete.resolution=element.value;card.render();return true;}
    if(d.definitionNotifications!==undefined)draft.notifications=element.checked;
    else if(d.definitionZone!==undefined)definitions.timezone=element.value;
    else if(d.rowScope) {
      const row=rowsFor(card,d.rowScope)?.find(item=>item.id===d.rowId);
      if(!row)return false;
      if(notificationRowGroups(draft).some(group=>group.rows.some(other=>other!==row&&other.id===row.id)))row.id=nextRowId(draft);
      if(d.rowMethod)row.methods=element.checked?[...new Set([...row.methods,d.rowMethod])]:row.methods.filter(method=>method!==d.rowMethod);
      else if(d.rowField?.startsWith("timing:")) {
        const field=d.rowField.slice(7);
        row.timing??={mode:"immediate"};delete row.schedule;
        if(field==="mode")row.timing=element.value==="report"?{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]}:{mode:"immediate"};
        else if(field==="remind")row.timing=element.checked?{mode:"acknowledge",remind_every:1800}:{mode:"immediate"};
        else if(field==="minutes")row.timing.remind_every=Number(element.value)*60;
        else if(field==="weekdays")row.timing.weekdays=element.checked?[...new Set([...row.timing.weekdays,Number(d.rowDay)])].sort() :row.timing.weekdays.filter(day=>day!==Number(d.rowDay));
        else row.timing[field]=element.value;
      }else row[d.rowField]=element.value;
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
      }else if(field==="watch") {
        const selector=element.value==="selected"?sourceField(item):element.value;
        item.match={kind:[sourceKind(item)],...(selector==="all"?{}:{[selector]:[]})};card.policyPicker=null;
      }else if(field==="selection") {
        const mode=watchMode(item),selector=mode==="selected"?sourceField(item):mode;
        const values=item.match[selector]||[];
        item.match[selector]=element.checked?[...new Set([...values,d.definitionValue])]:values.filter(value=>value!==d.definitionValue);
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
