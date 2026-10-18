import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=95";
import {destinationChoices,editDestinationPicker,focusDestinationPicker} from "./delivery-picker.mjs?v=95";
import {initializeScopedConfiguration,scopedDirty,saveScopedConfiguration,discardScopedConfiguration} from "./scoped-configuration.mjs?v=95";

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
  const feedback=`${status&&card.scopedError&&!(scope.kind==="policy"&&card.policyValidation?.id===scope.id)?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}${status&&card.scopedNotice?`<p role="status">${esc(card.scopedNotice)}</p>`:""}`;
  const kind={policy:"policies",method:"methods",profile:"profiles",settings:"settings"}[scope.kind],disabled=card.scopedBusy?"disabled":"";
  const actions=scopedDirty(card,scope)?`<footer class="installation-actions"><span class="small">Unsaved changes</span><div class="actions">${button("discard-scoped","Discard changes",kind,scope.id||"",disabled)}${button("save-scoped",card.scopedBusy===key?"Saving…":label,kind,scope.id||"",disabled,"primary")}</div></footer>`:"";
  return `<div data-scoped-editor="${esc(key)}" data-scope-kind="${esc(scope.kind)}" data-scope-id="${esc(scope.id||"")}" data-save-label="${esc(label)}">${feedback}${actions}</div>`;
}

function editableMethod(card,id) {
  return card.settingsDraft.notification_definitions.methods[id];
}
const compactNames=names=>names.slice(0,2).join(", ")+(names.length>2?` +${names.length-2} more`:"");
const useCount=uses=>uses.length?`${uses.length} ${uses.length===1?"use":"uses"}`:"Not used yet";
function policyScopeSummary(card,policy) {
  const mode=watchMode(policy);
  if(mode==="all")return watchChoices(policy).all+(devicePolicy(policy)&&memberExclusions(policy).length?`; ${memberExclusions(policy).length} ignored entities`:"");
  const field=mode==="selected"?sourceField(policy):mode;
  const values=mode==="all_except"?(devicePolicy(policy)?deviceExclusions(policy):policy.excluded_sources||[]):policy.match[field]||[];
  const choices=policySelectionChoices(card,policy,mode,values);
  const names=values.map(id=>choiceSummary(choices.find(item=>item.id===id),mode==="all_except"?"Unavailable excluded source":"Unavailable selection"));
  const unavailable=values.filter(id=>!choices.some(item=>item.id===id)).length;
  const selection=compactNames(names)+(unavailable&&names.length>2?` · ${unavailable} unavailable`:"");
  if(mode==="all_except")return names.length?`All ${sourceNoun(policy)} except: ${selection}${devicePolicy(policy)&&memberExclusions(policy).length?`; ${memberExclusions(policy).length} ignored entities`:""}`:`All ${sourceNoun(policy)}; no exclusions`;
  const summary=names.length?`${mode==="selected"?"Selected "+sourceNoun(policy):mode==="area"?"Areas":"Labels"}: ${selection}`:"No sources selected";
  return `${summary}${devicePolicy(policy)?`${deviceExclusions(policy).length?`; ${deviceExclusions(policy).length} excluded devices`:""}${memberExclusions(policy).length?`; ${memberExclusions(policy).length} ignored entities`:""}`:policy.excluded_sources?.length?`; ${policy.excluded_sources.length} excluded`:""}`;
}
function policyDetectionSummary(policy) {
  const p=policy.parameters||{};
  if(policy.check==="battery")return `Battery at or below ${p.threshold??20}%`;
  if(policy.check==="temperature_limit")return [p.minimum!=null?`Below ${p.minimum}${p.unit}`:"",p.maximum!=null?`Above ${p.maximum}${p.unit}`:"",p.duration_seconds?`for ${formatPolicyDuration(p.duration_seconds)}`:""].filter(Boolean).join(" · ")||"Temperature bounds need configuration";
  if(policy.check==="thermostat")return `${p.margin}${p.unit} deviation · ${p.progress_seconds/60} minute progress window`;
  if(policy.check==="ups_reserve")return [p.charge_low!==undefined?`Charge at or below ${p.charge_low}%`:"",p.runtime_low_minutes!==undefined?`Runtime at or below ${p.runtime_low_minutes} minutes`:""].filter(Boolean).join(" · ");
  return "";
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
  if(timing.mode==="acknowledge")return `Immediately; remind every ${reminderMinutes(timing.remind_every)} minutes until acknowledged`;
  if(timing.mode==="window")return `${timing.start}–${timing.end} daily; hold outside these hours`;
  return "Immediately";
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
  const definitions=card.configuration.settings.notification_definitions;
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
  const destinations=method.destinations||[],targets=card.configuration.delivery_targets;
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
  return {all:`All ${noun}`,all_except:"All except selected",selected:`Selected ${noun}`,...(type==="integration"?{}:{area:"In selected areas",label:"With selected labels"})};
}
function sourceField(policy) {
  return {integration:"integration_domain",device:"device",ups:"device"}[sourceKind(policy)]||"entity";
}
const devicePolicy=policy=>sourceKind(policy)==="device";
const memberExclusions=policy=>(policy.excluded_sources||[]).filter(id=>id.startsWith("entity:"));
const deviceExclusions=policy=>(policy.excluded_sources||[]).filter(id=>!id.startsWith("entity:"));
const selectionIndexes=new WeakMap();
const PICKER_PAGE_SIZE=50;

