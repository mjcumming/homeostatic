import assert from "node:assert/strict";
import test from "node:test";
import {editorEvidenceOnly,mergeDashboard} from "../../custom_components/homeostatic/frontend/model.mjs";
import {canonicalSources,sourceForSelection,sourcePaths,sourcesBrowser,sourcesTree} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {sourceDetailsFixture} from "./source-details-fixture.mjs";
import {individualIssueFixture} from "./individual-issue-fixture.mjs";
import {issueAvailabilitySources} from "../../custom_components/homeostatic/frontend/issue-monitoring.mjs";

const elements=new Map();
globalThis.HTMLElement=class {};
globalThis.customElements={get:key=>elements.get(key),define:(key,value)=>elements.set(key,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js?refresh-lifecycle");
const prototype=elements.get("homeostatic-card-v39").prototype;
delete globalThis.HTMLElement;
delete globalThis.customElements;
delete globalThis.window;

const dataFixture=()=>({...monitoringExample(),schema_version:3,catalog_revision:1,catalog_loaded:true});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};

function detailCard(base) {
  const body={innerHTML:"",querySelector:()=>null,querySelectorAll:()=>[]},label={};
  const card=Object.assign(Object.create(prototype),base,{detailSequence:0,dialog:{open:true},
    shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:label},
    tools:{detailButtons:()=>""},capturePageState:()=>({}),restorePageState(){}});
  return {card,body};
}

test("catalog structure and source paths survive evidence updates while current readings change",()=>{
  const data=dataFixture(),sourceId="entity:registry:camera-1-1";
  const tree=sourcesTree(data),paths=sourcePaths(tree),sources=canonicalSources(data);
  const changed={...data,updated_at:"new",inventory:{...data.inventory,entity_status:{[sourceId]:{current:{reason:"unavailable"}}}}};
  assert.equal(canonicalSources(changed),sources);
  assert.equal(sourcesTree(changed),tree);
  assert.equal(sourcePaths(tree),paths);
  assert.equal(sourceForSelection(changed,`source:${sourceId}`),paths.get(`source:${sourceId}`).node.source);
  const card={current:{data:changed},sourcesGrouping:"integration",sourcesSelection:`source:${sourceId}`,sourcesExpanded:new Set(),
    sourceDetail:{nodeId:sourceId,members:[{entity_id:"sensor.current",name:"Current reading",state:"unavailable"}],total:1}};
  assert.match(sourcesBrowser(card),/Home Assistant reports this entity as unavailable/);
  card.sourceDetail.members[0].state="72";
  assert.match(sourcesBrowser(card),/Available in Home Assistant/);
  assert.doesNotMatch(sourcesBrowser(card),/Home Assistant reports this entity as unavailable/);
  const renamed={...changed,inventory:{...changed.inventory,nodes:changed.inventory.nodes.map(row=>row.node_id===sourceId?{...row,name:"Renamed"}:row)}};
  assert.notEqual(sourcesTree(renamed),tree);
  assert.equal(sourceForSelection(renamed,`source:${sourceId}`).name,"Renamed");
  assert.notEqual(sourcesTree({...data,devices:[...data.devices,{id:"new",name:"New device"}]}),tree);
});

test("source requests keep one active read and one follow-up for the latest evidence",async()=>{
  const pending=[],requests=[],data=dataFixture();
  const card=Object.create(prototype);
  Object.assign(card,{page:"sources",current:{status:"current",data},sourcesSelection:"source:device:camera-0",sourceSequence:0,render(){},
    _hass:{connection:{},states:{},callWS(request){requests.push(request);const next=deferred();pending.push(next);return next.promise;}}});
  const first=card.loadSource();
  card.current={status:"current",data:{...data,updated_at:"second"}};
  await card.loadSource();
  card.current={status:"current",data:{...data,updated_at:"latest"}};
  await card.loadSource();
  assert.equal(requests.length,1);
  pending[0].resolve({members:[],device_availability:null});
  await first;
  assert.equal(requests.length,2);
  pending[1].resolve({members:[{state:"latest"}],device_availability:null});
  await settle();
  assert.equal(card.sourceDetail.members[0].state,"latest");
  assert.match(card.sourceDetail.stamp,/^latest:/);
  await card.loadSource();
  assert.equal(requests.length,2);
});

