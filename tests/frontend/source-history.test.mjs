import test from "node:test";
import assert from "node:assert/strict";
import {sourceHistory} from "../../custom_components/homeostatic/frontend/source-history.mjs";
import {sourcesBrowser} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {sourceHistoryExample} from "./source-history-fixture.mjs";

test("MQTT history identifies evidence, outcomes, times and working detail targets newest first",()=>{
  const data=sourceHistoryExample();
  const html=sourcesBrowser({current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:"source:entry:mqtt",sourcesView:"history"});
  assert.match(html,/Porch sensor/);
  assert.match(html,/porch temperature entity as unavailable/);
  assert.match(html,/Garage relay before rename/);
  assert.match(html,/Cleared/);
  assert.doesNotMatch(html,/The monitored condition cleared/);
  assert.match(html,/Monitoring ended/);
  assert.match(html,/Joined another problem/);
  assert.match(html,/Recovery was not established/);
  assert.match(html,/Still open/);
  assert.match(html,/Recorded duration/);
  assert.match(html,/7h 17m/);
  assert.match(html,/datetime="2026-09-29T04:17:12Z"/);
  assert.deepEqual([...html.matchAll(/data-(?:history|episode)="([^"]+)"/g)].map(match=>match[1]),["cleared","removed","absorbed","open"]);
  assert.match(html,/30 days, at most 100 across Homeostatic/);
  assert.match(html,/not when a physical problem ended/);
  assert.doesNotMatch(html,/>cleared</);
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

test("missing history, evidence and timestamps are explicit and unsafe text is escaped",()=>{
  const data=sourceHistoryExample();
  delete data.inventory.resolved_history;
  data.inventory.episodes[0].reasons=[{reason:"raw_internal_code"}];
  data.inventory.episodes[0].opened_at="invalid";
  data.inventory.nodes[1].name='<img src=x onerror="alert(1)">';
  const html=sourceHistory(data,data.inventory.nodes);
  assert.match(html,/Ended-problem history is unavailable/);
  assert.match(html,/No readable finding was recorded/);
  assert.match(html,/Time not recorded/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|raw_internal_code|Invalid Date/);
});

test("retained label fallback survives a missing source snapshot",()=>{
  const data=sourceHistoryExample();
  data.inventory.resolved_history.episodes[0].source=null;
  data.inventory.resolved_history.episodes[0].episode.labels.name="Old retained name";
  assert.match(sourceHistory(data,data.inventory.nodes),/Old retained name/);
});
