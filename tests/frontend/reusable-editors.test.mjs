import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions,newMonitoringPolicy,namedPolicies,namedNotifications,editReusable,definitionUses,applicablePolicyLinks,testDeliveryMethod,watchChoices,watchMode,policySelectionChoices} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {installationSettings} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {saveScopedConfiguration,scopedDirty,discardScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";

function fixture() {
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Owner phone",mode:"fixed",destinations:["phone:owner"]};
  definitions.methods.email={name:"Household email",mode:"fixed",destinations:["notify:email"]};
  definitions.default=[{id:"default",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]}];
  definitions.automation_profiles={immediate:[{id:"auto",timing:{mode:"immediate"},methods:["phone"]}]};
  const policy={...newMonitoringPolicy([],"thermostat"),name:"Hall thermostat",enabled:true,notifications:[{id:"phone",timing:{mode:"immediate"},methods:["phone"]},{id:"report",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["email"]}]};
  const settings={notification_definitions:definitions,monitoring_policies:[policy],timings:{},notifications:false,consumer:null};
  const calls=[];let confirmed=structuredClone(settings);
  const card={page:"policies",current:{status:"current",data:monitoringExample()},configuration:{revision:"one",settings:structuredClone(settings),notification_people:[{id:"owner-internal",entity_id:"person.owner",name:"Owner",user_id:"owner-user",administrator:true}],delivery_targets:[{channel:"phone:owner",name:"Owner's phone",type:"App",available:true},{channel:"notify:email",name:"Email",type:"Email",available:true},{channel:"satellite:kitchen",name:"Kitchen voice",type:"Voice",available:true},{channel:"sms:family:",name:"Family SMS",type:"SMS",requires_target:true}]},settingsDraft:settings,main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){},async loadConfiguration(){this.configuration={...this.configuration,settings:structuredClone(this.settingsDraft),revision:"two"};},_hass:{async callWS(request){calls.push(structuredClone(request));if(request.type==="homeostatic/save_settings"){confirmed=structuredClone(request.settings);return {saved:true};}if(request.type==="homeostatic/configuration")return {...card.configuration,settings:structuredClone(confirmed),revision:"two"};return {preview_token:"exact",open_problems:1,requests_now:0,monitoring:{watched:1,added:[],removed:[],added_count:0,removed_count:0,functions:[],ended_issues:["issue-1"]}};}}};
  return {card,calls};
}
async function cardPrototype() {
  globalThis.HTMLElement??=class {};
  if(!globalThis.customElements) {
    const elements=new Map();
    globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
  }
  globalThis.window??={};
  await import("../../custom_components/homeostatic/frontend/homeostatic.js");
  return globalThis.customElements.get("homeostatic-card").prototype;
}
function click(card,action,kind="",id="",extra={}) {
  const target={dataset:{definitionAction:action,definitionKind:kind,definitionId:id,...extra},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}
function change(card,kind,id,field,value,extra={}) {
  const target={dataset:{definitionKind:kind,definitionId:id,definitionField:field,...extra},type:typeof value==="boolean"?"checkbox":typeof value==="number"?"number":"text",value:String(value),checked:value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}

function notificationEditorFixture(kind,existing=true) {
  const context=fixture(),{card}=context,navigation=[],focused=[];
  const id=kind==="methods"?"phone":"morning";
  const profile={name:"Morning",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]};
  card.settingsDraft.notification_definitions.profiles={morning:structuredClone(profile)};
  card.configuration.settings.notification_definitions.profiles={morning:structuredClone(profile)};
  card.page="notifications";card.notificationSection=kind;
  if(existing)card.definitionSelection={kind,id};else click(card,"add",kind);
  const selected=card.definitionSelection.id;
  change(card,kind,selected,"name","Kitchen Echo");
  card.settingsDraft.monitoring_policies[0].name="Unrelated draft";
  card.navigation={capture(){const before={page:card.page,selection:card.definitionSelection};navigation.push(["capture",before]);return before;},finish(before){navigation.push(["finish",before]);}};
  card.main.querySelectorAll=selector=>selector.includes("data-definition-action")?[{dataset:{definitionKind:kind,definitionId:selected},focus(){focused.push(selected);}}]:[];
  return {...context,kind,id:selected,navigation,focused};
}

const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred() {
  let resolve;
  const promise=new Promise(complete=>{resolve=complete;});
  return {promise,resolve};
}

for(const kind of ["methods","profiles"])for(const existing of [true,false])test(`${existing?"existing":"new"} ${kind} Save returns to its updated list without a success message`,async()=>{
  const {card,calls,id,navigation,focused}=notificationEditorFixture(kind,existing);
  const submitted=structuredClone(card.settingsDraft.notification_definitions[kind][id]);
  card.deliveryPicker={id,field:"destinations"};
  click(card,"save-scoped",kind,id);await nextTurn();
  assert.equal(card.page,"notifications");assert.equal(card.notificationSection,kind);
  assert.equal(card.definitionSelection,null);assert.equal(card.deliveryPicker,null);
  assert.deepEqual(card.configuration.settings.notification_definitions[kind][id],submitted);
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Unrelated draft");
  assert.equal(card.configuration.settings.monitoring_policies[0].name,"Hall thermostat");
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
  assert.deepEqual(navigation.map(([action])=>action),["capture","finish"]);
  assert.equal(navigation[1][1],navigation[0][1]);assert.deepEqual(focused,[id]);
  assert.doesNotMatch(namedNotifications(card),/definition-save-result|Kitchen Echo saved\.|Changes saved\./);
  click(card,"edit",kind,id);
  assert.deepEqual(card.settingsDraft.notification_definitions[kind][id],submitted);
  assert.doesNotMatch(namedNotifications(card),/Kitchen Echo saved\./);
});

for(const kind of ["methods","profiles"])for(const failure of ["save","refresh"])test(`${kind} ${failure} failure retains the submitted editor`,async()=>{
  const {card,id,navigation,focused}=notificationEditorFixture(kind),selection=card.definitionSelection;
  const original=card._hass.callWS;
  const failedType=failure==="save"?"homeostatic/save_settings":"homeostatic/configuration";
  card._hass.callWS=async request=>{if(request.type===failedType)throw Object.assign(Error("Synthetic save failure"),{code:"save_failed"});return original(request);};
  click(card,"save-scoped",kind,id);await nextTurn();
  assert.equal(card.definitionSelection,selection);assert.equal(card.page,"notifications");
  assert.equal(card.settingsDraft.notification_definitions[kind][id].name,"Kitchen Echo");
  assert.match(card.scopedError,/Synthetic save failure|Changes were saved, but current settings could not be reloaded/);
  assert.deepEqual(navigation,[]);assert.deepEqual(focused,[]);
  assert.doesNotMatch(namedNotifications(card),/Kitchen Echo saved\./);
});

for(const kind of ["methods","profiles"])test(`${kind} removed before the saved settings refresh does not announce a missing definition`,async()=>{
  const {card,id,navigation,focused}=notificationEditorFixture(kind),selection=card.definitionSelection,original=card._hass.callWS;
  card._hass.callWS=async request=>{
    const response=await original(request);
    if(request.type==="homeostatic/configuration")delete response.settings.notification_definitions[kind][id];
    return response;
  };
  click(card,"save-scoped",kind,id);await nextTurn();
  assert.equal(card.configuration.settings.notification_definitions[kind][id],undefined);
  assert.equal(card.settingsDraft.notification_definitions[kind][id],undefined);
  assert.equal(card.definitionSelection,selection);
  assert.deepEqual(navigation,[]);assert.deepEqual(focused,[]);
  assert.doesNotMatch(namedNotifications(card),/Kitchen Echo saved\./);
});

for(const kind of ["methods","profiles"])for(const [label,move] of [
  ["another page",card=>{card.page="policies";card.definitionSelection={kind:"policies",id:"policy-1"};}],
  ["another editor",(card,kind)=>{card.definitionSelection={kind,id:"other"};}],
  ["newer edits",(card,kind,id)=>{card.settingsDraft.notification_definitions[kind][id].name="Newer unsaved name";}],
])test(`${kind} Save completion preserves ${label}`,async()=>{
  const {card,id,navigation,focused}=notificationEditorFixture(kind),entered=deferred(),release=deferred(),original=card._hass.callWS;
  card._hass.callWS=async request=>{if(request.type==="homeostatic/save_settings"){entered.resolve();await release.promise;}return original(request);};
  click(card,"save-scoped",kind,id);await entered.promise;
  move(card,kind,id);
  const page=card.page,selection=card.definitionSelection,name=card.settingsDraft.notification_definitions[kind][id].name;
  release.resolve();await nextTurn();
  assert.equal(card.page,page);assert.equal(card.definitionSelection,selection);
  assert.equal(card.settingsDraft.notification_definitions[kind][id].name,name);
  assert.equal(card.configuration.settings.notification_definitions[kind][id].name,"Kitchen Echo");
  assert.deepEqual(navigation,[]);assert.deepEqual(focused,[]);
});

for(const kind of ["methods","profiles"])test(`new ${kind} editor has a single title and no premature test instruction`,()=>{
  const {card}=fixture();card.page="notifications";click(card,"add",kind);
  const html=namedNotifications(card);
  assert.match(html,kind==="methods"?/<h1>New delivery method<\/h1>/:/<h1>New notification<\/h1>/);
  assert.doesNotMatch(html,/Save this delivery method before testing it|data-definition-action="test-method"/);
});

for(const [label,prepare] of [
  ["another method",card=>{card.definitionSelection={kind:"methods",id:"email"};}],
  ["a new method",card=>click(card,"add","methods")],
  ["a duplicated method",card=>click(card,"duplicate","methods","phone")],
  ["changed destinations",card=>{card.settingsDraft.notification_definitions.methods.phone.destinations=["notify:email"];card.configuration.settings.notification_definitions.methods.phone.destinations=["notify:email"];}],
  ["an unsaved edit",card=>change(card,"methods","phone","name","Changed name")],
])test(`delivery test outcome is hidden for ${label}`,async()=>{
  const {card}=fixture();card.page="notifications";card.definitionSelection={kind:"methods",id:"phone"};
  card._hass.callWS=async request=>request.type==="homeostatic/preview_delivery_method"?{preview_token:"test-preview",targets:[{channel:"phone:owner",name:"Owner phone",available:true}],skipped:false}:{requested:["phone:owner"],failed:[],skipped:false};
  await testDeliveryMethod(card,"phone");assert.match(namedNotifications(card),/Test requested for Owner phone/);
  prepare(card);
  assert.doesNotMatch(namedNotifications(card),/Test requested for Owner phone/);
});

for(const stage of ["preview","request"])test(`late ${stage} test completion never appears in a different editor`,async()=>{
  const {card}=fixture(),entered=deferred(),release=deferred();
  card.page="notifications";card.definitionSelection={kind:"methods",id:"phone"};
  const preview={preview_token:"test-preview",targets:[{channel:"phone:owner",name:"Owner phone",available:true}],skipped:false},result={requested:["phone:owner"],failed:[],skipped:false};
  const delayedType=stage==="preview"?"homeostatic/preview_delivery_method":"homeostatic/test_delivery_method";
  card._hass.callWS=async request=>{if(request.type===delayedType){entered.resolve();await release.promise;}return request.type==="homeostatic/preview_delivery_method"?preview:result;};
  const testing=testDeliveryMethod(card,"phone");await entered.promise;
  click(card,"edit","methods","email");release.resolve();await testing;
  assert.deepEqual(card.definitionSelection,{kind:"methods",id:"email"});
  assert.doesNotMatch(namedNotifications(card),/Test requested for Owner phone/);
});

test("rendering policies, definitions and setup does not stage changes or send requests",()=>{
  const {card,calls}=fixture(),before=structuredClone(card.settingsDraft);
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.match(namedPolicies(card),/Thermostat progress/);
  card.page="notifications";
  assert.match(installationSettings(card),/Delivery methods/);
  assert.deepEqual(structuredClone(card.settingsDraft),before);assert.equal(calls.length,0);
  card.notificationSection="methods";
  card.settingsDraft.notification_definitions.methods={};
  card.configuration.settings.notification_definitions.methods={};
  assert.match(namedNotifications(card),/No saved delivery methods yet/);
  assert.deepEqual(card.settingsDraft.notification_definitions.methods,{});
});

test("copying a named policy is independent, inactive and preserves explicit notification pairings",()=>{
  const {card}=fixture(),original=structuredClone(card.settingsDraft.monitoring_policies[0]);
  click(card,"duplicate","policies","policy-1");
  const copy=card.settingsDraft.monitoring_policies[1];
  assert.equal(copy.id,"policy-2");assert.equal(copy.enabled,false);
  change(card,"policies",copy.id,"parameters:margin",4);
  assert.deepEqual(card.settingsDraft.monitoring_policies[0],original);
  assert.deepEqual(copy.notifications,original.notifications);
});

test("adding selects a permanent monitoring type without inheriting notifications",()=>{
  const {card}=fixture();card.definitionTemplate="thermostat";click(card,"add","policies");
  assert.equal(card.settingsDraft.monitoring_policies.length,1);
  assert.match(namedPolicies(card),/Choose the monitoring type/);
  click(card,"create","policies");
  const policy=card.settingsDraft.monitoring_policies[1];
  assert.deepEqual(policy.notifications,[]);assert.equal(policy.enabled,false);
  assert.equal(card.settingsDraft.notifications,false);
  const before=structuredClone(policy);change(card,"policies",policy.id,"check","battery");
  assert.deepEqual(policy,before);
  assert.doesNotMatch(namedPolicies(card),/data-definition-field="check"/);
});


test("editing an exact source remains owned by the named policy",()=>{
  const {card}=fixture();
  change(card,"policies","policy-1","match:entity","climate.hall, climate.garage");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].match.entity,["climate.hall","climate.garage"]);
});

