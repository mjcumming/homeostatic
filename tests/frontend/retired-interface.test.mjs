import assert from "node:assert/strict";
import {access} from "node:fs/promises";
import test from "node:test";

const elements=new Map();
globalThis.HTMLElement=class {};
globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const Card=elements.get("homeostatic-card-v38");

for(const [view,page] of [["overview","problems"],["functions","problems"],["house","sources"],["coverage","sources"]])test(`retired ${view} card route opens the current ${page} workspace`,()=>{
  const card=Object.create(Card.prototype);card.render=()=>{};
  card.setConfig({view});
  assert.equal(card.page,page);
  assert.equal(card.config.view,page);
});

test("current configuration loads without a legacy rule or alert response",async()=>{
  const settings={timings:{settle:120},notifications:false,consumer:null,monitoring_policies:[],notification_definitions:{timezone:"UTC",methods:{},default:[],repairs:[],broken_automations:[],assignments:{},automation_profiles:{}}};
  const card=Object.create(Card.prototype),calls=[];
  Object.assign(card,{render(){},_hass:{async callWS(request){calls.push(request);return {revision:"current",settings:structuredClone(settings)};}}});
  await card.loadConfiguration();
  assert.equal(card.configError,null);
  assert.deepEqual(card.settingsDraft,settings);
  assert.deepEqual(calls,[{type:"homeostatic/configuration",section:"settings"}]);
});

test("retired pages and competing save paths are absent from the card",()=>{
  for(const method of ["overview","house","coverage","functionsPanel","monitoringEditor","ignoreAvailability","editScope","editRule","previewConfiguration","saveConfiguration","previewAlerts","saveAlerts","previewSettings","saveSettings"])
    assert.equal(Card.prototype[method],undefined,method);
});

for(const path of ["frontend/monitoring-browser.mjs","frontend/monitoring-policies.mjs","frontend/source-settings.mjs","frontend/tree.mjs","reporting.py","simple_notifications.py"])test(`retired module ${path} remains absent`,async()=>{
  await assert.rejects(access(new URL(`../../custom_components/homeostatic/${path}`,import.meta.url)),{code:"ENOENT"});
});
