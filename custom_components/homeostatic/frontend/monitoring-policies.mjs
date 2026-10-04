import {escapeHtml as esc} from "./model.mjs?v=46";
import {MATCH_FIELDS, MATCH_LABELS, newCatalogRule} from "./configuration.mjs?v=47";

/** Keep exact source choices in Sources, including mixed and multi-source rules. */
export function isGroupPolicy(rule) {
  return !["integration", "device", "entity"].some(field => rule.match?.[field]?.length);
}

function isBroadPolicy(rule, kind, check) {
  return rule.action === "attach" && rule.checks?.[0] === check &&
    rule.match?.kind?.length === 1 && rule.match.kind[0] === kind &&
    Object.entries(rule.match).every(([field, values]) => field === "kind" || !values.length);
}

function newBroadPolicy(rules, kind, check) {
  const rule = newCatalogRule(rules);
  rule.match = {kind:[kind]};
  rule.checks = [check];
  return rule;
}

export function isAllIntegrationPolicy(rule) {
  return isBroadPolicy(rule, "integration", "availability");
}

export function newAllIntegrationPolicy(rules) {
  return newBroadPolicy(rules, "integration", "availability");
}

export function isAllDevicePolicy(rule) {
  return isBroadPolicy(rule, "device", "availability");
}

export function newAllDevicePolicy(rules) {
  return newBroadPolicy(rules, "device", "availability");
}

export function isAllBatteryPolicy(rule) {
  return isBroadPolicy(rule, "battery", "battery");
}

export function newAllBatteryPolicy(rules) {
  return newBroadPolicy(rules, "battery", "battery");
}

export function isAllVacuumPolicy(rule) {
  return isBroadPolicy(rule, "vacuum", "vacuum");
}

export function newAllVacuumPolicy(rules) {
  return newBroadPolicy(rules, "vacuum", "vacuum");
}

export function newGroupPolicy(rules) {
  return {...newCatalogRule(rules),enabled:false,match:{kind:["device"]}};
}

const sourceTypes = {integration:"integrations", device:"devices", entity:"entities", battery:"batteries", vacuum:"vacuums"};

/** Explain every condition without treating a rule count as an inventory count. */
export function groupPolicyScope(rule, data = {}) {
  const match = rule.match ?? {};
  const kinds = match.kind?.length ? match.kind : ["integration", "entity"];
  const subject = kinds.map(kind => sourceTypes[kind] ?? kind).join(" or ");
  const conditions = Object.entries(match).filter(([field, values]) => field !== "kind" && values.length).map(([field, values]) => {
    const registry = {area:data.areas, floor:data.floors, label:data.labels}[field];
    const names = values.map(value => registry?.find(item => item.id === value)?.name ?? value);
    return `${({area:"Area",floor:"Floor",label:"Label"})[field] ?? MATCH_LABELS[field] ?? field}: ${names.join(" or ")}`;
  });
  return {subject, conditions};
}

function ruleControls(rule, index, view) {
  const check = rule.checks?.[0] ?? "availability";
  const checkOption = (value, name) => `<option value="${value}"${check === value ? " selected" : ""}>${name}</option>`;
  return `<div class="config-rule-head"><label><span>Action</span><select data-rule-view="${view}" data-rule-index="${index}" data-rule-field="action"><option value="attach"${rule.action === "attach" ? " selected" : ""}>Watch</option><option value="exclude"${rule.action === "exclude" ? " selected" : ""}>Leave unmonitored</option></select></label><label><span>Check</span><select data-rule-view="${view}" data-rule-index="${index}" data-rule-field="checks">${checkOption("availability","HA availability")}${checkOption("battery","Battery condition")}${checkOption("vacuum","Vacuum error")}</select></label><label class="config-enabled"><input type="checkbox" data-rule-view="${view}" data-rule-index="${index}" data-rule-field="enabled"${rule.enabled !== false ? " checked" : ""}> Enabled</label><button type="button" class="link" data-remove-rule="${index}">Remove rule</button></div>`;
}

function ruleFields(rule, index, fields, view) {
  return `<div class="config-fields">${fields.map(field => `<label><span>${esc(MATCH_LABELS[field])}</span><input type="text" data-rule-view="${view}" data-rule-index="${index}" data-rule-field="match:${field}" value="${esc((rule.match?.[field] ?? []).join(", "))}" placeholder="Any" autocomplete="off"></label>`).join("")}</div><p class="small">All filled conditions must match. Separate alternative values within a condition with commas.</p>`;
}

