/** Fictional, deterministic Homeostatic snapshot for README captures. */
const observed = "2026-09-29T14:20:00Z";

const source = (node_id, name, kind, extra = {}) => ({
  node_id, name, kind, requirements: [], attributes: {}, attached_by: ["demo_selection"],
  excluded_by: [], watched: true, entity_id: null, entry_id: null, owner_id: null,
  ...extra,
});

const zigbee = source("entry:zigbee", "Willow House Zigbee", "integration", {
  entry_id: "zigbee", attributes: {domain: ["zha"]},
});
const hallMotion = source("entity:hall_motion", "Hall motion", "entity", {
  entity_id: "binary_sensor.hall_motion", owner_id: "zigbee",
  attributes: {domain: ["binary_sensor"], device_class: ["motion"], device: ["hall_sensor"], area: ["hall"]},
});
const hallLights = source("entity:hall_lights", "Hall ceiling lights", "entity", {
  entity_id: "light.hall_ceiling", owner_id: "zigbee",
  attributes: {domain: ["light"], device: ["hall_lights"], area: ["hall"]},
});
const kitchenLeak = source("entity:kitchen_leak", "Kitchen leak sensor", "entity", {
  entity_id: "binary_sensor.kitchen_leak", owner_id: "zigbee",
  attributes: {domain: ["binary_sensor"], device_class: ["moisture"], device: ["kitchen_leak"], area: ["kitchen"]},
});
const hallFunction = source("function:hall_lighting", "Hall motion lighting", "function", {
  requirements: [hallMotion.node_id, hallLights.node_id],
  readiness: {answer: "blocked", nodes: [{node_id: hallMotion.node_id, own: "fail", watched: true, reasons: ["unavailable"]}]},
});
const kitchenFunction = source("function:kitchen_leak_alert", "Kitchen leak alert", "function", {
  requirements: [kitchenLeak.node_id],
  readiness: {answer: "blocked", nodes: [{node_id: kitchenLeak.node_id, own: "fail", watched: true, reasons: ["unavailable"]}]},
});
const wifi = source("entry:wifi", "Willow House Wi-Fi", "integration", {
  entry_id: "wifi", attributes: {domain: ["unifi"]},
});
const officePlug = source("entity:office_plug", "Office desk plug", "entity", {
  entity_id: "switch.office_desk_plug", owner_id: "wifi",
  attributes: {domain: ["switch"], device: ["office_plug"], area: ["office"]},
});
const livingTemperature = source("entity:living_temperature", "Living room temperature", "entity", {
  entity_id: "sensor.living_room_temperature", owner_id: "wifi",
  attributes: {domain: ["sensor"], device_class: ["temperature"], device: ["living_temperature"], area: ["living"]},
});
const excluded = source("entity:bench_test", "Workbench test plug", "entity", {
  entity_id: "switch.workbench_test", owner_id: "wifi", watched: false,
  excluded_by: ["demo_exclusion"], attributes: {domain: ["switch"], area: ["office"]},
});
const device = (id, name, owner_id, area, member) => source(`device:${id}`, name, "device", {
  owner_id, attributes: {device: [id], area: [area], integration_domain: [owner_id === "zigbee" ? "zha" : "unifi"]},
  availability_entities: [member.entity_id],
});
const devices = [device("hall_sensor", "Hall motion sensor", "zigbee", "hall", hallMotion),
  device("hall_lights", "Hall ceiling lights", "zigbee", "hall", hallLights),
  device("kitchen_leak", "Kitchen leak sensor", "zigbee", "kitchen", kitchenLeak),
  device("office_plug", "Office desk plug", "wifi", "office", officePlug),
  device("living_temperature", "Living room thermometer", "wifi", "living", livingTemperature)];

const openEpisode = {
  episode_id: "willow-zigbee-20260929", anchor: zigbee.node_id, status: "fail",
  importance: "high", opened_at: "2026-09-29T14:08:00Z",
  impact: [hallMotion.node_id, hallLights.node_id, kitchenLeak.node_id, hallFunction.node_id, kitchenFunction.node_id],
  recorded: [hallMotion.node_id, hallLights.node_id, kitchenLeak.node_id],
  reasons: [{node_id: zigbee.node_id, reason: "setup_error", status: "fail",
    message: "Zigbee connection did not finish setting up: coordinator did not respond."}],
};

const ended = (id, anchor, name, opened_at, resolved_at, reason, message) => ({
  episode: {episode_id: id, anchor, status: "fail", importance: "normal", impact: [],
    opened_at, reasons: [{node_id: anchor, reason, status: "fail", message}]},
  source: {node_id: anchor, name}, resolved_at, resolution: "cleared", absorbed_into: null,
});

