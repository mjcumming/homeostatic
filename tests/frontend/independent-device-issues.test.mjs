import test from "node:test";
import assert from "node:assert/strict";
import {DashboardTools,historyAccount,historyPage,RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {selectedDeviceIssueIds} from "../../custom_components/homeostatic/frontend/device-issues.mjs";
import {independentDeviceIssuesFixture,independentDeviceReply,deviceNames} from "./independent-device-issues-fixture.mjs";

globalThis.HTMLElement=class {};
const elements=new Map();
globalThis.customElements={get:name=>elements.get(name),define:(name,value)=>elements.set(name,value)};
globalThis.window={};
await import("../../custom_components/homeostatic/frontend/homeostatic.js");
const prototype=elements.get("homeostatic-card").prototype;

async function detail(fixture,id) {
  const body={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>null},label={};
  const card={current:{status:"current",data:fixture.data},configuration:{settings:fixture.settings},detail:{episodeId:id},detailSequence:0,
    shadowRoot:{querySelector:selector=>selector===".dialog-body"?body:label},displaySourceName:source=>source.name,
    tools:{maintenanceControls:DashboardTools.prototype.maintenanceControls},capturePageState:()=>({}),restorePageState:()=>{},
    _hass:{user:{is_admin:true},states:{},localize:()=>"Matter",callWS:async request=>independentDeviceReply(fixture,request.node_id)}};
  Object.setPrototypeOf(card,prototype);
  await card.loadDetail();
  return {html:body.innerHTML,card};
}

/** The exact issue view offers the shared direct response for its own issue only. */
function assertExactResponse({html,card},id) {
  assert.ok(html.includes(`data-issue-response="${id}"`));
  assert.match(html,/data-device-response="acknowledge"[^>]*>Acknowledge</);
  assert.match(html,/data-device-response="pause"[^>]*>Pause</);
  assert.doesNotMatch(html,/data-device-issue-select/);
  assert.deepEqual(selectedDeviceIssueIds(card),[id]);
}

test("a light's independent issue shows only that device and targets only that issue",async()=>{
  const fixture=independentDeviceIssuesFixture(),opened=await detail(fixture,"issue:devices:deck"),{html}=opened;
  assert.match(html,/href="\/config\/devices\/device\/deck"/);
  for(const name of [deviceNames.hallway,deviceNames.mudroom,deviceNames.plug])assert.equal(html.includes(name),false);
  assertExactResponse(opened,"issue:devices:deck");
  assert.doesNotMatch(html,/4 devices|entire issue/);
  const queue=issuesWorkspace(Object.assign(Object.create(prototype),{current:{data:fixture.data},_hass:{localize:()=>"Matter"},issueQuery:"",issueSort:"name",issueGroupsExpanded:new Set(["integration:matter"]),issueGroupLimits:new Map()}));
  assert.doesNotMatch(queue,/data-episode=/);
  for(const id of Object.keys(deviceNames))assert.equal((queue.match(new RegExp(`data-device-issues="${id}"`,"g"))||[]).length,1);
  for(const episode of fixture.episodes)assert.ok(queue.includes(`data-ui-key="issue:${episode.episode_id}"`));
});

test("an overlapping policy on one device remains separately actionable",async()=>{
  const fixture=independentDeviceIssuesFixture(),opened=await detail(fixture,"issue:deck-extra:deck");
  assertExactResponse(opened,"issue:deck-extra:deck");
  assert.match(opened.html,/data-definition-id="deck-extra"/);
});

test("a failed integration retains one issue with all affected devices",async()=>{
  const fixture=independentDeviceIssuesFixture({integrationFailed:true}),opened=await detail(fixture,"matter-outage");
  for(const name of Object.values(deviceNames))assert.ok(opened.html.includes(name),name);
  assertExactResponse(opened,"matter-outage");
});

function historyHtml(fixture) {
  return DashboardTools.prototype.historyPanel.call({query:"",resolution:"",page:0,historyId:fixture.split.episode.episode_id,historyNote:()=>"Retained history"},fixture.data);
}

test("split history describes continuing issues, links open and retained names, and identifies missing successors",()=>{
  const fixture=independentDeviceIssuesFixture();
  const retained=fixture.data.inventory.episodes.splice(2,1)[0];
  fixture.data.inventory.resolved_history.episodes.push({episode:retained,source:{name:deviceNames.hallway},resolution:"cleared",resolved_at:"2026-10-16T19:00:00Z"});
  fixture.data.inventory.episodes.pop();
  fixture.split.split_into.push(fixture.split.split_into[0]);
  const html=historyHtml(fixture);
  assert.equal(RESOLUTIONS.split[0],"Issues separated");
  assert.match(html,/The problems were separated into individual issues\. Recovery was not established\./);
  assert.match(html,/data-open-episode="issue:devices:deck">Open issue: Back Deck Table Light · Device availability/);
  assert.match(html,/data-open-episode="issue:deck-extra:deck">Open issue: Back Deck Table Light · Deck availability/);
  assert.match(html,/data-history="issue:devices:hallway">View history: Front Hallway/);
  assert.match(html,/1 separated issue is no longer available/);
  assert.equal((html.match(/data-open-episode="issue:devices:deck"/g)||[]).length,1);
  assert.equal(historyPage(fixture.data.inventory.resolved_history,"","split").total,1);
  assert.doesNotMatch(historyAccount(fixture.split).join(" "),/cleared|recovered/i);
});

test("missing split references and unsafe saved names remain explicit escaped text",()=>{
  const fixture=independentDeviceIssuesFixture();
  fixture.data.inventory.nodes.find(source=>source.node_id===fixture.episodes[0].anchor).name='<img src=x onerror="fail()">';
  const html=historyHtml(fixture);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
  fixture.split.split_into=[];
  assert.match(historyHtml(fixture),/The separate issues were not recorded/);
});
