import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";
import {issueEvidenceFixture,issueEvidenceReply,LYRIC_EPISODE,LYRIC_ENTRY,lyricLocalize} from "./issue-evidence-fixture.mjs";
import {WorkspaceNavigation} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";

globalThis.HTMLElement=class {};
const elements=new Map();
globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const prototype=elements.get("homeostatic-card").prototype;

function contentHost() {
  let html="",writes=0,footer=null;
  return {
    get innerHTML(){return html;},
    set innerHTML(value){
      html=value;writes++;
      const marker=value.match(/data-scoped-editor="([^"]*)" data-scope-kind="([^"]*)" data-scope-id="([^"]*)" data-save-label="([^"]*)"/);
      footer=marker?{dataset:{scopedEditor:marker[1],scopeKind:marker[2],scopeId:marker[3],saveLabel:marker[4]},outerHTML:value}:null;
    },
    get writes(){return writes;},
    querySelector:selector=>selector==="[data-scoped-editor]"?footer:null,querySelectorAll:()=>[],
  };
}
function pageFixture() {
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Owner phone",mode:"fixed",destinations:["phone:owner"]};
  const settings={notification_definitions:definitions,monitoring_policies:[],timings:{},notifications:false,consumer:null};
  const main=contentHost(),status={},back={},nav={},focus={selection:[2,5],menu:{open:true}},restored=[];
  const card={
    page:"notifications",notificationSection:"methods",definitionSelection:{kind:"methods",id:"phone"},
    current:{status:"current",data:monitoringExample()},config:{view:"notifications"},
    configuration:{settings:structuredClone(settings),delivery_targets:[],notification_people:[]},
    settingsDraft:settings,main,renderedView:null,renderedCurrent:false,renderedContent:null,
    shadowRoot:{querySelector:selector=>({".workspace-status":status,".nav":nav,'[data-action="back"]':back}[selector]??null),querySelectorAll:()=>[]},
    navigation:{updateReturn(){}},viewIdentity:()=> "notifications",renderNotificationControl(){},
    capturePageState:()=>focus,restorePageState:state=>restored.push(state),observeSourceBranches(){},
  };
  return {card,main,status,focus,restored};
}

test("unchanged monitoring updates retain the notification editor and its DOM state",()=>{
  const {card,main}=pageFixture();
  prototype.renderPage.call(card);
  const draft=card.settingsDraft;
  assert.match(main.innerHTML,/Owner phone/);
  for(const updated_at of ["2026-10-14T21:00:00Z","2026-10-14T21:00:01Z"]) {
    card.current={status:"current",data:{...card.current.data,updated_at}};
    prototype.renderPage.call(card);
  }
  assert.equal(main.writes,1);
  assert.equal(card.settingsDraft,draft);
  card.settingsDraft.notification_definitions.methods.phone.name="Changed name";
  prototype.renderPage.call(card);
  assert.equal(main.writes,2);
  assert.match(main.innerHTML,/Changed name/);
});

test("reconnecting retains the page read-only and restores context after fresh data",()=>{
  const {card,main,status,focus,restored}=pageFixture();
  prototype.renderPage.call(card);
  card.current={...card.current,status:"disconnected"};
  prototype.renderPage.call(card);
  assert.equal(main.writes,1);
  assert.equal(main.inert,true);
  assert.equal(status.hidden,false);
  assert.match(status.textContent,/last completed update/);
  assert.doesNotMatch(main.innerHTML,/Loading dashboard/);
  card.current={...card.current,status:"loading"};
  prototype.renderPage.call(card);
  assert.equal(main.writes,1);
  card.current={...card.current,status:"current"};
  prototype.renderPage.call(card);
  assert.equal(main.inert,false);
  assert.equal(status.hidden,true);
  assert.deepEqual(restored,[focus]);
});

test("a remounted page uses its retained snapshot while initial and failed loads remain explicit",()=>{
  const {card,main,status}=pageFixture();
  card.current={...card.current,status:"loading"};
  prototype.renderPage.call(card);
  assert.match(main.innerHTML,/Owner phone/);
  assert.equal(main.inert,true);
  assert.equal(status.hidden,false);
  card.current={status:"loading",data:null};
  prototype.renderPage.call(card);
  assert.match(main.innerHTML,/Loading dashboard/);
  assert.equal(status.hidden,true);
  card.current={status:"error",data:null,error:"Subscription failed"};
  prototype.renderPage.call(card);
  assert.match(main.innerHTML,/Dashboard unavailable|Subscription failed/);
  assert.equal(main.inert,false);
});

function pendingMethod() {
  const fixture=pageFixture(),{card}=fixture;
  card.settingsDraft.notification_definitions.methods.phone.name="Edited phone";
  card.scopedBusy="method:phone";card.scopedStatusScope="method:phone";card.settingsBusy=true;
  prototype.renderPage.call(card);
  return fixture;
}

test("an external outage retains the exact pending editor until confirmed save and fresh monitoring",()=>{
  const {card,main,status}=pendingMethod(),draft=card.settingsDraft,current=card.current;
  assert.match(main.innerHTML,/Saving…/);
  card.current={status:"unavailable",data:{available:false}};
  prototype.renderPage.call(card);
  assert.equal(main.writes,1);
  assert.equal(main.inert,true);
  assert.equal(card.current.data.available,false);
  assert.equal(status.textContent,"Applying changes…");
  card.configuration.settings=structuredClone(draft);card.scopedBusy=null;card.settingsBusy=false;card.scopedNotice="Changes saved.";
  prototype.renderPage.call(card);
  assert.equal(main.writes,1);
  assert.equal(main.inert,true);
  assert.match(main.querySelector("[data-scoped-editor]").outerHTML,/Changes saved/);
  assert.doesNotMatch(main.querySelector("[data-scoped-editor]").outerHTML,/Saving…/);
  assert.equal(status.textContent,"Finishing update…");
  card.current=current;prototype.renderPage.call(card);
  assert.equal(main.inert,false);
  assert.equal(status.hidden,true);
  assert.equal(card.retainedSave,null);
  assert.equal(card.settingsDraft,draft);
  assert.match(main.innerHTML,/Changes saved/);
});