export const snapshot = {
  schema_version: 1, available: true, entry_id: "willow-demo", updated_at: observed,
  readiness: {answer: "blocked", nodes: [{node_id: zigbee.node_id, own: "fail", watched: true, reasons: ["setup_error"]}]},
  evidence_gaps: 0, functions: [hallFunction, kitchenFunction],
  floors: [{id: "main", name: "Main floor"}, {id: "upper", name: "Upper floor"}],
  areas: [{id: "hall", name: "Hall", floor_id: "main"}, {id: "kitchen", name: "Kitchen", floor_id: "main"},
    {id: "living", name: "Living room", floor_id: "main"}, {id: "office", name: "Office", floor_id: "upper"}],
  devices: [{id: "hall_sensor", name: "Hall motion sensor", area_id: "hall"},
    {id: "hall_lights", name: "Hall ceiling lights", area_id: "hall"},
    {id: "kitchen_leak", name: "Kitchen leak sensor", area_id: "kitchen"},
    {id: "office_plug", name: "Office desk plug", area_id: "office"},
    {id: "living_temperature", name: "Living room thermometer", area_id: "living"}],
  inventory: {
    nodes: [zigbee, hallMotion, hallLights, kitchenLeak, hallFunction, kitchenFunction, wifi, officePlug, livingTemperature, ...devices],
    catalog: {watched: 14, candidates: [zigbee, hallMotion, hallLights, kitchenLeak, wifi, officePlug, livingTemperature, ...devices, excluded]},
    integration_evidence: {[zigbee.node_id]: {current: {reason: "setup_error", message: "Coordinator did not respond during setup", observed_at: observed}, last_failure: null},
      [wifi.node_id]: {current: {reason: "loaded", message: "Loaded", observed_at: observed}, last_failure: null}},
    entity_status: Object.fromEntries([hallMotion, hallLights, kitchenLeak].map(item => [item.node_id, {
      current: {reason: "unavailable", observed_at: observed},
      explanation: {findings: [{node_id: item.node_id, reason: "unavailable", status: "fail"}], nodes: []},
      readiness: {answer: "blocked", nodes: []},
    }])),
    episodes: [openEpisode], operator_controls: [], enrollment_changes: [], notification_requests: [],
    resolved_history: {started_at: "2026-09-01T00:00:00Z", retention: {max_episodes: 100, max_age_days: 30}, episodes: [
      ended("willow-plug-20260927", officePlug.node_id, officePlug.name,
        "2026-09-27T18:12:00Z", "2026-09-27T18:29:00Z", "unavailable", "Office desk plug was unavailable in Home Assistant; later reported available."),
      ended("willow-temperature-20260922", livingTemperature.node_id, livingTemperature.name,
        "2026-09-22T11:03:00Z", "2026-09-22T11:16:00Z", "unavailable", "Living room temperature entity was unavailable; later reported available."),
      ended("willow-hall-20260914", hallMotion.node_id, hallMotion.name,
        "2026-09-14T07:21:00Z", "2026-09-14T07:34:00Z", "unavailable", "Hall motion entity was unavailable; later reported available."),
    ]},
  },
  coverage: {no_checks: [], never_observed: [], stale: [], notification_consumer_missing: false},
  policy: {notifications_enabled: true, routes: {}, episodes: [{episode_id: openEpisode.episode_id,
    loudness: "notify", sent_to: ["phone:alex"], require_acknowledgment: true}],
    reports: [{name: "weekly", next_at: "2026-10-04T14:00:00Z", episodes: []}]},
};

const reporting = {
  timezone: "America/Chicago", default: "weekly", people: {alex: ["phone:alex"]},
  profiles: {immediate: {people: ["alex"]}, acknowledge: {people: ["alex"]},
    morning: {at: "08:00", people: ["alex"]}, evening: {at: "18:00", people: ["alex"]},
    weekly: {at: "09:00", weekday: 6, people: ["alex"]}},
  assignments: {[zigbee.node_id]: {default: "acknowledge", checks: {}}},
};

export const configuration = {
  revision: 1, rules: [], settings: {reporting, simple_notifications: null, notifications: true,
    consumer: "automation.willow_demo_notifications", timings: {batch: 30},
    policy: {timezone: "America/Chicago", recipients: {}, rules: []}},
  alerts: {notifications: true, consumer: "automation.willow_demo_notifications"},
  notification_people: [{id: "alex", name: "Alex", user_id: "demo-alex", administrator: true}],
  notification_destinations: [{channel: "phone:alex", name: "Alex’s phone", user_id: "demo-alex", available: true}],
  consumers: [{entity_id: "automation.willow_demo_notifications", name: "Willow House notifications", state: "on"}],
};

export function nodeDetail(nodeId) {
  const sourceItem = snapshot.inventory.nodes.find(item => item.node_id === nodeId);
  if (!sourceItem) throw new Error("Unknown demo source");
  const evidence = snapshot.inventory.entity_status[nodeId];
  const member = sourceItem.kind === "device" ? snapshot.inventory.nodes.find(item => item.entity_id === sourceItem.availability_entities[0]) : null;
  const unavailable = member && [hallMotion.node_id, hallLights.node_id, kitchenLeak.node_id].includes(member.node_id);
  return {
    source: sourceItem, integration_evidence: snapshot.inventory.integration_evidence[nodeId],
    entity_status: evidence, readiness: sourceItem.readiness ?? snapshot.readiness,
    ...(member ? {device_availability: {status: unavailable ? "all_unavailable" : "available", basis: "entities", entity_ids: [member.entity_id]},
      device_evidence: {total: 1, reporting_count: 1, members: [{node_id: member.node_id, name: member.name,
        state: unavailable ? "unavailable" : "available", restored: false}]},
      members: [{node_id: member.node_id, name: member.name, state: unavailable ? "unavailable" : "available", restored: false}],
      total: 1, unavailable_count: unavailable ? 1 : 0, unknown_count: 0} : {}),
    explanation: {findings: nodeId === zigbee.node_id ? openEpisode.reasons : evidence?.explanation.findings ?? [],
      nodes: sourceItem.kind === "function" ? sourceItem.readiness.nodes : []},
    impact: {nodes: openEpisode.impact.filter(id => id !== nodeId).map(id => ({node_id: id, importance: "normal"}))},
    updated_at: observed,
  };
}
