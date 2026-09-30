import {sourceReporting} from "./reporting.mjs?v=46";
import {integrationSettings} from "./source-settings.mjs?v=53";
import {sourceHistory as renderSourceHistory} from "./source-history.mjs?v=51";
import {coverageInventory, escapeHtml as esc, inventoryRows, locationTree, sortedEpisodes} from "./model.mjs?v=46";
import {monitoringTree, monitoringScope, scopeChoice} from "./configuration.mjs?v=46";
import {batteryProblem, deviceProblem, entityProblem, integrationProblem} from "./problem.mjs?v=46";

import {deviceAvailability} from "./device-availability.mjs?v=46";

const key = (...parts) => JSON.stringify(parts);
const byName = (a,b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
const sourceName = source => source.name?.trim() || (source.kind === "integration" ? "Unnamed connection" : source.kind === "device" ? "Unnamed device" : source.kind === "battery" ? "Battery" : "Unnamed entity");
const sourceNode = source => ({key:`source:${source.node_id}`,name:sourceName(source),type:source.kind,source,children:[]});
const unique = (items, identity = item => item.key) => [...new Map(items.map(item => [identity(item),item])).values()];
const displayDate = value => value ? new Date(value).toLocaleString() : "Time not reported";
const familyDevices = family => [...sourcePaths(family.children).values()].map(item=>item.node).filter(node=>node.source?.kind==="device");

/** Use the integration type, preserving individual connections below a family. */
export function integrationFamilies(data, localize = () => null) {
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
  for(const source of inventoryRows(data).filter(item=>["entity","device","battery"].includes(item.kind))) {
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
export function sourcesTree(data,grouping = "integration",localize = () => null,topomation = null) {
  const tree=groupedSources(data,grouping,localize,topomation);
  const present=sourcePaths(tree);
  const situations=inventoryRows(data).filter(source=>source.kind==="situation"&&!present.has(`source:${source.node_id}`)).map(sourceNode);
  if(situations.length)tree.push({key:"situations",name:"Configured situations",type:"location",children:situations});
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
  const convert = location => ({key:`location:${location.id}`,name:location.name,type:"location",location,
    children:[...location.children.map(convert),...location.devices.map(device=>{
      const summary=device.sources.find(source=>source.kind==="device");
      return {key:summary?`source:${summary.node_id}`:`device:${device.id}`,name:device.name?.trim()||"Unnamed device",type:"device",source:summary,device,children:device.sources.filter(source=>["entity","battery"].includes(source.kind)).map(sourceNode).sort(byName)};
    }),...location.signals.filter(source=>["entity","battery"].includes(source.kind)).map(sourceNode)].sort(byName)});
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
  const visit=(nodes,parents)=>{for(const node of nodes){if(!paths.has(node.key))paths.set(node.key,{node,parents});if(node.connection){const alias=sourceNode(node.connection);if(!paths.has(alias.key))paths.set(alias.key,{node:alias,parents});}visit(node.children,[...parents,node]);}};
  visit(tree,[]);return paths;
}

export function sourceEvidence(data) {
  const result=new Map();
  for(const group of coverageInventory(data).groups)for(const device of group.devices)for(const item of device.sources)if(item.reasons.length)result.set(item.source.node_id,item);
  return result;
}

function monitoringState(source,included) {
  if(source.excluded_by?.length)return "Excluded";
  if(source.kind==="entity")return source.watched?"Separate check":included.has(source.entity_id)?"Included with device":"Not selected";
  return source.watched?"Monitored":"Not monitored";
}

function connectionState(source,data,episodes) {
  if(episodes.some(item=>item.anchor===source.node_id))return "Connection issue";
  const state=data.inventory.integration_evidence?.[source.node_id]?.current?.reason||data.inventory.integration_states?.[source.node_id];
  if(state==="loaded")return "Connection loaded";
  if(state&&state!=="not_loaded")return "Connection needs review";
  return source.watched?"Connection monitored":"Connection not monitored";
}

function includedEntities(data) {
  return new Set(inventoryRows(data).filter(row=>row.kind==="device"&&row.watched).flatMap(row=>row.availability_entities||[]));
}

export function sourceMonitoringChoices(card,node) {
  if(node.source?.automation_url)return '<p class="sub">Edit the condition, name, message, and reporting preference in its Home Assistant automation.</p>'+sourceReporting(card,node);
  if(!card.configuration)return `<p class="sub">${esc(card.configError||"Loading monitoring choices…")}</p><button type="button" class="button" data-action="load-configuration">Reload choices</button>`;
  if(node.family)return integrationSettings(card,node);
  const source=node.source;
  const choice=(label,scope,options,advanced=false)=>{
    if(!scope)return "";
    const index=card.configScopes.push(scope)-1;
    const current=scopeChoice(card.configDraft,scope);
    if(current==="multiple")return '<p class="note">Several saved policies apply here.</p><button type="button" class="link" data-settings-section="policies">Review monitoring policies in Settings</button>';
    const option=([value,title,help])=>`<label class="source-radio"><input type="radio" name="source-choice-${index}" data-scope-index="${index}" value="${value}"${current===value?' checked':''}><span><strong>${esc(title)}</strong>${help?`<small>${esc(help)}</small>`:''}</span></label>`;
    const choices=advanced?`${option(options[0])}${option(options[2])}<details class="source-advanced-choice"${current==="attach"?' open':''}><summary>More monitoring choices</summary>${option(options[1])}</details>`:options.map(option).join("");
    return `<fieldset class="source-choices"${card.configBusy?' disabled':''}><legend>${esc(label)}</legend>${choices}</fieldset>`;
  };
  let controls="";
  if(source?.kind==="integration")controls+=choice("Integration connection",monitoringScope("entry",source.entry_id),[["inherit","Use integration default","Follow the saved policy for this integration."],["attach","Monitor this connection","Report if Home Assistant cannot load it."],["exclude","Do not monitor this connection",""]]);
  else if(source?.kind==="device")controls+=choice("Device availability",monitoringScope("device_availability",source.attributes?.device?.[0]??source.node_id.slice(7)),[["inherit","Use integration default",`Currently ${source.watched?"monitored":"not monitored"}.`],["attach","Always monitor this device","Report selected entities becoming unavailable."],["exclude","Do not monitor this device","Keep it in Sources without availability issues."]]);
  else if(source?.kind==="entity"){
    const included=includedEntities(card.current.data);
    controls+=`<p class="source-current-choice">Currently: ${esc(monitoringState(source,included))}</p>`;
    controls+=choice("Entity availability",monitoringScope("entity",source.node_id,source),[["inherit","Follow device monitoring","Include this entity when its device selects it."],["attach",included.has(source.entity_id)?"Monitor this entity separately":"Monitor this entity","Give this entity its own availability check."],["exclude","Exclude this entity","Remove it from device monitoring and separate checks."]],included.has(source.entity_id));
  }
  else if(source?.kind==="battery")controls+=choice("Battery condition",monitoringScope("battery",source.node_id,source),[["inherit","Use battery monitoring policies",`Currently ${source.watched?"monitored":"not monitored"}.`],["attach","Monitor this battery","Report a current low-battery condition."],["exclude","Do not monitor this battery","Keep its readings available for review without an issue."]]);
  if(source?.kind==="device"){
    controls+=`<p class="small">${source.availability_entities?.length||0} entities included. Open an entity in the tree to change its inclusion.</p>`;
    if(node.connection)controls+=`<button type="button" class="link" data-sources-select="source:${esc(node.connection.node_id)}">Change this connection's monitoring</button>`;
    const family=integrationFamilies(card.current.data).find(item=>familyDevices(item).some(child=>child.source?.node_id===source.node_id));
    if(family)controls+=`<button type="button" class="link" data-sources-select="${esc(family.key)}">View ${esc(family.name)} default</button>`;
  }
  if(source?.kind==="situation")controls='<p class="sub">This situation uses its configured condition. Reporting does not change what detects it.</p>';
  if(!controls)controls='<p class="sub">Select an integration, device, or entity to change monitoring.</p>';
  if(source?.excluded_by?.length)controls+='<p class="note">A saved exclusion applies. Review changes to see the effective result; an individual watch does not override ordinary exclusions.</p>';
  return controls+(card.sourcesSettingsPanel||"")+sourceReporting(card,node);
}

function sourceReport(card,node,episodes) {
  const source=node.source,data=card.current.data;
  if(source?.kind==="situation"){
    const active=episodes.find(item=>item.anchor===source.node_id);
    return `<section class="source-section"><h3>${active?"Situation active":"No active situation"}</h3><p>${esc(active?.reasons?.map(finding=>finding.message||finding.reason).join("; ")||"The configured condition is not currently reported as active.")}</p><button type="button" class="link" data-sources-view="settings">Change reporting preference</button></section>`;
  }
  const evidence=card.sourceDetail?.nodeId===source?.node_id?card.sourceDetail:null;
  const devices=node.family?familyDevices(node):[];
  const deviceSummary=node.family?`<section class="source-section"><h3>Devices</h3><p>${devices.filter(child=>child.source?.watched).length} of ${devices.length} devices monitored.</p>${devices.filter(child=>episodes.some(episode=>episode.anchor===child.source?.node_id||episode.anchor===child.connection?.node_id||child.children.some(member=>member.source?.node_id===episode.anchor))).map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>Open issue</small></button>`).join("")}<button type="button" class="link" data-sources-view="settings">Change what this integration monitors</button></section>`:"";
  if(node.family&&node.entries.length>1) {
    const related=new Set([...sourcePaths([node]).values()].map(item=>item.node.source?.node_id));
    const count=episodes.filter(item=>related.has(item.anchor)).length;
    return `<p>${count?`${count} open ${count===1?"issue":"issues"} in this integration.`:"No open issues in monitored sources."}</p>${deviceSummary}<details class="source-section source-connections"><summary>${node.entries.length} Home Assistant connections</summary><p class="small">Each connection retains its own setup status and monitoring choice.</p>${node.entries.map(entry=>`<button type="button" class="source-child" data-sources-select="source:${esc(entry.node_id)}"><span>${esc(sourceName(entry))}</span><small>${esc(data.inventory.integration_states?.[entry.node_id]==="loaded"?"Loaded":"View connection")}</small></button>`).join("")}</details>`;
  }
  if(!source)return `<p class="sub">${node.children.length} items in this group.</p>${node.children.map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>View</small></button>`).join("")}`;
  if(!evidence||evidence.loading)return '<p class="sub" role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  const linked=episodes.filter(item=>item.anchor===source.node_id);
  if(source.kind==="battery"){
    const condition=evidence.battery_condition;
    const problem=batteryProblem(source,{current:condition},Boolean(linked.length));
    const rows=evidence.members||[];
    const deviceId=source.attributes?.device?.[0];
    const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
    return `<section class="source-condition${condition?.status==="warn"?' needs-attention':''}"><h3>${esc(problem.headline)}</h3><p>${esc(condition?.message||problem.summary)}</p><p><strong>Next step:</strong> ${esc(problem.nextStep)}</p></section>${!source.watched?'<p class="small">Battery monitoring is off. Review the choice in Settings before saving.</p>':''}<section class="source-section"><h3>Battery evidence</h3><table class="source-readings"><tbody>${rows.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(item.restored?'Restored state':item.state)}</td></tr>`).join('')}</tbody></table><p class="small">Home Assistant values do not prove physical freshness. Charging clears this low condition; it does not prove a full charge or replacement.</p></section>${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">Problem actions</button>`).join('')}${href?`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`:''}`;
  }
  const status=evidence?.entity_status||data.inventory.entity_status?.[source.node_id];
  const current=evidence?.integration_evidence||data.inventory.integration_evidence?.[source.node_id];
  const problem=source.kind==="integration"?integrationProblem(source,linked.flatMap(item=>item.reasons||[]),key=>card._hass?.localize?.(key),current,Boolean(linked.length)):source.kind==="device"?deviceProblem(source,status,Boolean(linked.length)):entityProblem(source,status,null,data.areas,key=>card._hass?.localize?.(key),Boolean(linked.length));
  const members=evidence?.members||[];
  const unavailable=members.filter(item=>item.state==="unavailable"),unknown=members.filter(item=>item.state==="missing"||item.restored);
  const badCount=evidence.unavailable_count??unavailable.length, unknownCount=evidence.unknown_count??unknown.length;
  if(source.kind==="entity"){
    const member=members[0];
    const state=source.disabled?"Disabled in Home Assistant":member?.restored?"Waiting for a current Home Assistant state":member?.state==="unavailable"?"Unavailable in Home Assistant":!member||member.state==="missing"?"No current Home Assistant state":"Available in Home Assistant";
    const unit=member?.unit?`${member.unit==="%"?"":" "}${member.unit}`:"";
    const value=member&&!member.restored&&!['unavailable','missing'].includes(member.state)?`<p>Current value: ${esc(member.state+unit)}</p>`:"";
    const monitoring=monitoringState(source,includedEntities(data));
    const deviceId=source.attributes?.device?.[0];
    const href=deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
    const action=`<div class="source-actions"><button type="button" class="link" data-sources-view="settings">Change monitoring</button>${href?`<a class="link" href="${esc(href)}">${deviceId?"Open device":"View entity state"} in Home Assistant</a>`:''}</div>`;
    return `<section class="source-condition${(linked.length||monitoring==="Included with device")&&member?.state==="unavailable"?' needs-attention':''}"><h3>${esc(state)}</h3>${value}<p class="source-monitoring-status">Monitoring: ${esc(monitoring)}</p></section>${action}${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">View issue</button>`).join('')}${evidence?.updated_at?`<p class="small source-updated">Updated ${esc(displayDate(evidence.updated_at))}</p>`:''}`;
  }
  if(source.kind==="device"){
    const selected=evidence.total??members.length;
    const headline=source.disabled?"Disabled in Home Assistant":!source.watched?"Device availability monitoring is off":!selected?"No entities selected for this check":badCount?`${badCount} of ${selected} selected ${selected===1?"entity is":"entities are"} unavailable`:unknownCount?`${unknownCount} of ${selected} selected ${selected===1?"entity needs":"entities need"} a current state`:linked.length?"Confirming recovery":"Selected entities available";
    const review=members.filter(item=>item.state==="unavailable"||item.state==="missing"||item.restored);
    const other=members.filter(item=>!review.includes(item));
    const rows=items=>`<table class="source-readings"><tbody>${items.map(item=>`<tr><td><button type="button" class="link" data-source-link="${esc(item.node_id)}">${esc(item.name)}</button></td><td>${esc(item.restored?"Restored state":item.state)}</td></tr>`).join("")}</tbody></table>`;
    const href=source.attributes?.device?.[0]?`/config/devices/device/${encodeURIComponent(source.attributes.device[0])}`:null;
    const actions=`<div class="source-actions"><button type="button" class="link" data-sources-view="settings">Change monitored entities</button>${href?`<a class="link" href="${esc(href)}">Open device in Home Assistant</a>`:''}</div>`;
    const list=review.length?`<section class="source-section"><h3>Entities needing review</h3>${rows(review)}</section>`:"";
    const healthy=other.length?`<details class="source-section source-healthy"><summary>${other.length} other selected ${other.length===1?"entity":"entities"}</summary>${rows(other)}</details>`:"";
    const limit=selected>members.length?`<p class="small">Showing ${members.length} of ${selected} selected entities. Search the tree to find any others.</p>`:"";
    const connection=node.connection?`<section class="source-section"><h3>Home Assistant connection</h3><p>${esc(connectionState(node.connection,data,episodes))}</p><button type="button" class="link" data-sources-select="source:${esc(node.connection.node_id)}">View connection details</button></section>`:"";
    return `${connection}<section class="source-condition${badCount||unknownCount||linked.length?' needs-attention':''}"><h3>${esc(headline)}</h3></section>${deviceAvailability(evidence.device_availability,true)}${actions}${list}${healthy}${limit}${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">View issue</button>`).join('')}${evidence?.updated_at?`<p class="small source-updated">Updated ${esc(displayDate(evidence.updated_at))}</p>`:''}`;
  }
  const headline=source.disabled?"Disabled in Home Assistant":current?.current?.reason==="loaded"&&!linked.length?"Loaded in Home Assistant":problem?.headline||"No current state";
  const usefulProblem=linked.length||(current?.current?.reason&&current.current.reason!=="loaded");
  const summary=source.disabled?"Home Assistant is not using this source. Review its integration if this was not intentional.":problem?.summary||"Current state has not been reported.";
  let html=`<section class="source-condition${usefulProblem?' needs-attention':''}"><h3>${esc(headline)}</h3><p>${esc(summary)}</p>${usefulProblem&&problem?.nextStep?`<p><strong>Next step:</strong> ${esc(problem.nextStep)}</p>`:''}</section>`;
  if(!source.watched)html+='<p class="small">Availability monitoring is off for this connection.</p>';
  if(evidence?.error)html+=`<p role="alert">${esc(evidence.error)}</p><button type="button" class="link" data-action="refresh-source">Retry reading</button>`;
  if(evidence?.updated_at)html+=`<p class="small source-updated">Updated ${esc(displayDate(evidence.updated_at))}</p>`;
  if(linked.length)html+=`<section class="source-section">${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">Problem actions</button>`).join("")}</section>`;
  const href=problem?.integrationUrl;
  if(href)html+=`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`;
  return html+deviceSummary;
}

function sourceHistory(card,node) {
  const sources=[...sourcePaths([node]).values()].map(item=>item.node.source).filter(Boolean);
  return renderSourceHistory(card.current.data,sources);
}

/** Render the accepted tree-and-detail workspace without nested page navigation. */
export function sourcesBrowser(card) {
  const data=card.current.data;
  const topomationAvailable=Boolean(topomationTree(data,card.topomation));
  const full=sourcesTree(data,card.sourcesGrouping,key=>card._hass?.localize?.(key),card.topomation);
  const paths=sourcePaths(full),episodes=sortedEpisodes(data);
  const issues=new Map(episodes.map(item=>[item.anchor,item]));
  const included=includedEntities(data);
  const visible=filterSources(full,card.sourcesQuery,card.sourcesNeedsReview,issues);
  const selected=paths.get(card.sourcesSelection);
  const branch=node=>{
    const expanded=card.sourcesExpanded.has(node.key);
    const fullNode=paths.get(node.key)?.node||node;
    const ids=new Set([...sourcePaths([fullNode]).values()].map(item=>item.node.source?.node_id));
    const count=episodes.filter(item=>ids.has(item.anchor)).length;
    const limit=card.sourcesLimits?.get(node.key)||80;
    const shown=expanded?node.children.slice(0,limit):[];
    const linked=expanded&&node.children.find(child=>child.key===card.sourcesSelection||child.connection?.node_id===selected?.node.source?.node_id||selected?.parents.some(parent=>parent.key===child.key));
    if(linked&&!shown.includes(linked))shown.push(linked);
    const deviceCount=fullNode.family?familyDevices(fullNode).length:0;
    const entityCount=fullNode.type==="device"?fullNode.children.filter(child=>child.type==="entity").length:0;
    const includedCount=fullNode.type==="device"?fullNode.children.filter(child=>child.source?.kind==="entity"&&included.has(child.source.entity_id)&&!child.source.excluded_by?.length).length:0;
    const deviceExtent=entityCount?`${includedCount}/${entityCount} entities included`:"No device entities";
    const extent=node.family?`${deviceCount} ${deviceCount===1?"device":"devices"}`:node.type==="device"?`${node.connection?`${node.connection.name!==node.name?`${node.connection.name} · `:""}${connectionState(node.connection,data,episodes)} · `:""}${deviceExtent}`:node.source?.kind==="integration"?`Integration connection · ${monitoringState(node.source,included)}`:node.source?monitoringState(node.source,included):`${node.children.length} items`;
    const issue=count?` <span class="source-issue-count">· ${count} ${count===1?"issue":"issues"}</span>`:"";
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length?`<button type="button" class="config-toggle" data-sources-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded?'Collapse':'Expand'} ${esc(node.name)}"><span class="disclosure" aria-hidden="true"></span></button>`:'<span class="config-leaf" aria-hidden="true"></span>'}<button type="button" class="config-pick" data-sources-select="${esc(node.key)}"${card.sourcesSelection===node.key||node.connection?.node_id===selected?.node.source?.node_id?' aria-current="true"':''}><span class="source-row-title">${esc(node.name)}${issue}</span><small>${esc(extent)}</small></button></div>${expanded?`<ul class="config-nav-children">${shown.map(branch).join("")}${node.children.length>limit?`<li><button type="button" class="link source-more" data-source-more="${esc(node.key)}">Show more sources</button></li>`:''}</ul>`:''}</li>`;
  };
  const node=selected?.node,view=card.sourcesView||"source";
  const tabs=`<nav class="sources-views" aria-label="Selected source views">${[["source","Source"],["settings","Settings"],["history","History"]].map(([id,label])=>`<button type="button" data-sources-view="${id}" aria-current="${view===id?'page':'false'}">${label}${id==="settings"&&card.configuration&&JSON.stringify(card.configDraft)!==JSON.stringify(card.configuration.rules)?" •":""}</button>`).join("")}</nav>`;
  const context=selected?.parents.map(parent=>parent.name).join(" / ")|| (node?.family?"Integration":node?.type==="location"?"Location":"");
  const detail=node?`<header class="source-heading"><button type="button" class="link sources-back" data-action="back-sources">← Back to sources</button><p class="config-path">${esc(context)}</p><h2 id="sources-detail-title" tabindex="-1">${esc(node.name)}</h2>${node.source?.entity_id?`<p class="source-entity-id">${esc(node.source.entity_id)}</p>`:""}${tabs}</header><div class="source-body">${view==="settings"?sourceMonitoringChoices(card,node):view==="history"?sourceHistory(card,node):sourceReport(card,node,episodes)}</div>`:'<div class="sources-empty"><h2>Choose an integration or device</h2><p class="sub">See its status, change monitoring, or review its history.</p></div>';
  const guidance=`<details class="sources-explainer" data-sources-explainer${card.sourcesHelpOpen?' open':''}><summary>How monitoring is chosen</summary><p>New installations monitor integration connections. Device availability, separate entity checks, and battery conditions need a saved choice.</p><p>For a monitored device, Homeostatic checks enabled ordinary Home Assistant entities. It uses diagnostic entities only when there are no enabled ordinary ones. Configuration and disabled entities are left out. An entity exclusion removes it from the device check.</p><p>This checks availability in Home Assistant, not physical device health. Open a source’s Settings to review or change its choice.</p></details>`;
  return `<section class="panel sources-workspace" data-mobile-detail="${Boolean(card.sourcesMobileDetail&&node)}"><div class="sources-tools"><label>Group by<select data-sources-group><option value="integration"${card.sourcesGrouping==="integration"?' selected':''}>Integration</option><option value="location"${card.sourcesGrouping==="location"?' selected':''}>Home Assistant location</option>${topomationAvailable||card.sourcesGrouping==="topomation"?`<option value="topomation"${card.sourcesGrouping==="topomation"?' selected':''}${topomationAvailable?'':' disabled'}>Topomation${topomationAvailable?'':' (loading)'}</option>`:''}</select></label><label class="coverage-search">Find a source<input type="search" data-sources-search value="${esc(card.sourcesQuery)}" placeholder="Search devices and integrations"></label>${card.sourcesExpanded.size?'<button type="button" class="link sources-collapse" data-action="collapse-sources">Collapse all</button>':''}${card.sourcesNeedsReview?'<button type="button" class="link" data-action="all-sources">Show all sources</button>':''}</div><div class="config-layout"><nav class="config-rail" aria-label="Sources tree">${guidance}<ul class="config-tree">${visible.map(branch).join("")||'<li class="sub">No matching sources.</li>'}</ul></nav><section class="config-detail" aria-label="Selected source">${detail}</section></div></section>`;
}
