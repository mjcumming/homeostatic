import assert from "node:assert/strict";
import test from "node:test";
import {issueDeviceId,relatedDeviceIssues} from "../../custom_components/homeostatic/frontend/device-issue-model.mjs";
import {deviceAvailabilitySummary} from "../../custom_components/homeostatic/frontend/device-availability.mjs";

const DEVICE="registry-device-one",OTHER_DEVICE="registry-device-two";
const source=(id,name,kind="entity",device=DEVICE)=>({node_id:id,name,kind,attributes:{device:[device]}});
const check=(item,id,checkId="availability")=>({...item,node_id:id,monitoring_source:item.node_id,check_id:checkId});
const issue=(id,item,extra={})=>({episode_id:id,anchor:item.node_id,recorded:[item.node_id],reasons:[{node_id:item.node_id,check_id:item.check_id}],...extra});

function fixture() {
  const device=source("device:one","Audi","device"),player=source("entity:player","Audi"),alarm=source("entity:alarm","Next alarm"),timer=source("entity:timer","Next timer");
  const other=source("entity:other-player","Audi","entity",OTHER_DEVICE);
  const sources=[device,player,alarm,timer,other],checks=sources.map(item=>check(item,`monitoring:${item.node_id}`));
  const episodes=checks.map((item,index)=>issue(`raw:episode/${index}?period=1&source=${item.node_id}`,item));
  const data={inventory:{catalog:{candidates:sources},nodes:checks,episodes}};
  return {data,sources,checks,episodes};
}

test("related availability issues use registry membership and retain exact issue identities",()=>{
  const {data,checks,episodes}=fixture();
  data.inventory.episodes=[episodes[3],episodes[4],episodes[1],episodes[0],episodes[2],episodes[1]];
  const entries=relatedDeviceIssues(data,DEVICE);
  assert.deepEqual(entries.map(entry=>entry.episode.episode_id),episodes.slice(0,4).map(item=>item.episode_id));
  for(const [index,entry] of entries.entries()) {
    assert.strictEqual(entry.episode,episodes[index]);
    assert.strictEqual(entry.source,checks[index]);
  }
  assert.deepEqual(relatedDeviceIssues(data,OTHER_DEVICE).map(entry=>entry.episode),[episodes[4]]);
});

test("entity availability issues remain reachable after the aggregate device issue clears",()=>{
  const {data,episodes}=fixture();
  data.inventory.episodes=episodes.filter(item=>item!==episodes[0]);
  assert.deepEqual(relatedDeviceIssues(data,DEVICE).map(entry=>entry.episode),episodes.slice(1,4));
});

test("device selection retains prior failures but excludes passive gaps and confirming recovery",()=>{
  const {data,checks,episodes}=fixture();
  for(const check of checks)check.watched=true;
  const failure={status:"warn",reason:"unavailable",message:"Previously unavailable"};
  const status=(index,current,last_failure)=>({[checks[index].node_id]:{current:{...current,node_id:checks[index].node_id,check_id:"availability"},last_failure}});
  data.inventory.entity_status={
    ...status(0,{status:"fail",reason:"all_unavailable"},failure),
    ...status(1,{status:"unknown",reason:"restored_state"},failure),
    ...status(2,{status:"unknown",reason:"restored_state"},null),
    ...status(3,{status:"pass",reason:"available"},failure),
  };
  data.inventory.episodes=episodes.slice(0,4);
  for(const episode of data.inventory.episodes)episode.reasons=[data.inventory.entity_status[episode.anchor].current];
  assert.deepEqual(relatedDeviceIssues(data,DEVICE).map(entry=>entry.episode.episode_id),[episodes[0].episode_id,episodes[1].episode_id]);
  assert.equal(issueDeviceId(data,episodes[2]),DEVICE,"Ownership alone does not turn a passive evidence gap into an actionable issue");
});

test("all conditions on the device are included while every member must have that same owner",()=>{
  const {data,sources,checks,episodes}=fixture();
  const battery=check(sources[1],"monitoring:player-battery","battery"),temperature=check(sources[1],"monitoring:player-temperature","temperature_limit");
  const integration=source("entry:alexa","Alexa","integration"),integrationCheck=check(integration,"monitoring:integration");
  const untyped=check(sources[1],"monitoring:untyped",undefined);
  delete untyped.check_id;
  data.inventory.catalog.candidates.push(integration);
  data.inventory.nodes.push(battery,temperature,integrationCheck,untyped);
  const included=[issue("battery",battery),issue("temperature",temperature),
    issue("mixed-condition",checks[1],{reasons:[{node_id:temperature.node_id,check_id:"temperature_limit"}]}),
    issue("missing-evidence",untyped,{reasons:[{node_id:untyped.node_id,reason:"restored_state",status:"unknown"}]}),
  ];
  for(const candidate of included) {
    data.inventory.episodes=[candidate];
    assert.equal(issueDeviceId(data,candidate),DEVICE,candidate.episode_id);
    assert.deepEqual(relatedDeviceIssues(data,DEVICE).map(entry=>entry.episode),[candidate]);
  }
  const excluded=[
    issue("integration",integrationCheck),
    issue("cross-device-recorded",checks[1],{recorded:[checks[1].node_id,checks[4].node_id]}),
    issue("cross-device-finding",checks[1],{reasons:[{node_id:checks[4].node_id,check_id:"availability"}]}),
    issue("missing-recorded-member",checks[1],{recorded:[checks[1].node_id,"monitoring:missing"]}),
    issue("missing-finding",checks[1],{reasons:[{node_id:"monitoring:missing",check_id:"availability"}]}),
  ];
  for(const candidate of excluded) {
    data.inventory.episodes=[episodes[1],candidate];
    assert.equal(issueDeviceId(data,candidate),null,candidate.episode_id);
    assert.deepEqual(relatedDeviceIssues(data,DEVICE).map(entry=>entry.episode.episode_id),[episodes[1].episode_id],candidate.episode_id);
  }
});

