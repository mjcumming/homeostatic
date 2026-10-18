import assert from "node:assert/strict";
import test from "node:test";
import {issueAvailabilitySources,issueAvailabilityAction,editIssueAvailability,resetIssueAvailability,renderIssueAvailability} from "../../custom_components/homeostatic/frontend/issue-monitoring.mjs";
import {issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {initializeScopedConfiguration} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {WorkspaceNavigation,workspacePath,workspaceRoute} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";

const clone=value=>structuredClone(value);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const click=(card,action,episodeId=card.detail?.episodeId)=>editIssueAvailability(card,{target:{closest:()=>({dataset:{issueAvailability:action,issueId:episodeId}})}});
const saves=calls=>calls.filter(call=>call.type==="homeostatic/save_settings");
function open(card,episodeId) {resetIssueAvailability(card);card.dialog.open=true;card.detail={episodeId};card.render();}
function close(card) {card.detail=null;card.dialog.close();resetIssueAvailability(card);card.render();}

function fixture(count=3) {
  const entities=Array.from({length:count},(_,i)=>({node_id:"entity:"+i,entity_id:"sensor.example_"+i,name:"Reading "+i,kind:"entity",owner_id:"example",attributes:{integration:["example"]}}));
  const checks=entities.map(source=>({...source,node_id:"check:"+source.node_id,monitoring_source:source.node_id,monitoring_policy:"entities",watched:true,check_id:"availability"}));
  const canonical=new Map(checks.map(check=>[check.node_id,check.monitoring_source]));
  const entry={node_id:"entry:example",kind:"integration",entry_id:"example",name:"Example",attributes:{domain:["example"]}};
  const episodes=checks.map(check=>({episode_id:"issue:"+check.node_id,anchor:check.node_id,recorded:[check.node_id],impact:[],reasons:[{node_id:check.node_id,status:"warn",reason:"unavailable",check_id:"availability"}],opened_at:"2026-10-14T12:00:00Z"}));
  const settings={notifications:false,monitoring_policies:[{id:"entities",name:"Entities",enabled:true,check:"availability",match:{kind:["entity"]},parameters:{},notifications:[]},{id:"temperature",name:"Temperature",enabled:true,check:"temperature_limit",match:{kind:["entity"]},parameters:{},notifications:[]}]};
  const server={revision:"r1",settings:clone(settings)},calls=[];
  const data={schema_version:3,catalog_loaded:true,catalog_revision:"c1",inventory:{nodes:[entry,...entities,...checks],catalog:{candidates:[entry,...entities]},episodes,entity_status:Object.fromEntries(checks.map(check=>[check.node_id,{current:{status:"warn",reason:"unavailable"}}]))}};
  const card={current:{status:"current",data},configuration:clone(server),settingsDraft:clone(settings),dialog:{open:false,close(){this.open=false;}},detail:null,
    issueRow:(_,episode)=>'<article data-episode="'+episode.episode_id+'"></article>',
    render(){this.html=issuesWorkspace(this);const episode=this.dialog.open&&(data.inventory.episodes.find(item=>item.episode_id===this.detail?.episodeId)||{episode_id:this.detail?.episodeId});this.dialogHtml=episode?issueAvailabilityAction(this,episode):"";},
    _hass:{async callWS(request){
      calls.push(clone(request));
      if(request.type==="homeostatic/configuration")return clone(server);
      assert.equal(request.type,"homeostatic/save_settings");assert.equal(request.revision,server.revision);
      server.settings=clone(request.settings);server.revision+="n";
      const excluded=new Set(server.settings.monitoring_policies[0].excluded_sources||[]);
      data.inventory.episodes=data.inventory.episodes.filter(episode=>!excluded.has(canonical.get(episode.anchor)));
      return {saved:true};
    }}};
  initializeScopedConfiguration(card);card.render();
  return {card,server,calls,entities,checks,episodes,data};
}

test("collapsed and expanded queues have no availability controls, counts or feedback",()=>{
  const {card}=fixture(100);
  assert.doesNotMatch(card.html,/data-episode=/);
  assert.doesNotMatch(card.html,/issue-availability|issue-monitoring-feedback|unavailable entit/);
  card.issueGroupsExpanded=new Set(["integration:example"]);card.render();
  assert.equal((card.html.match(/data-episode=/g)||[]).length,40);
  assert.doesNotMatch(card.html,/issue-availability|issue-monitoring-feedback|unavailable entit/);
  assert.equal(card.issueAvailabilityGroups,undefined);
});

test("an opened standalone issue saves only its entity and closes quietly",async()=>{
  const {card,server,calls,episodes}=fixture();
  open(card,episodes[0].episode_id);
  assert.match(card.dialogHtml,/data-issue-availability-owner="issue:check:entity:0"/);
  assert.match(card.dialogHtml,/class="button" data-issue-availability="remove"[^>]*>Stop Monitoring<\/button>/);
  click(card,"remove");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0"]);
  assert.equal(card.issueAvailabilityEpisode,episodes[0].episode_id);
  assert.equal(calls.length,0);
  assert.match(card.dialogHtml,/Stop monitoring this entity\?/);
  assert.doesNotMatch(card.dialogHtml,/<details|<summary|<p>Policies/);
  assert.match(card.dialogHtml,/data-issue-availability="confirm"[^>]*>Stop Monitoring<\/button>/);
  assert.doesNotMatch(card.dialogHtml,/data-issue-availability="remove"/);
  click(card,"confirm");await tick();
  assert.equal(saves(calls).length,1);
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,["entity:0"]);
  assert.equal(server.settings.monitoring_policies[1].excluded_sources,undefined);
  assert.equal(server.settings.notifications,false);
  assert.equal(card.dialog.open,false);assert.equal(card.detail,null);
  assert.equal(card.issueAvailabilityPlan,null);assert.equal(card.issueAvailabilityEpisode,null);
  assert.equal(card.current.data.inventory.episodes.length,2);
  assert.doesNotMatch(card.html,/issue-monitoring-feedback|Changes saved|data-issue-availability=/);
});

