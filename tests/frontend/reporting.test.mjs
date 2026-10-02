import test from "node:test";
import assert from "node:assert/strict";
import {destinationChoices} from "../../custom_components/homeostatic/frontend/reporting.mjs";
import {REPORTING,editReporting,reportingSettings,sourceReporting,reportingOverview,reportingStatus,reportingChoices,reportingChanges} from "../../custom_components/homeostatic/frontend/reporting.mjs";
const choices=()=>({timezone:"America/Chicago",default:"weekly",people:{mike:["phone:one"]},profiles:{immediate:{people:["mike"]},acknowledge:{people:["mike"]},morning:{at:"08:00",people:["mike"]},evening:{at:"18:00",people:["mike"]},weekly:{at:"09:00",weekday:6,people:["mike"]}},assignments:{"device:a":{default:"immediate",checks:{availability:"dashboard"}}}});
function card(){const reporting=choices();return {settingsDraft:{reporting,notifications:false},configuration:{settings:{reporting:structuredClone(reporting)},notification_people:[{id:"mike",name:"Michael",user_id:"m"}],notification_destinations:[]},current:{data:{inventory:{}}},settingsPreview:{},render(){this.rendered=true;}};}
const target=dataset=>({dataset,closest(){return this;},hasAttribute(name){const key=name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return Object.hasOwn(dataset,key);},matches(){return true;}});

const duplicatePhones=[
  {channel:"notify:one",phone_channel:"phone:one",name:"iPhone",user_id:null,available:true},
  {channel:"phone:one",name:"iPhone",user_id:"m",available:true},
  {channel:"notify:two",phone_channel:"phone:two",name:"iPhone",user_id:null,available:true},
  {channel:"phone:two",name:"iPhone",user_id:"m",available:true},
  {channel:"notify:email",name:"Email",user_id:null,available:true},
  {channel:"phone:other",name:"Other phone",user_id:"other",available:true},
  {channel:"notify:other",phone_channel:"phone:other",name:"Other phone",user_id:null,available:true},
];
for(const selected of [["phone:one"],["notify:one"],["phone:one","notify:one"]]) {
  test(`phone aliases render once and preserve saved selections: ${selected.join(",")}`,()=>{
    const c=card();c.configuration.notification_destinations=duplicatePhones;
    c.settingsDraft.reporting.people.mike=[...selected];
    const before=structuredClone(c.settingsDraft);
    const rows=destinationChoices(duplicatePhones,"m",selected);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(row=>row.channels),[["notify:one","phone:one"],["notify:two","phone:two"],["notify:email"]]);
    const html=reportingSettings(c);
    assert.equal((html.match(/data-reporting-channel=/g)||[]).length,3);
    assert.equal((html.match(/data-reporting-person="mike" checked/g)||[]).length,1);
    assert.deepEqual(c.settingsDraft,before);
    assert.equal(rows[0].selected,selected.length);
    assert.ok(selected.includes(rows[0].channel));
    const checkbox=target({reportingChannel:rows[0].channel,reportingPerson:"mike"});
    checkbox.checked=false;editReporting(c,{type:"change",target:checkbox});
    assert.deepEqual(c.settingsDraft.reporting.people.mike,[]);
    const unselected=destinationChoices(duplicatePhones,"m",[]);
    const fresh=target({reportingChannel:unselected[0].channel,reportingPerson:"mike"});
    fresh.checked=true;editReporting(c,{type:"change",target:fresh});
    assert.deepEqual(c.settingsDraft.reporting.people.mike,["phone:one"]);
  });
}