for(const state of ["unavailable","disconnected","loading","error"]) {
  test(`pending save retains its editor during ${state}, but failed settlement exposes the result`,()=>{
    const {card,main,status}=pendingMethod();
    card.current={status:state,data:{available:false},error:state==="error"?"Subscription failed":null};
    prototype.renderPage.call(card);
    assert.equal(main.writes,1);
    assert.equal(main.inert,true);
    assert.equal(status.hidden,false);
    card.scopedBusy=null;card.settingsBusy=false;card.scopedError="The save could not be confirmed; edits are retained.";
    prototype.renderPage.call(card);
    assert.equal(card.retainedSave,null);
    assert.equal(main.inert,false);
    assert.match(main.innerHTML,/The save could not be confirmed/);
    assert.doesNotMatch(main.innerHTML,/Saving…|Edited phone/);
    assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Edited phone");
    prototype.renderPage.call(card);
    assert.match(main.innerHTML,/The save could not be confirmed/);
  });
}

test("fresh monitoring never confirms a pending save",()=>{
  const {card,main}=pendingMethod(),current=card.current;
  card.current={status:"unavailable",data:{available:false}};prototype.renderPage.call(card);
  card.current=current;prototype.renderPage.call(card);
  assert.match(main.innerHTML,/Saving…/);
  assert.doesNotMatch(main.innerHTML,/Changes saved/);
  assert.equal(card.scopedBusy,"method:phone");
});

for(const change of ["different-editor","different-page","global-save"]) {
  test(`${change} cannot borrow another editor's pending-save retention`,()=>{
    const {card,main}=pendingMethod();
    if(change==="different-editor")card.definitionSelection={kind:"methods",id:"other"};
    if(change==="different-page")card.page="problems";
    if(change==="global-save")card.scopedBusy="notifications";
    card.current={status:"unavailable",data:{available:false}};prototype.renderPage.call(card);
    assert.match(main.innerHTML,/Monitoring unavailable/);
    assert.doesNotMatch(main.innerHTML,/Saving…/);
    assert.equal(card.retainedSave,null);
  });
}

test("a runtime error after confirmed save ends reload retention without erasing confirmation",()=>{
  const {card,main}=pendingMethod();
  card.current={status:"unavailable",data:{available:false}};prototype.renderPage.call(card);
  card.scopedBusy=null;card.settingsBusy=false;card.scopedNotice="Changes saved.";
  card.current={status:"unavailable",data:{available:false,error:"Storage unavailable"}};
  prototype.renderPage.call(card);
  assert.equal(card.retainedSave,null);
  assert.match(main.innerHTML,/Monitoring unavailable/);
  assert.match(main.innerHTML,/Changes saved/);
  assert.doesNotMatch(main.innerHTML,/Saving…/);
});

test("settings section history navigation ends retention even though save scope is shared",()=>{
  const {card,main}=pageFixture();
  card.page="configuration";card.settingsSection="timing";
  card.viewIdentity=()=>prototype.viewIdentity.call(card);
  card.render=()=>prototype.renderPage.call(card);
  card.dialog={close(){}};
  card.settingsDraft.timings.settle=600;
  card.scopedBusy="settings";card.scopedStatusScope="settings";card.settingsBusy=true;
  card.render();
  assert.match(main.innerHTML,/Save settings|Saving…/);
  card.current={status:"unavailable",data:{available:false}};card.render();
  assert.equal(card.renderedView,"configuration:timing");
  assert.equal(card.retainedSave.scope,"settings");
  const navigation=new WorkspaceNavigation(card);
  navigation.applyPath("/settings/grouping");
  assert.equal(card.settingsSection,"grouping");
  assert.equal(card.scopedBusy,"settings");
  assert.equal(card.retainedSave,null);
  assert.match(main.innerHTML,/Monitoring unavailable/);
  assert.doesNotMatch(main.innerHTML,/Saving…/);
});

test("unchanged issue details retain disclosures and exclude raw diagnostic controls",async()=>{
  const fixture=issueEvidenceFixture(),body=contentHost(),label={};
  const detail={
    current:{status:"current",data:fixture.data},detail:{episodeId:LYRIC_EPISODE},detailSequence:0,
    shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:label},
    displaySourceName:source=>source.name,tools:{detailButtons:()=>""},
    _hass:{localize:lyricLocalize,callWS:async()=>issueEvidenceReply(fixture,"homeostatic/node",LYRIC_ENTRY)},
  };
  await prototype.loadDetail.call(detail);
  assert.match(body.innerHTML,/Unavailable readings from 3 devices/);
  assert.doesNotMatch(body.innerHTML,/Technical details|Copy diagnostic|View raw data|data-copy-diagnostics|&quot;explanation&quot;/);
  assert.match(body.innerHTML,/Details from Home Assistant|View integration logs/);
  body.querySelectorAll=()=>[{dataset:{disclosure:"related-evidence"}}];
  await prototype.loadDetail.call(detail);
  assert.equal(body.writes,1);
  detail.current={...detail.current,status:"disconnected"};
  await prototype.loadDetail.call(detail);
  assert.equal(body.writes,1);
  assert.equal(body.inert,true);
  assert.match(label.textContent,/Last known/);
  detail.current={...detail.current,status:"current"};
  await prototype.loadDetail.call(detail);
  assert.equal(body.writes,1);
  assert.equal(body.inert,false);
});
