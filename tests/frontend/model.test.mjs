import {durationSeconds,editInstallation,installationSettings,settingsChanges} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {configurationBrowser, monitoringNavigation, monitoringIndex, revealMonitoringPath} from "../../custom_components/homeostatic/frontend/monitoring-browser.mjs";
import {filterSources, sourceMonitoringChoices, sourcePaths, sourcesBrowser, sourcesTree} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {monitoringExample, baseSource} from "./monitoring-fixture.mjs";
import {monitoringPolicyRules} from "./monitoring-policies-fixture.mjs";
import {groupPolicyScope, isGroupPolicy, monitoringPolicies, newGroupPolicy} from "../../custom_components/homeostatic/frontend/monitoring-policies.mjs";
import {deviceProblem, entityProblem, integrationProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {historyAccount, historyName, historyPage, observedRange, attentionActionAllowed, controlPayload, controlAllowed, callAction, controlsPanel, localEndTime, RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {diagnosticOverview} from "../../custom_components/homeostatic/frontend/evidence.mjs";
import assert from "node:assert/strict";
import {test} from "node:test";

import {DashboardStore, affectedFunctions, browseHighlights, coverageInventory, dashboardStore, deviceRegistryCoverage, recentEpisodes,
  escapeHtml, inventoryRows, locationAssessment, locationList, locationTree, monitoringLabel,
  recentActivity, sortedEpisodes, sourcePage, sourceMap, mergeDashboard} from "../../custom_components/homeostatic/frontend/model.mjs";
import {locationBranch, setBranchExpanded} from "../../custom_components/homeostatic/frontend/tree.mjs";
import {editCatalogRule, monitoringScope, monitoringTree, newCatalogRule, ruleSummary,
  scopeChoice, setScopeChoice} from "../../custom_components/homeostatic/frontend/configuration.mjs";

test("new group policy starts paused and scoped to device availability",()=>{
  const rule=newGroupPolicy([{id:"rule_1"}]);
  assert.equal(rule.enabled,false);
  assert.deepEqual(rule.match,{kind:["device"]});
  assert.deepEqual(rule.checks,["availability"]);
});

test("adding a linked person stages a route without sending or saving", () => {
  let rendered=0;
  const card={settingsDraft:{simple_notifications:{people:{}},policy:{timezone:"UTC"}},
    configuration:{notification_people:[{id:"person-1",user_id:"user-1",administrator:true}],
      notification_destinations:[{channel:"phone:device-1",user_id:"user-1",available:true}]},
    render(){rendered++;}};
  const event={type:"change",target:{dataset:{notificationAdd:""},value:"person-1"}};
  assert.equal(editInstallation(card,event),true);
  assert.deepEqual(card.settingsDraft.simple_notifications.people["person-1"],
    {level:"Important",channels:["phone:device-1"]});
  assert.equal(rendered,1);
});

test("clicking a notification dropdown leaves it mounted until selection changes", () => {
  let rendered=0;
  const card={settingsDraft:{simple_notifications:{people:{"person-1":{level:"Important",channels:[]}}}},render(){rendered++;}};
  const target={dataset:{notificationLevel:"person-1"},value:"Urgent only",closest(){return null;}};
  assert.equal(editInstallation(card,{type:"click",target}),false);
  assert.equal(rendered,0);
  assert.equal(editInstallation(card,{type:"change",target}),true);
  assert.equal(card.settingsDraft.simple_notifications.people["person-1"].level,"Urgent only");
  assert.equal(rendered,1);
});

test("notification settings expose reporting directly for older saved policies", () => {
  const settings={timings:{batch:30},notifications:false,consumer:null,policy:{timezone:"UTC",recipients:{},rules:[]},simple_notifications:{people:{},timezone:"UTC"}};
  const card={configuration:{settings,consumers:[]},settingsDraft:settings,page:"notifications",settingsSection:"timing",
    current:{data:{entry_id:"example",functions:[]}},settingsBusy:false};
  const empty=installationSettings(card);
  assert.match(empty,/<h1>Notifications<\/h1>/);
  assert.doesNotMatch(empty,/installation-nav|Problem grouping/);
  assert.doesNotMatch(empty,/Choose automation|Advanced routing and timing|Edit detailed routing/);
  assert.match(empty,/data-setting-path="notifications" disabled/);
  assert.match(empty,/data-reporting-zone/);
  assert.match(empty,/Reporting profiles/);
  assert.doesNotMatch(empty,/Set up reporting preferences|Reset to person settings/);
  card.page="configuration";
  const timing=installationSettings(card);
  assert.match(timing,/<h1>Settings<\/h1>/);
  assert.match(timing,/Standard alert batching/);
  assert.match(timing,/data-setting-path="timings.batch"/);
  assert.doesNotMatch(timing,/data-setting-path="notifications"|data-notification-add|data-settings-section="notifications"/);
  card.page="notifications";
  card.configuration.consumers=[{entity_id:"automation.alerts",name:"House alerts",state:"on"}];
  card.settingsDraft={...settings,consumer:"automation.alerts"};
  const configured=installationSettings(card);
  assert.match(configured,/Reporting profiles/);
  assert.doesNotMatch(configured,/Open Home Assistant options to clear/);
  assert.doesNotMatch(configured,/Choose automation|data-consumer-action/);
  assert.match(configured,/data-setting-path="notifications" disabled/);
  card.configuration.notification_people=[{id:"mike",name:"Michael",user_id:"user-1",administrator:true}];
  card.configuration.notification_destinations=[{channel:"phone:device-1",name:"iPhone",user_id:"user-1",available:true}];
  card.settingsDraft={...settings,consumer:null,simple_notifications:{timezone:"UTC",people:{mike:{level:"Important",channels:["phone:device-1"]}}}};
  const person=installationSettings(card);
  assert.match(person,/Michael/);
  assert.match(person,/iPhone/);
  assert.match(person,/data-notification-test="phone:device-1"/);
  assert.doesNotMatch(person,/data-setting-path="notifications" disabled/);
});

test("settings hide the household functions section and keep saved definitions untouched", () => {
  const settings={timings:Object.fromEntries(["settle","unknown_hold","retry_hold","clear_hold","rejoin_grace","startup_grace","startup_quiet_max","coalesce_count","coalesce_window","batch"].map(key=>[key,0])),notifications:false,consumer:null,policy:{timezone:"UTC",recipients:{},rules:[]},simple_notifications:{people:{},timezone:"UTC"}};
  const card={configuration:{settings,consumers:[]},settingsDraft:settings,settingsSection:"functions",
    current:{data:{entry_id:"example",functions:[{name:"Driveway"}]}},settingsBusy:false};
  const html=installationSettings(card);
  assert.doesNotMatch(html,/Household functions|Configure functions and situations|Driveway/);
  assert.match(html,/data-settings-section="timing" aria-current="page"/);
  assert.equal(card.current.data.functions[0].name,"Driveway");
});

function source(id, fields = {}) {
  return {node_id:id,name:id,kind:"entity",attributes:{},watched:true,
    requirements:[],attached_by:["passive"],excluded_by:[],...fields};
}
function example() {
  return {
    schema_version:1,available:true,
    inventory:{nodes:[source("sensor.a",{attributes:{area:["garage"]}}),source("function.f",{kind:"function"})],
      catalog:{candidates:[source("sensor.a"),source("sensor.excluded",{watched:false,excluded_by:["ignore"]})]},
      episodes:[]},
    coverage:{no_checks:[],never_observed:[],stale:[]},evidence_gaps:0,devices:[],functions:[
      {node_id:"function.f",readiness:{answer:"blocked"}},
      {node_id:"function.ok",readiness:{answer:"ready"}},
    ],areas:[{id:"garage",name:"Garage",floor_id:"main"}],floors:[{id:"main",name:"Main floor"}],
  };
}
function connection() {
  const events = new Map();
  return {
    callback:null,requests:0,cancels:0,events,
    addEventListener(name, fn) {events.set(name,fn);},
    removeEventListener(name, fn) {if(events.get(name)===fn)events.delete(name);},
    subscribeMessage(fn, command) {
      assert.equal(command.type,"homeostatic/subscribe");
      this.callback=fn;this.requests++;
      return Promise.resolve(()=>{this.cancels++;});
    },
  };
}

test("untrusted names are text, including attribute delimiters",()=>{
  assert.equal(escapeHtml('<img src=x onerror="bad()"> & \'test\''),"&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#39;test&#39;");
});
test("active consequences stay separate from potential impact",()=>{
  const data=example();
  assert.deepEqual(affectedFunctions(data,{impact:["function.f","function.ok"]}).map(x=>x.node_id),["function.f"]);
});
test("inventory retains excluded candidates and uses current registered metadata",()=>{
  const data=example();
  assert.equal(inventoryRows(data).length,2);
  assert.equal(inventoryRows(data).some(x=>x.kind==="function"),false);
  assert.deepEqual(inventoryRows(data).find(x=>x.node_id==="sensor.a").attributes,{area:["garage"]});
  assert.equal(monitoringLabel(source("x",{watched:false,excluded_by:["ignore"]})),"Excluded");
  assert.equal(monitoringLabel(source("x",{kind:"function",requirements:["sensor.a"],watched:false})),"Composite function");
  assert.equal(monitoringLabel(source("x",{watched:false})),"Unwatched");
  assert.equal(monitoringLabel(source("x")),"Watched");
});
test("coverage leads with gaps, groups devices, and bounds full-catalog search",()=>{
  const data=example();
  const integration=source("entry:owner",{name:"Garage controller",kind:"integration",entry_id:"owner"});
  const capability=source("sensor.a",{name:"Garage temperature",owner_id:"owner",
    attributes:{device:["device-1"],area:["garage"]}});
  data.inventory.nodes=[integration,capability,source("function.f",{kind:"function",requirements:["sensor.a"]})];
  const others=Array.from({length:75},(_,index)=>source(`sensor.other_${index}`,{
    name:`Office source ${index}`,watched:false,attached_by:[],owner_id:"owner",
  }));
  data.inventory.catalog={watched:3,candidates:[integration,capability,...others]};
  data.devices=[{id:"device-1",name:"Garage network device"}];
  data.coverage.never_observed=[{node_id:"sensor.a",check_id:"availability"}];
  data.evidence_gaps=1;
  data.functions=[{node_id:"function.f",name:"Garage climate",readiness:{answer:"unknown",nodes:[{node_id:"sensor.a"}]}}];
  const view=coverageInventory(data);
  assert.equal(view.summary.watched,3);
  assert.equal(view.groups[0].name,"Garage controller");
  assert.equal(view.groups[0].devices[0].name,"Garage network device");
  assert.deepEqual(view.groups[0].devices[0].sources[0].reasons,["Awaiting first observation: availability"]);
  assert.match(view.groups[0].devices[0].sources[0].guidance,/first usable health reading/);
  assert.deepEqual(view.groups[0].devices[0].sources[0].affectedFunctions,[
    {node_id:"function.f",name:"Garage climate",readiness:"unknown"},
  ]);
  const results=coverageInventory(data,"office");
  assert.equal(results.resultCount,75);
  assert.equal(results.shownCount,50);
  assert.equal(results.groups.flatMap(group=>group.devices.flatMap(device=>device.sources)).length,50);
  assert.equal(results.groups[0].devices[0].sources[0].registered,false);
});
test("Overview shows the three newest open issues while Issues retains all",()=>{
  const data=example();
  data.inventory.episodes=[
    {episode_id:"first",importance:"critical",opened_at:"2026-09-26T00:00:00Z"},
    {episode_id:"second",importance:"low",opened_at:"2026-09-26T00:00:01Z"},
    {episode_id:"third",importance:"high",opened_at:"2026-09-26T00:00:02Z"},
    {episode_id:"fourth",importance:"normal",opened_at:"2026-09-26T00:00:03Z"},
  ];
  assert.deepEqual(recentEpisodes(data).map((item)=>item.episode_id),["fourth","third","second"]);
  assert.deepEqual(sortedEpisodes(data).map((item)=>item.episode_id),["first","third","fourth","second"]);
  data.inventory.episodes=[];
  assert.deepEqual(recentEpisodes(data),[]);
});

test("registry device gaps stay visible without inventing a health check",()=>{
  const data=example();
  data.devices=[{id:"observable",name:"Observable"},{id:"client",name:"Eero client"},
    {id:"controller",name:"Controller"},{id:"disabled",name:"Disabled device",disabled:true}];
  data.inventory.catalog.candidates=[source("device:observable",{kind:"device",attributes:{device:["observable"]}}),
    source("device:controller",{kind:"device",watched:false,attributes:{device:["controller"]}})];
  const coverage=deviceRegistryCoverage(data);
  assert.equal(coverage.total,3);
  assert.equal(coverage.disabled,1);
  assert.equal(coverage.available,2);
  assert.equal(coverage.watched,1);
  assert.equal(coverage.withoutEvidence,1);
  assert.deepEqual(coverage.matches,[{id:"client",name:"Eero client"}]);
  assert.equal(deviceRegistryCoverage(data,"eero").resultCount,1);
  assert.equal(deviceRegistryCoverage(data,"missing").resultCount,0);
});

test("native locations form a floor and area tree with distinct fallback groups",()=>{
  const data=example();
  data.floors.push({id:"upper",name:"Upper floor"});
  data.areas.push({id:"yard",name:"Back yard",floor_id:null});
  const before=structuredClone(data);
  let tree=locationTree(data);
  let locations=locationList(tree);
  assert.deepEqual(tree.map(x=>x.name),[
    "Main floor","Upper floor","Areas without a floor","Unassigned",
  ]);
  assert.equal(locations.find(x=>x.id==="area:garage").sources[0].node_id,"sensor.a");
  assert.equal(locations.find(x=>x.id==="area:yard").sources.length,0);
  assert.equal(locations.find(x=>x.id==="floor:upper").children.length,0);
  assert.equal(locations.find(x=>x.id==="group:unassigned").sources.length,1);
  assert.deepEqual(browseHighlights(data).map(x=>x.id),[]);
  assert.deepEqual(data,before);
  data.inventory.nodes[0].attributes.area=["missing"];
  tree=locationTree(data);
  locations=locationList(tree);
  assert.equal(locations.find(x=>x.id==="area:garage").sources.length,0);
  assert.equal(locations.find(x=>x.id==="group:unassigned").sources.length,2);
});
test("house browsing groups devices, functions, and entities without a device",()=>{
  const data=example();
  const light=source("entity:light",{name:"Basement light",attributes:{area:["basement"],device:["fixture"]}});
  const occupancy=source("entity:occupancy",{name:"Basement occupancy",watched:false,
    attached_by:[],attributes:{area:["basement"]}});
  const lock=source("entity:lock",{name:"Basement lock",watched:false,
    attached_by:[],attributes:{area:["basement"]}});
  const integration=source("entry:controller",{kind:"integration",attributes:{}});
  data.floors=[{id:"lower",name:"Lower floor"}];
  data.areas=[{id:"basement",name:"Basement",floor_id:"lower"}];
  data.devices=[{id:"fixture",name:"Light fixture"}];
  data.inventory.nodes=[light,occupancy,integration];
  data.inventory.catalog.candidates=[light,occupancy,lock,integration];
  data.functions=[{node_id:"function:lighting",name:"Basement motion lighting",
    requirements:["entity:occupancy"],readiness:{answer:"unknown",nodes:[]}}];
  const before=structuredClone(data);
  const locations=locationList(locationTree(data));
  const area=locations.find((location)=>location.id==="area:basement");
  assert.deepEqual(area.devices.map((device)=>[device.name,device.sources.map((item)=>item.node_id)]),
    [["Light fixture",["entity:light"]]]);
  assert.deepEqual(area.signals.map((item)=>item.node_id),["entity:lock","entity:occupancy"]);
  assert.deepEqual(area.functions.map((item)=>item.name),["Basement motion lighting"]);
  assert.equal(area.summary,"1 device · 1 function · 2 entities without a device");
  assert.deepEqual(browseHighlights(data).map((location)=>location.id),["area:basement"]);
  assert.equal(locations.find((location)=>location.id==="group:unassigned"),undefined);
  assert.deepEqual(data,before);
  data.coverage.never_observed=[{node_id:"entity:light",check_id:"availability"}];
  data.inventory.episodes=[{episode_id:"light-open",anchor:"entity:light",importance:"normal",
    impact:[],opened_at:"2026-09-26T12:00:00Z"}];
  const assessment=locationAssessment(data,area);
  assert.deepEqual(assessment.evidenceGaps,[light]);
  assert.deepEqual(assessment.requiredUnselected,[occupancy]);
  assert.deepEqual(assessment.episodes,data.inventory.episodes);
});
test("location branches collapse without changing selection",()=>{
  const floor={id:"floor:main",name:"Main <floor>",summary:"1 device",children:[
    {id:"area:kitchen",name:"Kitchen",summary:"1 area signal",children:[]},
  ]};
  let collapsed=new Set();
  let html=locationBranch(floor,"area:kitchen",collapsed);
  assert.match(html,/aria-expanded="true"/);
  assert.match(html,/data-location-toggle="floor:main"/);
  assert.match(html,/aria-level="2" aria-selected="true"/);
  assert.match(html,/Main &lt;floor&gt;/);
  assert.match(html,/class="location-copy"><span class="location-name">Main &lt;floor&gt;<\/span><span class="location-count">1 device<\/span>/);
  collapsed=setBranchExpanded(collapsed,"floor:main",false);
  assert.equal(collapsed.has("floor:main"),true);
  html=locationBranch(floor,"area:kitchen",collapsed);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/role="group" hidden/);
  collapsed=setBranchExpanded(collapsed,"floor:main",true);
  assert.equal(collapsed.has("floor:main"),false);
});
test("problem ordering uses importance and stable onset",()=>{
  const data=example();
  data.inventory.episodes=[
    {episode_id:"low",importance:"normal",opened_at:"2026-09-25T10:00:00Z"},
    {episode_id:"new",importance:"high",opened_at:"2026-09-25T11:00:00Z"},
    {episode_id:"old",importance:"high",opened_at:"2026-09-25T09:00:00Z"},
  ];
  assert.deepEqual(sortedEpisodes(data).map(x=>x.episode_id),["old","new","low"]);
  assert.equal(data.inventory.episodes[0].episode_id,"low");
});
test("recent activity translates monitoring changes without making JSON primary copy",()=>{
  const data=example();
  data.inventory.nodes=[source("entry:music",{name:"Music Assistant",kind:"integration",disabled:true}),
    source("sensor.stairs",{name:"Basement Stairs"})];
  data.inventory.catalog.candidates=data.inventory.nodes;
  data.inventory.enrollment_changes=[
    {node_id:"entry:music",at:"2026-09-25T10:00:00Z",reason:"source_enrolled",
      after:data.inventory.nodes[0]},
    {node_id:"sensor.stairs",at:"2026-09-25T10:01:00Z",reason:"rules_changed",
      before:source("sensor.stairs"),after:source("sensor.stairs",{watched:false,attached_by:[],excluded_by:["ignore_stairs"]})},
  ];
  data.coverage.never_observed=[];
  const activity=recentActivity(data);
  assert.equal(activity[0].title,"Basement Stairs was excluded from monitoring");
  assert.equal(activity[0].summary,"Homeostatic will no longer assess this source under the current rules.");
  assert.equal(activity[1].title,"Music Assistant is now monitored");
  assert.match(activity[1].summary,/disabled in Home Assistant/);
  assert.deepEqual(activity[1].technical,data.inventory.enrollment_changes[0]);
});
test("recent activity groups one enrollment burst and reports incomplete evidence",()=>{
  const data=example();
  data.inventory.nodes=[source("sensor.a",{name:"Main Floor Lights"}),
    source("sensor.b",{name:"Basement Stairs"}),source("sensor.c",{name:"Cabin Fan"})];
  data.inventory.catalog.candidates=data.inventory.nodes;
  data.inventory.enrollment_changes=data.inventory.nodes.map((item,index)=>({
    node_id:item.node_id,at:`2026-09-25T10:00:0${index}Z`,reason:"source_enrolled",batch:"demo-load",after:item,
  }));
  data.coverage.never_observed=[{node_id:"sensor.b",check_id:"availability"}];
  const activity=recentActivity(data);
  assert.equal(activity.length,1);
  assert.equal(activity[0].title,"3 newly discovered sources matched monitoring rules");
  assert.match(activity[0].summary,/1 source needs current evidence review/);
  assert.deepEqual(activity[0].sources.map((item)=>item.name),
    ["Cabin Fan","Basement Stairs","Main Floor Lights"]);
});
test("initial scope remains a load snapshot with an exact count",()=>{
  const data=example();
  data.inventory.enrollment_changes=[{at:"2026-09-25T10:00:00Z",reason:"initial_scope",
    total:51,sources:[{node_id:"sensor.a",name:"Original name",kind:"entity",attached_by:["passive"]}]}];
  const activity=recentActivity(data);
  assert.equal(activity[0].kind,"scope");
  assert.match(activity[0].title,/51 sources matched monitoring rules/);
  assert.equal(activity[0].sources[0].name,"sensor.a");
  assert.deepEqual(activity[0].sources[0].rules,["passive"]);
  assert.equal(activity[0].total,51);
});
test("activity coverage selection keeps only its sources within the render bound",()=>{
  const data=example();
  const selected=coverageInventory(data,"",50,new Set(["sensor.a"]));
  assert.equal(selected.resultCount,1);
  assert.equal(selected.groups[0].devices[0].sources[0].source.node_id,"sensor.a");
});
test("cards share a stream, disconnect is not healthy, and last release cleans up",async()=>{
  const client=connection();
  const store=dashboardStore(client);
  assert.equal(dashboardStore(client),store);
  const seen=[];
  const first=store.listen(state=>seen.push(state.status));
  const second=store.listen(()=>{});
  await Promise.resolve();
  assert.equal(client.requests,1);
  client.callback(example());
  assert.equal(store.state.status,"current");
  client.events.get("disconnected")();
  assert.equal(store.state.status,"disconnected");
  client.events.get("ready")();
  assert.equal(store.state.status,"loading");
  client.callback(example());
  assert.equal(store.state.status,"current");
  first();
  assert.equal(client.cancels,0);
  second();
  await Promise.resolve();
  assert.equal(client.cancels,1);
  assert.equal(client.events.size,0);
  assert.equal(store.state.data,null);
});
test("late subscribe completion and late data after unmount are discarded",async()=>{
  const client=connection();
  let resolve;
  client.subscribeMessage=function(fn){this.callback=fn;return new Promise(done=>{resolve=done;});};
  const store=new DashboardStore(client);
  const stop=store.listen(()=>{});
  stop();
  await Promise.resolve();
  client.callback(example());
  resolve(()=>{client.cancels++;});
  await Promise.resolve();
  assert.equal(client.cancels,1);
  assert.equal(store.state.data,null);
});
test("immediate page replacement keeps one stream and its current snapshot",async()=>{
  const client=connection();
  const store=dashboardStore(client);
  const first=store.listen(()=>{});
  await Promise.resolve();
  const snapshot=example();
  client.callback(snapshot);
  first();
  const seen=[];
  const second=store.listen(state=>seen.push(state));
  await Promise.resolve();
  assert.equal(client.requests,1);
  assert.equal(client.cancels,0);
  assert.deepEqual(seen,[{status:"current",data:snapshot,error:null}]);
  second();
  await Promise.resolve();
  assert.equal(client.cancels,1);
  assert.equal(store.state.data,null);
  const third=store.listen(()=>{});
  assert.equal(client.requests,2);
  assert.equal(store.state.status,"loading");
  client.callback(snapshot);
  assert.equal(store.state.status,"current");
  third();
  await Promise.resolve();
});

for (const [name,payload,status] of [
  ["available",example(),"current"],
  ["unavailable",{schema_version:1,available:false},"unavailable"],
  ["incompatible",{schema_version:9,available:true},"error"],
]) {
  for (const order of ["ready-first","snapshot-first"]) {
    test(`reconnect preserves ${name} result with ${order}`,async()=>{
      const client=connection();
      const store=dashboardStore(client);
      const stop=store.listen(()=>{});
      client.callback(example());
      client.events.get("disconnected")();
      const actions={ready:()=>client.events.get("ready")(),snapshot:()=>client.callback(payload)};
      const sequence={"ready-first":["ready","snapshot"],"snapshot-first":["snapshot","ready"]};
      sequence[order].forEach(action=>actions[action]());
      assert.equal(store.state.status,status);
      stop();
      await Promise.resolve();
    });
  }
}

function pagedExample(revision = 1, count = 601) {
  const full = example();
  const sections = {nodes:full.inventory.nodes,
    candidates:Array.from({length:count},(_,i)=>source(`candidate-${i}`,{name:`Candidate ${i}`})),
    targets:[],enrollment_changes:[],areas:full.areas,devices:full.devices,floors:full.floors};
  const data = {...full,schema_version:3,catalog_revision:revision,catalog_loaded:false,
    catalog_sections:Object.fromEntries(Object.entries(sections).map(([key,rows])=>[key,rows.length])),
    inventory:{...full.inventory,catalog:{...full.inventory.catalog,candidates:[]}},areas:[],devices:[],floors:[]};
  return {data,sections};
}

function catalogPage(request, sections) {
  const rows = sections[request.section];
  const end = Math.min(request.offset + request.limit,rows.length);
  return {revision:request.revision,section:request.section,offset:request.offset,
    total:rows.length,items:rows.slice(request.offset,end),next_offset:end < rows.length ? end : null};
}

test("catalog loads only on demand, once for shared cards, with latest evidence",async()=>{
  const {data,sections}=pagedExample();
  const client=connection(), store=dashboardStore(client), requests=[];
  const stop=store.listen(()=>{});
  client.callback(data);
  client.sendMessagePromise=async request=>{
    requests.push(request);
    client.callback({...data,updated_at:"new evidence",inventory:{...data.inventory,episodes:[]}});
    assert.equal(store.state.data.catalog_loaded,false);
    return catalogPage(request,sections);
  };
  assert.equal(requests.length,0);
  const first=store.ensureCatalog(), second=store.ensureCatalog();
  assert.equal(first,second);
  await first;
  assert.equal(store.state.data.catalog_loaded,true);
  assert.equal(store.state.data.updated_at,"new evidence");
  assert.deepEqual(store.state.data.inventory.episodes,[]);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,sections.candidates);
  assert.equal(inventoryRows(store.state.data).some(row=>row.name==="Candidate 600"),true);
  assert.deepEqual(requests.filter(r=>r.section==="candidates").map(r=>r.offset),[0,200,400,600]);
  const cached=store.state.data.inventory.catalog;
  client.callback(data);
  assert.equal(store.state.data.inventory.catalog,cached);
  stop();await Promise.resolve();
});

