import test from "node:test";
import assert from "node:assert/strict";
import {selectedDeviceIssueIds,renderDeviceIssues,readDeviceIssues,applyDeviceIssueAction,editDeviceIssues} from "../../custom_components/homeostatic/frontend/device-issues.mjs";
import {deviceIssueFixture,deviceIssueReply,DEVICE_ID,DEVICE_SOURCE,RELATED_IDS,FIXTURE_TIME} from "./device-issue-selection.mjs";

function harness() {
  const fixture=deviceIssueFixture(),calls=[],master={},label={},title={},close={disabled:false};
  const body={innerHTML:"",querySelector:selector=>selector==="[data-device-issues-all]"?master:null};
  const card={current:{status:"current",data:fixture.data},detail:{deviceId:DEVICE_ID},configuration:{revision:"selection-1",settings:fixture.settings},
    dialog:{open:true,querySelector:selector=>selector===".dialog-body"?body:selector==='[data-action="close"]'?close:selector.startsWith("[data-device-response")?{focus(){}}:null},
    shadowRoot:{querySelector:selector=>selector==="#detail-label"?label:selector==="#detail-title"?title:body},capturePageState:()=>({}),restorePageState:()=>{},
    _hass:{user:{is_admin:true},states:Object.fromEntries(fixture.members.map(member=>[member.entity_id,{state:member.state,attributes:{}}])),callWS:async request=>{
      calls.push(structuredClone(request));
      if(request.type==="homeostatic/source")return deviceIssueReply(fixture,request.node_id);
      const id=request.service_data.episode_id;
      return {response:request.service==="acknowledge"?{acknowledgment:{episode_id:id,at:FIXTURE_TIME}}:{control:{control_id:`pause:${id}`,target:id,action:"shelve",until:request.service_data.until}}};
    }}};
  card.deviceIssueContext=deviceIssueReply(fixture);
  return {card,fixture,calls,body,master,label,title,close};
}
const targets=calls=>calls.filter(call=>call.type==="call_service").map(call=>call.service_data.episode_id);
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));

test("all defaults use registry membership and retain subset/zero choices across arrivals",()=>{
  const {card,fixture,body,master}=harness();
  assert.deepEqual(new Set(selectedDeviceIssueIds(card)),new Set([...RELATED_IDS,"issue:battery"]));
  card.deviceIssues.selected=new Set(["issue:alarm"]);renderDeviceIssues(card);
  assert.deepEqual(selectedDeviceIssueIds(card),["issue:alarm"]);assert.equal(master.indeterminate,true);
  const later=structuredClone(fixture.data.inventory.episodes.find(item=>item.episode_id==="issue:timer"));later.episode_id="issue:later";fixture.data.inventory.episodes.push(later);
  assert.deepEqual(selectedDeviceIssueIds(card),["issue:alarm"],"New IDs never inherit selection");
  card.deviceIssues.selected.clear();renderDeviceIssues(card);
  assert.deepEqual(selectedDeviceIssueIds(card),[]);
  assert.match(body.innerHTML,/data-device-response="acknowledge" disabled/);assert.match(body.innerHTML,/data-device-response="pause" disabled/);
  assert.doesNotMatch(body.innerHTML,/data-device-issue-select="issue:other"/);
  assert.match(body.innerHTML,/data-device-issue-select="issue:battery"/);
});

test("aggregate recovery leaves two entity choices, then one direct identified action",()=>{
  const {card,fixture,body}=harness();
  selectedDeviceIssueIds(card);
  fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>["issue:alarm","issue:timer","issue:other"].includes(item.episode_id));
  renderDeviceIssues(card);assert.equal((body.innerHTML.match(/data-device-issue-select=/g)||[]).length,2);
  fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>item.episode_id!=="issue:alarm");
  renderDeviceIssues(card);assert.deepEqual(selectedDeviceIssueIds(card),["issue:timer"]);
  assert.doesNotMatch(body.innerHTML,/data-device-issue-select|data-device-issues-all/);assert.match(body.innerHTML,/<h3>Next timer<\/h3>/);
  fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>item.episode_id!=="issue:timer");
  renderDeviceIssues(card);assert.match(body.innerHTML,/No related issues remain open/);assert.doesNotMatch(body.innerHTML,/data-device-response=/);
});

