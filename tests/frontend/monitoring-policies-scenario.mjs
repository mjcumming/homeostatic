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
  card.page = "configuration";
  card.settingsSection = "policies";
  await card.loadConfiguration();
  const root = card.shadowRoot;
  const visible = () => card.main.innerText;
  expect(visible().includes("Group policies (1)"),"Only the group rule belongs in the normal policy list");
  expect(!visible().includes("Watch 1 selected device"),"Individual rules must start hidden");
  expect(!visible().includes("Source type"),"Raw match fields must start hidden");
  expect(!root.querySelector(".config-advanced").open,"Advanced starts collapsed");
  expect(requests.length === 0,"Reading the page must not preview or save");
  root.querySelector(".policy-edit > summary").click();
  root.querySelector('.policy-edit [data-rule-field="enabled"]').click();
  expect(card.configDraft[1].enabled === false,"Filtered controls must edit the original rule index");
  expect(visible().includes("Paused — this rule has no effect"),"The group summary reflects draft edits");
  const domain = root.querySelector('.policy-edit [data-rule-field="match:domain"]');
  domain.value = "matter";
  domain.dispatchEvent(new Event("input",{bubbles:true}));
  expect(root.querySelector('.config-advanced [data-rule-index="1"][data-rule-field="match:domain"]').value === "matter","Both editors reflect the same draft");
  domain.value = "";
  domain.dispatchEvent(new Event("change",{bubbles:true}));
  expect(JSON.stringify(card.configDraft[0]) === JSON.stringify(original[0]),"Entity selections must remain intact");
  expect(JSON.stringify(card.configDraft.slice(2)) === JSON.stringify(original.slice(2)),"Device selections must remain intact");
  root.querySelector('.policy-sources [data-page="sources"]').click();
  expect(card.page === "sources" && card.configDraft[1].enabled === false,"Sources navigation must retain the draft");
  card.page = "configuration";
  card.settingsSection = "policies";
  card.render();
  await card.previewConfiguration();
  expect(requests[0].rules.length === 19,"Preview must include all rules");
  expect(!!root.querySelector('[data-action="save-configuration"]'),"A reviewed draft may be saved");
  root.querySelector(".config-advanced > summary").click();
  const device = root.querySelector('.config-advanced [data-rule-index="2"][data-rule-field="enabled"]');
  device.closest("details").open = true;
  device.click();
  expect(card.configPreview === null,"Advanced edits invalidate the preview");
  expect(!root.querySelector('[data-action="save-configuration"]'),"Changed drafts need a fresh review");
  await card.previewConfiguration();
  await card.saveConfiguration();
  expect(saved.length === 19 && !saved[1].enabled && !saved[2].enabled,"Save must retain the complete edited catalog");
  expect(JSON.stringify(saved[0]) === JSON.stringify(original[0]),"Saving must preserve unrelated rules");
  root.querySelector('[data-action="add-rule"]').click();
  expect(card.configDraft.length === 20,"Adding a group policy must preserve source rules");
  expect(root.querySelectorAll(".policy-edit[open]").length > 0,"The new group's editor opens");
  root.querySelector('[data-remove-rule="19"]').click();
  expect(card.configDraft.length === 19,"Removing the new policy must preserve the catalog");
  saved = structuredClone(original);
  card.configEditingRule = null;
  card.configAdvancedOpen = false;
  root.querySelector(".config-advanced").open = false;
  for(const details of root.querySelectorAll("details"))details.open = false;
  await card.loadConfiguration();
  return "PASS: group scope, hidden technical fields, exact rule indices, preserved selections, draft navigation, complete preview/save, edit invalidation, add/remove";
}
