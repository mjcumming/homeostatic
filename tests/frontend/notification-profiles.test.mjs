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

const notificationListIds=card=>[...namedNotifications(card).matchAll(/data-definition-action="edit" data-definition-kind="profiles" data-definition-id="([^"]+)"/g)].map(match=>match[1]);
const optionIds=html=>[...html.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);
const policyOptions=card=>namedPolicies(card).match(/<select [^>]*data-row-field="profile">([\s\S]*?)<\/select>/)[1];
const defaultOrder=["acknowledge","immediate","urgent","morning","evening","weekly"];
const profile=(name,timing)=>({name,timing,methods:[]});

for(const [label,profiles,expected] of [
  ["supplied choices",notificationSettings().notification_definitions.profiles,defaultOrder],
  ["custom identities and misleading names",{
    immediate:profile("Urgent",{mode:"report",at:"06:00",weekdays:[6]}),
    morning:profile("First",{mode:"report",at:"18:00",weekdays:[0,1,2,3,4,5,6]}),
    evening:profile("Last",{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]}),
    workdays:profile("Daily",{mode:"report",at:"05:00",weekdays:[0,1,2,3,4]}),
    weekly:profile("Weekly",{mode:"acknowledge",remind_every:3600}),
    urgent:profile("Morning",{mode:"immediate"}),
    acknowledge:profile("Immediate",{mode:"window",start:"22:00",end:"08:00"}),
  },["weekly","urgent","acknowledge","evening","morning","workdays","immediate"]],
  ["equivalent settings",{
    z:profile("Same",{mode:"immediate"}),
    last:profile("Zulu",{mode:"immediate"}),
    a:profile("Same",{mode:"immediate"}),
    first:profile("Alpha",{mode:"immediate"}),
  },["first","a","z","last"]],
])test("notification lists and pickers use saved timing order for "+label,()=>{
  const {card,calls}=fixture(),assigned=expected.at(-1);
  card.configuration.settings.notification_definitions.profiles=structuredClone(profiles);
  card.configuration.settings.monitoring_policies[0].notifications=[{id:"existing",profile:assigned}];
  card.settingsDraft=structuredClone(card.configuration.settings);
  const before=structuredClone(card.configuration.settings),draft=structuredClone(card.settingsDraft);
  assert.deepEqual(notificationListIds(card),expected);
  card.definitionSelection={kind:"policies",id:"policy-1"};
  const options=policyOptions(card);
  assert.deepEqual(optionIds(options),["",...expected]);
  assert.ok(options.includes('<option value="'+assigned+'" selected>'));
  card.definitionSelection=null;
  card.definitionDelete={kind:"profiles",id:assigned,resolution:expected[0]};
  const replacements=namedNotifications(card).match(/<select data-definition-delete-resolution>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual(optionIds(replacements),["","remove-rows",...expected.slice(0,-1)]);
  assert.ok(replacements.includes('<option value="'+expected[0]+'" selected>'));
  assert.deepEqual(card.configuration.settings,before);
  assert.deepEqual(card.settingsDraft,draft);
  assert.deepEqual(calls,[]);
});

test("notification ordering changes only after timing is saved",async()=>{
  const {card,calls}=fixture();
  change(card,"profiles","weekly","timing:mode","immediate");
  assert.deepEqual(notificationListIds(card),defaultOrder);
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.deepEqual(optionIds(policyOptions(card)),["",...defaultOrder]);
  const assignments=structuredClone(card.configuration.settings.monitoring_policies);
  assert.deepEqual(calls,[]);
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"weekly"}),true);
  const expected=["acknowledge","immediate","weekly","urgent","morning","evening"];
  assert.deepEqual(notificationListIds(card),expected);
  assert.deepEqual(optionIds(policyOptions(card)),["",...expected]);
  assert.deepEqual(card.configuration.settings.monitoring_policies,assignments);
  assert.equal(card.configuration.settings.notifications,false);
});