export function watchMode(policy) {
  return policy.match.area?"area":policy.match.label?"label":policy.match[sourceField(policy)]||policy.match.integration?"selected":(devicePolicy(policy)?(deviceExclusions(policy).length>0||policy.excluded_sources?.length===0):Object.hasOwn(policy,"excluded_sources"))?"all_except":"all";
}
function completeSelectionCatalog(card) {
  const data=card.current?.data;
  return Boolean(data?.inventory?.catalog)&&!(data.schema_version===3&&!data.catalog_loaded);
}
function selectionIndex(card) {
  if(!completeSelectionCatalog(card))return null;
  const data=card.current.data,{catalog,nodes}=data.inventory,configuration=card.configuration;
  const previous=selectionIndexes.get(catalog);
  if([2,3].includes(data.schema_version)&&previous?.nodes===nodes&&previous.candidates===catalog.candidates&&previous.areas===configuration.areas&&previous.floors===configuration.floors)return previous;
  const rows=inventoryRows(data),devices=new Map(),deviceNames=new Map();
  for(const source of rows)if(source.kind==="device") {
    for(const id of source.attributes?.device||[])if(!devices.has(id))devices.set(id,source);
    const canonical=source.monitoring_source||source.node_id;
    if(canonical.startsWith("device:")&&!devices.has(canonical.slice(7)))devices.set(canonical.slice(7),source);
    if(!deviceNames.has(source.name))deviceNames.set(source.name,new Set());
    deviceNames.get(source.name).add(canonical);
  }
  const index={nodes,candidates:catalog.candidates,areas:configuration.areas,floors:configuration.floors,rows,devices,deviceNames,
    originals:new Map((catalog.candidates||[]).map(source=>[source.node_id,source])),
    areaNames:new Map((configuration.areas||[]).map(area=>[area.id,area])),floorNames:new Map((configuration.floors||[]).map(floor=>[floor.id,floor])),collections:new Map()};
  if([2,3].includes(data.schema_version))selectionIndexes.set(catalog,index);
  return index;
}
const suitableSource=(source,policy)=> (policy.check!=="thermostat"||source.attributes?.domain?.includes("climate"))&&(policy.check!=="temperature_limit"||source.attributes?.device_class?.includes("temperature"));
function policySources(card,policy,index=selectionIndex(card)) {
  return (index?.rows||[]).filter(source=>source.kind===sourceKind(policy)&&suitableSource(source,policy));
}
function sourceContext(card,source,index=null) {
  if(source.kind==="integration")return "";
  const areaId=source.attributes?.area?.[0];
  if(!areaId)return "No area assigned";
  const area=index?index.areaNames.get(areaId):card.configuration.areas?.find(item=>item.id===areaId);
  if(!area)return "Area unavailable";
  const floor=index?index.floorNames.get(area.floor_id):card.configuration.floors?.find(item=>item.id===area.floor_id);
  return [area.name,floor?.name].filter(Boolean).join(" · ");
}
function contextualChoices(card,index,key,sources,identify,group,selectedIds) {
  if(!index||selectedIds?.length===0)return [];
  let collection=index.collections.get(key);
  if(!collection) {
    const records=new Map(),counts=new Map(),identities=new Map();
    for(let source of sources()) {
      source=index.originals.get(source.monitoring_source||source.node_id)||source;
      const id=identify(source);
      if(id)records.set(id,{source,context:sourceContext(card,source,index)});
    }
    for(const {source,context} of records.values()) {
      const nameKey=JSON.stringify([source.name,context]),identity=JSON.stringify([source.name,context,source.entity_id]);
      counts.set(nameKey,(counts.get(nameKey)||0)+1);identities.set(identity,(identities.get(identity)||0)+1);
    }
    collection={records,counts,identities};index.collections.set(key,collection);
  }
  const choice=id=>{
    const record=collection.records.get(id);
    if(!record)return null;
    if(record.choice)return record.choice;
    const {source,context}=record,{name,entity_id}=source;
    const detail=collection.counts.get(JSON.stringify([name,context]))>1?entity_id&&collection.identities.get(JSON.stringify([name,context,entity_id]))===1?entity_id:id:"";
    return record.choice={id,name,context,...(entity_id?{entity_id}:{}),group:group(source),detail};
  };
  if(selectedIds)return selectedIds.map(choice).filter(Boolean);
  return collection.all??=(Array.from(collection.records.keys(),choice));
}
function choiceSummary(item,fallback) {
  if(!item)return fallback;
  return [item.name,item.context,...(item.count===undefined?[item.detail]:[])].filter(Boolean).join(" · ");
}
function sourceCount(policy,count) {
  const noun=sourceNoun(policy),singular={batteries:"battery",entities:"entity","UPS devices":"UPS device","temperature sensors":"temperature sensor"}[noun]||noun.slice(0,-1);
  return count===null?"Matching sources not loaded":count===0?`No ${noun} currently found`:`${count} ${count===1?singular:noun}`;
}
export function policySelectionChoices(card,policy,mode,selectedIds=null) {
  if(selectedIds?.length===0)return [];
  const index=selectionIndex(card);
  if(mode==="area"||mode==="label") {
    const complete=completeSelectionCatalog(card),stale=complete&&card.current.data.catalog_stale;
    const counts=new Map(),field=sourceField(policy);
    const sources=policySources(card,policy,index).filter(source=>!source.disabled&&(policy.check!=="availability"||(source.kind!=="entity"||!source.attributes?.entity_category?.length)&&(source.kind!=="device"||source.availability_entities?.length)));
    for(const source of sources)for(const id of source.attributes?.[mode]||[]) {
      const identities=counts.get(id)||new Set();
      identities.add(source.attributes?.[field]?.[0]||source.monitoring_source||source.node_id);counts.set(id,identities);
    }
    return (card.configuration[mode==="area"?"areas":"labels"]||[]).filter(item=>!selectedIds||selectedIds.includes(item.id)).map(item=>{
      const floor=mode==="area"?card.configuration.floors?.find(floor=>floor.id===item.floor_id):null;
      const count=complete?counts.get(item.id)?.size||0:null;
      return {...item,count,context:floor?.name||"",detail:stale?(count===0?`No ${sourceNoun(policy)} in last loaded list`:`${sourceCount(policy,count)} (last known)`):sourceCount(policy,count),group:mode==="area"?floor?.name||"Areas without a floor":"Labels"};
    });
  }
  const inventory=index?.rows||[],key=`${sourceKind(policy)}:${policy.check}:${mode}`;
  if(mode==="all_except") {
    const kind=sourceKind(policy);
    return contextualChoices(card,index,key,()=>inventory.filter(source=>(source.kind===kind||kind==="device"&&source.kind==="entity"&&source.attributes?.device?.length)&&suitableSource(source,policy)),source=>source.monitoring_source||source.node_id,source=>kind==="device"?(source.kind==="device"?"Whole devices":deviceGroup(card,index,source)):kind==="integration"?"Integration connections":"Sources",selectedIds);
  }
  if(policyType(policy)==="integration") {
    const domains=[...new Set(inventory.filter(source=>source.kind==="integration").flatMap(source=>source.attributes?.integration_domain||source.attributes?.domain||[]))];
    return domains.filter(id=>!selectedIds||selectedIds.includes(id)).map(id=>({id,name:card._hass?.localize?.(`component.${id}.title`)||({mobile_app:"Mobile App",esphome:"ESPHome",nut:"Network UPS Tools (NUT)"})[id]||id.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()),group:"Integrations"}));
  }
  const field=sourceField(policy),noun=sourceNoun(policy),group=noun[0].toUpperCase()+noun.slice(1);
  return contextualChoices(card,index,key,()=>policySources(card,policy,index),source=>source.attributes?.[field]?.[0],()=>group,selectedIds);
}
function deviceGroup(card,index,source) {
  const id=source.attributes.device[0];
  const device=index.devices.get(id);
  if(!device)return `Device unavailable (${id})`;
  return index.deviceNames.get(device.name).size>1?`${device.name} · ${sourceContext(card,device,index)} · ${id}`:device.name;
}
function watchEditor(card,policy,ignored=false) {
  if(policy.check==="repair")return '<p>Watches all Home Assistant Repairs.</p>';
  if(policy.check==="broken_automation")return '<p>Checks all automations for references to entities that no longer exist.</p>';
  const mode=ignored?"all_except":card.policyScopeChoice?.policy===policy?card.policyScopeChoice.mode:watchMode(policy),choices=watchChoices(policy),field=mode==="selected"?sourceField(policy):mode,excluding=mode==="all_except",grouped=["area","label"].includes(mode);
  const noun=ignored?"entities":mode==="area"?"areas":mode==="label"?"labels":excluding&&sourceKind(policy)==="integration"?"integration connections":sourceNoun(policy);
  const data=card.current?.data,catalogPending=mode!=="all"&&!completeSelectionCatalog(card),catalogStale=mode!=="all"&&data?.catalog_stale;
  const catalogStatus=catalogPending||catalogStale?`<p class="note" role="status">${card.current?.catalogError?`Could not ${catalogPending?"load":"update"} available sources: ${esc(card.current.catalogError)} <button type="button" class="link" data-action="retry-catalog">Retry loading sources</button>`:catalogPending?"Loading available sources…":"Updating available sources. You can keep using the previous complete list until the update finishes."}</p>`:"";
  const values=excluding?(devicePolicy(policy)?ignored?memberExclusions(policy):deviceExclusions(policy):policy.excluded_sources||[]):policy.match[field]||[];
  const picker=card.policyPicker?.id===policy.id&&Boolean(card.policyPicker.ignored)===ignored?card.policyPicker:null;
  const items=policySelectionChoices(card,policy,mode,picker?null:values).filter(item=>!devicePolicy(policy)||!excluding||item.id.startsWith("entity:")===ignored);
  const fallback=catalogPending?excluding?"Saved exclusion":"Saved selection":excluding?"Unavailable excluded source":"Unavailable selection";
  const selectedItems=values.map(id=>items.find(item=>item.id===id)||{id,name:fallback,detail:id});
  const oldConnections=policyType(policy)==="integration"&&policy.match.integration;
  const unavailable=values.filter(id=>!catalogPending&&!items.some(item=>item.id===id)).map(id=>({id,name:excluding?"Unavailable excluded source — clear to include if it returns":"Unavailable selection — clear to remove",detail:id,group:"Unavailable selections"}));
  const filtered=picker?[...unavailable,...items.filter(item=>(!picker.selectedOnly||values.includes(item.id))&&(!grouped||picker.showAll||item.count!==0||values.includes(item.id))&&[item.name,item.context,item.detail,item.entity_id,item.id].filter(Boolean).join(" ").toLocaleLowerCase().includes(picker.query.trim().toLocaleLowerCase()))]:[];
  const groupedItems=new Map();
  for(const item of filtered){if(!groupedItems.has(item.group))groupedItems.set(item.group,[]);groupedItems.get(item.group).push(item);}
  const ordered=[...groupedItems.values()].flatMap(items=>items.sort((a,b)=>a.name.localeCompare(b.name)||(a.context||"").localeCompare(b.context||"")||a.id.localeCompare(b.id)));
  const shown=ordered.slice(0,picker?.limit||PICKER_PAGE_SIZE),groups=[...new Set(shown.map(item=>item.group))];
  const verb=ignored?"ignored":excluding?"excluded":"selected",choose=ignored?"Choose ignored entities":excluding?`Exclude ${noun}`:`Choose ${noun}`;
  const description=excluding?`Includes current and future ${sourceNoun(policy)}, except the sources chosen here. Exclusions apply only to this policy.`:mode==="selected"?policyType(policy)==="integration"?"Includes all current and future connections for each selected integration.":`Only the selected ${sourceNoun(policy)} are included.`:`Includes current and future matching ${sourceNoun(policy)} in any selected ${mode==="area"?"area":"label"}.`;
  const excludedChoices=!devicePolicy(policy)&&!excluding&&policy.excluded_sources?.length?policySelectionChoices(card,policy,"all_except",policy.excluded_sources):[];
  const additionalExclusions=!devicePolicy(policy)&&!excluding&&policy.excluded_sources?.length?`<p class="small">This scope also excludes: ${policy.excluded_sources.map(id=>esc(choiceSummary(excludedChoices.find(item=>item.id===id),"Unavailable excluded source"))).join(", ")}. Saved exclusions remain in effect.</p>`:"";
  const availabilityNote=policy.check==="availability"&&["entity","device"].includes(sourceKind(policy))?devicePolicy(policy)?'<p class="small">Device availability uses enabled operational entities. Diagnostic and configuration entities are excluded.</p>':'<p class="small">Diagnostic and configuration entities are excluded unless individually selected. Disabled sources are not monitored.</p>':"";
  const row=item=>`<label class="policy-picker-choice"><input type="checkbox" ${attrs("policies",policy.id,ignored?"ignored-selection":"selection")} data-definition-value="${esc(item.id)}"${checked(values.includes(item.id))}><span class="policy-picker-copy"><span>${esc(item.name)}</span>${!grouped&&item.context?`<span class="policy-picker-context">${esc(item.context)}</span>`:""}${item.detail?`<span class="policy-picker-detail">${esc(item.detail)}</span>`:""}</span></label>`;
  const results=groups.map(group=>`<fieldset>${ignored||grouped&&mode==="area"||groups.length>1?`<legend>${esc(group)}</legend>`:`<legend class="sr-only">${esc(group)}</legend>`}${shown.filter(item=>item.group===group).map(row).join("")}</fieldset>`).join("");
  const more=shown.length<ordered.length?`<div class="actions"><span class="small">Showing ${shown.length} of ${ordered.length}. Search includes all ${noun}.</span>${button("more-choices",`Show ${Math.min(PICKER_PAGE_SIZE,ordered.length-shown.length)} more`,"policies",policy.id)}</div>`:"";
  const empty=picker?.query.trim()?`No ${noun} match your search.`:picker?.selectedOnly?`No ${noun} ${verb}.`:grouped?`No ${noun} with matching ${sourceNoun(policy)}. Use Show all ${noun} to choose for future sources.`:`No ${noun} available to choose.`;
  const searchLabel=grouped||sourceKind(policy)==="integration"?`Search ${noun}`:"Search by name or area";
  const pickerBody=picker?`<section class="policy-picker" aria-label="${choose}">${ignored?'<p>Choose the entities to ignore when assessing their device.</p>':excluding?'<p>Check sources to exclude them from this policy.</p>':""}<label class="policy-picker-search"><span>${searchLabel}</span><input type="search" data-definition-picker-search value="${esc(picker.query)}"></label><div class="policy-picker-tools"><label><input type="checkbox" data-definition-picker-selected${checked(picker.selectedOnly)}>Show ${verb} only</label>${grouped?`<label><input type="checkbox" data-definition-picker-all${checked(picker.showAll)}>Show all ${noun}</label>`:""}</div><div class="policy-picker-options">${results||(catalogPending?"":`<p>${esc(empty)}</p>`)}</div>${more}<footer class="policy-picker-footer"><span role="status">${values.length} ${verb}</span>${button("finish-pick","Done","policies",policy.id)}</footer></section>`:"";
  const summary=oldConnections?'<p>Saved individual connections. Choose integrations to replace this selection.</p>':selectedItems.length?`<ul class="policy-selected-sources" aria-label="${excluding?"Excluded":"Selected"} ${esc(noun)}">${selectedItems.map(item=>`<li><span>${esc(item.name)}</span>${item.context?`<span class="small">${esc(item.context)}</span>`:""}${item.detail?`<span class="small">${esc(item.detail)}</span>`:""}</li>`).join("")}</ul>`:`<p>${excluding?"No exclusions":"None selected"}</p>`;
  const selectionAction=mode!=="all"&&!picker?button(ignored?"pick-ignored":"pick",values.length?"Change selection":choose,"policies",policy.id,`aria-label="${esc(choose)}"`):"";
  const scopeChoices=`<fieldset class="policy-scope"><legend>Include</legend>${Object.entries(choices).map(([value,label])=>`<div class="policy-scope-option"><label class="policy-scope-choice"><input type="radio" name="policy-scope-${esc(policy.id)}" ${attrs("policies",policy.id,"watch")} data-watch-mode="${value}" value="${value}"${checked(mode===value)}><span>${esc(label)}</span></label>${mode===value?selectionAction:""}</div>`).join("")}</fieldset>`;
  if(ignored) {
    const groupedSummary=[...new Set(selectedItems.map(item=>item.group||"Device unavailable"))].map(group=>`<section><h4>${esc(group)}</h4><ul class="policy-selected-sources">${selectedItems.filter(item=>(item.group||"Device unavailable")===group).map(item=>`<li><span>${esc(item.name)}</span>${item.context?`<span class="small">${esc(item.context)}</span>`:""}${item.detail?`<span class="small">${esc(item.detail)}</span>`:""}</li>`).join("")}</ul></section>`).join("");
    return `<section class="policy-ignored-entities"><h3>Ignored entities</h3><p class="small">These entities do not contribute to this policy's device availability checks. Other policies keep their own choices.</p>${selectionAction}${catalogStatus}${picker?pickerBody:groupedSummary||"<p>No ignored entities.</p>"}</section>`;
  }
  return `<div class="policy-watch-controls">${scopeChoices}</div>${catalogStatus}${mode!=="all"?`<div class="policy-selection">${picker?pickerBody:`<div class="policy-selection-summary">${devicePolicy(policy)&&excluding?"<h4>Excluded devices</h4>":""}${summary}</div>`}<p class="small">${description}</p></div>`:`<p class="small">Includes current and future ${sourceNoun(policy)}.</p>`}${additionalExclusions}${availabilityNote}${devicePolicy(policy)?watchEditor(card,policy,true):""}`;
}