test("thermostat unit edits convert differences without applying a temperature offset",()=>{
  const {card}=fixture();change(card,"policies","policy-1","parameters:unit","°C");
  const values=card.settingsDraft.monitoring_policies[0].parameters;
  assert.equal(values.margin,10/9);assert.equal(values.progress,10/9);assert.equal(values.worsening,10/9);
  assert.equal(values.progress_seconds,3600);
  change(card,"policies","policy-1","parameters:unit","°F");assert.equal(values.margin,2);
});

test("temperature limit unit edits preserve absolute bounds",()=>{
  const {card}=fixture();card.settingsDraft.monitoring_policies=[newMonitoringPolicy([],"temperature_limit")];
  change(card,"policies","policy-1","parameters:minimum",32);change(card,"policies","policy-1","parameters:maximum",77);
  change(card,"policies","policy-1","parameters:unit","°C");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].parameters,{unit:"°C",duration_seconds:0,minimum:0,maximum:25});
  assert.match(namedPolicies({...card,definitionSelection:{kind:"policies",id:"policy-1"}}),/data-definition-field="parameters:duration_seconds"[^>]*value="0"[^>]*required/);
});

for(const kind of ["methods"])test(`${kind} duplicate gets a stable new id and no assignments`,()=>{
  const {card}=fixture(),id="phone";
  click(card,"duplicate",kind,id);const copyId=card.definitionSelection.id;
  assert.notEqual(copyId,id);assert.deepEqual(definitionUses(card.settingsDraft,kind,copyId),[]);
  change(card,kind,copyId,"name","Renamed copy");assert.equal(card.settingsDraft.notification_definitions[kind][copyId].name,"Renamed copy");
});




