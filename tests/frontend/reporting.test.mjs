import test from "node:test";
import assert from "node:assert/strict";
import {REPORTING,editReporting,reportingSettings,sourceReporting,reportingOverview,reportingStatus} from "../../custom_components/homeostatic/frontend/reporting.mjs";
const choices=()=>({timezone:"America/Chicago",default:"weekly",people:{mike:["phone:one"]},profiles:{immediate:{people:["mike"]},acknowledge:{people:["mike"]},morning:{at:"08:00",people:["mike"]},evening:{at:"18:00",people:["mike"]},weekly:{at:"09:00",weekday:6,people:["mike"]}},assignments:{"device:a":{default:"immediate",checks:{availability:"dashboard"}}}});
function card(){const reporting=choices();return {settingsDraft:{reporting,notifications:false},configuration:{settings:{reporting:structuredClone(reporting)},notification_people:[{id:"mike",name:"Michael",user_id:"m"}],notification_destinations:[]},current:{data:{inventory:{}}},settingsPreview:{},render(){this.rendered=true;}};}
const target=dataset=>({dataset,closest(){return this;},hasAttribute(name){const key=name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return Object.hasOwn(dataset,key);},matches(){return true;}});
test("dashboard is a peer choice and immediate explicitly includes overnight",()=>{
  const c=card(),html=sourceReporting(c,{source:{node_id:"device:a",kind:"device"}});
  assert.equal(REPORTING.length,6);
  assert.match(html,/Dashboard only/);
  assert.match(html,/Use household default — Weekly summary/);
  assert.match(reportingSettings(c),/Immediate always includes overnight/);
  assert.doesNotMatch(reportingSettings(c),/Important|Urgent only|Quiet hours/);
});
test("bulk default changes preserve condition exceptions and invalidate review",()=>{
  const c=card(),element=target({reportingBulk:'["device:a","device:b"]'});element.value="evening";
  assert.equal(editReporting(c,{type:"change",target:element}),true);
  assert.equal(c.settingsDraft.reporting.assignments["device:a"].default,"evening");
  assert.deepEqual(c.settingsDraft.reporting.assignments["device:a"].checks,{availability:"dashboard"});
  assert.equal(c.settingsDraft.reporting.assignments["device:b"].default,"evening");
  assert.equal(c.settingsPreview,null);assert.equal(c.settingsDraft.notifications,false);
});
test("removing an override restores inheritance without removing an exception",()=>{
  const c=card(),element=target({reportingNode:"device:a",reportingCheck:""});element.value="";
  editReporting(c,{type:"change",target:element});
  assert.equal(c.settingsDraft.reporting.assignments["device:a"].default,undefined);
  assert.equal(c.settingsDraft.reporting.assignments["device:a"].checks.availability,"dashboard");
});
test("migration is a draft with conservative defaults and requests off",()=>{
  const c=card();c.settingsDraft={policy:{timezone:"America/Chicago"},notifications:true,simple_notifications:{people:{mike:{channels:["phone:one"]}}}};
  editReporting(c,{type:"click",target:target({reportingMigrate:""})});
  assert.equal(c.settingsDraft.reporting.default,"weekly");
  assert.deepEqual(c.settingsDraft.reporting.profiles.weekly,{at:"09:00",weekday:6,people:[]});
  assert.deepEqual(c.settingsDraft.reporting.people,{mike:["phone:one"]});
  assert.equal(c.settingsDraft.notifications,false);
});
test("Overview distinguishes off, unready, pending and empty reporting",()=>{
  const data={coverage:{},inventory:{},policy:{notifications_enabled:false,reports:[]}};
  assert.match(reportingOverview(data),/No messages are sent/);
  data.policy.notifications_enabled=true;
  assert.match(reportingOverview(data),/No problems awaiting a report/);
  data.policy.reporting_missing=["weekly"];
  assert.match(reportingOverview(data),/Review destinations/);
  data.policy.reporting_missing=[];
  data.policy.reports=[{name:"weekly",next_at:"2026-10-04T14:00:00Z",episodes:["a","b"]}];
  assert.match(reportingOverview(data),/2 open problems currently eligible/);
});
test("acknowledgement is awareness and status never claims receipt",()=>{
  const data={policy:{notifications_enabled:true,episodes:[{episode_id:"a",sent_to:["mike"],require_acknowledgment:true}]}};
  assert.match(reportingStatus(data,{episode_id:"a"}),/awaiting acknowledgement/);
  data.policy.episodes[0].acknowledgment={at:"2026-09-28"};
  assert.match(reportingStatus(data,{episode_id:"a"}),/problem remains open/);
});

import {sourcesTree,sourcePaths} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
for(const grouping of ["integration","location","topomation"])test(`Configured situations are reachable with ${grouping} grouping`,()=>{
  const data=monitoringExample();data.inventory.nodes.push(baseSource("situation:water","Water detected","situation",{watched:true}));
  const paths=sourcePaths(sourcesTree(data,grouping));
  assert.equal(paths.get("source:situation:water").node.name,"Water detected");
});
