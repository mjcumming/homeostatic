import {inventoryRows} from "./model.mjs?v=13";

export const MATCH_FIELDS = ["kind", "domain", "device_class", "integration", "device", "entity", "area", "floor", "label"];

export const MATCH_LABELS = {
  kind:"Source type", domain:"Domain", device_class:"Device class", integration:"Integration instance ID",
  device:"Device ID", entity:"Entity ID or stable reference", area:"Area ID", floor:"Floor ID", label:"Label ID",
};

export function editCatalogRule(rule, field, value) {
  if (field.startsWith("match:")) {
    const key = field.slice(6);
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length) rule.match[key] = values;
    else delete rule.match[key];
  } else rule[field] = value;
}

export function newCatalogRule(rules) {
  let number = rules.length + 1;
  while (rules.some((rule) => rule.id === `rule_${number}`)) number++;
  return {id:`rule_${number}`, action:"attach", enabled:true, match:{}, checks:["availability"]};
}

const byName = (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

/** Group current Home Assistant sources for guided monitoring choices. */
export function monitoringTree(data, query = "") {
  const names = new Map((data.devices ?? []).map((device) => [device.id, device.name]));
  const groups = new Map();
  const groupFor = (id) => {
    const key = id ?? "";
    if (!groups.has(key)) groups.set(key,{id:key,name:id ? "Unavailable integration entry" : "Entities without an integration",
      entry:null,devices:new Map(),loose:[],entities:[]});
    return groups.get(key);
  };
  const rows = inventoryRows(data).filter((source) => ["integration", "entity"].includes(source.kind));
  const deviceTotals = new Map();
  for (const source of rows.filter((item) => item.kind === "integration")) {
    const group = groupFor(source.entry_id ?? source.node_id.slice(6));
    group.name = source.name;
    group.entry = source;
  }
  for (const source of rows.filter((item) => item.kind === "entity")) {
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
    if (!group.devices.has(deviceId)) group.devices.set(deviceId,{id:deviceId,name:names.get(deviceId) ?? "Unnamed device",entities:[]});
    group.devices.get(deviceId).entities.push(source);
  }
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (source) => [source.name,source.entity_id].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
  return [...groups.values()].map((group) => {
    const full = !normalized || group.name.toLocaleLowerCase().includes(normalized);
    const devices = [...group.devices.values()].map((device) => ({...device,total:deviceTotals.get(device.id),
      entities:full || device.name.toLocaleLowerCase().includes(normalized)
        ? device.entities : device.entities.filter(matches)}))
      .filter((device) => device.entities.length).sort(byName);
    const loose = full ? group.loose : group.loose.filter(matches);
    return {...group,devices,loose,
      count:group.entities.length + (group.entry ? 1 : 0),
      watched:group.entities.filter((source) => source.watched).length + (group.entry?.watched ? 1 : 0),
      visible:devices.reduce((total, device) => total + device.entities.length,0) + loose.length + (group.entry && (full || matches(group.entry)) ? 1 : 0)};
  }).filter((group) => !normalized || group.visible).sort((left,right) =>
    (!left.id) - (!right.id) || byName(left,right));
}

/** Map a visible tree row to one catalog match without a second selection store. */
export function monitoringScope(kind, id, source = null) {
  if (kind === "both") return {kind,id,match:{integration:[id]}};
  if (kind === "entry") return {kind,id,match:{integration:[id],kind:["integration"]}};
  if (kind === "entities") return {kind,id,match:{integration:[id],kind:["entity"]}};
  if (kind === "device") return {kind,id,match:{device:[id]}};
  const reference = source?.attributes?.entity?.[0] ??
    (source?.node_id?.startsWith("entity:") ? source.node_id.slice(7) : null);
  return reference ? {kind:"entity",id,match:{entity:[reference]}} : null;
}

function sameMatch(left, right) {
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length && keys.every((key) =>
    right[key]?.length === left[key].length &&
    [...left[key]].sort().every((value,index) => value === [...right[key]].sort()[index]));
}

/** Explain one direct choice; broader overlapping rules stay visible in the preview. */
export function scopeChoice(rules, scope) {
  const matches = rules.filter((rule) => sameMatch(rule.match ?? {},scope.match));
  if (matches.length > 1) return "multiple";
  if (!matches.length || matches[0].enabled === false) return "inherit";
  return matches[0].action;
}

/** Edit only a rule matching the chosen scope; preserve all unrelated catalog rules. */
export function setScopeChoice(rules, scope, choice) {
  const indices = rules.flatMap((rule,index) => sameMatch(rule.match ?? {},scope.match) ? [index] : []);
  if (indices.length > 1) return false;
  if (choice === "inherit") {
    if (indices.length) rules.splice(indices[0],1);
    return true;
  }
  if (!["attach", "exclude"].includes(choice)) return false;
  if (indices.length) {
    rules[indices[0]].action = choice;
    rules[indices[0]].enabled = true;
  } else rules.push({...newCatalogRule(rules),action:choice,match:scope.match});
  return true;
}