test("successful device removal returns through the captured Monitoring route",async t=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
  globalThis.window={location:{pathname:"/fixture"}};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?device-removal-return-test");
  const {card,entities,checks,server,calls}=fixture();
  for(const source of [...entities,...checks])source.attributes={...source.attributes,device:["example-device"]};
  Object.assign(card,{page:"sources",sourcesSelection:"source:device:example-device",sourcesView:"source",sourcesQuery:"Example",sourcesMobileDetail:true,renderedCurrent:false,shadowRoot:{querySelector:()=>null}});
  card.dialog.close=function(){this.open=false;resetIssueAvailability(card);};
  card.closeDeviceDetail=elements.get("homeostatic-card").prototype.closeDeviceDetail;
  card.navigation=new WorkspaceNavigation(card);
  const origin=card.navigation.capture();
  card.detail={deviceId:"example-device"};card.dialog.open=true;card.navigation.finish(origin);card.render();
  assert.equal(workspacePath(workspaceRoute(card)),"/device-issues/example-device");
  click(card,"remove","device:example-device");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0","entity:1","entity:2"]);
  click(card,"confirm","device:example-device");await tick();
  assert.equal(saves(calls).length,1);
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,["entity:0","entity:1","entity:2"]);
  assert.equal(card.dialog.open,false);assert.equal(card.detail,null);
  assert.equal(card.navigation.currentId,origin.id);
  assert.equal(workspacePath(workspaceRoute(card)),"/sources/source%3Adevice%3Aexample-device");
  assert.equal(card.sourcesQuery,"Example");assert.equal(card.sourcesMobileDetail,true);
  assert.equal(card.issueAvailabilityPlan,null);
});

test("search and pagination never broaden the opened issue's removal scope",()=>{
  const {card,episodes,calls}=fixture(100);
  card.issueGroupsExpanded=new Set(["integration:example"]);card.render();
  open(card,episodes[99].episode_id);click(card,"remove");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:99"]);
  card.issueQuery="Reading 0";card.render();
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:99"]);
  click(card,"cancel");
  assert.equal(card.issueAvailabilityPlan,null);assert.equal(card.dialog.open,true);
  assert.equal(calls.length,0);assert.match(card.dialogHtml,/data-issue-availability="remove"/);
});