const DURATION_UNITS={minutes:60,hours:3600,seconds:1};
function formatPolicyDuration(seconds) {
  const unit=seconds>0&&seconds%3600===0?"hours":seconds>0&&seconds%60===0?"minutes":"seconds",value=seconds/DURATION_UNITS[unit];
  return `${value} ${value===1?unit.slice(0,-1):unit}`;
}
function temperatureValidation(policy) {
  const p=policy.parameters;
  if(p.minimum==null&&p.maximum==null)return {field:"minimum",message:"Enter at least one limit: Below, Above, or both."};
  for(const field of ["minimum","maximum"])if(p[field]!=null&&!Number.isFinite(p[field]))return {field,message:"Enter a valid temperature limit."};
  if(p.minimum!=null&&p.maximum!=null&&p.minimum>p.maximum)return {field:"minimum",message:"Below must be less than or equal to Above."};
  if(!Number.isInteger(p.duration_seconds)||p.duration_seconds<0||p.duration_seconds>31536000)return {field:"duration_seconds",message:"Enter a duration from 0 to 365 days that equals a whole number of seconds."};
  return null;
}
function policyFieldError(card,id,field) {
  return card.policyValidation?.id===id&&card.policyValidation.field===field?`aria-invalid="true" aria-describedby="policy-error-${esc(id)}"`:"";
}
function temperatureRule(policy) {
  const p=policy.parameters;
  const bounds=[p.minimum!=null?`below ${p.minimum}${p.unit}`:"",p.maximum!=null?`above ${p.maximum}${p.unit}`:""].filter(Boolean).join(" or ");
  return temperatureValidation(policy)?"Enter a lower limit, an upper limit, or both, and a valid duration.":`${policy.enabled?"Open an issue":"When enabled, open an issue"} when the temperature ${p.duration_seconds?"stays":"is"} ${bounds}${p.duration_seconds?` for ${formatPolicyDuration(p.duration_seconds)}`:", without waiting"}.`;
}
function temperatureFields(card,policy) {
  const {id,parameters:p}=policy,key=`${id}:duration_seconds`;
  const unit=card.policyDurationUnits?.[key]||(p.duration_seconds==null||p.duration_seconds%60===0?"minutes":"seconds");
  const duration=p.duration_seconds==null?"":p.duration_seconds/DURATION_UNITS[unit];
  const summary=temperatureRule(policy);
  const error=card.policyValidation?.id===id?`<p class="config-error" role="alert" id="policy-error-${esc(id)}">${esc(card.policyValidation.message)}</p>`:"";
  return `<div class="policy-temperature-unit">${select("policies",id,"parameters:unit","Temperature unit",p.unit,{"°F":"°F","°C":"°C",K:"K"})}</div><div class="policy-limits">${[["minimum","Below (optional)"],["maximum","Above (optional)"]].map(([field,label])=>input("policies",id,`parameters:${field}`,label,p[field],"number",`step="any" ${policyFieldError(card,id,field)}`)).join("")}</div><p class="small policy-help">Enter either limit or both. Leave a limit blank if it does not apply.</p><div class="policy-duration">${input("policies",id,"parameters:duration_seconds","For at least",duration,"number",`data-duration-unit="${unit}" min="0" max="${31536000/DURATION_UNITS[unit]}" step="any" required ${policyFieldError(card,id,"duration_seconds")}`)}${select("policies",id,"duration-unit:duration_seconds","Duration unit",unit,{minutes:"Minutes",hours:"Hours",seconds:"Seconds"})}</div><p class="small policy-help">The timer resets when the temperature returns within the limits. Use 0 for no waiting period.</p>${error}<p class="policy-rule" role="status">${esc(summary)}</p>`;
}

