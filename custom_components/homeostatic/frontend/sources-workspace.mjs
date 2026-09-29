import {sourceReporting} from "./reporting.mjs?v=41";
import {coverageInventory, escapeHtml as esc, inventoryRows, locationTree, sortedEpisodes} from "./model.mjs?v=41";
import {monitoringTree, monitoringScope, scopeChoice} from "./configuration.mjs?v=41";
import {deviceProblem, entityProblem, integrationProblem} from "./problem.mjs?v=41";

const key = (...parts) => JSON.stringify(parts);
const byName = (a,b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
const sourceName = source => source.name?.trim() || (source.kind === "integration" ? "Unnamed connection" : source.kind === "device" ? "Unnamed device" : "Unnamed entity");
const sourceNode = source => ({key:`source:${source.node_id}`,name:sourceName(source),type:source.kind,source,children:[]});
const unique = (items, identity = item => item.key) => [...new Map(items.map(item => [identity(item),item])).values()];
const displayDate = value => value ? new Date(value).toLocaleString() : "Time not reported";

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
    const children = [...devices.values()].map(device=>({key:device.summary?`source:${device.summary.node_id}`:`device:${device.id}`,name:device.name?.trim()||"Unnamed device",type:"device",source:device.summary,device,children:device.entities.map(sourceNode).sort(byName)}));
    children.push(...unique(family.groups.flatMap(group=>group.loose).map(sourceNode)));
    if(entries.length>1) children.unshift({key:key("connections",family.id),name:"Connections",type:"connections",children:entries.map(sourceNode).sort(byName)});
    return {...family,key:entries.length===1?`source:${entries[0].node_id}`:key("family",family.id),type:"integration",source:entries.length===1?entries[0]:null,entries,children:children.sort(byName),family:true};
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
  for(const source of inventoryRows(data).filter(item=>["entity","device"].includes(item.kind))) {
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
      return {key:summary?`source:${summary.node_id}`:`device:${device.id}`,name:device.name?.trim()||"Unnamed device",type:"device",source:summary,device,children:device.sources.filter(source=>source.kind==="entity").map(sourceNode).sort(byName)};
    }),...location.signals.filter(source=>source.kind==="entity").map(sourceNode)].sort(byName)});
  const roots=locationTree(data).map(convert);
  const entries=inventoryRows(data).filter(source=>source.kind==="integration").map(source=>({...sourceNode(source),name:integrationProblem(source,[],localize).integration+" / "+sourceName(source)})).sort(byName);
  if(entries.length) roots.push({key:"location:other-sources",name:"Integration connections",type:"location",children:entries});
  return roots;
}

