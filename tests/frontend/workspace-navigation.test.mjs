import test from "node:test";
import assert from "node:assert/strict";
import {hasWorkspaceDrafts,parseWorkspacePath,workspacePath,workspaceContext,restoreWorkspaceContext,WorkspaceNavigation} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";

for(const path of ["/issues","/sources/source%3Aentity%3Alight.deck","/sources/device%3Adeck/history","/episode/a%2Fb","/policies/availability","/notifications/methods/phone","/notifications/profiles/morning","/notifications/methods","/history/closed","/settings/grouping"])
  test(`round trip ${path}`,()=>assert.equal(workspacePath(parseWorkspacePath(path)),path));

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