test("source read uses canonical device evidence and ignores a stale return",async()=>{
  const {card,fixture,calls,body,title}=harness(),call=card._hass.callWS;
  fixture.device.watched=false;
  card._hass.callWS=async request=>{
    const result=await call(request);
    delete result.source;
    result.monitoring_policies=result.monitoring_policies.map(({id,name})=>({id,name}));
    return result;
  };
  await readDeviceIssues(card,()=>true);
  assert.deepEqual(calls[0],{type:"homeostatic/source",node_id:DEVICE_SOURCE});assert.match(body.innerHTML,/0 of 3 monitored entities available/);
  assert.equal(title.textContent,"michael's Audi Alexa Integration","The real source endpoint supplies evidence; identity comes from the canonical catalog");
  body.innerHTML="newer detail";await readDeviceIssues(card,()=>false);assert.equal(body.innerHTML,"newer detail");
});

test("a source missing from the initial issue summary waits for verified catalog identity",async()=>{
  const {card,fixture,calls,body}=harness(),complete=fixture.data;
  card.current.data={...complete,catalog_loaded:false,inventory:{...complete.inventory,nodes:complete.inventory.nodes.filter(source=>source.node_id!==DEVICE_SOURCE),catalog:{candidates:[]}}};
  let loaded=0;
  card.store={ensureCatalog:async()=>{loaded++;card.current.data=complete;}};
  await readDeviceIssues(card,()=>true);
  assert.equal(loaded,1);assert.equal(calls[0].node_id,DEVICE_SOURCE);assert.match(body.innerHTML,/0 of 3 monitored entities available/);
  card.current.data={...complete,catalog_loaded:false,inventory:{...complete.inventory,nodes:[],catalog:{candidates:[]}}};
  body.innerHTML="newer detail";const previousCalls=calls.length;
  await readDeviceIssues(card,()=>false);
  assert.equal(calls.length,previousCalls);assert.equal(body.innerHTML,"newer detail","Navigation while catalog loads invalidates the pending detail read");
});

test("partial availability retains missing evidence after a failure and excludes confirming recovery",()=>{
  const {card,fixture,body}=harness(),inventory=fixture.data.inventory;
  inventory.episodes=inventory.episodes.filter(item=>["issue:alarm","issue:timer","issue:battery"].includes(item.episode_id));
  fixture.members[0].state="idle";fixture.members[2].state="off";
  card.deviceIssueContext=deviceIssueReply(fixture);
  const alarm=inventory.entity_status["check:alarm"];
  alarm.current={...alarm.current,status:"unknown",reason:"restored_state",message:"Waiting for a fresh reading"};
  inventory.episodes.find(item=>item.episode_id==="issue:alarm").reasons=[alarm.current];
  const timer=inventory.entity_status["check:timer"];
  timer.current={...timer.current,status:"pass",reason:"available",message:"Available"};
  const battery=inventory.entity_status["check:battery"];
  battery.current={...battery.current,reason:"battery_low"};
  renderDeviceIssues(card);
  assert.match(body.innerHTML,/2 of 3 monitored entities available/);
  assert.match(body.innerHTML,/Waiting for a fresh reading/);
  assert.doesNotMatch(body.innerHTML,/Available — confirming recovery|data-device-issue-select="issue:timer"/);
  assert.match(body.innerHTML,/Battery low/);
  assert.doesNotMatch(body.innerHTML,/All monitored entities unavailable|data-device-issue-select="issue:device"|<dt>Opened<\/dt>/);
  assert.match(body.innerHTML,/<a class="button" href="\/config\/devices\/device\/audi">Open device<\/a>/);
  assert.match(body.innerHTML,/class="actions device-issue-actions"/);
  assert.deepEqual(new Set(selectedDeviceIssueIds(card)),new Set(["issue:alarm","issue:battery"]));
});

