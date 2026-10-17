import {sourceReporting} from "./reporting.mjs?v=94";
import {sourceHistory as renderSourceHistory} from "./source-history.mjs?v=94";
import {escapeHtml as esc, inventoryRows, locationTree, sortedEpisodes} from "./model.mjs?v=94";
import {monitoringTree} from "./configuration.mjs?v=94";
import {batteryProblem, integrationProblem, vacuumProblem} from "./problem.mjs?v=94";

import {deviceAvailabilitySummary, deviceEntityName} from "./device-availability.mjs?v=94";
import {relatedDeviceIssues} from "./device-issue-model.mjs?v=94";
import {upsSourceSummary} from "./ups.mjs?v=94";
import {availabilityMonitoring, availabilityConfirmation, prepareAvailabilityChange, applyAvailabilityChange} from "./source-monitoring.mjs?v=94";
import {sourceCoverageIndex, sourceCoverage} from "./source-coverage.mjs?v=94";
import {isTemperatureCheck, sourceTemperature} from "./source-temperature.mjs?v=94";

const key = (...parts) => JSON.stringify(parts);
const byName = (a,b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
const sourceName = source => source.name?.trim() || (source.kind === "integration" ? "Unnamed connection" : source.kind === "device" ? "Unnamed device" : source.kind === "battery" ? "Battery" : source.kind === "vacuum" ? "Vacuum" : "Unnamed entity");
const sourceNode = source => ({key:`source:${source.node_id}`,name:sourceName(source),type:source.kind,source,children:[]});
const unique = (items, identity = item => item.key) => [...new Map(items.map(item => [identity(item),item])).values()];
const displayDate = value => value ? new Date(value).toLocaleString() : "Time not reported";
const familyDevices = family => unique([...sourcePaths(family.children).values()].map(item=>item.node).filter(node=>node.type==="device"));
const canonicalCache = new WeakMap();
const canonicalCatalogs = new WeakMap();
const sourceTrees = new WeakMap();
const pathIndexes = new WeakMap();
const selectionIndexes = new WeakMap();
const topologyTrees = new WeakMap();

/** Present one real source while retaining each independent monitoring check. */
export function canonicalSources(data) {
  const rows=inventoryRows(data), groups=new Map();
  if(canonicalCache.has(rows))return canonicalCache.get(rows);
  const entities=new Map(rows.filter(row=>row.kind==="entity"&&!row.monitoring_policy&&row.entity_id).map(row=>[row.entity_id,row.node_id]));
  for(const row of rows) {
    const id=row.monitoring_source||(isTemperatureCheck(row)&&entities.get(row.entity_id))||row.node_id;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  const sources=[...groups].map(([id,members])=>{
    const base=members.find(source=>source.node_id===id)||members[0];
    const checks=members.flatMap(source=>source.monitoring_checks||((source.monitoring_policy||source.watched)?[source]:[]));
    const suffix=base.monitoring_policy?.name?` · ${base.monitoring_policy.name}`:"";
    return {...base,node_id:id,name:suffix&&base.name?.endsWith(suffix)?base.name.slice(0,-suffix.length):base.name,
      watched:members.some(source=>source.watched),
      availability_entities:[...new Set(members.flatMap(source=>source.availability_entities||[]))],
      source_aliases:[...new Set(members.flatMap(source=>source.source_aliases||[source.node_id]))],monitoring_checks:checks};
  });
  canonicalCache.set(rows,sources);
  return sources;
}

function canonicalData(data) {
  if(data.canonical_source_rows)return data;
  const catalog=data.inventory.catalog;
  if(!canonicalCatalogs.has(catalog))canonicalCatalogs.set(catalog,{...catalog,candidates:[]});
  return {...data,canonical_source_rows:true,inventory:{...data.inventory,nodes:canonicalSources(data),catalog:canonicalCatalogs.get(catalog)}};
}

/** Resolve a source or historical check alias without rebuilding its browsing tree. */
export function sourceForSelection(data,selection) {
  const sources=canonicalSources(data);
  if(!selectionIndexes.has(sources)) {
    const index=new Map();
    for(const source of sources)for(const id of [source.node_id,...source.source_aliases])index.set(`source:${id}`,source);
    selectionIndexes.set(sources,index);
  }
  return selectionIndexes.get(sources).get(selection);
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
  const rows=data.inventory.nodes,cached=topologyTrees.get(rows);
  if(cached?.topomation===topomation&&cached.devices===data.devices)return cached.tree;
  const tree=buildTopomationTree(data,locations);
  topologyTrees.set(rows,{topomation,devices:data.devices,tree});
  return tree;
}

function buildTopomationTree(data,locations) {
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
export function sourcesTree(data,grouping = "integration",localize = null,topomation = null,showDisabled = true) {
  data=canonicalData(data);
  const rows=data.inventory.nodes;
  const variants=sourceTrees.get(rows)||new Map();
  const variant=`${grouping}:${showDisabled}`,cached=variants.get(variant);
  const functions=data.functions?.length?data.functions:null;
  if(cached&&cached.localize===localize&&cached.topomation===topomation&&cached.areas===data.areas&&cached.floors===data.floors&&cached.devices===data.devices&&cached.functions===functions)return cached.tree;
  if(!showDisabled)data={...data,inventory:{...data.inventory,nodes:data.inventory.nodes.filter(source=>!source.disabled)}};
  const tree=groupedSources(data,grouping,localize,topomation);
  const present=buildSourcePaths(tree);
  const situations=inventoryRows(data).filter(source=>source.kind==="situation"&&!present.has(`source:${source.node_id}`)).map(sourceNode);
  if(situations.length)tree.push({key:"situations",name:"Configured situations",type:"location",children:situations});
  for(const [kind,name] of [["broken_automation","Automations"],["repair","Home Assistant Repairs"]]) {
    const rows=inventoryRows(data).filter(source=>source.kind===kind&&!present.has(`source:${source.node_id}`)).map(sourceNode);
    if(rows.length)tree.push({key:kind,name,type:"location",children:rows});
  }
  const placed=buildSourcePaths(tree);
  const remaining=inventoryRows(data).filter(source=>!placed.has(`source:${source.node_id}`)).map(sourceNode);
  if(remaining.length)tree.push({key:"other-checks",name:"Other sources",type:"location",children:remaining});
  variants.set(variant,{localize,topomation,areas:data.areas,floors:data.floors,devices:data.devices,functions,tree});
  sourceTrees.set(rows,variants);
  return tree;
}

function groupedSources(data,grouping,localize,topomation) {
  localize ||= () => null;
  if(grouping === "integration") return integrationFamilies(data,localize);
  const topology=grouping === "topomation" ? topomationTree(data,topomation) : null;
  if(topology) {
    const entries=inventoryRows(data).filter(source=>source.kind==="integration").map(sourceNode).sort(byName);
    return entries.length?[...topology,{key:"location:other-sources",name:"Integration connections",type:"location",children:entries}]:[...topology];
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

/** Keep matching sources and their navigable ancestors without changing enrollment. */
export function filterSourceMonitoring(tree,filter,index) {
  if(!["monitored","unmonitored"].includes(filter))return tree;
  const monitored=filter==="monitored";
  const visit=nodes=>nodes.flatMap(node=>{
    const children=visit(node.children);
    const matches=[node.source,node.connection].some(source=>source&&sourceCoverage(source,index).monitored===monitored);
    return matches||children.length?[{...node,children}]:[];
  });
  return visit(tree);
}

export function sourcePaths(tree) {
  if(!pathIndexes.has(tree))pathIndexes.set(tree,buildSourcePaths(tree));
  return pathIndexes.get(tree);
}

function buildSourcePaths(tree) {
  const paths=new Map();
  const add=(node,parents)=>{const item={node,parents};if(!paths.has(node.key))paths.set(node.key,item);for(const id of node.source?.source_aliases||[])if(!paths.has(`source:${id}`))paths.set(`source:${id}`,item);};
  const visit=(nodes,parents)=>{for(const node of nodes){add(node,parents);if(node.connection)add(sourceNode(node.connection),parents);visit(node.children,[...parents,node]);}};
  visit(tree,[]);return paths;
}

/** Keep old issue and notification links attached to their real source. */
export function canonicalSourceSelection(tree,selection) {
  return sourcePaths(tree).get(selection)?.node.key||selection;
}

function monitoringState(source,coverage) {
  if(source.disabled)return "Disabled in Home Assistant";
  return sourceCoverage(source,coverage).monitored?"Monitored":"Not monitored";
}

function sourceReport(card,node,episodes) {
  const source=node.source,data=card.current.data;
  const evidence=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  if(!evidence||evidence.loading)return '<p class="sub" role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  const linked=episodes.filter(item=>item.anchor===source.node_id);
  if(source.kind==="ups")return upsSourceSummary(card,source,card.sourceDetail?.entity_status||data.inventory.ups_status?.[source.node_id],Boolean(linked.length));
  if(source.kind==="vacuum"){
    const activity=evidence.vacuum_activity;
    const problem=vacuumProblem(source,{current:activity},data.areas,Boolean(linked.length));
    const deviceId=source.attributes?.device?.[0];
    const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
    return `<section class="source-condition${activity?.status==="fail"?' needs-attention':''}"><h3>${esc(problem.headline)}</h3><p>${esc(activity?.message||problem.summary)}</p><p>${esc(problem.nextStep)}</p></section>${!source.watched?'<p class="small">Vacuum monitoring is off.</p>':''}${href?`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`:''}`;
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
  const sources=[source,...ended.map(item=>({...item.source,node_id:item.episode.anchor}))];
  return renderSourceHistory({...data,inventory:{...data.inventory,resolved_history:retained?{...retained,episodes:ended}:undefined}},sources,{associationLimited:["integration","device"].includes(source.kind)});
}

const sourceType = source => ({integration:"Integration connection",device:"Device",entity:"Entity",battery:"Battery condition",vacuum:"Vacuum condition",ups:"UPS check",thermostat:"Thermostat check",temperature_limit:"Temperature check",broken_automation:"Automation",repair:"Repair",situation:"Situation"}[source?.kind]||"Check");
const issueMembers = episode => [...new Set([episode.anchor,...(episode.recorded||[]),...(episode.reasons||[]).map(finding=>finding.node_id)].filter(Boolean))];
const sourceIds = node => new Set([...sourcePaths([node]).keys()].filter(id=>id.startsWith("source:")).map(id=>id.slice(7)));
const relatedIssues = (node,episodes) => {const ids=sourceIds(node);return episodes.filter(episode=>issueMembers(episode).some(id=>ids.has(id)));};

function contributingPolicies(card,source) {
  const detail=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  const policies=new Map((detail?.monitoring_policies||[]).map(policy=>[policy.id,{...policy,contexts:new Set()}]));
  const saved=card.configuration?.settings?.monitoring_policies||[];
  const ids=new Set(source.source_aliases||[source.node_id]);
  const sources=canonicalSources(card.current.data),names=new Map(sources.map(item=>[item.node_id,item.name]));
  const entityNames=new Map(sources.filter(item=>item.kind==="entity").map(item=>[item.entity_id,item.name]));
  for(const check of inventoryRows(card.current.data)) {
    const temperature=isTemperatureCheck(check)&&check.watched&&!check.disabled;
    const memberTemperature=temperature&&source.kind==="device"&&source.attributes?.device?.some(id=>check.attributes?.device?.includes(id));
    const direct=ids.has(check.node_id)||check.monitoring_source===source.node_id||temperature&&source.kind==="entity"&&source.entity_id===check.entity_id;
    const device=source.kind==="entity"&&check.kind==="device"&&check.watched&&check.availability_entities?.includes(source.entity_id);
    if((!direct&&!device&&!memberTemperature)||!check.monitoring_policy)continue;
    const id=check.monitoring_policy,policy=saved.find(item=>item.id===id);
    if(!policies.has(id))policies.set(id,{id,name:policy?.name||id,contexts:new Set()});
    policies.get(id).contexts.add(memberTemperature?`Monitors ${deviceEntityName(entityNames.get(check.entity_id)||check.name,source.name)}.`:temperature?"Monitors this entity's temperature.":device?`Uses this entity to assess ${names.get(check.monitoring_source||check.node_id)||"its device"}.`:check.kind==="entity"?"Checks this entity's availability individually.":check.kind==="device"?"Assesses this device using its selected entities.":check.kind==="integration"?"Checks whether this integration is loaded.":"Monitors this check.");
  }
  return [...policies.values()];
}

function sourcePolicies(card,node,extra="") {
  const source=node.source;
  if(!source)return "";
  const policies=contributingPolicies(card,source);
  const edit=policy=>`<button type="button" class="link" data-definition-action="open-policy" data-definition-kind="policies" data-definition-id="${esc(policy.id)}"${source.kind==="entity"?` aria-label="Edit ${esc(policy.name)} policy"`:""}>${source.kind==="entity"?"Edit policy":`Edit “${esc(policy.name)}” policy`}</button>`;
  if(source.kind==="entity") {
    const opened=card.sourcePoliciesSelection===source.node_id;
    const dialog=opened?`<dialog class="source-policy-dialog" aria-labelledby="source-policies-title"><header class="dialog-head"><h2 id="source-policies-title">Monitoring policies</h2><button type="button" class="button" data-source-policies="close" aria-label="Close monitoring policies">Close</button></header><div class="dialog-body"><p class="source-policy-entity">${esc(source.name)}</p>${policies.length?policies.map(policy=>`<section class="source-policy"><h3>${esc(policy.name)}</h3>${[...policy.contexts].map(context=>`<p>${esc(context)}</p>`).join("")}${edit(policy)}</section>`).join(""):'<p>No policies currently monitor this entity.</p>'}</div></dialog>`:"";
    return `${policies.length?'<section class="source-policy-links"><button type="button" class="link" data-source-policies="open" aria-haspopup="dialog">Monitoring policies</button></section>':""}${dialog}`;
  }
  const links=policies.length?`<section class="source-policy-links" aria-label="Monitoring policies">${policies.map(edit).join("")}</section>`:"";
  if(source.kind==="device")return links;
  const explained=policies.filter(policy=>policy.contexts.size);
  const content=explained.length?`<h3>Monitoring policies</h3>${explained.map(policy=>`<div class="source-policy"><div><p><strong>${esc(policy.name)}</strong></p>${[...policy.contexts].map(context=>`<p>${esc(context)}</p>`).join("")}</div></div>`).join("")}`:"";
  return `${links}${content||extra?`<details class="source-section source-monitoring-explanation" data-ui-key="source-details:${esc(node.key)}"><summary>Details</summary>${content}${extra}</details>`:""}`;
}

function closeSourcePolicies(card) {
  card.sourcePoliciesSelection=null;
  card.render();
  (card.main.querySelector('[data-source-policies="open"]')||card.main.querySelector("#sources-detail-title"))?.focus({preventScroll:true});
}

/** Restore the contextual policy dialog and native keyboard dismissal after updates. */
export function restoreSourcePolicies(card) {
  const dialog=card.main.querySelector(".source-policy-dialog");
  if(!dialog){card.sourcePoliciesSelection=null;return;}
  dialog.showModal();
  dialog.oncancel=event=>{event.preventDefault();closeSourcePolicies(card);};
}

/** Open policy context without changing the selected entity or saved configuration. */
export function editSourcePolicies(card,event) {
  const button=event.target.closest?.("button");
  if(!button)return false;
  if(button.closest(".source-policy-dialog")&&button.dataset.definitionAction==="open-policy") {
    card.sourcePoliciesSelection=null;
    return false;
  }
  const action=button.dataset.sourcePolicies;
  if(action==="close"){closeSourcePolicies(card);return true;}
  if(action!=="open")return false;
  const node=sourcePaths(sourcesTree(card.current.data,card.sourcesGrouping,null,card.topomation,Boolean(card.sourcesShowDisabled))).get(card.sourcesSelection)?.node;
  if(node?.source?.kind!=="entity")return true;
  card.sourcePoliciesSelection=node.source.node_id;
  card.render();
  return true;
}

function sourceMonitoringSummary(source,coverage) {
  if(!source||source.disabled)return "";
  const state=sourceCoverage(source,coverage);
  const description=state.monitored?state.labels.join(" · "):"";
  return `<p class="source-monitoring-status"><strong>${state.monitored?"Monitored":"Not monitored"}</strong>${description?`<span>${esc(description)}</span>`:""}</p>`;
}

function sourceHeaderMetadata(card,source) {
  if(!source||!["entity","device","battery"].includes(source.kind))return "";
  if(source.kind==="entity") {
    const entry=sourceIntegration(card,source);
    const deviceId=source.attributes?.device?.[0];
    const device=deviceId&&canonicalSources(card.current.data).find(item=>item.kind==="device"&&item.attributes?.device?.includes(deviceId));
    const deviceName=device?.name||card.current.data.devices?.find(item=>item.id===deviceId)?.name;
    const integration=entry&&integrationProblem(entry,[],key=>card._hass?.localize?.(key),null,false);
    const integrationName=sourceIntegrationName(card,source)||entry?.name;
    const fields=[deviceName?`<div><dt>Device</dt><dd><a href="/config/devices/device/${encodeURIComponent(deviceId)}" aria-label="Open ${esc(deviceName)} device in Home Assistant">${esc(deviceName)}</a></dd></div>`:"",integrationName?`<div><dt>Integration</dt><dd>${entry?.attributes?.domain?.[0]?`<a href="${esc(integration.integrationUrl)}" aria-label="Open ${esc(integrationName)} integration in Home Assistant">${esc(integrationName)}</a>`:esc(integrationName)}</dd></div>`:""].filter(Boolean);
    const linked=Boolean(deviceName||entry?.attributes?.domain?.[0]);
    return `${fields.length?`<dl class="source-identity">${fields.join("")}</dl>`:""}${!linked&&source.entity_id?`<a class="link" href="/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}">View entity state</a>`:""}`;
  }
  const deviceId=source.attributes?.device?.[0];
  const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:"";
  return href?`<a class="link" href="${esc(href)}">${deviceId?"Go to device page":"View entity state"}</a>`:"";
}

function sourceTechnicalDetails(card,node) {
  const source=node.source;
  if(!source||!["entity","device","battery"].includes(source.kind))return "";
  const detail=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null,updated=detail?.updated_at;
  if(!source.entity_id&&!updated)return "";
  return `<section class="source-technical"><h3>Technical details</h3>${source.entity_id?`<p class="source-entity-id">Entity ID: ${esc(source.entity_id)}</p>`:""}${updated?`<p class="small source-updated">Homeostatic updated <time datetime="${esc(updated)}">${esc(displayDate(updated))}</time></p>`:""}</section>`;
}

function availabilityActions(card,node) {
  const source=node.source;
  if(!source||!["entity","device"].includes(source.kind))return "";
  const updating=card.current.data?.catalog_stale||card.current.data?.catalog_loaded===false;
  const disabled=card.current.status!=="current"||card.settingsBusy||card.configBusy||card.scopedBusy||!card.configuration?.settings||updating;
  const state=source.kind==="entity"?availabilityMonitoring(card,source):null;
  const operation=card.availabilityPlan;
  const selected=card.availabilitySelected?.nodeId===source.node_id?card.availabilitySelected:null;
  const action=(mode,label,id=source.node_id)=>`<button type="button" class="button${mode==="confirm"?" primary":""}" data-availability-action="${mode}" data-availability-source="${esc(id)}"${disabled?' disabled':''}>${mode==="confirm"&&card.scopedBusy==="source-availability"?operation?.mode==="stop"?"Stopping monitoring…":"Resuming monitoring…":label}</button>`;
  const controls=operation&&card.availabilityContext===source.node_id?"":source.kind==="entity"?`${!source.disabled&&state.canStop?action("stop","Stop Monitoring"):""}${!source.disabled&&state.canResume?action("resume","Resume availability monitoring…"):""}`:action(selected?"cancel-selection":"select",selected?"Cancel selection":"Select entities…");
  const choices=selected?[...selected.ids].map(id=>availabilityMonitoring(card,id)):[];
  const batch=selected?.ids.size?`<div class="source-actions"><span>${selected.ids.size} selected</span>${choices.some(item=>item.canStop)?action("stop-selected","Stop Monitoring"):""}${choices.some(item=>item.canResume)?action("resume-selected","Resume availability monitoring for selected entities…"):""}</div>`:"";
  const confirmation=operation&&card.availabilityContext===source.node_id?availabilityConfirmation(operation,action):"";
  const feedback=card.availabilityContext===source.node_id&&card.availabilityError?`<p class="config-error" role="alert">${esc(card.availabilityError)}</p>${card.scopedConfiguration?.needsRefresh?action("refresh","Refresh saved monitoring"):""}`:"";
  return `${controls?`<div class="source-actions">${controls}</div>`:""}${updating?'<p class="small" role="status">Updating monitoring scope…</p>':""}${batch}${confirmation}${feedback}`;
}

/** Handle only explicit source availability actions over the existing policy owner. */
export function editSourceAvailability(card,event) {
  const selection=event.target.matches?.("[data-availability-select]")?event.target:null;
  const button=event.target.closest?.("[data-availability-action]");
  if(!selection&&!button)return false;
  if(card.current.status!=="current"||card.settingsBusy||card.configBusy||card.scopedBusy)return true;
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
      else {card.availabilityPlan=null;card.loadSource?.(true);}
      card.render();
      card.shadowRoot?.querySelector('[data-availability-action="resume"], [data-availability-action="stop"], [data-availability-action="refresh"], #sources-detail-title')?.focus({preventScroll:true});
    });
    return true;
  }
  else if(action==="confirm") {
    if(!card.availabilityPlan)return true;
    applyAvailabilityChange(card,card.availabilityPlan).then(saved=>{
      if(saved){card.availabilityPlan=null;card.availabilitySelected=null;card.loadSource?.(true);}
      else if(card.availabilityPlan?.revision!==card.configuration?.revision||card.availabilityPlan?.catalogRevision!==card.current.data?.catalog_revision)card.availabilityPlan=null;
      card.render();
      card.shadowRoot?.querySelector('[data-availability-action="confirm"], #sources-detail-title')?.focus({preventScroll:true});
    }).catch(error=>{card.availabilityError=error.message||`Could not ${card.availabilityPlan?.mode==="resume"?"resume":"stop"} monitoring. Read current saved settings before trying again.`;card.render();});
    return true;
  }else if(["stop","resume","stop-selected","resume-selected"].includes(action)) {
    const ids=action.endsWith("-selected")?[...card.availabilitySelected.ids]:[sourceId];
    try {card.availabilityPlan=prepareAvailabilityChange(card,ids,action.startsWith("resume")?"resume":"stop");}
    catch(error){card.availabilityError=error.message;}
  }
  card.render();
  card.shadowRoot?.querySelector(card.availabilityPlan?'[data-availability-action="confirm"]':'[data-availability-action="stop"], [data-availability-action="resume"], [data-availability-action="select"]')?.focus({preventScroll:true});
  return true;
}

function sourceIntegration(card,source) {
  const entries=inventoryRows(card.current.data).filter(item=>item.kind==="integration");
  const owner=source.owner_id&&entries.find(item=>item.entry_id===source.owner_id);
  if(owner)return owner;
  const related=entries.filter(item=>source.attributes?.integration?.includes(item.entry_id));
  return related.length===1?related[0]:null;
}

function sourceIntegrationName(card,source) {
  const entry=sourceIntegration(card,source);
  const domain=entry?.attributes?.domain?.[0]||source.attributes?.integration_domain?.[0];
  return domain&&(card._hass?.localize?.(`component.${domain}.title`)||domain.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()));
}


function sourceFact(label,value) {
  return `<div class="source-fact"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

function sourceReading(member) {
  if(!member||member.state==="missing")return "No current state";
  if(member.restored)return "Not provided by integration";
  if(member.state==="unavailable")return "Unavailable";
  if(member.state==="unknown")return "No value reported";
  return `${member.state}${member.unit?`${member.unit==="%"?"":" "}${member.unit}`:""}`;
}

function deviceInspection(card,node,coverage) {
  const source=node.source,evidence=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  const deviceId=source.attributes?.device?.length===1?source.attributes.device[0]:null;
  const related=relatedDeviceIssues(card.current.data,deviceId);
  const view=related.length?`<button type="button" class="button" data-device-issues="${esc(deviceId)}" aria-label="View issues for ${esc(node.name)}">View</button>`:"";
  const selection=card.availabilitySelected?.nodeId===source.node_id?card.availabilitySelected:null;
  const checkbox=member=>selection?`<label class="source-member-select"><input type="checkbox" data-availability-select="${esc(member.node_id)}"${selection.ids.has(member.node_id)?" checked":""}${card.settingsBusy||card.scopedBusy?' disabled':''}><span class="sr-only">Select ${esc(member.name)}</span></label>`:"";
  const memberName=member=>member.entity_id?`<a href="/developer-tools/state?entity_id=${encodeURIComponent(member.entity_id)}">${esc(member.name)}</a>`:`<span>${esc(member.name)}</span>`;
  let summary="",body="";
  if(source.disabled)summary='<p class="source-entity-condition">Disabled in Home Assistant</p><p>Monitoring paused while disabled. Saved monitoring choices resume when re-enabled.</p>';
  else if(!evidence||evidence.loading)summary=`<div class="source-device-summary"><p role="status">Reading current Home Assistant values…</p>${view}</div>`;
  else if(evidence.error)summary=`<div class="source-device-summary"><p role="alert">${esc(evidence.error)}</p>${view}</div><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  else {
    const members=evidence.members||[],counts=deviceAvailabilitySummary(evidence,{monitored:source.watched});
    const uniformUnavailable=counts.total>0&&counts.unavailable===counts.total;
    summary=`<div class="source-device-summary"><p>${esc(counts.label)}</p>${view}</div>${!counts.total?`<p>${source.watched?"No entities selected for device availability":"No operational entities available to inspect"}</p>`:""}`;
    const reading=member=>member.restored?"Not provided by integration":member.state==="missing"?"No current state":member.state==="unknown"?"Available · no value":member.state==="unavailable"?uniformUnavailable?"":"Unavailable":`Available · ${sourceReading(member)}`;
    if(members.length)body=`<section class="source-section source-device-entities"><h3>${source.watched?"Monitored entities":"Entities"}</h3><ul class="source-device-members">${members.map(member=>`<li class="source-device-member"><span>${checkbox(member)}${memberName(member)}</span>${reading(member)?`<span class="source-device-member-state">${esc(reading(member))}</span>`:""}</li>`).join("")}</ul></section>`;
    if(counts.total>members.length)body+=`<p class="small">${members.length} of ${counts.total} entity readings loaded.</p><button type="button" class="button" data-action="more-source-evidence"${evidence.moreLoading?' disabled':''}>${evidence.moreLoading?'Loading entities…':'Load more entities'}</button>${evidence.moreError?`<p role="alert">${esc(evidence.moreError)}</p>`:""}`;
    body+=sourceTemperature(source,evidence);
  }
  const excluded=node.children.filter(child=>child.source?.kind==="entity"&&!(evidence?.members||[]).some(member=>member.node_id===child.source.node_id)&&availabilityMonitoring(card,child.source).canResume);
  const exclusions=excluded.length?`<section class="source-excluded-members"><h4>${excluded.length} ${excluded.length===1?"entity with an availability exclusion":"entities with availability exclusions"}</h4><ul class="source-device-members">${excluded.map(child=>`<li class="source-device-member"><span>${checkbox(child.source)}${memberName(child.source)}</span></li>`).join("")}</ul></section>`:"";
  const monitoring=`<section class="source-section source-device-coverage"><h3>Monitoring coverage</h3>${sourceMonitoringSummary(source,coverage)}${sourcePolicies(card,node)}${source.disabled?"":availabilityActions(card,node)}${exclusions}</section>`;
  return {summary,body,monitoring};
}

/** Keep reported evidence separate from monitoring coverage in each inspector. */
function sourceInspection(card,node,coverage) {
  const source=node.source;
  if(!source||!["battery","device","entity"].includes(source.kind))return null;
  if(source.kind==="device")return deviceInspection(card,node,coverage);
  const evidence=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  const state=sourceCoverage(source,coverage);
  let facts="",body="",details="";
  if(source.disabled) {
    facts=source.kind==="entity"?'<p class="source-entity-condition">Disabled in Home Assistant</p>':sourceFact("Availability","Disabled in Home Assistant");
    body='<p>Monitoring paused while disabled. Saved monitoring choices resume when re-enabled.</p>';
  } else if(!evidence||evidence.loading)body='<p role="status">Reading current Home Assistant values…</p>';
  else if(evidence.error)body=`<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  else if(source.kind==="battery") {
    const members=evidence.members||[];
    if(members.length<=1)facts+=sourceFact("Battery reading",esc(sourceReading(members[0])));
    else facts+=members.map(member=>sourceFact(deviceEntityName(member.name,node.name),esc(sourceReading(member)))).join("");
    const conditions=Array.isArray(evidence.battery_conditions)?evidence.battery_conditions:evidence.battery_condition?[{policy_id:"",policy_name:"Battery condition",condition:evidence.battery_condition}]:[];
    for(const item of conditions) {
      const current=item.condition,problem=batteryProblem(source,{current},false);
      const threshold=current.evidence?.threshold;
      const finding=`<section class="source-condition${current.status!=="pass"?' needs-attention':''}" data-battery-policy="${esc(item.policy_id)}"><h3>${esc(item.policy_name)}</h3><p>${esc(current.message||problem.summary)}</p>${current.status!=="pass"?`<p>${esc(problem.nextStep)}</p>`:""}</section>`;
      if(current.status!=="pass")body+=finding;else details+=finding;
      if(threshold!==undefined)details+=`<p>${esc(item.policy_name)}: low battery at or below ${esc(threshold)}%.</p>`;
    }
    details+='<p>Charging can clear the low-battery condition without establishing a full charge or replacement.</p>';
  } else if(source.kind==="entity") {
    const member=evidence.members?.find(item=>item.entity_id===source.entity_id)||evidence.members?.[0];
    const title=member?.restored?`Not currently provided by ${sourceIntegrationName(card,source)||"its integration"}`:member?.state==="unavailable"?"Home Assistant reports this entity as unavailable":!member||member.state==="missing"?"No current state from Home Assistant":"Available in Home Assistant";
    facts+=`<p class="source-entity-condition">${esc(title)}</p>`;
    if(member&&!member.restored&&!['unavailable','missing'].includes(member.state))facts+=`<p class="source-current-value">${esc(member.state==="unknown"?"Home Assistant reports no value":sourceReading(member))}</p>`;
    body+=sourceTemperature(source,evidence);
  }
  const availability=source.kind==="entity"?availabilityMonitoring(card,source):null;
  const configure=source.kind==="battery"||availability&&!availability.canStop&&!availability.canResume;
  if(!source.disabled&&source.kind!=="entity")facts+=sourceFact("Monitoring",`<span>${state.monitored?"Monitored":"Not monitored"}</span>${state.monitored?`<span class="source-coverage-labels">${esc(state.labels.join(" · "))}</span>`:""}${configure?'<button type="button" class="link" data-page="policies" data-configure-monitoring>Configure monitoring</button>':""}`);
  return {summary:source.kind==="entity"?facts:`<dl class="source-facts">${facts}</dl>`,body,details};
}

function sourceNavigation(card,node) {
  if(!node.source)return "";
  const history=card.sourcesView==="history",view=history?"source":"history";
  if(node.source.kind==="entity"&&!history)return "";
  if(node.source.kind==="device"&&!history) {
    const deviceId=node.source.attributes?.device?.length===1?node.source.attributes.device[0]:null;
    return deviceId?`<nav class="source-native-navigation" aria-label="Home Assistant navigation"><a class="button" href="/config/devices/device/${encodeURIComponent(deviceId)}">Open device</a></nav>`:"";
  }
  const href=`/homeostatic/sources/${encodeURIComponent(node.key)}${history?"":"/history"}`;
  return `<nav class="source-navigation" aria-label="Related source views">${node.source.kind==="entity"?"":sourceHeaderMetadata(card,node.source)}<a class="link" href="${esc(href)}" data-sources-view="${view}">${history?"Close history":"View history"}</a></nav>${history?`<section class="source-history"><h3 id="source-history-title" data-ui-key="source-history-title:${esc(node.key)}" tabindex="-1">History</h3>${sourceHistory(card,node)}</section>`:""}`;
}

function currentSourceEvidence(card,node,episodes) {
  const source=node.source,data=card.current.data;
  if(!source)return node.family?`<p>${familyDevices(node).length} devices</p><section class="source-section source-connections"><h3>${node.entries.length} connections</h3>${node.entries.map(entry=>`<button type="button" class="source-child" data-sources-select="source:${esc(entry.node_id)}"><span>${esc(sourceName(entry))}</span><small>View connection</small></button>`).join("")}</section>`:(relatedIssues(node,episodes).length?"":"<p>No open issues in this group.</p>");
  if(source.disabled)return '<section class="source-condition"><h3>Disabled in Home Assistant</h3><p>Monitoring paused while disabled. Saved monitoring choices resume when re-enabled.</p></section>';
  const evidence=card.sourceDetail?.nodeId===source.node_id?card.sourceDetail:null;
  if(!evidence||evidence.loading)return '<p role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  if(["vacuum","ups"].includes(source.kind))return sourceReport(card,node,episodes);
  const members=evidence.members||[],unavailable=evidence.unavailable_count??members.filter(item=>item.state==="unavailable"&&!item.restored).length;
  const unknown=evidence.unknown_count??members.filter(item=>item.state==="missing"||item.restored).length;
  const observed=evidence.entity_status?.current||evidence.entity_status;
  const updated=evidence.updated_at?`<p class="small source-updated">Homeostatic updated ${esc(displayDate(evidence.updated_at))}</p>`:"";
  let title="",body="",href="",action="Open in Home Assistant";
  if(source.kind==="integration") {
    const current=evidence.integration_evidence||data.inventory.integration_evidence?.[source.node_id];
    const problem=integrationProblem(source,[],key=>card._hass?.localize?.(key),current,false);
    const loaded=current?.current?.reason==="loaded"||data.inventory.integration_states?.[source.node_id]==="loaded";
    title=source.disabled?"Disabled in Home Assistant":loaded?"Loaded":problem.headline;
    body=loaded?"":`<p>${esc(problem.summary)}</p>${problem.nextStep?`<p>${esc(problem.nextStep)}</p>`:""}`;
    href=problem.integrationUrl;action="Open integration";
    if(node.family)body+=`<p>${familyDevices(node).length} devices in this integration.</p>`;
  } else {
    const linked=relatedIssues(node,episodes),findings=[...new Set(linked.flatMap(episode=>episode.reasons||[]).filter(finding=>sourceIds(node).has(finding.node_id)).map(finding=>finding.message).filter(Boolean))];
    title=isTemperatureCheck(source)&&observed?.message?observed.message:observed?.status==="pass"?"Current check passed":linked.length?"Reported condition needs review":observed?.message||"No current problem reported";
    body=findings.map(message=>`<p>${esc(message)}</p>`).join("");
    href=source.automation_url||source.fix_url||"";action=source.kind==="broken_automation"?"Inspect automation in Home Assistant":"Open in Home Assistant";
  }
  return `${sourceTemperature(source,evidence)}<section class="source-condition${unavailable||unknown?' needs-attention':''}"><h3>${esc(title)}</h3>${body}</section>${href?`<a class="link" href="${esc(href)}">${action}</a>`:""}${["entity","device"].includes(source.kind)?"":updated}`;
}

function sourceIssueLinks(card,node,episodes,data) {
  const combined=node.source?.kind==="device"?new Set(relatedDeviceIssues(data,node.source.attributes?.device?.[0]).map(item=>item.episode.episode_id)):new Set();
  const linked=relatedIssues(node,episodes).filter(episode=>!combined.has(episode.episode_id));
  if(!linked.length)return "";
  const sources=new Map(inventoryRows(data).map(source=>[source.node_id,source]));
  const ids=sourceIds(node);
  const controls=data.inventory.operator_controls||[];
  const shownControls=new Set(controls.filter(control=>control.target===node.source?.node_id).map(control=>control.control_id));
  return `<section class="source-section source-related-issues"><h3>${linked.length===1?"Related issue":`${linked.length} related issues`}</h3>${node.type==="location"||node.type==="integration"?`<p class="small">Each issue is listed once here. A shared issue can appear in more than one group.</p>`:""}${linked.map(episode=>{
    const anchor=sources.get(episode.anchor),name=anchor?.name||"Related issue";
    const finding=(episode.reasons||[]).find(item=>ids.has(item.node_id)&&item.message)||(episode.reasons||[]).find(item=>item.message);
    const members=new Set(issueMembers(episode).map(id=>sources.get(id)?.monitoring_source||id));
    const grouped=members.size>1||!ids.has(episode.anchor);
    if(["entity","device"].includes(node.source?.kind)) {
      const condition=finding?.message||name;
      return `<div class="source-related-issue source-entity-issue"><p>${esc(condition)}</p>${grouped?`<p class="small">This ${node.source.kind} is part of an issue${members.size>1?` involving ${members.size} sources`:""}. Grouped under ${esc(name)}.</p>`:""}<button type="button" class="button primary" data-episode="${esc(episode.episode_id)}" aria-label="View issue: ${esc(condition)}">View issue</button></div>`;
    }
    const issueData={...data,inventory:{...data.inventory,operator_controls:controls.filter(control=>!shownControls.has(control.control_id))}};
    const buttons=anchor?card.tools?.detailButtons(anchor,episode,issueData)||"":"";
    if(buttons)for(const control of controls)if([anchor.node_id,episode.episode_id].includes(control.target))shownControls.add(control.control_id);
    const scope=grouped?`<p class="small">These controls apply to the whole issue headed by ${esc(name)}${members.size>1?`, involving ${members.size} sources`:""}.</p>`:"";
    return `<div class="source-related-issue"><button type="button" class="source-child" data-episode="${esc(episode.episode_id)}"><span>${esc(finding?.message||name)}</span><small>View issue</small></button>${episode.opened_at?`<p class="small">Issue opened <time datetime="${esc(episode.opened_at)}">${esc(displayDate(episode.opened_at))}</time></p>`:""}${buttons?`${scope}${buttons}`:""}</div>`;
  }).join("")}</section>`;
}

function entityMonitoringSummary(source,coverage) {
  if(source.disabled)return "";
  const state=sourceCoverage(source,coverage);
  if(!state.monitored)return '<p class="source-monitoring-status">Not monitored</p>';
  const labels=state.labels.filter(label=>label!=="Device availability").map(label=>label.toLowerCase());
  const checks=labels.length>1?`${labels.slice(0,-1).join(", ")} and ${labels.at(-1)}`:labels[0];
  const message=checks?`Monitored for ${checks}${state.device&&!labels.includes("availability")?". Also used to assess device availability.":""}`:"Used to assess device availability";
  return `<p class="source-monitoring-status">${esc(message)}</p>`;
}

/** Restore the filter popover through live renders without moving the toolbar. */
export function restoreSourceFilters(card) {
  card.sourcesFilterListeners?.abort();
  const menu=card.main.querySelector("#sources-more-filters"),trigger=card.main.querySelector("[data-sources-filters]");
  if(!menu||!trigger){card.sourcesFiltersOpen=false;return;}
  if(!menu.showPopover)return;
  const position=()=>{
    if(!menu.matches(":popover-open"))return;
    const viewport=window.visualViewport,top=viewport?.offsetTop||0,left=viewport?.offsetLeft||0;
    const height=viewport?.height||window.innerHeight,width=viewport?.width||window.innerWidth;
    menu.style.maxHeight=`${Math.max(0,height-16)}px`;
    const rect=trigger.getBoundingClientRect(),size=menu.getBoundingClientRect();
    const below=rect.bottom+4,preferred=below+size.height<=top+height-8?below:rect.top-size.height-4;
    menu.style.top=`${Math.max(top+8,Math.min(preferred,top+height-size.height-8))}px`;
    menu.style.left=`${Math.max(left+8,Math.min(rect.right-size.width,left+width-size.width-8))}px`;
  };
  const watch=()=>{
    card.sourcesFilterListeners?.abort();
    const controller=new AbortController();
    card.sourcesFilterListeners=controller;
    const signal=controller.signal;
    window.addEventListener("resize",position,{signal});
    window.addEventListener("scroll",position,{capture:true,signal});
    window.visualViewport?.addEventListener("resize",position,{signal});
    window.visualViewport?.addEventListener("scroll",position,{signal});
  };
  menu.ontoggle=event=>{
    if(!menu.isConnected)return;
    card.sourcesFiltersOpen=event.newState==="open";
    if(card.sourcesFiltersOpen){position();watch();}
    else card.sourcesFilterListeners?.abort();
  };
  menu.onkeydown=event=>{
    if(event.key!=="Escape")return;
    event.preventDefault();menu.hidePopover();card.sourcesFiltersOpen=false;trigger.focus();
  };
  if(card.sourcesFiltersOpen&&trigger.getClientRects().length){menu.showPopover();position();}
}

/** Render the accepted tree-and-detail workspace without nested page navigation. */
export function sourcesBrowser(card) {
  const data=card.current.data;
  const topomationAvailable=Boolean(topomationTree(data,card.topomation));
  const full=sourcesTree(data,card.sourcesGrouping,card._hass?.localize||null,card.topomation,Boolean(card.sourcesShowDisabled));
  const paths=sourcePaths(full),episodes=sortedEpisodes(data);
  const issues=new Map(episodes.flatMap(item=>issueMembers(item).map(id=>[id,item])));
  for(const [id,item] of [...issues]) {const canonical=paths.get(`source:${id}`)?.node.source?.node_id;if(canonical)issues.set(canonical,item);}
  const coverage=sourceCoverageIndex(data);
  const excluded=new Set((card.configuration?.settings?.monitoring_policies||[]).filter(policy=>policy.check==="availability").flatMap(policy=>policy.excluded_sources||[]));
  const excludedBranches=nodes=>nodes.flatMap(node=>{const children=excludedBranches(node.children);return children.length||excluded.has(node.source?.node_id)?[{...node,children}]:[];});
  const filtered=filterSourceMonitoring(filterSources(full,card.sourcesQuery,card.sourcesNeedsReview,issues),card.sourcesMonitoring,coverage);
  const visible=card.sourcesExcludedOnly?excludedBranches(filtered):filtered;
  const selected=paths.get(card.sourcesSelection);
  const branch=node=>{
    const expanded=Boolean(card.sourcesQuery?.trim())||card.sourcesExpanded.has(node.key);
    const fullNode=paths.get(node.key)?.node||node;
    const hasIssues=[...sourceIds(fullNode)].some(id=>issues.has(id));
    const limit=card.sourcesLimits?.get(node.key)||80;
    const shown=expanded?node.children.slice(0,limit):[];
    const linked=expanded&&node.children.find(child=>child.key===selected?.node.key||(child.connection&&child.connection.node_id===selected?.node.source?.node_id)||selected?.parents.some(parent=>parent.key===child.key));
    if(linked&&!shown.includes(linked))shown.push(linked);
    const extent=node.family?"Integration":node.type==="device"?"Device":node.source?.kind==="integration"?`Integration connection · ${monitoringState(node.source,coverage)}`:node.source?monitoringState(node.source,coverage):"";
    const issue=hasIssues?` <span class="source-issue-count">Issues</span>`:"";
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length?`<button type="button" class="config-toggle" data-sources-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded?'Collapse':'Expand'} ${esc(node.name)}"><span class="disclosure" aria-hidden="true"></span></button>`:'<span class="config-leaf" aria-hidden="true"></span>'}<button type="button" class="config-pick" data-sources-select="${esc(node.key)}"${selected?.node.key===node.key||(node.connection&&node.connection.node_id===selected?.node.source?.node_id)?' aria-current="true"':''}><span class="source-row-title">${esc(node.name)}${issue}</span>${extent?`<small>${esc(extent)}</small>`:""}</button></div>${expanded?`<ul class="config-nav-children">${shown.map(branch).join("")}${node.children.length>limit?`<li><button type="button" class="link source-more" data-source-more="${esc(node.key)}">Show more sources (${shown.length} of ${node.children.length})</button></li>`:''}</ul>`:''}</li>`;
  };
  const node=selected?.node;
  const entity=node?.source?.kind==="entity";
  const device=node?.source?.kind==="device";
  const context=selected?.parents.filter(parent=>!entity||parent.type!=="location"||parent.location&&!["group","unassigned"].includes(parent.location.kind)).map(parent=>parent.name).filter((name,index,names)=>name!==node?.name&&(index===0||name!==names[index-1])).join(" / ")||"";
  const entityLocation=entity?selected.parents.filter(parent=>parent.type==="location"&&parent.location&&!["group","unassigned"].includes(parent.location.kind)).map(parent=>parent.name).filter((name,index,names)=>names.indexOf(name)===index).join(" / "):"";
  const type=node?.family?"Integration":node?.source?sourceType(node.source):node?.type==="device"?"Device":"Location";
  const automationReporting=node?.source?.automation_url?sourceReporting(card,node):"";
  const equipmentControls=node?.source?card.tools?.detailButtons(node.source,null,data)||"":"";
  const activeEquipment=node?.source&&(data.inventory.operator_controls||[]).some(control=>control.target===node.source.node_id);
  const inspection=node?sourceInspection(card,node,coverage):null;
  const secondary=`${inspection?.details||""}${equipmentControls&&!activeEquipment?`<section class="source-equipment"><h3>Equipment controls</h3>${equipmentControls}</section>`:""}${automationReporting}${node&&!entity?sourceTechnicalDetails(card,node):""}`;
  const entityMonitoring=entity?`<section class="source-entity-monitoring">${entityMonitoringSummary(node.source,coverage)}${availabilityActions(card,node)}${!node.source.disabled&&!availabilityMonitoring(card,node.source).canStop&&!availabilityMonitoring(card,node.source).canResume?'<button type="button" class="link" data-page="policies" data-configure-monitoring>Configure monitoring</button>':""}${sourcePolicies(card,node)}${!activeEquipment?equipmentControls:""}</section>`:"";
  const sourceContent=node?(device?`${inspection.summary}${inspection.body}${sourceIssueLinks(card,node,episodes,data)}${activeEquipment?equipmentControls:""}${card.sourcesView==="history"?sourceNavigation(card,node):""}${inspection.monitoring}`:`${inspection?`${inspection.summary}${entity?"":availabilityActions(card,node)}${inspection.body}`:`${sourceMonitoringSummary(node.source,coverage)}${currentSourceEvidence(card,node,episodes)}`}${sourceIssueLinks(card,node,episodes,data)}${activeEquipment?equipmentControls:""}${entityMonitoring}${sourceNavigation(card,node)}${entity?"":sourcePolicies(card,node,secondary)}`):"";
  const detail=node?`<header class="source-heading"><button type="button" class="link sources-back" data-action="back-sources">← Back to Monitoring</button>${entity||device?`<p class="source-kind">${device?"Device":"Entity"}</p>`:""}<h2 id="sources-detail-title" tabindex="-1">${esc(node.name)}</h2>${entity?`<nav class="source-native-navigation" aria-label="Home Assistant navigation">${sourceHeaderMetadata(card,node.source)}</nav>${entityLocation?`<p class="config-path">${esc(entityLocation)}</p>`:""}`:`<p class="config-path">${esc(context||(inspection?"":type))}</p>`}${device&&card.sourcesView!=="history"?sourceNavigation(card,node):""}</header><div class="source-body">${sourceContent}</div>`:'<div class="sources-empty"><h2>Select an item</h2><p>See its status, issues and monitoring.</p></div>';
  const activeFilters=[card.sourcesShowDisabled?"Disabled sources":"",card.sourcesExcludedOnly?"Availability exclusions":""].filter(Boolean);
  const filters=`<div class="sources-filter-control"><button type="button" class="button" data-sources-filters popovertarget="sources-more-filters" aria-label="More filters${activeFilters.length?`: ${activeFilters.join(", ")}`:""}">More filters${activeFilters.length?` (${activeFilters.length})`:""}</button><div id="sources-more-filters" class="sources-filter-popover" popover aria-label="More monitoring filters"><label><input type="checkbox" data-sources-disabled${card.sourcesShowDisabled?' checked':''}> Include disabled sources</label><label><input type="checkbox" data-sources-excluded${card.sourcesExcludedOnly?' checked':''}> Availability exclusions only</label></div></div>`;
  const monitoringFilter=`<label class="sources-monitoring-filter">Monitoring status<select data-sources-monitoring><option value="all"${!card.sourcesMonitoring||card.sourcesMonitoring==="all"?' selected':''}>All</option><option value="monitored"${card.sourcesMonitoring==="monitored"?' selected':''}>Monitored</option><option value="unmonitored"${card.sourcesMonitoring==="unmonitored"?' selected':''}>Not monitored</option></select></label>`;
  const grouping=`<div class="source-tree-tools"><label>Group by<select data-sources-group><option value="integration"${card.sourcesGrouping==="integration"?' selected':''}>Integration</option><option value="location"${card.sourcesGrouping==="location"?' selected':''}>Home Assistant location</option>${topomationAvailable||card.sourcesGrouping==="topomation"?`<option value="topomation"${card.sourcesGrouping==="topomation"?' selected':''}${topomationAvailable?'':' disabled'}>TopoMation locations${topomationAvailable?'':' (loading)'}</option>`:""}</select></label><button type="button" class="button sources-collapse" data-action="collapse-sources"${!card.sourcesExpanded.size||card.sourcesQuery?.trim()?' disabled':''}>Collapse groups</button></div>`;
  return `<section class="panel sources-workspace" data-mobile-detail="${Boolean(card.sourcesMobileDetail&&node)}"><div class="sources-tools"><label class="coverage-search">Search<input type="search" data-sources-search value="${esc(card.sourcesQuery||"")}" placeholder="Name or entity ID"></label>${monitoringFilter}${filters}${card.sourcesNeedsReview?'<button type="button" class="link" data-action="all-sources">Show all sources</button>':''}</div><div class="config-layout"><nav class="config-rail" aria-label="Monitoring tree">${grouping}<ul class="config-tree">${visible.map(branch).join("")||'<li class="sub">No matching sources.</li>'}</ul></nav><section class="config-detail" aria-label="Selected source">${detail}</section></div></section>`;
}