test("navigation during a source read discards its result and loads the new selection once",async()=>{
  const pending=[],card=Object.create(prototype);
  Object.assign(card,{page:"sources",current:{status:"current",data:dataFixture()},sourcesSelection:"source:device:camera-0",sourceSequence:0,render(){},
    _hass:{connection:{},states:{},callWS(request){const next=deferred();pending.push({...next,request});return next.promise;}}});
  const first=card.loadSource();
  card.sourcesSelection="source:device:camera-1";
  await card.loadSource();
  pending[0].resolve({members:[{state:"old"}]});
  await first;
  assert.equal(pending.length,2);
  assert.equal(pending[1].request.node_id,"device:camera-1");
  assert.notEqual(card.sourceDetail.members?.[0]?.state,"old");
  pending[1].resolve({members:[{state:"new"}]});
  await settle();
  assert.equal(card.sourceDetail.nodeId,"device:camera-1");
});

test("reconnection abandons a pending source response and can read the same timestamp again",async()=>{
  const pending=[],card=Object.create(prototype);
  Object.assign(card,{page:"sources",current:{status:"current",data:dataFixture()},sourcesSelection:"source:device:camera-0",sourceSequence:0,detailSequence:0,render(){},
    _hass:{connection:{},states:{},callWS(){const next=deferred();pending.push(next);return next.promise;}}});
  const old=card.loadSource();
  card.invalidateReads();
  const fresh=card.loadSource();
  assert.equal(pending.length,2);
  pending[1].resolve({members:[{state:"new connection"}]});
  await fresh;
  pending[0].resolve({members:[{state:"obsolete connection"}]});
  await old;
  assert.equal(card.sourceDetail.members[0].state,"new connection");
});

test("paging and refresh share one source request and discard a superseded page",async()=>{
  const pending=[],card=Object.create(prototype),data=dataFixture();
  Object.assign(card,{page:"sources",current:{status:"current",data},sourcesSelection:"source:device:camera-0",sourceSequence:0,render(){},
    sourceDetail:{nodeId:"device:camera-0",stamp:`${data.updated_at}:`,updated_at:data.updated_at,next_offset:1,members:[{entity_id:"sensor.first",state:"old"}]},
    _hass:{connection:{},states:{},callWS(request){const next=deferred();pending.push({...next,request});return next.promise;}}});
  const page=card.loadSourceMore();
  card.current={status:"current",data:{...data,updated_at:"new"}};
  await card.loadSource();
  assert.equal(pending.length,1);
  pending[0].resolve({updated_at:data.updated_at,members:[{entity_id:"sensor.second",state:"obsolete"}]});
  await page;
  assert.equal(pending.length,2);
  assert.equal(pending[1].request.offset,undefined);
  pending[1].resolve({updated_at:"new",members:[{entity_id:"sensor.current",state:"new"}],next_offset:null});
  await settle();
  assert.deepEqual(card.sourceDetail.members,[{entity_id:"sensor.current",state:"new"}]);
});

test("issue detail requests coalesce changing evidence and reject an old navigation result",async()=>{
  const pending=[],body={innerHTML:"new dialog"},label={},card=Object.create(prototype);
  Object.assign(card,{current:{status:"current",data:dataFixture()},detail:{nodeId:"one"},detailSequence:0,
    shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:label},
    _hass:{connection:{},callWS(request){const next=deferred();pending.push({...next,request});return next.promise;}}});
  const first=card.loadDetail();
  card.detail={nodeId:"two"};
  await card.loadDetail();
  card.current={...card.current,data:{...card.current.data,updated_at:"latest"}};
  await card.loadDetail();
  assert.equal(pending.length,1);
  pending[0].reject(Error("Obsolete request"));
  await first;
  assert.equal(pending.length,2);
  assert.equal(pending[1].request.node_id,"two");
  assert.equal(body.innerHTML,"new dialog");
  pending[1].reject(Error("Current request failed"));
  await settle();
  assert.match(body.innerHTML,/Current request failed/);
  assert.equal(card.detailRequest,null);
});

