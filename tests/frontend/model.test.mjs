import {integrationProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {historyPage, controlPayload, controlAllowed, callAction, controlsPanel, RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
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


test("retry presentation keeps earlier evidence separate from current unknown findings",()=>{
  const entry=source("entry:receiver",{kind:"integration",name:"Home Theater",attributes:{domain:["denonavr"]}});
  const failure={reason:"setup_retry",message:"Connection timed out",observed_at:"2026-09-25T15:42:00Z"};
  const current={reason:"setup_in_progress",message:"setup in progress",observed_at:"2026-09-25T15:44:00Z"};
  const evidence={current,last_failure:failure};
  const result=integrationProblem(entry,[],()=>"Denon AVR",evidence);
  assert.equal(result.headline,"Trying setup again");
  assert.equal(result.reported,"Connection timed out");
  assert.equal(result.reportedAt,failure.observed_at);
  assert.equal(result.historical,true);
  assert.match(result.summary,/Recovery is not yet confirmed/);
  assert.equal(result.currentReason,"setup_in_progress");
  assert.doesNotMatch(result.summary,/timed out/);
  assert.equal(integrationProblem(entry,[],()=>null,{current,last_failure:null}).headline,"Integration starting");
  assert.equal(evidence.last_failure,failure);
});

test("disabled conditions and recovery stay distinct from failure and held unknown findings",()=>{
  const entry=source("entry:music",{kind:"integration",name:"Music Assistant"});
  const disabled=integrationProblem(entry,[{reason:"stale",message:"Evidence is unknown"}],()=>null,
    {current:{reason:"disabled"},last_failure:null});
  assert.equal(disabled.headline,"Integration disabled");
  assert.equal(disabled.tone,"neutral");
  assert.match(disabled.summary,/availability is unknown/);
  assert.doesNotMatch(disabled.summary,/broken|failed/);
  const running=integrationProblem(entry,[],()=>null,{current:{reason:"loaded"},last_failure:null});
  assert.equal(running.headline,"Integration running");
  assert.equal(running.reported,"");
  assert.equal(running.historical,false);
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
