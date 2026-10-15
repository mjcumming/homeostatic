import test from "node:test";
import assert from "node:assert/strict";
import {newMonitoringPolicy,namedPolicies,namedNotifications,editReusable,definitionUses} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {initializeScopedConfiguration,saveScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

function fixture() {
  let saved=notificationSettings(),revision=1;
  const calls=[];
  const configuration=()=>({revision:String(revision),settings:structuredClone(saved),delivery_targets:[],notification_people:[]});
  const card={page:"notifications",notificationSection:"profiles",configuration:configuration(),settingsDraft:structuredClone(saved),
    current:{status:"current",data:monitoringExample()},main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){},
    _hass:{async callWS(request){calls.push(request);if(request.type==="homeostatic/save_settings"){saved=structuredClone(request.settings);revision++;return {saved:true};}if(request.type==="homeostatic/configuration")return configuration();throw Error("Unexpected request");}}};
  initializeScopedConfiguration(card);
  return {card,calls,saved:()=>saved};
}
function change(card,kind,id,field,value,extra={}) {
  const target={dataset:{definitionKind:kind,definitionId:id,definitionField:field,...extra},value:String(value),type:typeof value==="boolean"?"checkbox":typeof value==="number"?"number":"text",checked:value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}
function choose(card,rowId,value) {
  assert.equal(editReusable(card,{type:"change",target:{dataset:{rowScope:"policy:policy-1",rowId,rowField:"profile"},value}}),true);
}
function click(card,action,kind,id="",extra={}) {
  const target={dataset:{definitionAction:action,definitionKind:kind,definitionId:id,...extra},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}

test("Notifications manages six named defaults without a policy index or staging changes",()=>{
  const {card,calls}=fixture(),before=structuredClone(card.settingsDraft),html=namedNotifications(card);
  for(const profile of Object.values(before.notification_definitions.profiles))assert.ok(html.includes(profile.name));
  assert.doesNotMatch(html,/Policy notifications|edit-policy-notifications|policy-view|new-policy-method/);
  assert.match(html,/No delivery method selected/);
  assert.doesNotMatch(html,/<h2>Notifications<\/h2>/);
  assert.match(html,/popovertarget="notification-actions-morning" aria-label="More actions for Morning summary"/);
  assert.match(html,/<div id="notification-actions-morning" class="policy-actions-popover" popover role="group"[^>]*><button[^>]*data-definition-action="duplicate"[^>]*>Duplicate<\/button><button[^>]*data-definition-action="delete"/);
  assert.deepEqual(card.settingsDraft,before);assert.deepEqual(calls,[]);
});

test("a policy chooses a named notification without owning timing or methods",()=>{
  const {card}=fixture();card.page="policies";card.definitionSelection={kind:"policies",id:"policy-1"};
  const html=namedPolicies(card);
  assert.match(html,/data-row-field="profile"/);
  assert.match(html,/<option value="morning" selected>Morning summary/);
  assert.doesNotMatch(html,/data-row-field="timing:|data-row-method|new-policy-method|policy-view/);
  choose(card,"notification-1","urgent");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[{id:"notification-1",profile:"urgent"}]);
  choose(card,"notification-1","");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[]);
});

test("legacy custom notification is preserved until an explicit named choice",()=>{
  const {card,calls}=fixture(),row={id:"legacy",timing:{mode:"acknowledge",remind_every:"30m"},methods:["phone"],when:"backup"};
  card.settingsDraft.monitoring_policies[0].notifications=[row];
  card.definitionSelection={kind:"policies",id:"policy-1"};
  const before=structuredClone(row),html=namedPolicies(card);
  assert.match(html,/Custom notification — keep current settings/);
  assert.match(html,/remind every 30 minutes/);
  assert.doesNotMatch(html,/NaN|data-row-field="timing:/);
  assert.deepEqual(row,before);assert.deepEqual(calls,[]);
  choose(card,"legacy","");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[before]);
  choose(card,"legacy","urgent");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[{id:"legacy",profile:"urgent",when:"backup"}]);
});

test("multiple choices preserve unrelated rows and UPS conditions",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.check="ups_reserve";
  policy.notifications=[{id:"mains",profile:"morning",when:"mains"},{id:"backup",profile:"acknowledge",when:"backup"}];
  choose(card,"mains","weekly");
  assert.deepEqual(policy.notifications,[{id:"mains",profile:"weekly",when:"mains"},{id:"backup",profile:"acknowledge",when:"backup"}]);
  click(card,"remove-row","","mains",{rowScope:"policy:policy-1"});
  assert.deepEqual(policy.notifications,[{id:"backup",profile:"acknowledge",when:"backup"}]);
});

