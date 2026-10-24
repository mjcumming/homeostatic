import test from "node:test";
import assert from "node:assert/strict";
import {editReusable,namedPolicies,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {initializeScopedConfiguration,saveScopedConfiguration,scopedDirty} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const clone=value=>structuredClone(value);
const selectedPolicy=card=>card.editors.settingsDraft.monitoring_policies[0];
const policyScope={kind:"policy",id:"policy-1"};

function fixture(settings=notificationSettings()) {
  let saved=clone(settings),revision=1;
  const calls=[];
  const configuration=()=>({revision:String(revision),settings:clone(saved),delivery_targets:[],notification_people:[]});
  const connection={async callWS(request) {
    calls.push(clone(request));
    if(request.type==="homeostatic/configuration")return configuration();
    assert.equal(request.type,"homeostatic/save_settings");
    assert.equal(request.revision,String(revision));
    saved=clone(request.settings);revision++;
    return {saved:true};
  }};
  const reopen=()=>{
    const card={page:"policies",definitionSelection:{kind:"policies",id:"policy-1"},editors:{configuration:configuration(),settingsDraft:clone(saved)},
      current:{status:"current",data:monitoringExample()},main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){},_hass:connection};
    initializeScopedConfiguration(card.editors);
    return card;
  };
  return {card:reopen(),calls,reopen,saved:()=>clone(saved)};
}