test("a later catalog revision keeps the complete previous list visible during replacement",async()=>{
  const old=pagedExample(1,2), fresh=pagedExample(2,3);
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});
  client.callback(old.data);
  client.sendMessagePromise=async request=>catalogPage(request,old.sections);
  await store.ensureCatalog();
  const previous=store.state.data.inventory.catalog.candidates;
  let release;
  client.sendMessagePromise=async request=>{
    if(request.section==="nodes")await new Promise(resolve=>{release=resolve;});
    return catalogPage(request,fresh.sections);
  };
  client.callback(fresh.data);
  assert.equal(store.catalogTask,null);
  const pending=store.ensureCatalog();
  await Promise.resolve();
  assert.equal(store.state.data.catalog_loaded,true);
  assert.equal(store.state.data.catalog_stale,true);
  assert.equal(store.state.data.inventory.catalog.candidates,previous);
  assert.equal(store.state.data.catalog_revision,2);
  release();await pending;
  assert.equal(store.state.data.catalog_stale,false);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,fresh.sections.candidates);
  stop();await Promise.resolve();
});

test("a failed replacement retains browsing and retries the new revision",async()=>{
  const old=pagedExample(1,2), fresh=pagedExample(2,3);
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});
  client.callback(old.data);
  client.sendMessagePromise=async request=>catalogPage(request,old.sections);
  await store.ensureCatalog();
  const previous=store.state.data.inventory.catalog.candidates;
  client.callback(fresh.data);
  client.sendMessagePromise=async()=>{throw new Error("Catalog page unavailable");};
  await store.ensureCatalog();
  assert.equal(store.state.data.catalog_stale,true);
  assert.equal(store.state.data.inventory.catalog.candidates,previous);
  assert.equal(store.state.catalogError,"Catalog page unavailable");
  client.sendMessagePromise=async request=>catalogPage(request,fresh.sections);
  await store.ensureCatalog(true);
  assert.equal(store.state.catalogError,null);
  assert.equal(store.state.data.catalog_stale,false);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,fresh.sections.candidates);
  stop();await Promise.resolve();
});

