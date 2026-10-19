import {inventoryRows} from "./model.mjs?v=102";

const byName = (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

/** Group current Home Assistant sources for guided monitoring choices. */
export function monitoringTree(data, query = "") {
  const names = new Map((data.devices ?? []).map((device) => [device.id, device.name]));
  const groups = new Map();
  const allRows = inventoryRows(data).filter((source) => ["integration", "entity", "device", "battery", "vacuum", "ups"].includes(source.kind));
  const upsRows=new Map();
  for(const source of allRows.filter(item=>item.kind==="ups")) {
    const id=JSON.stringify([source.attributes?.device?.[0],source.check_id]);
    if(!upsRows.has(id)||source.watched)upsRows.set(id,source);
  }
  const rows=[...allRows.filter(item=>item.kind!=="ups"),...upsRows.values()];
  const entries = new Set(rows.filter((source) => source.kind === "integration").map((source) => source.entry_id ?? source.node_id.slice(6)));
  const groupFor = (id) => {
    const key = entries.has(id) ? id : "";
    if (!groups.has(key)) groups.set(key,{id:key,name:"Other sources",
      entry:null,devices:new Map(),loose:[],entities:[]});
    return groups.get(key);
  };
  const deviceTotals = new Map();
  for (const source of rows.filter((item) => item.kind === "integration")) {
    const group = groupFor(source.entry_id ?? source.node_id.slice(6));
    group.name = source.name;
    group.entry = source;
  }
  for (const source of rows.filter((item) => ["entity", "battery", "vacuum", "ups"].includes(item.kind))) {
    const group = groupFor(source.owner_id ?? source.attributes?.integration?.[0]);
    group.entities.push(source);
    const deviceId = source.attributes?.device?.[0];
    if (!deviceId) {
      group.loose.push(source);
      continue;
    }
    const total = deviceTotals.get(deviceId) ?? {count:0,watched:0};
    total.count++;
    if (source.watched) total.watched++;
    deviceTotals.set(deviceId,total);
    if (!group.devices.has(deviceId)) group.devices.set(deviceId,{id:deviceId,name:names.get(deviceId) ?? "Unnamed device",entities:[],summary:null});
    group.devices.get(deviceId).entities.push(source);
  }
  for (const source of rows.filter((item) => item.kind === "device")) {
    const deviceId = source.attributes?.device?.[0] ?? source.node_id.slice(7);
    const owners = [...groups.values()].filter((group) => group.devices.has(deviceId));
    if (!owners.length) owners.push(groupFor(source.attributes?.integration?.find((id) => entries.has(id))));
    for (const group of owners) {
      if (!group.devices.has(deviceId)) group.devices.set(deviceId,{id:deviceId,name:names.get(deviceId) ?? source.name,entities:[],summary:null});
      group.devices.get(deviceId).summary = source;
    }
  }
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (source) => [source.name,source.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
  return [...groups.values()].map((group) => {
    const full = !normalized || group.name.toLocaleLowerCase().includes(normalized);
    const devices = [...group.devices.values()].map((device) => ({...device,total:deviceTotals.get(device.id) ?? {count:0,watched:0},
      entities:full || device.name.toLocaleLowerCase().includes(normalized)
        ? device.entities : device.entities.filter(matches)}))
      .filter((device) => device.entities.length || (device.summary && (full || matches(device.summary)))).sort(byName);
    const loose = full ? group.loose : group.loose.filter(matches);
    return {...group,devices,loose,
      count:group.entities.length + (group.entry ? 1 : 0) + [...group.devices.values()].filter((device) => device.summary).length,
      watched:group.entities.filter((source) => source.watched).length + (group.entry?.watched ? 1 : 0) + [...group.devices.values()].filter((device) => device.summary?.watched).length,
      visible:devices.reduce((total, device) => total + device.entities.length + (device.summary ? 1 : 0),0) + loose.length + (group.entry && (full || matches(group.entry)) ? 1 : 0)};
  }).filter((group) => !normalized || group.visible).sort((left,right) =>
    (!left.id) - (!right.id) || byName(left,right));
}