test("a shared issue includes its findings once and excludes unrelated sibling issues",async()=>{
  const {card,data,checks,episodes,server,calls}=fixture(4);
  const shared={episode_id:"shared",anchor:"entry:example",opened_at:episodes[0].opened_at,recorded:["entry:example",checks[0].node_id,checks[1].node_id],impact:[checks[2].node_id],reasons:[...episodes[0].reasons,...episodes[1].reasons,...episodes[0].reasons]};
  data.inventory.episodes.push(shared);open(card,"shared");click(card,"remove");
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0","entity:1"]);
  click(card,"cancel");assert.equal(calls.length,0);
  click(card,"remove");click(card,"confirm");await tick();
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,["entity:0","entity:1"]);
  assert.equal(saves(calls).length,1);
});

test("only current unavailable availability evidence is selected, with overlap deduplicated",()=>{
  const {card,data,checks,episodes}=fixture(5);
  data.inventory.entity_status[checks[1].node_id].current={status:"pass",reason:"value_unknown"};
  data.inventory.entity_status[checks[2].node_id].current={status:"unknown",reason:"restored_state"};
  card._hass.states={"sensor.example_3":{state:"off"}};
  checks[4].monitoring_policy="temperature";episodes[0].recorded.push(checks[4].node_id);
  const overlapping={...checks[0],node_id:"check:extra"};data.inventory.nodes=[...data.inventory.nodes,overlapping];
  data.inventory.entity_status[overlapping.node_id]=data.inventory.entity_status[checks[0].node_id];
  episodes[0].reasons.push({node_id:overlapping.node_id,status:"warn",reason:"unavailable"});
  assert.deepEqual(issueAvailabilitySources(card,episodes).map(source=>source.node_id),["entity:0"]);
});

test("episodes without eligible availability findings offer no removal",()=>{
  const {card,checks,episodes}=fixture();checks[0].monitoring_policy="temperature";
  open(card,episodes[0].episode_id);
  assert.doesNotMatch(card.dialogHtml,/data-issue-availability="remove"/);
});

test("closed dialogs and stale issue buttons cannot prepare or confirm another issue",()=>{
  const {card,episodes,calls}=fixture();
  click(card,"remove",episodes[0].episode_id);assert.equal(card.issueAvailabilityPlan,undefined);
  open(card,episodes[0].episode_id);click(card,"remove",episodes[1].episode_id);
  assert.equal(card.issueAvailabilityPlan,null);
  click(card,"remove");open(card,episodes[1].episode_id);
  assert.equal(card.issueAvailabilityPlan,null);
  click(card,"confirm",episodes[0].episode_id);assert.equal(calls.length,0);
  click(card,"remove");close(card);click(card,"confirm",episodes[1].episode_id);
  assert.equal(card.issueAvailabilityPlan,null);assert.equal(calls.length,0);
});

for(const [name,update] of [
  ["a selected entity recovers",({card})=>{card._hass.states={"sensor.example_0":{state:"on"}};}],
  ["the current issue gains another unavailable finding",({episodes})=>{episodes[0].reasons.push(...episodes[1].reasons);}],
  ["the opened issue resolves",({data})=>{data.inventory.episodes=data.inventory.episodes.slice(1);}],
]) {
  test("confirmation cannot save after "+name,async()=>{
    const fixtureData=fixture(),{card,calls,episodes}=fixtureData;
    open(card,episodes[0].episode_id);click(card,"remove");update(fixtureData);click(card,"confirm");await tick();
    assert.equal(calls.length,0);assert.equal(card.issueAvailabilityPlan,null);
  });
}

test("stale catalog reviews and affected drafts block writes inside the issue",async()=>{
  const {card,calls,episodes}=fixture();open(card,episodes[0].episode_id);
  click(card,"remove");card.current.data.catalog_revision="c2";click(card,"confirm");await tick();
  assert.equal(saves(calls).length,0);assert.match(card.dialogHtml,/role="alert"/);
  click(card,"remove");card.settingsDraft.monitoring_policies[0].name="Unfinished edit";click(card,"confirm");await tick();
  assert.equal(saves(calls).length,0);assert.match(card.dialogHtml,/draft/);
  assert.equal(card.dialog.open,true);
});