test("a new catalog revision cancels old pages and coalesces replacement loading",async()=>{
  const old=pagedExample(1), fresh=pagedExample(2,1);
  const client=connection(), store=dashboardStore(client), requests=[];
  const stop=store.listen(()=>{});
  client.callback(old.data);
  let finish;
  client.sendMessagePromise=request=>{
    requests.push(request);
    return new Promise(resolve=>{finish=()=>resolve(catalogPage(request,old.sections));});
  };
  const pending=store.ensureCatalog();await Promise.resolve();
  client.callback(fresh.data);
  client.sendMessagePromise=async request=>{requests.push(request);return catalogPage(request,fresh.sections);};
  finish();await pending;await store.catalogTask;
  assert.equal(store.state.data.catalog_revision,2);
  assert.equal(store.state.data.catalog_loaded,true);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,fresh.sections.candidates);
  assert.equal(requests.filter(request=>request.revision===1).length,1);
  stop();await Promise.resolve();
});

test("a failed catalog is explicit and retries without replacing current evidence",async()=>{
  const {data,sections}=pagedExample();
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});client.callback(data);
  client.sendMessagePromise=async()=>{throw new Error("Read failed");};
  await store.ensureCatalog();
  assert.equal(store.state.status,"current");
  assert.equal(store.state.catalogError,"Read failed");
  assert.equal(store.state.data.catalog_loaded,false);
  client.sendMessagePromise=async request=>catalogPage(request,sections);
  const retry=store.ensureCatalog(true);
  assert.equal(store.state.catalogError,null);
  await retry;
  assert.equal(store.state.catalogError,null);
  assert.equal(store.state.data.catalog_loaded,true);
  stop();await Promise.resolve();
});

test("reconnect loads a new catalog without waiting for an abandoned request",async()=>{
  const {data,sections}=pagedExample();
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});client.callback(data);
  let finish;
  client.sendMessagePromise=request=>new Promise(resolve=>{finish=()=>resolve(catalogPage(request,sections));});
  const pending=store.ensureCatalog();await Promise.resolve();
  client.events.get("disconnected")();
  client.sendMessagePromise=async request=>catalogPage(request,sections);
  client.callback(data);await store.ensureCatalog();
  assert.equal(store.state.data.catalog_loaded,true);
  finish();await pending;
  assert.equal(store.state.data.catalog_loaded,true);
  stop();await Promise.resolve();
});

test("malformed catalog pages cannot install partial search results",async()=>{
  const {data,sections}=pagedExample();
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});client.callback(data);
  client.sendMessagePromise=async request=>({...catalogPage(request,sections),next_offset:123});
  await store.ensureCatalog();
  assert.match(store.state.catalogError,/Incomplete source catalog/);
  assert.equal(store.state.data.catalog_loaded,false);
  stop();await Promise.resolve();
});

for (const [name,invalidate] of [
  ["disconnect",client=>client.events.get("disconnected")()],
  ["unavailable",client=>client.callback({schema_version:3,available:false})],
  ["unsubscribe",(_client,stop)=>stop()],
]) test(`catalog completion after ${name} is discarded`,async()=>{
  const {data,sections}=pagedExample();
  const client=connection(), store=dashboardStore(client);
  const stop=store.listen(()=>{});client.callback(data);
  let finish;
  client.sendMessagePromise=request=>new Promise(resolve=>{finish=()=>resolve(catalogPage(request,sections));});
  const pending=store.ensureCatalog();await Promise.resolve();
  invalidate(client,stop);await Promise.resolve();finish();await pending;
  assert.notEqual(store.state.data?.catalog_loaded,true);
  stop();await Promise.resolve();
});

test("reconnect requires a full compact baseline even at the same catalog revision",async()=>{
  const client=connection();
  const store=dashboardStore(client);
  const stop=store.listen(()=>{});
  const full={...example(),schema_version:2,catalog_revision:3,inventory_changed:true};
  client.callback(full);
  assert.equal(store.state.status,"current");
  client.events.get("disconnected")();
  client.events.get("ready")();
  client.callback({schema_version:2,available:true,catalog_revision:3,inventory_changed:false,inventory:{}});
  assert.equal(store.state.status,"error");
  assert.equal(store.state.data,null);
  client.callback(full);
  assert.equal(store.state.status,"current");
  stop();
  await Promise.resolve();
});

test("unavailable runtime, incompatible payload, and retry failures remain explicit",async()=>{
  const client=connection();
  const store=new DashboardStore(client);
  const stop=store.listen(()=>{});
  await Promise.resolve();
  client.callback({schema_version:1,available:false});
  assert.equal(store.state.status,"unavailable");
  client.callback({schema_version:9,available:true});
  assert.equal(store.state.status,"error");
  client.subscribeMessage=()=>Promise.reject({message:"Access denied"});
  store.retry();
  await Promise.resolve();await Promise.resolve();
  assert.equal(store.state.status,"error");
  assert.equal(store.state.error,"Access denied");
  stop();
});


test("only explicit HA reauthentication asks for sign-in",()=>{
  const entry=source("entry:bathroom",{kind:"integration",name:"Master Bathroom",entry_id:"bathroom",attributes:{domain:["nuheat"]}});
  const describe=(reason,message)=>integrationProblem(entry,[{node_id:entry.node_id,reason,message}]);
  const setup=describe("setup_error","Master Bathroom: Unable to sign in to provider");
  assert.equal(setup.reported,"Unable to sign in to provider");
  assert.equal(setup.headline,"Connection couldn't start");
  assert.equal(setup.integrationLabel,"Review NuHeat connection");
  assert.equal(setup.integrationUrl,"/config/integrations/integration/nuheat#config_entry=bathroom");
  assert.equal(setup.logsUrl,"/config/logs?filter=nuheat");
  const auth=describe("auth_required","Session expired; TimeoutError while signing in");
  assert.equal(auth.headline,"Sign-in required");
  assert.equal(auth.integrationLabel,"Sign in again");
  assert.equal(auth.timedOut,false);
  assert.match(auth.nextStep,/sign-in prompt/);
  assert.equal(describe("setup_error","Master Bathroom: setup error").reported,"");
  assert.match(describe("setup_error","setup error").summary,/did not report a cause/);
});

test("NuHeat timeout offers an app check without guessing invalid credentials or heating failure",()=>{
  const entry=source("entry:bathroom",{kind:"integration",name:"Master Bathroom",attributes:{domain:["nuheat"]}});
  const result=integrationProblem(entry,[{reason:"setup_retry",message:"HTTPSConnectionPool: /api/authenticate/user (Caused by ConnectTimeoutError: connection timed out)"}]);
  assert.equal(result.headline,"NuHeat connection timed out");
  assert.equal(result.integration,"NuHeat");
  assert.match(result.nextStep,/Try the NuHeat app/);
  assert.match(result.summary,/try again automatically/);
  assert.doesNotMatch(result.summary+result.nextStep,/password|credentials|heating|HTTPS|authenticate/);
});

test("receiver and unknown integration timeouts do not assume a cloud service",()=>{
  const entry=source("entry:receiver",{kind:"integration",name:"Home Theater",attributes:{domain:["denonavr"]}});
  const reason={reason:"setup_retry",message:"TimeoutException for http://192.0.2.15/status.xml"};
  const result=integrationProblem(entry,[reason]);
  assert.equal(result.headline,"Receiver connection timed out");
  assert.match(result.nextStep,/powered on and connected to your network/);
  assert.equal(result.integrationLabel,"Review receiver connection");
  const generic=integrationProblem({...entry,attributes:{domain:["custom"]}},[reason]);
  assert.equal(generic.headline,"Connection timed out");
  assert.doesNotMatch(generic.nextStep,/NuHeat|receiver|cloud/);
});

test("native links encode untrusted identifiers and absent or unsupported findings stay readable",()=>{
  const entry=source("entry:a",{kind:"integration",entry_id:'a&x="bad"',attributes:{domain:['test/?"bad']}});
  const result=integrationProblem(entry,[{reason:"setup_error"}]);
  assert.equal(result.integrationUrl,"/config/integrations/integration/test%2F%3F%22bad#config_entry=a%26x%3D%22bad%22");
  assert.equal(result.logsUrl,"/config/logs?filter=test%2F%3F%22bad");
  assert.equal(result.missingDetail,true);
  assert.equal(integrationProblem({...entry,attributes:{}},[]).integrationUrl,"/config/integrations");
  assert.equal(integrationProblem(source("entity:a"),[{reason:"unavailable"}]),null);
  for(const findings of [[],[{reason:"dependents_failing"}],[{reason:"__proto__"}],[{node_id:"entry:other",reason:"setup_error"}]]){
    const fallback=integrationProblem(entry,findings);
    assert.equal(fallback.headline,"Connection status isn't confirmed");
    assert.equal(fallback.tone,"uncertain");
  }
});

test("a retry keeps the last timeout and its time distinct from current activity",()=>{
  const entry=source("entry:receiver",{kind:"integration",name:"Home Theater",attributes:{domain:["denonavr"]}});
  const failure={reason:"setup_retry",message:"Connection timed out",observed_at:"2026-09-25T15:42:00Z"};
  const current={reason:"setup_in_progress",message:"setup in progress",observed_at:"2026-09-25T15:44:00Z"};
  const evidence={current,last_failure:failure};
  const result=integrationProblem(entry,[],()=>null,evidence);
  assert.equal(result.headline,"Receiver connection timed out");
  assert.equal(result.reportedAt,failure.observed_at);
  assert.equal(result.historical,true);
  assert.match(result.summary,/trying again/);
  assert.equal(result.progress,"Retrying automatically");
  assert.equal(result.currentReason,"setup_in_progress");
  assert.equal(integrationProblem(entry,[],()=>null,{current,last_failure:null}).headline,"Connection is starting");
  assert.equal(evidence.last_failure,failure);
});

test("historical errors cannot override disablement, reauthentication or recovery",()=>{
  const entry=source("entry:music",{kind:"integration",name:"Music Assistant"});
  const last_failure={reason:"setup_retry",message:"TimeoutException"};
  const describe=(reason)=>integrationProblem(entry,[{reason:"stale"}],()=>null,{current:{reason},last_failure});
  const disabled=describe("disabled");
  assert.equal(disabled.headline,"Disabled in Home Assistant");
  assert.equal(disabled.tone,"neutral");
  assert.match(disabled.nextStep,/If this is intentional/);
  assert.equal(disabled.timedOut,false);
  assert.equal(describe("auth_required").integrationLabel,"Sign in again");
  const running=describe("loaded");
  assert.equal(running.headline,"Checking recovery");
  assert.equal(running.reported,"");
  assert.equal(running.needsAction,false);
  assert.match(running.summary,/once recovery is confirmed/);
  const healthy=integrationProblem(entry,[],()=>null,{current:{reason:"loaded"},last_failure},false);
  assert.equal(healthy.headline,"Connection available");
  assert.doesNotMatch(healthy.summary,/problem|recovery/);
  assert.equal(healthy.needsAction,false);
});

