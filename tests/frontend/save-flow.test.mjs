import test from "node:test";
import assert from "node:assert/strict";

const elements=new Map();
globalThis.HTMLElement=class {};
globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js?save-flow");
const Card=elements.get("homeostatic-card-v22");

for(const action of ["saveConfiguration","saveAlerts","saveSettings"]) test(`${action} saves the complete draft directly`,async()=>{
  const calls=[],card=Object.create(Card.prototype);
  const saved={revision:"before",rules:[],settings:{notifications:false,consumer:null,timings:{settle:1},policy:{}},alerts:{notifications:false,consumer:null}};
  Object.assign(card,{configuration:saved,current:{status:"current"},page:"configuration",settingsDraft:structuredClone(saved.settings),configDraft:[{id:"pending",action:"attach",match:{kind:["device"]}}],alertDraft:{notifications:false,consumer:null},main:{querySelectorAll(){return [];},querySelector(){return null;}},render(){},_hass:{async callWS(request){calls.push(structuredClone(request));return request.type==="homeostatic/save_settings"?{saved:true}:{...saved,revision:"after"};}}});
  card.settingsDraft.timings.settle=5;
  card.editAlert({target:{dataset:{alertField:"notifications"},checked:true}});
  card.editAlert({target:{dataset:{alertField:"consumer"},value:"automation.owner"}});
  await card[action]();
  assert.deepEqual(calls.map(call=>call.type),["homeostatic/save_settings","homeostatic/configuration"]);
  assert.equal(calls[0].settings.timings.settle,5);
  assert.equal(calls[0].settings.rules[0].id,"pending");
  assert.equal(calls[0].settings.notifications,true);
  assert.equal(calls[0].settings.consumer,"automation.owner");
  assert.equal(calls[0].preview_token,undefined);
});