test("capability sources retain their own check and canonical identity under a verified device",()=>{
  const {data,sources}=fixture();
  for(const kind of ["battery","vacuum","ups","temperature_limit","thermostat"]) {
    const canonical={...sources[1],node_id:`${kind}:capability`,kind};
    const binding=check(canonical,`monitoring:${kind}`,kind),episode=issue(`${kind}-issue`,binding);
    data.inventory.catalog.candidates.push(canonical);data.inventory.nodes.push(binding);data.inventory.episodes=[episode];
    const [entry]=relatedDeviceIssues(data,DEVICE);
    assert.equal(issueDeviceId(data,episode),DEVICE,kind);
    assert.strictEqual(entry.episode,episode);assert.strictEqual(entry.source,binding);assert.strictEqual(entry.canonicalSource,canonical);
  }
});

test("standalone entities and name matches never acquire a device owner",()=>{
  const {data,sources,checks,episodes}=fixture();
  sources[1].attributes={};
  data.inventory.episodes=[episodes[1]];
  assert.equal(issueDeviceId(data,episodes[1]),null);
  assert.deepEqual(relatedDeviceIssues(data,DEVICE),[]);
  const map=new Map([...sources,...checks].map(item=>[item.node_id,item]));
  assert.equal(issueDeviceId(data,episodes[0],map),DEVICE,"A caller can reuse its current inventory index");
});

test("current canonical membership overrides stale check membership",()=>{
  const {data,sources,checks,episodes}=fixture();
  sources[1].attributes={device:[OTHER_DEVICE]};
  assert.deepEqual(checks[1].attributes.device,[DEVICE]);
  data.inventory.episodes=[episodes[1]];
  assert.deepEqual(relatedDeviceIssues(data,DEVICE),[]);
  assert.deepEqual(relatedDeviceIssues(data,OTHER_DEVICE).map(entry=>entry.episode),[episodes[1]]);
});

test("missing or ambiguous current membership cannot establish a device issue scope",()=>{
  for(const membership of [null,[],[DEVICE,OTHER_DEVICE]]) {
    const {data,sources,episodes}=fixture();
    if(membership===null)data.inventory.catalog.candidates=sources.filter(item=>item!==sources[1]);
    else sources[1].attributes={device:membership};
    data.inventory.episodes=[episodes[1]];
    assert.deepEqual(relatedDeviceIssues(data,DEVICE),[],`membership ${JSON.stringify(membership)}`);
  }
});

test("complete server counts cover members outside the loaded page",()=>{
  const result=deviceAvailabilitySummary({total:10,unavailable_count:3,unknown_count:2,members:[{state:"unavailable"}],next_offset:1});
  assert.deepEqual(result,{total:10,available:5,unavailable:3,unknown:2,label:"5 of 10 monitored entities available"});
});

test("complete member evidence separates unavailable, missing and restored from unknown values",()=>{
  const members=[{state:"unavailable"},{state:"unavailable",restored:true},{state:"missing",restored:true},{state:"unknown"},{state:"off"},{state:"idle"},{state:"72"},{state:"72",restored:true}];
  const result=deviceAvailabilitySummary({members});
  assert.deepEqual(result,{total:8,available:4,unavailable:1,unknown:3,label:"4 of 8 monitored entities available"});
});

test("partial pages without both complete counts never infer available members",()=>{
  for(const counts of [{},{unavailable_count:2},{unknown_count:1}]) {
    const result=deviceAvailabilitySummary({total:6,members:[{state:"unknown"},{state:"unavailable"}],next_offset:2,...counts});
    assert.equal(result.total,6);
    assert.equal(result.available,null);
    assert.equal(result.label,"Availability readings incomplete");
  }
});

test("unmonitored summaries do not imply monitoring and singular counts stay readable",()=>{
  assert.deepEqual(deviceAvailabilitySummary({members:[{state:"unknown"}]},{monitored:false}),{total:1,available:1,unavailable:0,unknown:0,label:"1 of 1 entity available"});
  assert.equal(deviceAvailabilitySummary({members:[{state:"unavailable"}]}).label,"0 of 1 monitored entity available");
  assert.equal(deviceAvailabilitySummary({members:[{state:"off"},{state:"unavailable"}]},{monitored:false}).label,"1 of 2 entities available");
});