test("history keeps terminal outcomes distinct and pages retained records", () => {
  const history={episodes:Array.from({length:45},(_,i)=>({episode:{episode_id:`old-${i}`,anchor:`source-${i}`,reasons:[{message:i===42?"Lost power":"Unavailable"}]},source:{name:`Room ${i}`},resolution:i%2?"removed":"cleared"}))};
  const first=historyPage(history);
  assert.equal(first.rows.length,20);
  assert.equal(first.total,45);
  assert.equal(first.pages,3);
  assert.equal(historyPage(history,"","",99).rows.length,5);
  assert.equal(historyPage(history,"LOST POWER").rows[0].episode.episode_id,"old-42");
  assert.equal(historyPage(history,"","removed").total,22);
  assert.equal(historyPage(history,"nothing","",2).page,0);
  assert.equal(historyPage(null).total,0);
  assert.match(RESOLUTIONS.removed[1],/Recovery was not established/);
  assert.match(RESOLUTIONS.absorbed[1],/Recovery was not established/);
});

test("control request requires explicit bounded expiry and preserves target and scope", () => {
  const now=Date.parse("2026-09-25T12:00:00Z");
  const shelf={kind:"shelve",target:"episode-1",untilLocal:"2026-09-25T13:00:00Z",reason:"Replacing sensor",includeDependents:true};
  assert.deepEqual(controlPayload(shelf,now),{episode_id:"episode-1",until:"2026-09-25T13:00:00.000Z",reason:"Replacing sensor"});
  assert.deepEqual(controlPayload({...shelf,kind:"maintenance",target:"sensor.a"},now),{node_id:"sensor.a",until:"2026-09-25T13:00:00.000Z",reason:"Replacing sensor",include_dependents:true});
  for(const untilLocal of ["","not-a-date","2026-09-25T12:00:00Z","2026-10-02T12:00:01Z"]){
    assert.throws(()=>controlPayload({...shelf,untilLocal},now),/end time/);
  }
  assert.doesNotThrow(()=>controlPayload({...shelf,untilLocal:"2026-10-02T12:00:00Z"},now));
  assert.throws(()=>controlPayload({...shelf,reason:"a".repeat(501)},now),/500/);
});

test("short maintenance choices produce an explicit local end time", () => {
  const now=Date.parse("2026-09-25T12:00:00Z");
  for(const minutes of [30,120,240]){
    assert.equal(new Date(localEndTime(minutes,now)).getTime(),now+minutes*60000);
  }
});

test("diagnostic summary states monitoring limits and configured impact", () => {
  const entry=source("entry:theater",{name:"Home Theater",kind:"integration"});
  const ready=diagnosticOverview(entry,{readiness:{answer:"ready"}});
  assert.match(ready.checks,/connection state/);
  assert.match(ready.checks,/not physically verified/);
  assert.match(ready.impact,/selected Home Assistant evidence/);
  const open=diagnosticOverview(entry,{readiness:{answer:"ready"}},[{name:"Movie night"}],true);
  assert.match(open.assessment,/still awaiting confirmed recovery/);
  assert.match(open.impact,/selected Home Assistant evidence/);
  const disabled=diagnosticOverview({...entry,disabled:true},{readiness:{answer:"unknown"}});
  assert.match(disabled.monitoring,/cannot assess its health/);
  assert.match(disabled.assessment,/cannot establish readiness/);
  assert.match(diagnosticOverview({...entry,kind:"situation"},{readiness:null},[],true).impact,/selected Home Assistant evidence/);
});

test("controls require current admin access and an eligible live target", () => {
  const data=example();data.inventory.episodes=[{episode_id:"active"}];
  const current={status:"current",data};
  const shelf={kind:"shelve",target:"active"};
  assert.equal(controlAllowed(current,true,shelf),true);
  assert.equal(controlAllowed(current,false,shelf),false);
  assert.equal(controlAllowed({...current,status:"disconnected"},true,shelf),false);
  assert.equal(controlAllowed(current,true,{...shelf,target:"resolved"}),false);
  assert.equal(controlAllowed(current,true,{kind:"maintenance",target:"sensor.a"}),true);
  assert.equal(controlAllowed(current,true,{kind:"maintenance",target:"function.f"}),false);
  data.inventory.nodes.push(source("situation.a",{kind:"situation"}));
  assert.equal(controlAllowed(current,true,{kind:"maintenance",target:"situation.a"}),false);
});

test("native actions request responses and never retry ambiguous failures", async () => {
  const calls=[];
  const hass={async callWS(message){calls.push(message);return{response:{control:{target:"one"}}};}};
  assert.deepEqual(await callAction(hass,"shelve",{episode_id:"one"}),{control:{target:"one"}});
  assert.deepEqual(calls,[{type:"call_service",domain:"homeostatic",service:"shelve",service_data:{episode_id:"one"},return_response:true}]);
  let attempts=0;
  await assert.rejects(callAction({async callWS(){attempts++;throw new Error("Disconnected");}},"shelve",{}),/Disconnected/);
  assert.equal(attempts,1);
  await assert.rejects(callAction({async callWS(){return{};}},"shelve",{}),/Inspect active controls/);
});

test("saved control names and reasons render as text", () => {
  const data=example();data.inventory.episodes=[];
  data.inventory.operator_controls=[{action:"maintenance",target:"sensor.a",until:"2026-09-25T13:00:00Z",reason:'<img src=x onerror="fail()">',include_dependents:true}];
  const html=controlsPanel(data);
  assert.ok(!html.includes("<img"));
  assert.match(html,/&lt;img/);
  assert.match(html,/Existing problems and alerts remain active/);
});


test("compact evidence updates preserve static inventory and reject missing baselines",()=>{
  const initial={...example(),schema_version:2,catalog_revision:1,inventory_changed:true};
  const update={schema_version:2,available:true,catalog_revision:1,inventory_changed:false,inventory:{episodes:[{episode_id:"one"}]},functions:[]};
  const merged=mergeDashboard(initial,update);
  assert.equal(merged.inventory.catalog,initial.inventory.catalog);
  assert.equal(merged.inventory.nodes,initial.inventory.nodes);
  assert.equal(merged.areas,initial.areas);
  assert.equal(merged.devices,initial.devices);
  assert.deepEqual(merged.inventory.episodes,[{episode_id:"one"}]);
  assert.equal(sourceMap(merged),sourceMap(initial));
  assert.notEqual(locationTree(merged),locationTree(initial));
  assert.deepEqual(locationTree(merged).flatMap((location)=>location.functions),[]);
  assert.equal(mergeDashboard(merged,initial),initial);
  assert.throws(()=>mergeDashboard(null,update),/out of date/);
  assert.throws(()=>mergeDashboard({...initial,catalog_revision:2},update),/out of date/);
  assert.throws(()=>mergeDashboard({...initial,available:false},update),/out of date/);
  assert.throws(()=>mergeDashboard(null,{...initial,inventory:{}}),/Incomplete/);
  assert.equal(mergeDashboard(initial,{schema_version:2,available:false}).available,false);
});

test("source search covers all rows while each rendered page stays bounded",()=>{
  const rows=Array.from({length:6000},(_,i)=>source(`sensor.${i}`,{name:`Device ${i}`}));
  assert.equal(sourcePage(rows).rows.length,50);
  assert.equal(sourcePage(rows).pages,120);
  assert.equal(sourcePage(rows,"",119).rows.at(-1).name,"Device 5999");
  assert.equal(sourcePage(rows,"Device 5999").rows[0].node_id,"sensor.5999");
  assert.equal(sourcePage(rows,"Device 5999",119).page,0);
  assert.equal(sourcePage(rows,"missing").total,0);
});

test("invalid compact data clears the view and a new full baseline restores it",async()=>{
  const client=connection();const store=new DashboardStore(client);const stop=store.listen(()=>{});
  await Promise.resolve();
  client.callback({schema_version:2,available:true,catalog_revision:2,inventory_changed:false,inventory:{}});
  assert.equal(store.state.status,"error");
  assert.equal(store.state.data,null);
  client.callback({...example(),schema_version:2,catalog_revision:3,inventory_changed:true});
  assert.equal(store.state.status,"current");
  stop();
});


const light = source("entity:light", {name:"Closet",entity_id:"light.closet",owner_id:"matter",
  attributes:{domain:["light"],area:["upstairs"],device:["device/one"]}});
const matter = source("entry:matter", {kind:"integration",attributes:{domain:["matter"]}});
const entityStatus = (reason, answer = "blocked", nodes = []) => ({
  current:reason ? {reason} : null,
  explanation:{findings:reason ? [{node_id:light.node_id,reason}] : [],nodes},readiness:{answer},
});

