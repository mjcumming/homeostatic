import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions,newMonitoringPolicy,namedPolicies,namedNotifications,editReusable,definitionUses,deleteNotificationDefinition,reusableChanges,sourceNotificationDefinitions,applicablePolicyLinks,previewDeliveryMethod,testDeliveryMethod,watchChoices,watchMode,policySelectionChoices} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {sourceSettingsProposal,sourceSettingsReviewed,previewSourceSettings,saveSourceSettings} from "../../custom_components/homeostatic/frontend/source-settings.mjs";
import {installationSettings} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {sourceMonitoringChoices} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {integrationSettings} from "../../custom_components/homeostatic/frontend/source-settings.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";

function fixture() {
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Owner phone",mode:"fixed",destinations:["phone:owner"]};
  definitions.methods.email={name:"Household email",mode:"fixed",destinations:["notify:email"]};
  definitions.default=[{id:"default",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]}];
  definitions.automation_profiles={immediate:[{id:"auto",timing:{mode:"immediate"},methods:["phone"]}]};
  const policy={...newMonitoringPolicy([],"thermostat"),name:"Hall thermostat",enabled:true,notifications:[{id:"phone",timing:{mode:"immediate"},methods:["phone"]},{id:"report",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["email"]}]};
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
  assert.match(namedNotifications(card),/Set up delivery methods/);
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

test("new notification identities avoid collisions and store owned timing",()=>{
  const {card}=fixture();card.settingsDraft.notification_definitions.default[0].id="notification-1";
  click(card,"add-row","","",{rowScope:"policy:policy-1"});
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications[2],{id:"notification-2",timing:{mode:"immediate"},methods:[]});
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
  const {card}=fixture();deleteNotificationDefinition(card.settingsDraft,"methods","phone","remove-rows");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[{id:"report",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["email"]}]);
  assert.equal(card.settingsDraft.monitoring_policies[0].enabled,true);
});

test("replacement covers source default and condition exceptions without duplicating methods",()=>{
  const {card}=fixture(),definitions=card.settingsDraft.notification_definitions;
  definitions.assignments["device:one"]={default:[{id:"one",timing:{mode:"immediate"},methods:["phone","email"]}],checks:{battery:[{id:"battery",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]}]}};
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
  card.settingsDraft.notification_definitions.assignments["device:one"].default[0].timing.at="09:00";
  assert.equal(card.settingsDraft.notification_definitions.default[0].timing.at,"08:00");
  click(card,"inherit-rows","","",{rowScope:scope});
  assert.equal(card.settingsDraft.notification_definitions.assignments["device:one"].default,undefined);
});

test("notification rows have globally independent ids and shared legacy pairings detach on edit",()=>{
  const {card}=fixture(),defs=card.settingsDraft.notification_definitions;
  click(card,"add-row","","",{rowScope:"repairs"});
  click(card,"add-row","","",{rowScope:"broken_automations"});
  assert.notEqual(defs.repairs[0].id,defs.broken_automations[0].id);
  defs.repairs=structuredClone(defs.default);
  const target={dataset:{rowScope:"repairs",rowId:"default",rowField:"timing:at"},value:"09:00"};
  editReusable(card,{type:"change",target});
  assert.equal(defs.default[0].timing.at,"08:00");assert.notEqual(defs.repairs[0].id,"default");
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

test("Notifications offers methods and sending without schedule or default assignment editors",()=>{
  const {card}=fixture();card.definitionSelection={kind:"schedules",id:"morning"};
  const html=namedNotifications(card);
  assert.match(html,/Delivery methods/);assert.match(html,/Notification sending/);
  assert.doesNotMatch(html,/>Schedules<|Default notification rows|Add schedule|data-definition-zone/);
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

function rowChange(card,id,field,value,extra={}) {
  const target={dataset:{rowScope:"policy:policy-1",rowId:id,rowField:field,...extra},value:String(value),checked:value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}

test("owned timing switches cleanly and repeated entries remain independent",()=>{
  const {card,calls}=fixture(),policy=card.settingsDraft.monitoring_policies[0];policy.notifications=[];
  click(card,"add-row","","",{rowScope:"policy:policy-1"});click(card,"add-row","","",{rowScope:"policy:policy-1"});
  const [first,second]=policy.notifications;
  rowChange(card,first.id,"timing:remind",true);rowChange(card,first.id,"timing:minutes",45);
  assert.deepEqual(first.timing,{mode:"acknowledge",remind_every:2700});
  assert.deepEqual(second.timing,{mode:"immediate"});
  rowChange(card,first.id,"timing:mode","report");rowChange(card,first.id,"timing:at","09:30");
  rowChange(card,first.id,"timing:weekdays",false,{rowDay:"6"});
  assert.deepEqual(first.timing,{mode:"report",at:"09:30",weekdays:[0,1,2,3,4,5]});
  rowChange(card,first.id,"timing:mode","immediate");assert.deepEqual(first.timing,{mode:"immediate"});
  assert.equal(calls.length,0);
});

test("watch choices match monitoring capabilities",()=>{
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"integration"))),["all","selected"]);
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"repair"))),["all"]);
  assert.deepEqual(Object.keys(watchChoices(newMonitoringPolicy([],"battery"))),["all","selected","area","label"]);
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
  click(card,"finish-pick","policies",policy.id);assert.match(namedPolicies(card),/Kitchen, Bedroom/);
  change(card,"policies",policy.id,"watch","label");assert.deepEqual(policy.match,{kind:["entity"],label:[]});assert.equal(watchMode(policy),"label");
});