test("saved editors retain their form for evidence but refresh for catalog, connection and sending changes",()=>{
  const previous={status:"current",data:dataFixture()};
  const next={status:"current",data:{...previous.data,updated_at:"new",inventory:{...previous.data.inventory,episodes:[{episode_id:"new"}]}}};
  assert.equal(editorEvidenceOnly(previous,next),true);
  for(const changed of [
    {...next,status:"disconnected"},
    {...next,catalogError:"Failed"},
    {...next,data:{...next.data,catalog_revision:2}},
    {...next,data:{...next.data,catalog_loaded:false}},
    {...next,data:{...next.data,policy:{notifications_enabled:true}}},
  ])assert.equal(editorEvidenceOnly(previous,changed),false);
});

test("policy editors refresh next-summary times while unrelated report evidence stays quiet",()=>{
  const report={name:"entry:policy_temperature_morning",next_at:"2026-10-17T13:00:00Z",episode_ids:[]};
  const data=dataFixture();
  const previous={status:"current",data:{...data,policy:{...data.policy,reports:[report]}}};
  const update=reports=>({status:"current",data:{...previous.data,policy:{...previous.data.policy,reports}}});
  assert.equal(editorEvidenceOnly(previous,update([{...report,episode_ids:["new-issue"]}])),true);
  assert.equal(editorEvidenceOnly(previous,update([{...report,next_at:"2026-10-18T13:00:00Z"}])),false);
  assert.equal(editorEvidenceOnly(previous,update([{...report,next_at:null}])),false);
  assert.equal(editorEvidenceOnly(previous,update([{...report,name:"entry:policy_temperature_evening"}])),false);
  assert.equal(editorEvidenceOnly(previous,update([])),false);
});

test("a context-only issue summary uses total monitoring count without a full catalog",()=>{
  const data=dataFixture();
  data.panel_context=true;data.catalog_loaded=false;
  data.inventory={...data.inventory,nodes:[],catalog:{candidates:[]},monitored_count:6000};
  const html=issuesWorkspace({current:{data},issueGroupsExpanded:new Set(),issueGroupLimits:new Map()});
  assert.match(html,/No open issues<\/h2>/);
  assert.doesNotMatch(html,/Nothing is monitored|No open issues reported|inspect the configured monitoring scope/);
  data.inventory.monitored_count=0;
  assert.match(issuesWorkspace({current:{data},issueGroupsExpanded:new Set(),issueGroupLimits:new Map()}),/Nothing is monitored/);
});

test("a partial temperature issue reads every canonical policy without loading the full catalog",async()=>{
  const {base,source,entity,episode,result}=individualIssueFixture();
  delete source.monitoring_source;
  const data={...base.current.data,panel_context:true,catalog_loaded:false,
    inventory:{...base.current.data.inventory,nodes:[source,entity],catalog:{candidates:[entity]}}};
  const calls=[],{card,body}=detailCard({...base,current:{status:"current",data},detail:{episodeId:episode.episode_id},
    store:{ensureCatalog(){throw Error("Temperature details do not need the full catalog");}}});
  card._hass={...base._hass,connection:{},async callWS(request){
    calls.push(request);
    if(request.type==="homeostatic/node")return result;
    assert.equal(request.type,"homeostatic/source");assert.equal(request.node_id,entity.node_id);
    return base.sourceDetail;
  }};
  await card.loadDetail();
  assert.equal(calls.length,2);
  for(const policy of base.sourceDetail.monitoring_policies)assert.ok(body.innerHTML.includes(`data-definition-id="${policy.id}"`),policy.name);
});