test("source-level errors cannot replace an issue's confirmation or leak into its dialog",()=>{
  const {card,calls,episodes}=fixture();open(card,episodes[0].episode_id);click(card,"remove");
  card.availabilityContext="entity:0";card.availabilityError="Source-only failure";card.render();
  assert.match(card.dialogHtml,/data-issue-availability="confirm"/);
  assert.doesNotMatch(card.dialogHtml,/Source-only failure/);
  click(card,"cancel");assert.equal(card.issueAvailabilityPlan,null);assert.equal(calls.length,0);
});

for(const [name,update] of [
  ["stale catalog",card=>{card.current.data.catalog_stale=true;}],
  ["configuration loading",card=>{card.configBusy=true;}],
  ["disconnection",card=>{card.current.status="disconnected";}],
]) {
  test("the issue review remains cancellable during "+name,()=>{
    const {card,calls,episodes}=fixture();open(card,episodes[0].episode_id);click(card,"remove");update(card);card.render();
    assert.doesNotMatch(card.dialogHtml,/<button[^>]*data-issue-availability="cancel"[^>]* disabled/);
    click(card,"cancel");assert.equal(card.issueAvailabilityPlan,null);assert.equal(calls.length,0);
    assert.equal(card.dialog.open,true);
  });
}

test("a rejected save retains the dialog and review for one deliberate retry",async()=>{
  const {card,server,calls,episodes}=fixture(),callWS=card._hass.callWS;
  let fail=true;
  card._hass.callWS=async request=>{if(fail&&request.type==="homeostatic/save_settings"){calls.push(clone(request));throw {code:"invalid_settings",message:"Temporary save failure"};}return callWS(request);};
  open(card,episodes[0].episode_id);click(card,"remove");click(card,"confirm");await tick();
  assert.equal(card.dialog.open,true);assert.match(card.dialogHtml,/Temporary save failure/);
  assert.match(card.dialogHtml,/data-issue-availability="confirm"/);
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0"]);
  assert.equal(server.settings.monitoring_policies[0].excluded_sources,undefined);
  assert.equal(saves(calls).length,1);
  fail=false;click(card,"confirm");await tick();
  assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,["entity:0"]);
  assert.equal(saves(calls).length,2);assert.equal(card.dialog.open,false);
});

test("dialog controls update in place without fetching evidence and remain safe during lost data",()=>{
  const {card,calls,episodes}=fixture(),states=[];
  open(card,episodes[0].episode_id);click(card,"remove");
  const host={dataset:{issueAvailabilityOwner:episodes[0].episode_id},innerHTML:"",querySelector:()=>null};
  card.dialog.querySelector=()=>host;
  card.capturePageState=target=>{assert.equal(target,host);return {focus:"confirm"};};
  card.restorePageState=(state,target)=>{assert.equal(target,host);states.push(state);};
  renderIssueAvailability(card);
  assert.match(host.innerHTML,/data-issue-availability="confirm"/);
  assert.deepEqual(states,[{focus:"confirm"}]);
  renderIssueAvailability(card);assert.equal(states.length,1);
  card.current={status:"disconnected",data:null};
  renderIssueAvailability(card);
  assert.match(host.innerHTML,/<button[^>]*data-issue-availability="confirm"[^>]* disabled/);
  assert.doesNotMatch(host.innerHTML,/<button[^>]*data-issue-availability="cancel"[^>]* disabled/);
  assert.equal(calls.length,0);
});