test("selected source picker uses stable values and filters by monitoring type",()=>{
  const {card}=fixture();const policy=newMonitoringPolicy([],"device");
  const choices=policySelectionChoices(card,policy,"selected");
  assert.ok(choices.length>0);assert.ok(choices.some(item=>item.id==="standalone"));
  assert.ok(choices.every(item=>!item.id.startsWith("registry:")));
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

test("empty exact selection cannot silently become all sources during review",async()=>{
  const {card,calls}=fixture();change(card,"policies","policy-1","watch","area");
  await previewSourceSettings(card);assert.equal(calls.length,0);assert.match(card.sourceSettingsError,/Choose at least one/);
});

test("unified Sources settings link to policies without legacy enrollment mutations",()=>{
  const {card}=fixture();card.configuration.monitoring_policy_version=1;
  const source=card.current.data.inventory.catalog.candidates.find(item=>item.kind==="device");
  const html=sourceMonitoringChoices(card,{source});assert.match(html,/View monitoring policies/);assert.doesNotMatch(html,/data-scope-index|data-row-field|data-reporting-node/);
  const family=integrationSettings(card,{});assert.match(family,/Review policies/);assert.doesNotMatch(family,/data-scope-index/);
});


test("unified problem detail renders policy actions and base source links without legacy exclusions",async()=>{
  globalThis.HTMLElement=class {};
  const elements=new Map();globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};globalThis.window={};
  await import("../../custom_components/homeostatic/frontend/homeostatic.js");
  const prototype=elements.get("homeostatic-card").prototype;
  const {card}=fixture(),data=card.current.data;
  const source={node_id:"monitoring:policy-1:version:entity:registry:one",monitoring_source:"entity:registry:one",monitoring_policy:"policy-1",name:"Entity one",kind:"entity",entity_id:"sensor.one",attributes:{domain:["sensor"]},watched:true,requirements:[]};
  const episode={episode_id:"episode-one",anchor:source.node_id,opened_at:"2026-10-13T12:00:00Z",status:"fail"};
  data.inventory.episodes=[episode];data.inventory.nodes.push(source);
  const result={source,monitoring_policies:[{id:"policy-1",name:"Entity monitoring"}],explanation:{findings:[],nodes:[]},entity_status:[]};
  const body={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>({addEventListener(){}})};
  const detail={...card,detailSequence:0,detail:{episodeId:episode.episode_id},configuration:{...card.configuration,monitoring_policy_version:1},shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:{textContent:""}},displaySourceName:item=>item.name,tools:{detailButtons:()=>""},_hass:{callWS:async()=>result}};
  await prototype.loadDetail.call(detail);
  assert.match(body.innerHTML,/data-definition-action="open-policy"/);
  assert.match(body.innerHTML,/Entity monitoring/);
  assert.match(body.innerHTML,/data-source-link="entity:registry:one"/);
  assert.doesNotMatch(body.innerHTML,/data-ignore-availability|Stop checking/);
  result.source={...source,kind:"device",attributes:{device:["one"]}};
  result.device_evidence={total:1,members:[{node_id:"entity:registry:one",name:"Entity one",state:"unavailable"}]};
  await prototype.loadDetail.call(detail);
  assert.match(body.innerHTML,/data-definition-action="open-policy"/);
  assert.doesNotMatch(body.innerHTML,/data-ignore-availability|Stop checking/);
  detail.dialog={close(){}};detail.configDraft=[];
  await prototype.ignoreAvailability.call(detail,"entity:registry:one");assert.deepEqual(detail.configDraft,[]);assert.equal(detail.page,"policies");
});