test("presence fallback must be chosen explicitly and fixed methods have no fallback fields",()=>{
  const {card}=fixture();click(card,"add","methods");
  const id=card.definitionSelection.id,method=card.settingsDraft.notification_definitions.methods[id];
  assert.deepEqual(method,{name:"New delivery method",mode:"fixed",destinations:[]});
  change(card,"methods",id,"mode","home_away");
  assert.equal(method.skip,false);assert.deepEqual(method.fallback,[]);
  change(card,"methods",id,"fallback",true,{destination:"phone:owner"});
  change(card,"methods",id,"skip",true);assert.deepEqual(method.fallback,[]);
  change(card,"methods",id,"mode","fixed");assert.deepEqual(method,{name:"New delivery method",mode:"fixed",destinations:[]});
});

test("presence editing submits the catalog entity identity instead of its internal person id",async()=>{
  const {card,calls}=fixture();card.page="notifications";card.notificationSection="methods";card.definitionSelection={kind:"methods",id:"phone"};
  change(card,"methods","phone","mode","home_people");
  const html=namedNotifications(card),person=html.match(/data-person="([^"]+)"/)[1];
  assert.equal(person,"person.owner");assert.doesNotMatch(html,/data-person="owner-internal"/);
  change(card,"methods","phone","people",true,{person});
  change(card,"methods","phone",`person_destinations:${person}`,true,{destination:"phone:owner"});
  change(card,"methods","phone","skip",true);
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"}),true);
  const submitted=calls.find(request=>request.type==="homeostatic/save_settings").settings.notification_definitions.methods.phone;
  assert.deepEqual(submitted.people,["person.owner"]);
  assert.deepEqual(submitted.person_destinations,{"person.owner":["phone:owner"]});
});

test("SMS recipients are explicit and encoded without making a service request",()=>{
  const {card,calls}=fixture();
  card.main.querySelectorAll=()=>[{dataset:{smsMethod:"phone",smsField:"destinations",smsService:"sms:family:"},value:"+15551234567"}];
  click(card,"add-sms","methods","phone",{smsField:"destinations",smsService:"sms:family:"});
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.phone.destinations,["phone:owner","sms:family:%2B15551234567"]);
  assert.equal(calls.length,0);
});



test("saved method tests use an internal exact-target check with one user action",async()=>{
  const {card,calls}=fixture();card.definitionSelection={kind:"methods",id:"phone"};
  card._hass.callWS=async request=>{calls.push(request);return request.type.includes("preview_")?{preview_token:"bound-presence",targets:[{channel:"phone:owner",name:"Owner phone",available:true}],presence:{},skipped:false}:{requested:["phone:owner"],failed:[],skipped:false};};
  assert.match(namedNotifications(card),/>Send test</);assert.doesNotMatch(namedNotifications(card),/Preview delivery method/);
  await testDeliveryMethod(card,"phone");
  assert.deepEqual(calls[1],{type:"homeostatic/test_delivery_method",method_id:"phone",revision:"one",preview_token:"bound-presence"});
  assert.match(card.deliveryMethodNotice,/Owner phone/);
});