test("light brief names capability, area and provider without diagnosing the physical fault",()=>{
  const result=entityProblem(light,entityStatus("unavailable"),matter,[{id:"upstairs",name:"Upstairs"}],()=>"Matter");
  assert.equal(result.context,"Light · Upstairs · via Matter");
  assert.equal(result.headline,"Light unavailable");
  assert.match(result.summary,/can't tell whether this light is on or off/);
  assert.match(result.nextStep,/wall switch, if it has one/);
  assert.doesNotMatch(result.summary,/broken|lost power|dead battery/);
  assert.equal(result.deviceUrl,"/config/devices/device/device%2Fone");
  assert.equal(result.entityLabel,"Open light details");
  assert.equal(result.connectionNote,null);
});

test("occupancy, motion and generic sensor guidance follows actual metadata",()=>{
  for(const deviceClass of ["occupancy","motion","temperature"]){
    const sensor={...light,entity_id:"binary_sensor.hall",attributes:{domain:["binary_sensor"],device_class:[deviceClass]}};
    const result=entityProblem(sensor,entityStatus("unavailable"));
    assert.equal(result.summary.includes("detection reading"),deviceClass!=="temperature");
    assert.equal(result.nextStep.includes("someone enters"),deviceClass!=="temperature");
    assert.equal(result.nextStep.includes("wall switch"),false);
  }
  const virtual={...light,entity_id:"sensor.virtual",attributes:{}};
  assert.doesNotMatch(entityProblem(virtual,entityStatus("unavailable")).nextStep,/battery|wall switch/);
});

for(const [reason,headline] of [
  ["value_unknown","Value unknown"],
  ["state_unknown","Waiting for a known state"],["source_missing","No current state found"],
  ["restored_state","Waiting for a fresh reading"],["stale","Reading is out of date"],
  ["disabled","Disabled in Home Assistant"],["__proto__","Current condition isn't confirmed"],
]){
  test(`entity ${reason} stays distinct from physical failure and recovery`,()=>{
    const result=entityProblem(light,entityStatus(reason,"unknown"));
    assert.equal(result.headline,headline);
    assert.doesNotMatch(result.summary,/is broken|receiving a state.*again/);
  });
}

test("entity recovery needs a current observation or ready query, not missing findings",()=>{
  assert.equal(entityProblem(light,entityStatus(null,"ready")).headline,"Checking recovery");
  assert.equal(entityProblem(light,entityStatus(null,"ready"),null,[],()=>null,false).headline,"Light available");
  assert.equal(entityProblem(light,{...entityStatus(null,"blocked"),current:{reason:"available"}}).headline,"Checking recovery");
  assert.equal(entityProblem(light,null).currentReason,"unknown");
  assert.equal(entityProblem({...light,watched:false},entityStatus(null,"ready")).currentReason,"unknown");
  assert.equal(entityProblem({...light,disabled:true},entityStatus(null,"ready")).currentReason,"disabled");
  const dependencies=[{node_id:matter.node_id,own:"fail"}];
  const blocked=entityProblem(light,entityStatus(null,"blocked",dependencies),matter);
  assert.equal(blocked.headline,"Connection needs attention");
  assert.equal(blocked.connectionNode,matter.node_id);
  const unavailable=entityProblem(light,entityStatus("unavailable","blocked",dependencies),matter);
  assert.equal(unavailable.headline,"Light unavailable");
  assert.match(unavailable.connectionNote,/also needs attention/);
  assert.doesNotMatch(unavailable.summary,/caused by|because/);
  assert.equal(entityProblem(matter,null),null);
});

test("monitoring editor preserves complete match values and removes empty fields",()=>{
  const rule=newCatalogRule([{id:"rule_2"}]);
  assert.equal(rule.id,"rule_3");
  editCatalogRule(rule,"match:domain","sensor, binary_sensor, ");
  editCatalogRule(rule,"match:entity","sensor.garage");
  assert.deepEqual(rule.match,{domain:["sensor","binary_sensor"],entity:["sensor.garage"]});
  editCatalogRule(rule,"match:domain","  ");
  editCatalogRule(rule,"enabled",false);
  assert.deepEqual(rule.match,{entity:["sensor.garage"]});
  assert.equal(rule.enabled,false);
});

test("monitoring choices browse integrations, devices, and unassigned entities",()=>{
  const data=example();
  const entry=source("entry:music",{name:"Music Assistant",kind:"integration",entry_id:"music"});
  const speaker=source("entity:registry:speaker",{name:"Kitchen speaker",owner_id:"music",
    entity_id:"media_player.kitchen",attributes:{entity:["registry:speaker"],device:["speaker-device"]}});
  const signal=source("entity:registry:signal",{name:"Music signal",owner_id:"music",
    entity_id:"sensor.music",attributes:{entity:["registry:signal"]}});
  const summary=source("device:speaker-device",{name:"Kitchen speaker device",kind:"device",
    attributes:{kind:["device"],device:["speaker-device"],integration:["music"]}});
  data.inventory.nodes=[entry,speaker,signal,summary];
  data.inventory.catalog.candidates=[entry,speaker,signal,summary];
  data.devices=[{id:"speaker-device",name:"Kitchen speaker device"}];
  const groups=monitoringTree(data);
  assert.equal(groups[0].name,"Music Assistant");
  assert.equal(groups[0].devices[0].name,"Kitchen speaker device");
  assert.equal(groups[0].devices[0].entities[0].name,"Kitchen speaker");
  assert.equal(groups[0].devices[0].summary.node_id,"device:speaker-device");
  assert.equal(groups[0].loose[0].name,"Music signal");
  assert.equal(monitoringTree(data,"speaker device")[0].devices[0].entities.length,1);
  assert.equal(monitoringTree(data,"missing").length,0);
  assert.deepEqual(monitoringScope("both","music").match,{integration:["music"]});
  assert.deepEqual(monitoringScope("entry","music").match,{integration:["music"],kind:["integration"]});
  assert.deepEqual(monitoringScope("entities","music").match,{integration:["music"],kind:["entity"]});
  assert.deepEqual(monitoringScope("entity",speaker.node_id,speaker).match,{entity:["registry:speaker"]});
  const otherEntry=source("entry:other",{name:"Other integration",kind:"integration",entry_id:"other"});
  const shared=source("entity:registry:shared",{name:"Shared device sensor",owner_id:"other",
    attributes:{entity:["registry:shared"],device:["speaker-device"]}});
  data.inventory.catalog.candidates.push(otherEntry,shared);
  const sharedGroups=monitoringTree(data);
  assert.equal(sharedGroups[1].devices[0].id,"speaker-device");
  assert.deepEqual(sharedGroups[0].devices[0].total,{count:2,watched:2});
  assert.deepEqual(sharedGroups[1].devices[0].total,{count:2,watched:2});
  assert.deepEqual(monitoringScope("device","speaker-device").match,{device:["speaker-device"]});
  assert.deepEqual(monitoringScope("device_availability","speaker-device").match,
    {kind:["device"],device:["speaker-device"]});
});

test("device summary names HA availability without claiming physical failure",()=>{
  const device=source("device:abc",{kind:"device",attributes:{device:["abc"]}});
  const outage=deviceProblem(device,{current:{reason:"all_unavailable"}});
  assert.match(outage.headline,/All monitored entities unavailable/);
  assert.match(outage.summary,/does not establish whether the physical device/);
  assert.equal(outage.deviceUrl,"/config/devices/device/abc");
  const partial=deviceProblem(device,{current:{reason:"some_unavailable"}},true);
  assert.equal(partial.tone,"uncertain");
  assert.match(partial.nextStep,/ignore/i);
  assert.match(partial.summary,/cannot determine/);
  assert.match(partial.headline,/Some monitored entities unavailable/);
  assert.match(deviceProblem(device,{current:{reason:"available"}},true).headline,/recovery/);
  const ready=diagnosticOverview(device,{readiness:{answer:"ready"}});
  assert.match(ready.assessment,/individual capabilities are not all verified/);
  assert.match(diagnosticOverview(device,{readiness:{answer:"ready"}},[],true).assessment,/awaiting confirmed recovery/);
});

test("device availability appears with its HA device in house and coverage",()=>{
  const data=example();
  const entry=source("entry:owner",{kind:"integration",entry_id:"owner",name:"Controller"});
  const summary=source("device:bridge",{kind:"device",name:"Bridge",attributes:{
    device:["bridge"],integration:["owner"],area:["garage"]}});
  data.inventory.nodes=[entry,summary];
  data.inventory.catalog.candidates=[entry,summary];
  data.devices=[{id:"bridge",name:"Bridge"}];
  assert.equal(locationTree(data)[0].children[0].devices[0].sources[0].node_id,"device:bridge");
  assert.equal(coverageInventory(data).groups[0].devices[0].sources[0].source.node_id,"device:bridge");
});

test("guided exclusion preserves a broader pilot rule and can be removed",()=>{
  const pilot={id:"pilot_integrations",action:"attach",enabled:true,
    match:{integration:["music","other"]},checks:["availability"]};
  const rules=[pilot];
  const scope=monitoringScope("device","speaker-device");
  assert.equal(scopeChoice(rules,scope),"inherit");
  assert.equal(setScopeChoice(rules,scope,"exclude"),true);
  assert.equal(scopeChoice(rules,scope),"exclude");
  assert.deepEqual(rules[0],pilot);
  assert.deepEqual(rules[1].match,{device:["speaker-device"]});
  assert.equal(setScopeChoice(rules,scope,"inherit"),true);
  assert.deepEqual(rules,[pilot]);
});

test("integration device default stages one overridable policy and keeps readable scope",()=>{
  const rules=[{id:"all_device_summaries",action:"attach",match:{kind:["device"]}}];
  const scope=monitoringScope("integration_devices","eero-entry");
  assert.equal(setScopeChoice(rules,scope,"exclude"),true);
  assert.equal(scopeChoice(rules,scope),"exclude");
  assert.equal(rules[1].overridable,true);
  assert.match(ruleSummary(rules[0]),/Watch device summaries/);
  assert.match(ruleSummary(rules[1]),/Leave unmonitored device summaries in 1 integration instance/);
  assert.equal(setScopeChoice(rules,scope,"attach"),true);
  assert.equal(rules[1].overridable,undefined);
});

test("ignore availability stages a stable exclusion without saving or discarding the draft",async(t)=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:(key)=>elements.get(key),define:(key,value)=>elements.set(key,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js");
  const card=Object.create(elements.get("homeostatic-card-v21").prototype);
  const entity=source("entity:registry:optional",{entity_id:"media_player.group",name:"Optional group",attributes:{entity:["registry:optional"]}});
  const data=example();
  data.inventory.catalog.candidates.push(entity);
  const saved=[{id:"devices",action:"attach",match:{kind:["device"]}}];
  const calls=[];
  Object.assign(card,{current:{status:"current",data},configuration:null,configBusy:false,configExpanded:new Set(),
    dialog:{close(){}},render(){},_hass:{async callWS(command){calls.push(command.type);return {rules:saved,revision:"one"};}}});
  await card.ignoreAvailability(entity.node_id);
  assert.deepEqual(calls,["homeostatic/configuration"]);
  assert.equal(card.page,"sources");
  assert.equal(card.configPreview,null);
  assert.equal(saved.length,1);
  assert.deepEqual(card.configDraft[1].match,{entity:["registry:optional"]});
  assert.equal(card.configDraft[1].action,"exclude");
  card.configDraft.push({id:"unfinished",action:"attach",match:{area:["garage"]}});
  await card.ignoreAvailability(entity.node_id);
  assert.equal(card.configDraft.length,3);
  assert.equal(card.configDraft[2].id,"unfinished");
  assert.deepEqual(calls,["homeostatic/configuration"]);
  const direct={id:"direct-one",action:"attach",match:{entity:["registry:optional"]}};
  card.configuration={rules:[direct,{...direct,id:"direct-two"}],revision:"two"};
  card.configDraft=structuredClone(card.configuration.rules);
  await card.ignoreAvailability(entity.node_id);
  assert.match(card.sourcesActionError,/Several direct rules apply/);
  const node=sourcePaths(sourcesTree(data)).get(`source:${entity.node_id}`);
  assert.match(sourceMonitoringChoices({current:{data},configuration:card.configuration,configDraft:card.configDraft,configScopes:[],sourcesActionError:card.sourcesActionError},node),/role="alert">Several direct rules apply/);
  card.current={status:"disconnected",data:null};
  await card.ignoreAvailability(entity.node_id);
  assert.deepEqual(calls,["homeostatic/configuration"]);
});


test("attention actions require compatible current administrator targets",()=>{
  const current={status:"current",data:{inventory:{attention_controls_supported:true,episodes:[{episode_id:"e1"}],operator_controls:[{control_id:"c1"}]}}};
  assert.equal(attentionActionAllowed(current,true,"acknowledge","e1"),true);
  assert.equal(attentionActionAllowed(current,true,"cancel_control","c1"),true);
  assert.equal(attentionActionAllowed(current,false,"acknowledge","e1"),false);
  assert.equal(attentionActionAllowed({...current,status:"disconnected"},true,"acknowledge","e1"),false);
  assert.equal(attentionActionAllowed(current,true,"acknowledge","gone"),false);
  assert.equal(attentionActionAllowed(current,true,"cancel_control","gone"),false);
  current.data.inventory.attention_controls_supported=false;
  assert.equal(attentionActionAllowed(current,true,"acknowledge","e1"),false);
});


test("monitoring tree reaches missing owners through one catchall and preserves device summaries",()=>{
  const data=monitoringExample();
  const index=monitoringIndex(monitoringNavigation(data));
  const catchall=[...index.values()].find((node)=>node.name==="Other sources");
  assert.ok(catchall.children.some((node)=>node.type==="device"));
  assert.ok(catchall.children.some((node)=>node.type==="entity"));
  assert.equal([...index.values()].filter((node)=>node.type==="entity").length,data.inventory.nodes.filter((node)=>node.kind==="entity").length);
  assert.equal([...index.values()].filter((node)=>node.name==="Other sources").length,1);
  const orphan=[...index.values()].find((node)=>node.source?.entity_id==="sensor.unassigned_124");
  assert.deepEqual(orphan.parents.map((node)=>node.name),["Other sources"]);
  const summary=[...index.values()].find((node)=>node.type==="device" && node.device.id==="standalone");
  assert.equal(summary.device.summary.node_id,"device:standalone");
});

test("monitoring search preserves full ancestors and leaves group choices unfiltered",()=>{
  const data=monitoringExample();
  const tree=monitoringNavigation(data,"sensor.camera_1_104");
  const nodes=[...monitoringIndex(tree).values()];
  const target=nodes.find((node)=>node.type==="entity");
  assert.deepEqual(target.parents.map((node)=>node.name),["Frigate","Back Porch"]);
  assert.equal(nodes.filter((node)=>node.type==="entity").length,1);
  assert.equal(nodes.find((node)=>node.type==="device").device.entities.length,105);
  assert.deepEqual(monitoringScope("device","camera-1").match,{device:["camera-1"]});
  assert.deepEqual(monitoringNavigation(data,"no matching source"),[]);
});

test("monitoring tree exposes every integration and renders children on expansion without pages",()=>{
  const data=monitoringExample();
  const tree=monitoringNavigation(data);
  const target=[...monitoringIndex(tree).values()].find((node)=>node.type==="device"&&node.device.id==="camera-1");
  const card={current:{data},configQuery:"",configExpanded:new Set([target.parents[0].key,target.key]),configSelection:target.key,
    displaySourceName:(source)=>source.name,configurationChoice:()=>""};
  const html=configurationBrowser(card);
  assert.ok(tree.length>20);
  assert.match(html,/Back Porch signal 104/);
  assert.doesNotMatch(html,/data-config-page|config-paging|class="config-member"/);
});

test("monitoring device editor distinguishes included members, ignored entities and separate checks",()=>{
  const data=monitoringExample();
  const node=[...monitoringIndex(monitoringNavigation(data)).values()].find((node)=>node.type==="device"&&node.device.id==="camera-1");
  const card={current:{data},configQuery:"",configExpanded:new Set(),configSelection:node.key,
    displaySourceName:(source)=>source.name,configurationChoice:(label,scope,current)=>`${label}: ${current}`};
  const html=configurationBrowser(card);
  assert.match(html,/104 eligible entities · 1 ignored/);
  assert.match(html,/Device availability summary: Monitored/);
  assert.doesNotMatch(html,/Bulk changes|config-member/);
});

test("shared devices expose the same summary through every owning integration",()=>{
  const data=monitoringExample();
  data.inventory.nodes.push(baseSource("entity:registry:shared","Shared sensor","entity",{owner_id:"other-0",entity_id:"sensor.shared",attributes:{device:["camera-0"],entity:["registry:shared"]}}));
  const devices=[...monitoringIndex(monitoringNavigation(data)).values()].filter((node)=>node.type==="device"&&node.device.id==="camera-0");
  assert.equal(devices.length,2);
  assert.ok(devices.every((node)=>node.device.summary.node_id==="device:camera-0"));
  assert.notEqual(devices[0].key,devices[1].key);
});

test("monitoring renders untrusted names as text and tolerates arbitrary entity domains",()=>{
  const data=monitoringExample();
  data.inventory.nodes.push(baseSource("entity:registry:unsafe",'<img src=x onerror="bad()">',"entity",{attributes:{domain:["__proto__"],entity:["registry:unsafe"]}}));
  const target=[...monitoringIndex(monitoringNavigation(data)).values()].find((node)=>node.source?.node_id==="entity:registry:unsafe");
  const card={current:{data},configQuery:"",configExpanded:new Set(),configSelection:target.key,
    displaySourceName:(source)=>source.name,configurationChoice:()=>""};
  const html=configurationBrowser(card);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img/);
});