test("an unavailable selected alias is retained instead of silently switching transport",()=>{
  const routes=structuredClone(duplicatePhones);routes[0].available=false;
  const rows=destinationChoices(routes,"m",["notify:one"]);
  assert.equal(rows[0].channel,"notify:one");
  assert.equal(rows[0].available,false);
  assert.equal(rows[0].selected,1);
});
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
test("editing the visible reporting controls stages conservative defaults with requests off",()=>{
  const c=card();c.settingsDraft={policy:{timezone:"America/Chicago"},notifications:true,simple_notifications:{people:{mike:{channels:["phone:one"]}}}};
  const element=target({reportingTime:"morning"});element.value="07:30";
  editReporting(c,{type:"change",target:element});
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
test("acknowledgment is awareness and status never claims receipt",()=>{
  const data={policy:{notifications_enabled:true,episodes:[{episode_id:"a",sent_to:["mike"],require_acknowledgment:true}]}};
  assert.match(reportingStatus(data,{episode_id:"a"}),/awaiting acknowledgment/);
  data.policy.episodes[0].acknowledgment={at:"2026-09-28"};
  assert.match(reportingStatus(data,{episode_id:"a"}),/problem remains open/);
});

import {sourcesTree,sourcePaths,sourceMonitoringChoices} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
for(const grouping of ["integration","location","topomation"])test(`Configured situations are reachable with ${grouping} grouping`,()=>{
  const data=monitoringExample();data.inventory.nodes.push(baseSource("situation:water","Water detected","situation",{watched:true}));
  const paths=sourcePaths(sourcesTree(data,grouping));
  assert.equal(paths.get("source:situation:water").node.name,"Water detected");
});

for(const saved of [
  {name:"custom",consumer:null,simple_notifications:null},
  {name:"automation",consumer:"automation.old",simple_notifications:null},
  {name:"person",consumer:null,simple_notifications:{people:{mike:{channels:["phone:one"]}}}},
])test(`${saved.name} policy shows profiles and assignments without changing saved settings`,()=>{
  const c=card();
  c.settingsDraft={...saved,policy:{timezone:"UTC"},notifications:true};
  c.configuration.settings=structuredClone(c.settingsDraft);
  const before=structuredClone(c.settingsDraft);
  assert.match(reportingSettings(c),/Reporting profiles/);
  assert.match(sourceReporting(c,{source:{node_id:"device:a",kind:"device"}}),/data-reporting-node/);
  assert.deepEqual(c.settingsDraft,before);
  assert.deepEqual(c.configuration.settings,before);
  assert.equal(reportingChoices(c).default,"weekly");
  const element=target({reportingNode:"device:a",reportingCheck:""});element.value="immediate";
  editReporting(c,{type:"change",target:element});
  assert.equal(c.settingsDraft.reporting.assignments["device:a"].default,"immediate");
  assert.equal(c.settingsDraft.notifications,false);
  assert.equal(c.settingsDraft.consumer,null);
  assert.deepEqual(c.configuration.settings,before);
});

test("reviewing initial reporting setup invokes preview without saving or sending",()=>{
  const c=card();c.settingsDraft={policy:{timezone:"UTC"},notifications:true};
  let previews=0;c.previewSettings=()=>{previews++;};
  editReporting(c,{type:"click",target:target({reportingReview:""})});
  assert.equal(previews,1);
  assert.equal(c.settingsDraft.notifications,false);
  assert.equal(c.settingsDraft.reporting.default,"weekly");
});

test("initial reporting review names the selected source preference",()=>{
  const after=choices();
  const changes=reportingChanges(null,after);
  assert.ok(changes.some(([name,,to])=>name==="Reporting · device:a"&&to.includes("Immediate")));
  assert.ok(changes.some(([name])=>name==="Weekly summary"));
});

for(const [status,warning] of [["requests_disabled","Outgoing requests are disabled"],["missing_destinations","no configured destination"],["configured","Shared recipients"]])test(`automation alert reporting is owned by HA with ${status} status`,()=>{
  const c=card();c.settingsDraft=null;
  const html=sourceReporting(c,{source:{node_id:"situation:leak",automation_url:"/config/automation/edit/owner",alert_profile:"acknowledge",alert_reporting_status:status}});
  assert.match(html,/Immediate with acknowledgment/);
  assert.match(html,/href="\/config\/automation\/edit\/owner"/);
  assert.ok(html.includes(warning));
  assert.doesNotMatch(html,/<select|data-reporting-node/);
});

test("automation settings never offer a competing local save flow",()=>{
  const html=sourceMonitoringChoices({}, {source:{automation_url:"/config/automation/edit/owner",alert_profile:"dashboard"}});
  assert.match(html,/Edit the condition, name, message/);
  assert.match(html,/Edit alert automation/);
  assert.doesNotMatch(html,/Changes are reviewed|Loading monitoring choices/);
});
test("Repairs have one reporting choice that defaults to the morning summary",()=>{
  const c=card();
  assert.match(reportingSettings(c),/Home Assistant Repairs<\/span><select data-reporting-repairs><option value="immediate">Immediate<\/option><option value="acknowledge">Immediate with acknowledgment<\/option><option value="morning" selected>/);
  const element=target({reportingRepairs:""});element.value="weekly";
  assert.equal(editReporting(c,{type:"change",target:element}),true);
  assert.equal(c.settingsDraft.reporting.repairs,"weekly");
  assert.deepEqual(reportingChanges(c.configuration.settings.reporting,c.settingsDraft.reporting).find(row=>row[0]==="Home Assistant Repairs"),["Home Assistant Repairs","Morning summary","Weekly summary"]);
  assert.equal(reportingChoices({settingsDraft:{policy:{timezone:"UTC"}},_hass:null}).repairs,"morning");
});
