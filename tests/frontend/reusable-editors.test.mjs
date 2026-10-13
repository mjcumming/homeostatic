import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions,newMonitoringPolicy,namedPolicies,namedNotifications,editReusable,definitionUses,deleteNotificationDefinition,reusableChanges,sourceNotificationDefinitions,applicablePolicyLinks,previewDeliveryMethod,testDeliveryMethod} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {sourceSettingsProposal,sourceSettingsReviewed,previewSourceSettings,saveSourceSettings} from "../../custom_components/homeostatic/frontend/source-settings.mjs";
import {installationSettings} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";

function fixture() {
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Owner phone",mode:"fixed",destinations:["phone:owner"]};
  definitions.methods.email={name:"Household email",mode:"fixed",destinations:["notify:email"]};
  definitions.default=[{id:"default",schedule:"morning",methods:["phone"]}];
  definitions.automation_profiles={immediate:[{id:"auto",schedule:"immediate",methods:["phone"]}]};
  const policy={...newMonitoringPolicy([],"thermostat"),name:"Hall thermostat",enabled:true,notifications:[{id:"phone",schedule:"immediate",methods:["phone"]},{id:"report",schedule:"morning",methods:["email"]}]};
  const settings={notification_definitions:definitions,monitoring_policies:[policy],timings:{},notifications:false,consumer:null,reporting:null,simple_notifications:null,policy:{timezone:"America/Chicago",recipients:{},rules:[]}};
  const calls=[];
  const card={page:"policies",current:{status:"current",data:monitoringExample()},configuration:{revision:"one",rules:[],settings:structuredClone(settings),notification_people:[{id:"person.owner",name:"Owner"}],delivery_targets:[{channel:"phone:owner",name:"Owner's phone",type:"App",available:true},{channel:"notify:email",name:"Email",type:"Email",available:true},{channel:"satellite:kitchen",name:"Kitchen voice",type:"Voice",available:true},{channel:"sms:family:",name:"Family SMS",type:"SMS",requires_target:true}]},configDraft:[],settingsDraft:settings,main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){},async loadConfiguration(){this.configuration={...this.configuration,settings:structuredClone(this.settingsDraft),rules:structuredClone(this.configDraft),revision:"two"};this.sourceSettingsReview=null;},_hass:{async callWS(request){calls.push(structuredClone(request));return {preview_token:"exact",open_problems:1,requests_now:0,monitoring:{watched:1,added:[],removed:[],added_count:0,removed_count:0,functions:[],ended_issues:["issue-1"]}};}}};
  return {card,calls};
}
function click(card,action,kind="",id="",extra={}) {
  const target={dataset:{definitionAction:action,definitionKind:kind,definitionId:id,...extra},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}
function change(card,kind,id,field,value,extra={}) {
  const target={dataset:{definitionKind:kind,definitionId:id,definitionField:field,...extra},type:typeof value==="boolean"?"checkbox":typeof value==="number"?"number":"text",value:String(value),checked:value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}

test("rendering policies, definitions and setup does not stage changes or send requests",()=>{
  const {card,calls}=fixture(),before=sourceSettingsProposal(card);
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.match(namedPolicies(card),/Thermostat progress/);
  card.page="notifications";
  assert.match(installationSettings(card),/Delivery methods/);
  assert.deepEqual(sourceSettingsProposal(card),before);assert.equal(calls.length,0);
  card.settingsDraft.notification_definitions=null;
  assert.match(namedNotifications(card),/Start reusable schedules/);
  assert.equal(card.settingsDraft.notification_definitions,null);
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

test("a thermostat template uses immediate delivery with already-selected household methods",()=>{
  const {card}=fixture();card.definitionTemplate="thermostat";click(card,"add","policies");
  assert.deepEqual(card.settingsDraft.monitoring_policies[1].notifications,[{id:"notification-1",schedule:"immediate",methods:["phone"]}]);
  assert.equal(card.settingsDraft.monitoring_policies[1].enabled,false);
  assert.equal(card.settingsDraft.notifications,false);
});

test("new thermostat notification identity does not collide with a default row",()=>{
  const {card}=fixture();
  card.settingsDraft.notification_definitions.default[0].id="notification-1";
  card.definitionTemplate="thermostat";click(card,"add","policies");
  assert.equal(card.settingsDraft.monitoring_policies[1].notifications[0].id,"notification-2");
});

test("editing an exact source remains owned by the named policy and invalidates review",()=>{
  const {card}=fixture();card.sourceSettingsReview={};card.settingsPreview={};
  change(card,"policies","policy-1","match:entity","climate.hall, climate.garage");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].match.entity,["climate.hall","climate.garage"]);
  assert.deepEqual(card.configDraft,[]);assert.equal(card.sourceSettingsReview,null);assert.equal(card.settingsPreview,null);
});

test("thermostat unit edits convert differences without applying a temperature offset",()=>{
  const {card}=fixture();change(card,"policies","policy-1","parameters:unit","°C");
  const values=card.settingsDraft.monitoring_policies[0].parameters;
  assert.equal(values.margin,10/9);assert.equal(values.progress,10/9);assert.equal(values.worsening,10/9);
  assert.equal(values.progress_seconds,3600);
  change(card,"policies","policy-1","parameters:unit","°F");assert.equal(values.margin,2);
});

test("temperature limit unit edits preserve absolute bounds",()=>{
  const {card}=fixture();change(card,"policies","policy-1","check","temperature_limit");
  change(card,"policies","policy-1","parameters:minimum",32);change(card,"policies","policy-1","parameters:maximum",77);
  change(card,"policies","policy-1","parameters:unit","°C");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].parameters,{unit:"°C",minimum:0,maximum:25});
  assert.match(namedPolicies({...card,definitionSelection:{kind:"policies",id:"policy-1"}}),/data-definition-field="parameters:duration_seconds"[^>]*value=""[^>]*required/);
});