test("opening a partial device availability issue loads members before enabling removal and offers catalog retry",async()=>{
  const base=sourceDetailsFixture("device",["unavailable","unavailable"]),full=base.current.data;
  const source=full.inventory.nodes.find(row=>row.kind==="device"&&row.monitoring_policy);
  const reason={node_id:source.node_id,check_id:"availability",status:"warn",reason:"all_unavailable"};
  const episode={episode_id:"device-availability",anchor:source.node_id,recorded:[source.node_id],reasons:[reason],impact:[],opened_at:"2026-10-17T12:00:00Z"};
  Object.assign(full,{schema_version:3,panel_context:true,catalog_loaded:true,catalog_revision:1});
  Object.assign(full.inventory,{episodes:[episode],entity_status:{[source.node_id]:{current:reason}}});
  const partial={...full,catalog_loaded:false,inventory:{...full.inventory,nodes:full.inventory.nodes.filter(row=>row.kind!=="entity"),catalog:{candidates:full.inventory.catalog.candidates.filter(row=>row.kind!=="entity")}}};
  let catalogs=0;
  const pending=deferred(),{card,body}=detailCard({...base,current:{status:"current",data:partial},detail:{episodeId:episode.episode_id},store:{ensureCatalog(){catalogs++;return pending.promise;}}});
  card._hass={...base._hass,connection:{},async callWS(request){
    assert.equal(request.type,"homeostatic/node");
    return {source,readiness:{answer:"degraded",nodes:[]},explanation:{findings:[reason],nodes:[]},impact:{nodes:[]},entity_status:{current:reason},
      device_evidence:{...base.sourceDetail},device_availability:base.sourceDetail.device_availability,monitoring_policies:[{id:"devices",name:"Devices"}]};
  }};
  assert.equal(catalogs,0);
  assert.deepEqual(issueAvailabilitySources(card,[episode]),[]);
  await card.loadDetail();
  assert.equal(catalogs,1);
  assert.match(body.innerHTML,/Loading monitoring sources/);
  assert.doesNotMatch(body.innerHTML,/data-issue-availability="remove"/);
  card.current={...card.current,catalogError:"Could not load sources."};
  await card.loadDetail();
  assert.match(body.innerHTML,/Could not load sources/);
  assert.match(body.innerHTML,/data-action="retry-catalog"/);
  card.current={status:"current",data:full};pending.resolve();
  await card.loadDetail();
  assert.equal(issueAvailabilitySources(card,[episode]).length,2);
  assert.match(body.innerHTML,/data-issue-availability="remove"[^>]*>Stop Monitoring/);
  assert.doesNotMatch(body.innerHTML,/data-issue-availability="remove"[^>]* disabled|Loading monitoring sources|retry-catalog/);
});

test("fresh issue context overlays a stale full catalog while unrelated browsing stays available",()=>{
  const previous=dataFixture(),id=previous.inventory.nodes[0].node_id;
  const fresh={...previous.inventory.nodes[0],name:"Updated owner"};
  const summary={...previous,panel_context:true,catalog_revision:2,catalog_loaded:false,
    catalog_sections:Object.fromEntries(["nodes","candidates","targets","enrollment_changes","areas","devices","floors"].map(section=>[section,0])),
    inventory:{...previous.inventory,nodes:[fresh],catalog:{candidates:[fresh]}},areas:[],floors:[],devices:[{id:previous.devices[0].id,name:"Updated device"}]};
  const merged=mergeDashboard(previous,summary);
  assert.equal(merged.catalog_stale,true);
  assert.equal(merged.inventory.nodes.find(row=>row.node_id===id).name,"Updated owner");
  assert.equal(merged.inventory.catalog.candidates.find(row=>row.node_id===id).name,"Updated owner");
  assert.equal(merged.devices[0].name,"Updated device");
  assert.equal(merged.inventory.nodes.length,previous.inventory.nodes.length);
});
