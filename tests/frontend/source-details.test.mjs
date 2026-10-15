import assert from "node:assert/strict";
import test from "node:test";
import {DashboardTools} from "../../custom_components/homeostatic/frontend/history-controls.mjs";
import {sourcesBrowser} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {DEVICE_ID,ENTITY_ID,UPDATED_AT,sourceDetailsFixture} from "./source-details-fixture.mjs";
import {prepareAvailabilityChange} from "../../custom_components/homeostatic/frontend/source-monitoring.mjs";

const detail=card=>sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];
const heading=html=>html.match(/<header class="source-heading">([\s\S]*?)<\/header>/)?.[1]||"";
const body=html=>html.split('<div class="source-body">')[1];
const condition=html=>body(html).split('<section class="source-section">')[0];
const monitoring=html=>body(html).match(/<details class="source-section source-monitoring-explanation"[^>]*>([\s\S]*?)<\/details>/)?.[1]||"";

test("unavailable entity exposes a scoped stop before collapsed policy explanation",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]),html=detail(card);
  assert.match(condition(html),/Unavailable in Home Assistant/);
  assert.match(html,/data-availability-action="stop"/);
  assert.ok(html.indexOf('data-availability-action="stop"')<html.indexOf('source-monitoring-explanation'));
  assert.match(html,/<summary>Why this is monitored<\/summary>/);
  assert.doesNotMatch(html,/<details class="source-section source-monitoring-explanation"[^>]* open/);
});

test("confirmation names both policy contributions and keeps ordinary actions out of the way",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  card.availabilityPlan=prepareAvailabilityChange(card,[ENTITY_ID]);card.availabilityContext=ENTITY_ID;
  const html=detail(card);
  assert.match(html,/data-availability-action="confirm"/);
  assert.doesNotMatch(html,/data-availability-action="stop"/);
  assert.match(html,/<li>Devices<\/li>/);
  assert.match(html,/<li>Entities<\/li>/);
  assert.match(html,/Other checks and Home Assistant entities stay unchanged/);
});

test("source issue controls identify the entire correlated issue scope",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  card.current.data.inventory.attention_controls_supported=true;
  card.current.data.inventory.episodes=[{episode_id:"shared",anchor:"entry:lyric",recorded:["entry:lyric",`monitoring:entities:${ENTITY_ID}`],reasons:[{node_id:`monitoring:entities:${ENTITY_ID}`,message:"Room temperature is unavailable",status:"warn",reason:"unavailable"}],opened_at:UPDATED_AT}];
  card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
  const html=detail(card);
  assert.match(html,/Room temperature is unavailable/);
  assert.match(html,/whole issue headed by Lyric, involving 2 sources/);
  assert.match(html,/data-acknowledge="shared"/);
  assert.match(html,/data-shelf="shared"/);
  assert.doesNotMatch(html,/<details class="source-issue-actions"[^>]* open/);
});

test("an excluded entity stays unavailable and has an explicit resume action",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  for(const policy of card.configuration.settings.monitoring_policies)policy.excluded_sources=[ENTITY_ID];
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(item=>!item.monitoring_policy);
  const html=detail(card);
  assert.match(condition(html),/Unavailable in Home Assistant/);
  assert.match(html,/data-availability-action="resume"/);
  assert.doesNotMatch(html,/data-availability-action="stop"/);
});

test("excluded device members remain selectable for resumption without inventing readings",()=>{
  const card=sourceDetailsFixture("device",["unavailable"]);
  for(const policy of card.configuration.settings.monitoring_policies)policy.excluded_sources=[ENTITY_ID];
  card.sourceDetail.members=[];card.sourceDetail.total=0;
  card.availabilitySelected={nodeId:DEVICE_ID,ids:new Set([ENTITY_ID])};
  const html=detail(card);
  assert.match(html,/entity with an availability exclusion/);
  assert.match(html,/data-availability-select="entity:third-floor-temperature" checked/);
  assert.match(html,/data-availability-action="resume-selected"/);
});

test("availability-exclusion filter retains source ancestors and hides unrelated entity rows",()=>{
  const card=sourceDetailsFixture("device",["unavailable","72"]);
  card.configuration.settings.monitoring_policies[0].excluded_sources=[ENTITY_ID];
  card.sourcesExcludedOnly=true;
  const tree=sourcesBrowser(card).split('<section class="config-detail"')[0];
  assert.match(tree,/data-sources-select="source:entity:third-floor-temperature"/);
  assert.doesNotMatch(tree,/data-sources-select="source:entity:third-floor-humidity"/);
});