for(const kind of ["schedules","methods"])test(`${kind} duplicate gets a stable new id and no assignments`,()=>{
  const {card}=fixture(),id=kind==="schedules"?"immediate":"phone";
  click(card,"duplicate",kind,id);const copyId=card.definitionSelection.id;
  assert.notEqual(copyId,id);assert.deepEqual(definitionUses(card.settingsDraft,kind,copyId),[]);
  change(card,kind,copyId,"name","Renamed copy");assert.equal(card.settingsDraft.notification_definitions[kind][copyId].name,"Renamed copy");
});

test("schedule mode edits retain identity and remove incompatible timing fields",()=>{
  const {card}=fixture();change(card,"schedules","morning","mode","acknowledge");
  assert.deepEqual(card.settingsDraft.notification_definitions.schedules.morning,{name:"Morning report",mode:"acknowledge",remind_every:1800});
  assert.equal(card.settingsDraft.notification_definitions.default[0].schedule,"morning");
});

test("deleting an assigned definition demands replacement or explicit row removal",()=>{
  const {card}=fixture(),draft=card.settingsDraft;
  assert.throws(()=>deleteNotificationDefinition(draft,"methods","phone",""),/replacement/);
  assert.ok(draft.notification_definitions.methods.phone);
  deleteNotificationDefinition(draft,"methods","phone","email");
  assert.deepEqual(draft.monitoring_policies[0].notifications[0].methods,["email"]);
  assert.deepEqual(draft.notification_definitions.default[0].methods,["email"]);
  assert.deepEqual(draft.notification_definitions.automation_profiles.immediate[0].methods,["email"]);
});

test("explicit removal deletes affected rows but leaves monitoring and unrelated rows intact",()=>{
  const {card}=fixture();deleteNotificationDefinition(card.settingsDraft,"schedules","immediate","remove-rows");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[{id:"report",schedule:"morning",methods:["email"]}]);
  assert.equal(card.settingsDraft.monitoring_policies[0].enabled,true);
});

