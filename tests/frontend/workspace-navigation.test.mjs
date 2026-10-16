import test from "node:test";
import assert from "node:assert/strict";
import {hasWorkspaceDrafts,parseWorkspacePath,workspacePath,workspaceRoute,workspaceContext,restoreWorkspaceContext,WorkspaceNavigation} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";

for(const path of ["/issues","/sources","/sources/source%3Aentity%3Alight.deck","/sources/device%3Adeck/history","/episode/a%2Fb","/policies/availability","/notifications/methods/phone","/notifications/profiles/morning","/notifications/methods","/history","/history/closed","/settings/timing"])
  test(`round trip ${path}`,()=>assert.equal(workspacePath(parseWorkspacePath(path)),path));

test("retired grouping destinations normalize to Timing without restoring an obsolete section",()=>{
  assert.deepEqual(parseWorkspacePath("/settings/grouping"),{page:"configuration"});
  assert.equal(workspacePath(parseWorkspacePath("/settings/grouping")),"/settings/timing");
  assert.equal(workspacePath({page:"configuration",settingsSection:"grouping"}),"/settings/timing");
  const card={page:"configuration"};
  restoreWorkspaceContext(card,{settingsSection:"grouping"});
  assert.equal(card.settingsSection,undefined);
  assert.equal(Object.hasOwn(workspaceRoute(card),"settingsSection"),false);
});

test("older and malformed destinations open Issues",()=>{
  assert.equal(parseWorkspacePath("/overview").page,"problems");
  assert.equal(parseWorkspacePath("/episode/%ZZ").page,"problems");
  assert.equal(parseWorkspacePath("/homeostatic").page,"problems");
});

test("restoring investigation context preserves unrelated drafts",()=>{
  const draft={name:"Unsaved"},card={settingsDraft:draft,issueQuery:"Matter",issueGroupsExpanded:new Set(["matter"]),issueGroupLimits:new Map([["matter",40]]),sourcesExpanded:new Set(),sourcesLimits:new Map(),tools:{query:"removed",resolution:"removed",page:2}};
  const context=workspaceContext(card);
  card.issueQuery="";card.issueGroupsExpanded.clear();card.tools.page=0;
  restoreWorkspaceContext(card,context);
  assert.equal(card.settingsDraft,draft);assert.equal(card.issueQuery,"Matter");assert.deepEqual([...card.issueGroupsExpanded],["matter"]);assert.equal(card.tools.page,2);
});

test("contextual return reopens the originating issue without saving",()=>{
  globalThis.window={addEventListener(){},removeEventListener(){},location:{pathname:"/fixture"}};
  const card={page:"problems",detail:{episodeId:"one"},current:{status:"current"},isConnected:true,configuration:{},settingsDraft:{name:"Unfinished"},renderedCurrent:false,dialog:{close(){}},tools:{close(){}},render(){},openDetail(detail){this.detail=detail;},shadowRoot:{querySelector(){return null;}}};
  const nav=new WorkspaceNavigation(card),prior=nav.capture();
  card.page="policies";card.detail=null;card.definitionSelection={kind:"policies",id:"availability"};nav.finish(prior);
  assert.equal(card.workspaceReturn.label,"Back to issue");assert.equal(nav.back(),true);
  assert.equal(card.page,"problems");assert.equal(card.detail.episodeId,"one");assert.equal(card.settingsDraft.name,"Unfinished");
  delete globalThis.window;
});


test("reload protection covers unsaved settings and named notifications",()=>{
 const settings={notifications:false,notification_definitions:{profiles:{morning:{name:"Morning"}}}},card={configuration:{settings},settingsDraft:structuredClone(settings)};
 assert.equal(hasWorkspaceDrafts(card),false);
 card.settingsDraft.notifications=true;assert.equal(hasWorkspaceDrafts(card),true);
 card.settingsDraft=structuredClone(settings);card.settingsDraft.notification_definitions.profiles.morning.name="Daily morning";assert.equal(hasWorkspaceDrafts(card),true);
 card.settingsDraft=structuredClone(settings);assert.equal(hasWorkspaceDrafts(card),false);
});
test("retired notification policy links open the ordinary policy editor",()=>{
  assert.deepEqual(parseWorkspacePath("/notifications/policies/device"),{page:"policies",definition:{kind:"policies",id:"device"}});
  assert.equal(workspacePath(parseWorkspacePath("/notifications/policies/device")),"/policies/device");
  assert.deepEqual(parseWorkspacePath("/notifications/profiles/%ZZ"),{page:"notifications",notificationSection:"profiles",definition:null});
});