test("editing a saved method prevents test requests until it is saved",async()=>{
  const {card,calls}=fixture();change(card,"methods","phone","name","Changed");
  await testDeliveryMethod(card,"phone");assert.equal(calls.length,0);
});

test("Notifications offers named notifications and delivery methods without a second sending control",()=>{
  const {card}=fixture();card.definitionSelection={kind:"schedules",id:"morning"};
  const html=namedNotifications(card);
  assert.match(html,/Delivery methods/);assert.match(html,/Add notification/);assert.doesNotMatch(html,/Policy notifications/);assert.doesNotMatch(html,/Enable notifications/);
  assert.doesNotMatch(html,/>Schedules<|Default notification rows|Add schedule|data-definition-zone/);
});

test("source detail links name the actual contributing policy and opening retains drafts",()=>{
  const {card}=fixture(),source={node_id:"device:one",kind:"device"};
  card.sourceDetail={nodeId:source.node_id,monitoring_policies:[{id:"policy-1",name:"Hall thermostat"}]};
  assert.match(applicablePolicyLinks(card,source),/Hall thermostat/);
  const before=structuredClone(card.settingsDraft);click(card,"open-policy","policies","policy-1");
  assert.equal(card.page,"policies");assert.deepEqual(structuredClone(card.settingsDraft),before);
});

test("issue notification links open the named editor without discarding any draft",()=>{
  const {card}=fixture();card.detail={episodeId:"issue-one"};
  let closed=false;card.dialog={close(){closed=true;}};
  const before=structuredClone(card.settingsDraft);
  click(card,"open-notification","profiles","morning");
  assert.equal(card.page,"notifications");assert.equal(card.notificationSection,"profiles");
  assert.deepEqual(card.definitionSelection,{kind:"profiles",id:"morning"});
  assert.equal(card.detail,null);assert.equal(closed,true);
  assert.deepEqual(structuredClone(card.settingsDraft),before);
});



test("untrusted names and unavailable selected destinations render as text without being discarded",()=>{
  const {card}=fixture();card.settingsDraft.notification_definitions.methods.phone.name='<img src=x onerror=alert(1)>';
  card.settingsDraft.notification_definitions.methods.phone.destinations.push("notify:missing");
  card.notificationDefinitionTab="methods";card.definitionSelection={kind:"methods",id:"phone"};
  const html=namedNotifications(card);assert.doesNotMatch(html,/<img/);assert.match(html,/Saved destination unavailable/);
  assert.ok(card.settingsDraft.notification_definitions.methods.phone.destinations.includes("notify:missing"));
});




test("watch choices match monitoring capabilities",()=>{
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"integration"))),["all","all_except","selected"]);
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"repair"))),["all"]);
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"battery"))),["all","all_except","selected","area","label"]);
});

for(const type of ["integration","device","entity","battery","vacuum","thermostat","temperature_limit","ups_power","ups_reserve","ups_battery_replacement","ups_fault"])test(`${type} all-except scope never converts included sources into exclusions`,()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],type);
  card.settingsDraft.monitoring_policies=[policy];
  change(card,"policies",policy.id,"watch","selected");
  change(card,"policies",policy.id,"selection",true,{definitionValue:"previous-choice"});
  change(card,"policies",policy.id,"watch","all_except");
  assert.equal(watchMode(policy),"all_except");
  assert.deepEqual(Object.keys(policy.match),["kind"]);
  assert.deepEqual(policy.excluded_sources,[]);
  change(card,"policies",policy.id,"selection",true,{definitionValue:"excluded-source"});
  assert.deepEqual(policy.excluded_sources,["excluded-source"]);
  assert.deepEqual(Object.keys(policy.match),["kind"]);
  change(card,"policies",policy.id,"watch","selected");
  assert.equal(watchMode(policy),"selected");
  assert.equal(Object.hasOwn(policy,"excluded_sources"),false);
  assert.ok(Object.values(policy.match).some(values=>values.length===0));
});

test("integration exclusions identify individual connections while selected scope still uses families",()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],"integration");
  const rows=card.current.data.inventory.nodes;
  rows.push({node_id:"entry:mobile-one",kind:"integration",name:"First phone",attributes:{integration_domain:["mobile_app"]}});
  rows.push({node_id:"entry:mobile-two",kind:"integration",name:"Second phone",attributes:{integration_domain:["mobile_app"]}});
  assert.equal(policySelectionChoices(card,policy,"selected").filter(item=>item.id==="mobile_app").length,1);
  assert.deepEqual(policySelectionChoices(card,policy,"all_except").filter(item=>item.id.startsWith("entry:mobile-")).map(item=>item.id),["entry:mobile-one","entry:mobile-two"]);
});

test("clearing the final exclusion retains broad matching and permits saving",async()=>{
  const {card,calls}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  change(card,"policies",policy.id,"watch","all_except");
  change(card,"policies",policy.id,"selection",true,{definitionValue:"entity:registry:missing"});
  change(card,"policies",policy.id,"selection",false,{definitionValue:"entity:registry:missing"});
  assert.deepEqual(policy.excluded_sources,[]);
  assert.deepEqual(policy.match,{kind:["entity"]});
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:policy.id}),true);
  assert.equal(calls.some(call=>call.type==="homeostatic/save_settings"),true);
});

test("saved combined area scope keeps exclusions and does not imply all sources are included",()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],"battery");
  card.settingsDraft.monitoring_policies=[policy];
  policy.match={kind:["entity"],area:["kitchen"]};policy.excluded_sources=["entity:registry:standalone"];
  card.configuration.areas=[{id:"kitchen",name:"Kitchen"}];
  card.definitionSelection={kind:"policies",id:policy.id};
  const before=structuredClone(policy),html=namedPolicies(card);
  assert.equal(watchMode(policy),"area");
  assert.match(html,/data-watch-mode="area" value="area" checked/);
  assert.match(html,/This scope also excludes: Standalone switch/);
  assert.deepEqual(policy,before);
  change(card,"policies",policy.id,"name","Kitchen thermostat");
  assert.deepEqual(policy.excluded_sources,before.excluded_sources);
});

