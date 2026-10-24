import test from "node:test";
import assert from "node:assert/strict";
import {parseWorkspacePath,workspacePath,workspaceRoute,WorkspaceNavigation} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";
import {issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";

const reference="a".repeat(32), path=`/notification/${reference}`;
function card(callWS) {
  const c={current:{status:"current"},isConnected:true,_hass:{callWS},tools:{close(){}},dialog:{close(){}},render(){},opened:[],openDetail(value){this.opened.push(value);}};
  c.navigation=new WorkspaceNavigation(c);return c;
}
test("short scope round trips with an exact issue and never expands its URL",()=>{
  for(const value of [path,`${path}/episode/a%2Fb`])assert.equal(workspacePath(parseWorkspacePath(value)),value);
  const c=card();c.page="problems";c.notificationReference=reference;c.notificationIssueIds=["a/b"];
  assert.equal(workspacePath(workspaceRoute(c)),path);
});
test("cold start reads all pages before revealing included issues and opens only a member",async()=>{
  let release;const first=new Promise(resolve=>{release=resolve;});const calls=[];
  const c=card(async query=>{calls.push(query);if(query.offset===0)return first;return {status:"available",reference,total:3,episodes:["three"],next_offset:null};});
  c.navigation.applyPath(`${path}/episode/two`);
  assert.deepEqual(c.notificationIssueIds,[]);assert.deepEqual(c.opened,[]);
  assert.match(issuesWorkspace(c),/Loading the issues/);
  release({status:"available",reference,total:3,episodes:["one","two"],next_offset:2});
  await c.navigation.reportRequest;
  assert.deepEqual(c.notificationIssueIds,["one","two","three"]);assert.deepEqual(c.opened,[{episodeId:"two"}]);
  assert.deepEqual(calls.map(q=>q.offset),[0,2]);assert.ok(calls.every(q=>q.type==="homeostatic/notification_report"));
  c.navigation.applyPath(`${path}/episode/unrelated`);await c.navigation.reportRequest;assert.equal(c.opened.length,1);
});
test("navigation cancels late results; reconnect reloads membership",async()=>{
  let release;const c=card(()=>new Promise(resolve=>{release=resolve;}));
  c.navigation.applyPath(path);const pending=c.navigation.reportRequest;
  c.navigation.applyPath("/issues");release({status:"available",reference,total:1,episodes:["old"],next_offset:null});await pending;
  assert.equal(c.notificationIssueIds,null);assert.equal(c.notificationReference,null);
  c._hass.callWS=async()=>({status:"available",reference,total:1,episodes:["member"],next_offset:null});
  c.navigation.applyPath(path);await c.navigation.reportRequest;assert.deepEqual(c.notificationIssueIds,["member"]);
  c.navigation.invalidateNotificationReport();assert.deepEqual(c.notificationIssueIds,[]);
  await c.navigation.loadNotificationReport();assert.deepEqual(c.notificationIssueIds,["member"]);
});
for(const status of ["expired","error","invalid","incomplete"]){
  test(`${status} scope stays explicit and never displays unrelated issues`,async()=>{
    const c=card(async()=>{if(status==="error")throw Error("Offline");return status==="incomplete" ? {status:"available",reference,total:2,episodes:["one"],next_offset:null} : {status:"expired"};});
    c.navigation.applyPath(status==="invalid"?"/notification/bad":path);await c.navigation.reportRequest;
    assert.deepEqual(c.notificationIssueIds,[]);
    const html=issuesWorkspace(c);assert.match(html,/Show all open issues/);assert.doesNotMatch(html,/No included issues are still open/);
    assert.match(html,status==="error"||status==="incomplete"?/could not be loaded/:/expired or is no longer available/);
  });
}