function policyFields(card,policy) {
  const {id,check,parameters}=policy;
  let parameterFields="";
  if(check==="battery")parameterFields=input("policies",id,"parameters:threshold","Battery level at or below (%)",parameters.threshold??20,"number",'min="0" max="100" step="1" required');
  if(check==="ups_reserve") {
    const inventory=card.current?.data?.inventory?.catalog?inventoryRows(card.current.data):[];
    const selected=inventory.filter(source=>source.kind==="ups"&&!policy.excluded_sources?.includes(source.monitoring_source||source.node_id)&&Object.entries(policy.match||{}).every(([field,values])=>values.some(value=>source.attributes?.[field]?.includes(value))));
    const hasRole=role=>selected.some(source=>(source.ups_entities||[]).some(([key])=>key===role));
    const fields=[...(hasRole("charge")||parameters.charge_low!==undefined?[["charge_low","Raise at or below (%)"],["charge_clear","Clear at or above (%)"]]:[]),...(hasRole("runtime")||parameters.runtime_low_minutes!==undefined?[["runtime_low_minutes","Raise at or below (minutes)"],["runtime_clear_minutes","Clear at or above (minutes)"]]:[])];
    parameterFields=fields.length?fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'min="0" step="any"')).join("")+`<p class="small">Optional thresholds supplement the UPS warning. Set both raise and clear values. Leave them blank to use the device’s low setpoint when available. Charging alone does not clear low reserve.</p>`:"";
  }
  if(check==="temperature_limit")parameterFields=temperatureFields(card,policy);
  if(check==="thermostat") {
    parameterFields=select("policies",id,"parameters:unit","Temperature unit",parameters.unit,{"°F":"°F","°C":"°C",K:"K"});
    const fields=[["margin","Deviation from target"],["progress","Required progress"],["worsening","Worsening threshold"],["progress_seconds","Progress window (seconds)"]];
    parameterFields+=fields.map(([field,label])=>input("policies",id,`parameters:${field}`,label,parameters[field],"number",'step="any" min="0" required')).join("");
    parameterFields+='<p class="small">Deviation and progress are differences in the selected unit. Heating and cooling are evaluated separately.</p>';
  }
  const notificationStatus=card.configuration.settings.notifications===false?'<p class="policy-notification-status">Notifications are turned off globally. This policy can still monitor and show issues.</p>':"";
  return `<div class="policy-identity">${input("policies",id,"name","Policy name",policy.name,"text","required")}<div class="policy-type"><span>Monitoring type</span><strong>${esc(MONITORING_TYPES[policyType(policy)])}</strong></div></div><section class="policy-section"><h3>${esc(sourceNoun(policy)[0].toUpperCase()+sourceNoun(policy).slice(1))}</h3>${watchEditor(card,policy)}</section>${parameterFields?`<section class="policy-section"><h3>When it becomes a problem</h3>${parameterFields}</section>`:""}<section class="policy-section"><h3>Notifications</h3>${notificationStatus}${notificationRowsEditor(card,policy.notifications,`policy:${id}`)}</section>`;
}

