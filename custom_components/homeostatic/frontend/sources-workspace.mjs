import {sourceReporting} from "./reporting.mjs?v=74";
import {applicablePolicyLinks} from "./reusable-editors.mjs?v=74";
import {sourceHistory as renderSourceHistory} from "./source-history.mjs?v=74";
import {escapeHtml as esc, inventoryRows, locationTree, sortedEpisodes} from "./model.mjs?v=74";
import {monitoringTree} from "./configuration.mjs?v=74";
import {batteryProblem, integrationProblem, vacuumProblem} from "./problem.mjs?v=74";

import {deviceAvailability, deviceEntityName} from "./device-availability.mjs?v=74";
import {upsSourceSummary} from "./ups.mjs?v=74";
import {availabilityMonitoring, prepareAvailabilityChange, applyAvailabilityChange, undoAvailabilityChange} from "./source-monitoring.mjs?v=74";

const key = (...parts) => JSON.stringify(parts);
const byName = (a,b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
const sourceName = source => source.name?.trim() || (source.kind === "integration" ? "Unnamed connection" : source.kind === "device" ? "Unnamed device" : source.kind === "battery" ? "Battery" : source.kind === "vacuum" ? "Vacuum" : "Unnamed entity");
const sourceNode = source => ({key:`source:${source.node_id}`,name:sourceName(source),type:source.kind,source,children:[]});
const unique = (items, identity = item => item.key) => [...new Map(items.map(item => [identity(item),item])).values()];
const displayDate = value => value ? new Date(value).toLocaleString() : "Time not reported";
const familyDevices = family => unique([...sourcePaths(family.children).values()].map(item=>item.node).filter(node=>node.type==="device"));

/** Present one real source while retaining each independent monitoring check. */
export function canonicalSources(data) {
  const rows=inventoryRows(data), groups=new Map();
  for(const row of rows) {
    const id=row.monitoring_source||row.node_id;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  return [...groups].map(([id,members])=>{
    const base=members.find(source=>source.node_id===id)||members[0];
    const checks=members.flatMap(source=>source.monitoring_checks||((source.monitoring_policy||source.watched)?[source]:[]));
    const suffix=base.monitoring_policy?.name?` · ${base.monitoring_policy.name}`:"";
    return {...base,node_id:id,name:suffix&&base.name?.endsWith(suffix)?base.name.slice(0,-suffix.length):base.name,
      watched:members.some(source=>source.watched),
      availability_entities:[...new Set(members.flatMap(source=>source.availability_entities||[]))],
      source_aliases:[...new Set(members.flatMap(source=>source.source_aliases||[source.node_id]))],monitoring_checks:checks};
  });
}

function canonicalData(data) {
  if(data.canonical_source_rows)return data;
  return {...data,canonical_source_rows:true,inventory:{...data.inventory,nodes:canonicalSources(data),catalog:{...data.inventory.catalog,candidates:[]}}};
}

/** Use the integration type, preserving individual connections below a family. */
export function integrationFamilies(data, localize = () => null) {
  data=canonicalData(data);
  const families = new Map();
  for (const group of monitoringTree(data)) {
    const domain = group.entry?.attributes?.domain?.[0];
    const id = domain || group.id || "other";
    if (!families.has(id)) families.set(id,{id,domain,name:domain ? localize(`component.${domain}.title`) || ({wiz:"WiZ",esphome:"ESPHome",eero:"Eero"})[domain] || domain.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()) : group.name?.trim() || (group.entry?"Unnamed connection":"Other sources"),groups:[]});
    families.get(id).groups.push(group);
  }
  return [...families.values()].map(family => {
    const devices = new Map();
    for (const group of family.groups) for (const device of group.devices) {
      const existing = devices.get(device.id);
      devices.set(device.id,existing ? {...existing,summary:existing.summary || device.summary,entities:unique([...existing.entities,...device.entities],item=>item.node_id)} : {...device});
    }
    const entries = family.groups.flatMap(group=>group.entry?[group.entry]:[]);
    const entryIds=new Set(entries.map(entry=>entry.entry_id));
    const registryOwners=new Map((data.devices||[]).map(device=>[device.id,device.config_entry_id]));
    const deviceNodes=[...devices.values()].map(device=>({key:device.summary?`source:${device.summary.node_id}`:`device:${device.id}`,name:device.name?.trim()||"Unnamed device",type:"device",source:device.summary,device,owner:registryOwners.get(device.id),children:device.entities.map(sourceNode).sort(byName)}));
    const children=[];
    if(entries.length>1) {
      const assigned=new Set();
      for(const entry of entries) {
        const owned=deviceNodes.filter(device=>device.owner===entry.entry_id);
        const loose=unique(family.groups.filter(group=>group.id===entry.entry_id).flatMap(group=>group.loose).map(sourceNode));
        owned.forEach(device=>assigned.add(device.key));
        if(owned.length===1&&owned[0].source&&!loose.length) {
          children.push({...owned[0],connection:entry});
        } else {
          children.push({...sourceNode(entry),children:[...owned,...loose].sort(byName)});
        }
      }
      children.push(...deviceNodes.filter(device=>!assigned.has(device.key)));
      children.push(...unique(family.groups.filter(group=>!entryIds.has(group.id)).flatMap(group=>group.loose).map(sourceNode)));
    } else {
      const loose=unique(family.groups.flatMap(group=>group.loose).map(sourceNode));
      const paired=Boolean(entries.length===1&&deviceNodes.length===1&&!loose.length&&deviceNodes[0].source&&deviceNodes[0].owner===entries[0].entry_id);
      children.push(...deviceNodes.map(device=>paired?{...device,connection:entries[0]}:device),...loose);
    }
    return {...family,key:entries.length===1?`source:${entries[0].node_id}`:key("family",family.id),type:"integration",source:entries.length===1?entries[0]:null,entries,children:children.sort((a,b)=>Number(a.type==="integration")-Number(b.type==="integration")||byName(a,b)),family:true};
  }).sort(byName);
}

/** Build a presentation tree from Topomation's read-only location response. */
export function topomationTree(data,topomation) {
  const locations=topomation?.locations;
  if(!Array.isArray(locations)||!locations.length)return null;
  data=canonicalData(data);
  const byId=new Map();
  for(const location of locations) {
    if(!location||typeof location.id!=="string"||!location.id||byId.has(location.id))return null;
    byId.set(location.id,{key:`location:topomation:${location.id}`,name:String(location.name||location.id),type:"location",children:[],location});
  }
  const roots=[];
  for(const node of byId.values()) {
    const parent=node.location.parent_id;
    const seen=new Set([node.location.id]);
    let ancestor=parent;
    while(ancestor&&byId.has(ancestor)) {
      if(seen.has(ancestor))return null;
      seen.add(ancestor);
      ancestor=byId.get(ancestor).location.parent_id;
    }
    if(parent&&byId.has(parent))byId.get(parent).children.push(node);
    else roots.push(node);
  }
  const ordered=(a,b)=>(Number(a.location.order)||0)-(Number(b.location.order)||0)||a.name.localeCompare(b.name);
  const areaLocations=new Map(),entityLocations=new Map();
  for(const node of byId.values()) {
    if(node.location.ha_area_id&&!areaLocations.has(node.location.ha_area_id))areaLocations.set(node.location.ha_area_id,node);
    for(const id of Array.isArray(node.location.entity_ids)?node.location.entity_ids:[])if(typeof id==="string"&&!entityLocations.has(id))entityLocations.set(id,node);
  }
  const assigned=new Map(),unassigned=[];
  for(const source of inventoryRows(data).filter(item=>["entity","device","battery","vacuum"].includes(item.kind))) {
    const location=entityLocations.get(source.entity_id)||
      (source.attributes?.area||[]).map(id=>areaLocations.get(id)).find(Boolean);
    if(location) {
      if(!assigned.has(location.key))assigned.set(location.key,[]);
      assigned.get(location.key).push(source);
    } else unassigned.push(source);
  }
  const attach=node=>{
    node.children.sort(ordered).forEach(attach);
    const devices=new Map();
    for(const source of assigned.get(node.key)||[]) {
      const deviceId=source.attributes?.device?.[0];
      if(deviceId) {
        if(!devices.has(deviceId))devices.set(deviceId,{key:`device:${deviceId}`,name:data.devices?.find(item=>item.id===deviceId)?.name||deviceId,type:"device",children:[]});
        const device=devices.get(deviceId);
        if(source.kind==="device") {device.key=`source:${source.node_id}`;device.source=source;}
        else device.children.push(sourceNode(source));
      } else node.children.push(sourceNode(source));
    }
    node.children.push(...devices.values());
  };
  roots.sort(ordered).forEach(attach);
  if(unassigned.length)roots.push({key:"location:topomation:unassigned",name:"Unassigned",type:"location",children:unassigned.map(sourceNode).sort(byName)});
  return roots;
}

/** Organize one inventory by integration family or location. */
export function sourcesTree(data,grouping = "integration",localize = () => null,topomation = null,showDisabled = true) {
  data=canonicalData(data);
  if(!showDisabled)data={...data,inventory:{...data.inventory,nodes:data.inventory.nodes.filter(source=>!source.disabled)}};
  const tree=groupedSources(data,grouping,localize,topomation);
  const present=sourcePaths(tree);
  const situations=inventoryRows(data).filter(source=>source.kind==="situation"&&!present.has(`source:${source.node_id}`)).map(sourceNode);
  if(situations.length)tree.push({key:"situations",name:"Configured situations",type:"location",children:situations});
  for(const [kind,name] of [["broken_automation","Automations"],["repair","Home Assistant Repairs"]]) {
    const rows=inventoryRows(data).filter(source=>source.kind===kind&&!present.has(`source:${source.node_id}`)).map(sourceNode);
    if(rows.length)tree.push({key:kind,name,type:"location",children:rows});
  }
  const placed=sourcePaths(tree);
  const remaining=inventoryRows(data).filter(source=>!placed.has(`source:${source.node_id}`)).map(sourceNode);
  if(remaining.length)tree.push({key:"other-checks",name:"Other monitored checks",type:"location",children:remaining});
  return tree;
}

function groupedSources(data,grouping,localize,topomation) {
  localize ||= () => null;
  if(grouping === "integration") return integrationFamilies(data,localize);
  const topology=grouping === "topomation" ? topomationTree(data,topomation) : null;
  if(topology) {
    const entries=inventoryRows(data).filter(source=>source.kind==="integration").map(sourceNode).sort(byName);
    if(entries.length)topology.push({key:"location:other-sources",name:"Integration connections",type:"location",children:entries});
    return topology;
  }
  const convert = location => {
    const places=location.children.map(convert);
    // A floor's device list is the rollup of its areas, kept for summaries. Showing it here repeats those sources beside the rooms.
    const sources=places.length?[]:[...location.devices.map(device=>{
      const summary=device.sources.find(source=>source.kind==="device");
      return {key:summary?`source:${summary.node_id}`:`device:${device.id}`,name:device.name?.trim()||"Unnamed device",type:"device",source:summary,device,children:device.sources.filter(source=>["entity","battery","vacuum"].includes(source.kind)).map(sourceNode).sort(byName)};
    }),...location.signals.filter(source=>["entity","battery","vacuum"].includes(source.kind)).map(sourceNode)];
    return {key:`location:${location.id}`,name:location.name,type:"location",location,children:[...places,...sources].sort(byName)};
  };
  const roots=locationTree(data).map(convert);
  const entries=inventoryRows(data).filter(source=>source.kind==="integration").map(source=>({...sourceNode(source),name:integrationProblem(source,[],localize).integration+" / "+sourceName(source)})).sort(byName);
  if(entries.length) roots.push({key:"location:other-sources",name:"Integration connections",type:"location",children:entries});
  return roots;
}

/** Search the complete inventory while retaining readable ancestor paths. */
export function filterSources(tree,query = "",needsReview = false,gaps = new Map()) {
  const needle=query.trim().toLocaleLowerCase();
  const visit=(nodes,parentMatch=false)=>nodes.flatMap(node=>{
    const match=parentMatch||[node.name,node.source?.entity_id,node.connection?.name].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
    const children=visit(node.children,match);
    const review=!needsReview||gaps.has(node.source?.node_id)||gaps.has(node.connection?.node_id)||children.length;
    return review&&(match||children.length||!needle)?[{...node,children}]:[];
  });
  return visit(tree);
}

export function sourcePaths(tree) {
  const paths=new Map();
  const add=(node,parents)=>{const item={node,parents};if(!paths.has(node.key))paths.set(node.key,item);for(const id of node.source?.source_aliases||[])if(!paths.has(`source:${id}`))paths.set(`source:${id}`,item);};
  const visit=(nodes,parents)=>{for(const node of nodes){add(node,parents);if(node.connection)add(sourceNode(node.connection),parents);visit(node.children,[...parents,node]);}};
  visit(tree,[]);return paths;
}

/** Keep old issue and notification links attached to their real source. */
export function canonicalSourceSelection(tree,selection) {
  return sourcePaths(tree).get(selection)?.node.key||selection;
}

function monitoringState(source,included) {
  if(source.disabled)return "Monitoring paused while disabled";
  if(source.kind==="entity")return source.watched?included.has(source.entity_id)?"Device and entity checks":"Entity check":included.has(source.entity_id)?"Device check":"Not monitored";
  return source.watched?"Monitored":"Not monitored";
}

function includedEntities(data) {
  return new Set(inventoryRows(data).filter(row=>row.kind==="device"&&row.watched).flatMap(row=>row.availability_entities||[]));
}

function sourceReport(card,node,episodes) {
  const source=node.source,data=card.current.data;
  const evidence=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  if(!evidence||evidence.loading)return '<p class="sub" role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  const linked=episodes.filter(item=>item.anchor===source.node_id);
  if(source.kind==="ups")return upsSourceSummary(card,source,card.sourceDetail?.entity_status||data.inventory.ups_status?.[source.node_id],Boolean(linked.length))+applicablePolicyLinks(card,source)+linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">View issue</button>`).join("");
  if(source.kind==="battery"){
    const condition=evidence.battery_condition;
    const problem=batteryProblem(source,{current:condition},Boolean(linked.length));
    const policyConditions=evidence.battery_conditions;
    const assessment=Array.isArray(policyConditions)?policyConditions.map(item=>{
      const current=item.condition,details=batteryProblem(source,{current},false);
      const threshold=current.evidence?.threshold;
      return `<section class="source-condition${current.status==="warn"?' needs-attention':''}" data-battery-policy="${esc(item.policy_id)}"><h3>${esc(item.policy_name)}</h3><h4>${esc(details.headline)}</h4>${threshold!==undefined?`<p class="small">Low battery threshold: at or below ${esc(threshold)}%.</p>`:""}<p>${esc(current.message||details.summary)}</p><p><strong>Next step:</strong> ${esc(details.nextStep)}</p></section>`;
    }).join("")||'<p class="small">No enabled battery policy is watching this source. Its readings remain available below.</p>':`<section class="source-condition${condition?.status==="warn"?' needs-attention':''}"><h3>${esc(problem.headline)}</h3><p>${esc(condition?.message||problem.summary)}</p><p><strong>Next step:</strong> ${esc(problem.nextStep)}</p></section>${!source.watched?'<p class="small">Battery monitoring is off. Review the choice in Settings before saving.</p>':''}`;
    const rows=evidence.members||[];
    const deviceId=source.attributes?.device?.[0];
    const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
    return `${assessment}<section class="source-section"><h3>Battery evidence</h3><table class="source-readings"><tbody>${rows.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.restored?'Restored state':item.state)}</td></tr>`).join('')}</tbody></table><p class="small">Home Assistant values do not prove physical freshness. Charging clears this low condition; it does not prove a full charge or replacement.</p></section>${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">Problem actions</button>`).join('')}${href?`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`:''}`;
  }
  if(source.kind==="vacuum"){
    const activity=evidence.vacuum_activity;
    const problem=vacuumProblem(source,{current:activity},data.areas,Boolean(linked.length));
    const deviceId=source.attributes?.device?.[0];
    const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
    return `<section class="source-condition${activity?.status==="fail"?' needs-attention':''}"><h3>${esc(problem.headline)}</h3><p>${esc(activity?.message||problem.summary)}</p><p><strong>Next step:</strong> ${esc(problem.nextStep)}</p></section>${!source.watched?'<p class="small">Vacuum monitoring is off. Review the choice in Settings before saving.</p>':''}<p class="small">A notification names the area Home Assistant has assigned to this vacuum, when it has one.</p>${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">Problem actions</button>`).join('')}${href?`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`:''}`;
  }
  return "";
}

function sourceHistory(card,node) {
  const data=card.current.data,source=node.source;
  const direct=new Set([source.node_id,...(source.source_aliases||[])]);
  const retained=data.inventory.resolved_history;
  const ended=(retained?.episodes||[]).filter(item=>{
    const recorded=item.source,base=recorded?.monitoring_source||recorded?.node_id||item.episode.anchor;
    if(direct.has(base)||issueMembers(item.episode).some(id=>direct.has(id)))return true;
    if(source.kind==="integration"&&source.entry_id)return recorded?.owner_id===source.entry_id||recorded?.attributes?.integration?.includes(source.entry_id);
    if(source.kind==="device")return recorded?.attributes?.device?.some(id=>source.attributes?.device?.includes(id));
    return false;
  });
  const open=relatedIssues(node,data.inventory.episodes);
  const rows=inventoryRows(data),names=new Map(rows.map(item=>[item.node_id,item]));
  const sources=[source,...open.map(episode=>names.get(episode.anchor)||{node_id:episode.anchor}),...ended.map(item=>({...item.source,node_id:item.episode.anchor}))];
  const limited=["integration","device"].includes(source.kind)?'<p class="small">Older child issues without recorded ownership are available in the full issue history.</p><button type="button" class="link" data-page="history">View full issue history</button>':"";
  return renderSourceHistory({...data,inventory:{...data.inventory,episodes:open,resolved_history:retained?{...retained,episodes:ended}:undefined}},sources)+limited;
}

const sourceType = source => ({integration:"Integration connection",device:"Device",entity:"Entity",battery:"Battery condition",vacuum:"Vacuum condition",ups:"UPS check",thermostat:"Thermostat check",temperature_limit:"Temperature check",broken_automation:"Automation",repair:"Repair",situation:"Situation"}[source?.kind]||"Check");
const issueMembers = episode => [...new Set([episode.anchor,...(episode.recorded||[]),...(episode.reasons||[]).map(finding=>finding.node_id)].filter(Boolean))];
const sourceIds = node => new Set([...sourcePaths([node]).keys()].filter(id=>id.startsWith("source:")).map(id=>id.slice(7)));
const relatedIssues = (node,episodes) => {const ids=sourceIds(node);return episodes.filter(episode=>issueMembers(episode).some(id=>ids.has(id)));};

function sourcePolicies(card,node) {
  const source=node.source;
  if(!source)return "";
  const detail=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  const policies=new Map((detail?.monitoring_policies||[]).map(policy=>[policy.id,{...policy,contexts:new Set()}]));
  const saved=card.configuration?.settings?.monitoring_policies||[];
  const ids=new Set(source.source_aliases||[source.node_id]);
  const names=new Map(canonicalSources(card.current.data).map(item=>[item.node_id,item.name]));
  for(const check of inventoryRows(card.current.data)) {
    const direct=ids.has(check.node_id)||check.monitoring_source===source.node_id;
    const device=source.kind==="entity"&&check.kind==="device"&&check.watched&&check.availability_entities?.includes(source.entity_id);
    if((!direct&&!device)||!check.monitoring_policy)continue;
    const id=check.monitoring_policy,policy=saved.find(item=>item.id===id);
    if(!policies.has(id))policies.set(id,{id,name:policy?.name||id,contexts:new Set()});
    policies.get(id).contexts.add(device?`Uses this entity to assess ${names.get(check.monitoring_source||check.node_id)||"its device"}.`:check.kind==="entity"?"Checks this entity's availability individually.":check.kind==="device"?"Assesses this device using its selected entities.":check.kind==="integration"?"Checks whether this integration is loaded.":"Monitors this check.");
  }
  const content=!policies.size?`<p>${source.kind==="entity"&&includedEntities(card.current.data).has(source.entity_id)?"This entity contributes to its device’s availability check.":source.watched?"Monitoring is enabled for this source.":"No enabled policy is monitoring this source."}</p><button type="button" class="link" data-page="policies">View monitoring policies</button>`:[...policies.values()].map(policy=>`<div class="source-policy"><div><p><strong>${esc(policy.name)}</strong></p>${[...policy.contexts].map(context=>`<p>${esc(context)}</p>`).join("")}</div><button type="button" class="link" data-definition-action="open-policy" data-definition-kind="policies" data-definition-id="${esc(policy.id)}">Edit policy “${esc(policy.name)}”</button></div>`).join("");
  return `<details class="source-section source-monitoring-explanation" data-ui-key="source-monitoring:${esc(node.key)}"><summary>${policies.size?"Why this is monitored":"Monitoring"}</summary>${content}</details>`;
}

function sourceHeaderMetadata(card,source) {
  if(!source||!["entity","device"].includes(source.kind))return "";
  const deviceId=source.attributes?.device?.[0];
  const href=source.kind==="entity"?(source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:""):deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:"";
  const action=source.kind==="entity"?"View entity in Home Assistant":"Open device in Home Assistant";
  return href?`<a class="link" href="${esc(href)}">${action}</a>`:"";
}

function sourceTechnicalDetails(card,node) {
  const source=node.source;
  if(!source||!["entity","device"].includes(source.kind))return "";
  const detail=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null,updated=detail?.updated_at;
  if(!source.entity_id&&!updated)return "";
  return `<details class="source-section source-technical" data-ui-key="source-technical:${esc(node.key)}"><summary>Technical details</summary>${source.entity_id?`<p class="source-entity-id">Entity ID: ${esc(source.entity_id)}</p>`:""}${updated?`<p class="small source-updated">Homeostatic updated <time datetime="${esc(updated)}">${esc(displayDate(updated))}</time></p>`:""}</details>`;
}

function availabilityActions(card,node) {
  const source=node.source;
  if(!source||!["entity","device"].includes(source.kind))return "";
  const updating=card.current.data?.catalog_stale||card.current.data?.catalog_loaded===false;
  const disabled=card.current.status!=="current"||card.settingsBusy||card.configBusy||!card.configuration?.settings||updating;
  const state=source.kind==="entity"?availabilityMonitoring(card,source):null;
  const operation=card.availabilityPlan;
  const selected=card.availabilitySelected?.nodeId===source.node_id?card.availabilitySelected:null;
  const action=(mode,label,id=source.node_id)=>`<button type="button" class="button" data-availability-action="${mode}" data-availability-source="${esc(id)}"${disabled?' disabled':''}>${label}</button>`;
  const controls=operation&&card.availabilityContext===source.node_id?"":source.kind==="entity"?`${state.canStop?action("stop","Stop monitoring availability…"):""}${state.canResume?action("resume","Resume monitoring…"):""}`:action(selected?"cancel-selection":"select",selected?"Cancel selection":"Select entities…");
  const choices=selected?[...selected.ids].map(id=>availabilityMonitoring(card,id)):[];
  const batch=selected?.ids.size?`<div class="source-actions"><span>${selected.ids.size} selected</span>${choices.some(item=>item.canStop)?action("stop-selected","Stop monitoring selected…"):""}${choices.some(item=>item.canResume)?action("resume-selected","Resume selected…"):""}</div>`:"";
  const confirmation=operation&&card.availabilityContext===source.node_id?`<section class="source-availability-confirm" aria-label="Change availability monitoring"><h3>${operation.mode==="stop"?"Stop monitoring availability?":"Resume availability monitoring?"}</h3><ul>${operation.sources.map(item=>`<li>${esc(item.name)}${item.entityId?` <span class="small">${esc(item.entityId)}</span>`:""}</li>`).join("")}</ul><p>${operation.mode==="stop"?"Remove these entities from individual availability checks and device availability evidence in the policies below. Other checks and Home Assistant entities stay unchanged.":"Remove these entities’ explicit exclusions from the policies below. Each policy’s enabled state, scope and source eligibility still apply."}</p><ul>${operation.changes.map(item=>`<li>${esc(item.name)}${item.after?.enabled===false?" (disabled)":""}</li>`).join("")}</ul><div class="actions">${action("confirm",card.scopedBusy==="source-availability"?"Saving…":operation.mode==="stop"?"Stop monitoring availability":"Resume monitoring")}${action("cancel","Cancel")}</div></section>`:"";
  const feedback=card.availabilityContext===source.node_id?`${card.availabilityError?`<p class="config-error" role="alert">${esc(card.availabilityError)}</p>${card.scopedConfiguration?.needsRefresh?action("refresh","Refresh saved monitoring"):""}`:""}${card.availabilityNotice?`<p role="status">${esc(card.availabilityNotice)} ${card.availabilityUndo?action("undo","Undo"):""}</p>`:""}`:"";
  return `<div class="source-actions">${sourceHeaderMetadata(card,source)}${controls}</div>${updating?'<p class="small" role="status">Updating monitoring scope…</p>':""}${batch}${confirmation}${feedback}`;
}

/** Handle only explicit source availability actions over the existing policy owner. */
export function editSourceAvailability(card,event) {
  const selection=event.target.matches?.("[data-availability-select]")?event.target:null;
  const button=event.target.closest?.("[data-availability-action]");
  if(!selection&&!button)return false;
  if(card.current.status!=="current"||card.settingsBusy||card.configBusy)return true;
  if(selection) {
    const selected=card.availabilitySelected;
    if(!selected)return true;
    selection.checked?selected.ids.add(selection.dataset.availabilitySelect):selected.ids.delete(selection.dataset.availabilitySelect);
    card.availabilityPlan=null;card.render();return true;
  }
  const action=button.dataset.availabilityAction,sourceId=button.dataset.availabilitySource;
  card.availabilityContext=sourceId;
  card.availabilityError=null;
  if(action==="select")card.availabilitySelected={nodeId:sourceId,ids:new Set()};
  else if(action==="cancel-selection"){card.availabilitySelected=null;card.availabilityPlan=null;}
  else if(action==="cancel")card.availabilityPlan=null;
  else if(action==="refresh") {
    card.loadConfiguration().then(()=>{
      if(card.configError)card.availabilityError=card.configError;
      else {card.availabilityPlan=null;card.availabilityUndo=null;card.availabilityNotice="Saved monitoring refreshed. Review the current scope before another change.";card.loadSource?.(true);}
      card.render();
      card.shadowRoot?.querySelector('[data-availability-action="resume"], [data-availability-action="stop"], [data-availability-action="refresh"], #sources-detail-title')?.focus({preventScroll:true});
    });
    return true;
  }
  else if(action==="confirm"||action==="undo") {
    const operation=action==="undo"?undoAvailabilityChange(card):applyAvailabilityChange(card,card.availabilityPlan);
    operation.then(saved=>{
      if(saved){card.availabilityPlan=null;card.availabilitySelected=null;card.loadSource?.(true);}
      else if(card.availabilityPlan?.revision!==card.configuration?.revision||card.availabilityPlan?.catalogRevision!==card.current.data?.catalog_revision)card.availabilityPlan=null;
      card.render();
      card.shadowRoot?.querySelector('[data-availability-action="undo"], [data-availability-action="confirm"], #sources-detail-title')?.focus({preventScroll:true});
    }).catch(error=>{card.availabilityError=error.message||"Could not complete this action. Read current saved settings before trying again.";card.render();});
    return true;
  }else {
    const ids=action.endsWith("-selected")?[...card.availabilitySelected.ids]:[sourceId];
    try {card.availabilityPlan=prepareAvailabilityChange(card,ids,action.startsWith("resume")?"resume":"stop");card.availabilityNotice=null;}
    catch(error){card.availabilityError=error.message;}
  }
  card.render();
  card.shadowRoot?.querySelector(card.availabilityPlan?'[data-availability-action="confirm"]':'[data-availability-action="stop"], [data-availability-action="resume"], [data-availability-action="select"]')?.focus({preventScroll:true});
  return true;
}

function sourceIntegrationName(card,source) {
  const entry=inventoryRows(card.current.data).find(item=>item.kind==="integration"&&((source.owner_id&&item.entry_id===source.owner_id)||source.attributes?.integration?.includes(item.entry_id)));
  const domain=source.attributes?.integration_domain?.[0]||entry?.attributes?.domain?.[0];
  return domain&&(card._hass?.localize?.(`component.${domain}.title`)||domain.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()));
}

function currentSourceEvidence(card,node,episodes) {
  const source=node.source,data=card.current.data;
  if(!source)return node.family?`<p>${node.entries.length} Home Assistant connections · ${familyDevices(node).length} devices</p><details class="source-section source-connections"><summary>${node.entries.length} Home Assistant connections</summary>${node.entries.map(entry=>`<button type="button" class="source-child" data-sources-select="source:${esc(entry.node_id)}"><span>${esc(sourceName(entry))}</span><small>View connection</small></button>`).join("")}</details>`:`<p>${node.children.length} items in this group.</p>`;
  if(source.disabled)return '<section class="source-condition"><h3>Disabled in Home Assistant</h3><p>Monitoring paused while disabled. Saved monitoring choices resume when re-enabled.</p></section>';
  const evidence=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  if(!evidence||evidence.loading)return '<p role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  if(["battery","vacuum","ups"].includes(source.kind))return sourceReport(card,node,episodes);
  const members=evidence.members||[],unavailable=evidence.unavailable_count??members.filter(item=>item.state==="unavailable"&&!item.restored).length;
  const unknown=evidence.unknown_count??members.filter(item=>item.state==="missing"||item.restored).length;
  const observed=evidence.entity_status?.current||evidence.entity_status;
  const updated=evidence.updated_at?`<p class="small source-updated">Homeostatic updated ${esc(displayDate(evidence.updated_at))}</p>`:"";
  let title="",body="",readings="",href="",action="Open in Home Assistant";
  if(source.kind==="entity") {
    const member=members.find(item=>item.entity_id===source.entity_id)||members[0];
    title=source.disabled?"Disabled in Home Assistant":member?.restored?`No longer provided by ${sourceIntegrationName(card,source)||"its integration"}`:member?.state==="unavailable"?"Unavailable in Home Assistant":!member||member.state==="missing"?"No current Home Assistant state":member.state==="unknown"?"Home Assistant reports no value":"Available in Home Assistant";
    if(!source.disabled&&member?.restored)body="<p>Home Assistant retains this entity’s registration, but its integration is not currently providing it. There is no current reading.</p>";
    else if(!source.disabled&&member?.state==="unavailable")body="<p>Home Assistant cannot obtain this entity’s state right now.</p>";
    else if(!source.disabled&&(!member||member.state==="missing"))body="<p>Home Assistant has no state for this entity, so its availability cannot be confirmed.</p>";
    else if(!source.disabled&&member?.state==="unknown")body="<p>The entity is available through Home Assistant, but it has no value to report.</p>";
    if(member&&!member.restored&&!['unavailable','missing','unknown'].includes(member.state))body=`<p>Current value: ${esc(member.state)}${esc(member.unit?`${member.unit==="%"?"":" "}${member.unit}`:"")}</p>`;
  } else if(source.kind==="device") {
    const total=evidence.total??members.length;
    const scope=source.watched?"monitored ":"";
    title=source.disabled?"Disabled in Home Assistant":!source.watched?"Device availability is not monitored":!total?"No entities selected for device availability":unavailable?`${unavailable} of ${total} monitored ${total===1?"entity is":"entities are"} unavailable`:unknown?unknown===total?`No current readings from ${total} monitored ${total===1?"entity":"entities"}`:`${unknown} of ${total} monitored ${total===1?"entity has":"entities have"} no current reading`:"Monitored entities are available";
    body=deviceAvailability(evidence.device_availability,true);
    if(!source.disabled&&unknown) {
      if(unavailable)body+=`<p>${unknown} ${scope}${unknown===1?"entity has":"entities have"} no current ${unknown===1?"reading":"readings"}.</p>`;
      if(members.some(item=>item.restored))body+="<p>Home Assistant still lists the entities marked ‘Not provided by integration’, but their integrations are not currently providing them. Their availability cannot be confirmed.</p>";
      if(members.some(item=>item.state==="missing"&&!item.restored))body+="<p>Home Assistant has no state for the entities marked ‘No current state’.</p>";
    }
    const selection=card.availabilitySelected?.nodeId===source.node_id?card.availabilitySelected:null;
    const render=items=>`<table class="source-readings"><thead><tr><th>Entity</th><th>Current state</th></tr></thead><tbody>${items.map(item=>`<tr><td>${selection?`<label class="source-member-select"><input type="checkbox" data-availability-select="${esc(item.node_id)}"${selection.ids.has(item.node_id)?" checked":""}${card.settingsBusy?' disabled':''}><span class="sr-only">Select ${esc(item.name)}</span></label>`:""}<button type="button" class="link" data-source-link="${esc(item.node_id)}">${esc(deviceEntityName(item.name,node.name))}</button></td><td>${esc(item.restored?"Not provided by integration":item.state==="missing"?"No current state":item.state==="unknown"?"Available · no value":item.state==="unavailable"?"Unavailable":item.state)}</td></tr>`).join("")}</tbody></table>`;
    const review=members.filter(item=>['unavailable','missing'].includes(item.state)||item.restored);
    const other=members.filter(item=>!review.includes(item));
    if(review.length)readings+=`<section class="source-section"><h3>${source.watched?"Entities needing review":"Unavailable or missing entities"}</h3>${render(review)}</section>`;
    if(other.length)readings+=`<details class="source-section" data-ui-key="source-other-entities:${esc(node.key)}"><summary>${other.length} other ${scope}${other.length===1?"entity":"entities"}</summary>${render(other)}</details>`;
    if(total>members.length)readings+=`<p class="small">${members.length} of ${total} entity readings loaded.</p><button type="button" class="button" data-action="more-source-evidence"${evidence.moreLoading?' disabled':''}>${evidence.moreLoading?'Loading entities…':'Load more entities'}</button>${evidence.moreError?`<p role="alert">${esc(evidence.moreError)}</p>`:""}`;
    const excluded=node.children.filter(child=>child.source?.kind==="entity"&&!members.some(member=>member.node_id===child.source.node_id)&&availabilityMonitoring(card,child.source).canResume);
    if(excluded.length)readings+=`<details class="source-section source-excluded-members" data-ui-key="source-excluded:${esc(node.key)}"><summary>${excluded.length} ${excluded.length===1?"entity with an availability exclusion":"entities with availability exclusions"}</summary><p class="small">Select entities to remove their explicit policy exclusions. Current readings remain available in each entity’s details.</p>${excluded.map(child=>`<div class="source-child">${selection?`<label class="source-member-select"><input type="checkbox" data-availability-select="${esc(child.source.node_id)}"${selection.ids.has(child.source.node_id)?" checked":""}${card.settingsBusy?' disabled':''}><span class="sr-only">Select ${esc(child.name)}</span></label>`:""}<button type="button" class="link" data-source-link="${esc(child.source.node_id)}">${esc(deviceEntityName(child.name,node.name))}</button></div>`).join("")}</details>`;
  } else if(source.kind==="integration") {
    const current=evidence.integration_evidence||data.inventory.integration_evidence?.[source.node_id];
    const problem=integrationProblem(source,[],key=>card._hass?.localize?.(key),current,false);
    const loaded=current?.current?.reason==="loaded"||data.inventory.integration_states?.[source.node_id]==="loaded";
    title=source.disabled?"Disabled in Home Assistant":loaded?"Loaded in Home Assistant":problem.headline;
    body=loaded?"":`<p>${esc(problem.summary)}</p>${problem.nextStep?`<p>${esc(problem.nextStep)}</p>`:""}`;
    href=problem.integrationUrl;action="Open integration in Home Assistant";
    if(node.family)body+=`<p>${familyDevices(node).length} devices in this integration.</p>`;
  } else {
    const linked=relatedIssues(node,episodes),findings=[...new Set(linked.flatMap(episode=>episode.reasons||[]).filter(finding=>sourceIds(node).has(finding.node_id)).map(finding=>finding.message).filter(Boolean))];
    title=observed?.status==="pass"?"Current check passed":linked.length?"Reported condition needs review":observed?.message||"No current problem reported";
    body=findings.map(message=>`<p>${esc(message)}</p>`).join("");
    href=source.automation_url||source.fix_url||"";action=source.kind==="broken_automation"?"Inspect automation in Home Assistant":"Open in Home Assistant";
  }
  return `<section class="source-condition${unavailable||unknown?' needs-attention':''}"><h3>${esc(title)}</h3>${body}</section>${source.kind==="device"?availabilityActions(card,node):""}${readings}${href?`<a class="link" href="${esc(href)}">${action}</a>`:""}${["entity","device"].includes(source.kind)?"":updated}`;
}

function sourceIssueLinks(card,node,episodes,data) {
  const linked=relatedIssues(node,episodes);
  if(!linked.length)return "";
  const sources=new Map(inventoryRows(data).map(source=>[source.node_id,source]));
  const ids=sourceIds(node);
  return `<section class="source-section source-related-issues"><h3>${linked.length===1?"Related issue":`${linked.length} related issues`}</h3>${linked.map(episode=>{
    const anchor=sources.get(episode.anchor),name=anchor?.name||"Related issue";
    const finding=(episode.reasons||[]).find(item=>ids.has(item.node_id)&&item.message)||(episode.reasons||[]).find(item=>item.message);
    const members=new Set(issueMembers(episode).map(id=>sources.get(id)?.monitoring_source||id));
    const grouped=members.size>1||!ids.has(episode.anchor);
    const controls=anchor?card.tools?.detailButtons(anchor,episode,data)||"":"";
    const scope=grouped?`<p class="small">These controls apply to the whole issue headed by ${esc(name)}${members.size>1?`, involving ${members.size} sources`:""}.</p>`:"";
    return `<div class="source-related-issue"><button type="button" class="source-child" data-episode="${esc(episode.episode_id)}"><span>${esc(finding?.message||name)}</span><small>View issue</small></button>${episode.opened_at?`<p class="small">Issue opened <time datetime="${esc(episode.opened_at)}">${esc(displayDate(episode.opened_at))}</time></p>`:""}${controls?grouped?`<details class="source-issue-actions" data-ui-key="source-issue:${esc(episode.episode_id)}"><summary>Actions for this issue</summary>${scope}${controls}</details>`:controls:""}</div>`;
  }).join("")}</section>`;
}

/** Render the accepted tree-and-detail workspace without nested page navigation. */
export function sourcesBrowser(card) {
  const data=card.current.data;
  const topomationAvailable=Boolean(topomationTree(data,card.topomation));
  const full=sourcesTree(data,card.sourcesGrouping,key=>card._hass?.localize?.(key),card.topomation,Boolean(card.sourcesShowDisabled));
  const paths=sourcePaths(full),episodes=sortedEpisodes(data);
  const issues=new Map(episodes.flatMap(item=>issueMembers(item).map(id=>[id,item])));
  for(const [id,item] of [...issues]) {const canonical=paths.get(`source:${id}`)?.node.source?.node_id;if(canonical)issues.set(canonical,item);}
  const included=includedEntities(data);
  const excluded=new Set((card.configuration?.settings?.monitoring_policies||[]).filter(policy=>policy.check==="availability").flatMap(policy=>policy.excluded_sources||[]));
  const excludedBranches=nodes=>nodes.flatMap(node=>{const children=excludedBranches(node.children);return children.length||excluded.has(node.source?.node_id)?[{...node,children}]:[];});
  const filtered=filterSources(full,card.sourcesQuery,card.sourcesNeedsReview,issues);
  const visible=card.sourcesExcludedOnly?excludedBranches(filtered):filtered;
  const selected=paths.get(card.sourcesSelection);
  const branch=node=>{
    const expanded=Boolean(card.sourcesQuery?.trim())||card.sourcesExpanded.has(node.key);
    const fullNode=paths.get(node.key)?.node||node;
    const count=relatedIssues(fullNode,episodes).length;
    const limit=card.sourcesLimits?.get(node.key)||80;
    const shown=expanded?node.children.slice(0,limit):[];
    const linked=expanded&&node.children.find(child=>child.key===selected?.node.key||(child.connection&&child.connection.node_id===selected?.node.source?.node_id)||selected?.parents.some(parent=>parent.key===child.key));
    if(linked&&!shown.includes(linked))shown.push(linked);
    const deviceCount=fullNode.family?familyDevices(fullNode).length:0;
    const entityCount=fullNode.type==="device"?fullNode.children.filter(child=>child.type==="entity").length:0;
    const deviceExtent=entityCount?`${entityCount} ${entityCount===1?"entity":"entities"}`:"No entities";
    const extent=node.family?`Integration · ${deviceCount} ${deviceCount===1?"device":"devices"}`:node.type==="device"?`Device · ${deviceExtent}`:node.source?.kind==="integration"?`Integration connection · ${monitoringState(node.source,included)}`:node.source?`${sourceType(node.source)} · ${monitoringState(node.source,included)}`:`${node.children.length} ${node.children.length===1?"item":"items"}`;
    const issue=count?` <span class="source-issue-count">· ${count} ${count===1?"issue":"issues"}</span>`:"";
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length?`<button type="button" class="config-toggle" data-sources-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded?'Collapse':'Expand'} ${esc(node.name)}"><span class="disclosure" aria-hidden="true"></span></button>`:'<span class="config-leaf" aria-hidden="true"></span>'}<button type="button" class="config-pick" data-sources-select="${esc(node.key)}"${selected?.node.key===node.key||(node.connection&&node.connection.node_id===selected?.node.source?.node_id)?' aria-current="true"':''}><span class="source-row-title">${esc(node.name)}${issue}</span><small>${esc(extent)}</small></button></div>${expanded?`<ul class="config-nav-children">${shown.map(branch).join("")}${node.children.length>limit?`<li><button type="button" class="link source-more" data-source-more="${esc(node.key)}">Show more sources (${shown.length} of ${node.children.length})</button></li>`:''}</ul>`:''}</li>`;
  };
  const node=selected?.node;
  const context=selected?.parents.map(parent=>`${parent.family?"Integration":parent.type==="device"?"Device":parent.type==="integration"?"Connection":"Location"}: ${parent.name}`).join(" / ")||"";
  const type=node?.family?"Integration":node?.source?sourceType(node.source):node?.type==="device"?"Device":"Location";
  const automationReporting=node?.source?.automation_url?`<details class="source-section" data-ui-key="source-reporting:${esc(node.key)}"><summary>Reporting preference</summary>${sourceReporting(card,node)}</details>`:"";
  const equipmentControls=node?.source?card.tools?.detailButtons(node.source,null,data)||"":"";
  const detail=node?`<header class="source-heading"><button type="button" class="link sources-back" data-action="back-sources">← Back to sources</button><p class="config-path">${esc(type)}${context?` · ${esc(context)}`:""}</p><h2 id="sources-detail-title" tabindex="-1">${esc(node.name)}</h2></header><div class="source-body">${currentSourceEvidence(card,node,episodes)}${node.source?.kind!=="device"||node.source.disabled||card.sourceDetail?.nodeId!==node.source.node_id||card.sourceDetail?.loading||card.sourceDetail?.error?availabilityActions(card,node):""}${sourceIssueLinks(card,node,episodes,data)}${sourcePolicies(card,node)}${equipmentControls?`<details class="source-section" data-ui-key="source-equipment:${esc(node.key)}"><summary>Equipment controls</summary>${equipmentControls}</details>`:""}${automationReporting}${node.source?`<details class="source-section" data-ui-key="source-history:${esc(node.key)}"${card.sourcesView==="history"?' open':''}><summary>History for this source</summary>${sourceHistory(card,node)}</details>`:""}${sourceTechnicalDetails(card,node)}</div>`:'<div class="sources-empty"><h2>Choose a source</h2><p>Inspect its current evidence, related issues and monitoring policies.</p></div>';
  return `<section class="panel sources-workspace" data-mobile-detail="${Boolean(card.sourcesMobileDetail&&node)}"><div class="sources-tools"><label>Group by<select data-sources-group><option value="integration"${card.sourcesGrouping==="integration"?' selected':''}>Integration</option><option value="location"${card.sourcesGrouping==="location"?' selected':''}>Home Assistant location</option>${topomationAvailable||card.sourcesGrouping==="topomation"?`<option value="topomation"${card.sourcesGrouping==="topomation"?' selected':''}${topomationAvailable?'':' disabled'}>TopoMation${topomationAvailable?'':' (loading)'}</option>`:''}</select></label><label class="coverage-search">Find a source<input type="search" data-sources-search value="${esc(card.sourcesQuery||"")}" placeholder="Name or entity ID"></label><label class="sources-disabled-toggle"><input type="checkbox" data-sources-disabled${card.sourcesShowDisabled?' checked':''}> Show disabled sources</label><label class="sources-excluded-toggle"><input type="checkbox" data-sources-excluded${card.sourcesExcludedOnly?' checked':''}> Availability exclusions</label>${card.sourcesExpanded.size?'<button type="button" class="link sources-collapse" data-action="collapse-sources">Collapse all</button>':''}${card.sourcesNeedsReview?'<button type="button" class="link" data-action="all-sources">Show all sources</button>':''}</div><div class="config-layout"><nav class="config-rail" aria-label="Sources tree"><ul class="config-tree">${visible.map(branch).join("")||'<li class="sub">No matching sources.</li>'}</ul></nav><section class="config-detail" aria-label="Selected source">${detail}</section></div></section>`;
}