test("a policy chooses a named notification without owning timing or methods",()=>{
  const {card}=fixture();card.page="policies";card.definitionSelection={kind:"policies",id:"policy-1"};
  const html=namedPolicies(card);
  assert.match(html,/data-row-field="profile"/);
  assert.match(html,/<option value="morning" selected>Morning summary/);
  assert.doesNotMatch(html,/<dd>[^<]*Morning summary/);
  assert.match(html,/<dt>When<\/dt><dd>08:00 · Every day/);
  assert.match(html,/<dt>Send to<\/dt><dd>No delivery method selected/);
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
  assert.equal((html.match(/<option[^>]*>Custom notification/g)||[]).length,1);
  assert.match(html,/remind every 30 minutes/);
  assert.doesNotMatch(html,/NaN|data-row-field="timing:/);
  assert.deepEqual(row,before);assert.deepEqual(calls,[]);
  choose(card,"legacy","");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[before]);
  choose(card,"legacy","urgent");
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].notifications,[{id:"legacy",profile:"urgent",when:"backup"}]);
});

for(const [kind,id] of [["profiles","morning"],["methods","phone"]])test(`${kind} shows view tabs only outside its focused editor`,()=>{
  const {card}=fixture();card.notificationSection=kind;
  assert.match(namedNotifications(card),/aria-label="Notifications views"/);
  click(card,"edit",kind,id);
  const editor=namedNotifications(card);
  assert.doesNotMatch(editor,/aria-label="Notifications views"|data-definition-action="notification-view"/);
  assert.equal((editor.match(/class="button editor-back"/g)||[]).length,1);
  card.definitionSelection={kind,id:"missing"};
  assert.match(namedNotifications(card),/aria-label="Notifications views"/);
});

for(const [days,expected] of [[[0,1,2,3,4,5,6],"Every day"],[[0,2,4],"Mon, Wed, Fri"],[[],"No days selected"],[undefined,"No days selected"]])test(`summary weekdays ${JSON.stringify(days)} remain explicit`,()=>{
  const {card}=fixture();
  card.settingsDraft.notification_definitions.profiles.morning.timing={mode:"report",at:"08:00",weekdays:days};
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.ok(namedPolicies(card).includes(`<dt>When</dt><dd>08:00 · ${expected}</dd>`));
  assert.match(namedPolicies(card),/<dt>Send to<\/dt><dd>No delivery method selected<\/dd>/);
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
  assert.match(namedNotifications(card),/class="button editor-back"[^>]*data-definition-action="close"/);
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
  assert.match(namedNotifications(card),/No delivery method selected · 1 use/);
  assert.doesNotMatch(namedNotifications(card),/Low battery/);
  click(card,"edit","profiles","morning");
  assert.match(namedNotifications(card),/<h1>Edit notification: Morning summary<\/h1>/);
  assert.match(namedNotifications(card),/Changes apply to: Low battery/);
  click(card,"delete","profiles","morning");
  const html=namedNotifications(card);
  assert.match(html,/Low battery|Replace with Evening summary/);
  assert.match(html,/data-definition-action="confirm-delete"[^>]*disabled/);
  assert.equal(card.settingsDraft.monitoring_policies[0].notifications[0].profile,"morning");
});

test("an empty method library gives one actionable non-sending explanation",()=>{
  const {card}=fixture();
  card.configuration.settings.notification_definitions.methods={};
  card.settingsDraft.notification_definitions.methods={};
  click(card,"edit","profiles","morning");
  const html=namedNotifications(card);
  assert.match(html,/Add a delivery method first\. This notification will not send until a method is assigned\./);
  assert.equal((html.match(/will not send/g)||[]).length,1);
  assert.doesNotMatch(html,/No saved delivery methods yet/);
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

test("a compact policy summary retains unavailable named delivery methods and UPS conditions",()=>{
  const {card}=fixture(),policy=card.settingsDraft.monitoring_policies[0];
  policy.check="ups_reserve";
  policy.notifications=[{id:"mains",profile:"morning",when:"mains"},{id:"backup",profile:"acknowledge",when:"backup"}];
  card.settingsDraft.notification_definitions.profiles.morning.methods=["missing"];
  card.configuration.settings=structuredClone(card.settingsDraft);
  const before=structuredClone(card.settingsDraft),html=namedPolicies(card);
  assert.match(html,/Mains power: Morning summary · Unavailable delivery method/);
  assert.match(html,/Backup power: Immediate with acknowledgment/);
  assert.deepEqual(card.settingsDraft,before);
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