export function namedPolicies(card) {
  initializeScopedConfiguration(card);
  const policies=card.settingsDraft?.monitoring_policies||[];
  const active=policies.find(item=>card.definitionSelection?.kind==="policies"&&item.id===card.definitionSelection.id);
  const templates=card.configuration.monitoring_policy_templates||[];
  const missing=templates.filter(template=>!policies.some(policy=>policy.id===template.id));
  if(card.policyCreating)return `<section class="definition-editor installation-editor"><h2>Add policy</h2><p>Choose the monitoring type. It stays fixed after creation.</p><label class="installation-field"><span>Monitoring type</span><select data-definition-template>${Object.entries(MONITORING_TYPES).map(([id,name])=>option(id,name,card.definitionTemplate||"device")).join("")}</select></label>${button("create","Continue","policies")}${button("close","Cancel","policies")}</section>`;
  if(active) {
    return `<section class="definition-editor installation-editor unified-policy-editor" aria-label="Edit monitoring policy"><header><div><h1>${esc(active.name)}</h1><p class="small">Changes take effect when you save.</p></div><label class="method-switch policy-enabled"><input type="checkbox" role="switch" aria-label="Policy enabled" ${attrs("policies",active.id,"enabled")}${checked(active.enabled)}><span>Policy ${active.enabled?"enabled":"disabled"}</span></label>${button("close","Back to policies","policies",active.id,"","editor-back")}</header>${policyFields(card,active)}${deletePrompt(card)}${scopedEditorFooter(card,{kind:"policy",id:active.id},"Save policy")}</section>`;
  }
  const list=policies.map(draft=>{
    const saved=card.configuration.settings.monitoring_policies?.find(item=>item.id===draft.id),policy=saved||draft;
    const state=saved?(saved.enabled?"On":"Off"):"Not saved";
    const pending=scopedDirty(card,{kind:"policy",id:policy.id}),detection=policyDetectionSummary(policy);
    const menuId=`policy-actions-${policy.id}`;
    return `<article class="definition-list-item"><div><h3>${esc(policy.name)} <span class="small">${state}</span></h3><p class="small">${esc(MONITORING_TYPES[policyType(policy)])} · ${esc(policyScopeSummary(card,policy))}</p>${detection?`<p class="small">${esc(detection)}</p>`:""}<p class="small">${esc(savedNotificationSummary(card,policy))}</p>${pending?`<p class="source-setting-pending" role="status">Unsaved changes</p>`:""}</div><div class="actions">${button("edit","Edit policy","policies",policy.id)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(policy.name)}" title="More actions"${card.settingsBusy||card.configBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(policy.name)}">${button("duplicate","Duplicate","policies",policy.id)}${button("delete","Delete","policies",policy.id)}</div></div></article>`;
  }).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head"><div class="actions">${missing.length?button("restore","Restore defaults","policies"):""}${button("add","Add policy","policies","","","primary")}</div></div>${card.policyRestoring?`<section class="policy-picker" aria-label="Restore default policies"><h3>Restore defaults</h3><p>Choose deleted policies to restore, then edit and save each restored policy.</p>${missing.map(policy=>`<label class="installation-toggle"><input type="checkbox" data-definition-restore="${esc(policy.id)}"${checked(card.policyRestoreIds?.includes(policy.id))}>${esc(policy.name)}</label>`).join("")}${button("confirm-restore","Restore selected","policies","",card.policyRestoreIds?.length?"":"disabled")}${button("cancel-restore","Cancel","policies")}</section>`:""}<div class="definition-list">${list||'<p>No policies yet.</p>'}</div>${deletePrompt(card)}${card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}</section>`;
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
    body+=`<h3>When no recipient can be chosen</h3><p class="small">Includes unknown presence. Presence is checked when sending.</p><label class="installation-toggle"><input type="checkbox" ${attrs("methods",id,"skip")}${checked(method.skip)}>Skip notification</label>${method.skip?"":destinationChoices(card,method,id,"fallback","Send to instead")}`;
  }
  return body+'</details>'+(allowTest?methodTest(card,id,method):'');
}

function methodTest(card,id,method) {
  const saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(!saved)return "";
  const test=card.deliveryMethodTest,showResult=test?.id===id&&test.signature===JSON.stringify(saved);
  if(JSON.stringify(saved)!==JSON.stringify(method))return '<p class="note">Save this delivery method before testing it.</p>';
  return `<div class="method-test">${button("test-method",card.deliveryMethodBusy&&test?.id===id?"Sending test…":"Send test","methods",id,card.deliveryMethodBusy?"disabled":"")}<p class="small">Sends only to this method’s saved destinations, using current presence when configured.</p>${showResult&&card.deliveryMethodError?`<p class="error" role="alert">${esc(card.deliveryMethodError)}</p>`:""}${showResult&&card.deliveryMethodNotice?`<p role="status">${esc(card.deliveryMethodNotice)}</p>`:""}</div>`;
}