test("an issue disappearing during a pending save keeps its failure and cancellable review visible",async()=>{
  const {card,calls,data,episodes}=fixture();
  let reject;
  card._hass.callWS=request=>{calls.push(clone(request));return new Promise((_,decline)=>{reject=decline;});};
  open(card,episodes[0].episode_id);click(card,"remove");click(card,"confirm");
  data.inventory.episodes=data.inventory.episodes.slice(1);card.render();
  assert.equal(card.dialog.open,true);assert.match(card.dialogHtml,/Stopping monitoring…/);
  reject({code:"invalid_settings",message:"Readback not confirmed"});await tick();
  assert.equal(card.dialog.open,true);assert.equal(card.detail.episodeId,episodes[0].episode_id);
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0"]);
  assert.match(card.dialogHtml,/Readback not confirmed/);
  assert.match(card.dialogHtml,/<button[^>]*data-issue-availability="confirm"[^>]* disabled/);
  assert.doesNotMatch(card.dialogHtml,/data-issue-availability="remove"/);
  assert.doesNotMatch(card.dialogHtml,/<button[^>]*data-issue-availability="cancel"[^>]* disabled/);
  click(card,"cancel");assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(saves(calls).length,1);
});

test("detail refresh holds a reviewed issue until refreshed monitoring releases its History outcome",async t=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?issue-removal-test");
  const {card,calls,data,episodes}=fixture(),history=[],body={innerHTML:"Original issue evidence"};
  const host={dataset:{issueAvailabilityOwner:episodes[0].episode_id},innerHTML:"",querySelector:()=>null};
  open(card,episodes[0].episode_id);click(card,"remove");
  card.dialog.querySelector=()=>host;
  card.shadowRoot={querySelector:selector=>selector===".dialog-body"?body:selector==="#detail-label"?{}:null};
  card.tools={showHistory:id=>history.push(id)};card.detailSequence=0;card.page="problems";
  data.inventory.episodes=data.inventory.episodes.slice(1);
  data.inventory.resolved_history={episodes:[{episode:episodes[0],resolution:"removed"}]};
  card.scopedBusy="source-availability";
  const loadDetail=elements.get("homeostatic-card").prototype.loadDetail;
  card.readDetail=elements.get("homeostatic-card").prototype.readDetail;
  await loadDetail.call(card);
  assert.equal(card.dialog.open,true);assert.equal(card.page,"problems");
  assert.deepEqual(history,[]);assert.equal(calls.length,0);
  assert.equal(body.innerHTML,"Original issue evidence");assert.match(host.innerHTML,/Stopping monitoring…/);
  card.scopedBusy=null;card.availabilityError="Save not confirmed";
  await loadDetail.call(card);
  assert.match(host.innerHTML,/Save not confirmed/);assert.deepEqual(history,[]);
  card.loadConfiguration=async()=>{};card.loadDetail=()=>loadDetail.call(card);
  click(card,"refresh");await tick();
  assert.equal(card.issueAvailabilityEpisode,null);assert.equal(card.issueAvailabilityPlan,null);
  assert.equal(card.availabilityError,null);
  assert.equal(card.page,"history");assert.deepEqual(history,[episodes[0].episode_id]);
});

test("a failed pending save preserves its error after connection loss removes the snapshot",async()=>{
  const {card,episodes}=fixture();
  let reject;
  card._hass.callWS=()=>new Promise((_,decline)=>{reject=decline;});
  open(card,episodes[0].episode_id);click(card,"remove");click(card,"confirm");
  card.render=()=>{card.dialogHtml=issueAvailabilityAction(card,{episode_id:episodes[0].episode_id});};
  card.current={status:"disconnected",data:null};
  reject({code:"invalid_settings",message:"Disconnected save rejection"});await tick();
  assert.equal(card.dialog.open,true);assert.equal(card.detail.episodeId,episodes[0].episode_id);
  assert.match(card.dialogHtml,/Disconnected save rejection/);
  assert.doesNotMatch(card.dialogHtml,/Cannot read|data-issue-availability="remove"/);
  assert.equal(card.settingsBusy,false);
});