/** Render the four checks as on/off choices, and narrower rules under Other policies. */
export function monitoringPolicies(card) {
  const rules = card.configDraft;
  const groups = rules.map((rule, index) => ({rule, index})).filter(({rule}) => isGroupPolicy(rule));
  const savedBroad = (rule) => Boolean(card.configuration?.rules?.some(saved => saved.id === rule.id));
  const claimed = (rule, predicate) => predicate(rule) && (savedBroad(rule) || rule.enabled !== false);
  const integration = groups.find(({rule}) => claimed(rule, isAllIntegrationPolicy));
  const device = groups.find(({rule}) => claimed(rule, isAllDevicePolicy));
  const battery = groups.find(({rule}) => claimed(rule, isAllBatteryPolicy));
  const vacuum = groups.find(({rule}) => claimed(rule, isAllVacuumPolicy));
  const claimedIds = new Set([integration, device, battery, vacuum].filter(Boolean).map(({rule}) => rule.id));
  const others = groups.filter(({rule}) => !claimedIds.has(rule.id));
  const disabled = card.configBusy ? " disabled" : "";
  const broadFields = MATCH_FIELDS.filter(field => !["integration", "device", "entity"].includes(field));
  const renderPolicy = ({rule, index}) => {
    const {subject, conditions} = groupPolicyScope(rule, card.configuration ?? card.current.data);
    const newDraft = card.configuration?.rules && !card.configuration.rules.some(saved => saved.id === rule.id);
    const status = newDraft && rule.enabled === false ? "Draft — choose a scope and enable it before saving."
      : newDraft ? "Draft — no effect until reviewed and saved."
      : rule.enabled === false ? "Paused — this rule has no effect." : "Enabled — applies to current and future matching sources.";
    return `<article class="monitoring-policy" data-ui-key="policy:${esc(rule.id)}"><h3>${rule.action === "exclude" ? "Leave unmonitored" : "Watch"} ${esc(subject)}</h3><p class="small">${status}</p>${conditions.length ? `<ul class="policy-conditions">${conditions.map(condition => `<li>${esc(condition)}</li>`).join("")}</ul>` : '<p class="sub">All current and future sources of this type match.</p>'}<details class="config-rule policy-edit"${card.configEditingRule === rule.id ? " open" : ""}><summary>Edit policy</summary>${ruleControls(rule,index,"group")}${ruleFields(rule,index,broadFields,"group")}</details></article>`;
  };
  const watched = others.filter(({rule}) => rule.action !== "exclude").map(renderPolicy).join("");
  const excluded = others.filter(({rule}) => rule.action === "exclude").map(renderPolicy).join("");
  const excludedCount = others.filter(({rule}) => rule.action === "exclude").length;
  const broadSection = (title, detail, entry, addAction, addLabel, clearAction, enableAction) => {
    const draft = entry && card.configuration?.rules && !card.configuration.rules.some(rule => rule.id === entry.rule.id);
    const paused = entry?.rule.enabled === false;
    const state = entry && !paused ? "On" : "Off";
    const note = paused ? " This check is paused." : draft ? " Review and save before this takes effect." : "";
    const actions = !entry
      ? `<button type="button" class="button" data-action="${addAction}"${disabled}>${addLabel}</button>`
      : paused
        ? `<button type="button" class="button" data-action="${enableAction}"${disabled}>Turn on</button><button type="button" class="link" data-action="${clearAction}"${disabled}>Turn off</button>`
        : `<button type="button" class="link" data-action="${clearAction}"${disabled}>Turn off</button>`;
    return `<section class="policy-check"><div class="policy-check-head"><h2>${esc(title)}</h2><strong class="policy-state${state === "Off" ? " is-off" : ""}">${state}</strong></div><p>${esc(detail)}${note}</p><div class="policy-check-actions">${actions}</div></section>`;
  };
  const checks = [
    broadSection("Integrations", "Watches whether current and future integrations are loaded in Home Assistant. A failed setup, a retry that keeps failing, a migration problem, or a sign-in request opens an issue.", integration,
      "add-integration-rule", "Monitor all integrations", "clear-integration-rule", "enable-integration-rule"),
    broadSection("Devices", "Watches current and future devices through the entities selected on each device.", device,
      "add-device-rule", "Monitor all devices", "clear-device-rule", "enable-device-rule"),
    broadSection("Batteries", "Watches current and future batteries for a low reading.", battery,
      "add-battery-rule", "Monitor all batteries", "clear-battery-rule", "enable-battery-rule"),
    broadSection("Vacuums", "Watches current and future vacuums for an error.", vacuum,
      "add-vacuum-rule", "Monitor all vacuums", "clear-vacuum-rule", "enable-vacuum-rule"),
  ].join("");
  const repairs = `<section class="policy-check"><div class="policy-check-head"><h2>Repairs</h2><strong class="policy-state">On</strong></div><p>Every Repair Home Assistant raises becomes an issue.</p><div class="policy-check-actions"><button type="button" class="link" data-page="notifications">When to report them</button></div></section>`;
  const editingOther = others.some(({rule}) => rule.action === "exclude" && rule.id === card.configEditingRule);
  const empty = !watched && !excludedCount ? '<p class="sub">No other policies.</p>' : "";
  return `<div class="monitoring-policies">${checks}${repairs}<h2>Other policies</h2><p class="sub">Match current and future sources by area, label, or another condition.</p><fieldset class="config-editor"${disabled}>${empty}${watched}${excludedCount ? `<details class="policy-exceptions"${editingOther ? " open" : ""}><summary>Leave unmonitored policies (${excludedCount})</summary><div>${excluded}</div></details>` : ""}<button type="button" class="button" data-action="add-rule"${disabled}>Add policy</button></fieldset></div>`;
}