test("selecting a catchall entity reveals its ancestors",()=>{
  const tree=monitoringNavigation(monitoringExample());
  const index=monitoringIndex(tree);
  const target=[...index.values()].find((node)=>node.source?.entity_id==="sensor.unassigned_124");
  const expanded=new Set();
  revealMonitoringPath(tree,target.key,expanded);
  assert.ok(target.parents.every((node)=>expanded.has(node.key)));
  assert.equal(expanded.has(target.key),false);
});

test("Sources keeps device and entity identities across integration and location grouping",()=>{
  const data=monitoringExample();
  data.floors=[{id:"first",name:"First floor"}];
  data.areas=[{id:"porch",name:"Porch",floor_id:"first"}];
  const entity=data.inventory.nodes.find((row)=>row.node_id==="entity:registry:camera-1-1");
  entity.attributes.area=["porch"];
  const lock=baseSource("entity:registry:porch-lock","Porch lock","entity",{entity_id:"lock.porch",attributes:{area:["porch"],entity:["registry:porch-lock"]}});
  data.inventory.nodes.push(lock);
  data.inventory.catalog.candidates.push(lock);
  const integration=sourcePaths(sourcesTree(data,"integration"));
  const grouped=sourcesTree(data,"location");
  const location=sourcePaths(grouped);
  assert.ok(integration.has("source:entity:registry:camera-1-1"));
  assert.ok(location.has("source:entity:registry:camera-1-1"));
  assert.ok(integration.has("source:device:camera-1"));
  assert.ok(location.has("source:device:camera-1"));
  assert.ok(location.has("source:entity:registry:orphan-124"));
  assert.ok(location.has("source:entry:frigate"));
  assert.deepEqual(location.get("source:entity:registry:camera-1-1").parents.map((item)=>item.name),["First floor","Porch","Back Porch"]);
  assert.deepEqual(location.get("source:entity:registry:porch-lock").parents.map((item)=>item.name),["First floor","Porch"]);
  const floor=grouped.find((node)=>node.name==="First floor");
  assert.deepEqual(floor.children.map((node)=>node.name),["Porch"]);
  assert.deepEqual(floor.children[0].children.map((node)=>node.name),["Back Porch","Porch lock"]);
});

test("Sources uses Topomation nesting and keeps unplaced sources reachable",()=>{
  const data=monitoringExample();
  const entity=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-1-1");
  entity.attributes.area=["porch"];
  const topomation={locations:[
    {id:"home",name:"Home",parent_id:null,order:0,ha_area_id:null,entity_ids:[]},
    {id:"porch",name:"Front porch",parent_id:"home",order:0,ha_area_id:"porch",entity_ids:[]},
  ]};
  const paths=sourcePaths(sourcesTree(data,"topomation",null,topomation));
  assert.deepEqual(paths.get("source:entity:registry:camera-1-1").parents.slice(0,2).map(item=>item.name),["Home","Front porch"]);
  assert.ok(paths.has("source:entity:registry:orphan-124"));
  assert.ok(paths.has("source:entry:frigate"));
  topomation.locations.push({id:"utility",name:"Utility",parent_id:"home",order:1,ha_area_id:null,entity_ids:[entity.entity_id]});
  const moved=sourcePaths(sourcesTree(data,"topomation",null,topomation));
  assert.equal(moved.get("source:entity:registry:camera-1-1").parents[1].name,"Utility");
  assert.equal(sourcePaths(sourcesTree(data,"location",null,topomation)).get("source:entity:registry:camera-1-1").parents[0].name,"Unassigned");
  assert.equal(sourcesTree(data,"topomation",null,{locations:[]})[0]?.type,"location");
  assert.equal(sourcesTree(data,"topomation",null,{locations:[
    {id:"a",parent_id:"b"},{id:"b",parent_id:"a"},
  ]})[0]?.type,"location");
  const card={current:{data},topomation,sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:null};
  assert.match(sourcesBrowser(card),/<option value="topomation">TopoMation<\/option>/);
  assert.match(sourcesBrowser(card),/TopoMation's deeper house tree is available in Group by/);
  assert.match(sourcesBrowser(card),/href="https:\/\/github.com\/mjcumming\/topomation"/);
  card.sourcesGrouping="topomation";
  assert.match(sourcesBrowser(card),/Viewing TopoMation's deeper house tree/);
  card.sourcesGrouping="integration";
  card.topomation=null;
  assert.doesNotMatch(sourcesBrowser(card),/<option value="topomation"/);
  assert.match(sourcesBrowser(card),/Want a deeper house tree\?/);
});

test("Sources review filtering retains grouped ancestors and does not auto-expand them",()=>{
  const data=monitoringExample();
  data.coverage.never_observed=[{node_id:"entity:registry:camera-1-1",check_id:"availability"}];
  const tree=sourcesTree(data);
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:true,
    sourcesExpanded:new Set(),sourcesSelection:"source:entry:frigate",sourcesEdit:false};
  const html=sourcesBrowser(card);
  assert.match(html,/Show all sources/);
  assert.doesNotMatch(html,/data-sources-toggle=.*aria-expanded="true"/);
  assert.ok(filterSources(tree,"camera_1_001").length);
  assert.ok(sourcePaths(tree).has("source:entity:registry:orphan-124"));
});

test("Sources badges count open issues rather than every evidence gap",()=>{
  const data=monitoringExample();
  const candidates=data.inventory.nodes.filter((row)=>row.kind==="entity").slice(0,78);
  for (const row of candidates) row.watched=true;
  data.coverage.never_observed=candidates.map((row)=>({node_id:row.node_id,check_id:"availability"}));
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:true,
    sourcesExpanded:new Set(),sourcesSelection:"source:entry:frigate",sourcesEdit:false};
  const html=sourcesBrowser(card);
  assert.doesNotMatch(html,/78 need review/);
  assert.equal((html.match(/data-sources-select=/g)??[]).length,0);
  assert.doesNotMatch(html,/first 20/i);
});

test("Sources bounds a large opened branch while full search reaches the last entity",()=>{
  const data=monitoringExample();
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(["source:entry:frigate","source:device:camera-1"]),sourcesSelection:"source:device:camera-1",sourcesEdit:false};
  const html=sourcesBrowser(card);
  assert.match(html,/Show more sources/);
  card.sourcesLimits=new Map([["source:device:camera-1",160]]);
  assert.match(sourcesBrowser(card),/data-sources-select="source:entity:registry:camera-1-104"/);
  card.sourcesQuery="sensor.camera_1_104";
  const searched=filterSources(sourcesTree(data),card.sourcesQuery);
  assert.ok(sourcePaths(searched).has("source:entity:registry:camera-1-104"));
});

test("Sources keeps a 6,000-entity inventory searchable with bounded initial markup",()=>{
  const data=monitoringExample();
  for (let number=0;number<6000;number++) data.inventory.nodes.push(baseSource(
    `entity:registry:scale-${number}`,`Scale sensor ${number}`,"entity",
    {entity_id:`sensor.scale_${number}`,owner_id:"frigate",attributes:{entity:[`registry:scale-${number}`],device:["camera-1"]}},
  ));
  data.inventory.catalog.candidates=data.inventory.nodes;
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:"source:entry:frigate",sourcesEdit:false};
  const initial=sourcesBrowser(card);
  assert.ok(initial.length<20000);
  const last=filterSources(sourcesTree(data),"sensor.scale_5999");
  assert.ok(sourcePaths(last).has("source:entity:registry:scale-5999"));
  card.sourcesSelection="source:entity:registry:scale-5999";
  card.sourcesExpanded=new Set(["source:entry:frigate","source:device:camera-1"]);
  const linked=sourcesBrowser(card);
  assert.match(linked,/data-sources-select="source:entity:registry:scale-5999"/);
  assert.ok(linked.length<70000);
});

test("Sources keeps one tree while source settings and history show selected source context",()=>{
  const data=monitoringExample();
  const entry=data.inventory.nodes.find((row)=>row.node_id==="entry:frigate");
  entry.name="";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:"source:entry:frigate",sourcesEdit:false,sourcesView:"source"};
  const source=sourcesBrowser(card);
  assert.match(source,/Frigate/);
  assert.match(source,/Reading current Home Assistant values/);
  assert.doesNotMatch(source,/No current availability gap/);
  assert.equal((source.match(/<h2>Sources<\/h2>/g)??[]).length,0);
  assert.match(source,/data-sources-view="source"/);
  card.sourcesView="settings";
  const settings=sourcesBrowser(card);
  assert.match(settings,/Loading monitoring choices/);
  assert.doesNotMatch(settings,/Edit monitoring/);
  assert.doesNotMatch(settings,/Current evidence/);
  card.sourcesView="history";
  const history=sourcesBrowser(card);
  assert.match(history,/No problems in retained history/);
  assert.doesNotMatch(history,/Edit monitoring/);
  card.sourcesSelection="source:entity:registry:camera-1-1";
  const entity=sourcesBrowser(card);
  assert.match(entity,/<h2 id="sources-detail-title"[^>]*>[^<]+<\/h2><p class="source-entity-id">sensor\.camera_1_001<\/p>/);
});


test("Integration families combine connections and keep devices reachable",()=>{
  const data=monitoringExample();
  data.inventory.nodes.push(baseSource("entry:frigate2","Second house","integration",{entry_id:"frigate2",attributes:{domain:["frigate"]}}));
  const tree=sourcesTree(data),family=tree.find(node=>node.domain==="frigate");
  assert.equal(family.entries.length,2);
  assert.equal(family.name,"Frigate");
  assert.ok(sourcePaths(tree).has("source:entry:frigate2"));
  assert.ok(sourcePaths(tree).has("source:device:camera-1"));
  assert.equal(family.children[0].type,"device");
  assert.equal(family.children.at(-1).type,"integration");
  assert.ok(!family.children.some(child=>child.type==="connections"));
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set([family.key]),sourcesSelection:family.key,sourcesView:"source"};
  const html=sourcesBrowser(card);
  assert.match(html,/Integration connection · Not monitored/);
  assert.match(html,/<details class="source-section source-connections"><summary>2 Home Assistant connections<\/summary>/);
  const scope={kind:"integration_devices",id:"frigate",match:{kind:["device"],integration_domain:["frigate"]}},rules=[];
  setScopeChoice(rules,scope,"exclude");
  assert.equal(rules[0].overridable,true);
  editCatalogRule(rules[0],"match:integration_domain","frigate, eero");
  assert.equal(rules[0].overridable,true);
});

test("removed device history uses its saved name and explains the monitoring limit", () => {
  const item={resolution:"removed",source:null,episode:{episode_id:"ended-device",anchor:"device:opaque-id",labels:{name:"Former controller"},reasons:[{check_id:"availability",reason:"all_unavailable",message:"Former controller: all unavailable"}]}};
  assert.equal(historyName(item),"Former controller");
  assert.equal(historyName({...item,source:{name:"device:opaque-id"}}),"Former controller");
  assert.equal(historyPage({episodes:[item]},"former controller").total,1);
  assert.deepEqual(historyAccount(item),["Home Assistant reported every monitored entity on this device as unavailable.","Monitoring ended without an observed recovery.",""]);
  assert.equal(historyName({...item,episode:{...item.episode,labels:{}}}),"Name not recorded");
});