test("an unavailable-to-current transition rebuilds a removed issue review and retains its failure",async t=>{
  const elements=new Map();
  globalThis.HTMLElement=class {};
  globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
  globalThis.window={};
  t.after(()=>{delete globalThis.HTMLElement;delete globalThis.customElements;delete globalThis.window;});
  await import("../../custom_components/homeostatic/frontend/homeostatic.js?issue-removal-reconnect-test");
  const {card,calls,data,episodes,server}=fixture(),history=[],label={};
  const before=clone(server.settings);
  open(card,episodes[0].episode_id);click(card,"remove");
  const body={innerHTML:card.dialogHtml},host={dataset:{issueAvailabilityOwner:episodes[0].episode_id},innerHTML:"",querySelector:()=>null};
  card.dialog.querySelector=()=>body.innerHTML.includes('class="issue-availability"')?host:null;
  card.shadowRoot={querySelector:selector=>selector===".dialog-body"?body:selector==="#detail-label"?label:null};
  card.tools={showHistory:id=>history.push(id)};card.detailSequence=0;card.page="problems";
  card.renderedDetailContent="Original reviewed issue";
  const loadDetail=elements.get("homeostatic-card").prototype.loadDetail;
  card.readDetail=elements.get("homeostatic-card").prototype.readDetail;
  card.loadDetail=()=>loadDetail.call(card);
  card.current={status:"unavailable",data:{available:false}};
  await card.loadDetail();
  assert.match(body.innerHTML,/Wait for monitoring to reconnect/);
  assert.equal(card.dialog.querySelector(".issue-availability"),null);
  data.inventory.episodes=data.inventory.episodes.slice(1);
  data.inventory.resolved_history={episodes:[{episode:episodes[0],resolution:"removed"}]};
  card.current={status:"current",data};card.scopedBusy="source-availability";card.settingsBusy=true;
  await card.loadDetail();
  assert.equal(body.inert,false);assert.equal(label.hidden,false);assert.equal(label.textContent,"Issue no longer current");
  assert.doesNotMatch(body.innerHTML,/Wait for monitoring to reconnect/);
  assert.match(body.innerHTML,/Stopping monitoring…/);
  assert.match(body.innerHTML,/<button[^>]*data-issue-availability="confirm"[^>]* disabled/);
  assert.match(body.innerHTML,/<button[^>]*data-issue-availability="cancel"[^>]* disabled/);
  card.scopedBusy=null;card.settingsBusy=false;card.availabilityError="Save result could not be confirmed";
  await card.loadDetail();
  assert.match(host.innerHTML,/Save result could not be confirmed/);
  assert.match(host.innerHTML,/<button[^>]*data-issue-availability="confirm"[^>]* disabled/);
  assert.doesNotMatch(host.innerHTML,/<button[^>]*data-issue-availability="cancel"[^>]* disabled/);
  assert.deepEqual(card.issueAvailabilityPlan.sourceIds,["entity:0"]);
  click(card,"cancel");await tick();
  assert.equal(card.issueAvailabilityPlan,null);assert.equal(card.availabilityError,null);
  assert.deepEqual(history,[episodes[0].episode_id]);
  assert.deepEqual(server.settings,before);assert.equal(calls.length,0);
});

for(const [outcome,finish,expected] of [
  ["success",({resolve})=>resolve(),["entity:0"]],
  ["failure",({reject})=>reject({code:"invalid_settings",message:"Late save failure"}),undefined],
]) {
  test("late save "+outcome+" after close cannot change another opened issue's dialog",async()=>{
    const {card,server,episodes}=fixture(),callWS=card._hass.callWS;
    let resolve,reject;
    const pending=new Promise((accept,decline)=>{resolve=accept;reject=decline;});
    card._hass.callWS=async request=>{if(request.type==="homeostatic/save_settings")await pending;return callWS(request);};
    open(card,episodes[0].episode_id);click(card,"remove");click(card,"confirm");
    assert.equal(card.settingsBusy,true);close(card);open(card,episodes[1].episode_id);
    finish({resolve,reject});await tick();
    assert.equal(card.dialog.open,true);assert.equal(card.detail.episodeId,episodes[1].episode_id);
    assert.equal(card.issueAvailabilityPlan,null);assert.equal(card.issueAvailabilityEpisode,null);
    assert.doesNotMatch(card.dialogHtml,/Late save failure|data-issue-availability="confirm"/);
    assert.deepEqual(server.settings.monitoring_policies[0].excluded_sources,expected);
  });
}