test("area picker groups names by floor and preserves multiple selections through search",()=>{
  const {card}=fixture();card.configuration.areas=[{id:"a",name:"Kitchen",floor_id:"main"},{id:"b",name:"Bedroom",floor_id:"upper"}];card.configuration.floors=[{id:"main",name:"Main floor"},{id:"upper",name:"Upstairs"}];
  card.definitionSelection={kind:"policies",id:"policy-1"};
  change(card,"policies","policy-1","watch","area");
  change(card,"policies","policy-1","selection",true,{definitionValue:"a"});change(card,"policies","policy-1","selection",true,{definitionValue:"b"});
  const policy=card.settingsDraft.monitoring_policies[0];
  assert.deepEqual(policy.match,{kind:["entity"],area:["a","b"]});
  click(card,"pick","policies",policy.id);
  assert.match(namedPolicies(card),/Main floor/);assert.match(namedPolicies(card),/Upstairs/);
  editReusable(card,{type:"input",target:{dataset:{definitionPickerSearch:""},value:"Kitchen"}});
  assert.deepEqual(policy.match.area,["a","b"]);assert.equal(card.policyPicker.query,"Kitchen");
  assert.match(namedPolicies(card),/2 selected/);assert.doesNotMatch(namedPolicies(card),/<legend>Upstairs/);
  click(card,"finish-pick","policies",policy.id);assert.match(namedPolicies(card),/Kitchen<\/span><span class="small">Main floor[\s\S]*Bedroom<\/span><span class="small">Upstairs/);
  change(card,"policies",policy.id,"watch","label");assert.deepEqual(policy.match,{kind:["entity"],label:[]});assert.equal(watchMode(policy),"label");
});

test("selective restoration preserves edits and deleted defaults remain absent until chosen",()=>{
  const {card}=fixture();const original=structuredClone(card.settingsDraft.monitoring_policies[0]);
  card.configuration.monitoring_policy_templates=[{...newMonitoringPolicy([],"battery"),id:"default_batteries"},{...newMonitoringPolicy([],"device"),id:"default_devices",enabled:true}];
  click(card,"restore","policies");
  editReusable(card,{type:"change",target:{dataset:{definitionRestore:"default_batteries"},checked:true}});
  click(card,"confirm-restore","policies");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0],original);
  assert.deepEqual(card.settingsDraft.monitoring_policies.map(policy=>policy.id),["policy-1","default_batteries"]);
  click(card,"delete","policies","default_batteries");click(card,"confirm-delete","policies","default_batteries");
  namedPolicies(card);assert.deepEqual(card.settingsDraft.monitoring_policies,[original]);
});

test("empty notification definitions have no schedule library and all source scopes",()=>{
  const definitions=emptyNotificationDefinitions();assert.equal(definitions.schedules,undefined);assert.deepEqual(definitions.automation_profiles,{});
});




test("unified problem detail renders policy actions and base source links without legacy exclusions",async()=>{
  const prototype=await cardPrototype();
  const {card}=fixture(),data=card.current.data;
  const source={node_id:"monitoring:policy-1:version:entity:registry:one",monitoring_source:"entity:registry:one",monitoring_policy:"policy-1",name:"Entity one",kind:"entity",entity_id:"sensor.one",attributes:{domain:["sensor"]},watched:true,requirements:[]};
  const episode={episode_id:"episode-one",anchor:source.node_id,opened_at:"2026-10-13T12:00:00Z",status:"fail"};
  data.inventory.episodes=[episode];data.inventory.nodes.push(source);
  const result={source,monitoring_policies:[{id:"policy-1",name:"Entity monitoring"}],explanation:{findings:[],nodes:[]},entity_status:[]};
  const body={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>({addEventListener(){}})};
  const detail={...card,detailSequence:0,detail:{episodeId:episode.episode_id},configuration:{...card.configuration,monitoring_policy_version:1},shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:{textContent:""}},displaySourceName:item=>item.name,tools:{maintenanceControls:()=>""},capturePageState:()=>({}),restorePageState:()=>{},_hass:{callWS:async()=>result}};
  detail.readDetail=()=>prototype.readDetail.call(detail);
  await prototype.loadDetail.call(detail);
  assert.match(body.innerHTML,/data-definition-action="open-policy"/);
  assert.match(body.innerHTML,/Hall thermostat/);
  assert.match(body.innerHTML,/>Open entity<\/button>/);
  assert.doesNotMatch(body.innerHTML,/View in Monitoring|<summary>Details<\/summary>/);
  assert.doesNotMatch(body.innerHTML,/data-ignore-availability|Stop checking/);

});

test("integration picker lists families once and stores domain selection",()=>{
  const {card}=fixture();
  card.current.data.inventory.catalog.candidates.push(
    {node_id:"entry:phone1",kind:"integration",name:"One phone",attributes:{kind:["integration"],integration:["phone1"],integration_domain:["mobile_app"]}},
    {node_id:"entry:phone2",kind:"integration",name:"Other phone",attributes:{kind:["integration"],integration:["phone2"],integration_domain:["mobile_app"]}}
  );
  const policy=newMonitoringPolicy([],"integration");card.settingsDraft.monitoring_policies=[policy];card.definitionSelection={kind:"policies",id:policy.id};
  const choices=policySelectionChoices(card,policy,"selected");
  assert.equal(choices.filter(item=>item.id==="mobile_app").length,1);
  assert.equal(choices.find(item=>item.id==="mobile_app").name,"Mobile App");
  change(card,"policies",policy.id,"watch","selected");click(card,"pick","policies",policy.id);
  assert.match(namedPolicies(card),/Choose integrations/);assert.match(namedPolicies(card),/<legend class="sr-only">Integrations/);
  assert.doesNotMatch(namedPolicies(card),/One phone|Other phone|Choose sources/);
  change(card,"policies",policy.id,"selection",true,{definitionValue:"mobile_app"});
  assert.deepEqual(policy.match,{kind:["integration"],integration_domain:["mobile_app"]});
});