test("Back and Forward restore separate History and source contexts without changing drafts",()=>{
  globalThis.window={addEventListener(){},removeEventListener(){},location:{pathname:"/homeostatic"}};
  const draft={monitoring_policies:[{id:"lights",name:"Unsaved lights"}],notification_definitions:{methods:{phone:{name:"Unsaved phone"}}}};
  const card={page:"sources",sourcesSelection:"source:entity:light.deck",sourcesView:"source",sourcesQuery:"deck",sourcesGrouping:"integration",sourcesExpanded:new Set(["integration:mqtt"]),sourcesLimits:new Map(),current:{status:"current"},configuration:{},settingsDraft:draft,renderedCurrent:true,
    dialog:{close(){}},tools:{query:"",resolution:"",page:0,close(){this.historyId=null;}},render(){},revealSourcesSelection(){},
    capturePageState(){return {scroll:this.scroll};},restorePageState(value){this.scroll=value.scroll;},scroll:240,shadowRoot:{querySelector(){return null;}}};
  const nav=new WorkspaceNavigation(card),source=nav.capture();
  nav.applyPath("/history");
  card.tools.query="unavailable";card.tools.resolution="removed";card.tools.page=2;card.scroll=600;
  const history=nav.capture();
  nav.enabled=true;

  nav.onPop({state:{homeostatic:source}});
  assert.equal(card.page,"sources");
  assert.equal(card.sourcesSelection,"source:entity:light.deck");
  assert.equal(card.sourcesQuery,"deck");
  assert.deepEqual([...card.sourcesExpanded],["integration:mqtt"]);
  assert.equal(card.scroll,240);
  nav.onPop({state:{homeostatic:history}});
  assert.equal(card.page,"history");
  assert.deepEqual({query:card.tools.query,resolution:card.tools.resolution,page:card.tools.page},{query:"unavailable",resolution:"removed",page:2});
  assert.equal(card.scroll,600);
  assert.equal(card.settingsDraft,draft);
  assert.equal(card.settingsDraft.monitoring_policies[0].name,"Unsaved lights");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Unsaved phone");
  delete globalThis.window;
});

test("a retained History detail returns to the originating source",()=>{
  globalThis.window={addEventListener(){},removeEventListener(){},location:{pathname:"/fixture"}};
  const card={page:"sources",sourcesSelection:"source:entity:light.deck",sourcesView:"source",current:{status:"current"},configuration:{},renderedCurrent:false,dialog:{close(){}},tools:{close(){this.historyId=null;}},render(){},revealSourcesSelection(){},shadowRoot:{querySelector(){return null;}}};
  const nav=new WorkspaceNavigation(card),source=nav.capture();
  card.page="history";card.tools.historyId="ended-light";nav.finish(source);
  assert.equal(card.workspaceReturn.label,"Back to source");
  assert.equal(nav.back(),true);
  assert.equal(card.page,"sources");
  assert.equal(card.sourcesSelection,"source:entity:light.deck");
  assert.equal(card.tools.historyId,null);
  delete globalThis.window;
});

test("switching pages does not expose a return route for another page's retained editor",()=>{
  const selection={kind:"policies",id:"saved-policy"};
  const card={page:"notifications",definitionSelection:selection,sourcesExcludedOnly:true};
  assert.equal(workspaceRoute(card).definition,null);
  assert.equal(card.definitionSelection,selection);
  card.page="policies";
  assert.equal(workspaceRoute(card).definition,selection);
  const context=workspaceContext(card);
  card.sourcesExcludedOnly=false;
  restoreWorkspaceContext(card,context);
  assert.equal(card.sourcesExcludedOnly,true);
});
