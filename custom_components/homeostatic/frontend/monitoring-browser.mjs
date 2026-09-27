import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=23";
import {monitoringScope, monitoringTree} from "./configuration.mjs?v=23";

export const MONITORING_PAGE_SIZE = 20;
const keyFor = (...parts) => JSON.stringify(parts);
const entityType = (source) => source.attributes?.domain?.[0] ?? source.entity_id?.split(".")[0] ?? "other";
const TYPE_NAMES = new Map(Object.entries({sensor:"Sensors",binary_sensor:"Binary sensors",camera:"Cameras",switch:"Switches",light:"Lights",button:"Buttons",number:"Numbers",select:"Selectors",media_player:"Media players",other:"Other entities"}));
const typeName = (type) => TYPE_NAMES.get(type) ?? type.replaceAll("_"," ").replace(/^./, (letter) => letter.toUpperCase());
const countLabel = (count,singular,plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const named = (left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key);

/** Build presentation paths without changing ownership or monitoring scopes. */
export function monitoringNavigation(data, query = "") {
  const entityNodes = (entities, path) => {
    const types = new Map();
    for (const source of entities) {
      const type = entityType(source);
      if (!types.has(type)) types.set(type,[]);
      types.get(type).push({key:keyFor(...path,type,source.node_id),name:source.name,type:"entity",source,children:[]});
    }
    return [...types].map(([type,children]) => ({key:keyFor(...path,type),name:typeName(type),type:"folder",children:children.sort(named)})).sort(named);
  };
  const tree = monitoringTree(data).map((group) => {
    const path = [group.id];
    const children = [];
    if (group.devices.length) children.push({key:keyFor(...path,"devices"),name:"Devices",type:"folder",children:group.devices.map((device) => ({
      key:keyFor(...path,"device",device.id),name:device.name,type:"device",device,group,
      children:entityNodes(device.entities,[...path,"device",device.id]),
    }))});
    if (group.loose.length) children.push({key:keyFor(...path,"loose"),name:"Entities without a device",type:"folder",children:entityNodes(group.loose,[...path,"loose"])});
    return {key:keyFor(...path),name:group.name,type:"integration",group,children};
  });
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return tree;
  const filter = (nodes, parentMatch = false) => nodes.flatMap((node) => {
    const matches = parentMatch || [node.name,node.source?.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
    const children = filter(node.children,matches);
    return matches || children.length ? [{...node,children}] : [];
  });
  return filter(tree);
}

/** Index full paths so selected settings never inherit a search's narrower scope. */
export function monitoringIndex(tree) {
  const index = new Map();
  const visit = (nodes, parents) => {
    for (const node of nodes) {
      index.set(node.key,{...node,parents});
      visit(node.children,[...parents,node]);
    }
  };
  visit(tree,[]);
  return index;
}

/** Reveal a selected item even when one of its ancestors is on a later page. */
export function revealMonitoringPath(tree, key, expanded, pages) {
  const node = monitoringIndex(tree).get(key);
  if (!node) return;
  let siblings = tree;
  let parentKey = "root";
  for (const part of [...node.parents,node]) {
    const position = siblings.findIndex((item) => item.key === part.key);
    pages.set(`nav:${parentKey}`,Math.floor(position / MONITORING_PAGE_SIZE));
    if (part.key !== key) expanded.add(part.key);
    siblings = part.children;
    parentKey = part.key;
  }
}

/** Clamp a navigation page when a live inventory update removes rows. */
export function monitoringPage(items, page = 0) {
  const pages = Math.max(1,Math.ceil(items.length / MONITORING_PAGE_SIZE));
  const current = Math.max(0,Math.min(page,pages - 1));
  return {items:items.slice(current * MONITORING_PAGE_SIZE,(current + 1) * MONITORING_PAGE_SIZE),current,pages,total:items.length};
}

/** Render bounded navigation and one editor, using the card's existing draft. */
export function configurationBrowser(card) {
  const data = card.current.data;
  const full = monitoringNavigation(data);
  const tree = card.configQuery.trim() ? monitoringNavigation(data,card.configQuery) : full;
  const index = monitoringIndex(full);
  card.configNavigation = monitoringIndex(tree);
  card.configPages ??= new Map();
  card.configSelection = index.has(card.configSelection) ? card.configSelection : tree[0]?.key;
  const selected = index.get(card.configSelection);
  const rows = inventoryRows(data);
  const summaries = rows.filter((source) => source.kind === "device" && source.watched);
  const included = new Set(summaries.flatMap((source) => source.availability_entities ?? []));
  const state = (source) => source.excluded_by?.length ? "Availability ignored" : source.watched ? "Monitored" : "Not monitored";
  const entityState = (source) => source.excluded_by?.length ? "Availability ignored" :
    [included.has(source.entity_id) ? "Included in device summary" : "",source.watched ? "Separate check enabled" : ""].filter(Boolean).join(" · ") || "Not monitored";
  const label = (node) => node.type === "integration" && node.group.entry ? card.displaySourceName(node.group.entry) : node.name;
  const choose = (node, detail = "") => `<button type="button" class="config-pick" data-config-select="${esc(node.key)}"${card.configSelection === node.key ? ' aria-current="true"' : ""}><span>${esc(label(node))}</span>${detail ? `<small>${esc(detail)}</small>` : ""}</button>`;
  const paged = (items, key, render) => {
    const page = monitoringPage(items,card.configPages.get(key));
    const controls = page.pages > 1 ? `<div class="config-paging"><button type="button" class="button" data-config-page="${esc(key)}" data-page-number="${page.current - 1}"${page.current === 0 ? " disabled" : ""} aria-label="Previous page in ${esc(key.startsWith("nav:") ? "source navigation" : "selected group")}">Previous</button><span class="small">${page.current * MONITORING_PAGE_SIZE + 1}–${page.current * MONITORING_PAGE_SIZE + page.items.length} of ${page.total}</span><button type="button" class="button" data-config-page="${esc(key)}" data-page-number="${page.current + 1}"${page.current === page.pages - 1 ? " disabled" : ""} aria-label="Next page in ${esc(key.startsWith("nav:") ? "source navigation" : "selected group")}">Next</button></div>` : "";
    return page.items.map(render).join("") + (controls && key.startsWith("nav:") ? `<li class="config-page-controls">${controls}</li>` : controls);
  };
  const description = (node) => {
    if (node.type === "entity") return "";
    if (node.type === "integration") return node.children.length ? `${countLabel(node.group.devices.length,"device")} · ${countLabel(node.group.entities.length,"entity","entities")}` : "Integration status";
    if (node.type === "device") return `${countLabel(node.device.entities.length,"entity","entities")}${node.device.summary?.watched ? " · Summary monitored" : ""}`;
    return countLabel(node.children.length,node.children.every((child) => child.type === "entity") ? "entity" : "item",node.children.every((child) => child.type === "entity") ? "entities" : "items");
  };
  const branch = (node) => {
    const expanded = card.configExpanded.has(node.key);
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length ? `<button type="button" class="config-toggle" data-config-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${esc(label(node))}"><span class="disclosure" aria-hidden="true"></span></button>` : '<span class="config-leaf" aria-hidden="true"></span>'}${choose(node,description(node))}</div>${expanded && node.children.length ? `<ul class="config-nav-children">${paged(node.children,`nav:${node.key}`,branch)}</ul>` : ""}</li>`;
  };
  const choice = (title,scope,current,detail) => `<div class="config-tree-row">${card.configurationChoice(title,scope,current,detail)}</div>`;
  const bulk = (contents) => `<details data-config-disclosure="bulk"><summary>Bulk changes</summary><p class="sub">These choices cover the whole group, including future matching entities. Search does not limit them. Ignore availability also removes matching entities from device summaries. Matching exclusions take precedence.</p>${contents}</details>`;
  const sourceList = (sources,key) => paged(sources,key,(source) => {
    const target = [...index.values()].find((node) => node.source?.node_id === source.node_id && node.parents.some((parent) => parent.key === selected.key)) ?? [...index.values()].find((node) => node.source?.node_id === source.node_id);
    return `<div class="config-member">${target ? choose(target,source.entity_id ?? "") : `<span>${esc(source.name)}</span>`}<span class="small">${esc(entityState(source))}</span></div>`;
  });
  let detail = '<h2 id="config-detail-title">No sources available</h2><p class="sub">Discovered integrations, devices, and entities will appear here.</p>';
  if (selected) {
    const heading = `<p class="config-path">${[...selected.parents,selected].map((node) => esc(label(node))).join(" / ")}</p><h2 id="config-detail-title" tabindex="-1">${esc(label(selected))}</h2>`;
    let content = "";
    if (selected.type === "integration") {
      const group = selected.group;
      const monitoredDevices = group.devices.filter((device) => device.summary?.watched).length;
      const monitoredEntities = group.entities.filter((source) => source.watched).length;
      content = `<p class="config-counts">${group.entry ? `Integration status: ${esc(state(group.entry).toLowerCase())} · ` : ""}${monitoredDevices} device summaries monitored · ${monitoredEntities} separate entity checks</p>`;
      content += group.entry ? choice("Integration status",monitoringScope("entry",group.id),state(group.entry),"Checks whether Home Assistant has loaded this integration. It does not verify recording, physical operation, or successful commands.") : '<p class="sub">These sources have no known integration in the current inventory. Device and entity choices work here in the same way.</p>';
      if (group.entry) content += bulk(choice("Separate checks for all entities",monitoringScope("entities",group.id),`${monitoredEntities} separate checks enabled`,"Each matching entity gets its own availability check.") + choice("Integration status and separate entity checks",monitoringScope("both",group.id),`${state(group.entry)} integration status; ${monitoredEntities} separate entity checks`,"Combines both choices above. Device-summary selection is separate."));
    } else if (selected.type === "device") {
      const device = selected.device;
      const entities = rows.filter((source) => source.kind === "entity" && source.attributes?.device?.includes(device.id)).sort((a,b) => a.name.localeCompare(b.name) || a.node_id.localeCompare(b.node_id));
      content = device.summary ? choice("Device availability",monitoringScope("device_availability",device.id),state(device.summary),"One summary across selected entities. Missing availability is evidence about Home Assistant, not proof of physical failure.") : '<p class="sub">No device availability summary is available. Review individual entities below.</p>';
      const members = device.summary?.availability_entities?.length ?? 0;
      content += `<p class="config-counts">${members} ${device.summary?.watched ? "entities selected for the summary" : "eligible entities; summary not monitored"} · ${entities.filter((source) => source.excluded_by?.length).length} ignored · ${entities.filter((source) => source.watched).length} separate checks</p>`;
      content += bulk(choice("Separate checks for all entities on this device",monitoringScope("device",device.id),`${entities.filter((source) => source.watched).length} separate checks enabled`,"Covers this device's entities across all integrations; it does not select the device summary."));
      content += `<h3>Entities and exceptions</h3><p class="sub">Select an entity to ignore its availability or enable a separate check. Summary membership below reflects the saved configuration.</p>${sourceList(entities,`members:${selected.key}`) || '<p class="sub">No associated entities in the current inventory.</p>'}`;
    } else if (selected.type === "entity") {
      const source = selected.source;
      content = `<p class="config-counts">${esc(entityState(source))}</p><p class="small">${esc(source.entity_id ?? source.node_id)}</p>` + choice("Entity availability",monitoringScope("entity",source.node_id,source),entityState(source),"Watch adds a separate availability check. Ignore availability removes this entity from individual checks and device summaries. Use matching rules removes this direct choice.");
    } else content = '<p class="sub">Choose an item below. This grouping is for navigation and does not change monitoring.</p>';
    if (["integration","folder"].includes(selected.type)) content += `<div class="config-child-list">${paged(selected.children,`detail:${selected.key}`,(node) => choose(node,node.source ? entityState(node.source) : description(node)))}</div>`;
    detail = heading + content;
  }
  const watched = (kind) => rows.filter((source) => source.kind === kind && source.watched).length;
  return `<section class="panel config-workspace"><div class="config-workspace-head"><h2>Choose what to monitor</h2><p class="sub">${countLabel(watched("integration"),"integration check")} · ${countLabel(watched("device"),"device summary","device summaries")} · ${countLabel(watched("entity"),"separate entity check")}</p></div><div class="config-layout"><nav class="config-rail" aria-label="Monitoring sources"><label class="coverage-search"><span>Find a source</span><input type="search" data-config-search value="${esc(card.configQuery)}" placeholder="Integration, device, or entity"></label><div class="config-rail-actions"><button type="button" class="link" data-action="collapse-config">Collapse all</button>${card.configQuery ? '<button type="button" class="link" data-action="clear-config-search">Clear search</button>' : ""}</div><ul class="config-tree">${paged(tree,"nav:root",branch) || '<li class="sub">No sources match this search.</li>'}</ul></nav><section class="config-detail" aria-labelledby="config-detail-title">${detail}</section></div></section>`;
}