for(const [type,text] of [["repair","Watches all Home Assistant Repairs"],["broken_automation","Checks all automations for references"]])test(`${type} has scope text without a one-choice selector`,()=>{
  const {card}=fixture();const policy=newMonitoringPolicy([],type);card.settingsDraft.monitoring_policies=[policy];card.definitionSelection={kind:"policies",id:policy.id};
  const html=namedPolicies(card);assert.ok(html.includes(text));
  assert.doesNotMatch(html,/data-definition-field="watch"|When it becomes a problem|data-definition-field="check"/);
});





for(const enabled of [true,false])test(`enabled policy draft from ${enabled?"on":"off"} leaves list state saved until scoped save`,async()=>{
  const {card,calls}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.enabled=enabled;card.configuration.settings.monitoring_policies[0].enabled=enabled;
  assert.doesNotMatch(namedPolicies(card),/data-definition-action="toggle"/);
  click(card,"edit","policies",policy.id);
  change(card,"policies",policy.id,"enabled",!enabled);
  click(card,"close","policies",policy.id);
  assert.match(namedPolicies(card),new RegExp(`<span class="small">${enabled?"On":"Off"}</span>`));
  assert.match(namedPolicies(card),/Unsaved changes/);assert.equal(calls.length,0);
  await saveScopedConfiguration(card,{kind:"policy",id:policy.id});
  assert.match(namedPolicies(card),new RegExp(`<span class="small">${enabled?"Off":"On"}</span>`));
  assert.doesNotMatch(namedPolicies(card),/Unsaved changes/);
});

test("a new policy is not presented as a saved on or off choice",()=>{
  const {card}=fixture();
  card.settingsDraft.monitoring_policies.push(newMonitoringPolicy(card.settingsDraft.monitoring_policies,"battery"));
  assert.match(namedPolicies(card),/<h3>Low battery <span class="small">Not saved<\/span>/);
  change(card,"policies","policy-2","enabled",true);
  assert.match(namedPolicies(card),/Not saved<\/span>[\s\S]*Unsaved changes/);
});

test("policy overflow names are escaped and actions retain the policy identity without staging edits",()=>{
  const {card,calls}=fixture();
  card.settingsDraft.monitoring_policies[0].name='<House> "policy"';
  card.configuration.settings.monitoring_policies[0].name='<House> "policy"';
  const before=structuredClone(card.settingsDraft),html=namedPolicies(card);
  assert.match(html,/aria-label="More actions for &lt;House&gt; &quot;policy&quot;"/);
  assert.match(html,/popovertarget="policy-actions-policy-1"/);
  assert.match(html,/<div id="policy-actions-policy-1" class="policy-actions-popover" popover role="group"[^>]*><button[^>]*data-definition-action="duplicate"[^>]*data-definition-id="policy-1"[^>]*>Duplicate<\/button><button[^>]*data-definition-action="delete"[^>]*data-definition-id="policy-1"/);
  assert.deepEqual(card.settingsDraft,before);
  assert.equal(calls.length,0);
});


test("clean policy and method editors have no save footer and discard stays in the existing editor",()=>{
  const {card,calls}=fixture();
  click(card,"edit","policies","policy-1");
  assert.match(namedPolicies(card),/<h1>Hall thermostat<\/h1>/);
  assert.doesNotMatch(namedPolicies(card),/<footer|>Save policy<|>Discard changes<|>Cancel<|No changes/);
  change(card,"policies","policy-1","name","Changed policy");
  assert.match(namedPolicies(card),/>Save policy</);assert.match(namedPolicies(card),/>Discard changes</);
  click(card,"discard-scoped","policies","policy-1");
  assert.deepEqual(card.definitionSelection,{kind:"policies",id:"policy-1"});
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Hall thermostat");
  assert.doesNotMatch(namedPolicies(card),/<footer/);
  card.page="notifications";click(card,"edit","methods","phone");
  assert.doesNotMatch(installationSettings(card),/<footer|>Save delivery method<|>Cancel<|No changes/);
  change(card,"methods","phone","name","Changed method");
  assert.match(installationSettings(card),/>Save delivery method</);
  click(card,"discard-scoped","methods","phone");
  assert.deepEqual(card.definitionSelection,{kind:"methods",id:"phone"});
  assert.doesNotMatch(installationSettings(card),/<footer/);assert.equal(calls.length,0);
});




test("new policy discard abandons it without saving an empty policy",()=>{
  const {card,calls}=fixture();click(card,"create","policies");const id=card.definitionSelection.id;
  assert.match(namedPolicies(card),/>Save policy</);
  click(card,"discard-scoped","policies",id);
  assert.equal(card.definitionSelection,null);assert.equal(card.settingsDraft.monitoring_policies.some(policy=>policy.id===id),false);
  assert.equal(calls.length,0);
});

test("save control rejects empty exact selections before making a request",()=>{
  const {card,calls}=fixture();click(card,"edit","policies","policy-1");
  change(card,"policies","policy-1","watch","area");click(card,"save-scoped","policies","policy-1");
  assert.equal(calls.length,0);assert.match(card.scopedError,/Choose at least one/);
  assert.match(namedPolicies(card),/role="alert"/);
});



function batteryPicker({loaded=true,stale=false,error=null}={}) {
  const {card,calls}=fixture(),policy={...newMonitoringPolicy([],"battery"),excluded_sources:["battery:registry:phone"]};
  const battery={node_id:"battery:registry:phone",name:"Owner phone",kind:"battery",
    entity_id:"sensor.owner_phone_battery",attributes:{kind:["battery"],entity:["registry:phone"]}};
  card.settingsDraft.monitoring_policies=[policy];
  card.configuration.settings.monitoring_policies=structuredClone([policy]);
  card.definitionSelection={kind:"policies",id:policy.id};
  card.current={status:"current",catalogError:error,data:{...card.current.data,schema_version:3,catalog_loaded:loaded,catalog_stale:stale,
    inventory:{...card.current.data.inventory,nodes:[],catalog:{candidates:loaded?[battery]:[]}}}};
  click(card,"pick","policies",policy.id);
  return {card,policy,calls,battery};
}

