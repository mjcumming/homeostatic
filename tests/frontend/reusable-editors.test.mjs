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

test("device exclusions use canonical identities for devices and individual members",()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],"device");
  const rows=card.current.data.inventory.nodes;
  rows.push({...rows.find(source=>source.node_id==="device:standalone"),node_id:"monitoring:policy:device:standalone",monitoring_source:"device:standalone"});
  const choices=policySelectionChoices(card,policy,"all_except");
  assert.deepEqual(choices.find(item=>item.id==="device:standalone"),{id:"device:standalone",name:"Standalone device",group:"Whole devices"});
  assert.deepEqual(choices.find(item=>item.id==="entity:registry:standalone"),{id:"entity:registry:standalone",name:"Standalone switch",entity_id:"switch.standalone",group:"Individual device entities"});
  assert.equal(choices.filter(item=>item.id==="device:standalone").length,1);
  assert.ok(choices.every(item=>!item.id.startsWith("monitoring:")));
  assert.ok(choices.every(item=>!item.id.startsWith("entity:registry:orphan-")));
});

test("integration exclusions identify individual connections while selected scope still uses families",()=>{
  const {card}=fixture(),policy=newMonitoringPolicy([],"integration");
  const rows=card.current.data.inventory.nodes;
  rows.push({node_id:"entry:mobile-one",kind:"integration",name:"First phone",attributes:{integration_domain:["mobile_app"]}});
  rows.push({node_id:"entry:mobile-two",kind:"integration",name:"Second phone",attributes:{integration_domain:["mobile_app"]}});
  assert.equal(policySelectionChoices(card,policy,"selected").filter(item=>item.id==="mobile_app").length,1);
  assert.deepEqual(policySelectionChoices(card,policy,"all_except").filter(item=>item.id.startsWith("entry:mobile-")).map(item=>item.id),["entry:mobile-one","entry:mobile-two"]);
});

test("excluded sources survive picker search, missing inventory and scoped save",async()=>{
  const {card,calls}=fixture(),policy=newMonitoringPolicy([],"device");
  card.settingsDraft.monitoring_policies=[policy];
  card.definitionSelection={kind:"policies",id:policy.id};
  change(card,"policies",policy.id,"watch","all_except");
  change(card,"policies",policy.id,"selection",true,{definitionValue:"device:standalone"});
  change(card,"policies",policy.id,"selection",true,{definitionValue:"entity:registry:missing"});
  click(card,"pick","policies",policy.id);
  editReusable(card,{type:"input",target:{dataset:{definitionPickerSearch:""},value:"Back Deck"}});
  const html=namedPolicies(card);
  assert.match(html,/Check sources to exclude them from this policy/);
  assert.match(html,/Show excluded only/);assert.match(html,/2 excluded/);
  assert.match(html,/Unavailable excluded source — clear to include if it returns/);
  assert.match(html,/data-definition-value="entity:registry:missing" checked/);
  assert.deepEqual(policy.excluded_sources,["device:standalone","entity:registry:missing"]);
  assert.deepEqual(policy.match,{kind:["device"]});
  click(card,"finish-pick","policies",policy.id);
  assert.match(namedPolicies(card),/Standalone device, Unavailable excluded source/);
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:policy.id}),true);
  assert.deepEqual(calls.find(call=>call.type==="homeostatic/save_settings").settings.monitoring_policies[0].excluded_sources,["device:standalone","entity:registry:missing"]);
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
  const {card}=fixture(),policy=newMonitoringPolicy([],"entity");
  card.settingsDraft.monitoring_policies=[policy];
  policy.match={kind:["entity"],area:["kitchen"]};policy.excluded_sources=["entity:registry:standalone"];
  card.configuration.areas=[{id:"kitchen",name:"Kitchen"}];
  card.definitionSelection={kind:"policies",id:policy.id};
  const before=structuredClone(policy),html=namedPolicies(card);
  assert.equal(watchMode(policy),"area");
  assert.match(html,/<option value="area" selected>/);
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




test("unified problem detail renders policy actions and base source links without legacy exclusions",async()=>{
  const prototype=await cardPrototype();
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
  result.device_evidence={total:3,unavailable_count:1,unknown_count:0,members:[
    {node_id:"entity:registry:one",name:"Temperature",state:"unavailable"},
    {node_id:"entity:registry:connection",name:"Connection",state:"off",connectivity:true},
    {node_id:"entity:registry:unknown",name:"Unknown value",state:"unknown"}
  ]};
  await prototype.loadDetail.call(detail);
  assert.match(body.innerHTML,/data-definition-action="open-policy"/);
  assert.doesNotMatch(body.innerHTML,/data-ignore-availability|Stop checking/);
  const deviceBrief=body.innerHTML.split('<details data-disclosure="technical"')[0];
  assert.match(deviceBrief,/<h3 class="problem-status">Temperature unavailable in Home Assistant<\/h3>/);
  assert.doesNotMatch(deviceBrief,/Disconnected|Monitored entities need review|Unknown value|Connection.*off/);
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
  assert.match(namedPolicies(card),/Choose integrations/);assert.match(namedPolicies(card),/<legend>Integrations/);
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
  assert.match(namedPolicies(card),/Edit policy: Hall thermostat/);
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
  assert.match(loading,/Saved exclusion/);
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
  assert.match(namedPolicies(card),/No matching choices/);
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
  assert.deepEqual(card.policyPicker,{id:policy.id,query:"Batt",selectedOnly:true});
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

test("empty policy notifications offer dashboard-only and methods point to named notifications",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.notifications=[];card.definitionSelection={kind:"policies",id:policy.id};
  const html=namedPolicies(card);
  assert.match(html,/Dashboard only/);
  assert.match(html,/Manage named notifications and their delivery methods in Notifications/);
  assert.doesNotMatch(html,/data-row-field="timing:/);
  card.page="notifications";card.definitionSelection={kind:"methods",id:"phone"};card.notificationSection="methods";
  assert.match(namedNotifications(card),/Timing and reminders are set in the named notifications that use this method/);
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