/** Search the complete inventory while retaining readable ancestor paths. */
export function filterSources(tree,query = "",needsReview = false,gaps = new Map()) {
  const needle=query.trim().toLocaleLowerCase();
  const visit=(nodes,parentMatch=false)=>nodes.flatMap(node=>{
    const match=parentMatch||[node.name,node.source?.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
    const children=visit(node.children,match);
    const review=!needsReview||gaps.has(node.source?.node_id)||children.length;
    return review&&(match||children.length||!needle)?[{...node,children}]:[];
  });
  return visit(tree);
}

export function sourcePaths(tree) {
  const paths=new Map();
  const visit=(nodes,parents)=>{for(const node of nodes){if(!paths.has(node.key))paths.set(node.key,{node,parents});visit(node.children,[...parents,node]);}};
  visit(tree,[]);return paths;
}

export function sourceEvidence(data) {
  const result=new Map();
  for(const group of coverageInventory(data).groups)for(const device of group.devices)for(const item of device.sources)if(item.reasons.length)result.set(item.source.node_id,item);
  return result;
}

function monitoringState(source,included) {
  if(source.excluded_by?.length)return "Not monitored";
  if(source.kind==="entity")return source.watched?"Monitored separately":included.has(source.entity_id)?"Included with device":"Not monitored";
  return source.watched?"Monitored":"Not monitored";
}

export function sourceMonitoringChoices(card,node) {
  if(!card.configuration)return `<p class="sub">${esc(card.configError||"Loading monitoring choices…")}</p><button type="button" class="button" data-action="load-configuration">Reload choices</button>`;
  const source=node.source;
  const choice=(label,scope,options)=>{
    if(!scope)return "";
    const index=card.configScopes.push(scope)-1;
    const current=scopeChoice(card.configDraft,scope);
    if(current==="multiple")return '<p class="note">Several saved policies apply here.</p><button type="button" class="link" data-settings-section="policies">Review monitoring policies in Settings</button>';
    return `<fieldset class="source-choices"${card.configBusy?' disabled':''}><legend>${esc(label)}</legend>${options.map(([value,title,help])=>`<label class="source-radio"><input type="radio" name="source-choice-${index}" data-scope-index="${index}" value="${value}"${current===value?' checked':''}><span><strong>${esc(title)}</strong>${help?`<small>${esc(help)}</small>`:''}</span></label>`).join("")}</fieldset>`;
  };
  let controls="";
  let allScope=null;
  if(node.family) {
    const scope=(kind)=>node.domain?{kind:kind==="device"?"integration_devices":"entry",id:node.domain,match:{integration_domain:[node.domain],kind:[kind]}}:monitoringScope(kind==="device"?"integration_devices":"entry",node.entries[0]?.entry_id);
    allScope=node.domain?{kind:"integration_all",id:node.domain,match:{integration_domain:[node.domain],kind:["integration","device","entity"]}}:{kind:"integration_all",id:node.entries[0]?.entry_id,match:{integration:[node.entries[0]?.entry_id],kind:["integration","device","entity"]}};
    if(node.entries.length)controls+=choice("Monitor this integration",allScope,[["inherit","Use saved monitoring choices","Monitor the connection, devices, and entities selected below."],["exclude","Stop monitoring this integration","Turn off connection, device, and separate entity checks for current and future sources. Saved choices remain available if monitoring resumes."]]);
    if(node.entries.length&&scopeChoice(card.configDraft,allScope)!=="exclude") {
      controls+=choice("Integration connection",scope("integration"),[["inherit","Use saved connection policy",`${node.entries.filter(entry=>entry.watched).length} of ${node.entries.length} connections currently monitored.`],["attach","Monitor the integration connection","Report if Home Assistant cannot load this integration."],["exclude","Do not monitor the connection",""]]);
      controls+=choice("Device availability",scope("device"),[["inherit","Use saved device policy","Keep other matching policies in effect."],["attach","Monitor all devices","Include current and future devices from this integration."],["exclude","Only devices I choose","New devices stay unmonitored until you choose them."]]);
    }
  } else if(source?.kind==="integration")controls+=choice("Integration connection",monitoringScope("entry",source.entry_id),[["inherit","Use integration default","Follow the saved policy for this integration."],["attach","Monitor this connection","Report if Home Assistant cannot load it."],["exclude","Do not monitor this connection",""]]);
  else if(source?.kind==="device")controls+=choice("Device availability",monitoringScope("device_availability",source.attributes?.device?.[0]??source.node_id.slice(7)),[["inherit","Use integration default",`Currently ${source.watched?"monitored":"not monitored"}.`],["attach","Always monitor this device","Report unavailable or unknown entities."],["exclude","Do not monitor this device","Keep it in Sources without availability issues."]]);
  else if(source?.kind==="entity")controls+=choice("Entity availability",monitoringScope("entity",source.node_id,source),[["inherit","Use device and integration choices","Include in device monitoring when selected by its device."],["attach","Monitor this entity separately","Give this entity its own availability check."],["exclude","Exclude this entity","Exclude it from device monitoring and separate checks."]]);
  if(source?.kind==="device"){
    controls+=`<p class="small">${source.availability_entities?.length||0} entities included. Open an entity in the tree to change its inclusion.</p>`;
    const family=integrationFamilies(card.current.data).find(item=>item.children.some(child=>child.source?.node_id===source.node_id));
    if(family)controls+=`<button type="button" class="link" data-sources-select="${esc(family.key)}">View ${esc(family.name)} default</button>`;
  }
  if(source?.kind==="situation")controls='<p class="sub">This situation uses its configured condition. Reporting does not change what detects it.</p>';
  if(!controls)controls='<p class="sub">Select an integration, device, or entity to change monitoring.</p>';
  const exceptions=node.family&&scopeChoice(card.configDraft,allScope)!=="exclude"?node.children.filter(child=>child.type==="device"&&child.source&&scopeChoice(card.configDraft,monitoringScope("device_availability",child.device.id))!=="inherit"):[];
  if(exceptions.length)controls+=`<section class="source-section"><h3>Individual choices</h3>${exceptions.map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>${esc(scopeChoice(card.configDraft,monitoringScope("device_availability",child.device.id))==="attach"?"Always monitor":"Do not monitor")}</small></button>`).join("")}</section>`;
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
  const devices=node.family?node.children.filter(child=>child.type==="device"):[];
  const deviceSummary=node.family?`<section class="source-section"><h3>Devices</h3><p>${devices.filter(child=>child.source?.watched).length} of ${devices.length} devices monitored.</p>${devices.filter(child=>episodes.some(episode=>episode.anchor===child.source?.node_id||child.children.some(member=>member.source?.node_id===episode.anchor))).map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>Open issue</small></button>`).join("")}<button type="button" class="link" data-sources-view="settings">Change what this integration monitors</button></section>`:"";
  if(node.family&&node.entries.length>1) {
    const related=new Set([...sourcePaths([node]).values()].map(item=>item.node.source?.node_id));
    const count=episodes.filter(item=>related.has(item.anchor)).length;
    return `<section class="source-section"><h3>${node.entries.length} connections</h3>${node.entries.map(entry=>`<button type="button" class="source-child" data-sources-select="source:${esc(entry.node_id)}"><span>${esc(sourceName(entry))}</span><small>${esc(data.inventory.integration_states?.[entry.node_id]==="loaded"?"Loaded in Home Assistant":"View connection")}</small></button>`).join("")}</section><p>${count?`${count} open ${count===1?"issue":"issues"} in this integration.`:"No open issues in monitored sources."}</p>${deviceSummary}`;
  }
  if(!source)return `<p class="sub">${node.children.length} items in this group.</p>${node.children.map(child=>`<button type="button" class="source-child" data-sources-select="${esc(child.key)}"><span>${esc(child.name)}</span><small>View</small></button>`).join("")}`;
  if(!evidence||evidence.loading)return '<p class="sub" role="status">Reading current Home Assistant values…</p>';
  if(evidence.error)return `<p role="alert">${esc(evidence.error)}</p><button type="button" class="button" data-action="refresh-source">Retry reading</button>`;
  const linked=episodes.filter(item=>item.anchor===source.node_id);
  const status=evidence?.entity_status||data.inventory.entity_status?.[source.node_id];
  const current=evidence?.integration_evidence||data.inventory.integration_evidence?.[source.node_id];
  const problem=source.kind==="integration"?integrationProblem(source,linked.flatMap(item=>item.reasons||[]),key=>card._hass?.localize?.(key),current,Boolean(linked.length)):source.kind==="device"?deviceProblem(source,status,Boolean(linked.length)):entityProblem(source,status,null,data.areas,key=>card._hass?.localize?.(key),Boolean(linked.length));
  const members=evidence?.members||[];
  const unavailable=members.filter(item=>item.state==="unavailable"),unknown=members.filter(item=>["unknown","missing"].includes(item.state)||item.restored);
  const badCount=evidence.unavailable_count??unavailable.length, unknownCount=evidence.unknown_count??unknown.length;
  const headline=source.disabled?"Disabled in Home Assistant":source.kind==="device"&&members.length?(badCount?`${badCount} ${badCount===1?"entity is":"entities are"} unavailable`:unknownCount?`${unknownCount} ${unknownCount===1?"entity is":"entities are"} unknown`:linked.length?"Confirming recovery":"Entities available"):
    source.kind==="entity"&&members.length?(members[0].restored?"Waiting for a current state":members[0].state==="unavailable"?"Entity unavailable":["unknown","missing"].includes(members[0].state)?"Waiting for an entity state":linked.length?"Confirming recovery":"Entity available"):
    source.kind==="integration"&&current?.current?.reason==="loaded"&&!linked.length?"Loaded in Home Assistant":problem?.headline||"No current state";
  const usefulProblem=linked.length||badCount||unknownCount||(source.kind==="integration"&&current?.current?.reason&&current.current.reason!=="loaded");
  const summary=source.disabled?"Home Assistant is not using this source. Review its device or integration if this was not intentional.":source.kind==="device"&&members.length?usefulProblem?"Home Assistant cannot currently report the state of every selected entity.":"Home Assistant is reporting current entity states.":source.kind==="entity"&&members.length&&!usefulProblem?`Home Assistant reports ${members[0].state}.`:problem?.summary||"Current states have not been reported.";
  const next=source.kind==="device"?"Check the listed entities and this device in Home Assistant. Change monitoring if an entity is normally absent.":problem?.nextStep;
  let html=`<section class="source-condition${usefulProblem?' needs-attention':''}"><h3>${esc(headline)}</h3><p>${esc(summary)}</p>${usefulProblem&&next?`<p><strong>Next step:</strong> ${esc(next)}</p>`:''}</section>`;
  if(!source.watched)html+=`<p class="small">${source.kind==="entity"?"This entity has no separate check. Its device may still include it.":"Availability monitoring is off for this source."}</p>`;
  if(evidence?.error)html+=`<p role="alert">${esc(evidence.error)}</p><button type="button" class="link" data-action="refresh-source">Retry reading</button>`;
  if(members.length)html+=`<section class="source-section"><h3>Home Assistant entities</h3><table class="source-readings" aria-label="Home Assistant entities"><tbody>${members.map(item=>`<tr><td><button type="button" class="link" data-source-link="${esc(item.node_id)}">${esc(item.name)}</button></td><td>${esc(item.restored?"Restored state":item.state)}</td></tr>`).join("")}</tbody></table>${evidence.total>members.length?`<p class="small">Showing ${members.length} of ${evidence.total} entities. Expand this device or search to reach every entity.</p>`:''}</section>`;
  if(evidence?.updated_at)html+=`<p class="small source-updated">Updated ${esc(displayDate(evidence.updated_at))}</p>`;
  if(linked.length)html+=`<section class="source-section">${linked.map(item=>`<button type="button" class="button" data-episode="${esc(item.episode_id)}">Problem actions</button>`).join("")}</section>`;
  const deviceId=source.attributes?.device?.[0];
  const href=source.kind==="integration"?problem?.integrationUrl:deviceId?`/config/devices/device/${encodeURIComponent(deviceId)}`:source.entity_id?`/developer-tools/state?entity_id=${encodeURIComponent(source.entity_id)}`:null;
  if(href)html+=`<a class="link" href="${esc(href)}">Open in Home Assistant</a>`;
  return html+deviceSummary;
}