for(const [view,href] of [["entity","/developer-tools/state?entity_id=sensor.3rd_floor_sensor_room_temperature"],["device","/config/devices/device/third-floor"]]) {
  test(`${view} keeps actions visible and moves reconciliation time into technical details`,()=>{
    const html=detail(sourceDetailsFixture(view));
    assert.ok(body(html).includes(`href="${href}"`));
    assert.doesNotMatch(heading(html),/Homeostatic updated|Entity ID:/);
    assert.match(body(html),/<details class="source-section source-technical"[^>]*><summary>Technical details<\/summary>/);
    assert.ok(body(html).includes(new Date(UPDATED_AT).toLocaleString()));
    assert.match(body(html),/Homeostatic updated/);
    assert.ok(body(html).indexOf(`href="${href}"`)<body(html).indexOf('source-monitoring-explanation'));
  });
}

test("restored entity explains its retained registration and absent provider",()=>{
  const html=detail(sourceDetailsFixture("entity"));
  assert.match(condition(html),/No longer provided by Honeywell Lyric/);
  assert.match(condition(html),/Home Assistant.*retain|Home Assistant.*register/i);
  assert.match(condition(html),/integration.*(supplying|providing)|Lyric.*(supplying|providing)/i);
  assert.doesNotMatch(condition(html),/Waiting for|Restored state|Current value:|integration is still loading/);
});

test("restored device members do not masquerade as current unavailable reports",()=>{
  const html=detail(sourceDetailsFixture());
  assert.match(condition(html),/No current readings from 3 monitored entities/);
  assert.match(body(html),/Not provided by integration/);
  assert.doesNotMatch(condition(html),/3 of 3 monitored entities are unavailable/);
  assert.doesNotMatch(body(html),/Restored state|Waiting for a current/);
  assert.match(body(html),/data-source-link="entity:third-floor-temperature"/);
});

test("mixed current unavailability and restored placeholders stay separate",()=>{
  const html=detail(sourceDetailsFixture("device",["unavailable","restored","72"]));
  assert.match(condition(html),/1.*unavailable/);
  assert.match(condition(html),/1.*(current state|current reading|not provided|no current)/i);
  assert.doesNotMatch(condition(html),/2 of 3 monitored entities are unavailable/);
  assert.match(body(html),/Not provided by integration/);
  assert.match(body(html),/72/);
});

test("HA unknown is an available entity with no value, not a review finding",()=>{
  const html=detail(sourceDetailsFixture("device",["unknown","72","49"]));
  assert.match(condition(html),/Monitored entities are available/);
  assert.doesNotMatch(body(html),/Entities needing review|needs-attention/);
  assert.match(body(html),/Available[^<]*no value/i);
});

for(const [state,expected] of [["missing","No current Home Assistant state"],["unavailable","Unavailable in Home Assistant"],["unknown","Home Assistant reports no value"],["72","Available in Home Assistant"]]) {
  test(`entity ${state} remains distinct from a restored placeholder`,()=>{
    const html=detail(sourceDetailsFixture("entity",[state]));
    assert.ok(condition(html).includes(expected));
    assert.doesNotMatch(condition(html),/No longer provided|Waiting for/);
  });
}

test("a current entity displays its value and unit without a freshness claim",()=>{
  const html=detail(sourceDetailsFixture("entity",["72"]));
  assert.match(condition(html),/Current value: 72 °F/);
  assert.doesNotMatch(condition(html),/last report|last seen|just updated/i);
});

test("monitoring explains independent entity checks and the named device contribution",()=>{
  const html=monitoring(detail(sourceDetailsFixture("entity")));
  assert.match(html,/<strong>Entities<\/strong>/);
  assert.match(html,/(individually|own availability|individual.*availability)/i);
  assert.match(html,/<strong>Devices<\/strong>/);
  assert.match(html,/3rd Floor Sensor/);
  assert.match(html,/Uses this entity to assess 3rd Floor Sensor/);
  assert.match(html,/data-definition-id="entities"/);
  assert.match(html,/data-definition-id="devices"/);
});

test("device monitoring states what the selected entities assess",()=>{
  const html=monitoring(detail(sourceDetailsFixture("device")));
  assert.match(html,/(selected|monitored) entities/i);
  assert.match(html,/(assess|availability)/i);
});

