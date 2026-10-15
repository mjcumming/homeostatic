import {escapeHtml as esc, inventoryRows, visibleEpisodes} from "./model.mjs?v=74";

import {deviceEntityName} from "./device-availability.mjs?v=74";

const count = (value, singular, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
const sourceId = source => source?.monitoring_source || source?.node_id;
const sourceType = source => ({integration:"Integration connection",device:"Device",entity:"Entity",battery:"Battery",vacuum:"Vacuum",ups:"UPS",broken_automation:"Automation",repair:"Repair",situation:"Situation"}[source?.kind] || "Source");
const inventoryMap = data => new Map(inventoryRows(data).map(source=>[source.node_id,source]));

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
  const nodes = inventoryMap(data), groups = new Map(), seen = new Set();
  for (const episode of visibleEpisodes(data)) {
    if (seen.has(episode.episode_id)) continue;
    seen.add(episode.episode_id);
    const source = nodes.get(episode.anchor), owner = context(source, nodes, localize);
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

function affectedSources(data, episode) {
  const nodes = inventoryMap(data), members = new Map();
  for (const id of episodeSourceIds(episode)) {
    const source = nodes.get(id), canonical = sourceId(source) || id;
    if (!members.has(canonical)) members.set(canonical,{source:nodes.get(canonical)||source,id:canonical,findings:[]});
    members.get(canonical).findings.push(...(episode.reasons || []).filter(finding => finding.node_id === id && finding.message).map(finding => finding.message));
  }
  if (members.size < 2) return "";
  return `<details class="issue-members" data-ui-key="members:${esc(episode.episode_id)}"><summary>Recorded findings (${members.size})</summary><ul class="problem-evidence">${[...members.values()].map(({source,id,findings}) => `<li>${source ? `<span class="small">${sourceType(source)}</span> <button type="button" class="link" data-source-link="${esc(id)}">${esc(source.name || source.entity_id || id)}</button>` : `<span>${esc(id)}</span><span class="small"> · Source details unavailable</span>`}${[...new Set(findings)].map(message => `<p>${esc(message)}</p>`).join("")}</li>`).join("")}</ul></details>`;
}

function ordered(episodes, sort, nodes) {
  const importance = {critical:3,high:2,normal:1,low:0};
  return [...episodes].sort((a,b) => {
    if (sort === "name") return (nodes.get(a.anchor)?.name || a.anchor).localeCompare(nodes.get(b.anchor)?.name || b.anchor) || a.episode_id.localeCompare(b.episode_id);
    if (sort === "importance") return (importance[b.importance] || 0) - (importance[a.importance] || 0) || a.opened_at.localeCompare(b.opened_at);
    return (sort === "newest" ? -1 : 1) * a.opened_at.localeCompare(b.opened_at) || a.episode_id.localeCompare(b.episode_id);
  });
}

/** Render a compact issue queue with complete, disclosed issue membership. */
export function issuesWorkspace(card) {
  const data = card.current.data, nodes = inventoryMap(data), groups = issueGroups(data,key => card._hass?.localize?.(key));
  const query = (card.issueQuery || "").trim().toLocaleLowerCase(), expanded = card.issueGroupsExpanded || new Set(), sort = card.issueSort || "newest";
  const total = groups.reduce((sum, group) => sum + group.episodes.length,0);
  const filtered = groups.map(group => ({...group,episodes:group.episodes.filter(episode => !query || [group.name,...episodeSourceIds(episode).flatMap(id => {const source=nodes.get(id);return [source?.name,source?.entity_id];}),...(episode.reasons || []).map(finding => finding.message)].filter(Boolean).join(" ").toLocaleLowerCase().includes(query))})).filter(group => group.episodes.length);
  const visible = filtered.reduce((sum, group) => sum + group.episodes.length,0);
  const ranked = filtered.map(group => ({...group,episodes:ordered(group.episodes,sort,nodes)}));
  const leaders = ordered(ranked.map(group=>group.episodes[0]),sort,nodes);
  const rank = new Map(leaders.map((episode,index)=>[episode.episode_id,index]));
  ranked.sort((a,b)=>sort === "name" ? a.name.localeCompare(b.name) : rank.get(a.episodes[0].episode_id)-rank.get(b.episodes[0].episode_id));
  const rows = ranked.map(group => {
    const open = query || expanded.has(group.key), limit = card.issueGroupLimits?.get(group.key) || 40;
    const episodes = group.episodes, shown = open ? episodes.slice(0,limit) : [];
    const devices=new Set(),entities=new Set();
    for(const episode of group.episodes)for(const id of episodeSourceIds(episode)){const source=nodes.get(id);if(source?.entity_id)entities.add(source.entity_id);for(const device of source?.attributes?.device||[])devices.add(device);}
    const scope = [count(group.episodes.length,"issue"),devices.size ? count(devices.size,"device") : "",entities.size ? count(entities.size,"entity","entities") : ""].filter(Boolean).join(" · ");
    return `<section class="issue-group panel" data-ui-key="group:${esc(group.key)}"><h2><button type="button" class="issue-group-toggle" data-issue-group="${esc(group.key)}" aria-expanded="${Boolean(open)}"><span>${esc(group.name)}</span><span class="small">${esc(scope)}</span></button></h2>${open ? `<div class="issue-group-body">${group.kind === "integration" ? '<p class="small">Issues reported within this integration. Each issue below keeps its own actions.</p>' : ""}${shown.map(episode => `<div data-ui-key="issue:${esc(episode.episode_id)}">${card.issueRow(data,episode)}${affectedSources(data,episode)}</div>`).join("")}${episodes.length > shown.length ? `<div class="body"><button type="button" class="button" data-issue-more="${esc(group.key)}">Show more issues</button><span class="small">Showing ${shown.length} of ${episodes.length}</span></div>` : ""}</div>` : ""}</section>`;
  }).join("");
  const visibleIds=new Set(groups.flatMap(group=>group.episodes.map(episode=>episode.episode_id)));
  const hidden = data.inventory.episodes.filter(episode=>!visibleIds.has(episode.episode_id));
  const monitored = data.inventory.nodes.filter(source => source.watched).length;
  const empty = query ? `<h2>No matching issues</h2><p>Try another source name, entity ID or reported condition.</p><button type="button" class="link" data-action="clear-issue-search">Clear search</button>` : hidden.length ? `<h2>No current issues</h2><p>Sources shows current monitoring evidence and any pending recovery confirmation.</p><button type="button" class="link" data-page="sources">View sources</button>` : `<h2>${monitored ? "No open issues" : data.catalog_loaded === false ? "No open issues reported" : "Nothing is monitored"}</h2><p>${monitored ? "No open problems are reported by the current monitoring." : data.catalog_loaded === false ? "Open Policies to inspect the configured monitoring scope." : "Choose a monitoring policy to start checking sources."}</p><button type="button" class="link" data-page="policies">View policies</button>`;
  return `<div class="intro"><h1>Issues</h1><div class="actions"><button type="button" class="link" data-page="history">History</button></div></div><div class="issues-toolbar"><label>Find an issue<input type="search" data-issue-search value="${esc(card.issueQuery || "")}" placeholder="Source, entity ID or condition"></label><label>Sort issues<select data-issue-sort>${[["newest","Newest first"],["oldest","Longest open"],["name","Source name"],["importance","Importance"]].map(([value,label]) => `<option value="${value}"${sort === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div><p class="small">${query ? `${visible} of ${total} issues match` : `${count(total,"open issue")} in ${count(groups.length,"investigation group")}`}</p>${rows || `<section class="panel body">${empty}</section>`}`;
}


/** Show each affected source once, with every contributing check reachable. */
export function relatedEvidenceDetails(evidence, expanded = new Set()) {
  if (!evidence?.groups.length) return "";
  const {devices,entities,sources,checks} = evidence.counts;
  const totals = [devices ? count(devices,"device") : "",entities ? count(entities,"entity","entities") : "",count(checks,"check")].filter(Boolean).join(" · ");
  const describe = member => [...new Set(member.findings.map(item => item.description))].map(esc).join("; ");
  const contributions = member => member.findings.length > 1 ? `<details data-disclosure="checks:${esc(member.id)}"${expanded.has(`checks:${member.id}`) ? " open" : ""}><summary>${count(new Set(member.findings.map(({finding})=>JSON.stringify([finding.node_id,finding.check_id || ""]))).size,"contributing check")}</summary><ul>${member.findings.map(({finding,policy,description})=>`<li>${esc(policy || finding.check_id || "Check")} · ${esc(description)}${finding.message ? `<p class="small">${esc(finding.message)}</p>` : ""}</li>`).join("")}</ul></details>` : "";
  const groups = evidence.groups.map(group => {
    const own = group.members.filter(member=>member.kind === "device");
    const children = group.members.filter(member=>member.kind !== "device");
    const childrenList = children.map(member => {
      const name = group.deviceId ? deviceEntityName(member.name,group.name) : member.name;
      const label = name === "Selected entity" ? ({climate:"Thermostat",sensor:"Reading",binary_sensor:"Sensor"}[member.source?.entity_id?.split(".")[0]] || "Entity") : name;
      return `<li data-evidence-source="${esc(member.id)}"><div class="affected-reading"><strong>${esc(label)}</strong><span>${describe(member)}</span></div>${contributions(member)}${member.source ? `<button type="button" class="link" data-source-link="${esc(member.id)}">Inspect ${member.kind === "entity" ? "entity" : "source"}</button>` : ""}</li>`;
    }).join("");
    const title = group.deviceId || own.length ? `<h4>${esc(group.name)}</h4>` : "";
    return `<section class="affected-source" data-evidence-group="${esc(group.id)}">${title}${own.map(member=>`<div data-evidence-source="${esc(member.id)}"><p>${describe(member)}</p>${contributions(member)}</div>`).join("")}${group.deviceId ? `<div class="actions"><a class="button primary" href="/config/devices/device/${encodeURIComponent(group.deviceId)}">Open device</a>${group.sourceId ? `<button type="button" class="link" data-source-link="${esc(group.sourceId)}">Inspect device checks</button>` : ""}</div>` : own.length && group.sourceId ? `<button type="button" class="button" data-source-link="${esc(group.sourceId)}">Inspect device checks</button>` : ""}${childrenList ? `<ul class="affected-readings">${childrenList}</ul>` : ""}</section>`;
  }).join("");
  return `<section class="detail related-evidence"><h3>Affected sources (${sources})</h3><p class="small">${esc(totals)}</p>${groups}</section>`;
}