function remove(card,rowId) {
  const target={dataset:{definitionAction:"remove-row",definitionKind:"",definitionId:rowId,rowScope:"policy:policy-1"},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}

function choose(card,rowId,value) {
  const target={dataset:{rowScope:"policy:policy-1",rowId,rowField:"profile"},value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}

for(const [name,row] of [
  ["named",{id:"notification-1",profile:"morning"}],
  ["Custom",{id:"notification-1",timing:{mode:"immediate"},methods:["phone"]}],
])test(`removing the last ${name} notification saves and reopens without restoring it`,async()=>{
  const settings=notificationSettings();settings.monitoring_policies[0].notifications=[row];
  const {card,calls,saved,reopen}=fixture(settings),expected=clone(settings);
  assert.match(namedPolicies(card),/data-definition-action="remove-row"/);
  remove(card,row.id);
  assert.deepEqual(selectedPolicy(card).notifications,[]);
  assert.match(namedPolicies(card),/policy-notification-empty/);
  assert.match(namedPolicies(card),/No notifications/);
  assert.doesNotMatch(namedPolicies(card),/data-definition-action="remove-row"/);
  assert.equal(scopedDirty(card.editors,policyScope),true);
  assert.equal(await saveScopedConfiguration(card,policyScope),true);
  expected.monitoring_policies[0].notifications=[];
  assert.deepEqual(saved(),expected);
  assert.deepEqual(card.editors.configuration.settings,expected);
  assert.equal(scopedDirty(card.editors,policyScope),false);
  assert.deepEqual(calls.map(request=>request.type),["homeostatic/save_settings","homeostatic/configuration"]);
  card.definitionSelection=null;
  assert.match(namedPolicies(card),/Dashboard only/);
  card.definitionSelection={kind:"policies",id:"policy-1"};
  assert.match(namedPolicies(card),/No notifications/);
  const fresh=reopen();
  assert.deepEqual(selectedPolicy(fresh).notifications,[]);
  assert.equal(selectedPolicy(fresh).enabled,true);
  assert.match(namedPolicies(fresh),/No notifications/);
  assert.doesNotMatch(namedPolicies(fresh),/data-definition-action="remove-row"/);
});

test("removing all notifications saves only this policy and retains other drafts and global sending",async()=>{
  const settings=notificationSettings();settings.notifications=true;
  settings.monitoring_policies.push(newMonitoringPolicy(settings.monitoring_policies,"device",settings.notification_definitions.profiles));
  const {card,saved}=fixture(settings),expected=clone(settings);
  card.editors.settingsDraft.monitoring_policies[1].name="Pending device policy";
  card.editors.settingsDraft.notification_definitions.profiles.morning.name="Pending morning name";
  card.editors.settingsDraft.notifications=false;
  remove(card,"notification-1");
  assert.equal(await saveScopedConfiguration(card,policyScope),true);
  expected.monitoring_policies[0].notifications=[];
  assert.deepEqual(saved(),expected);
  assert.equal(card.editors.configuration.settings.notifications,true);
  assert.equal(card.editors.settingsDraft.notifications,false);
  assert.equal(card.editors.settingsDraft.monitoring_policies[1].name,"Pending device policy");
  assert.equal(card.editors.settingsDraft.notification_definitions.profiles.morning.name,"Pending morning name");
  assert.equal(scopedDirty(card.editors,{kind:"policy",id:"policy-2"}),true);
  assert.equal(scopedDirty(card.editors,{kind:"profile",id:"morning"}),true);
});

test("opening or cancelling Add notification does not create a default assignment",()=>{
  const settings=notificationSettings();settings.monitoring_policies[0].notifications=[];
  const {card,calls}=fixture(settings),before=clone(card.editors.settingsDraft),html=namedPolicies(card);
  assert.match(html,/policy-notification-add/);
  assert.match(html,/Add notification/);
  assert.match(html,/Choose a notification/);
  assert.match(html,/data-row-id="" data-row-field="profile"/);
  assert.doesNotMatch(html,/data-definition-action="add-row"/);
  assert.equal(editReusable(card,{type:"click",target:{closest:()=>null}}),false);
  choose(card,"","");
  assert.deepEqual(card.editors.settingsDraft,before);
  assert.deepEqual(calls,[]);
  assert.equal(scopedDirty(card.editors,policyScope),false);
});

test("Add notification appends exactly the chosen saved definition and leaves existing assignments intact",()=>{
  const {card,calls}=fixture(),before=clone(selectedPolicy(card).notifications);
  choose(card,"","evening");
  assert.equal(selectedPolicy(card).notifications.length,2);
  assert.deepEqual(selectedPolicy(card).notifications[0],before[0]);
  assert.deepEqual(selectedPolicy(card).notifications[1],{id:"notification-2",profile:"evening"});
  assert.deepEqual(calls,[]);
  assert.match(namedPolicies(card),/Choose a notification/);
});

test("an empty policy can add its chosen notification without restoring a supplied default",async()=>{
  const settings=notificationSettings();settings.monitoring_policies[0].notifications=[];
  const {card,saved,reopen}=fixture(settings);
  choose(card,"","weekly");
  assert.deepEqual(selectedPolicy(card).notifications,[{id:"notification-1",profile:"weekly"}]);
  assert.equal(await saveScopedConfiguration(card,policyScope),true);
  assert.deepEqual(saved().monitoring_policies[0].notifications,[{id:"notification-1",profile:"weekly"}]);
  assert.deepEqual(selectedPolicy(reopen()).notifications,[{id:"notification-1",profile:"weekly"}]);
});

test("UPS reserve can remove all assignments and add valid mains and backup notifications again",async()=>{
  const settings=notificationSettings();
  settings.monitoring_policies=[{...newMonitoringPolicy([],"ups_reserve",settings.notification_definitions.profiles),enabled:true}];
  const {card,saved,reopen}=fixture(settings);
  remove(card,"notification-1");remove(card,"notification-2");
  assert.equal(await saveScopedConfiguration(card,policyScope),true);
  assert.deepEqual(saved().monitoring_policies[0].notifications,[]);
  const fresh=reopen();
  choose(fresh,"","morning");choose(fresh,"","acknowledge");
  const expected=[{id:"notification-1",profile:"morning",when:"mains"},{id:"notification-2",profile:"acknowledge",when:"backup"}];
  assert.deepEqual(selectedPolicy(fresh).notifications,expected);
  choose(fresh,"notification-2","urgent");expected[1].profile="urgent";
  assert.deepEqual(selectedPolicy(fresh).notifications,expected);
  assert.equal(await saveScopedConfiguration(fresh,policyScope),true);
  assert.deepEqual(saved().monitoring_policies[0].notifications,expected);
  assert.deepEqual(selectedPolicy(reopen()).notifications,expected);
});

test("removing the last Custom notification focuses Save policy when no notification can be added",()=>{
  const settings=notificationSettings();
  settings.notification_definitions.profiles={};
  settings.monitoring_policies[0].notifications=[{id:"custom",timing:{mode:"immediate"},methods:["phone"]}];
  const {card}=fixture(settings),focused=[];
  const add={dataset:{rowScope:"policy:policy-1",rowId:""},disabled:true,focus(){focused.push("disabled Add");}};
  const save={disabled:false,focus(){focused.push("Save policy");}};
  card.main.querySelectorAll=selector=>selector==='[data-row-field="profile"]'?[add]:[];
  card.main.querySelector=selector=>selector==='[data-definition-action="save-scoped"]'?save:null;
  remove(card,"custom");
  assert.deepEqual(selectedPolicy(card).notifications,[]);
  assert.equal(scopedDirty(card.editors,policyScope),true);
  assert.deepEqual(focused,["Save policy"]);
});
