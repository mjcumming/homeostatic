import {editInstallation,installationSettings} from "../../custom_components/homeostatic/frontend/installation-settings.mjs";
import {filterSources, sourcePaths, sourcesBrowser, sourcesTree} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {monitoringExample, baseSource} from "./monitoring-fixture.mjs";
import {sharedIssueCountsFixture,locationIssueFixture} from "./shared-issue-counts-fixture.mjs";
import {deviceProblem, entityProblem, integrationProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {historyAccount, historyName, historyPage, observedRange, attentionActionAllowed, controlPayload, controlAllowed, callAction, controlsPanel, RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {diagnosticOverview} from "../../custom_components/homeostatic/frontend/evidence.mjs";
import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";

import {DashboardStore, affectedFunctions, dashboardStore,
  escapeHtml, inventoryRows, locationList, locationTree,
  sortedEpisodes, visibleEpisodes, sourceMap, mergeDashboard} from "../../custom_components/homeostatic/frontend/model.mjs";
import {monitoringTree} from "../../custom_components/homeostatic/frontend/configuration.mjs";






function source(id, fields = {}) {
  return {node_id:id,name:id,kind:"entity",attributes:{},watched:true,
    requirements:[],attached_by:["passive"],...fields};
}
function example() {
  return {
    schema_version:1,available:true,
    inventory:{nodes:[source("sensor.a",{attributes:{area:["garage"]}}),source("function.f",{kind:"function"})],
      catalog:{candidates:[source("sensor.a"),source("sensor.excluded",{watched:false,})]},
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
const recoveryScenarios = JSON.parse(readFileSync(new URL("../fixtures/recovery-presentation.json", import.meta.url)));
for (const scenario of recoveryScenarios) {
  test(`recovery presentation: ${scenario.id}`, () => {
    const data=example();
    const anchor=source("anchor",{kind:scenario.kind,attributes:{domain:["light"]}});
    const current={reason:scenario.reason};
    const episode={episode_id:"current",anchor:"anchor",importance:"normal",opened_at:"2026-10-13T10:00:00Z",reasons:scenario.related};
    data.inventory.nodes=[anchor];
    data.inventory.integration_evidence={anchor:{current,last_failure:null}};
    data.inventory.entity_status={anchor:{current,explanation:{findings:[],nodes:[]},readiness:{answer:"blocked"}}};
    data.inventory.episodes=[episode];
    assert.equal(visibleEpisodes(data).length,Number(scenario.visible));
    assert.equal(sortedEpisodes(data).length,Number(scenario.visible));
    const problem=integrationProblem(anchor,episode.reasons,()=>null,{current}) ?? deviceProblem(anchor,{current}) ?? entityProblem(anchor,data.inventory.entity_status.anchor);
    assert.doesNotMatch(problem.summary,/running again|state.*again/);
    assert.equal(scenario.headline ?? problem.headline,problem.headline);
  });
}

for (const [kind, reason] of [["entity","source_missing"],["device","incomplete_evidence"]]) {
  test(`${kind} availability keeps a reported problem visible through missing evidence`,()=>{
    const data=example(),anchor=source("availability",{kind,check_id:"availability"});
    const episode={episode_id:"retained",anchor:anchor.node_id,recorded:[anchor.node_id],importance:"normal",opened_at:"2026-10-16T10:00:00Z",reasons:[{node_id:anchor.node_id,check_id:"availability",status:"unknown",reason:"stale"}]};
    const status={current:{status:"unknown",reason},last_failure:{status:"warn",reason:kind==="entity"?"unavailable":"all_unavailable",message:"Home Assistant reported unavailable."}};
    data.inventory.nodes=[anchor];
    data.inventory.episodes=[episode];
    data.inventory.entity_status={[anchor.node_id]:status};
    const before=structuredClone(data);
    assert.deepEqual(visibleEpisodes(data),[episode]);
    assert.deepEqual(sortedEpisodes(data),[episode]);
    assert.deepEqual(data,before,"Presentation must not alter the retained report or issue");
    delete status.last_failure;
    assert.deepEqual(visibleEpisodes(data),[episode],"An older open problem with incomplete report history remains visible");
    status.last_failure=null;
    assert.deepEqual(visibleEpisodes(data),[],"Unknown evidence without a previous problem stays out of the issue queue");
    status.current={status:"pass",reason:"available"};
    episode.reasons=[];
    assert.deepEqual(visibleEpisodes(data),[],"Current passing evidence retains the normal recovery presentation");
  });
}

test("a shared availability issue retains a member's earlier problem through missing evidence",()=>{
  const data=example(),anchor=source("entry:owner",{kind:"integration",check_id:"availability"}),member=source("availability:member",{check_id:"availability"});
  const episode={episode_id:"shared-retained",anchor:anchor.node_id,recorded:[anchor.node_id,member.node_id],reasons:[{node_id:member.node_id,check_id:"availability",status:"unknown",reason:"stale"}]};
  data.inventory.nodes=[anchor,member];
  data.inventory.episodes=[episode];
  data.inventory.integration_evidence={[anchor.node_id]:{current:{status:"pass",reason:"loaded"},last_failure:null}};
  data.inventory.entity_status={[member.node_id]:{current:{status:"unknown",reason:"source_missing"},last_failure:{status:"warn",reason:"unavailable",message:"Earlier member problem"}}};
  assert.deepEqual(visibleEpisodes(data),[episode]);
  data.inventory.entity_status[member.node_id].last_failure=null;
  assert.deepEqual(visibleEpisodes(data),[],"A loaded integration does not turn a gap-only member into a problem");
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
  assert.equal(locations.find((location)=>location.id==="group:unassigned"),undefined);
  assert.deepEqual(data,before);
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
  assert.equal(store.state.status,"loading");
  assert.equal(store.state.data.available,true);
  assert.equal(store.baseline,null);
});
test("retained snapshots are scoped to the authenticated user",async()=>{
  const client=connection(), first=dashboardStore(client,"owner");
  const stop=first.listen(()=>{});
  client.callback(example());
  stop();
  await Promise.resolve();
  assert.equal(dashboardStore(client,"owner"),first);
  const other=dashboardStore(client,"other");
  assert.notEqual(other,first);
  assert.equal(other.state.data,null);
  assert.equal(other.state.status,"loading");
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
  assert.equal(store.state.data,snapshot);
  assert.equal(store.baseline,null);
  const remounted=[];
  const third=store.listen(state=>remounted.push(state));
  assert.equal(remounted[0].status,"loading");
  assert.equal(remounted[0].data,snapshot);
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
  const finishes=[];
  client.sendMessagePromise=request=>{
    requests.push(request);
    return new Promise(resolve=>{finishes.push(()=>resolve(catalogPage(request,old.sections)));});
  };
  const pending=store.ensureCatalog();await Promise.resolve();
  client.callback(fresh.data);
  client.sendMessagePromise=async request=>{requests.push(request);return catalogPage(request,fresh.sections);};
  finishes.forEach(finish=>finish());await pending;await store.catalogTask;
  assert.equal(store.state.data.catalog_revision,2);
  assert.equal(store.state.data.catalog_loaded,true);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,fresh.sections.candidates);
  assert.equal(requests.filter(request=>request.revision===1).length,4);
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
  const finishes=[];
  client.sendMessagePromise=request=>new Promise(resolve=>{finishes.push(()=>resolve(catalogPage(request,sections)));});
  const pending=store.ensureCatalog();await Promise.resolve();
  client.events.get("disconnected")();
  client.sendMessagePromise=async request=>catalogPage(request,sections);
  client.callback(data);await store.ensureCatalog();
  assert.equal(store.state.data.catalog_loaded,true);
  finishes.forEach(finish=>finish());await pending;
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
  const finishes=[];
  client.sendMessagePromise=request=>new Promise(resolve=>{finishes.push(()=>resolve(catalogPage(request,sections)));});
  const pending=store.ensureCatalog();await Promise.resolve();
  invalidate(client,stop);await Promise.resolve();finishes.forEach(finish=>finish());await pending;
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
  assert.equal(running.headline,"Running — confirming recovery");
  assert.equal(running.reported,"");
  assert.equal(running.needsAction,false);
  assert.match(running.summary,/confirming that it stays available/);
  const healthy=integrationProblem(entry,[],()=>null,{current:{reason:"loaded"},last_failure},false);
  assert.equal(healthy.headline,"Connection available");
  assert.doesNotMatch(healthy.summary,/problem|recovery/);
  assert.equal(healthy.needsAction,false);
});

test("a loaded integration counts unidentified sources without inventing equipment types",()=>{
  const entry=source("entry:matter",{kind:"integration",name:"Matter"});
  const outstanding=[
    {node_id:"monitoring:devices:device:table",check_id:"availability",status:"fail",reason:"some_unavailable"},
    {node_id:"monitoring:entities:entity:table",check_id:"availability",status:"fail",reason:"unavailable"},
    {node_id:"monitoring:extra:entity:table",check_id:"availability",status:"fail",reason:"unavailable"},
    {node_id:"runtime:condition",check_id:"condition",status:"unknown",reason:"source_missing"},
  ];
  const findings=[{node_id:entry.node_id,status:"pass",reason:"loaded"},...outstanding,
    {node_id:"monitoring:devices:device:recovered",status:"pass",reason:"available"}];
  const result=integrationProblem(entry,findings,()=>null,{current:{reason:"loaded"}});
  assert.equal(result.headline,"4 sources need attention");
  assert.match(result.summary,/reports .* loaded/);
  assert.doesNotMatch(result.summary,/integration failed|confirming/);
  assert.deepEqual(result.relatedEvidence.counts,{devices:0,entities:0,sources:4,checks:4});
  assert.equal(result.nextStep,"Review the affected sources below.");
  assert.equal(result.progress,"Checks need attention");
  assert.equal(result.tone,"uncertain");
  assert.equal(result.needsAction,false);
  assert.deepEqual(result.relatedFindings,outstanding);
  assert.equal(findings.length,6);

  const recovered=integrationProblem(entry,findings.map(item=>({...item,status:"pass"})),()=>null,{current:{reason:"loaded"}});
  assert.equal(recovered.headline,"Running — confirming recovery");
  assert.equal(recovered.needsAction,false);
  assert.deepEqual(recovered.relatedFindings,[]);
  const current=integrationProblem(entry,findings,()=>null,{current:{reason:"loaded"}},false);
  assert.equal(current.headline,"Connection available");
  assert.equal(current.needsAction,false);
  assert.deepEqual(current.relatedFindings,[]);
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

test("pause request requires explicit bounded expiry and rejects maintenance creation", () => {
  const now=Date.parse("2026-09-25T12:00:00Z");
  const shelf={kind:"shelve",target:"episode-1",untilLocal:"2026-09-25T13:00:00Z",reason:"Replacing sensor",includeDependents:true};
  assert.deepEqual(controlPayload(shelf,now),{episode_id:"episode-1",until:"2026-09-25T13:00:00.000Z",reason:"Replacing sensor"});
  assert.throws(()=>controlPayload({...shelf,kind:"maintenance",target:"sensor.a"},now),/Only issue notification pauses/);
  for(const untilLocal of ["","not-a-date","2026-09-25T12:00:00Z","2026-10-02T12:00:01Z"]){
    assert.throws(()=>controlPayload({...shelf,untilLocal},now),/end time/);
  }
  assert.doesNotThrow(()=>controlPayload({...shelf,untilLocal:"2026-10-02T12:00:00Z"},now));
  assert.throws(()=>controlPayload({...shelf,reason:"a".repeat(501)},now),/500/);
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
  assert.equal(controlAllowed(current,true,{kind:"maintenance",target:"sensor.a"}),false);
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
  assert.match(html,/Existing problems and notifications remain active/);
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
  assert.equal(entityProblem(light,entityStatus(null,"ready")).headline,"Available — confirming recovery");
  assert.equal(entityProblem(light,entityStatus(null,"ready"),null,[],()=>null,false).headline,"Light available");
  assert.equal(entityProblem(light,{...entityStatus(null,"blocked"),current:{reason:"available"}}).headline,"Available — confirming recovery");
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
  assert.match(sourcesBrowser(card),/<option value="topomation">TopoMation locations<\/option>/);
  assert.doesNotMatch(sourcesBrowser(card),/Explore TopoMation|sources-topomation-note/);
  card.sourcesGrouping="topomation";
  assert.match(sourcesBrowser(card),/<option value="topomation" selected>TopoMation locations<\/option>/);
  card.sourcesGrouping="integration";
  card.topomation=null;
  assert.doesNotMatch(sourcesBrowser(card),/<option value="topomation"/);
  assert.doesNotMatch(sourcesBrowser(card),/Want a deeper house tree\?/);
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

function issueScopeCard(data) {
  const paths=sourcePaths(sourcesTree(data));
  return {current:{status:"current",data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(paths.keys()),sourcesSelection:null,sourcesView:"source"};
}

function issueScopeBadge(html,key) {
  const row=html.split(`data-sources-select="${escapeHtml(key)}"`)[1]?.split("</button>")[0]||"";
  return row.match(/<span class="source-issue-count">([^<]+)<\/span>/)?.[1]||"";
}

for(const variant of ["shared","independent","aliases","partial"]) {
  test(`Monitoring ${variant} issues keep group indicators and distinct source links`,()=>{
    const {data,devices,episodes}=sharedIssueCountsFixture(variant),card=issueScopeCard(data),before=structuredClone(data);
    const html=sourcesBrowser(card);
    assert.equal(issueScopeBadge(html,"source:entry:scope"),"Issues");
    for(const device of devices) {
      assert.equal(issueScopeBadge(html,`source:${device.node_id}`),"Issues");
      card.sourcesSelection=`source:${device.node_id}`;
      const selected=sourcesBrowser(card).split('<section class="config-detail"')[1];
      const expected=episodes.filter(item=>item.anchor===device.node_id||item.recorded.includes(device.node_id)).map(item=>item.episode_id);
      assert.deepEqual([...selected.matchAll(/data-episode="([^"]+)"/g)].map(match=>match[1]),expected);
    }
    assert.equal(issueScopeBadge(html,"source:entity:impact"),"");
    card.sourcesQuery="Speaker 1 reading 1";
    const filtered=sourcesBrowser(card);
    assert.equal(issueScopeBadge(filtered,"source:entry:scope"),"Issues");
    assert.equal(issueScopeBadge(filtered,"source:device:scope-0"),"Issues");
    assert.doesNotMatch(filtered,/data-sources-select="source:device:scope-1"/);
    assert.deepEqual(data,before);
  });
}

for(const variant of ["mixed","loose","connections"]) {
  test(`Monitoring ${variant} scope preserves loose members without inventing or double-counting devices`,()=>{
    const {data}=sharedIssueCountsFixture(variant),card=issueScopeCard(data),tree=sourcesTree(data);
    assert.equal(issueScopeBadge(sourcesBrowser(card),tree[0].key),"Issues");
  });
}

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

test("Sources keeps one detail view with inline history and no empty settings tab",()=>{
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
  assert.doesNotMatch(source,/sources-views/);
  assert.match(source,/data-sources-view="history">View history<\/a>/);
  assert.doesNotMatch(source,/Ended-problem history is unavailable/);
  card.sourcesView="settings";
  const settings=sourcesBrowser(card);
  assert.match(settings,/Reading current Home Assistant values/);
  assert.doesNotMatch(settings,/Loading monitoring choices|Save changes/);
  card.sourcesView="history";
  const history=sourcesBrowser(card);
  assert.match(history,/Ended-problem history is unavailable/);
  assert.doesNotMatch(history,/Edit monitoring/);
  card.sourcesSelection="source:entity:registry:camera-1-1";
  const entity=sourcesBrowser(card);
  assert.doesNotMatch(entity,/<h3>Technical details<\/h3>|Entity ID:/);
  assert.match(entity,/href="\/config\/devices\/device\/camera-1"[^>]*>Back Porch<\/a>/);
  assert.match(entity,/href="\/config\/integrations\/integration\/frigate#config_entry=frigate"[^>]*>Frigate<\/a>/);
});



test("removed device history uses its saved name and explains the monitoring limit", () => {
  const item={resolution:"removed",source:null,episode:{episode_id:"ended-device",anchor:"device:opaque-id",labels:{name:"Former controller"},reasons:[{check_id:"availability",reason:"all_unavailable",message:"Former controller: all unavailable"}]}};
  assert.equal(historyName(item),"Former controller");
  assert.equal(historyName({...item,source:{name:"device:opaque-id"}}),"Former controller");
  assert.equal(historyPage({episodes:[item]},"former controller").total,1);
  assert.deepEqual(historyAccount(item),["Home Assistant reported every monitored entity on this device as unavailable.","Monitoring ended without an observed recovery."]);
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
  assert.match(html,/Home Theater <span class="source-issue-count">Issues<\/span><\/span><small>Device/);
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

test("device availability explains its operational scope without including diagnostics",()=>{
  const html=deviceAvailability({status:"unavailable",basis:"entities",reason:"all_entities_unavailable"});
  assert.match(html,/Every enabled operational entity is unavailable/);
  assert.match(html,/Diagnostic and configuration entities are excluded/);
  assert.doesNotMatch(html,/disconnected|all enabled entities/);
  assert.equal(deviceEntityName("ESP Presence Kitchen Fridge Motion","ESP Presence Kitchen Fridge"),"Motion");
  assert.equal(deviceEntityName("ESP Presence Kitchen Fridge","ESP Presence Kitchen Fridge"),"ESP Presence Kitchen Fridge");
});

for (const grouping of ["integration","location","topomation"]) {
  for (const selection of [null,"source:removed"]) {
    test(`Sources ${grouping} leaves rows unselected for ${selection}`,()=>{
      const card={current:{data:monitoringExample()},sourcesGrouping:grouping,sourcesQuery:"",sourcesNeedsReview:false,
        sourcesExpanded:new Set(),sourcesSelection:selection,sourcesView:"source",topomation:{locations:[{id:"house",name:"House"}]}};
      const html=sourcesBrowser(card);
      assert.doesNotMatch(html,/<button[^>]*data-sources-select[^>]*aria-current="true"/);
      assert.match(html,/Select an item/);
    });
  }
}

for (const grouping of ["integration","location"]) {
  test(`Sources ${grouping} highlights only the selected group`,()=>{
    const data=monitoringExample(),tree=sourcesTree(data,grouping),selected=tree[0];
    const card={current:{data},sourcesGrouping:grouping,sourcesQuery:"",sourcesNeedsReview:false,
      sourcesExpanded:new Set([selected.key]),sourcesSelection:selected.key,sourcesView:"history"};
    const html=sourcesBrowser(card);
    const current=[...html.matchAll(/<button[^>]*data-sources-select="([^"]+)"[^>]*aria-current="true"/g)];
    assert.deepEqual(current.map(match=>match[1]),[selected.key]);
  });
}

test("Sources selects only the paired device when viewing its connection",()=>{
  const data=monitoringExample();
  data.inventory.nodes=[
    baseSource("entry:first","First connection","integration",{entry_id:"first",attributes:{domain:["sample"]}}),
    baseSource("entry:second","Second connection","integration",{entry_id:"second",attributes:{domain:["sample"]}}),
    baseSource("device:first","First device","device",{attributes:{device:["first"],integration:["first"]}}),
    baseSource("device:second","Second device","device",{attributes:{device:["second"],integration:["second"]}}),
  ];
  data.devices=[{id:"first",name:"First device",config_entry_id:"first"},{id:"second",name:"Second device",config_entry_id:"second"}];
  data.inventory.catalog.candidates=data.inventory.nodes;
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set([sourcesTree(data)[0].key]),sourcesSelection:"source:entry:first",sourcesView:"history"};
  const html=sourcesBrowser(card);
  const current=[...html.matchAll(/<button[^>]*data-sources-select="([^"]+)"[^>]*aria-current="true"/g)];
  assert.deepEqual(current.map(match=>match[1]),["source:device:first"]);
});

test("Sources starts collapsed with issue indicators and source kinds beside names",()=>{
  const data=monitoringExample();
  const device=data.inventory.nodes.find(row=>row.node_id==="device:camera-0");
  const separate=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-1");
  const unselected=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-2");
  const entityOnly=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-4");
  const disabled=data.inventory.nodes.find(row=>row.node_id==="entity:registry:camera-0-5");
  device.availability_entities=device.availability_entities.filter(id=>![unselected.entity_id,entityOnly.entity_id].includes(id));
  separate.watched=true;
  entityOnly.watched=true;disabled.disabled=true;
  data.inventory.episodes=[{episode_id:"camera-issue",anchor:device.node_id,opened_at:"2026-09-30T12:00:00Z",reasons:[]}];
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:null,sourcesView:"source",sourcesShowDisabled:true};
  const closed=sourcesBrowser(card);
  assert.match(closed,/Frigate <span class="source-issue-count">Issues<\/span><\/span><small>Integration/);
  assert.doesNotMatch(closed,/data-sources-select="source:device:camera-0"/);
  assert.match(closed,/data-action="collapse-sources" disabled>Collapse groups/);
  card.sourcesExpanded.add("source:entry:frigate");
  card.sourcesExpanded.add("source:device:camera-0");
  const opened=sourcesBrowser(card);
  assert.match(opened,/Back Deck <span class="source-issue-count">Issues<\/span><\/span><small>Device/);
  assert.match(opened,/Back Deck signal 000<\/span><small>Not monitored/);
  assert.match(opened,/Back Deck signal 001<\/span><small>Monitored<\/small>/);
  assert.match(opened,/Back Deck signal 002<\/span><small>Not monitored/);
  assert.match(opened,/Back Deck signal 003<\/span><small>Monitored<\/small>/);
  assert.match(opened,/Back Deck signal 004<\/span><small>Monitored<\/small>/);
  assert.match(opened,/Back Deck signal 005<\/span><small>Disabled in Home Assistant<\/small>/);
  assert.match(opened,/data-action="collapse-sources">Collapse groups/);
  card.sourcesQuery="Back Deck signal 003";
  assert.match(sourcesBrowser(card),/Back Deck <span class="source-issue-count">Issues<\/span><\/span><small>Device/);
});

test("Sources starts with source selection rather than setup documentation",()=>{
  const card={current:{data:monitoringExample()},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,
    sourcesExpanded:new Set(),sourcesSelection:null,sourcesView:"source"};
  const closed=sourcesBrowser(card);
  assert.match(closed,/Select an item/);
  assert.match(closed,/See its status, issues and monitoring\./);
  assert.match(closed,/<label class="coverage-search">Search<input/);
  assert.match(closed,/aria-label="Monitoring tree"/);
  assert.doesNotMatch(closed,/sources-explainer|New installations|diagnostic entities/);
});

test("cleared device history explains HA evidence without claiming a physical repair", () => {
  const item={resolution:"cleared",source:{kind:"device",name:"Family Room Frigate"},episode:{form:"root",reasons:[{check_id:"availability",reason:"some_unavailable",message:"Family Room Frigate: some unavailable"}]}};
  const [reported,ending]=historyAccount(item);
  assert.equal(reported,"Home Assistant reported some monitored entities on this device as unavailable.");
  assert.equal(ending,"");
  assert.doesNotMatch([reported,ending].join(" "),/physical repair|confirmed recovery/);
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
  assert.match(html,/<dt>Availability<\/dt><dd>Available<\/dd>/);
  assert.match(html,/1 of 1 monitored entity is unavailable/);
  assert.match(html,/Required sensor/);
  assert.doesNotMatch(html,/Home Assistant cannot currently report|Next step:/);
});

test("Sources treats a current connectivity off report as available",()=>{
  const data=monitoringExample(),id="device:camera-0";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:`source:${id}`,sourcesView:"source",
    sourceDetail:{nodeId:id,device_availability:{status:"available",basis:"entities",reason:"entity_available"},members:[{name:"Camera Connectivity",node_id:"binary_sensor.camera_connectivity",state:"off",connectivity:true}],total:1,unavailable_count:0,unknown_count:0}};
  const html=sourcesBrowser(card);
  assert.match(html,/Monitored entities are available/);
  assert.match(html,/<dt>Availability<\/dt><dd>Available<\/dd>/);
  assert.match(html,/<td>off<\/td>/);
  assert.doesNotMatch(html,/Entities needing review|Disconnected|Connection reports disconnected/);
});

test("entity detail shows HA state and monitoring once; device rows navigate",()=>{
  const data=monitoringExample(),entityId="entity:registry:camera-1-1",deviceId="device:camera-1";
  const member={node_id:entityId,name:"Back Porch signal 001",state:"unavailable"};
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${entityId}`,sourceDetail:{nodeId:entityId,members:[member],total:1,unavailable_count:1,unknown_count:0}};
  const entity=sourcesBrowser(card);
  assert.match(entity,/Home Assistant reports this entity as unavailable/);
  assert.match(entity,/Used to assess device availability/);
  assert.match(entity,/Configure monitoring/);
  assert.doesNotMatch(entity,/<h3>Home Assistant entities<\/h3>|This entity has no separate check|Next step:/);
  assert.equal((entity.match(/Back Porch signal 001/g)??[]).length,1);
  assert.doesNotMatch(entity,/data-source-link="entity:registry:camera-1-1"/);
  card.sourcesSelection=`source:${deviceId}`;
  card.sourceDetail={...card.sourceDetail,nodeId:deviceId};
  const device=sourcesBrowser(card);
  assert.match(device,/<button type="button" class="link" data-source-link="entity:registry:camera-1-1">signal 001<\/button>/);
});

test("device details put unavailable entities first and collapse other readings",()=>{
  const data=monitoringExample(),id="device:camera-1";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${id}`,sourceDetail:{nodeId:id,members:[
      {node_id:"entity:registry:camera-1-1",name:"Broken sensor",state:"unavailable"},
      {node_id:"entity:registry:camera-1-2",name:"Working sensor",state:"18"}],total:2,unavailable_count:1,unknown_count:0}};
  const html=sourcesBrowser(card);
  assert.match(html,/1 of 2 monitored entities are unavailable/);
  assert.match(html,/Entities needing review.*Broken sensor/s);
  assert.match(html,/<details class="source-section source-monitoring-explanation"[^>]*><summary>Details<\/summary>.*<h3>1 other monitored entity<\/h3>.*Working sensor/s);
  assert.doesNotMatch(html.split('<details class="source-section source-monitoring-explanation"')[0],/Working sensor/);
  assert.match(html,/href="\/config\/devices\/device\/camera-1">Go to device page/);
  assert.doesNotMatch(html,/Home Assistant cannot currently report|Next step:/);
});

test("entity details separate availability from its current value",()=>{
  const data=monitoringExample(),id="entity:registry:camera-1-1";
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesView:"source",
    sourcesSelection:`source:${id}`,sourceDetail:{nodeId:id,members:[{node_id:id,name:"Back Porch signal 001",state:"18",unit:"%"}],total:1}};
  assert.match(sourcesBrowser(card),/<p class="source-entity-condition">Available in Home Assistant<\/p>.*<p class="source-current-value">18%<\/p>/s);
  card.sourceDetail.members[0].state="unknown";
  assert.match(sourcesBrowser(card),/Home Assistant reports no value/);
  assert.doesNotMatch(sourcesBrowser(card),/<dt>Current value<\/dt><dd>unknown<\/dd>|Unavailable in Home Assistant/);
});


test("availability refresh follows excluded entities without reacting to value churn",()=>{
  const value={entity_ids:["sensor.excluded"]};
  const state=value=>({"sensor.excluded":{state:value,attributes:{}}});
  assert.equal(deviceAvailabilityStamp(value,state("42")),deviceAvailabilityStamp(value,state("43")));
  assert.equal(deviceAvailabilityStamp(value,state("unknown")),deviceAvailabilityStamp(value,state("off")));
  assert.notEqual(deviceAvailabilityStamp(value,state("off")),deviceAvailabilityStamp(value,state("unavailable")));
  assert.notEqual(deviceAvailabilityStamp(value,state("unavailable")),deviceAvailabilityStamp(value,{}));
});

test("connectivity values do not create availability refreshes while still available",()=>{
  const id="binary_sensor.connection";
  const value={entity_ids:[id],connectivity_entity_ids:[id]};
  const state=(value)=>({[id]:{state:value,attributes:{}}});
  assert.equal(deviceAvailabilityStamp(value,state("on")),deviceAvailabilityStamp(value,state("off")));
  assert.equal(deviceAvailabilityStamp(value,state("off")),deviceAvailabilityStamp(value,state("unknown")));
  assert.notEqual(deviceAvailabilityStamp(value,state("off")),deviceAvailabilityStamp(value,state("unavailable")));
});


test("selected device refresh coalesces reads and notices access changes",async(t)=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?availability-test");
  const card=Object.create(elements.get("homeostatic-card-v38").prototype);
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


test("policy configuration loads without delivery discovery and discovery preserves the draft",async(t)=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?configuration-test");
  const card=Object.create(elements.get("homeostatic-card-v38").prototype);
  const calls=[],pending=[];
  Object.assign(card,{page:"policies",render(){},_hass:{connection:{},callWS(request){calls.push(request);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});
  const settings={monitoring_policies:[{id:"one",name:"Saved policy"}],notification_definitions:{methods:{}}};
  const loading=card.loadConfiguration();
  assert.deepEqual(calls,[{type:"homeostatic/configuration",section:"settings"}]);
  pending[0].resolve({revision:"one",rules:[],settings,alerts:{notifications:false,consumer:null}});
  await loading;
  card.settingsDraft.monitoring_policies[0].name="Unsaved policy";
  const draft=card.settingsDraft;
  const discovery=card.loadDeliveryConfiguration();
  await card.loadDeliveryConfiguration();
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1],{type:"homeostatic/configuration",section:"delivery"});
  pending[1].reject(Error("Discovery failed"));
  await discovery;
  assert.equal(card.deliveryError,"Discovery failed");
  assert.equal(card.settingsDraft,draft);
  const retry=card.loadDeliveryConfiguration(true);
  pending[2].resolve({delivery_targets:[{channel:"phone:one",name:"Owner phone"}],notification_people:[],notification_destinations:[],consumers:[]});
  await retry;
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Unsaved policy");
  assert.equal(card.deliveryError,null);
  await card.loadDeliveryConfiguration();
  assert.equal(calls.length,3);
});

test("catalog uses four bounded workers and keeps out-of-order pages coherent",async()=>{
  const {data,sections}=pagedExample(1,1601),client=connection(),store=dashboardStore(client),pending=[];
  let active=0,maximum=0;
  const stop=store.listen(()=>{});client.callback(data);
  client.sendMessagePromise=request=>new Promise(resolve=>{active++;maximum=Math.max(maximum,active);pending.push(()=>{active--;resolve(catalogPage(request,sections));});});
  let done=false;const loading=store.ensureCatalog().then(()=>{done=true;});
  await Promise.resolve();assert.equal(active,4);
  while(!done){pending.splice(0).reverse().forEach(finish=>finish());await new Promise(resolve=>setImmediate(resolve));}
  await loading;
  assert.equal(maximum,4);
  assert.deepEqual(store.state.data.inventory.catalog.candidates,sections.candidates);
  stop();await Promise.resolve();
});

for(const grouping of ["integration","location","topomation"])test(`Sources disabled visibility in ${grouping}`,()=>{
  const data=monitoringExample();
  const disabled=data.inventory.nodes.find(source=>source.node_id==="entry:other-0");
  disabled.disabled=true;
  const entity=data.inventory.nodes.find(source=>source.node_id==="entity:registry:camera-1-1");
  entity.disabled=true;
  const device=data.inventory.nodes.find(source=>source.node_id==="device:standalone");
  device.disabled=true;
  const before=JSON.stringify(data);
  const topology={locations:[{id:"room",name:"Room",entity_ids:[entity.entity_id]}]};
  const hidden=sourcesTree(data,grouping,null,topology,false);
  const visible=sourcesTree(data,grouping,null,topology,true);
  for(const source of [disabled,entity,device]) {
    assert.equal(sourcePaths(hidden).has(`source:${source.node_id}`),false);
    assert.equal(sourcePaths(filterSources(hidden,source.name)).has(`source:${source.node_id}`),false);
    assert.equal(sourcePaths(visible).has(`source:${source.node_id}`),true);
  }
  assert.equal(sourcePaths(hidden).has("source:entry:other-1"),true);
  assert.equal(sourcePaths(hidden).has("source:entity:registry:standalone"),true);
  assert.equal(JSON.stringify(data),before);
});

test("Sources defaults to hidden and explains disabled monitoring when revealed",()=>{
  const data=monitoringExample(),source=data.inventory.nodes.find(row=>row.node_id==="entry:other-0");
  source.disabled=true;
  const card={current:{data},sourcesGrouping:"integration",sourcesExpanded:new Set(),sourcesSelection:`source:${source.node_id}`};
  assert.doesNotMatch(sourcesBrowser(card),/data-sources-disabled checked|Monitoring paused while disabled/);
  assert.match(sourcesBrowser(card),/Include disabled sources/);
  card.sourcesShowDisabled=true;
  assert.match(sourcesBrowser(card),/data-sources-disabled checked/);
  assert.match(sourcesBrowser(card),/Monitoring paused while disabled\. Saved monitoring choices resume when re-enabled\./);
  card.sourcesShowDisabled=false;
  assert.doesNotMatch(sourcesBrowser(card),/Monitoring paused while disabled/);
  source.disabled=false;
  assert.match(sourcesBrowser(card),/data-sources-select="source:entry:other-0"/);
});

for(const [name,expected,badge] of [
  ["Main Floor",["shared","kitchen-one","kitchen-two","mud"],"Issues"],
  ["Front Entry",["shared"],"Issues"],
  ["Kitchen",["shared","kitchen-one","kitchen-two"],"Issues"],
  ["Mud Room",["mud"],"Issues"],
  ["Living Room",[],""],
]) {
  test(`Location ${name} lists its distinct issues without suggesting additive totals`,()=>{
    const {data}=locationIssueFixture(),card=issueScopeCard(data);
    card.sourcesGrouping="location";
    const paths=sourcePaths(sourcesTree(data,"location"));
    card.sourcesExpanded=new Set(paths.keys());
    const node=[...paths.values()].find(item=>item.node.name===name&&item.node.type==="location").node;
    card.sourcesSelection=node.key;
    const html=sourcesBrowser(card),detail=html.split('<section class="config-detail"')[1];
    assert.equal(issueScopeBadge(html,node.key),badge);
    assert.deepEqual([...detail.matchAll(/data-episode="([^"]+)"/g)].map(match=>match[1]).sort(),[...expected].sort());
    const navigation=html.split('<nav class="config-rail"')[1].split("</nav>")[0];
    assert.doesNotMatch(navigation,/\d+ (?:issues?|devices?|entities|items)\b|issues? across/);
    card.sourcesQuery="Front Entry";
    const filtered=sourcesBrowser(card),floor=[...paths.values()].find(item=>item.node.name==="Main Floor").node;
    assert.equal(issueScopeBadge(filtered,floor.key),"Issues");
    assert.equal(card.sourcesSelection,node.key);
    data.inventory.episodes=[];
    assert.doesNotMatch(sourcesBrowser(card),/source-issue-count/);
  });
}
