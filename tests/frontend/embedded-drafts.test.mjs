import test from "node:test";
import assert from "node:assert/strict";
import {saveScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";

globalThis.HTMLElement=class {};
const elements=new Map();
globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const Card=elements.get("homeostatic-card");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const configuration=revision=>({revision,settings:{timings:{settle:30},consumer:null,notifications:false,monitoring_policies:[],notification_definitions:{methods:{},profiles:{}}}});
function fixture(callWS) {
  const card=Object.create(Card.prototype);
  Object.assign(card,{isConnected:false,render(){},tools:{disconnect(){}},dialog:{close(){}},current:{status:"current",data:{}},detailSequence:0,sourceSequence:0,topomationSequence:0,
    _hass:{connection:{},user:{id:"owner",is_admin:true},callWS}});
  return card;
}

for(const boundary of ["connection","user","permissions"])test(`embedded configuration read survives a ${boundary} boundary without retaining old busy state`,async()=>{
  const old=deferred(),fresh=deferred(),card=fixture(()=>old.promise);
  const pending=card.loadConfiguration();assert.equal(card.configBusy,true);
  card.hass={...card._hass,connection:boundary==="connection"?{}:card._hass.connection,
    user:boundary==="user"?{id:"other",is_admin:true}:boundary==="permissions"?{id:"owner",is_admin:false}:card._hass.user,
    callWS:()=>fresh.promise};
  assert.equal(card.configBusy,undefined);assert.equal(card.configuration,undefined);
  const loading=card.loadConfiguration();old.resolve(configuration("obsolete"));await pending;
  assert.equal(card.configBusy,true,"An old completion cannot unlock the new read");
  assert.equal(card.configuration,undefined);
  fresh.resolve(configuration("fresh"));await loading;
  assert.equal(card.configBusy,false);assert.equal(card.configuration.revision,"fresh");
  assert.equal(card.panelDraftSession,undefined,"Embedded cards do not join panel sessions");
});

test("embedded destination discovery resets on user change and ignores obsolete results",async()=>{
  const old=deferred(),fresh=deferred(),card=fixture(request=>request.section==="settings"?Promise.resolve(configuration("old")):old.promise);
  await card.loadConfiguration();card.settingsDraft.timings.settle=90;
  const pending=card.loadDeliveryConfiguration();assert.equal(card.deliveryBusy,true);
  card.hass={...card._hass,user:{id:"other",is_admin:true},callWS:request=>request.section==="settings"?Promise.resolve(configuration("fresh")):fresh.promise};
  assert.equal(card.deliveryBusy,undefined);assert.equal(card.settingsDraft,undefined);
  await card.loadConfiguration();const discovery=card.loadDeliveryConfiguration();
  old.resolve({delivery_targets:[{name:"Obsolete recipient"}]});await pending;
  assert.equal(card.deliveryBusy,true);assert.equal(card.configuration.delivery_targets,undefined);
  fresh.resolve({delivery_targets:[{name:"Current recipient"}]});await discovery;
  assert.equal(card.deliveryBusy,false);assert.equal(card.configuration.delivery_targets[0].name,"Current recipient");
  assert.equal(card.settingsDraft.timings.settle,30);
});

test("embedded pending save cannot leave the replacement connection locked or replay itself",async()=>{
  const old=deferred(),card=fixture(request=>request.type==="homeostatic/save_settings"?old.promise:Promise.resolve(configuration("old")));
  await card.loadConfiguration();card.settingsDraft.timings.settle=90;
  const pending=saveScopedConfiguration(card,{kind:"settings"});assert.equal(card.settingsBusy,true);
  let writes=0;
  card.hass={...card._hass,connection:{},callWS:async request=>{if(request.type==="homeostatic/save_settings")writes++;return configuration("fresh");}};
  assert.equal(card.settingsBusy,undefined);assert.equal(card.scopedBusy,undefined);
  await card.loadConfiguration();old.resolve({saved:true});assert.equal(await pending,false);
  assert.equal(card.configuration.revision,"fresh");assert.equal(card.settingsDraft.timings.settle,30);
  assert.equal(card.settingsBusy,undefined);assert.equal(writes,0);
});
