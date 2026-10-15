import test from "node:test";
import assert from "node:assert/strict";
import {recordedIssueSources, issueGroups,issuesWorkspace} from "../../custom_components/homeostatic/frontend/issues-workspace.mjs";
import {canonicalSources,canonicalSourceSelection,sourcesTree,sourcePaths,sourcesBrowser} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";

function fixture() {
  const data=monitoringExample();
  const entry=baseSource("entry:matter","Matter","integration",{entry_id:"matter",attributes:{domain:["matter"]}});
  const device=baseSource("device:table","Back Deck Table Light","device",{owner_id:"matter",attributes:{integration:["matter"],device:["table"]}});
  const light=baseSource("entity:table","Back Deck Table Light","entity",{owner_id:"matter",entity_id:"light.table",attributes:{integration:["matter"],device:["table"]}});
  const checks=[
    {...device,node_id:"monitoring:devices:device:table",name:"Back Deck Table Light · Device availability",monitoring_source:device.node_id,monitoring_policy:"devices",availability_entities:[light.entity_id],watched:true},
    {...light,node_id:"monitoring:entities:entity:table",name:"Back Deck Table Light · Entity availability",monitoring_source:light.node_id,monitoring_policy:"entities",watched:true},
    {...light,node_id:"monitoring:extra:entity:table",name:"Back Deck Table Light · Extra light",monitoring_source:light.node_id,monitoring_policy:"extra",watched:true},
  ];
  data.devices=[{id:"table",name:device.name,config_entry_id:"matter"}];
  data.inventory.nodes=[entry,device,light,...checks];
  data.inventory.catalog.candidates=[entry,device,light];
  data.inventory.episodes=checks.map((source,index)=>episode(`issue-${index}`,source.node_id));
  return data;
}

const episode=(id,anchor,recorded=[anchor])=>({episode_id:id,anchor,recorded,impact:[],reasons:[{node_id:anchor,status:"fail",message:"Home Assistant reports unavailable."}],importance:"normal",opened_at:"2026-10-14T10:00:00Z"});
const issueCard=data=>({current:{data},issueGroupsExpanded:new Set(),issueGroupLimits:new Map(),issueRow:(_,item)=>`<button data-episode="${item.episode_id}">${item.episode_id}</button>`});
const sourceCard=data=>({current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(),sourcesSelection:"source:entity:table",configuration:{monitoring_policy_version:1,settings:{monitoring_policies:[{id:"devices",name:"Device availability"},{id:"entities",name:"Entity availability"},{id:"extra",name:"Extra light"}]}},sourceDetail:{nodeId:"entity:table",members:[{node_id:"entity:table",entity_id:"light.table",name:"Back Deck Table Light",state:"unavailable"}]}});

test("investigation grouping keeps independent issue IDs and starts collapsed",()=>{
  const data=fixture(),groups=issueGroups(data),card=issueCard(data);
  assert.equal(groups.length,1);
  assert.equal(groups[0].name,"Matter");
  assert.deepEqual(groups[0].episodes.map(item=>item.episode_id),["issue-0","issue-1","issue-2"]);
  assert.equal(groups[0].devices.size,1);
  assert.equal(groups[0].entities.size,1);
  const closed=issuesWorkspace(card);
  assert.doesNotMatch(closed,/data-episode=/);
  assert.match(closed,/<h1>Open issues<\/h1><p class="page-description">Problems that need attention\.<\/p>/);
  assert.match(closed,/<span class="small">1 affected device<\/span><span class="issue-count">3 issues<\/span>/);
  card.issueGroupsExpanded.add("integration:matter");
  assert.equal((issuesWorkspace(card).match(/data-episode=/g)||[]).length,3);
  assert.doesNotMatch(issuesWorkspace(card),/Matter failed|integration failed/i);
});

