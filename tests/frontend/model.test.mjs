import {entityProblem, integrationProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {historyPage, controlPayload, controlAllowed, callAction, controlsPanel, localEndTime, RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {diagnosticOverview} from "../../custom_components/homeostatic/frontend/evidence.mjs";
import assert from "node:assert/strict";
import {test} from "node:test";
import {DashboardStore, affectedFunctions, browseHighlights, coverageInventory, dashboardStore,
  escapeHtml, inventoryRows, locationList, locationTree, monitoringLabel,
  recentActivity, sortedEpisodes, sourcePage, sourceMap, mergeDashboard} from "../../custom_components/homeostatic/frontend/model.mjs";
import {locationBranch, setBranchExpanded} from "../../custom_components/homeostatic/frontend/tree.mjs";
import {editCatalogRule, monitoringScope, monitoringTree, newCatalogRule,
  scopeChoice, setScopeChoice} from "../../custom_components/homeostatic/frontend/configuration.mjs";

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
  assert.equal(inventoryRows(data).length,3);
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
test("house browsing groups devices, functions, and secondary area signals",()=>{
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
  assert.equal(area.summary,"1 device · 1 function · 2 area signals");
  assert.deepEqual(browseHighlights(data).map((location)=>location.id),["area:basement"]);
  assert.equal(locations.find((location)=>location.id==="group:unassigned"),undefined);
  assert.deepEqual(data,before);
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
  client.callback(example());
  resolve(()=>{client.cancels++;});
  await Promise.resolve();
  assert.equal(client.cancels,1);
  assert.equal(store.state.data,null);
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
  assert.equal(result.headline,"Receiver didn't respond");
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
  assert.equal(result.headline,"Receiver didn't respond");
  assert.equal(result.reportedAt,failure.observed_at);
  assert.equal(result.historical,true);
  assert.match(result.summary,/last connection attempt timed out.*trying again/);
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
  assert.match(ready.impact,/outside configured functions are not assessed/);
  const open=diagnosticOverview(entry,{readiness:{answer:"ready"}},[{name:"Movie night"}],true);
  assert.match(open.assessment,/still awaiting confirmed recovery/);
  assert.match(open.impact,/Movie night/);
  const disabled=diagnosticOverview({...entry,disabled:true},{readiness:{answer:"unknown"}});
  assert.match(disabled.monitoring,/cannot assess its health/);
  assert.match(disabled.assessment,/cannot establish readiness/);
  assert.match(diagnosticOverview({...entry,kind:"function"},{readiness:{answer:"blocked"}}).impact,/declared requirements/);
  assert.match(diagnosticOverview({...entry,kind:"situation"},{readiness:null},[],true).impact,/separate from equipment/);
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
  data.inventory.nodes=[entry,speaker,signal];
  data.inventory.catalog.candidates=[entry,speaker,signal];
  data.devices=[{id:"speaker-device",name:"Kitchen speaker device"}];
  const groups=monitoringTree(data);
  assert.equal(groups[0].name,"Music Assistant");
  assert.equal(groups[0].devices[0].name,"Kitchen speaker device");
  assert.equal(groups[0].devices[0].entities[0].name,"Kitchen speaker");
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
