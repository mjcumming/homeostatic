import {monitoringPolicyRules} from "./monitoring-policies-fixture.mjs";

/** Exercise the real component's draft, navigation, preview and save handlers. */
export async function runMonitoringPolicyScenario(card) {
  const expect = (value,message) => {if(!value)throw new Error(message);};
  const original = monitoringPolicyRules();
  let saved = structuredClone(original);
  const requests = [];
  const baseHass = card._hass;
  const configuration = () => ({revision:1,rules:structuredClone(saved),settings:{timings:{},policy:{},simple_notifications:{people:{}}},alerts:{notifications:false,consumer:null},consumers:[]});
  card._hass = {...baseHass,async callWS(request) {
    if(request.type === "homeostatic/configuration")return configuration();
    if(request.type === "homeostatic/preview_configuration") {
      requests.push(structuredClone(request));
      return {preview_token:"policy-preview",watched:1,added:[],removed:[],added_count:0,removed_count:0,functions:[]};
    }
    if(request.type === "homeostatic/save_configuration") {
      expect(request.preview_token === "policy-preview","Save must use the preview token");
      requests.push(structuredClone(request));
      saved = structuredClone(request.rules);
      return {saved:true};
    }
    return baseHass.callWS(request);
  }};
  card.page = "policies";
  await card.loadConfiguration();
  const root = card.shadowRoot;
  const visible = () => card.main.innerText;
  expect(visible().includes("Integrations") && visible().includes("Vacuums") && visible().includes("Repairs"),"The Policies page leads with the broad checks");
  expect(visible().includes("Monitor all vacuums"),"A missing vacuum policy offers the broad choice");
  expect(!root.querySelector('[data-settings-section="policies"]'),"Settings no longer holds monitoring policies");
  expect(!visible().includes("Watch 1 selected device"),"Individual rules must start hidden");
  expect(!visible().includes("Source type"),"Raw match fields must start hidden");
  expect(!root.querySelector(".config-advanced"),"The raw catalog editor is not on Policies");
  expect(requests.length === 0,"Reading the page must not preview or save");
  root.querySelector('[data-action="clear-integration-rule"]').click();
  expect(card.configDraft.length === 18 && !card.configDraft.some(rule => rule.id === "connections"),"Turn off removes only the broad check");
  expect(visible().includes("Monitor all integrations"),"A removed check offers the broad choice again");
  expect(JSON.stringify(card.configDraft[0]) === JSON.stringify(original[0]),"Entity selections must remain intact");
  root.querySelector('.nav [data-page="sources"]').click();
  expect(card.page === "sources" && card.configDraft.length === 18,"Sources navigation must retain the draft");
  card.page = "policies";
  card.render();
  await card.previewConfiguration();
  expect(requests[0].rules.length === 18,"Preview must include the remaining rules");
  expect(!!root.querySelector('[data-action="save-configuration"]'),"A reviewed draft may be saved");
  root.querySelector('[data-action="add-integration-rule"]').click();
  expect(card.configPreview === null,"Turning a check on invalidates the preview");
  expect(!root.querySelector('[data-action="save-configuration"]'),"Changed drafts need a fresh review");
  expect(card.configDraft.at(-1).enabled && card.configDraft.at(-1).match.kind[0] === "integration","Monitor all drafts an enabled broad check");
  expect(visible().includes("Review and save before this takes effect"),"A draft check is not described as saved");
  await card.previewConfiguration();
  await card.saveConfiguration();
  expect(saved.length === 19 && saved.at(-1).match.kind[0] === "integration","Save applies the reviewed check");
  expect(JSON.stringify(saved[0]) === JSON.stringify(original[0]),"Saving must preserve unrelated rules");
  root.querySelector('[data-action="add-rule"]').click();
  expect(card.configDraft.length === 20,"Adding a policy must preserve source rules");
  expect(card.configDraft.at(-1).enabled === false &&
    JSON.stringify(card.configDraft.at(-1).match) === JSON.stringify({kind:["device"]}),
    "A new policy must not watch every source if saved without review");
  expect(root.querySelectorAll(".policy-edit[open]").length > 0,"The new policy editor opens");
  const domain = root.querySelector('.policy-edit [data-rule-field="match:domain"]');
  domain.value = "matter";
  domain.dispatchEvent(new Event("input",{bubbles:true}));
  expect(card.configDraft.at(-1).match.domain[0] === "matter","The other-policy editor writes that rule");
  expect(JSON.stringify(card.configDraft[0]) === JSON.stringify(original[0]),"Editing another policy must leave source rules intact");
  domain.value = "";
  domain.dispatchEvent(new Event("change",{bubbles:true}));
  root.querySelector('[data-remove-rule="19"]').click();
  expect(card.configDraft.length === 19,"Removing the new policy must preserve the catalog");
  expect(!!root.querySelector('[data-action="add-battery-rule"]'),"Battery monitoring has a direct action");
  root.querySelector('[data-action="add-battery-rule"]').click();
  const battery = card.configDraft.at(-1);
  expect(battery.action === "attach" && battery.enabled &&
    JSON.stringify(battery.match) === JSON.stringify({kind:["battery"]}) &&
    JSON.stringify(battery.checks) === JSON.stringify(["battery"]),"The action drafts a broad battery check");
  expect(saved.length === 19,"Adding a battery policy must not save it");
  expect(!root.querySelector('[data-action="add-battery-rule"]'),"An existing broad battery policy must not be duplicated");
  expect(visible().includes("Review and save before this takes effect"),"The draft must not be described as saved monitoring");
  await card.previewConfiguration();
  expect(requests.at(-1).type === "homeostatic/preview_configuration" && requests.at(-1).rules.length === 20,
    "Review must include the broad battery policy and all existing choices");
  await card.saveConfiguration();
  expect(saved.length === 20 && saved.at(-1).match.kind[0] === "battery","Save applies the reviewed battery policy");
  saved = structuredClone(original);
  card.configEditingRule = null;
  for(const details of root.querySelectorAll("details"))details.open = false;
  await card.loadConfiguration();
  return "PASS: group scope, hidden technical fields, exact rule indices, preserved selections, draft navigation, complete preview/save, edit invalidation, add/remove, direct battery policy";
}