test("battery scope waits for complete choices and keeps exclusions when loading fails",()=>{
  const {card,policy}=batteryPicker({loaded:false}),before=structuredClone(card.settingsDraft);
  const loading=namedPolicies(card);
  assert.match(loading,/Loading available sources/);
  assert.match(loading,/1 excluded/);
  assert.doesNotMatch(loading,/No matching choices|Unavailable excluded source|data-definition-value=/);
  card.current.catalogError="Could not read <catalog>";
  const failed=namedPolicies(card);
  assert.match(failed,/Could not load available sources: Could not read &lt;catalog&gt;/);
  assert.match(failed,/data-action="retry-catalog"/);
  assert.doesNotMatch(failed,/No matching choices|Unavailable excluded source/);
  assert.deepEqual(card.settingsDraft,before);
  assert.deepEqual(policy.excluded_sources,["battery:registry:phone"]);
});

test("battery picker searches entity IDs as well as names without changing exclusions",()=>{
  const {card,policy,calls}=batteryPicker(),before=structuredClone(policy);
  editReusable(card,{type:"input",target:{dataset:{definitionPickerSearch:""},value:" Batt "}});
  const html=namedPolicies(card);
  assert.match(html,/Owner phone/);
  assert.match(html,/data-definition-value="battery:registry:phone" checked/);
  assert.doesNotMatch(html,/No matching choices/);
  editReusable(card,{type:"input",target:{dataset:{definitionPickerSearch:""},value:"No such reading"}});
  assert.match(namedPolicies(card),/No batteries match your search/);
  assert.deepEqual(policy,before);assert.deepEqual(calls,[]);
});

test("catalog arrival fills an open picker and preserves its current search and selections",()=>{
  const {card,policy,battery}=batteryPicker({loaded:false});
  card.policyPicker.query="Batt";card.policyPicker.selectedOnly=true;
  const before=structuredClone(policy);
  card.current={...card.current,catalogError:null,data:{...card.current.data,catalog_loaded:true,
    inventory:{...card.current.data.inventory,nodes:[],catalog:{candidates:[battery]}}}};
  const html=namedPolicies(card);
  assert.match(html,/data-definition-value="battery:registry:phone" checked/);
  assert.doesNotMatch(html,/Loading available sources|No matching choices/);
  assert.deepEqual(card.policyPicker,{id:policy.id,query:"Batt",selectedOnly:true,showAll:false});
  assert.deepEqual(policy,before);
});

test("stale policy choices remain usable while refresh errors are explicit",()=>{
  const {card,policy}=batteryPicker({stale:true}),before=structuredClone(policy);
  assert.match(namedPolicies(card),/Updating available sources/);
  card.current.catalogError="Update failed";
  const html=namedPolicies(card);
  assert.match(html,/Could not update available sources: Update failed/);
  assert.match(html,/data-action="retry-catalog"/);
  assert.match(html,/data-definition-value="battery:registry:phone" checked/);
  assert.deepEqual(policy,before);
});

test("direct Policies entry requests its catalog and retries through the existing store",async()=>{
  const prototype=await cardPrototype(),{card}=batteryPicker({loaded:false}),requests=[];
  const shadowNode={};
  Object.assign(card,{config:{view:"policies"},navigation:{updateReturn(){}},viewIdentity:()=>"policies",
    capturePageState:()=>null,renderNotificationControl(){},observeSourceBranches(){},
    shadowRoot:{querySelector:()=>shadowNode,querySelectorAll:()=>[]},
    main:{innerHTML:"",querySelector:()=>null,querySelectorAll:()=>[]},
    policiesPage:()=>namedPolicies(card),store:{ensureCatalog(retry=false){requests.push(retry);}}});
  const before=structuredClone(card.settingsDraft);
  prototype.renderPage.call(card);
  assert.deepEqual(requests,[false]);
  assert.match(card.main.innerHTML,/Loading available sources/);
  const target={dataset:{action:"retry-catalog"},closest(selector){return selector==="button"?this:null;}};
  prototype.handleClick.call(card,{type:"click",target});
  assert.deepEqual(requests,[false,true]);
  assert.deepEqual(card.settingsDraft,before);
});

test("policy and method editors keep controls without repeated setup instructions",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.notifications=[];card.definitionSelection={kind:"policies",id:policy.id};
  const html=namedPolicies(card);
  assert.match(html,/No notifications/);
  assert.doesNotMatch(html,/Manage named notifications/);
  assert.doesNotMatch(html,/data-row-field="timing:/);
  card.page="notifications";card.definitionSelection={kind:"methods",id:"phone"};card.notificationSection="methods";
  const method=namedNotifications(card);
  assert.match(method,/<h1>Edit delivery method: Owner phone<\/h1>/);
  assert.match(method,/class="button editor-back"[^>]*data-definition-action="close-method"/);
  assert.match(method,/<legend>Send to/);
  assert.doesNotMatch(method,/Timing and reminders are set|Choose the destinations this method sends to/);
});

for(const type of ["device","integration","entity","vacuum","ups_power","ups_reserve","ups_battery_replacement","ups_fault"])test(`${type} omits an empty detection section`,()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],type);
  card.settingsDraft.monitoring_policies=[policy];card.definitionSelection={kind:"policies",id:policy.id};
  const before=structuredClone(policy),html=namedPolicies(card);
  assert.doesNotMatch(html,/When it becomes a problem|Uses the reported Home Assistant state/);
  assert.match(html,/data-definition-field="enabled"/);
  assert.deepEqual(policy,before);
});

test("compact policy scopes retain missing selections and all numeric detection fields",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.match={kind:["entity"],area:["hall","kitchen","missing"]};
  card.configuration.areas=[{id:"hall",name:"Hall"},{id:"kitchen",name:"Kitchen"}];
  card.configuration.settings.monitoring_policies=structuredClone(card.settingsDraft.monitoring_policies);
  const before=structuredClone(policy),list=namedPolicies(card);
  assert.match(list,/Areas: Hall, Kitchen \+1 more · 1 unavailable/);
  assert.match(list,/2°F deviation · 60 minute progress window/);
  assert.match(list,/Custom notification · Immediately → Owner phone/);
  click(card,"edit","policies",policy.id);click(card,"pick","policies",policy.id);
  const editor=namedPolicies(card);
  assert.match(editor,/data-definition-value="missing" checked>[\s\S]*?Unavailable selection/);
  for(const field of ["margin","progress","worsening","progress_seconds"])assert.ok(editor.includes(`data-definition-field="parameters:${field}"`));
  assert.deepEqual(policy,before);
});