test("replacement covers source default and condition exceptions without duplicating methods",()=>{
  const {card}=fixture(),definitions=card.settingsDraft.notification_definitions;
  definitions.assignments["device:one"]={default:[{id:"one",schedule:"immediate",methods:["phone","email"]}],checks:{battery:[{id:"battery",schedule:"morning",methods:["phone"]}]}};
  deleteNotificationDefinition(card.settingsDraft,"methods","phone","email");
  assert.deepEqual(definitions.assignments["device:one"].default[0].methods,["email"]);
  assert.deepEqual(definitions.assignments["device:one"].checks.battery[0].methods,["email"]);
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

test("home-person destinations keep person ids containing periods intact",()=>{
  const {card}=fixture();change(card,"methods","phone","mode","home_people");
  change(card,"methods","phone","people",true,{person:"person.owner"});
  change(card,"methods","phone","person_destinations:person.owner",true,{destination:"phone:owner"});
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.phone.person_destinations,{"person.owner":["phone:owner"]});
});

test("SMS recipients are explicit and encoded without making a service request",()=>{
  const {card,calls}=fixture();
  card.main.querySelectorAll=()=>[{dataset:{smsMethod:"phone",smsField:"destinations",smsService:"sms:family:"},value:"+15551234567"}];
  click(card,"add-sms","methods","phone",{smsField:"destinations",smsService:"sms:family:"});
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.phone.destinations,["phone:owner","sms:family:%2B15551234567"]);
  assert.equal(calls.length,0);
});

test("source overrides are independent copies and removing them restores inheritance",()=>{
  const {card}=fixture(),scope='source:["device:one",""]';
  click(card,"override-rows","","",{rowScope:scope});
  assert.notEqual(card.settingsDraft.notification_definitions.assignments["device:one"].default[0].id,card.settingsDraft.notification_definitions.default[0].id);
  card.settingsDraft.notification_definitions.assignments["device:one"].default[0].schedule="weekly";
  assert.equal(card.settingsDraft.notification_definitions.default[0].schedule,"morning");
  click(card,"inherit-rows","","",{rowScope:scope});
  assert.equal(card.settingsDraft.notification_definitions.assignments["device:one"].default,undefined);
});

test("notification rows have globally independent ids and shared legacy pairings detach on edit",()=>{
  const {card}=fixture(),defs=card.settingsDraft.notification_definitions;
  click(card,"add-row","","",{rowScope:"repairs"});
  click(card,"add-row","","",{rowScope:"broken_automations"});
  assert.notEqual(defs.repairs[0].id,defs.broken_automations[0].id);
  defs.repairs=structuredClone(defs.default);
  const target={dataset:{rowScope:"repairs",rowId:"default",rowField:"schedule"},value:"weekly"};
  editReusable(card,{type:"change",target});
  assert.equal(defs.default[0].schedule,"morning");assert.notEqual(defs.repairs[0].id,"default");
});

test("method preview sends nothing until exact saved destinations are explicitly tested",async()=>{
  const {card,calls}=fixture();
  card._hass.callWS=async request=>{
    calls.push(request);
    return request.type==="homeostatic/preview_delivery_method"?{method_id:"phone",name:"Owner phone",targets:[{channel:"phone:owner",name:"Owner's phone",type:"App",available:true}],presence:{},skipped:false,preview_token:"bound-presence"}:{requested:["phone:owner"],failed:[],skipped:false};
  };
  card.notificationDefinitionTab="methods";card.definitionSelection={kind:"methods",id:"phone"};
  await previewDeliveryMethod(card,"phone");assert.equal(calls.length,1);
  assert.match(namedNotifications(card),/Send test to these destinations/);
  await testDeliveryMethod(card,"phone");
  assert.deepEqual(calls[1],{type:"homeostatic/test_delivery_method",method_id:"phone",revision:"one",preview_token:"bound-presence"});
  assert.equal(card.deliveryMethodNotice,"1 test message requests; 0 failed requests.");
  assert.equal(card.deliveryMethodReview,null);
});