test("Sources combines registry-owned one-device connections without merging their checks",()=>{
  const data=monitoringExample();
  data.inventory.nodes=[
    baseSource("entry:family","Receiver setup","integration",{entry_id:"family",attributes:{domain:["denonavr"]},watched:true}),
    baseSource("entry:theater","Home Theater","integration",{entry_id:"theater",attributes:{domain:["denonavr"]},watched:true}),
    baseSource("device:family","Family Room","device",{attributes:{device:["family-device"],integration:["family"]},availability_entities:["media_player.family_room"],watched:true}),
    baseSource("device:theater","Home Theater","device",{attributes:{device:["theater-device"],integration:["theater"]},availability_entities:[]}),
    baseSource("entity:family-player","Family Room","entity",{entity_id:"media_player.family_room",owner_id:"family",attributes:{device:["family-device"]}}),
  ];
  data.devices=[{id:"family-device",name:"Family Room",config_entry_id:"family"},{id:"theater-device",name:"Home Theater",config_entry_id:"theater"}];
  data.inventory.catalog.candidates=data.inventory.nodes;
  data.inventory.episodes=[{episode_id:"theater-issue",anchor:"entry:theater",importance:"normal",opened_at:"2026-09-30T12:00:00Z",reasons:[]}];
  const tree=sourcesTree(data),family=tree.find(node=>node.domain==="denonavr"),paths=sourcePaths(tree);
  assert.deepEqual(family.children.map(node=>node.name),["Family Room","Home Theater"]);
  assert.deepEqual(family.children.map(node=>node.type),["device","device"]);
  assert.equal(paths.get("source:entry:family").node.source.node_id,"entry:family");
  assert.equal(paths.get("source:device:family").node.connection.node_id,"entry:family");
  assert.equal(paths.get("source:entity:family-player").parents.at(-1).key,"source:device:family");
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set([family.key]),sourcesSelection:family.key,sourcesView:"source"};
  const html=sourcesBrowser(card);
  assert.match(html,/Family Room/);
  assert.match(html,/Connection issue · No device entities/);
  assert.equal((html.match(/data-sources-select="source:entry:theater"/g)||[]).length,1);
  assert.ok(sourcePaths(filterSources(tree,"Receiver setup")).has("source:device:family"));
  data.inventory.nodes=data.inventory.nodes.filter(node=>!node.node_id.includes("theater"));
  data.inventory.catalog.candidates=data.inventory.nodes;
  data.devices=data.devices.filter(device=>device.id==="family-device");
  const single=sourcesTree(data).find(node=>node.domain==="denonavr");
  assert.equal(single.children.length,1);
  assert.equal(single.children[0].connection.node_id,"entry:family");
});

test("Sources keeps an entry parent for several devices or unattached entities",()=>{
  const data=monitoringExample();
  data.inventory.nodes=[
    baseSource("entry:hub","House hub","integration",{entry_id:"hub",attributes:{domain:["sample"]}}),
    baseSource("entry:service","Account","integration",{entry_id:"service",attributes:{domain:["sample"]}}),
    baseSource("entry:mixed","Mixed","integration",{entry_id:"mixed",attributes:{domain:["sample"]}}),
    baseSource("device:first","First","device",{attributes:{device:["first"],integration:["hub"]}}),
    baseSource("device:second","Second","device",{attributes:{device:["second"],integration:["hub"]}}),
    baseSource("device:mixed","Mixed device","device",{attributes:{device:["mixed"],integration:["mixed"]}}),
    baseSource("entity:service","Account signal","entity",{entity_id:"sensor.account",owner_id:"service",attributes:{}}),
    baseSource("entity:mixed","Loose signal","entity",{entity_id:"sensor.loose",owner_id:"mixed",attributes:{}}),
  ];
  data.devices=[{id:"first",name:"First",config_entry_id:"hub"},{id:"second",name:"Second",config_entry_id:"hub"},{id:"mixed",name:"Mixed device",config_entry_id:"mixed"}];
  data.inventory.catalog.candidates=data.inventory.nodes;
  const family=sourcesTree(data).find(node=>node.domain==="sample");
  const hub=family.children.find(node=>node.source?.node_id==="entry:hub");
  const service=family.children.find(node=>node.source?.node_id==="entry:service");
  const mixed=family.children.find(node=>node.source?.node_id==="entry:mixed");
  assert.deepEqual(hub.children.map(node=>node.name),["First","Second"]);
  assert.deepEqual(service.children.map(node=>node.name),["Account signal"]);
  assert.deepEqual(mixed.children.map(node=>node.name),["Loose signal","Mixed device"]);
  const card={configuration:{rules:[],settings:{notifications:false}},configDraft:[],configScopes:[],current:{data},settingsDraft:null};
  assert.match(sourceMonitoringChoices(card,family),/Currently 0 of 3 devices monitored/);
});

test("Integration-wide off retains narrower choices and hides them until monitoring resumes",()=>{
  const data=monitoringExample(),family=sourcesTree(data).find(node=>node.domain==="frigate");
  const rules=[{id:"device_choice",action:"attach",match:{kind:["device"],device:["camera-1"]}}];
  const scope={kind:"integration_all",id:"frigate",match:{integration_domain:["frigate"],kind:["integration","device","entity"]}};
  const card={configuration:{rules},configDraft:rules,configScopes:[],current:{data},sourcesSettingsPanel:""};
  assert.match(sourceMonitoringChoices(card,family),/data-integration-master checked/);
  assert.equal(setScopeChoice(rules,scope,"exclude"),true);
  card.configScopes=[];
  const stopped=sourceMonitoringChoices(card,family);
  assert.doesNotMatch(stopped,/What to monitor/);
  assert.doesNotMatch(stopped,/data-integration-master checked/);
  assert.equal(rules[0].id,"device_choice");
  assert.equal(scopeChoice(rules,scope),"exclude");
  assert.equal(setScopeChoice(rules,scope,"inherit"),true);
  assert.equal(rules.length,1);
  card.configScopes=[];
  assert.match(sourceMonitoringChoices(card,family),/All devices, including new devices/);
});

test("Timing preview describes edits while preserving unrelated policy structure",()=>{
  assert.equal(durationSeconds("1h30m"),5400);
  assert.equal(durationSeconds("2d5s"),172805);
  assert.equal(durationSeconds("invalid"),null);
  const before={timings:{unknown_hold:900},notifications:false,consumer:null,policy:{timezone:"UTC",recipients:{owner:{channels:["event"]}},digests:{morning:{at:"08:00",to:"owner"}},rules:[{match:{category:["security"]},loudness:"notify",to:["owner"]}]}};
  const after=structuredClone(before);after.timings.unknown_hold=300;after.policy.rules[0].remind_every=600;
  const changes=settingsChanges(before,after);
  assert.equal(changes.length,2);
  assert.match(changes[1][0],/security/);
  assert.deepEqual(after.policy.digests,before.policy.digests);
});


test("monitoring policy scenario keeps 18 direct choices out of the normal group view", () => {
  const rules=monitoringPolicyRules(), before=structuredClone(rules);
  const html=monitoringPolicies({configDraft:rules,current:{data:{}}});
  assert.match(html,/Integrations/);
  assert.match(html,/class="policy-state">On</);
  assert.match(html,/Vacuums/);
  assert.match(html,/Repairs/);
  assert.match(html,/Broken automations/);
  assert.match(html,/data-action="turn-off-repairs"/);
  assert.match(html,/data-action="turn-off-broken"/);
  assert.match(html,/Monitor all vacuums/);
  assert.doesNotMatch(html,/When to report them/);
  assert.match(html,/No other policies/);
  assert.match(html,/Add policy/);
  assert.doesNotMatch(html,/What to watch|Advanced rule details|Edit policy|Individual source choices|Group policies|Source type|Remove rule|data-rule-index|config-advanced|policy-sources/);
  assert.deepEqual(rules,before);
});

test("a broad check is on, off, paused, or an unsaved draft", () => {
  const paused={id:"vacuums",action:"attach",enabled:false,match:{kind:["vacuum"]},checks:["vacuum"]};
  const html=monitoringPolicies({configDraft:[paused],configuration:{rules:[paused]},current:{data:{}}});
  assert.match(html,/Vacuums/);
  assert.match(html,/class="policy-state is-off">Off</);
  assert.match(html,/This check is paused/);
  assert.match(html,/data-action="enable-vacuum-rule"/);
  assert.match(html,/data-action="clear-vacuum-rule"/);
  assert.doesNotMatch(html,/Edit policy|Remove rule|Source type/);
  const draft={id:"batteries",action:"attach",enabled:true,match:{kind:["battery"]},checks:["battery"]};
  const drafted=monitoringPolicies({configDraft:[draft],configuration:{rules:[]},current:{data:{}}});
  assert.match(drafted,/Review and save before this takes effect/);
  assert.match(drafted,/data-action="clear-battery-rule"/);
  assert.doesNotMatch(drafted,/data-action="add-battery-rule"/);
  const off={id:"repairs_off",action:"exclude",enabled:true,match:{kind:["repair"]},checks:["repair"]};
  const stopped=monitoringPolicies({configDraft:[off],configuration:{rules:[]},current:{data:{}}});
  assert.match(stopped,/Monitor all repairs/);
  assert.match(stopped,/Review and save before this takes effect/);
  assert.doesNotMatch(stopped,/Edit policy|When to report them/);
  const broken={id:"broken_off",action:"exclude",enabled:true,match:{kind:["broken_automation"]},checks:["broken_automation"]};
  const brokenStopped=monitoringPolicies({configDraft:[broken],configuration:{rules:[]},current:{data:{}}});
  assert.match(brokenStopped,/Monitor all automations/);
  assert.doesNotMatch(brokenStopped,/Edit policy/);
});

for(const [name,match,expected] of [
  ["unrestricted",{},true],
  ["multiple source types",{kind:["integration","entity"]},true],
  ["integration type and label",{kind:["device"],integration_domain:["matter"],label:["critical"]},true],
  ["integration instance default",{kind:["device"],integration:["matter-instance"]},false],
  ["multiple devices and location",{device:["one","two"],area:["upstairs"]},false],
  ["entity and domain",{entity:["light.porch"],domain:["light"]},false],
])test(`monitoring policy scope: ${name}`,()=>{
  assert.equal(isGroupPolicy({match}),expected);
});

test("group policy summaries retain every condition, paused state and escaping",()=>{
  const rule={id:"scoped",action:"exclude",enabled:false,match:{kind:["device","entity"],
    domain:["light","switch"],device_class:["outlet"],area:["porch"],label:["missing"]}};
  const data={areas:[{id:"porch",name:"<Porch>"}]};
  assert.deepEqual(groupPolicyScope(rule,data),{subject:"devices or entities",conditions:[
    "Domain: light or switch","Device class: outlet","Area: <Porch>","Label: missing"]});
  const html=monitoringPolicies({configDraft:[rule],configBusy:true,configuration:data,current:{data:{areas:[]}}});
  assert.match(html,/Leave unmonitored devices or entities/);
  assert.match(html,/Paused — this rule has no effect/);
  assert.match(html,/&lt;Porch&gt;/);
  assert.doesNotMatch(html,/<Porch>/);
  assert.match(html,/<fieldset class="config-editor" disabled>/);
  assert.deepEqual(groupPolicyScope({match:{}}).subject,"integrations or entities");
});

test("group exclusions start collapsed while watch policies remain visible",()=>{
  const rules=[
    {id:"watch",action:"attach",enabled:true,match:{kind:["integration"]},checks:["availability"]},
    {id:"skip",action:"exclude",enabled:true,match:{kind:["integration"],integration_domain:["alexa_media"]},checks:["availability"]},
  ];
  const html=monitoringPolicies({configDraft:rules,current:{data:{}}});
  assert.match(html,/Integrations/);
  assert.match(html,/class="policy-state">On</);
  assert.match(html,/<details class="policy-exceptions"><summary>Leave unmonitored policies \(1\)<\/summary>/);
  assert.match(html,/Integration type: alexa_media/);
  assert.match(html,/data-rule-index="1"/);
  assert.doesNotMatch(html,/<details class="policy-exceptions" open>/);
  const editing=monitoringPolicies({configDraft:rules,configEditingRule:"skip",current:{data:{}}});
  assert.match(editing,/<details class="policy-exceptions" open>/);
  assert.deepEqual(rules[1].match,{kind:["integration"],integration_domain:["alexa_media"]});
});

test("settings navigation keeps timing and grouping",()=>{
  const settings={timings:{settle:0,unknown_hold:0,retry_hold:0,clear_hold:0,rejoin_grace:0,startup_grace:0,startup_quiet_max:0,coalesce_count:3,coalesce_window:0,batch:0},notifications:false,consumer:null,policy:{timezone:"UTC",recipients:{},rules:[]},simple_notifications:{people:{}}};
  const html=installationSettings({page:"configuration",settingsSection:"timing",configuration:{settings,consumers:[]},settingsDraft:structuredClone(settings),settingsBusy:false,settingsPreview:null,settingsError:null,settingsNotice:null});
  assert.match(html,/Problem grouping/);
  assert.doesNotMatch(html,/Monitoring policies/);
  assert.doesNotMatch(html,/data-settings-section="policies"/);
});

test("no other policies stays empty without inventing defaults",()=>{
  const rules=monitoringPolicyRules().filter(rule=>!isGroupPolicy(rule));
  const html=monitoringPolicies({configDraft:rules,current:{data:{}}});
  assert.match(html,/No other policies/);
  assert.equal(rules.length,18);
  assert.doesNotMatch(html,/<article class="monitoring-policy"/);
});

for(const [name,error,expected] of [
  ["update mismatch",{code:"invalid_format",message:"not a valid option at 'paged'. Got True"},/out of sync.*restarting.*refresh this page/],
  ["permission failure",{code:"unauthorized",message:"Access denied"},/^Access denied$/],
  ["unrelated validation failure",{code:"invalid_format",message:"Invalid request"},/^Invalid request$/],
])test(`subscription guidance distinguishes ${name}`,async()=>{
  const client=connection();
  client.subscribeMessage=()=>Promise.reject(error);
  const store=new DashboardStore(client);
  const stop=store.listen(()=>{});
  await Promise.resolve();await Promise.resolve();
  assert.equal(store.state.status,"error");
  assert.match(store.state.error,expected);
  stop();await Promise.resolve();
});


