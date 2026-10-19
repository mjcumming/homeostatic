import assert from "node:assert/strict";
import test from "node:test";
import {availabilityMonitoring,availabilityConfirmation,prepareAvailabilityChange,applyAvailabilityChange} from "../../custom_components/homeostatic/frontend/source-monitoring.mjs";
import {initializeScopedConfiguration,rebaseScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";

const clone=value=>structuredClone(value);
const A="entity:registry:one",B="entity:registry:two",C="entity:registry:other";
const policy=(id,kind="entity",extra={})=>({id,name:id,check:"availability",match:{kind:[kind]},parameters:{},enabled:true,notifications:[],...extra});
const entity=(id,name)=>({node_id:id,name,kind:"entity",entity_id:`sensor.${name}`,watched:false});
const savedPolicy=(state,id)=>state.settings.monitoring_policies.find(item=>item.id===id);
const draftPolicy=(card,id)=>card.settingsDraft.monitoring_policies.find(item=>item.id===id);

function fixture() {
  const sources=[entity(A,"one"),entity(B,"two")];
  const settings={notifications:false,timings:{settle:30},consumer:null,monitoring_policies:[policy("entities"),policy("devices","entity",{excluded_sources:[C]}),policy("temperature","entity",{check:"temperature_limit"}),policy("other","integration")],notification_definitions:{methods:{phone:{name:"Phone"}}}};
  const server={value:{revision:"r1",settings:clone(settings)}},calls=[];
  let version=1;
  const card={configuration:clone(server.value),settingsDraft:clone(settings),current:{status:"current",data:{inventory:{catalog:{candidates:sources},nodes:[...sources,...sources.map(source=>({...source,node_id:`monitoring:entities:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:"entities",watched:true})),...sources.map(source=>({...source,node_id:`monitoring:devices:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:"devices",watched:true}))]}}},render(){},_hass:{async callWS(request){
    calls.push(clone(request));
    if(request.type==="homeostatic/configuration")return clone(server.value);
    assert.equal(request.type,"homeostatic/save_settings");
    assert.equal(request.revision,server.value.revision);
    server.value={...server.value,revision:`r${++version}`,settings:clone(request.settings)};
    return {saved:true};
  }}};
  initializeScopedConfiguration(card);
  return {card,server,calls,sources};
}

test("entity stop reviews and atomically excludes its individual and device roles only",async()=>{
  const {card,server,calls}=fixture(),before=clone(server.value.settings);
  const state=availabilityMonitoring(card,A),plan=prepareAvailabilityChange(card,[A]);
  assert.deepEqual(state.activePolicies.map(item=>item.id),["entities","devices"]);
  assert.deepEqual(plan.sourceIds,[A]);
  assert.deepEqual(plan.changes.map(item=>item.id),["entities","devices"]);
  assert.equal(await applyAvailabilityChange(card,plan),true);
  assert.deepEqual(savedPolicy(server.value,"entities").excluded_sources,[A]);
  assert.deepEqual(savedPolicy(server.value,"devices").excluded_sources,[A,C].sort());
  assert.deepEqual(savedPolicy(server.value,"temperature"),before.monitoring_policies[2]);
  assert.deepEqual(savedPolicy(server.value,"other"),before.monitoring_policies[3]);
  assert.deepEqual(calls.map(call=>call.type),["homeostatic/save_settings","homeostatic/configuration"]);
  assert.equal(card.configuration.settings.notifications,false);
  assert.equal(card.scopedNotice,null);
  assert.equal(card.availabilityUndo,undefined);
});

test("server key ordering after a compound-policy save does not create a conflict or dirty draft",async()=>{
  const {card,server}=fixture();
  for(const settings of [card.configuration.settings,card.settingsDraft,server.value.settings])settings.monitoring_policies[0].match_none=[{domain:["camera"]}];
  card.scopedConfiguration=null;initializeScopedConfiguration(card);
  const normal=card._hass.callWS;
  card._hass.callWS=async request=>{
    const response=await normal(request);
    if(request.type==="homeostatic/configuration")return JSON.parse(JSON.stringify(response,(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value));
    return response;
  };
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),true);
  assert.equal(card.availabilityError,null);
  assert.deepEqual(draftPolicy(card,"entities"),savedPolicy(card.configuration,"entities"));
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[B])),true,"A second change must not be blocked by an invented dirty draft");
});

