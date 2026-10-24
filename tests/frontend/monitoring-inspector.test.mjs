import assert from "node:assert/strict";
import test from "node:test";
import {sourcesBrowser,sourcesTree,sourcePaths,filterSources,filterSourceMonitoring} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {sourceCoverageIndex} from "../../custom_components/homeostatic/frontend/source-coverage.mjs";
import {workspaceContext,restoreWorkspaceContext,parseWorkspacePath} from "../../custom_components/homeostatic/frontend/workspace-navigation.mjs";
import {sourceDetailsFixture,ENTITY_ID,DEVICE_ID} from "./source-details-fixture.mjs";

function fixture() {
  const card=sourceDetailsFixture("entity",["72","40","71","0"]);
  const rows=card.current.data.inventory.nodes;
  for(let n=rows.length-1;n>=0;n--)if(rows[n].monitoring_policy==="devices"&&![ENTITY_ID,"entity:third-floor-humidity"].includes(rows[n].monitoring_source))rows.splice(n,1);
  const temperature=rows.find(row=>row.node_id==="entity:third-floor-average");
  rows.push({...temperature,kind:"temperature_limit",node_id:"temperature:average",watched:true,monitoring_policy:"temperature",check_id:"temperature_limit"});
  card.sourcesMonitoring="all";
  return card;
}

const entityIds=tree=>[...new Set([...sourcePaths(tree).values()].filter(({node})=>node.source?.kind==="entity").map(({node})=>node.source.node_id))].sort();

test("the Monitoring tree omits repeated group types while keeping entity coverage",()=>{
  const card=fixture(),tree=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[0];
  assert.doesNotMatch(tree,/<small>(?:Integration|Device)<\/small>/);
  assert.match(tree,/<small>Monitored<\/small>/);
  assert.match(tree,/data-sources-toggle=/);
  assert.match(tree,/data-sources-select=/);
});

test("all monitoring states stay visible by default and filters preserve ancestors",()=>{
  const card=fixture(),data=card.current.data,tree=sourcesTree(data,"integration"),index=sourceCoverageIndex(data);
  assert.equal(filterSourceMonitoring(tree,"all",index),tree);
  assert.deepEqual(entityIds(tree),["entity:third-floor-3",ENTITY_ID,"entity:third-floor-average","entity:third-floor-humidity"].sort());
  const watched=filterSourceMonitoring(tree,"monitored",index),unwatched=filterSourceMonitoring(tree,"unmonitored",index);
  assert.deepEqual(entityIds(watched),[ENTITY_ID,"entity:third-floor-average","entity:third-floor-humidity"].sort());
  assert.deepEqual(entityIds(unwatched),["entity:third-floor-3"]);
  assert.ok(sourcePaths(unwatched).has(`source:${DEVICE_ID}`));
});

test("parent search cannot bring monitored siblings into the unmonitored filter",()=>{
  const card=fixture(),data=card.current.data,settings=JSON.stringify(card.editors.configuration);
  const filtered=filterSourceMonitoring(filterSources(sourcesTree(data,"integration"),"3rd Floor Sensor"),"unmonitored",sourceCoverageIndex(data));
  assert.deepEqual(entityIds(filtered),["entity:third-floor-3"]);
  assert.equal(JSON.stringify(card.editors.configuration),settings);
});

test("filter changes leave a selected source and its actions inspectable",()=>{
  const card=fixture();card.sourcesMonitoring="unmonitored";
  const html=sourcesBrowser(card),[tree,detail]=html.split('<section class="config-detail" aria-label="Selected source">');
  assert.doesNotMatch(tree,new RegExp(`data-sources-select="source:${ENTITY_ID}"`));
  assert.match(detail,/id="sources-detail-title"[^>]*>3rd Floor Sensor Room temperature/);
  assert.match(detail,/data-availability-action="stop"/);
  assert.match(tree,/<option value="unmonitored" selected>Not monitored/);
});

test("filter and selection context survive a trip to another page",()=>{
  const card=fixture();card.sourcesMonitoring="monitored";
  const context=workspaceContext(card);card.sourcesMonitoring="all";
  restoreWorkspaceContext(card,context);
  assert.equal(card.sourcesMonitoring,"monitored");
});

test("unmonitored entity states its condition and offers configuration without disclosures",()=>{
  const card=fixture(),id="entity:third-floor-3";
  card.sourcesSelection=`source:${id}`;
  card.sourceDetail={nodeId:id,members:[{node_id:id,state:"0",unit:"%",restored:false}],updated_at:"2026-10-15T12:00:00Z"};
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  assert.match(html,/source-monitoring-status[^>]*>Not monitored/);
  assert.doesNotMatch(html,/source-facts/);
  assert.match(html,/source-current-value[^>]*>0%<\/p>/);
  assert.match(html,/data-page="policies"[^>]*>Configure monitoring/);
  assert.doesNotMatch(html,/<summary>Details<\/summary>|data-sources-view="history"|source-technical/);
  assert.doesNotMatch(html,/No enabled policy|History for this source|<summary>Technical details/);
  assert.doesNotMatch(html,/<details[^>]* open/);
});

test("derived temperature coverage is visible even without entity availability",()=>{
  const card=fixture();card.sourcesSelection="source:entity:third-floor-average";
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  assert.match(html,/source-monitoring-status[^>]*>[^<]*temperature/i);
  assert.doesNotMatch(html,/No enabled policy/);
});

