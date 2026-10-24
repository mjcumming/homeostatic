import test from "node:test";
import assert from "node:assert/strict";
import {connectPanelDrafts,disconnectPanelDrafts,renderPanelDrafts} from "../../custom_components/homeostatic/frontend/panel-drafts.mjs";
import {initializeScopedConfiguration,saveScopedConfiguration,discardScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {testDeliveryMethod} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

const copy=value=>structuredClone(value);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture() {
  const settings={notifications:false,timings:{settle:30},consumer:null,monitoring_policies:[{id:"one",name:"Policy",check:"availability",match:{kind:["entity"]},parameters:{},enabled:true,notifications:[]}],notification_definitions:{methods:{phone:{name:"Phone",mode:"fixed",destinations:["notify:phone"]}},profiles:{morning:{name:"Morning",timing:{mode:"report",at:"08:00",weekdays:[0]},methods:["phone"]}}}};
  const server={revision:"1",settings},calls=[];
  const hass={connection:{},user:{id:"owner",is_admin:true},async callWS(request){calls.push(copy(request));if(request.type==="homeostatic/save_settings"){assert.equal(request.revision,server.revision);server.settings=copy(request.settings);server.revision="2";return {saved:true};}return copy(server);}};
  const card=makeCard(hass);card.editors.configuration=copy(server);card.editors.settingsDraft=copy(settings);initializeScopedConfiguration(card.editors);
  return {card,hass,server,calls};
}
function makeCard(hass) {
  const card={editors:{},_hass:hass,current:{status:"current"},renders:0,render(){if(renderPanelDrafts(this))this.renders++;}};
  connectPanelDrafts(card);return card;
}

test("a replacement panel retains every draft scope and refreshes its saved baseline",async()=>{
  const {card,hass,server,calls}=fixture();
  card.editors.settingsDraft.monitoring_policies[0].name="Unrelated policy draft";
  card.editors.settingsDraft.notification_definitions.methods.phone.name="Method draft";
  card.editors.settingsDraft.notification_definitions.profiles.morning.name="Profile draft";
  card.editors.settingsDraft.timings.settle=90;
  disconnectPanelDrafts(card);const replacement=makeCard(hass);
  assert.equal(replacement.editors.settingsDraft,card.editors.settingsDraft);
  server.revision="external";server.settings.notifications=true;
  assert.equal(await saveScopedConfiguration(replacement,{kind:"profile",id:"morning"}),true);
  assert.deepEqual(calls.map(request=>request.type),["homeostatic/configuration","homeostatic/save_settings","homeostatic/configuration"]);
  assert.equal(server.settings.notification_definitions.profiles.morning.name,"Profile draft");
  assert.equal(server.settings.monitoring_policies[0].name,"Policy");
  assert.equal(server.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(server.settings.timings.settle,30);
  assert.equal(replacement.editors.settingsDraft.monitoring_policies[0].name,"Unrelated policy draft");
  assert.equal(replacement.editors.settingsDraft.notification_definitions.methods.phone.name,"Method draft");
  assert.equal(replacement.editors.settingsDraft.timings.settle,90);
  assert.equal(replacement.editors.settingsDraft.notifications,true);
});

test("panel replacement retains editor validation, units and picker context together with drafts",()=>{
  const {card,hass}=fixture(),state=card.editors;
  state.settingsDraft.monitoring_policies[0].name="Pending policy";
  Object.assign(state,{policyValidation:{id:"one",field:"duration_seconds",message:"Choose a duration"},policyDurationUnits:{"one:duration_seconds":"minutes"},entitySelection:{id:"one",query:"kitchen",selectedOnly:true},deliveryPicker:{id:"phone",query:"upstairs"}});
  disconnectPanelDrafts(card);const replacement=makeCard(hass);
  assert.equal(replacement.editors,state);
  assert.equal(replacement.editors.policyValidation.message,"Choose a duration");
  assert.equal(replacement.editors.policyDurationUnits["one:duration_seconds"],"minutes");
  assert.equal(replacement.editors.entitySelection.query,"kitchen");
  assert.equal(replacement.editors.deliveryPicker.query,"upstairs");
});

test("a pending method test follows panel replacement without a duplicate request",async()=>{
  const {card,hass,calls}=fixture(),gate=deferred();
  hass.callWS=async request=>{calls.push(request);return request.type==="homeostatic/preview_delivery_method"?{preview_token:"one",targets:[{channel:"notify:phone",available:true}]}:gate.promise;};
  const pending=testDeliveryMethod(card,"phone");
  await Promise.resolve();
  disconnectPanelDrafts(card);const replacement=makeCard(hass);
  assert.equal(replacement.editors,card.editors);
  assert.equal(replacement.editors.deliveryMethodBusy,true);
  await testDeliveryMethod(replacement,"phone");
  assert.equal(calls.filter(request=>request.type==="homeostatic/test_delivery_method").length,1);
  gate.resolve({requested:["notify:phone"],failed:[]});await pending;
  assert.equal(replacement.editors.deliveryMethodBusy,false);
  assert.match(replacement.editors.deliveryMethodNotice,/Test requested/);
  assert.ok(replacement.renders>0);
});

for(const outcome of ["confirmed","rejected","uncertain"])test(`panel replacement keeps one pending ${outcome} save and unrelated edits`,async()=>{
  const {card,hass}=fixture(),gate=deferred(),send=hass.callWS;let attempts=0;
  card.editors.settingsDraft.monitoring_policies[0].name="Keep this policy";
  card.editors.settingsDraft.notification_definitions.methods.phone.name="Pending method";
  hass.callWS=async request=>{if(request.type==="homeostatic/save_settings"){attempts++;await gate.promise;}return send(request);};
  const saving=saveScopedConfiguration(card,{kind:"method",id:"phone"});
  disconnectPanelDrafts(card);const replacement=makeCard(hass);
  assert.equal(replacement.editors.settingsBusy,true);
  assert.equal(await saveScopedConfiguration(replacement,{kind:"method",id:"phone"}),false);
  if(outcome==="confirmed")gate.resolve();else gate.reject(outcome==="rejected"?{code:"invalid_settings",message:"Rejected draft"}:Error("Connection lost"));
  assert.equal(await saving,outcome==="confirmed");
  assert.equal(attempts,1,"Leaving and returning cannot replay the pending save");
  assert.equal(replacement.editors.settingsBusy,false);
  assert.equal(replacement.editors.settingsDraft.monitoring_policies[0].name,"Keep this policy");
  assert.equal(replacement.editors.settingsDraft.notification_definitions.methods.phone.name,"Pending method");
  assert.ok(replacement.renders>0,"Completion updates the replacement panel");
  if(outcome!=="confirmed")assert.match(replacement.editors.scopedError,/Rejected draft|Connection lost/);
});

test("saved changes while away retain a conflicting draft without overwriting them",async()=>{
  const {card,hass,server,calls}=fixture();card.editors.settingsDraft.monitoring_policies[0].name="Local draft";
  disconnectPanelDrafts(card);server.revision="external";server.settings.monitoring_policies[0].name="External edit";
  const replacement=makeCard(hass);
  assert.equal(await saveScopedConfiguration(replacement,{kind:"policy",id:"one"}),false);
  assert.equal(replacement.editors.settingsDraft.monitoring_policies[0].name,"Local draft");
  assert.match(replacement.editors.scopedError,/Saved settings for this editor changed/);
  assert.deepEqual(calls.map(request=>request.type),["homeostatic/configuration"]);
});

test("discarded drafts and completed clean sessions are released on leaving",()=>{
  const {card,hass}=fixture();card.editors.settingsDraft.timings.settle=90;
  discardScopedConfiguration(card.editors,{kind:"settings"});disconnectPanelDrafts(card);
  assert.equal(makeCard(hass).editors.configuration,undefined);
});

for(const boundary of ["logout","another user","admin revoked","new connection"])test(`${boundary} cannot inherit drafts or accept an old pending response`,async()=>{
  const {card,hass,server}=fixture(),gate=deferred();let reads=0;
  card.editors.settingsDraft.monitoring_policies[0].name="Private draft";
  hass.callWS=async request=>{if(request.type==="homeostatic/save_settings")return gate.promise;reads++;return copy(server);};
  const saving=saveScopedConfiguration(card,{kind:"policy",id:"one"});
  card._hass={...hass,user:boundary==="logout"?null:boundary==="another user"?{id:"other",is_admin:true}:boundary==="admin revoked"?{id:"owner",is_admin:false}:hass.user,connection:boundary==="new connection"?{}:hass.connection};
  connectPanelDrafts(card);const next=card.panelDraftSession;
  gate.resolve({saved:true});assert.equal(await saving,false);
  assert.equal(reads,0);assert.equal(card.editors.configuration,undefined);assert.equal(card.editors.settingsDraft,undefined);
  assert.equal(card.panelDraftSession,next);assert.equal(card.editors.settingsBusy,undefined);
});