test("a real policy change during readback still prevents a success claim",async()=>{
  const {card}=fixture(),normal=card._hass.callWS;
  card._hass.callWS=async request=>{
    const response=await normal(request);
    if(request.type==="homeostatic/configuration")response.settings.monitoring_policies[0].excluded_sources=[];
    return response;
  };
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),false);
  assert.match(card.availabilityError,/Saved monitoring changed again/);
});

test("selected-member batch deduplicates entities and preserves existing exclusions",async()=>{
  const {card,server,calls}=fixture();
  const plan=prepareAvailabilityChange(card,[A,B,A]);
  assert.deepEqual(plan.sourceIds,[A,B]);
  assert.equal(await applyAvailabilityChange(card,plan),true);
  assert.deepEqual(savedPolicy(server.value,"entities").excluded_sources,[A,B]);
  assert.deepEqual(savedPolicy(server.value,"devices").excluded_sources,[A,B,C].sort());
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
  assert.equal(card.scopedNotice,null);
});

test("a large entity batch retains every canonical source and overlapping policy",()=>{
  const {card}=fixture(),sources=Array.from({length:10000},(_,index)=>entity(`entity:registry:bulk-${index}`,`bulk_${index}`));
  card.current.data.inventory.catalog.candidates=sources;
  card.current.data.inventory.nodes=["entities","devices"].flatMap(policy=>sources.map(source=>({...source,node_id:`monitoring:${policy}:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:policy,watched:true})));
  const plan=prepareAvailabilityChange(card,[...sources.map(source=>source.node_id),card.current.data.inventory.nodes[1]]);
  assert.equal(plan.sources.length,10000);
  assert.equal(plan.changes.find(change=>change.id==="entities").sourceIds.length,10000);
  assert.equal(plan.changes.find(change=>change.id==="devices").sourceIds.length,10000);
  assert.equal(plan.changes.find(change=>change.id==="devices").after.excluded_sources.length,10001);
});

test("canonical objects retain embedded checks when monitoring scope is indexed",()=>{
  const {card,sources}=fixture();
  card.current.data.inventory.nodes=[];
  sources[0].monitoring_checks=[{kind:"entity",monitoring_source:A,monitoring_policy:{id:"entities"},watched:true}];
  const plan=prepareAvailabilityChange(card,[A,sources[0]]);
  assert.deepEqual(plan.sourceIds,[A]);
  assert.deepEqual(plan.changes.map(change=>change.id),["entities"]);
});

for(const [ids,heading] of [[[A],"Stop monitoring this entity?"],[[A,B],"Stop monitoring these 2 entities?"]]) {
  test(`confirmation leads with ${heading} and shows the exact entities directly`,()=>{
    const {card}=fixture(),plan=prepareAvailabilityChange(card,ids);
    const html=availabilityConfirmation(plan,(mode,label)=>`<button data-mode="${mode}">${label}</button>`);
    assert.ok(html.includes(`<h3>${heading}</h3>`));
    assert.match(html,/data-mode="confirm">Stop monitoring<\/button>/);
    assert.match(html,/sensor.one/);
    assert.equal((html.match(/<li>/g)||[]).length,ids.length);
    if(ids.length>1)assert.match(html,/sensor.two/);
    assert.doesNotMatch(html,/<details|<summary|<p>Policies|<li>entities<\/li>|<li>devices<\/li>/);
    assert.match(html,/Stop availability monitoring for (?:this entity|these entities)\. Other checks stay enabled\./);
    assert.doesNotMatch(html,/recovered|device availability evidence|individual availability/);
  });
}

test("browsing and cancelled plans never mutate saved settings or drafts",()=>{
  const {card,server,calls}=fixture(),before=clone(card.settingsDraft);
  availabilityMonitoring(card,A);prepareAvailabilityChange(card,[A]);
  assert.deepEqual(card.settingsDraft,before);
  assert.deepEqual(server.value.settings,before);
  assert.deepEqual(calls,[]);
});

test("availability save preserves unrelated drafts without submitting them",async()=>{
  const {card,server}=fixture();
  draftPolicy(card,"temperature").name="Pending temperature";
  card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
  card.settingsDraft.timings.settle=90;
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),true);
  assert.equal(savedPolicy(server.value,"temperature").name,"temperature");
  assert.equal(draftPolicy(card,"temperature").name,"Pending temperature");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Pending phone");
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(card.settingsDraft.timings.settle,90);
  assert.equal(server.value.settings.timings.settle,30);
});

for(const affected of ["entities","devices"]) {
  test(`a pending ${affected} draft blocks the complete batch`,async()=>{
    const {card,server,calls}=fixture(),before=clone(server.value);
    const plan=prepareAvailabilityChange(card,[A,B]);
    draftPolicy(card,affected).name="Pending edit";
    assert.equal(await applyAvailabilityChange(card,plan),false);
    assert.match(card.availabilityError,/Save or discard the draft/);
    assert.deepEqual(server.value,before);
    assert.deepEqual(calls,[]);
    assert.equal(draftPolicy(card,affected).name,"Pending edit");
  });
}

test("a revision changed after confirmation requires reviewing scope again",async()=>{
  const {card,server,calls}=fixture(),plan=prepareAvailabilityChange(card,[A]);
  server.value.revision="r2";server.value.settings.notifications=true;
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.match(card.availabilityError,/Saved settings changed/);
  assert.deepEqual(calls,[]);
  assert.equal(savedPolicy(server.value,"entities").excluded_sources,undefined);
});

test("a stale server rejection refreshes settings before a later mutation",async()=>{
  const {card,server,calls}=fixture(),normal=card._hass.callWS;
  card._hass.callWS=async request=>{
    if(request.type==="homeostatic/save_settings")throw {code:"stale_configuration",message:"Saved settings changed"};
    return normal(request);
  };
  const plan=prepareAvailabilityChange(card,[A]);
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.equal(card.scopedConfiguration.needsRefresh,true);
  server.value.revision="r2";
  card._hass.callWS=normal;
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.deepEqual(calls.map(call=>call.type),["homeostatic/configuration"]);
  assert.equal(card.availabilityUndo,undefined);
});

for(const reply of [undefined,{saved:false}]) {
  test(`an unconfirmed ${JSON.stringify(reply)} save never claims success`,async()=>{
    const {card,server}=fixture(),before=clone(server.value);
    card._hass.callWS=async()=>reply;
    assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),false);
    assert.match(card.availabilityError,/not confirmed/);
    assert.equal(card.scopedConfiguration.needsRefresh,true);
    assert.equal(card.availabilityUndo,undefined);
    assert.deepEqual(server.value,before);
  });
}

test("confirmed save with failed reload requires refresh before reporting a confirmed result",async()=>{
  const {card,server}=fixture(),normal=card._hass.callWS;
  card._hass.callWS=async request=>{
    if(request.type==="homeostatic/configuration")throw new Error("Connection lost");
    return normal(request);
  };
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),false);
  assert.deepEqual(savedPolicy(server.value,"entities").excluded_sources,[A]);
  assert.match(card.availabilityError,/were saved.*could not be reloaded/);
  assert.equal(card.scopedConfiguration.needsRefresh,true);
  assert.equal(card.availabilityUndo,undefined);
});

for(const status of ["disconnected","unavailable","error"]) {
  test(`${status} views cannot prepare or submit a change`,async()=>{
    const {card,calls}=fixture(),plan=prepareAvailabilityChange(card,[A]);
    card.current.status=status;
    assert.throws(()=>prepareAvailabilityChange(card,[A]),/Reconnect/);
    assert.equal(await applyAvailabilityChange(card,plan),false);
    assert.deepEqual(calls,[]);
  });
}

test("connection loss during refresh prevents submission",async()=>{
  const {card,calls}=fixture(),normal=card._hass.callWS,plan=prepareAvailabilityChange(card,[A]);
  card.scopedConfiguration.needsRefresh=true;
  card._hass.callWS=async request=>{const result=await normal(request);card.current.status="disconnected";return result;};
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.deepEqual(calls.map(call=>call.type),["homeostatic/configuration"]);
  assert.match(card.availabilityError,/not connected/);
});

for(const pending of [{catalog_stale:true},{catalog_loaded:false}]) {
  test(`a pending catalog ${JSON.stringify(pending)} cannot define a monitoring change`,async()=>{
    const {card,calls}=fixture(),plan=prepareAvailabilityChange(card,[A]);
    Object.assign(card.current.data,pending);
    assert.throws(()=>prepareAvailabilityChange(card,[A]),/source list to finish updating/);
    assert.equal(await applyAvailabilityChange(card,plan),false);
    assert.deepEqual(calls,[]);
  });
}

test("catalog invalidation during saved-settings refresh prevents submission",async()=>{
  const {card,calls}=fixture(),normal=card._hass.callWS,plan=prepareAvailabilityChange(card,[A]);
  card.scopedConfiguration.needsRefresh=true;
  card._hass.callWS=async request=>{const result=await normal(request);card.current.data.catalog_stale=true;return result;};
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.deepEqual(calls.map(call=>call.type),["homeostatic/configuration"]);
  assert.match(card.availabilityError,/source list to finish updating/);
});

test("a refreshed catalog requires a fresh confirmation even when saved policies are unchanged",async()=>{
  const {card,calls}=fixture();
  card.current.data.catalog_revision=1;
  const plan=prepareAvailabilityChange(card,[A]);
  card.current.data.catalog_revision=2;
  assert.equal(await applyAvailabilityChange(card,plan),false);
  assert.deepEqual(calls,[]);
  assert.match(card.availabilityError,/monitored source list changed/);
});

test("resume removes selected explicit exclusions without enrolling other sources or enabling policies",async()=>{
  const {card,server}=fixture();
  savedPolicy(server.value,"entities").excluded_sources=[A,B];
  savedPolicy(server.value,"entities").match={kind:["entity"],entity:["registry:unselected"]};
  savedPolicy(server.value,"devices").excluded_sources=[A,C];
  savedPolicy(server.value,"devices").enabled=false;
  savedPolicy(server.value,"temperature").excluded_sources=[A];
  rebaseScopedConfiguration(card,clone(server.value));
  const plan=prepareAvailabilityChange(card,[A],"resume");
  assert.equal(await applyAvailabilityChange(card,plan),true);
  assert.deepEqual(savedPolicy(server.value,"entities").excluded_sources,[B]);
  assert.deepEqual(savedPolicy(server.value,"entities").match,{kind:["entity"],entity:["registry:unselected"]});
  assert.deepEqual(savedPolicy(server.value,"devices").excluded_sources,[C]);
  assert.equal(savedPolicy(server.value,"devices").enabled,false);
  assert.deepEqual(savedPolicy(server.value,"temperature").excluded_sources,[A]);
  assert.match(plan.summary,/enabled state and eligibility/);
});

test("saved exclusions remain policy settings after later unrelated changes",async()=>{
  const {card,server,calls}=fixture();
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),true);
  server.value.revision="r3";savedPolicy(server.value,"temperature").name="Changed elsewhere";
  rebaseScopedConfiguration(card,clone(server.value));
  assert.deepEqual(card.configuration.settings.monitoring_policies[0].excluded_sources,[A]);
  assert.deepEqual(card.configuration.settings.monitoring_policies[1].excluded_sources,[A,C].sort());
  assert.equal(card.configuration.settings.monitoring_policies[2].name,"Changed elsewhere");
  assert.equal(card.availabilityUndo,undefined);
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
});

test("newer affected edits made during the request remain unsaved",async()=>{
  const {card,server}=fixture(),normal=card._hass.callWS;
  card._hass.callWS=async request=>{
    if(request.type==="homeostatic/save_settings")draftPolicy(card,"entities").name="Newer pending name";
    return normal(request);
  };
  assert.equal(await applyAvailabilityChange(card,prepareAvailabilityChange(card,[A])),true);
  assert.equal(savedPolicy(server.value,"entities").name,"entities");
  assert.equal(draftPolicy(card,"entities").name,"Newer pending name");
});

for(const [name,edit,message] of [
  ["enabled state",plan=>plan.changes[0].after.enabled=false,/exclusions only/],
  ["unselected exclusions",plan=>plan.changes[0].after.excluded_sources.push(B),/Only the selected entities/],
]) {
  test(`a tampered confirmation cannot change ${name}`,async()=>{
    const {card,calls}=fixture(),plan=prepareAvailabilityChange(card,[A]);
    edit(plan);
    assert.equal(await applyAvailabilityChange(card,plan),false);
    assert.match(card.availabilityError,message);
    assert.deepEqual(calls,[]);
  });
}