test("method lists compact uses and destinations while editors retain every assignment",()=>{
  const {card}=fixture();card.notificationSection="methods";
  card.configuration.settings.notification_definitions.methods.phone.destinations=["phone:owner","notify:email","notify:missing"];
  card.settingsDraft.notification_definitions.methods.phone=structuredClone(card.configuration.settings.notification_definitions.methods.phone);
  const before=structuredClone(card.settingsDraft),list=namedNotifications(card);
  assert.match(list,/Owner&#39;s phone, Email \+1 more · 1 unavailable/);
  assert.match(list,/>3 uses</);
  assert.doesNotMatch(list,/Used by Hall thermostat|Default reporting|Automation profile/);
  click(card,"edit","methods","phone");
  const editor=namedNotifications(card);
  assert.match(editor,/Used by Hall thermostat, Default reporting, Automation profile · immediate/);
  assert.match(editor,/notify:missing[\s\S]*Saved destination unavailable/);
  assert.deepEqual(card.settingsDraft,before);
});

test("method list omits only a single available destination repeating its name",()=>{
  const {card}=fixture();card.notificationSection="methods";
  const method=card.configuration.settings.notification_definitions.methods.phone,target=card.configuration.delivery_targets[0];
  target.name=method.name;
  assert.match(namedNotifications(card),/<h3>Owner phone<\/h3><p class="small">3 uses<\/p>/);
  target.available=false;
  assert.match(namedNotifications(card),/<p class="method-summary">Owner phone · 1 unavailable<\/p>/);
  target.available=true;target.name="Kitchen phone";
  assert.match(namedNotifications(card),/<p class="method-summary">Kitchen phone<\/p>/);
  target.name=method.name;method.destinations.push("notify:email");
  assert.match(namedNotifications(card),/<p class="method-summary">Owner phone, Email<\/p>/);
});

for(const [label,viewport,rect,expectedTop] of [
  ["space below",{offsetTop:0,offsetLeft:0,height:844,width:390},{top:100,bottom:140,right:370},144],
  ["space above keyboard",{offsetTop:250,offsetLeft:0,height:400,width:390},{top:560,bottom:600,right:370},416],
])test(`native policy menu uses its measured height within the ${label} viewport`,()=>{
  const {card}=fixture(),previous=globalThis.window;
  const menu={style:{},matches:()=>true,getBoundingClientRect:()=>({width:220,height:140}),hidePopover(){}};
  const target={dataset:{definitionAction:"policy-actions"},popoverTargetElement:menu,
    getBoundingClientRect:()=>rect,closest(){return this;},focus(){}};
  globalThis.window={innerHeight:844,innerWidth:390,visualViewport:viewport,requestAnimationFrame:callback=>callback()};
  try {
    assert.equal(editReusable(card,{type:"click",target}),true);
    menu.ontoggle({newState:"open"});
    assert.equal(menu.style.top,`${expectedTop}px`);
    assert.equal(menu.style.left,"150px");
    assert.equal(menu.style.maxHeight,`${viewport.height-16}px`);
  } finally {globalThis.window=previous;}
});

test("saved summary timing shows the library forecast in the configured timezone",()=>{
  const {card}=fixture();
  card.definitionSelection={kind:"policies",id:"policy-1"};
  card.current.data.policy.reports=[{name:"entry:policy_policy-1_report",next_at:"2026-10-15T13:00:00Z"}];
  const html=namedPolicies(card);
  assert.match(html,/Next summary: .*8:00.*America\/Chicago/);
  assert.doesNotMatch(html,/Next summary time is available after saving/);
});

test("edited or new summary timing never borrows a saved forecast",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  card.definitionSelection={kind:"policies",id:policy.id};
  card.current.data.policy.reports=[{name:"entry:policy_policy-1_report",next_at:"2026-10-15T13:00:00Z"}];
  policy.notifications[1].timing.at="09:00";
  assert.match(namedPolicies(card),/Next summary time is available after saving this schedule/);
  assert.doesNotMatch(namedPolicies(card),/Next summary:/);
  policy.notifications[1].timing.at="08:00";policy.notifications[1].id="new-report";
  assert.match(namedPolicies(card),/Next summary time is available after saving this schedule/);
  assert.doesNotMatch(namedPolicies(card),/Next summary:/);
});

for(const [name,enabled,reports] of [
  ["missing",true,[]],
  ["unmatched",true,[{name:"another-policy",next_at:"2026-10-15T13:00:00Z"}]],
  ["disabled",false,[{name:"entry:policy_policy-1_report",next_at:"2026-10-15T13:00:00Z"}]],
])test(`${name} summary forecast is described without inventing an occurrence`,()=>{
  const {card}=fixture();
  card.definitionSelection={kind:"policies",id:"policy-1"};
  card.settingsDraft.monitoring_policies[0].enabled=enabled;
  card.configuration.settings.monitoring_policies[0].enabled=enabled;
  card.current.data.policy.reports=reports;
  assert.match(namedPolicies(card),/No summary is currently scheduled for this policy/);
  assert.doesNotMatch(namedPolicies(card),/Next summary:/);
});

for(const [name,savedEnabled,draftEnabled] of [
  ["on to off",true,false],
  ["off to on",false,true],
])test(`unsaved policy change ${name} does not describe draft summary scheduling as current`,()=>{
  const {card}=fixture();
  card.definitionSelection={kind:"policies",id:"policy-1"};
  card.configuration.settings.monitoring_policies[0].enabled=savedEnabled;
  card.settingsDraft.monitoring_policies[0].enabled=draftEnabled;
  card.current.data.policy.reports=[{name:"entry:policy_policy-1_report",next_at:"2026-10-15T13:00:00Z"}];
  const html=namedPolicies(card);
  assert.match(html,/Summary scheduling changes after you save this policy/);
  assert.doesNotMatch(html,/Next summary:|No summary is currently scheduled/);
  assert.equal(card.configuration.settings.monitoring_policies[0].enabled,savedEnabled);
});