for(const [type,expected] of [
  ["device",["morning"]],["integration",["morning"]],["entity",["morning"]],["battery",["morning"]],["repair",["morning"]],["broken_automation",["morning"]],
  ["vacuum",["evening"]],["thermostat",["urgent"]],["temperature_limit",["acknowledge"]],["ups_power",["urgent"]],
  ["ups_reserve",["morning","acknowledge"]],["ups_battery_replacement",["morning"]],["ups_fault",["urgent"]],
])test(`new ${type} policy selects supplied defaults without enabling monitoring`,()=>{
  const profiles=notificationSettings().notification_definitions.profiles;
  const policy=newMonitoringPolicy([],type,profiles);
  assert.deepEqual(policy.notifications.map(row=>row.profile),expected);
  assert.equal(policy.enabled,false);
  assert.deepEqual(newMonitoringPolicy([],type,{}).notifications,[]);
});

test("profile timing edits stay independent and discard restores only this notification",()=>{
  const {card}=fixture(),before=structuredClone(card.settingsDraft.notification_definitions.profiles.evening);
  click(card,"edit","profiles","morning");
  assert.doesNotMatch(namedNotifications(card),/>Back to notifications<|data-definition-action="close"/);
  change(card,"profiles","morning","timing:mode","acknowledge");
  change(card,"profiles","morning","timing:minutes",45);
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.morning.timing,{mode:"acknowledge",remind_every:2700});
  change(card,"profiles","morning","timing:mode","window");
  change(card,"profiles","morning","timing:start","09:00");
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.morning.timing,{mode:"window",start:"09:00",end:"22:00"});
  change(card,"profiles","morning","timing:mode","report");
  change(card,"profiles","morning","timing:weekdays",false,{definitionValue:"6"});
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.morning.timing.weekdays,[0,1,2,3,4,5]);
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.evening,before);
  change(card,"policies","policy-1","name","Pending policy");
  click(card,"discard-scoped","profiles","morning");
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Pending policy");
  assert.equal(card.settingsDraft.notification_definitions.profiles.morning.timing.at,"08:00");
});

test("saving a named notification retains unrelated policy and method drafts",async()=>{
  const {card,saved}=fixture();
  change(card,"policies","policy-1","name","Pending policy");
  change(card,"methods","phone","name","Pending phone");
  change(card,"profiles","morning","timing:at","09:00");
  change(card,"profiles","morning","methods",true,{definitionValue:"phone"});
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"}),true);
  assert.equal(saved().notification_definitions.profiles.morning.timing.at,"09:00");
  assert.deepEqual(saved().notification_definitions.profiles.morning.methods,["phone"]);
  assert.equal(saved().notification_definitions.methods.phone.name,"Owner phone");
  assert.equal(saved().monitoring_policies[0].name,"Low battery");
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Pending policy");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Pending phone");
});

test("profile use and deletion prompts name affected policies without silently dropping assignments",()=>{
  const {card}=fixture();
  assert.deepEqual(definitionUses(card.configuration.settings,"profiles","morning"),["Low battery"]);
  click(card,"delete","profiles","morning");
  const html=namedNotifications(card);
  assert.match(html,/Low battery|Replace with Evening summary/);
  assert.match(html,/data-definition-action="confirm-delete"[^>]*disabled/);
  assert.equal(card.settingsDraft.monitoring_policies[0].notifications[0].profile,"morning");
});

test("profile names and missing methods render safely and stay assigned",()=>{
  const {card}=fixture();
  card.settingsDraft.notification_definitions.profiles.morning.name='<img src=x onerror=alert(1)>';
  card.settingsDraft.notification_definitions.profiles.morning.methods=["missing"];
  click(card,"edit","profiles","morning");
  const html=namedNotifications(card);
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
  assert.match(html,/Unavailable delivery method/);
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.morning.methods,["missing"]);
});

test("a changed profile schedule never displays its saved next occurrence",()=>{
  const {card}=fixture();
  card.current.data.policy.reports=[{name:"entry:policy_policy-1_notification-1",next_at:"2026-10-15T13:00:00Z"}];
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.match(namedPolicies(card),/Next summary:/);
  change(card,"profiles","morning","timing:at","09:00");
  assert.match(namedPolicies(card),/Next summary time is available after saving/);
  assert.doesNotMatch(namedPolicies(card),/Next summary:/);
});


for(const available of [true,false])test(`restoring a supplied policy keeps only ${available?"available":"no missing"} named defaults`,()=>{
  const {card,calls}=fixture();
  const template={...newMonitoringPolicy([],"device",card.settingsDraft.notification_definitions.profiles),id:"default_devices"};
  card.configuration.monitoring_policy_templates=[template];
  card.configuration.settings.notification_definitions.profiles=available?card.configuration.settings.notification_definitions.profiles:{};
  card.settingsDraft.notification_definitions.profiles=structuredClone(card.configuration.settings.notification_definitions.profiles);
  click(card,"restore","policies");
  card.policyRestoreIds=["default_devices"];
  click(card,"confirm-restore","policies");
  const restored=card.settingsDraft.monitoring_policies.find(policy=>policy.id==="default_devices");
  assert.deepEqual(restored.notifications,available?[{id:"notification-1",profile:"morning"}]:[]);
  assert.deepEqual(template.notifications,[{id:"notification-1",profile:"morning"}]);
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles,card.configuration.settings.notification_definitions.profiles);
  assert.deepEqual(calls,[]);
});