test("a temperature finding retains actionable captured evidence and its exact independent target",async()=>{
  const {card,fixture,body,calls}=harness(),inventory=fixture.data.inventory;
  const entity=fixture.entities[1];
  const check={...entity,node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",monitoring_source:entity.node_id,monitoring_policy:"temperature"};
  const current={node_id:check.node_id,check_id:check.check_id,status:"warn",reason:"temperature_high",message:"Temperature is 31 °C",evidence:{temperature_celsius:31,maximum:28,unit:"°C",observed_seconds:600,duration_seconds:300}};
  inventory.nodes=[...inventory.nodes,check];
  inventory.entity_status[check.node_id]={current,last_failure:current};
  inventory.episodes=[{episode_id:"issue:temperature",anchor:check.node_id,recorded:[check.node_id],reasons:[current]}];
  renderDeviceIssues(card);
  assert.match(body.innerHTML,/Temperature above maximum/);assert.match(body.innerHTML,/Temperature is 31 °C/);
  assert.match(body.innerHTML,/Maximum 28 °C/);assert.match(body.innerHTML,/Observed outside limits for 10 minutes/);
  assert.doesNotMatch(body.innerHTML,/data-device-issue-select|data-device-issues-all/);
  await applyDeviceIssueAction(card,"acknowledge",selectedDeviceIssueIds(card));
  assert.deepEqual(targets(calls),["issue:temperature"]);
});

test("acknowledgment deduplicates exact captured IDs and leaves unrelated issues untouched",async()=>{
  const {card,calls}=harness();
  await applyDeviceIssueAction(card,"acknowledge",["issue:alarm","issue:device","issue:alarm"]);
  assert.deepEqual(targets(calls),["issue:alarm","issue:device"]);
  assert.ok(card.deviceIssues.results.get("issue:alarm").acknowledged);assert.ok(card.deviceIssues.results.get("issue:device").acknowledged);
  assert.equal(card.deviceIssues.results.has("issue:other"),false);assert.equal(card.deviceIssues.results.has("issue:timer"),false);
  assert.equal(calls.every(call=>call.domain==="homeostatic"&&call.service==="acknowledge"&&call.return_response),true);
});

test("pending recovery skips the ended ID and cannot substitute a new identity",async()=>{
  const {card,fixture,calls}=harness();let release;
  const original=card._hass.callWS;
  card._hass.callWS=async request=>{const response=await original(request);if(request.service_data.episode_id==="issue:device")await new Promise(resolve=>{release=resolve;});return response;};
  const pending=applyDeviceIssueAction(card,"acknowledge",["issue:device","issue:alarm","issue:timer"]);
  await tick();await tick();assert.equal(typeof release,"function");
  const removed=fixture.data.inventory.episodes.find(item=>item.episode_id==="issue:alarm");
  fixture.data.inventory.episodes=fixture.data.inventory.episodes.filter(item=>item!==removed);
  fixture.data.inventory.episodes.push({...structuredClone(removed),episode_id:"issue:new-alarm"});
  release();await pending;
  assert.deepEqual(targets(calls),["issue:device","issue:timer"]);
  assert.match(card.deviceIssues.results.get("issue:alarm").error,/No longer current/);
  assert.equal(card.deviceIssues.results.has("issue:new-alarm"),false);assert.match(card.deviceIssues.message,/2 issues acknowledged\. 1 not confirmed/);
});

test("one rejected operation retains other results and never retries automatically",async()=>{
  const {card,calls}=harness(),original=card._hass.callWS;
  card._hass.callWS=async request=>{const result=await original(request);if(request.service_data.episode_id==="issue:alarm")throw Error("One rejected save");return result;};
  await applyDeviceIssueAction(card,"acknowledge",["issue:device","issue:alarm","issue:timer"]);
  await tick();assert.deepEqual(targets(calls),["issue:device","issue:alarm","issue:timer"]);
  assert.ok(card.deviceIssues.results.get("issue:device").acknowledged);assert.ok(card.deviceIssues.results.get("issue:timer").acknowledged);
  assert.match(card.deviceIssues.results.get("issue:alarm").error,/One rejected save.*Check current state before retrying/);
  assert.equal(card.deviceIssues.results.get("issue:alarm").acknowledged,undefined);
});

test("notification pause preserves exact targets and a shared explicit UTC expiry",async()=>{
  const {card,calls}=harness(),until="2026-10-17T19:00:00.000Z";
  await applyDeviceIssueAction(card,"shelve",["issue:alarm","issue:timer"],until);
  assert.deepEqual(targets(calls),["issue:alarm","issue:timer"]);
  for(const call of calls)assert.deepEqual(call.service_data,{episode_id:call.service_data.episode_id,until,reason:""});
  assert.equal(card.deviceIssues.results.get("issue:timer").until,until);
  assert.equal(card.deviceIssues.results.has("issue:device"),false);
});

test("authoritative snapshots supersede the locally confirmed notification pause",async()=>{
  const {card,calls,body}=harness(),until=new Date(Date.now()+3600000).toISOString();
  const originalSnapshot=card.current.data;
  await applyDeviceIssueAction(card,"shelve",["issue:timer"],until);
  assert.equal(card.deviceIssues.results.get("issue:timer").snapshot,originalSnapshot);
  assert.match(body.innerHTML,/Notifications paused until/,"The confirmed response is visible before a fresh snapshot arrives");

  const confirmedSnapshot=structuredClone(originalSnapshot);
  confirmedSnapshot.inventory.operator_controls=[{control_id:"pause:issue:timer",target:"issue:timer",action:"shelve",until}];
  card.current={status:"current",data:confirmedSnapshot};renderDeviceIssues(card);
  assert.match(body.innerHTML,/Notifications paused until/,"A fresh snapshot supplies the current pause");

  const cancelledSnapshot=structuredClone(confirmedSnapshot);
  cancelledSnapshot.inventory.operator_controls=[];
  card.current={status:"current",data:cancelledSnapshot};renderDeviceIssues(card);
  assert.doesNotMatch(body.innerHTML,/Notifications paused until/,"Removing the pause in a later snapshot supersedes the earlier response");
  assert.deepEqual(targets(calls),["issue:timer"],"Snapshot refreshes do not repeat the action");
});

test("disconnecting during a response releases Close when the operation finishes",async()=>{
  const {card,calls,close}=harness();let release;
  const original=card._hass.callWS;
  card._hass.callWS=async request=>{const response=await original(request);await new Promise(resolve=>{release=resolve;});return response;};
  const pending=applyDeviceIssueAction(card,"acknowledge",["issue:timer","issue:alarm"]);
  await tick();await tick();assert.equal(typeof release,"function");
  assert.equal(card.deviceIssues.busy,true);assert.equal(close.disabled,true);

  card.current={status:"disconnected",data:null};
  release();await pending;
  assert.equal(card.deviceIssues.busy,false);assert.equal(close.disabled,false,"Missing data cannot leave the completed dialog locked");
  assert.deepEqual(targets(calls),["issue:timer"],"The remaining captured target receives no request while disconnected");
  assert.match(card.deviceIssues.results.get("issue:alarm").error,/monitoring disconnected; no request sent/);
});

test("pause cancellation mutates nothing and stale or non-admin views cannot act",async()=>{
  const {card,calls}=harness();selectedDeviceIssueIds(card);card.deviceIssues.selected=new Set(["issue:timer"]);
  const event=action=>({type:"click",target:{closest(){return this;},matches:()=>false,hasAttribute:()=>false,dataset:{deviceResponse:action},disabled:false}});
  editDeviceIssues(card,event("pause"));assert.deepEqual(card.deviceIssues.form.ids,["issue:timer"]);
  editDeviceIssues(card,event("cancel-pause"));assert.equal(card.deviceIssues.form,null);assert.deepEqual(calls,[]);
  card.current.status="stale";await applyDeviceIssueAction(card,"acknowledge",["issue:timer"]);
  card.current.status="current";card._hass.user.is_admin=false;await applyDeviceIssueAction(card,"shelve",["issue:timer"],"2026-10-17T19:00:00Z");
  assert.deepEqual(calls,[]);
});