function sourceHistory(card,node) {
  const related=new Set([...sourcePaths([node]).values()].map(item=>item.node.source?.node_id).filter(Boolean));
  const data=card.current.data;
  const events=[...sortedEpisodes(data).filter(item=>related.has(item.anchor)).map(item=>({id:item.episode_id,name:"Open problem",date:item.opened_at,action:"episode"})),...(data.inventory.resolved_history?.episodes||[]).filter(item=>related.has(item.episode.anchor)).map(item=>({id:item.episode.episode_id,name:item.resolution==="removed"?"Monitoring changed":item.resolution==="recovered"?"Recovered":item.resolution.replaceAll("_"," "),date:item.resolved_at||item.ended_at,action:"history"}))];
  return events.length?`<ol class="source-timeline">${events.map(item=>`<li><button type="button" class="link" data-${item.action}="${esc(item.id)}">${esc(item.name)}</button><time>${esc(displayDate(item.date))}</time></li>`).join("")}</ol>`:'<p class="sub">No problems in retained history for this source.</p>';
}

/** Render the accepted tree-and-detail workspace without nested page navigation. */
export function sourcesBrowser(card) {
  const data=card.current.data;
  const topomationAvailable=Boolean(topomationTree(data,card.topomation));
  const full=sourcesTree(data,card.sourcesGrouping,key=>card._hass?.localize?.(key),card.topomation);
  const paths=sourcePaths(full),episodes=sortedEpisodes(data);
  const issues=new Map(episodes.map(item=>[item.anchor,item]));
  const included=new Set(inventoryRows(data).filter(row=>row.kind==="device"&&row.watched).flatMap(row=>row.availability_entities||[]));
  const visible=filterSources(full,card.sourcesQuery,card.sourcesNeedsReview,issues);
  const selected=paths.get(card.sourcesSelection);
  const branch=node=>{
    const expanded=card.sourcesExpanded.has(node.key);
    const ids=new Set([...sourcePaths([node]).values()].map(item=>item.node.source?.node_id));
    const count=episodes.filter(item=>ids.has(item.anchor)).length;
    const limit=card.sourcesLimits?.get(node.key)||80;
    const shown=expanded?node.children.slice(0,limit):[];
    const linked=expanded&&node.children.find(child=>child.key===card.sourcesSelection||selected?.parents.some(parent=>parent.key===child.key));
    if(linked&&!shown.includes(linked))shown.push(linked);
    const summary=count?`${count} ${count===1?"issue":"issues"}`:node.family?`${node.children.filter(child=>child.type==="device").length} ${node.children.filter(child=>child.type==="device").length===1?"device":"devices"}`:node.source?monitoringState(node.source,included):`${node.children.length} items`;
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length?`<button type="button" class="config-toggle" data-sources-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded?'Collapse':'Expand'} ${esc(node.name)}"><span class="disclosure" aria-hidden="true"></span></button>`:'<span class="config-leaf" aria-hidden="true"></span>'}<button type="button" class="config-pick" data-sources-select="${esc(node.key)}"${card.sourcesSelection===node.key?' aria-current="true"':''}><span>${esc(node.name)}</span><small${count?' class="source-issue-count"':''}>${esc(summary)}</small></button></div>${expanded?`<ul class="config-nav-children">${shown.map(branch).join("")}${node.children.length>limit?`<li><button type="button" class="link source-more" data-source-more="${esc(node.key)}">Show more sources</button></li>`:''}</ul>`:''}</li>`;
  };
  const node=selected?.node,view=card.sourcesView||"source";
  const tabs=`<nav class="sources-views" aria-label="Selected source views">${[["source","Source"],["settings","Settings"],["history","History"]].map(([id,label])=>`<button type="button" data-sources-view="${id}" aria-current="${view===id?'page':'false'}">${label}${id==="settings"&&card.configuration&&JSON.stringify(card.configDraft)!==JSON.stringify(card.configuration.rules)?" •":""}</button>`).join("")}</nav>`;
  const context=selected?.parents.map(parent=>parent.name).join(" / ")|| (node?.family?"Integration":node?.type==="location"?"Location":"");
  const detail=node?`<header class="source-heading"><button type="button" class="link sources-back" data-action="back-sources">← Back to sources</button><p class="config-path">${esc(context)}</p><h2 id="sources-detail-title" tabindex="-1">${esc(node.name)}</h2>${node.source?.entity_id?`<p class="source-entity-id">${esc(node.source.entity_id)}</p>`:""}${tabs}</header><div class="source-body">${view==="settings"?sourceMonitoringChoices(card,node):view==="history"?sourceHistory(card,node):sourceReport(card,node,episodes)}</div>`:'<div class="sources-empty"><h2>Choose an integration or device</h2><p class="sub">See its status, change monitoring, or review its history.</p></div>';
  return `<section class="panel sources-workspace" data-mobile-detail="${Boolean(card.sourcesMobileDetail&&node)}"><div class="sources-tools"><label>Group by<select data-sources-group><option value="integration"${card.sourcesGrouping==="integration"?' selected':''}>Integration</option><option value="location"${card.sourcesGrouping==="location"?' selected':''}>Home Assistant location</option>${topomationAvailable||card.sourcesGrouping==="topomation"?`<option value="topomation"${card.sourcesGrouping==="topomation"?' selected':''}${topomationAvailable?'':' disabled'}>Topomation${topomationAvailable?'':' (loading)'}</option>`:''}</select></label><label class="coverage-search">Find a source<input type="search" data-sources-search value="${esc(card.sourcesQuery)}" placeholder="Search devices and integrations"></label>${card.sourcesNeedsReview?'<button type="button" class="link" data-action="all-sources">Show all sources</button>':''}</div><div class="config-layout"><nav class="config-rail" aria-label="Sources tree"><ul class="config-tree">${visible.map(branch).join("")||'<li class="sub">No matching sources.</li>'}</ul></nav><section class="config-detail" aria-label="Selected source">${detail}</section></div></section>`;
}
