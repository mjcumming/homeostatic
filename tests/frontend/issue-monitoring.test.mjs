import assert from "node:assert/strict";
import test from "node:test";
import {issueAvailabilitySources,editIssueAvailability} from "../../custom_components/homeostatic/frontend/issue-monitoring.mjs";
import {issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";

const clone=value=>structuredClone(value);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const click=(card,action,group="integration:example")=>editIssueAvailability(card,{target:{closest:()=>({dataset:{issueAvailability:action,monitoringGroup:group}})}});

function fixture(count=2) {
  const entities=Array.from({length:count},(_,i)=>({node_id:`entity:${i}`,entity_id:`sensor.example_${i}`,name:`Reading ${i}`,kind:"entity",owner_id:"example",attributes:{integration:["example"]}}));
  const checks=entities.map(source=>({...source,node_id:`check:${source.node_id}`,monitoring_source:source.node_id,monitoring_policy:"entities",watched:true,check_id:"availability"}));
  const canonical=new Map(checks.map(check=>[check.node_id,check.monitoring_source]));
  const entry={node_id:"entry:example",kind:"integration",entry_id:"example",name:"Example",attributes:{domain:["example"]}};
  const episodes=checks.map(check=>({episode_id:`issue:${check.node_id}`,anchor:check.node_id,recorded:[check.node_id],impact:[],reasons:[{node_id:check.node_id,status:"warn",reason:"unavailable",check_id:"availability"}],opened_at:"2026-10-14T12:00:00Z"}));
  const settings={notifications:false,monitoring_policies:[{id:"entities",name:"Entities",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[]},{id:"temperature",name:"Temperature",enabled:true,check:"temperature_limit",match:{kind:["entity"]},parameters:{},notifications:[]}]};
  const server={revision:"r1",settings:clone(settings)},calls=[];
  const data={schema_version:3,catalog_loaded:true,catalog_revision:"c1",inventory:{nodes:[entry,...entities,...checks],catalog:{candidates:[entry,...entities]},episodes,entity_status:Object.fromEntries(checks.map(check=>[check.node_id,{current:{status:"warn",reason:"unavailable"}}]))}};
  const card={current:{status:"current",data},configuration:clone(server),settingsDraft:clone(settings),issueRow:(_,episode)=>`<article data-episode="${episode.episode_id}"></article>`,render(){this.html=issuesWorkspace(this);},_hass:{async callWS(request){
    calls.push(clone(request));
    if(request.type==="homeostatic/configuration")return clone(server);
    assert.equal(request.type,"homeostatic/save_settings");assert.equal(request.revision,server.revision);
    server.settings=clone(request.settings);server.revision+="n";
    const excluded=new Set(server.settings.monitoring_policies[0].excluded_sources||[]);
    data.inventory.episodes=episodes.filter(episode=>!excluded.has(canonical.get(episode.anchor)));
    return {saved:true};
  }}};
  initializeScopedConfiguration(card);card.render();
  return {card,server,calls,entities,checks,episodes,data};
}

test("a collapsed group saves ten thousand exclusions and finishes quietly when it disappears",async()=>{
  const {card,server,calls,entities}=fixture(10000);
  assert.match(card.html,/10000 unavailable entities/);
  assert.doesNotMatch(card.html,/data-episode=/);
  click(card,"remove");
  assert.equal(card.issueAvailabilityPlan.sources.length,10000);
  assert.equal(calls.length,0);
  assert.match(card.html,/<summary>Details<\/summary>/);
  assert.match(card.html,/class="button primary" data-issue-availability="confirm"/);
  click(card,"confirm");await tick();
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,entities.map(source=>source.node_id).sort());
  assert.equal(server.settings.monitoring_policies[1].excluded_sources,undefined);
  assert.equal(server.settings.notifications,false);
  assert.doesNotMatch(card.html,/data-issue-group=/);
  assert.doesNotMatch(card.html,/issue-monitoring-feedback|Changes saved|removed from availability monitoring/);
  assert.doesNotMatch(card.html,/data-issue-availability=/);
  assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(card.availabilityUndo,undefined);
  card.render();
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,entities.map(source=>source.node_id).sort());
});

test("search scopes the full batch while pagination never truncates it",()=>{
  const {card}=fixture(100);
  card.issueGroupsExpanded=new Set(["integration:example"]);card.render();
  assert.equal((card.html.match(/data-episode=/g)||[]).length,40);
  assert.equal(card.issueAvailabilityGroups.get("integration:example").length,100);
  card.issueQuery="Reading 99";card.render();click(card,"remove");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:99"]);
  click(card,"cancel");assert.equal(card.issueAvailabilityPlan,null);
  assert.doesNotMatch(card.html,/issue-monitoring-feedback/);
});

