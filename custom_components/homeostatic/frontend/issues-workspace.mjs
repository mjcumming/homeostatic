import {escapeHtml as esc, inventoryRows, visibleEpisodes} from "./model.mjs?v=90";

import {deviceEntityName} from "./device-availability.mjs?v=90";
import {waitingOnly} from "./check-presentation.mjs?v=90";

const count = (value, singular, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
const sourceId = source => source?.monitoring_source || source?.node_id;
const sourceType = source => ({integration:"Integration connection",device:"Device",entity:"Entity",battery:"Battery",vacuum:"Vacuum",ups:"UPS",broken_automation:"Automation",repair:"Repair",situation:"Situation"}[source?.kind] || "Source");
const inventoryMap = data => new Map(inventoryRows(data).map(source=>[source.node_id,source]));

function deviceContext(source, nodes, devices) {
  const canonical = nodes.get(source?.monitoring_source) || source;
  if (!canonical || ["integration","repair","broken_automation","situation"].includes(canonical.kind)) return null;
  const ids = canonical.attributes?.device || source?.attributes?.device || [];
  if (ids.length !== 1) return null;
  const deviceId = ids[0], device = nodes.get(`device:${deviceId}`), registry = devices.get(deviceId);
  return {key:`device:${deviceId}`,deviceId,ownerId:registry?.config_entry_id || device?.owner_id || device?.attributes?.integration?.[0],name:device?.name || registry?.name || (canonical.kind === "device" ? canonical.name : null) || "Device details unavailable"};
}

function episodeDevice(data, episode, nodes, devices) {
  const anchor = nodes.get(episode.anchor);
  let subject = deviceContext(anchor, nodes, devices);
  const current = data.inventory.integration_evidence?.[episode.anchor]?.current || episode.reasons?.find(finding=>finding.node_id === episode.anchor);
  if (anchor?.kind === "integration" && current?.reason === "loaded") {
    const members = episodeSourceIds(episode).filter(id=>id !== episode.anchor).map(id=>deviceContext(nodes.get(id),nodes,devices));
    if (members.length && members.every(member=>member && member.deviceId === members[0]?.deviceId)) subject = members[0];
  }
  const members = episodeSourceIds(episode).filter(id=>anchor?.kind !== "integration" || id !== episode.anchor);
  return subject && members.every(id=>deviceContext(nodes.get(id),nodes,devices)?.deviceId === subject.deviceId) ? subject : null;
}

/** Present registry-owned findings together while keeping each issue addressable once. */
export function issueDeviceGroups(data, episodes, nodes = inventoryMap(data), devices = new Map((data.devices || []).map(device=>[device.id,device]))) {
  const groups = new Map();
  for (const episode of episodes) {
    const anchor = nodes.get(episode.anchor);
    const current = data.inventory.integration_evidence?.[episode.anchor]?.current;
    if (anchor?.kind === "integration" && current?.reason === "loaded") {
      const members = episodeSourceIds(episode).filter(id=>id !== episode.anchor);
      const owners = members.map(id=>deviceContext(nodes.get(id),nodes,devices));
      if (members.length && owners.every(Boolean)) {
        for (const owner of new Map(owners.map(item=>[item.deviceId,item])).values()) {
          const ids = new Set(members.filter((id,index)=>owners[index].deviceId === owner.deviceId));
          const scoped = {...episode,recorded:[episode.anchor,...ids],reasons:(episode.reasons || []).filter(item=>item.node_id === episode.anchor || ids.has(item.node_id)),sharedDeviceCount:new Set(owners.map(item=>item.deviceId)).size};
          if (!groups.has(owner.key)) groups.set(owner.key,{...owner,episodes:[]});
          groups.get(owner.key).episodes.push(scoped);
        }
        continue;
      }
    }
    const owner = episodeDevice(data,episode,nodes,devices) || {key:`issue:${episode.episode_id}`,deviceId:null,name:null};
    if (!groups.has(owner.key)) groups.set(owner.key,{...owner,episodes:[]});
    groups.get(owner.key).episodes.push(episode);
  }
  return [...groups.values()];
}

function waitingChecks(data, subject, nodes, devices) {
  const waiting = data.inventory.episodes.filter(episode=>waitingOnly(data,episode) && episodeDevice(data,episode,nodes,devices)?.deviceId === subject.deviceId);
  if (!waiting.length) return "";
  return `<ul class="problem-evidence issue-waiting" data-waiting-device="${esc(subject.deviceId)}">${waiting.map(episode=>{
    const source = nodes.get(episode.anchor),status = data.inventory.entity_status[episode.anchor];
    const policy = source.monitoring_policy_name || source.name;
    return `<li><button type="button" class="link" data-source-link="${esc(sourceId(source))}">${esc(policy)}</button><p>${esc(status.current.message || "Waiting for current information.")}</p></li>`;
  }).join("")}</ul>`;
}

/** Keep recorded issue membership separate from dependency impact. */
export function episodeSourceIds(episode) {
  return [...new Set([episode.anchor, ...(episode.recorded || []), ...(episode.reasons || []).map(finding => finding.node_id)].filter(Boolean))];
}

function integrationContext(source, nodes, localize) {
  const owner = source?.kind === "integration" ? source : nodes.get(`entry:${source?.owner_id || source?.attributes?.integration?.[0]}`);
  const domain = owner?.attributes?.domain?.[0] || source?.attributes?.integration_domain?.[0];
  if (domain) return {key:`integration:${domain}`,name:localize(`component.${domain}.title`) || domain.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()),kind:"integration",domain};
  if (owner) return {key:`connection:${sourceId(owner)}`,name:owner.name || "Unnamed integration connection",kind:"integration"};
  return null;
}

