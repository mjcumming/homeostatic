import {escapeHtml as esc} from "./model.mjs?v=43";
import {MATCH_FIELDS, MATCH_LABELS, ruleSummary} from "./configuration.mjs?v=43";

/** Keep exact source choices in Sources, including mixed and multi-source rules. */
export function isGroupPolicy(rule) {
  return !["integration", "device", "entity"].some(field => rule.match?.[field]?.length);
}

const sourceTypes = {integration:"integration connections", device:"device availability", entity:"entity availability"};

/** Explain every condition without treating a rule count as an inventory count. */
export function groupPolicyScope(rule, data = {}) {
  const match = rule.match ?? {};
  const kinds = match.kind?.length ? match.kind : ["integration", "entity"];
  const subject = kinds.map(kind => sourceTypes[kind] ?? kind).join(" or ");
  const conditions = Object.entries(match).filter(([field, values]) => field !== "kind" && values.length).map(([field, values]) => {
    const registry = {area:data.areas, floor:data.floors, label:data.labels}[field];
    const names = values.map(value => registry?.find(item => item.id === value)?.name ??
      (["area", "floor", "label"].includes(field) ? `Selected ${field} (see rule details)` : value));
    return `${({area:"Area",floor:"Floor",label:"Label"})[field] ?? MATCH_LABELS[field] ?? field}: ${names.join(" or ")}`;
  });
  return {subject, conditions};
}

function ruleControls(rule, index, view) {
  return `<div class="config-rule-head"><label><span>Action</span><select data-rule-view="${view}" data-rule-index="${index}" data-rule-field="action"><option value="attach"${rule.action === "attach" ? " selected" : ""}>Watch availability</option><option value="exclude"${rule.action === "exclude" ? " selected" : ""}>Leave unmonitored</option></select></label><label class="config-enabled"><input type="checkbox" data-rule-view="${view}" data-rule-index="${index}" data-rule-field="enabled"${rule.enabled !== false ? " checked" : ""}> Enabled</label><button type="button" class="link" data-remove-rule="${index}">Remove rule</button></div>`;
}

function ruleFields(rule, index, fields, view) {
  return `<div class="config-fields">${fields.map(field => `<label><span>${esc(MATCH_LABELS[field])}</span><input type="text" data-rule-view="${view}" data-rule-index="${index}" data-rule-field="match:${field}" value="${esc((rule.match?.[field] ?? []).join(", "))}" placeholder="Any" autocomplete="off"></label>`).join("")}</div><p class="small">All filled conditions must match. Separate alternative values within a condition with commas.</p>`;
}

/** Render group policies first; retain the complete unchanged catalog in Advanced. */
export function monitoringPolicies(card) {
  const rules = card.configDraft;
  const groups = rules.map((rule, index) => ({rule, index})).filter(({rule}) => isGroupPolicy(rule));
  const disabled = card.configBusy ? " disabled" : "";
  const broadFields = MATCH_FIELDS.filter(field => !["integration", "device", "entity"].includes(field));
  const policies = groups.map(({rule, index}) => {
    const {subject, conditions} = groupPolicyScope(rule, card.current.data);
    return `<article class="monitoring-policy" data-ui-key="policy:${esc(rule.id)}"><h3>${rule.action === "exclude" ? "Leave unmonitored" : "Watch"} ${esc(subject)}</h3><p class="small">${rule.enabled === false ? "Paused — this rule has no effect." : "Enabled — applies to current and future matching sources."}</p>${conditions.length ? `<ul class="policy-conditions">${conditions.map(condition => `<li>${esc(condition)}</li>`).join("")}</ul>` : '<p class="sub">No additional conditions.</p>'}<details class="config-rule policy-edit"${card.configEditingRule === rule.id ? " open" : ""}><summary>Edit group policy</summary>${ruleControls(rule,index,"group")}${ruleFields(rule,index,broadFields,"group")}</details></article>`;
  }).join("");
  const advanced = rules.map((rule, index) => `<details class="config-rule" data-ui-key="advanced-policy:${esc(rule.id)}"><summary>${esc(ruleSummary(rule))}</summary>${ruleControls(rule,index,"advanced")}${ruleFields(rule,index,MATCH_FIELDS,"advanced")}<details><summary>Stored rule details</summary><pre>${esc(JSON.stringify(rule,null,2))}</pre></details></details>`).join("");
  return `<div class="monitoring-policies"><h3>Group policies (${groups.length})</h3><fieldset class="config-editor"${disabled}>${policies || '<p class="sub">No group policies. Choose individual sources in Sources, or add a policy for a whole group.</p>'}<button type="button" class="button" data-action="add-rule"${disabled}>Add group policy</button></fieldset><div class="policy-sources"><h3>Individual source choices</h3><p class="sub">Choose specific integrations, devices, and entities by name in Sources.</p><button type="button" class="button" data-page="sources">Open Sources</button></div><details class="config-advanced"${card.configAdvancedOpen ? " open" : ""}><summary>Advanced rule details</summary><div class="body"><p class="sub">All ${rules.length} rules, including individual source choices. Use this editor to inspect exact conditions or resolve overlapping rules. Changes still require review and save.</p><fieldset class="config-editor"${disabled}>${advanced || '<p>No rules configured.</p>'}</fieldset></div></details></div>`;
}
