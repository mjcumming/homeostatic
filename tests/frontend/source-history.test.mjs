import test from "node:test";
import assert from "node:assert/strict";
import {DashboardTools, RESOLUTIONS} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {sourceHistory} from "../../custom_components/homeostatic/frontend/source-history.mjs";
import {sourcesBrowser} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {sourceHistoryExample} from "./source-history-fixture.mjs";
import {baseSource} from "./monitoring-fixture.mjs";

test("source history keeps ended records concise with exact detail targets newest first",()=>{
  const data=sourceHistoryExample();
  const html=sourceHistory(data,data.inventory.nodes);
  assert.doesNotMatch(html,/Porch sensor|Still open|data-episode=/);
  assert.match(html,/garage relay entity as unavailable/);
  assert.match(html,/Garage relay before rename/);
  assert.match(html,/Cleared/);
  assert.doesNotMatch(html,/The monitored condition cleared/);
  assert.match(html,/Monitoring ended/);
  assert.match(html,/Joined another problem/);
  assert.doesNotMatch(html,/Recovery was not established|Recorded duration|<dl>/);
  assert.match(html,/7 hr 17 min/);
  assert.match(html,/datetime="2026-09-29T04:17:12Z"/);
  const timeline=html.slice(html.indexOf('<ol class="source-timeline">'));
  assert.deepEqual([...timeline.matchAll(/data-history="([^"]+)"/g)].map(match=>match[1]),["cleared","removed","absorbed"]);
  assert.match(html,/30 days, at most 100 ended problems across Homeostatic/);
  assert.match(html,/<details class="history-information"[^>]*><summary>History information<\/summary>/);
  assert.match(html,/Times record Homeostatic’s observations/);
  assert.doesNotMatch(html,/>cleared</);
  const tools=Object.assign(Object.create(DashboardTools.prototype),{query:"",resolution:"",page:0});
  const history=tools.historyPanel(data);
  assert.match(history,/100 ended problems within 30 days/);
  assert.match(history,/3 problems<\/span>/);
  assert.doesNotMatch(history,/\bepisodes?\b/i);
  assert.equal(RESOLUTIONS.absorbed[1],"This problem became part of another problem. Recovery was not established.");
});

test("integration history does not infer retained membership from today's hierarchy",()=>{
  const data=sourceHistoryExample();
  const html=sourcesBrowser({editors:{},current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:"source:entry:mqtt",sourcesView:"history"});
  assert.match(html,/porch temperature entity as unavailable/);
  assert.match(html,/data-episode="open"/);
  assert.doesNotMatch(html,/data-history="cleared"|data-history="removed"|data-history="absorbed"/);
  const garage=sourcesBrowser({editors:{},current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:"source:device:garage",sourcesView:"history"});
  assert.match(garage,/Garage relay before rename/);
  assert.match(garage,/data-history="cleared"/);
});

test("recorded parent and canonical identity survive removed checks and a different current parent",()=>{
  const data=sourceHistoryExample(),record=data.inventory.resolved_history.episodes[0];
  const canonical="entity:registry:child",anchor="monitoring:entities:previous:entity:registry:child";
  record.episode.anchor=anchor;
  record.source={node_id:anchor,name:"Original child · entities",kind:"entity",owner_id:"mqtt",monitoring_source:canonical,attributes:{integration:["mqtt"],device:["garage"]}};
  data.inventory.resolved_history.episodes=[record];
  data.inventory.nodes.push(baseSource("entry:other","Other connection","integration",{entry_id:"other",attributes:{domain:["other"]}}));
  const card={editors:{},current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(),sourcesView:"history"};
  for(const selection of ["source:entry:mqtt","source:device:garage"]){
    const html=sourcesBrowser({editors:{},...card,sourcesSelection:selection});
    assert.match(html,/data-history="removed"/);
    assert.match(html,/Original child · entities/);
  }
  data.inventory.nodes.push(baseSource(canonical,"Renamed child","entity",{owner_id:"other",attributes:{integration:["other"],device:["porch"]}}));
  assert.match(sourcesBrowser({editors:{},...card,sourcesSelection:`source:${canonical}`}),/data-history="removed"/);
  for(const selection of ["source:entry:other","source:device:porch"])
    assert.doesNotMatch(sourcesBrowser({editors:{},...card,sourcesSelection:selection}),/data-history="removed"/);
  assert.match(sourcesBrowser({editors:{},...card,sourcesSelection:"source:entry:mqtt"}),/Original child · entities/);
});

test("history is bounded to the selected source and does not replace historical findings with live state",()=>{
  const data=sourceHistoryExample();
  data.inventory.nodes[2].name="Renamed garage device";
  data.inventory.entity_status["device:garage"]={state:"on"};
  const html=sourceHistory(data,[data.inventory.nodes[2]]);
  assert.match(html,/Garage relay before rename/);
  assert.match(html,/reported the garage relay entity as unavailable/);
  assert.doesNotMatch(html,/Porch sensor|Renamed garage device|data-episode/);
});

test("missing history does not duplicate open issues or imply no prior problems",()=>{
  const data=sourceHistoryExample();
  delete data.inventory.resolved_history;
  const html=sourceHistory(data,data.inventory.nodes);
  assert.match(html,/Ended-problem history is unavailable/);
  assert.doesNotMatch(html,/data-episode=|No retained problems|History information/);
});

test("missing retained evidence and timestamps are explicit and unsafe text is escaped",()=>{
  const data=sourceHistoryExample(),record=data.inventory.resolved_history.episodes[0];
  record.episode.reasons=[{reason:"raw_internal_code"}];
  record.episode.opened_at="invalid";
  record.resolved_at="invalid";
  record.source.name='<img src=x onerror="alert(1)">';
  const html=sourceHistory(data,data.inventory.nodes);
  assert.match(html,/No readable finding was recorded/);
  assert.match(html,/Time not recorded/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|raw_internal_code|Invalid Date/);
});

test("source details keep the current issue separate from retained history and disclose coverage once",()=>{
  const data=sourceHistoryExample();
  for(const item of data.inventory.resolved_history.episodes)item.source.owner_id="mqtt";
  const card={editors:{},current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(),sourcesSelection:"source:entry:mqtt"};
  const compact=sourcesBrowser(card);
  assert.equal([...compact.matchAll(/data-episode="open"/g)].length,1);
  assert.doesNotMatch(compact,/data-history="cleared"|History information|Older child issues/);
  assert.match(compact,/data-sources-view="history">View history<\/a>/);
  card.sourcesView="history";
  const html=sourcesBrowser(card);
  assert.match(html,/data-sources-view="source">Close history<\/a>/);
  assert.equal([...html.matchAll(/data-episode="open"/g)].length,1);
  assert.equal([...html.matchAll(/data-history="cleared"/g)].length,1);
  assert.equal([...html.matchAll(/<summary>History information<\/summary>/g)].length,1);
  const information=html.slice(html.indexOf('<details class="history-information"'));
  assert.match(information,/Older child issues without recorded ownership/);
  assert.match(information,/data-page="history"/);
});

test("retained label fallback survives a missing source snapshot",()=>{
  const data=sourceHistoryExample();
  data.inventory.resolved_history.episodes[0].source=null;
  data.inventory.resolved_history.episodes[0].episode.labels.name="Old retained name";
  assert.match(sourceHistory(data,data.inventory.nodes),/Old retained name/);
});