import {deviceAvailability, deviceAvailabilityStamp, deviceEntityName} from "../../custom_components/homeostatic/frontend/device-availability.mjs";

for (const [status,label] of Object.entries({available:"Available",partially_available:"Partially available",unavailable:"Unavailable",unknown:"Unknown",disabled:"Disabled"})) {
  test(`device availability shows ${label} separately from monitoring`,()=>{
    const html=deviceAvailability({status,basis:status==="partially_available"?"integration_reports":"entities",reason:"no_current_states"});
    assert.match(html,new RegExp(`Device availability: ${label}`));
    assert.doesNotMatch(html,/Degraded|Insufficient evidence|Awaiting status/);
  });
}

test("compact device availability keeps the status without repeating its explanation",()=>{
  const html=deviceAvailability({status:"unavailable",basis:"entities"},true);
  assert.match(html,/Device availability: Unavailable/);
  assert.doesNotMatch(html,/Every enabled entity|overall device health|monitoring choices/);
});

test("connectivity evidence explains unavailable without claiming every entity is unavailable",()=>{
  const html=deviceAvailability({status:"unavailable",basis:"entities",reason:"connectivity_disconnected"});
  assert.match(html,/connectivity sensor reports this device disconnected/);
  assert.doesNotMatch(html,/Every enabled entity is unavailable/);
  assert.equal(deviceEntityName("ESP Presence Kitchen Fridge Motion","ESP Presence Kitchen Fridge"),"Motion");
  assert.equal(deviceEntityName("ESP Presence Kitchen Fridge","ESP Presence Kitchen Fridge"),"Selected entity");
});

test("Sources starts collapsed and puts scope and issue counts beside names",()=>{
  const data=monitoringExample();
  const device=data.inventory.nodes.find(row=>row.node_id==="device:camera-0");
  const separate=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-1");
  const unselected=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-2");
  device.availability_entities=device.availability_entities.filter(id=>id!==unselected.entity_id);
  separate.watched=true;
  data.inventory.episodes=[{episode_id:"camera-issue",anchor:device.node_id,opened_at:"2026-09-30T12:00:00Z",reasons:[]}];
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:null,sourcesView:"source"};
  const closed=sourcesBrowser(card);
  assert.match(closed,/Frigate <span class="source-issue-count">· 1 issue<\/span><\/span><small>26 devices/);
  assert.doesNotMatch(closed,/data-sources-select="source:device:camera-0"/);
  assert.doesNotMatch(closed,/Collapse all/);
  card.sourcesExpanded.add("source:entry:frigate");
  card.sourcesExpanded.add("source:device:camera-0");
  const opened=sourcesBrowser(card);
  assert.match(opened,/Back Deck <span class="source-issue-count">· 1 issue<\/span><\/span><small>4\/6 entities included/);
  assert.match(opened,/Back Deck signal 000<\/span><small>Excluded/);
  assert.match(opened,/Back Deck signal 001<\/span><small>Separate check/);
  assert.match(opened,/Back Deck signal 002<\/span><small>Not selected/);
  assert.match(opened,/Back Deck signal 003<\/span><small>Included with device/);
  assert.match(opened,/data-action="collapse-sources">Collapse all/);
  card.sourcesQuery="Back Deck signal 003";
  assert.match(sourcesBrowser(card),/Back Deck <span class="source-issue-count">· 1 issue<\/span><\/span><small>4\/6 entities included/);
});

test("Sources explains default monitoring without opening the tree",()=>{
  const card={current:{data:monitoringExample()},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:null,sourcesView:"source",sourcesHelpOpen:false};
  const closed=sourcesBrowser(card);
  assert.match(closed,/<details class="sources-explainer" data-sources-explainer><summary>How monitoring is chosen<\/summary>/);
  assert.match(closed,/New installations monitor integrations/);
  assert.match(closed,/diagnostic entities only when there are no enabled ordinary ones/);
  assert.match(closed,/An entity exclusion removes it from the device check/);
  assert.match(closed,/Open Policies for a choice that covers current and future sources/);
  assert.match(closed,/<\/details><ul class="config-tree">/);
  card.sourcesHelpOpen=true;
  assert.match(sourcesBrowser(card),/<details class="sources-explainer" data-sources-explainer open>/);
});

test("cleared device history explains HA evidence without claiming a physical repair", () => {
  const item={resolution:"cleared",source:{kind:"device",name:"Family Room Frigate"},episode:{form:"root",reasons:[{check_id:"availability",reason:"some_unavailable",message:"Family Room Frigate: some unavailable"}]}};
  const [reported,ending,limit]=historyAccount(item);
  assert.equal(reported,"Home Assistant reported an availability problem with Family Room Frigate.");
  assert.equal(ending,"");
  assert.equal(limit,"");
  assert.doesNotMatch([reported,ending,limit].join(" "),/physical repair|confirmed recovery/);
});

test("history observation range shows the elapsed time without seconds", () => {
  const observed=observedRange("2026-09-30T19:39:49Z","2026-09-30T19:48:53Z");
  assert.match(observed,/9 min/);
  assert.doesNotMatch(observed,/39:49|48:53/);
  assert.equal(observedRange("", ""),"Time not recorded");
});

test("selected device access can be available beside an unavailable monitored entity",()=>{
  const data=monitoringExample(), id="device:camera-0";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:`source:${id}`,sourcesView:"source",
    sourceDetail:{nodeId:id,device_availability:{status:"available",basis:"entities"},members:[{name:"Required sensor",node_id:"sensor.required",state:"unavailable"}],total:1,unavailable_count:1,unknown_count:0}};
  const html=sourcesBrowser(card);
  assert.match(html,/Device availability: Available/);
  assert.match(html,/1 of 1 selected entity is unavailable/);
  assert.match(html,/Required sensor/);
  assert.doesNotMatch(html,/Home Assistant cannot currently report|Next step:/);
});

test("Sources shows a selected connectivity report as disconnected",()=>{
  const data=monitoringExample(),id="device:camera-0";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:`source:${id}`,sourcesView:"source",
    sourceDetail:{nodeId:id,device_availability:{status:"unavailable",basis:"entities",reason:"connectivity_disconnected"},members:[{name:"Camera Connectivity",node_id:"binary_sensor.camera_connectivity",state:"off",connectivity:true}],total:1,unavailable_count:0,unknown_count:0}};
  const html=sourcesBrowser(card);
  assert.match(html,/Connection reports disconnected/);
  assert.match(html,/Device availability: Unavailable/);
  assert.match(html,/Entities needing review[\s\S]*Disconnected/);
  assert.doesNotMatch(html,/Selected entities available|Confirming recovery/);
});

test("entity detail shows HA state and monitoring once; device rows navigate",()=>{
  const data=monitoringExample(),entityId="entity:registry:camera-1-1",deviceId="device:camera-1";
  const member={node_id:entityId,name:"Back Porch signal 001",state:"unavailable"};
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${entityId}`,sourceDetail:{nodeId:entityId,members:[member],total:1,unavailable_count:1,unknown_count:0}};
  const entity=sourcesBrowser(card);
  assert.match(entity,/Unavailable in Home Assistant/);
  assert.match(entity,/Monitoring: Included with device/);
  assert.match(entity,/Change monitoring/);
  assert.doesNotMatch(entity,/<h3>Home Assistant entities<\/h3>|This entity has no separate check|Next step:/);
  assert.equal((entity.match(/Back Porch signal 001/g)??[]).length,1);
  assert.doesNotMatch(entity,/data-source-link="entity:registry:camera-1-1"/);
  card.sourcesSelection=`source:${deviceId}`;
  card.sourceDetail={...card.sourceDetail,nodeId:deviceId};
  const device=sourcesBrowser(card);
  assert.match(device,/<button type="button" class="link" data-source-link="entity:registry:camera-1-1">Back Porch signal 001<\/button>/);
});

test("device details put unavailable entities first and collapse other readings",()=>{
  const data=monitoringExample(),id="device:camera-1";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${id}`,sourceDetail:{nodeId:id,members:[
      {node_id:"entity:registry:camera-1-1",name:"Broken sensor",state:"unavailable"},
      {node_id:"entity:registry:camera-1-2",name:"Working sensor",state:"18"}],total:2,unavailable_count:1,unknown_count:0}};
  const html=sourcesBrowser(card);
  assert.match(html,/1 of 2 selected entities are unavailable/);
  assert.match(html,/Entities needing review.*Broken sensor/s);
  assert.match(html,/<details class="source-section source-healthy"><summary>1 other selected entity<\/summary>.*Working sensor/s);
  assert.match(html,/Open device in Home Assistant/);
  assert.doesNotMatch(html,/Home Assistant cannot currently report|Next step:/);
});

test("entity details separate availability from its current value",()=>{
  const data=monitoringExample(),id="entity:registry:camera-1-1";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${id}`,sourceDetail:{nodeId:id,members:[{node_id:id,name:"Back Porch signal 001",state:"18",unit:"%"}],total:1}};
  assert.match(sourcesBrowser(card),/Available in Home Assistant.*Current value: 18%/s);
  card.sourceDetail.members[0].state="unknown";
  assert.match(sourcesBrowser(card),/Available in Home Assistant.*Current value: unknown/s);
});

test("entity Settings keep separate checks secondary only when device includes the entity",()=>{
  const data=monitoringExample(),id="entity:registry:camera-1-1",node=sourcePaths(sourcesTree(data)).get(`source:${id}`).node;
  const card={configuration:{rules:[]},configDraft:[],configScopes:[],current:{data},sourcesSettingsPanel:""};
  const included=sourceMonitoringChoices(card,node);
  assert.match(included,/Currently: Included with device/);
  assert.match(included,/Follow device monitoring/);
  assert.match(included,/Exclude this entity/);
  assert.match(included,/<details class="source-advanced-choice"><summary>More monitoring choices<\/summary>.*Monitor this entity separately/s);
  setScopeChoice(card.configDraft,monitoringScope("entity",id,node.source),"attach");
  card.configScopes=[];
  assert.match(sourceMonitoringChoices(card,node),/<details class="source-advanced-choice" open><summary>More monitoring choices<\/summary>.*value="attach" checked/s);
  card.configDraft=[];
  data.inventory.nodes.find(row=>row.node_id==="device:camera-1").availability_entities=[];
  card.configScopes=[];
  const unattached=sourceMonitoringChoices(card,node);
  assert.match(unattached,/Monitor this entity/);
  assert.doesNotMatch(unattached,/source-advanced-choice/);
});

test("availability refresh follows excluded entities without reacting to value churn",()=>{
  const value={entity_ids:["sensor.excluded"]};
  const state=value=>({"sensor.excluded":{state:value,attributes:{}}});
  assert.equal(deviceAvailabilityStamp(value,state("42")),deviceAvailabilityStamp(value,state("43")));
  assert.equal(deviceAvailabilityStamp(value,state("unknown")),deviceAvailabilityStamp(value,state("off")));
  assert.notEqual(deviceAvailabilityStamp(value,state("off")),deviceAvailabilityStamp(value,state("unavailable")));
  assert.notEqual(deviceAvailabilityStamp(value,state("unavailable")),deviceAvailabilityStamp(value,{}));
});

test("selected device refreshes when a connectivity sensor changes between on and off",()=>{
  const id="binary_sensor.connection";
  const value={entity_ids:[id],connectivity_entity_ids:[id]};
  const state=(value)=>({[id]:{state:value,attributes:{}}});
  assert.notEqual(deviceAvailabilityStamp(value,state("on")),deviceAvailabilityStamp(value,state("off")));
});


test("selected device refresh coalesces reads and notices access changes",async(t)=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?availability-test");
  const card=Object.create(elements.get("homeostatic-card-v21").prototype);
  const data=monitoringExample(),entity="sensor.excluded",nodeId="device:camera-0",pending=[];
  Object.assign(card,{page:"sources",sourcesView:"source",current:{status:"current",data},sourcesGrouping:"integration",sourcesSelection:`source:${nodeId}`,sourceDetail:null,sourceSequence:0,
    render(){},_hass:{states:{[entity]:{state:"off",attributes:{}}},callWS(){return new Promise(resolve=>pending.push(resolve));}}});
  const first=card.loadSource();
  await card.loadSource();
  assert.equal(pending.length,1);
  pending[0]({device_availability:{status:"available",entity_ids:[entity]}});
  await first;
  await card.loadSource();
  assert.equal(pending.length,1);
  card._hass.states={[entity]:{state:"unavailable",attributes:{}}};
  const changed=card.loadSource();
  await card.loadSource();
  assert.equal(pending.length,2);
  pending[1]({device_availability:{status:"unavailable",entity_ids:[entity]}});
  await changed;
  assert.equal(card.sourceDetail.device_availability.status,"unavailable");
  card._hass.states={[entity]:{state:"42",attributes:{}}};
  const recovery=card.loadSource();
  pending[2]({device_availability:{status:"available",entity_ids:[entity]}});
  await recovery;
  card._hass.states={[entity]:{state:"43",attributes:{}}};
  await card.loadSource();
  assert.equal(pending.length,3);
});