export async function testDeliveryMethod(card,id) {
  const current=card.settingsDraft.notification_definitions?.methods?.[id],saved=card.configuration.settings.notification_definitions?.methods?.[id];
  if(!saved||card.scopedBusy||card.deliveryMethodBusy||card.settingsBusy||card.configBusy||JSON.stringify(current)!==JSON.stringify(saved))return;
  const revision=card.configuration.revision,signature=JSON.stringify(saved);
  card.deliveryMethodTest={id,signature};
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
  const definitions=card.configuration.settings.notification_definitions?.[kind]||{};
  const replacements=isProfile?notificationChoices(definitions):Object.entries(definitions);
  const noun=isProfile?"notification":"delivery method";
  const removal=isProfile?"Remove this notification from affected policies":"Remove this method from affected notifications";
  return `<section class="settings-preview" role="region" aria-label="Confirm deletion"><h3>Delete ${esc(item.name)}?</h3>${isPolicy?'<p>Deleting this policy ends its monitoring and pending requests. Other policies keep monitoring their selections.</p>':uses.length?`<p>Used by ${uses.map(esc).join(", ")}. Choose a replacement or explicitly remove these assignments.${isProfile?" Policies with no remaining notification stay on the dashboard.":" Named notifications with no delivery method remain unconfigured."}</p><label class="installation-field"><span>Replace or remove assignments</span><select data-definition-delete-resolution>${option("","Choose an action",request.resolution)}${option("remove-rows",removal,request.resolution)}${replacements.filter(([other])=>other!==id).map(([other,value])=>option(other,`Replace with ${value.name}`,request.resolution)).join("")}</select></label>`:'<p>This definition has no assignments.</p>'}${button("confirm-delete",isPolicy?"Delete policy":uses.length?`Delete ${noun} and update its uses`:`Delete ${noun}`,kind,id,card.scopedBusy||uses.length&&!request.resolution?"disabled":"")}${button("cancel-delete","Cancel",kind,id)}</section>`;
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
  body+=`<fieldset><legend>Send using</legend>${Object.entries(methods).map(([methodId,method])=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(methodId)}"${checked(profile.methods.includes(methodId))}>${esc(method.name)}</label>`).join("")}${profile.methods.filter(method=>!methods[method]).map(method=>`<label class="installation-toggle"><input type="checkbox" ${attrs(kind,id,"methods")} data-definition-value="${esc(method)}" checked>Unavailable delivery method — clear to remove</label>`).join("")}${profile.methods.length?"":`<p class="note">${Object.keys(methods).length?"No delivery method selected.":"Add a delivery method first."} This notification will not send until a method is assigned.</p>`}</fieldset>`;
  return body;
}

function notificationProfiles(card) {
  const items=card.settingsDraft.notification_definitions.profiles||{},saved=card.configuration.settings.notification_definitions?.profiles||{};
  const id=card.definitionSelection?.kind==="profiles"?card.definitionSelection.id:null,active=items[id];
  if(active) {
    const uses=definitionUses(card.configuration.settings,"profiles",id);
    return `<section class="definition-editor installation-editor notification-profile-editor" aria-label="Edit notification"><header><h1>${saved[id]?`Edit notification: ${esc(active.name)}`:"New notification"}</h1>${button("close","Back to notifications","profiles",id,"","editor-back")}</header>${notificationProfileFields(card,id,active)}<p class="method-usage">${uses.length?`Changes apply to: ${uses.map(esc).join(", ")}.`:"No policies use this notification yet."}</p>${deletePrompt(card)}${scopedEditorFooter(card,{kind:"profile",id},"Save notification")}</section>`;
  }
  const list=notificationChoices(saved).map(([profileId,profile])=>{
    const uses=definitionUses(card.configuration.settings,"profiles",profileId),menuId=`notification-actions-${profileId}`;
    return `<article class="definition-list-item"><div><h3>${esc(profile.name)}</h3><p>${esc(timingSummary(profile.timing))}</p><p class="small">${profile.methods.map(method=>esc(card.configuration.settings.notification_definitions.methods[method]?.name||"Unavailable method")).join(", ")||"No delivery method selected"} · ${useCount(uses)}${scopedDirty(card,{kind:"profile",id:profileId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit notification","profiles",profileId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(profile.name)}" title="More actions"${card.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(profile.name)}">${button("duplicate","Duplicate","profiles",profileId)}${button("delete","Delete","profiles",profileId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([profileId])=>!saved[profileId]).map(([profileId,profile])=>`<p class="note">Unsaved notification: ${esc(profile.name)} ${button("edit","Continue editing","profiles",profileId)}</p>`).join("");
  return `<section class="reusable-definitions"><div class="policy-check-head">${button("add","Add notification","profiles","","","primary")}</div><div class="definition-list">${list||'<p>No saved notifications yet.</p>'}</div>${unsaved}${deletePrompt(card)}${card.scopedError?`<p class="config-error" role="alert">${esc(card.scopedError)}</p>`:""}</section>`;
}

export function namedNotifications(card) {
  initializeScopedConfiguration(card);
  const view=card.definitionSelection?.kind==="methods"?"methods":card.definitionSelection?.kind==="profiles"?"profiles":card.notificationSection==="methods"?"methods":"profiles";
  const selection=card.definitionSelection,editing=selection?.kind===view&&Boolean(card.settingsDraft.notification_definitions[view]?.[selection.id]);
  const nav=editing?"":`<nav class="installation-nav" aria-label="Notifications views">${button("notification-view","Notifications","profiles","",`aria-current="${view==="profiles"?"page":"false"}"`)}${button("notification-view","Delivery methods","methods","",`aria-current="${view==="methods"?"page":"false"}"`)}</nav>`;
  if(view==="profiles")return nav+notificationProfiles(card);
  const definitions=card.settingsDraft.notification_definitions;
  const kind="methods",items=definitions.methods;
  const active=card.definitionSelection?.kind===kind?items[card.definitionSelection.id]:null,id=active?card.definitionSelection.id:null;
  const saved=card.configuration.settings.notification_definitions?.methods||{};
  const list=Object.entries(saved).map(([itemId,item])=>{
    const menuId=`method-actions-${itemId}`,uses=definitionUses(card.configuration.settings,kind,itemId),summary=methodSummary(card,item);
    return `<article class="definition-list-item"><div><h3>${esc(item.name)}</h3>${summary?`<p class="method-summary">${esc(summary)}</p>`:""}<p class="small">${useCount(uses)}${scopedDirty(card,{kind:"method",id:itemId})?" · Unsaved changes":""}</p></div><div class="actions">${button("edit","Edit delivery method",kind,itemId)}<button type="button" class="button policy-actions-trigger" data-definition-action="policy-actions" popovertarget="${esc(menuId)}" aria-label="More actions for ${esc(item.name)}" title="More actions"${card.scopedBusy?" disabled":""}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button><div id="${esc(menuId)}" class="policy-actions-popover" popover role="group" aria-label="More actions for ${esc(item.name)}">${button("duplicate","Duplicate",kind,itemId)}${button("delete","Delete",kind,itemId)}</div></div></article>`;
  }).join("");
  const unsaved=Object.entries(items).filter(([itemId])=>!saved[itemId]).map(([itemId,item])=>`<p class="note">Unsaved delivery method: ${esc(item.name)} ${button("edit","Continue editing",kind,itemId)}</p>`).join("");
  const uses=active?definitionUses(card.configuration.settings,kind,id):[];
  const editor=active?`<section class="definition-editor installation-editor delivery-method-editor" aria-label="Edit delivery method"><header><h1>${saved[id]?`Edit delivery method: ${esc(active.name)}`:"New delivery method"}</h1>${button("close-method","Back to delivery methods",kind,id,"","editor-back")}</header>${methodFields(card,id,active,false)}<p class="method-usage">${uses.length?`Used by ${uses.map(esc).join(", ")}.`:"No notifications use this method yet."}</p>${methodTest(card,id,active)}${scopedEditorFooter(card,{kind:"method",id},"Save delivery method")}</section>`:`<div class="policy-check-head">${button("add","Add delivery method",kind,"","","primary")}</div><div class="definition-list method-list">${list||'<p>No saved delivery methods yet.</p>'}</div>${unsaved}`;
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
  card.policyValidation=null;
  card.settingsError=null;
  card.scopedError=null;card.scopedNotice=null;
  card.deliveryMethodTest=null;
}

function renderAfterEdit(card,element) {
  const dataset={...element.dataset},start=element.selectionStart,end=element.selectionEnd;
  const options=card.main?.querySelector?.(".policy-picker-options"),scroll=options?{top:options.scrollTop,left:options.scrollLeft}:null;
  card.render();
  const replacement=[...(card.main?.querySelectorAll?.("[data-definition-field],[data-row-field],[data-definition-picker-search],[data-definition-picker-selected],[data-definition-picker-all],[data-definition-delivery-search]")||[])].find(item=>Object.entries(dataset).every(([key,value])=>item.dataset[key]===value));
  (replacement||(element.closest?.(".policy-picker")?card.main?.querySelector?.("[data-definition-picker-search]"):null))?.focus?.({preventScroll:true});
  if(start!==null&&start!==undefined)replacement?.setSelectionRange?.(start,end);
  const next=card.main?.querySelector?.(".policy-picker-options");
  if(next&&scroll){next.scrollTop=scroll.top;next.scrollLeft=scroll.left;}
}

async function saveEditor(card,scope) {
  const selection=card.definitionSelection,page=card.page;
  const saved=await saveScopedConfiguration(card,scope);
  if(!saved||card.current?.status!=="current"||page!=="notifications"||card.page!==page||card.definitionSelection!==selection||
    !["method","profile"].includes(scope.kind)||scopedDirty(card,scope))return;
  const kind=scope.kind==="method"?"methods":"profiles",definition=card.configuration.settings.notification_definitions?.[kind]?.[scope.id];
  if(!definition)return;
  const previous=card.navigation?.capture();
  card.notificationSection=kind;card.definitionSelection=null;card.deliveryPicker=null;
  card.scopedNotice=null;card.render();card.navigation?.finish(previous);
  const edit=[...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionKind===kind&&element.dataset.definitionId===scope.id);
  edit?.scrollIntoView?.({block:"nearest"});edit?.focus?.({preventScroll:true});
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
  let notificationFocus;
  if(editDestinationPicker(card,event,element,invalidate,renderAfterEdit))return true;
  if(event.type==="click") {
    if(action==="save-scoped"||action==="discard-scoped") {
      const scope={kind:{policies:"policy",methods:"method",profiles:"profile",settings:"settings"}[kind],...(id?{id}:{})};
      if(card.scopedBusy)return true;
      if(action==="save-scoped") {
        const policy=scope.kind==="policy"?policies.find(item=>item.id===id):null;
        const validation=policy?.check==="temperature_limit"?temperatureValidation(policy):null;
        if(validation) {
          card.policyValidation={id,...validation};card.scopedStatusScope=`policy:${id}`;card.scopedError=validation.message;card.scopedNotice=null;card.render();
          card.main.querySelector?.(`[data-definition-field="parameters:${validation.field}"]`)?.focus?.();return true;
        }
        if([...(card.main.querySelectorAll?.(".installation-editor input, .installation-editor select")||[])].some(input=>!input.reportValidity()))return true;
        if(policy&&Object.values(policy.match||{}).some(values=>Array.isArray(values)&&!values.length)) {
          card.scopedStatusScope=`policy:${id}`;card.scopedError="Choose at least one source, area, or label, or choose All.";card.scopedNotice=null;card.render();return true;
        }
        void saveEditor(card,scope);
      }
      else {
        const exists=scope.kind==="policy"?card.configuration.settings.monitoring_policies?.some(policy=>policy.id===id):["method","profile"].includes(scope.kind)?Boolean(card.configuration.settings.notification_definitions?.[scope.kind==="method"?"methods":"profiles"]?.[id]):true;
        discardScopedConfiguration(card,scope);
        if(!exists)card.definitionSelection=null;
        card.deliveryPicker=null;card.policyValidation=null;card.render();
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
      card.notificationSection="methods";card.definitionSelection=null;card.deliveryPicker=null;card.methodCancel=null;card.render();
      [...(card.main.querySelectorAll?.('[data-definition-action="edit"]')||[])].find(element=>element.dataset.definitionId===id)?.focus({preventScroll:true});return true;
    }
    if(action==="test-method"){void testDeliveryMethod(card,id);return true;}
    if(action==="tab"){card.notificationSection=kind;card.definitionSelection=null;card.render();return true;}
    if(action==="edit"){if(["methods","profiles"].includes(kind))card.notificationSection=kind;card.definitionSelection={kind,id};card.deliveryPicker=null;card.methodCancel=null;card.deliveryMethodError=null;card.deliveryMethodNotice=null;card.render();if(kind==="methods"){card.main.querySelector?.('.notifications-content')?.scrollIntoView?.({block:"nearest"});card.main.querySelector?.('.delivery-method-editor [data-definition-field="name"]')?.focus({preventScroll:true});void card.loadDeliveryConfiguration?.(true);}return true;}
    if(action==="open-policy"){card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection=id?{kind:"policies",id}:null;card.page="policies";card.render();return true;}
    if(action==="open-notification"){card.detailSequence=(card.detailSequence||0)+1;card.detail=null;card.dialog?.close();card.definitionSelection={kind:"profiles",id};card.notificationSection="profiles";card.deliveryPicker=null;card.methodCancel=null;card.page="notifications";card.render();return true;}
    if(action==="close"){card.definitionSelection=null;card.policyCreating=false;card.policyPicker=null;card.render();return true;}
    if(action==="add"&&kind==="policies"){card.policyCreating=true;card.definitionSelection=null;card.render();return true;}
    if(action==="pick"||action==="pick-ignored"){const policy=policies.find(item=>item.id===id);if(policyType(policy)==="integration"&&policy.match.integration){policy.match={kind:["integration"],integration_domain:[]};}card.policyPicker={id,...(action==="pick-ignored"?{ignored:true}:{}),query:"",selectedOnly:false,showAll:false};card.render();card.main?.querySelector?.("[data-definition-picker-search]")?.focus({preventScroll:true});return true;}
    if(action==="more-choices"&&card.policyPicker?.id===id){const previous=card.policyPicker.limit||PICKER_PAGE_SIZE;card.policyPicker.limit=previous+PICKER_PAGE_SIZE;card.render();card.main?.querySelectorAll?.('.policy-picker [data-definition-value]')?.[previous]?.focus();return true;}
    if(action==="finish-pick"){const ignored=card.policyPicker?.ignored;card.policyPicker=null;card.render();card.main?.querySelector?.(`[data-definition-action="${ignored?"pick-ignored":"pick"}"]`)?.focus({preventScroll:true});return true;}
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
    }else if(action==="remove-row") {
      const rows=rowsFor(card,d.rowScope),index=rows.findIndex(row=>row.id===id);
      if(index>=0)rows.splice(index,1);
      notificationFocus={scope:d.rowScope,id:(rows[index]||rows[index-1])?.id||""};
    }else if(action==="add-sms") {
      const target=[...card.main.querySelectorAll("[data-sms-method]")].find(item=>item.dataset.smsMethod===id&&item.dataset.smsField===d.smsField&&item.dataset.smsService===d.smsService);
      if(!/^\+?[0-9]{5,15}$/.test(target?.value||"")){card.settingsError="Enter an SMS recipient with 5–15 digits, optionally starting with +.";card.render();return true;}
      const method=editableMethod(card,id),field=d.smsField;
      const owner=field.startsWith("person_destinations:")?(method.person_destinations??={}):method,key=field.startsWith("person_destinations:")?field.slice(20):field;
      owner[key]=[...new Set([...(owner[key]||[]),d.smsService+encodeURIComponent(target.value)])];
    }else return false;
  }else {
    if(d.definitionPickerSearch!==undefined){card.policyPicker.query=element.value;card.policyPicker.limit=PICKER_PAGE_SIZE;renderAfterEdit(card,element);return true;}
    if(d.definitionPickerAll!==undefined){card.policyPicker.showAll=element.checked;card.policyPicker.limit=PICKER_PAGE_SIZE;renderAfterEdit(card,element);return true;}
    if(d.definitionPickerSelected!==undefined){card.policyPicker.selectedOnly=element.checked;card.policyPicker.limit=PICKER_PAGE_SIZE;renderAfterEdit(card,element);return true;}
    if(d.definitionRestore!==undefined){card.policyRestoreIds=element.checked?[...card.policyRestoreIds,d.definitionRestore]:card.policyRestoreIds.filter(value=>value!==d.definitionRestore);card.render();return true;}
    if(d.definitionTemplate!==undefined){card.definitionTemplate=element.value;return true;}
    if(d.definitionDeleteResolution!==undefined){card.definitionDelete.resolution=element.value;card.render();return true;}
    if(d.rowScope) {
      const rows=rowsFor(card,d.rowScope),index=rows?.findIndex(item=>item.id===d.rowId),row=rows?.[index];
      if(d.rowField==="profile") {
        if(element.value) {
          if(!card.configuration.settings.notification_definitions?.profiles?.[element.value])return true;
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
        card.policyScopeChoice={policy:item,mode:element.value};
        const selector=element.value==="selected"?sourceField(item):element.value==="all_except"?"all":element.value;
        const members=devicePolicy(item)?memberExclusions(item):[];
        delete item.excluded_sources;
        if(element.value==="all_except"||members.length)item.excluded_sources=members;
        item.match={kind:[sourceKind(item)],...(selector==="all"?{}:{[selector]:[]})};card.policyPicker=null;
      }else if(field==="ignored-selection") {
        const values=item.excluded_sources||[];
        item.excluded_sources=element.checked?[...new Set([...values,d.definitionValue])]:values.filter(value=>value!==d.definitionValue);
        if(!item.excluded_sources.length)delete item.excluded_sources;
      }else if(field==="selection") {
        const mode=card.policyScopeChoice?.policy===item?card.policyScopeChoice.mode:watchMode(item),selector=mode==="selected"?sourceField(item):mode;
        const values=mode==="all_except"?item.excluded_sources||[]:item.match[selector]||[];
        const next=element.checked?[...new Set([...values,d.definitionValue])]:values.filter(value=>value!==d.definitionValue);
        if(mode==="all_except")item.excluded_sources=next;else item.match[selector]=next;
      }else if(field.startsWith("match:")) {
        const key=field.slice(6),values=element.value.split(",").map(value=>value.trim()).filter(Boolean);
        if(values.length)item.match[key]=values;else delete item.match[key];
      }else if(kind==="policies"&&field==="duration-unit:duration_seconds") {
        if(Object.hasOwn(DURATION_UNITS,element.value)) {
          card.policyDurationUnits??={};card.policyDurationUnits[`${id}:duration_seconds`]=element.value;
          renderAfterEdit(card,element);
        }
        return true;
      }else if(field.startsWith("parameters:")) {
        const key=field.slice(11);
        if(key==="unit"&&item.parameters.unit!==element.value) {
          const from=item.parameters.unit,to=element.value,difference=item.check==="thermostat";
          const keys=difference?["margin","progress","worsening"]:["minimum","maximum"];
          for(const threshold of keys)if(typeof item.parameters[threshold]==="number") {
            const value=item.parameters[threshold];
            const celsius=from==="°F"?(value-(difference?0:32))*5/9:from==="K"&&!difference?value-273.15:value;
            item.parameters[threshold]=to==="°F"?celsius*9/5+(difference?0:32):to==="K"&&!difference?celsius+273.15:celsius;
          }
        }
        if(key==="duration_seconds"&&Object.hasOwn(DURATION_UNITS,d.durationUnit)) {
          card.policyDurationUnits??={};card.policyDurationUnits[`${id}:duration_seconds`]=d.durationUnit;
        }
        if(element.type==="checkbox")item.parameters[key]=element.checked;
        else if(element.value==="")delete item.parameters[key];
        else if(key==="duration_seconds"&&Object.hasOwn(DURATION_UNITS,d.durationUnit)) {
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
  const editingTemperature=event.type!=="click"&&kind==="policies"&&element.type==="number"&&policies.find(item=>item.id===id&&item.check==="temperature_limit");
  if(editingTemperature) {
    // Keep native intermediate input such as a leading minus or trailing decimal.
    const rule=card.main?.querySelector?.(".policy-rule");
    if(rule)rule.textContent=temperatureRule(editingTemperature);
    card.main?.querySelector?.(".policy-section .config-error")?.remove?.();
    for(const field of card.main?.querySelectorAll?.('.unified-policy-editor [aria-invalid="true"]')||[]) {
      field.removeAttribute("aria-invalid");field.removeAttribute("aria-describedby");
    }
    const footer=card.main?.querySelector?.("[data-scoped-editor]");
    if(footer) {
      const template=document.createElement("template");
      template.innerHTML=scopedEditorFooter(card,{kind:"policy",id},"Save policy");
      if(!footer.isEqualNode(template.content.firstElementChild))footer.replaceWith(template.content);
    }
    card.renderedContent=null;
    return true;
  }
  renderAfterEdit(card,element);
  if(notificationFocus) {
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