for(const view of ["entity","device"]) {
  test(`disabled ${view} takes priority over retained placeholders`,()=>{
    const card=sourceDetailsFixture(view),selected=view==="entity"?ENTITY_ID:DEVICE_ID;
    card.current.data.inventory.nodes.filter(item=>item.node_id===selected||item.monitoring_source===selected).forEach(item=>item.disabled=true);
    card.sourcesShowDisabled=true;
    assert.match(condition(detail(card)),/Monitoring paused while disabled. Saved monitoring choices resume when re-enabled./);
    assert.match(condition(detail(card)),/Disabled in Home Assistant/);
    assert.doesNotMatch(condition(detail(card)),/No longer provided|No current readings from/);
  });
  test(`${view} navigation remains available during an evidence read failure`,()=>{
    const card=sourceDetailsFixture(view);
    card.sourceDetail={nodeId:card.sourceDetail.nodeId,error:"Could not read Home Assistant"};
    const html=detail(card);
    assert.match(body(html),/href="\/(developer-tools\/state|config\/devices\/device)/);
    assert.doesNotMatch(heading(html),/Homeostatic updated|Invalid Date/);
    assert.match(body(html),/role="alert">Could not read Home Assistant/);
    assert.match(body(html),/data-action="refresh-source"/);
  });
}

test("no selected device entities is not a healthy or failed assessment",()=>{
  const card=sourceDetailsFixture("device",[]);
  assert.match(condition(detail(card)),/No entities selected for device availability/);
});

test("unmonitored device labels raw inspection without claiming monitoring",()=>{
  const card=sourceDetailsFixture("device",["unavailable","missing","off"]);
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(item=>item.monitoring_policy!=="devices");
  const html=detail(card);
  assert.match(condition(html),/Device availability is not monitored/);
  assert.match(body(html),/Unavailable or missing entities/);
  assert.match(body(html),/1 other entity/);
  assert.doesNotMatch(body(html),/\d+ (?:other )?monitored entit|Entities needing review/);
});

test("complete source counts are retained when only the first page of readings is loaded",()=>{
  const card=sourceDetailsFixture();
  card.sourceDetail.members=card.sourceDetail.members.slice(0,1);
  card.sourceDetail.total=80;
  card.sourceDetail.unavailable_count=0;
  card.sourceDetail.unknown_count=80;
  card.sourceDetail.next_offset=1;
  const html=detail(card);
  assert.match(condition(html),/No current readings from 80 monitored entities/);
  assert.match(body(html),/1 of 80 entity readings loaded/);
  assert.match(body(html),/data-action="more-source-evidence"/);
});

test("restored entity without an identified integration uses an honest fallback",()=>{
  const card=sourceDetailsFixture("entity");
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(item=>item.kind!=="integration");
  card.current.data.inventory.catalog.candidates=card.current.data.inventory.catalog.candidates.filter(item=>item.kind!=="integration");
  for(const item of card.current.data.inventory.nodes) {
    delete item.owner_id;
    delete item.attributes.integration;
  }
  assert.match(condition(detail(card)),/No longer provided by its integration/);
});

test("previously selected source evidence cannot label the new source update time",()=>{
  const card=sourceDetailsFixture("entity");
  card.sourceDetail.nodeId=DEVICE_ID;
  const html=detail(card);
  assert.doesNotMatch(heading(html),/Homeostatic updated/);
  assert.match(body(html),/Reading current Home Assistant values/);
  assert.match(body(html),/View entity in Home Assistant/);
});

test("connectivity off remains an available value without a review finding",()=>{
  const card=sourceDetailsFixture("device",["off","72"]);
  card.sourceDetail.members[0].connectivity=true;
  const html=detail(card);
  assert.match(condition(html),/Monitored entities are available/);
  assert.match(body(html),/<td>off<\/td>/);
  assert.doesNotMatch(body(html),/Disconnected|Entities needing review|needs-attention/);
});


for(const view of ["entity","device"]) {
  test(`${view} source exposes only supported canonical maintenance scope`,()=>{
    const card=sourceDetailsFixture(view),selected=view==="entity"?ENTITY_ID:DEVICE_ID;
    card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
    card.current.data.inventory.attention_controls_supported=true;
    card.current.data.inventory.operator_controls=[{control_id:"saved-maintenance",action:"maintenance",target:selected,until:"2026-10-15T00:00:00Z",include_dependents:false,reason:"Synthetic maintenance"}];
    const html=detail(card);
    assert.equal(html.includes(`data-maintenance="${ENTITY_ID}"`),view==="entity");
    assert.doesNotMatch(html,/data-maintenance="monitoring:|data-maintenance="device:/);
    assert.match(html,/Selected equipment only/);
    assert.match(html,/Synthetic maintenance/);
    assert.match(html,/data-cancel-control="saved-maintenance"/);
  });
}