test("only current unavailable availability evidence is selected, with overlap deduplicated",()=>{
  const {card,data,checks,episodes}=fixture(5);
  data.inventory.entity_status[checks[1].node_id].current={status:"pass",reason:"value_unknown"};
  data.inventory.entity_status[checks[2].node_id].current={status:"unknown",reason:"restored_state"};
  card._hass.states={"sensor.example_3":{state:"off"}};
  checks[4].monitoring_policy="temperature";
  episodes[0].recorded.push(checks[4].node_id);
  const overlapping={...checks[0],node_id:"check:extra"};data.inventory.nodes=[...data.inventory.nodes,overlapping];
  data.inventory.entity_status[overlapping.node_id]=data.inventory.entity_status[checks[0].node_id];
  episodes[0].reasons.push({node_id:overlapping.node_id,status:"warn",reason:"unavailable"});
  assert.deepEqual(issueAvailabilitySources(card,episodes).map(source=>source.node_id),["entity:0"]);
});

test("device-only issues include all selected unavailable members but no healthy or restored members",()=>{
  const {card,data,entities}=fixture(4);
  const check={node_id:"device:check",name:"Device",kind:"device",monitoring_policy:"entities",watched:true,availability_entities:entities.slice(0,3).map(source=>source.entity_id)};
  data.inventory.nodes=[...data.inventory.nodes,check];data.inventory.entity_status[check.node_id]={current:{status:"warn",reason:"all_unavailable"}};
  card._hass.states={"sensor.example_1":{state:"unavailable",attributes:{restored:true}},"sensor.example_2":{state:"unknown"}};
  assert.deepEqual(issueAvailabilitySources(card,[{anchor:check.node_id}]).map(source=>source.node_id),["entity:0"]);
});

test("cancel, stale review, dirty policies and disconnection never write settings",async()=>{
  const {card,calls}=fixture();
  click(card,"remove");click(card,"cancel");assert.equal(calls.length,0);
  click(card,"remove");card.current.data.catalog_revision="c2";click(card,"confirm");await tick();
  assert.equal(calls.length,0);assert.match(card.html,/role="alert"/);
  click(card,"remove");card.settingsDraft.monitoring_policies[0].name="Unfinished edit";click(card,"confirm");await tick();
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,0);assert.match(card.html,/draft/);
  card.current.status="disconnected";card.render();click(card,"confirm");
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,0);assert.match(card.html,/data-issue-availability="confirm" disabled/);
});


test("a pending removal can be reopened and its confirmation is brought into view",()=>{
  const {card,calls}=fixture(),scrolls=[],focus=[];
  card.shadowRoot={querySelector:selector=>({scrollIntoView:options=>scrolls.push({selector,options}),focus:options=>focus.push({selector,options})})};
  click(card,"remove");
  assert.doesNotMatch(card.html,/data-issue-availability="remove"[^>]* disabled/);
  assert.deepEqual(scrolls,[{selector:".issue-monitoring-feedback",options:{block:"center"}}]);
  assert.equal(focus.at(-1).selector,'[data-issue-availability="confirm"]');
  click(card,"remove");click(card,"cancel");click(card,"remove");click(card,"cancel");
  assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(calls.length,0);
  assert.doesNotMatch(card.html,/data-issue-availability="remove"[^>]* disabled/);
});

test("a source visit cannot hide a pending issue review or leak its source error",()=>{
  const {card,calls}=fixture();
  click(card,"remove");
  card.availabilityContext="entity:0";
  card.availabilityError="Source-only failure";
  card.render();
  assert.match(card.html,/data-issue-availability="confirm"/);
  assert.doesNotMatch(card.html,/Source-only failure|data-issue-availability="remove"[^>]* disabled/);
  click(card,"remove");
  assert.equal(card.availabilityContext,"issues");
  click(card,"cancel");
  assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(calls.length,0);
});

for(const [name,update] of [
  ["stale catalog",card=>{card.current.data.catalog_stale=true;}],
  ["configuration loading",card=>{card.configBusy=true;}],
  ["disconnection",card=>{card.current.status="disconnected";}],
]) {
  test(`cancel clears a pending review during ${name} without saving`,()=>{
    const {card,calls}=fixture();
    click(card,"remove");update(card);card.render();
    assert.doesNotMatch(card.html,/data-issue-availability="cancel" disabled/);
    click(card,"cancel");
    assert.equal(card.issueAvailabilityPlan,null);
    assert.equal(calls.length,0);
  });
}

test("a failed removal can be reviewed and explicitly confirmed again",async()=>{
  const {card,server,calls}=fixture(),callWS=card._hass.callWS;
  card._hass.callWS=async()=>{throw Error("Temporary save failure");};
  click(card,"remove");click(card,"confirm");await tick();
  assert.match(card.html,/Temporary save failure/);
  assert.doesNotMatch(card.html,/data-issue-availability="remove"[^>]* disabled/);
  assert.equal(server.settings.monitoring_policies[0].excluded_sources,undefined);
  card._hass.callWS=callWS;
  click(card,"remove");
  assert.equal(calls.length,0);
  click(card,"confirm");await tick();
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,["entity:0","entity:1"]);
  assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
});


test("reopening replaces the reviewed scope and failed preparation drops the old review",()=>{
  const {card,calls}=fixture();
  click(card,"remove");
  card.issueQuery="Reading 1";card.render();click(card,"remove");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:1"]);
  click(card,"remove","missing-group");
  assert.equal(card.issueAvailabilityPlan,null);
  assert.doesNotMatch(card.html,/data-issue-availability="confirm"/);
  assert.equal(calls.length,0);
});
