import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=43";
import {monitoringScope, monitoringTree} from "./configuration.mjs?v=43";

const keyFor = (...parts) => JSON.stringify(parts);
const named = (left,right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
const count = (value,noun,plural = `${noun}s`) => `${value} ${value === 1 ? noun : plural}`;

/** Navigate only through integrations, devices, and entities. */
export function monitoringNavigation(data,query = "") {
  const entities = (sources,path) => sources.map((source) => ({
    key:keyFor(...path,"entity",source.node_id),name:source.name,type:"entity",source,children:[],
  })).sort(named);
  const tree = monitoringTree(data).map((group) => ({
    key:keyFor(group.id),name:group.name,type:"integration",group,
    children:[
      ...group.devices.map((device) => ({
        key:keyFor(group.id,"device",device.id),name:device.name,type:"device",device,
        children:entities(device.entities,[group.id,"device",device.id]),
      })),
      ...entities(group.loose,[group.id,"loose"]),
    ].sort(named),
  }));
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return tree;
  const filter = (nodes,parentMatch = false) => nodes.flatMap((node) => {
    const matches = parentMatch || [node.name,node.source?.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
    const children = filter(node.children,matches);
    return matches || children.length ? [{...node,children}] : [];
  });
  return filter(tree);
}

/** Index full paths so search never narrows the scope of a choice. */
export function monitoringIndex(tree) {
  const index = new Map();
  const visit = (nodes,parents) => {
    for (const node of nodes) {
      index.set(node.key,{...node,parents});
      visit(node.children,[...parents,node]);
    }
  };
  visit(tree,[]);
  return index;
}

/** Open the selected item's ancestors without changing other branches. */
export function revealMonitoringPath(tree,key,expanded) {
  const node = monitoringIndex(tree).get(key);
  if (node) for (const parent of node.parents) expanded.add(parent.key);
}

/** Render the expanded tree and one focused editor. */
export function configurationBrowser(card) {
  const data = card.current.data;
  const full = monitoringNavigation(data);
  const tree = card.configQuery.trim() ? monitoringNavigation(data,card.configQuery) : full;
  const index = monitoringIndex(full);
  card.configNavigation = monitoringIndex(tree);
  card.configSelection = card.configNavigation.has(card.configSelection) ? card.configSelection : tree[0]?.key;
  const selected = index.get(card.configSelection);
  const rows = inventoryRows(data);
  const summaries = rows.filter((source) => source.kind === "device" && source.watched);
  const included = new Set(summaries.flatMap((source) => source.availability_entities ?? []));
  const state = (source) => source.excluded_by?.length ? "Not monitored" : source.watched ? "Monitored" : "Not monitored";
  const entityState = (source) => source.excluded_by?.length ? "Availability ignored" :
    [included.has(source.entity_id) ? "In device summary" : "",source.watched ? "Separate check" : ""].filter(Boolean).join(" · ") || "Not monitored";
  const label = (node) => node.type === "integration" && node.group.entry ? card.displaySourceName(node.group.entry) : node.name;
  const choose = (node,detail = "") => `<button type="button" class="config-pick" data-config-select="${esc(node.key)}"${card.configSelection === node.key ? ' aria-current="true"' : ""}><span>${esc(label(node))}</span>${detail ? `<small>${esc(detail)}</small>` : ""}</button>`;
  const description = (node) => node.type === "integration"
    ? `${count(node.group.devices.length,"device")} · ${count(node.group.entities.length,"entity","entities")}`
    : node.type === "device" ? `${count(node.device.entities.length,"entity","entities")}${node.device.summary?.watched ? " · Watched" : ""}`
      : entityState(node.source);
  const branch = (node) => {
    const expanded = card.configExpanded.has(node.key);
    return `<li class="config-branch"><div class="config-nav-row">${node.children.length ? `<button type="button" class="config-toggle" data-config-toggle="${esc(node.key)}" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${esc(label(node))}"><span class="disclosure" aria-hidden="true"></span></button>` : '<span class="config-leaf" aria-hidden="true"></span>'}${choose(node,description(node))}</div>${expanded ? `<ul class="config-nav-children">${node.children.map(branch).join("")}</ul>` : ""}</li>`;
  };
  const choice = (title,scope,current,detail) => `<div class="config-tree-row">${card.configurationChoice(title,scope,current,detail)}</div>`;
  let detail = '<h2 id="config-detail-title">No sources available</h2><p class="sub">Discovered integrations, devices, and entities will appear here.</p>';
  if (selected) {
    const heading = `<p class="config-path">${[...selected.parents,selected].map((node) => esc(label(node))).join(" / ")}</p><h2 id="config-detail-title" tabindex="-1">${esc(label(selected))}</h2>`;
    let content = "";
    if (selected.type === "integration") {
      const group = selected.group;
      const monitoredDevices = group.devices.filter((device) => device.summary?.watched).length;
      const monitoredEntities = group.entities.filter((source) => source.watched).length;
      content = `<p class="config-counts">${monitoredDevices} of ${group.devices.length} device summaries watched · ${monitoredEntities} separate entity checks</p>`;
      if (group.entry) content += choice("Integration connection",monitoringScope("entry",group.id),state(group.entry),"Checks whether Home Assistant loaded this connection; it does not prove the equipment works.");
      else content += '<p class="sub">These sources have no known integration connection. Choose devices and entities individually.</p>';
      if (group.id && group.devices.length) content += choice("Devices discovered by this integration",monitoringScope("integration_devices",group.id),`${monitoredDevices} watched`,"Sets the expectation for current and future devices. A specific device choice can override Ignore here.");
      if (group.id && group.entities.length) content += choice("Separate checks for entities",monitoringScope("entities",group.id),`${monitoredEntities} watched`,"Each matching entity gets its own check. Device summaries are independent.");
      content += '<p class="sub">Expand this integration in the tree to choose an individual device or entity.</p>';
    } else if (selected.type === "device") {
      const device = selected.device;
      const members = device.summary?.availability_entities?.length ?? 0;
      content = device.summary ? choice("Device availability summary",monitoringScope("device_availability",device.id),state(device.summary),"One check across eligible Home Assistant entities; not proof of a physical fault.") : '<p class="sub">No availability summary is available for this device.</p>';
      content += `<p class="config-counts">${members} eligible ${members === 1 ? "entity" : "entities"} · ${device.entities.filter((source) => source.excluded_by?.length).length} ignored</p><p class="sub">Expand this device in the tree for individual entity choices.</p>`;
    } else {
      const source = selected.source;
      content = `<p class="config-counts">${esc(entityState(source))}</p><p class="small">${esc(source.entity_id ?? source.node_id)}</p>` + choice("Entity availability",monitoringScope("entity",source.node_id,source),entityState(source),"Watch creates a separate check. Ignore also removes it from a device summary.");
    }
    detail = heading + content;
  }
  const watched = (kind) => rows.filter((source) => source.kind === kind && source.watched).length;
  return `<section class="panel config-workspace"><div class="config-workspace-head"><h2>Choose what to monitor</h2><p class="sub">${count(watched("integration"),"integration check")} · ${count(watched("device"),"device summary","device summaries")} · ${count(watched("entity"),"separate entity check")}</p></div><div class="config-layout"><nav class="config-rail" aria-label="Monitoring sources"><label class="coverage-search"><span>Find a source</span><input type="search" data-config-search value="${esc(card.configQuery)}" placeholder="Integration, device, or entity"></label><div class="config-rail-actions"><button type="button" class="link" data-action="collapse-config">Collapse all</button>${card.configQuery ? '<button type="button" class="link" data-action="clear-config-search">Clear search</button>' : ""}</div><ul class="config-tree">${tree.map(branch).join("") || '<li class="sub">No sources match this search.</li>'}</ul></nav><section class="config-detail" aria-labelledby="config-detail-title">${detail}</section></div></section>`;
}