test("entity details state the condition once with native navigation near the name",()=>{
  const html=sourcesBrowser(sourceDetailsFixture("entity",["72","40","71"])).split('<section class="config-detail" aria-label="Selected source">')[1];
  const header=html.match(/<header class="source-heading">([\s\S]*?)<\/header>/)?.[1]||"";
  assert.match(header,/source-native-navigation/);
  assert.match(header,/href="\/config\/integrations\/integration/);
  assert.equal((html.match(/Available in Home Assistant/g)||[]).length,1);
  assert.doesNotMatch(html,/<dt>Availability<\/dt>|<dt>Monitoring<\/dt>|source-navigation/);
});

test("device details show availability, entity evidence and coverage without a fact grid",()=>{
  const html=sourcesBrowser(sourceDetailsFixture("device",["72","40","71"])).split('<section class="config-detail" aria-label="Selected source">')[1];
  assert.match(html,/3 of 3 entities available/);
  assert.match(html,/source-device-entities/);
  assert.match(html,/source-device-coverage/);
  assert.match(html,/href="\/config\/devices\/device/);
  assert.doesNotMatch(html,/source-facts|data-sources-view="history"|<details\b/);
});

test("entity path uses concise context without source-kind and repeated type labels",()=>{
  const card=sourceDetailsFixture("entity",["72"]);
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  const header=html.match(/<header class="source-heading">([\s\S]*?)<\/header>/)?.[1]||"";
  assert.match(header,/3rd Floor Sensor Room temperature/);
  assert.match(header,/Lyric/);
  assert.doesNotMatch(header,/Entity ·|Integration:|Connection:|Device:|Location:/);
});

test("unmonitored entity keeps reported unavailability separate from monitoring",()=>{
  const card=fixture(),id="entity:third-floor-3";
  card.sourcesSelection="source:"+id;
  card.sourceDetail={nodeId:id,members:[{node_id:id,state:"unavailable",restored:false}]};
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  assert.match(html,/source-entity-condition[^>]*>Home Assistant reports this entity as unavailable/);
  assert.match(html,/source-monitoring-status[^>]*>Not monitored/);
  assert.match(html,/data-page="policies"[^>]*>Configure monitoring/);
});


test("existing entity history links still show history and a return to the entity",()=>{
  const card=fixture();
  const route=parseWorkspacePath("/homeostatic/sources/"+encodeURIComponent(card.sourcesSelection)+"/history");
  assert.equal(route.sourcesView,"history");
  card.sourcesView=route.sourcesView;
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  assert.match(html,/id="source-history-title"/);
  assert.match(html,/data-sources-view="source"/);
});

test("toolbar filters precede the tree-only grouping and collapse controls",()=>{
  const html=sourcesBrowser(fixture());
  assert.ok(html.indexOf("data-sources-search")<html.indexOf("data-sources-monitoring"));
  assert.ok(html.indexOf("data-sources-monitoring")<html.indexOf("data-sources-filters"));
  assert.match(html,/Monitoring status/);
  const rail=html.split('<nav class="config-rail"')[1];
  assert.ok(rail,"Tree controls have their own rail");
  assert.match(rail,/source-tree-tools/);
  assert.match(rail,/data-sources-group/);
  assert.match(rail,/data-action="collapse-sources"[^>]*>Collapse groups<\/button>/);
});

for(const [name,expanded,query,disabled] of [
  ["all groups closed",[], "",true],
  ["a group expanded",["source:entry:lyric"],"",false],
  ["search results forced open",["source:entry:lyric"],"temperature",true],
])test("Collapse groups stays visible with "+name,()=>{
  const card=fixture();card.sourcesExpanded=new Set(expanded);card.sourcesQuery=query;
  const html=sourcesBrowser(card),button=html.match(/<button[^>]*data-action="collapse-sources"[^>]*>Collapse groups<\/button>/)?.[0];
  assert.ok(button);
  assert.equal(button.includes("disabled"),disabled);
});

test("filter choices and expansion survive navigation without changing settings",()=>{
  const card=fixture(),saved=structuredClone(card.editors.configuration.settings);
  Object.assign(card,{sourcesShowDisabled:true,sourcesExcludedOnly:true,sourcesMonitoring:"unmonitored"});
  const context=workspaceContext(card);
  Object.assign(card,{sourcesShowDisabled:false,sourcesExcludedOnly:false,sourcesMonitoring:"all",sourcesExpanded:new Set()});
  restoreWorkspaceContext(card,context);
  assert.equal(card.sourcesShowDisabled,true);
  assert.equal(card.sourcesExcludedOnly,true);
  assert.equal(card.sourcesMonitoring,"unmonitored");
  assert.deepEqual([...card.sourcesExpanded],context.sourcesExpanded);
  assert.match(sourcesBrowser(card),/More filters \(2\)/);
  assert.deepEqual(card.editors.configuration.settings,saved);
});


test("entity location context omits unassigned placeholders",()=>{
  const card=sourceDetailsFixture("entity",["72"]);card.sourcesGrouping="location";
  const html=sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
  const header=html.match(/<header class="source-heading">([\s\S]*?)<\/header>/)?.[1]||"";
  assert.match(header,/3rd Floor Sensor Room temperature/);
  assert.doesNotMatch(header,/Areas without a floor|No area assigned|Unassigned|Other sources/);
});