function context(source, nodes, localize) {
  if (source?.kind === "broken_automation") return {key:"automations",name:"Automations",kind:"independent"};
  if (source?.kind === "repair") return {key:"repairs",name:"Home Assistant Repairs",kind:"independent"};
  if (source?.kind === "situation") return {key:"situations",name:"Reported situations",kind:"independent"};
  const integration = integrationContext(source, nodes, localize);
  if (integration) return integration;
  return {key:"other",name:"Other sources",kind:"independent"};
}

/** Group existing issues for investigation without changing their identities. */
export function issueGroups(data, localize = () => null) {
  const nodes = inventoryMap(data), groups = new Map(), seen = new Set(), devices = new Map((data.devices || []).map(device=>[device.id,device]));
  for (const episode of visibleEpisodes(data)) {
    if (seen.has(episode.episode_id)) continue;
    seen.add(episode.episode_id);
    const source = nodes.get(episode.anchor), device = episodeDevice(data,episode,nodes,devices);
    const subject = device?.ownerId ? nodes.get(`entry:${device.ownerId}`) || nodes.get(`device:${device.deviceId}`) : null;
    const owner = context(subject || nodes.get(source?.monitoring_source) || source, nodes, localize);
    if (!groups.has(owner.key)) groups.set(owner.key,{...owner,episodes:[],devices:new Set(),entities:new Set()});
    const group = groups.get(owner.key);
    group.episodes.push(episode);
    for (const id of episodeSourceIds(episode)) {
      const member = nodes.get(id);
      if (member?.entity_id) group.entities.add(member.entity_id);
      for (const device of member?.attributes?.device || []) group.devices.add(device);
    }
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name));
}

export function recordedIssueSources(data, episode, evidence = null) {
  const nodes = inventoryMap(data), members = new Map();
  const shown = new Set((evidence?.groups || []).flatMap(group => group.members.map(member => member.id)));
  shown.add(sourceId(nodes.get(episode.anchor)) || episode.anchor);
  for (const id of episodeSourceIds(episode)) {
    const source = nodes.get(id), canonical = sourceId(source) || id;
    if (shown.has(canonical)) continue;
    if (!members.has(canonical)) members.set(canonical,{source:nodes.get(canonical)||source,id:canonical,findings:[]});
    members.get(canonical).findings.push(...(episode.reasons || []).filter(finding => finding.node_id === id && finding.message).map(finding => finding.message));
  }
  if (!members.size) return "";
  return `<section class="issue-recorded"><h3>Other recorded sources</h3><ul class="problem-evidence">${[...members.values()].map(({source,id,findings}) => `<li>${source ? `<span class="small">${sourceType(source)}</span> <button type="button" class="link" data-source-link="${esc(id)}">${esc(source.name || source.entity_id || id)}</button>` : `<span>${esc(id)}</span><span class="small"> · Source details unavailable</span>`}${[...new Set(findings)].map(message => `<p>${esc(message)}</p>`).join("")}</li>`).join("")}</ul></section>`;
}

function ordered(episodes, sort, nodes) {
  const importance = {critical:3,high:2,normal:1,low:0};
  return [...episodes].sort((a,b) => {
    if (sort === "name") return (nodes.get(a.anchor)?.name || a.anchor).localeCompare(nodes.get(b.anchor)?.name || b.anchor) || a.episode_id.localeCompare(b.episode_id);
    if (sort === "importance") return (importance[b.importance] || 0) - (importance[a.importance] || 0) || a.opened_at.localeCompare(b.opened_at);
    return (sort === "newest" ? -1 : 1) * a.opened_at.localeCompare(b.opened_at) || a.episode_id.localeCompare(b.episode_id);
  });
}