test("editing or changing revision after a method preview prevents test requests",async()=>{
  const {card,calls}=fixture();
  card.deliveryMethodReview={method_id:"phone",revision:"one",preview_token:"old"};
  change(card,"methods","phone","name","Changed");
  await testDeliveryMethod(card,"phone");assert.equal(calls.length,0);
  card.settingsDraft=structuredClone(card.configuration.settings);card.configuration.revision="two";
  await testDeliveryMethod(card,"phone");assert.equal(calls.length,0);
});

test("schedule forecast uses server times and distinguishes unsaved edits",()=>{
  const {card}=fixture();card.definitionSelection={kind:"schedules",id:"morning"};
  card.current.data.policy.reports=[{name:"schedule:morning:default",next_at:"2026-10-13T13:00:00+00:00",episodes:[]}];
  assert.match(namedNotifications(card),/Next scheduled time:/);
  change(card,"schedules","morning","at","09:00");
  assert.match(namedNotifications(card),/Review changes to see the next scheduled time/);
  card.sourceSettingsReview={result:{reports:[{name:"schedule:morning:default",next_at:"2026-10-13T14:00:00+00:00",episodes:[]}]}};
  assert.match(namedNotifications(card),/After saving, next scheduled time:/);
});

test("source detail links name the actual contributing policy and opening retains drafts",()=>{
  const {card}=fixture(),source={node_id:"device:one",kind:"device"};
  card.sourceDetail={nodeId:source.node_id,monitoring_policies:[{id:"policy-1",name:"Hall thermostat"}]};
  assert.match(applicablePolicyLinks(card,source),/Hall thermostat/);
  assert.match(sourceNotificationDefinitions(card,source),/Choose notification rows/);
  const before=sourceSettingsProposal(card);click(card,"open-policy","policies","policy-1");
  assert.equal(card.page,"policies");assert.deepEqual(sourceSettingsProposal(card),before);
});

test("review sends the entire draft and navigation does not permit saving a changed definition",async()=>{
  const {card,calls}=fixture();card.configDraft.push({id:"all",action:"attach",match:{kind:["device"]},checks:["availability"]});
  await previewSourceSettings(card);
  assert.deepEqual(calls[0].settings,sourceSettingsProposal(card));
  assert.deepEqual(calls[0].settings.notification_definitions.automation_profiles,card.settingsDraft.notification_definitions.automation_profiles);
  card.page="notifications";click(card,"tab","methods");assert.ok(sourceSettingsReviewed(card));
  change(card,"methods","phone","name","Renamed phone");await saveSourceSettings(card);assert.equal(calls.length,1);
  await previewSourceSettings(card);await saveSourceSettings(card);assert.equal(calls.length,3);
  assert.equal(calls[2].preview_token,"exact");assert.deepEqual(calls[2].settings,calls[1].settings);
});

test("review distinguishes detection reset from observed recovery and shared definition edits",()=>{
  const {card}=fixture();change(card,"policies","policy-1","parameters:margin",3);change(card,"methods","phone","name","New phone name");
  const changes=reusableChanges(card.configuration.settings,card.settingsDraft);
  assert.match(changes[0][2],/existing alerts end and qualification restarts/);
  assert.match(changes.find(row=>row[0]==="New phone name")[2],/Hall thermostat/);
});

test("untrusted names and unavailable selected destinations render as text without being discarded",()=>{
  const {card}=fixture();card.settingsDraft.notification_definitions.methods.phone.name='<img src=x onerror=alert(1)>';
  card.settingsDraft.notification_definitions.methods.phone.destinations.push("notify:missing");
  card.notificationDefinitionTab="methods";card.definitionSelection={kind:"methods",id:"phone"};
  const html=namedNotifications(card);assert.doesNotMatch(html,/<img/);assert.match(html,/Saved destination unavailable/);
  assert.ok(card.settingsDraft.notification_definitions.methods.phone.destinations.includes("notify:missing"));
});
