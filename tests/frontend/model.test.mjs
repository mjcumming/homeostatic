import {integrationProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import assert from "node:assert/strict";
import {test} from "node:test";
import {DashboardStore, affectedFunctions, areaGroups, dashboardStore, escapeHtml,
  inventoryRows, monitoringLabel, sortedEpisodes} from "../../custom_components/homeostatic/frontend/model.mjs";

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
    functions:[
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
test("area moves regroup by identity without losing unassigned sources",()=>{
  const data=example();
  const before=structuredClone(data);
  let groups=areaGroups(data);
  assert.equal(groups.find(x=>x.id==="garage").sources[0].node_id,"sensor.a");
  assert.equal(groups.find(x=>x.id==="").sources.length,2);
  assert.deepEqual(data,before);
  data.inventory.nodes[0].attributes.area=["missing"];
  groups=areaGroups(data);
  assert.equal(groups.length,1);
  assert.equal(groups[0].sources.length,3);
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


test("integration explanations distinguish a reported cause, reauth, and missing detail",()=>{
  const entry=source("entry:bathroom",{kind:"integration",name:"Master Bathroom",entry_id:"bathroom",attributes:{domain:["nuheat"]}});
  const describe=(reason,message)=>integrationProblem(entry,[{node_id:entry.node_id,reason,message}],()=>"NuHeat");
  const setup=describe("setup_error","Master Bathroom: Unable to sign in to provider");
  assert.equal(setup.reported,"Unable to sign in to provider");
  assert.equal(setup.headline,"Integration couldn't start");
  assert.match(setup.summary,/NuHeat/);
  assert.equal(setup.integrationUrl,"/config/integrations/integration/nuheat#config_entry=bathroom");
  assert.equal(setup.logsUrl,"/config/logs?filter=nuheat");
  assert.equal(setup.missingDetail,false);
  const auth=describe("auth_required","Master Bathroom: Session expired");
  assert.equal(auth.headline,"Sign-in required");
  assert.match(auth.nextStep,/complete its sign-in prompt/);
  assert.equal(auth.reported,"Session expired");
  const generic=describe("setup_error","Master Bathroom: setup error");
  assert.equal(generic.reported,"");
  assert.equal(generic.missingDetail,true);
  assert.equal(generic.logsPrimary,true);
  assert.doesNotMatch(generic.summary,/password|sign.in/);
  assert.match(describe("setup_retry","Connection timed out").summary,/retry automatically/);
  const disabled=describe("disabled","Master Bathroom: disabled");
  assert.match(disabled.nextStep,/If this is intentional/);
  assert.equal(disabled.reported,"");
  assert.equal(disabled.logsUrl,null);
});

test("native destinations encode untrusted identifiers and old findings have honest fallbacks",()=>{
  const entry=source("entry:a",{kind:"integration",entry_id:'a&x="bad"',attributes:{domain:['test/?"bad']}});
  const result=integrationProblem(entry,[{reason:"setup_error"}]);
  assert.equal(result.integrationUrl,"/config/integrations/integration/test%2F%3F%22bad#config_entry=a%26x%3D%22bad%22");
  assert.equal(result.logsUrl,"/config/logs?filter=test%2F%3F%22bad");
  assert.equal(result.missingDetail,true);
  assert.equal(integrationProblem({...entry,attributes:{}},[{reason:"setup_error"}]).integrationUrl,"/config/integrations");
  assert.equal(integrationProblem(source("entity:a"),[{reason:"unavailable"}]),null);
  assert.equal(integrationProblem(entry,[]),null);
  assert.equal(integrationProblem(entry,[{reason:"dependents_failing"}]),null);
  assert.equal(integrationProblem(entry,[{reason:"__proto__"}]),null);
  assert.equal(integrationProblem(entry,[{node_id:"entry:other",reason:"setup_error"}]),null);
});