/** Render one entry per issue, with evidence available in its details. */
export function issuesWorkspace(card) {
  const data = card.current.data, nodes = inventoryMap(data), groups = issueGroups(data,key => card._hass?.localize?.(key));
  const devices = new Map((data.devices || []).map(device=>[device.id,device]));
  const query = (card.issueQuery || "").trim().toLocaleLowerCase(), expanded = card.issueGroupsExpanded || new Set(), sort = card.issueSort || "newest";
  const total = groups.reduce((sum, group) => sum + group.episodes.length,0);
  const filtered = groups.map(group => ({...group,episodes:group.episodes.filter(episode => !query || [group.name,...episodeSourceIds(episode).flatMap(id => {const source=nodes.get(id);return [source?.name,source?.entity_id,deviceContext(source,nodes,devices)?.name];}),...(episode.reasons || []).map(finding => finding.message)].filter(Boolean).join(" ").toLocaleLowerCase().includes(query))})).filter(group => group.episodes.length);
  const visible = filtered.reduce((sum, group) => sum + group.episodes.length,0);
  const ranked = filtered.map(group => ({...group,episodes:ordered(group.episodes,sort,nodes)}));
  const leaders = ordered(ranked.map(group=>group.episodes[0]),sort,nodes);
  const rank = new Map(leaders.map((episode,index)=>[episode.episode_id,index]));
  ranked.sort((a,b)=>sort === "name" ? a.name.localeCompare(b.name) : rank.get(a.episodes[0].episode_id)-rank.get(b.episodes[0].episode_id));
  const rows = ranked.map(group => {
    const open = query || expanded.has(group.key), limit = card.issueGroupLimits?.get(group.key) || 40;
    const episodes = group.episodes, subjects = issueDeviceGroups(data,episodes,nodes,devices);
    if (sort === "name") subjects.sort((a,b)=>(a.name || nodes.get(a.episodes[0].anchor)?.name || "").localeCompare(b.name || nodes.get(b.episodes[0].anchor)?.name || ""));
    const entryCount = subjects.reduce((sum,subject)=>sum + subject.episodes.length,0);
    let remaining = open ? limit : 0, shownCount = 0;
    const findings = subjects.map(subject=>{
      const shown = subject.episodes.slice(0,remaining);
      remaining -= shown.length;shownCount += shown.length;
      if (!shown.length) return "";
      const rows = shown.map(episode=>`<div data-ui-key="issue:${esc(episode.episode_id)}">${card.issueRow(data,episode,nodes,subject.deviceId ? subject : null)}</div>`).join("");
      if (!subject.deviceId) return rows;
      return `<section class="issue-device" data-ui-key="${esc(subject.key)}" data-issue-device="${esc(subject.deviceId)}"><div class="issue-device-heading"><h3 class="issue-device-title">${esc(subject.name)}</h3><span class="small">${esc(count(subject.episodes.length,"issue"))}</span></div><div class="issue-device-findings">${rows}${waitingChecks(data,subject,nodes,devices)}</div>${shown.length < subject.episodes.length ? `<p class="small issue-device-partial">Showing ${shown.length} of ${subject.episodes.length} issues for this device</p>` : ""}</section>`;
    }).join("");
    const affectedDevices=new Set(),standaloneEntities=new Set();
    for(const episode of episodes)for(const id of episodeSourceIds(episode)){const source=nodes.get(id),canonical=nodes.get(source?.monitoring_source)||source,ids=canonical?.attributes?.device||source?.attributes?.device||[];if(source?.entity_id&&!ids.length)standaloneEntities.add(source.entity_id);for(const device of ids)affectedDevices.add(device);}
    const scope = [affectedDevices.size ? count(affectedDevices.size,"affected device") : "",standaloneEntities.size ? count(standaloneEntities.size,"entity without a device","entities without a device") : ""].filter(Boolean).join(" · ");
    return `<section class="issue-group panel" data-ui-key="group:${esc(group.key)}"><h2><button type="button" class="issue-group-toggle" data-issue-group="${esc(group.key)}" aria-expanded="${Boolean(open)}"><span>${esc(group.name)}</span><span class="issue-group-meta">${scope ? `<span class="small">${esc(scope)}</span>` : ""}<span class="issue-count">${esc(count(episodes.length,"issue"))}</span></span></button></h2>${open ? `<div class="issue-group-body">${findings}${entryCount > shownCount ? `<div class="body"><button type="button" class="button" data-issue-more="${esc(group.key)}">Show more issues</button><span class="small">Showing ${shownCount} of ${entryCount} entries</span></div>` : ""}</div>` : ""}</section>`;
  }).join("");
  const visibleIds=new Set(groups.flatMap(group=>group.episodes.map(episode=>episode.episode_id)));
  const hidden = data.inventory.episodes.filter(episode=>!visibleIds.has(episode.episode_id));
  const monitored = data.inventory.nodes.filter(source => source.watched).length;
  const empty = query ? `<h2>No matching issues</h2><p>Try another source name, entity ID or reported condition.</p><button type="button" class="link" data-action="clear-issue-search">Clear search</button>` : hidden.length ? `<h2>No current issues</h2><p>Monitoring shows current status and any pending recovery confirmation.</p><button type="button" class="link" data-page="sources">View monitoring</button>` : `<h2>${monitored ? "No open issues" : data.catalog_loaded === false ? "No open issues reported" : "Nothing is monitored"}</h2><p>${monitored ? "No open problems are reported by the current monitoring." : data.catalog_loaded === false ? "Open Policies to inspect the configured monitoring scope." : "Choose a monitoring policy to start checking sources."}</p><button type="button" class="link" data-page="policies">View policies</button>`;
  return `<div class="intro"><div><h1>Open issues</h1><p class="page-description">Problems that need attention.</p></div></div><div class="issues-toolbar"><label><span>Find an issue</span><input type="search" data-issue-search value="${esc(card.issueQuery || "")}" placeholder="Find an issue"></label><label><span>Sort issues</span><select data-issue-sort>${[["newest","Newest first"],["oldest","Longest open"],["name","Source name"],["importance","Importance"]].map(([value,label]) => `<option value="${value}"${sort === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div><p class="small">${query ? `${visible} of ${total} issues match` : `${count(total,"open issue")}`}</p>${rows || `<section class="panel body">${empty}</section>`}`;
}


const describeEvidence = member => [...new Set(member.findings.map(item => item.description))].map(esc).join("; ");
const evidenceChecks = member => {
  const mixed = new Set(member.findings.map(item => item.description)).size > 1;
  return [...new Set(member.findings.map(({finding,policy,description}) => `${policy || finding.check_id?.replaceAll("_", " ") || "Check"}${mixed ? `: ${description}` : ""}`))].map(esc).join(" · ");
};

/** Show each affected name and its condition before supporting detail. */
export function relatedEvidenceDetails(evidence, {singleDevice = false} = {}) {
  if (!evidence?.groups.length) return "";
  const groups = evidence.groups.map(group => {
    const children = group.members.filter(member=>member.kind !== "device");
    const childrenList = children.map(member => {
      const name = group.deviceId ? deviceEntityName(member.name,group.name) : member.name;
      return `<li data-evidence-source="${esc(member.id)}"><div class="affected-reading"><strong>${member.source ? `<button type="button" class="link" data-source-link="${esc(member.id)}">${esc(name)}</button>` : esc(name)}</strong><span>${describeEvidence(member)}</span></div></li>`;
    }).join("");
    if (!group.deviceId && children.length) return `<section class="affected-source" data-evidence-group="${esc(group.id)}"><ul class="affected-readings">${childrenList}</ul></section>`;
    const deviceLink = group.deviceId ? `/config/devices/device/${encodeURIComponent(group.deviceId)}` : null;
    const title = deviceLink ? singleDevice ? "" : `<h4><a href="${deviceLink}" aria-label="${esc(`Open ${group.name} in Home Assistant`)}">${esc(group.name)}</a></h4>` : group.members.some(member=>member.kind === "device") ? `<h4>${esc(group.name)}</h4>` : "";
    const childConditions = new Set(children.flatMap(member => member.findings.map(item => item.description)));
    const deviceConditions = [...new Set(group.members.filter(member => member.kind === "device").flatMap(member => member.findings.map(item => item.description)))].filter(description => !childConditions.has(description));
    return `<section class="affected-source" data-evidence-group="${esc(group.id)}">${title}${deviceConditions.length ? `<p class="small">${deviceConditions.map(esc).join("; ")}</p>` : ""}${childrenList ? `<ul class="affected-readings">${childrenList}</ul>` : ""}</section>`;
  }).join("");
  return `<section class="detail related-evidence">${groups}</section>`;
}

/** List independent policy contributions once in the flat supporting section. */
export function relatedEvidenceMonitoring(evidence) {
  if (!evidence?.groups.length) return "";
  const {devices,entities,checks} = evidence.counts;
  const totals = [devices ? count(devices,"device") : "",entities ? count(entities,"entity","entities") : "",count(checks,"check")].filter(Boolean).join(" · ");
  const members=evidence.groups.flatMap(group=>group.members),names=new Map();
  for(const member of members)names.set(member.name,(names.get(member.name)||0)+1);
  return `<section class="issue-checks"><h3>Checks</h3><p class="small">${esc(totals)}</p><ul class="problem-evidence">${members.map(member=>`<li data-check-source="${esc(member.id)}"><span>${esc(member.name)}${names.get(member.name)>1 ? ` <span class="small">(${esc(sourceType(member.source).toLowerCase())})</span>` : ""}</span><p class="small">${evidenceChecks(member)}</p></li>`).join("")}</ul></section>`;
}