test("a hundred independent eero issues remain reachable with explicit pagination",()=>{
  const data=fixture(),entry=baseSource("entry:eero","eero","integration",{entry_id:"eero",attributes:{domain:["eero"]}});
  data.inventory.nodes=[entry,...Array.from({length:100},(_,index)=>baseSource(`device:eero-${index}`,`Client ${index}`,"device",{watched:true,owner_id:"eero",attributes:{device:[`eero-${index}`],integration:["eero"]}}))];
  data.inventory.catalog.candidates=data.inventory.nodes;
  data.inventory.episodes=data.inventory.nodes.slice(1).map((source,index)=>({...episode(`client-${index}`,source.node_id),opened_at:new Date(Date.UTC(2026,9,14,0,index*5)).toISOString()}));
  const card=issueCard(data);card.issueGroupsExpanded.add("integration:eero");
  const initial=issuesWorkspace(card);
  assert.match(initial,/<span class="small">100 affected devices<\/span><span class="issue-count">100 issues<\/span>/);
  assert.match(initial,/Showing 40 of 100/);
  assert.equal((initial.match(/data-episode=/g)||[]).length,40);
  card.issueGroupLimits.set("integration:eero",120);
  const all=issuesWorkspace(card);
  assert.equal(new Set([...all.matchAll(/data-episode="([^"]+)"/g)].map(match=>match[1])).size,100);
  assert.doesNotMatch(all,/data-issue-more=/);
  card.issueQuery="Client 99";
  const match=issuesWorkspace(card);
  assert.match(match,/<span class="small">1 affected device<\/span><span class="issue-count">1 issue<\/span>/);
  assert.doesNotMatch(match,/100 devices/);
});

test("engine groups retain recorded members and do not count dependent impact as findings",()=>{
  const data=fixture();
  const more=baseSource("entity:remote","Unrelated impact","entity",{owner_id:"other",entity_id:"sensor.remote",attributes:{device:["remote"]}});
  data.inventory.nodes.push(more);
  data.inventory.episodes=[{...episode("grouped","entry:matter",["entry:matter","monitoring:devices:device:table","monitoring:entities:entity:table"]),impact:[more.node_id]}];
  const group=issueGroups(data)[0];
  assert.equal(group.episodes.length,1);
  assert.equal(group.devices.size,1);
  assert.equal(group.entities.size,1);
  const card=issueCard(data);card.issueGroupsExpanded.add(group.key);
  const html=issuesWorkspace(card);
  assert.match(html,/data-episode="grouped"/);
  assert.doesNotMatch(html,/data-source-link=|Recorded findings/);
  const details=recordedIssueSources(data,data.inventory.episodes[0]);
  assert.match(details,/data-source-link="entity:table"/);
  assert.match(details,/data-source-link="device:table"/);
  assert.doesNotMatch(html,/Unrelated impact/);
});

test("canonical source rows preserve check aliases and all policy contributions",()=>{
  const data=fixture(),tree=sourcesTree(data),paths=sourcePaths(tree),entity=paths.get("source:entity:table").node;
  assert.equal(canonicalSources(data).filter(source=>source.entity_id==="light.table").length,1);
  assert.equal(entity.name,"Back Deck Table Light");
  assert.equal(entity.source.monitoring_checks.length,2);
  assert.equal(paths.get("source:monitoring:entities:entity:table").node,entity);
  assert.equal(canonicalSourceSelection(tree,"source:monitoring:extra:entity:table"),"source:entity:table");
  const card=sourceCard(data),html=sourcesBrowser(card);
  assert.match(html,/<p class="config-path">Matter<\/p>/);
  assert.match(html,/id="sources-detail-title"[^>]*>Back Deck Table Light<\/h2>/);
  assert.doesNotMatch(html,/Entity ID: light.table/);
  assert.match(html,/Unavailable in Home Assistant/);
  assert.match(html,/Edit “Device availability” policy/);
  assert.match(html,/Edit “Entity availability” policy/);
  assert.match(html,/Edit “Extra light” policy/);
  assert.match(html,/Homeostatic monitors this entity’s availability\./);
  assert.doesNotMatch(html,/sources-views|Save changes|Separate check/);
  assert.doesNotMatch(html,/data-sources-view="history">View history<\/a>/);
  data.inventory.nodes=data.inventory.nodes.filter(source=>source.monitoring_policy!=="entities");
  const changed=sourcesBrowser(card);
  assert.doesNotMatch(changed,/Edit “Entity availability” policy/);
  assert.match(changed,/Edit “Extra light” policy/);
  assert.match(changed,/Unavailable in Home Assistant/);
});

test("entities without devices and automation checks remain reachable",()=>{
  const data=fixture();
  data.inventory.nodes.push(baseSource("entity:weather","Weather","entity",{entity_id:"sensor.weather"}),baseSource("automation:evening","Evening lights","broken_automation",{automation_url:"/config/automation/edit/evening"}));
  const paths=sourcePaths(sourcesTree(data));
  assert.ok(paths.has("source:entity:weather"));
  assert.equal(paths.get("source:automation:evening").parents[0].name,"Automations");
});

test("source evidence pagination keeps pending and failed reads actionable",()=>{
  const card=sourceCard(fixture());card.sourcesSelection="source:device:table";
  card.sourceDetail={nodeId:"device:table",members:[{node_id:"entity:table",name:"Light",state:"unavailable"}],total:80,next_offset:1,moreLoading:true};
  const pending=sourcesBrowser(card);
  assert.match(pending,/1 of 80 entity readings loaded/);
  assert.match(pending,/data-action="more-source-evidence" disabled>Loading entities/);
  card.sourceDetail.moreLoading=false;card.sourceDetail.moreError="Could not read more entities";
  const failed=sourcesBrowser(card);
  assert.match(failed,/data-action="more-source-evidence">Load more entities/);
  assert.match(failed,/role="alert">Could not read more entities/);
});

test("recovering-only queue stays clear and links to current source evidence",()=>{
  const data=fixture();data.inventory.nodes=[baseSource("entry:matter","Matter","integration",{entry_id:"matter",attributes:{domain:["matter"]},watched:true})];
  data.inventory.episodes=[episode("recovering","entry:matter")];
  data.inventory.episodes[0].reasons=[];
  data.inventory.integration_evidence={"entry:matter":{current:{reason:"loaded",status:"pass"}}};
  const html=issuesWorkspace(issueCard(data));
  assert.match(html,/No current issues/);
  assert.match(html,/data-page="sources"/);
  assert.doesNotMatch(html,/data-episode="recovering"/);
  assert.doesNotMatch(html,/No open problems|through History/);
});


test("newest is the default across groups and their issues, with explicit oldest and name choices",()=>{
  const data=fixture();
  const earlier=baseSource("entry:alpha","Alpha","integration",{entry_id:"alpha",attributes:{domain:["alpha"]}});
  data.inventory.nodes.push(earlier);
  data.inventory.episodes[0].opened_at="2026-10-14T12:00:00Z";
  data.inventory.episodes.push({...episode("earlier","entry:alpha"),opened_at:"2026-10-14T09:00:00Z"});
  const card=issueCard(data);card.issueGroupsExpanded=new Set(["integration:alpha","integration:matter"]);
  const newest=issuesWorkspace(card);
  assert.match(newest,/<option value="newest" selected>Newest first/);
  assert.ok(newest.indexOf('data-issue-group="integration:matter"')<newest.indexOf('data-issue-group="integration:alpha"'));
  assert.ok(newest.indexOf('data-episode="issue-0"')<newest.indexOf('data-episode="issue-1"'));
  card.issueSort="oldest";
  const oldest=issuesWorkspace(card);
  assert.ok(oldest.indexOf('data-issue-group="integration:alpha"')<oldest.indexOf('data-issue-group="integration:matter"'));
  assert.ok(oldest.indexOf('data-episode="issue-1"')<oldest.indexOf('data-episode="issue-0"'));
  card.issueSort="name";
  const names=issuesWorkspace(card);
  assert.ok(names.indexOf('data-issue-group="integration:alpha"')<names.indexOf('data-issue-group="integration:matter"'));
});
