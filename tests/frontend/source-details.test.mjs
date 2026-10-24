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
const monitoring=html=>body(html);

function availabilityIssueFixture(states=["unavailable","unavailable","unavailable"]) {
  const card=sourceDetailsFixture("device",states),data=card.current.data;
  const sources=data.inventory.nodes.filter(source=>["device","entity"].includes(source.kind)&&!source.monitoring_policy);
  for(const source of data.inventory.nodes)if(["device","entity"].includes(source.kind))source.check_id="availability";
  data.inventory.episodes=sources.map((source,index)=>({episode_id:`availability-${index}`,anchor:source.node_id,recorded:[source.node_id],reasons:[{node_id:source.node_id,check_id:"availability",status:"warn",reason:source.kind==="device"?"all_unavailable":"unavailable"}],opened_at:UPDATED_AT,importance:"normal"}));
  return card;
}

test("device has one collective issue action and native entity links for three monitored members",()=>{
  const card=availabilityIssueFixture();
  card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
  const html=detail(card);
  assert.match(html,/0 of 3 entities available/);
  assert.equal((html.match(/data-device-issues="third-floor"/g)||[]).length,1);
  assert.match(html,/data-device-issues="third-floor"[^>]*>View<\/button>/);
  assert.equal((html.match(/href="\/developer-tools\/state\?entity_id=/g)||[]).length,3);
  assert.doesNotMatch(html,/>Unavailable<|source-entity-condition/);
  assert.doesNotMatch(html,/data-episode=|data-acknowledge|data-shelf|data-source-link=|<details\b|4 related issues/);
});

test("device keeps its single View after the aggregate clears and only one entity issue remains",()=>{
  const card=availabilityIssueFixture(["unavailable","72","49"]);
  card.current.data.inventory.episodes=card.current.data.inventory.episodes.filter(episode=>episode.anchor===ENTITY_ID);
  const html=detail(card);
  assert.match(html,/2 of 3 entities available/);
  assert.equal((html.match(/data-device-issues="third-floor"/g)||[]).length,1);
  assert.doesNotMatch(html,/data-episode=|data-acknowledge|data-shelf/);
});

test("device preserves unavailable evidence when no issue exists and offers no empty issue dialog",()=>{
  const html=detail(sourceDetailsFixture("device",["unavailable","missing","off"]));
  assert.match(html,/1 of 3 entities available/);
  assert.match(html,/>Unavailable<\/span>/);
  assert.match(html,/>No current state<\/span>/);
  assert.doesNotMatch(html,/data-device-issues=|data-episode=/);
});

test("device summary describes selected policy members without a separate inventory assessment",()=>{
  const card=sourceDetailsFixture("device",["unavailable","unavailable","unavailable"]);

  const html=detail(card);
  assert.match(html,/0 of 3 entities available/);
  assert.doesNotMatch(html,/source-entity-condition|source-device-member-state|>Unavailable</);
});

test("unavailable entity puts its condition, scoped action and one contextual policy action in view",()=>{
  const html=detail(sourceDetailsFixture("entity",["unavailable"]));
  assert.match(condition(html),/Home Assistant reports this entity as unavailable/);
  assert.match(html,/class="button" data-availability-action="stop"[^>]*>Stop Monitoring<\/button>/);
  assert.match(html,/data-source-policies="open"[^>]*>Monitoring policies<\/button>/);
  assert.doesNotMatch(html,/data-definition-id=|source-policy-dialog/);
  assert.doesNotMatch(html,/<dt>Availability<\/dt>|<dt>Monitoring<\/dt>|<summary>Details<\/summary>/);
  assert.doesNotMatch(html,/source-monitoring-explanation|source-issue-actions|source-technical|data-sources-view="history"/);
  assert.match(html,/data-action="back-sources">← Back to Monitoring<\/button>/);
});

test("short confirmation shows exact entities without repeating policy names",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  card.availabilityPlan=prepareAvailabilityChange(card,[ENTITY_ID]);card.availabilityContext=ENTITY_ID;
  const html=detail(card);
  assert.match(html,/class="button primary" data-availability-action="confirm"/);
  assert.doesNotMatch(html,/data-availability-action="stop"/);
  assert.doesNotMatch(html,/<li>Devices<\/li>|<li>Entities<\/li>/);
  assert.match(html,/<h3>Stop monitoring this entity\?<\/h3>/);
  assert.match(html,/data-availability-action="confirm"[^>]*>Stop Monitoring<\/button>/);
  assert.match(html,/Stop availability monitoring for this entity\. Other checks stay enabled\./);
  assert.doesNotMatch(html,/<details data-ui-key="availability-confirm-details"|<summary>Details<\/summary>/);
});

test("a save disables source monitoring controls until its result is known",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  card.availabilityPlan=prepareAvailabilityChange(card,[ENTITY_ID]);card.availabilityContext=ENTITY_ID;
  card.editors.scopedBusy="source-availability";
  const html=detail(card);
  assert.match(html,/data-availability-action="confirm"[^>]* disabled>Stopping monitoring…/);
  assert.match(html,/data-availability-action="cancel"[^>]* disabled>Cancel/);
});

test("an entity opens its related issue without exposing controls for the larger issue",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  card.current.data.inventory.attention_controls_supported=true;
  card.current.data.inventory.episodes=[{episode_id:"shared",anchor:"entry:lyric",recorded:["entry:lyric","monitoring:entities:"+ENTITY_ID],reasons:[{node_id:"monitoring:entities:"+ENTITY_ID,message:"Room temperature is unavailable",status:"warn",reason:"unavailable"}],opened_at:UPDATED_AT}];
  card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
  const html=detail(card);
  assert.match(html,/Home Assistant reports this entity as unavailable/);
  assert.match(html,/data-episode="shared"[^>]*>View issue<\/button>/);
  assert.match(html,/issue involving 2 sources/);
  assert.doesNotMatch(html,/data-acknowledge|data-shelf|whole issue headed by|source-issue-actions/);
});

test("device names and mixed current conditions stay visible before monitoring coverage",()=>{
  const card=sourceDetailsFixture("device",["unavailable","restored","72"]);
  const name="3rd Floor Sensor";
  for(const source of card.current.data.inventory.nodes.filter(source=>source.node_id===ENTITY_ID||source.monitoring_source===ENTITY_ID))source.name=name;
  card.sourceDetail.members[0].name=name;
  const html=detail(card),visible=html.split('<section class="source-section source-device-coverage"')[0];
  assert.match(visible,/>3rd Floor Sensor<\/a>[\s\S]*?Unavailable<\/span>/);
  assert.match(visible,/>3rd Floor Sensor Room humidity<\/a>[\s\S]*?Not provided by integration<\/span>/);
  assert.doesNotMatch(html,/Selected entity/);
  assert.doesNotMatch(html,/<details\b|source-technical/);
  assert.match(visible,/>3rd Floor Sensor Room average temperature<\/a>[\s\S]*?Available · 72 °F<\/span>/);
  assert.ok(html.indexOf("1 of 3 entities available")<html.indexOf("source-device-entities"));
  assert.ok(html.indexOf("source-device-entities")<html.indexOf("source-device-coverage"));
});

test("a wider integration issue keeps an exact link without response controls in device details",()=>{
  const card=sourceDetailsFixture("device",["unavailable"]);
  card.current.data.inventory.attention_controls_supported=true;
  card.current.data.inventory.episodes=[{episode_id:"shared",anchor:"entry:lyric",recorded:["entry:lyric","monitoring:entities:"+ENTITY_ID],reasons:[{node_id:"monitoring:entities:"+ENTITY_ID,message:"Room temperature is unavailable",status:"warn",reason:"unavailable"}],opened_at:UPDATED_AT}];
  card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
  const html=detail(card),visible=html.split('<details class="source-section source-monitoring-explanation"')[0];
  assert.match(visible,/data-episode="shared"/);
  assert.match(visible,/This device is part of an issue involving 2 sources/);
  assert.doesNotMatch(html,/data-device-issues|data-acknowledge|data-shelf|source-issue-actions|Actions for this issue|<details\b/);
});

test("integration connections are named directly without an additional disclosure or repeated count",()=>{
  const card=sourceDetailsFixture("device");
  const original=card.current.data.inventory.nodes.find(source=>source.kind==="integration");
  const second={...original,node_id:"entry:other",entry_id:"other",name:"Other connection"};
  card.current.data.inventory.nodes.push(second);
  card.current.data.inventory.catalog.candidates.push(second);
  card.sourcesSelection=JSON.stringify(["family","lyric"]);
  const html=detail(card);
  assert.match(html,/<h3>2 connections<\/h3>/);
  assert.match(html,/data-sources-select="source:entry:lyric"[^>]*><span>Lyric<\/span>/);
  assert.match(html,/data-sources-select="source:entry:other"[^>]*><span>Other connection<\/span>/);
  assert.doesNotMatch(html,/<details\b|Home Assistant connections/);
});

test("an integration inspector keeps one concise native action and its actual loaded condition",()=>{
  const card=sourceDetailsFixture();
  card.sourcesSelection="source:entry:lyric";
  card.sourceDetail={nodeId:"entry:lyric",integration_evidence:{current:{status:"pass",reason:"loaded"}}};
  const html=detail(card);
  assert.match(html,/<h3>Loaded<\/h3>/);
  assert.equal((html.match(/>Open integration<\/a>/g)||[]).length,1);
  assert.doesNotMatch(html,/Loaded in Home Assistant|Open integration in Home Assistant/);
});

test("automation reporting is readable within one Details section without another disclosure",()=>{
  const card=sourceDetailsFixture(),id="broken_automation:sample";
  const source={node_id:id,name:"Hall lighting",kind:"broken_automation",watched:true,automation_url:"/config/automation/edit/hall",alert_profile:"dashboard"};
  card.current.data.inventory.nodes.push(source);card.current.data.inventory.catalog.candidates.push(source);
  card.sourcesSelection=`source:${id}`;
  card.sourceDetail={nodeId:id,entity_status:{status:"pass",message:"No current problem reported"}};
  const html=detail(card);
  assert.equal((html.match(/<details\b/g)||[]).length,1);
  assert.match(html,/<summary>Details<\/summary>[\s\S]*<h3>Reporting<\/h3>/);
  assert.doesNotMatch(html,/Reporting preference/);
});

test("an excluded entity stays unavailable and has an explicit resume action",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  for(const policy of card.editors.configuration.settings.monitoring_policies)policy.excluded_sources=[ENTITY_ID];
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(item=>!item.monitoring_policy);
  card.availabilityContext=ENTITY_ID;
  const html=detail(card);
  assert.match(condition(html),/Home Assistant reports this entity as unavailable/);
  assert.match(html,/data-availability-action="resume"/);
  assert.doesNotMatch(html,/data-availability-action="stop"/);
  assert.doesNotMatch(html,/removed from availability monitoring\./);
  assert.doesNotMatch(html,/Undo|data-availability-action="undo"/);
});

test("excluded device members remain selectable for resumption without inventing readings",()=>{
  const card=sourceDetailsFixture("device",["unavailable"]);
  for(const policy of card.editors.configuration.settings.monitoring_policies)policy.excluded_sources=[ENTITY_ID];
  card.sourceDetail.members=[];card.sourceDetail.total=0;
  card.availabilitySelected={nodeId:DEVICE_ID,ids:new Set([ENTITY_ID])};
  const html=detail(card);
  assert.match(html,/entity with an availability exclusion/);
  assert.match(html,/data-availability-select="entity:third-floor-temperature" checked/);
  assert.match(html,/data-availability-action="resume-selected"/);
});

test("availability-exclusion filter retains source ancestors and hides unrelated entity rows",()=>{
  const card=sourceDetailsFixture("device",["unavailable","72"]);
  card.editors.configuration.settings.monitoring_policies[0].excluded_sources=[ENTITY_ID];
  card.sourcesExcludedOnly=true;
  const tree=sourcesBrowser(card).split('<section class="config-detail"')[0];
  assert.match(tree,/data-sources-select="source:entity:third-floor-temperature"/);
  assert.doesNotMatch(tree,/data-sources-select="source:entity:third-floor-humidity"/);
});

for(const enabled of [false,true]) {
  test("source filters keep "+(enabled?"active choices":"additional choices")+" in a native popover",()=>{
    const card=sourceDetailsFixture();
    card.sourcesShowDisabled=enabled;card.sourcesExcludedOnly=enabled;
    const settings=structuredClone(card.editors.configuration.settings),html=sourcesBrowser(card);
    assert.match(html,/popovertarget="sources-more-filters"/);
    assert.match(html,/id="sources-more-filters"[^>]*popover/);
    assert.match(html,/data-sources-disabled/);
    assert.match(html,/data-sources-excluded/);
    assert.match(html,enabled?/More filters \(2\)/:/More filters/);
    assert.doesNotMatch(html,/<details class="sources-filters"/);
    assert.equal((html.match(/data-sources-disabled[^>]* checked/g)||[]).length,Number(enabled));
    assert.equal((html.match(/data-sources-excluded[^>]* checked/g)||[]).length,Number(enabled));
    assert.deepEqual(card.editors.configuration.settings,settings);
  });
}

for(const kind of ["battery","vacuum","ups"]) {
  test(`${kind} source has one issue route and one contributing-policy route`,()=>{
    const card=sourceDetailsFixture("device",["72"]),id=`${kind}:sample`;
    const source={node_id:id,name:`Office ${kind}`,kind,check_id:kind==="ups"?"ups_power":"availability",watched:true,entity_id:`sensor.office_${kind}`,owner_id:"lyric",attributes:{device:["third-floor"],integration:["lyric"]}};
    card.current.data.inventory.nodes.push(source);card.current.data.inventory.catalog.candidates.push(source);
    card.current.data.inventory.episodes=[{episode_id:"condition",anchor:id,recorded:[id],reasons:[{node_id:id,check_id:source.check_id,status:"fail",reason:"unavailable",message:"Recorded condition"}],opened_at:UPDATED_AT}];
    card.sourcesSelection=`source:${id}`;
    card.sourceDetail={nodeId:id,members:[{name:"Battery reading",state:"10",restored:false}],monitoring_policies:[{id:"condition-policy",name:"Condition policy"}],battery_condition:{reason:"battery_low",status:"warn",message:"Battery level is 10%"},vacuum_activity:{reason:"vacuum_error",status:"fail",message:"Vacuum needs attention"},entity_status:{reason:"ups_on_battery",status:"warn",message:"Running on backup power",evidence:{power_mode:"backup",readings:{charge:90,runtime:30}}}};
    const html=detail(card);
    assert.equal([...html.matchAll(/data-episode="condition"/g)].length,1);
    assert.equal([...html.matchAll(/data-definition-id="condition-policy"/g)].length,1);
    assert.equal([...html.matchAll(/href="\/config\/devices\/device\/third-floor"/g)].length,1);
    assert.doesNotMatch(html,/Problem actions|View monitoring policies|Review the choice in Settings/);
    assert.match(html,/Recorded condition/);
  });
}

for(const grouping of ["integration","location","topomation"]) {
  test(`entity identity links known names independently of ${grouping} grouping`,()=>{
    const card=sourceDetailsFixture("entity");card.sourcesGrouping=grouping;
    card.current.data.floors=[{id:"upper",name:"Upper floor"}];
    card.current.data.areas=[{id:"landing",name:"Landing",floor_id:"upper"}];
    for(const source of [...card.current.data.inventory.nodes,...card.current.data.inventory.catalog.candidates])if(source.node_id===ENTITY_ID||source.monitoring_source===ENTITY_ID)source.attributes.area=["landing"];
    card.topomation={locations:[{id:"top-upper",name:"Upper floor"},{id:"top-landing",name:"Landing",parent_id:"top-upper",ha_area_id:"landing"}]};
    const html=detail(card),identity=heading(html);
    assert.match(identity,/data-source-open-entity="sensor.3rd_floor_sensor_room_temperature"[^>]*>Open entity<\/button>/);
    assert.match(identity,/>Entity<\//);
    assert.match(identity,/id="sources-detail-title"[^>]*>3rd Floor Sensor Room temperature<\/h2>/);
    assert.match(identity,/>Device<\//);
    assert.match(identity,/href="\/config\/devices\/device\/third-floor"[^>]*>3rd Floor Sensor<\/a>/);
    assert.match(identity,/>Integration<\//);
    assert.match(identity,/href="\/config\/integrations\/integration\/lyric#config_entry=lyric"[^>]*>Honeywell Lyric<\/a>/);
    assert.doesNotMatch(identity,/Go to integration page|Go to device page|View entity state/);
    if(grouping!=="integration")assert.match(identity,/<p class="config-path">Upper floor \/ Landing<\/p>/);
    assert.doesNotMatch(identity,/Unassigned|No area assigned/);
    assert.doesNotMatch(html,/Homeostatic updated|Entity ID:|source-technical/);
  });
}

test("entity opens its own dialog when neither device nor integration can be verified",()=>{
  const card=sourceDetailsFixture("entity");
  for(const source of [...card.current.data.inventory.nodes,...card.current.data.inventory.catalog.candidates]) {
    delete source.owner_id;
    delete source.attributes.integration;
    delete source.attributes.device;
  }
  card.current.data.devices=[];
  const html=detail(card);
  assert.match(heading(html),/data-source-open-entity="sensor.3rd_floor_sensor_room_temperature"[^>]*>Open entity<\/button>/);
  assert.doesNotMatch(heading(html),/>Device<\/|>Integration<\/|No area assigned|Unknown device|Unknown integration/);
});

test("device keeps one native destination and omits an unhelpful technical disclosure",()=>{
  const html=detail(sourceDetailsFixture("device"));
  assert.equal((html.match(/href="\/config\/devices\/device\/third-floor"/g)||[]).length,1);
  assert.match(html,/>Open device<\/a>/);
  assert.doesNotMatch(html,/source-technical|Homeostatic updated|<summary>Details|data-sources-view="history"/);
});

test("restored entity names its absent provider without registration machinery",()=>{
  const html=detail(sourceDetailsFixture("entity"));
  assert.match(condition(html),/Not currently provided by Honeywell Lyric/);
  assert.doesNotMatch(condition(html),/retain|register|Waiting for|Restored state|Current value:|integration is still loading/i);
});

test("restored device members do not masquerade as current unavailable reports",()=>{
  const html=detail(sourceDetailsFixture());
  assert.match(condition(html),/0 of 3 entities available/);
  assert.match(body(html),/Not provided by integration/);
  assert.doesNotMatch(condition(html),/3 of 3 monitored entities are unavailable/);
  assert.doesNotMatch(body(html),/Restored state|Waiting for a current/);
  assert.match(body(html),/href="\/developer-tools\/state\?entity_id=sensor\.3rd_floor_sensor_room_temperature"/);
  assert.doesNotMatch(body(html),/data-source-link|data-episode|data-device-issues/);
});

test("mixed current unavailability and restored placeholders stay separate",()=>{
  const html=detail(sourceDetailsFixture("device",["unavailable","restored","72"]));
  assert.match(condition(html),/1 of 3 entities available/);
  assert.match(body(html),/>Unavailable<\/span>/);
  assert.doesNotMatch(condition(html),/2 of 3 monitored entities are unavailable/);
  assert.match(body(html),/Not provided by integration/);
  assert.match(body(html),/72/);
});

test("HA unknown is an available entity with no value, not a review finding",()=>{
  const html=detail(sourceDetailsFixture("device",["unknown","72","49"]));
  assert.match(condition(html),/3 of 3 entities available/);
  assert.doesNotMatch(body(html),/Entities needing review|needs-attention/);
  assert.match(body(html),/Available[^<]*no value/i);
});

for(const [state,expected] of [["missing","No current state from Home Assistant"],["unavailable","Home Assistant reports this entity as unavailable"],["unknown","Home Assistant reports no value"],["72","Available in Home Assistant"]]) {
  test(`entity ${state} remains distinct from a restored placeholder`,()=>{
    const html=detail(sourceDetailsFixture("entity",[state]));
    assert.ok(condition(html).includes(expected));
    assert.doesNotMatch(condition(html),/Not currently provided|Waiting for/);
  });
}

test("a current entity displays its value and unit without a freshness claim",()=>{
  const html=detail(sourceDetailsFixture("entity",["72"]));
  assert.match(condition(html),/72 °F/);
  assert.doesNotMatch(condition(html),/<dt>Current value<\/dt>/);
  assert.doesNotMatch(condition(html),/last report|last seen|just updated/i);
});

test("an unmonitored entity has concise coverage and no empty policy dialog",()=>{
  const card=sourceDetailsFixture("entity");
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(source=>!source.monitoring_policy);
  const html=detail(card);
  assert.match(html,/Not monitored/);
  assert.doesNotMatch(html,/data-source-policies=|source-policy-dialog/);
});

test("temperature and availability retain their evidence with one entity destination",()=>{
  const card=sourceDetailsFixture("device",["unavailable"]);
  card.sourceDetail.temperature_checks=["Freezer limit","Overnight limit"].map((name,index)=>({node_id:`temperature:${index}`,source_id:ENTITY_ID,source_name:"3rd Floor Sensor Room temperature",policy_name:name,observation:{status:"warn",reason:"temperature_low",message:`Reading below ${name}`,evidence:{temperature_celsius:2,minimum:5,unit:"°C"}}}));
  const html=detail(card);
  assert.equal((html.match(/data-source-link="entity:third-floor-temperature"/g)||[]).length,1);
  assert.match(html,/Reading below Freezer limit/);
  assert.match(html,/Reading below Overnight limit/);
  assert.match(html,/href="\/developer-tools\/state\?entity_id=sensor\.3rd_floor_sensor_room_temperature"[^>]*>3rd Floor Sensor Room temperature<\/a>/);
  assert.doesNotMatch(html,/source-device-member-state[^>]*>Unavailable/);
});

test("integration maintenance appears once beside distinct issue controls",()=>{
  const card=sourceDetailsFixture();
  card.sourcesSelection="source:entry:lyric";
  card.sourceDetail={nodeId:"entry:lyric",integration_evidence:{current:{status:"fail",reason:"setup_error"}}};
  card.current.data.inventory.integration_evidence={"entry:lyric":card.sourceDetail.integration_evidence};
  card.current.data.inventory.attention_controls_supported=true;
  card.current.data.inventory.episodes=["first","second"].map(id=>({episode_id:id,anchor:"entry:lyric",recorded:["entry:lyric"],reasons:[{node_id:"entry:lyric",message:`Setup failure ${id}`,status:"fail",reason:"setup_error"}],opened_at:UPDATED_AT}));
  card.current.data.inventory.operator_controls=[{control_id:"integration-maintenance",action:"maintenance",target:"entry:lyric",until:"2026-10-17T00:00:00Z",include_dependents:false,reason:"Inspecting connection"},{control_id:"first-pause",action:"shelve",target:"first",until:"2026-10-17T00:00:00Z",include_dependents:false,reason:"Awaiting service"}];
  const saved=structuredClone(card.current.data.inventory.operator_controls);
  card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
  const html=detail(card);
  assert.equal((html.match(/data-cancel-control="integration-maintenance"/g)||[]).length,1);
  assert.equal((html.match(/data-cancel-control="first-pause"/g)||[]).length,1);
  assert.equal((html.match(/Inspecting connection/g)||[]).length,1);
  for(const id of ["first","second"])assert.match(html,new RegExp(`data-shelf="${id}"`));
  assert.deepEqual(card.current.data.inventory.operator_controls,saved);
});

for(const view of ["entity","device"]) {
  test(`disabled ${view} takes priority over retained placeholders`,()=>{
    const card=sourceDetailsFixture(view),selected=view==="entity"?ENTITY_ID:DEVICE_ID;
    card.current.data.inventory.nodes.filter(item=>item.node_id===selected||item.monitoring_source===selected).forEach(item=>item.disabled=true);
    card.sourcesShowDisabled=true;
    assert.match(condition(detail(card)),/Monitoring paused while disabled. Saved monitoring choices resume when re-enabled./);
    assert.match(condition(detail(card)),/Disabled in Home Assistant/);
    assert.doesNotMatch(condition(detail(card)),/Not currently provided|No current readings from/);
  });
  test(`${view} navigation remains available during an evidence read failure`,()=>{
    const card=sourceDetailsFixture(view);
    card.sourceDetail={nodeId:card.sourceDetail.nodeId,error:"Could not read Home Assistant"};
    const html=detail(card);
    assert.match(html,/href="\/(developer-tools\/state|config\/(devices\/device|integrations\/integration))/);
    assert.doesNotMatch(heading(html),/Homeostatic updated|Invalid Date/);
    assert.match(body(html),/role="alert">Could not read Home Assistant/);
    assert.match(body(html),/data-action="refresh-source"/);
  });
}

test("no selected device entities is not a healthy or failed assessment",()=>{
  const card=sourceDetailsFixture("device",[]);
  assert.match(condition(detail(card)),/No operational entities available to inspect/);
});

test("unmonitored device labels raw inspection without claiming monitoring",()=>{
  const card=sourceDetailsFixture("device",["unavailable","missing","off"]);
  card.current.data.inventory.nodes=card.current.data.inventory.nodes.filter(item=>!["devices","entities"].includes(item.monitoring_policy));
  const html=detail(card);
  assert.match(condition(html),/1 of 3 entities available/);
  assert.match(body(html),/source-monitoring-status"><strong>Not monitored<\/strong>/);
  assert.match(body(html),/>Unavailable<\/span>/);
  assert.match(body(html),/>No current state<\/span>/);
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
  assert.match(condition(html),/0 of 80 entities available/);
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
  assert.match(condition(detail(card)),/Not currently provided by its integration/);
});

test("previously selected source evidence cannot label the new source update time",()=>{
  const card=sourceDetailsFixture("entity");
  card.sourceDetail.nodeId=DEVICE_ID;
  const html=detail(card);
  assert.doesNotMatch(heading(html),/Homeostatic updated/);
  assert.match(body(html),/Reading current Home Assistant values/);
  assert.match(heading(html),/>Honeywell Lyric<\/a>/);
});

test("connectivity off remains an available value without a review finding",()=>{
  const card=sourceDetailsFixture("device",["off","72"]);
  card.sourceDetail.members[0].connectivity=true;
  const html=detail(card);
  assert.match(condition(html),/2 of 2 entities available/);
  assert.match(body(html),/>Available · off °F<\/span>/);
  assert.doesNotMatch(body(html),/Disconnected|Entities needing review|needs-attention/);
});


for(const view of ["entity","device"]) {
  test(`${view} source retains active maintenance controls without creation`,()=>{
    const card=sourceDetailsFixture(view),selected=view==="entity"?ENTITY_ID:DEVICE_ID;
    card.tools={detailButtons:(...args)=>DashboardTools.prototype.detailButtons.call({},...args)};
    card.current.data.inventory.attention_controls_supported=true;
    card.current.data.inventory.operator_controls=[{control_id:"saved-maintenance",action:"maintenance",target:selected,until:"2026-10-15T00:00:00Z",include_dependents:false,reason:"Synthetic maintenance"}];
    const html=detail(card);
    assert.doesNotMatch(html,/data-maintenance|Working on this equipment|Start maintenance/);
    assert.match(html,/Selected equipment only/);
    assert.match(html,/Synthetic maintenance/);
    assert.match(html,/data-cancel-control="saved-maintenance"/);
  });
}


test("ambiguous integration membership preserves a known device without inventing an integration destination",()=>{
  const card=sourceDetailsFixture("entity",["72"]);
  const original=card.current.data.inventory.nodes.find(source=>source.kind==="integration");
  const second={...original,node_id:"entry:other",entry_id:"other",name:"Other connection"};
  card.current.data.inventory.nodes.push(second);
  card.current.data.inventory.catalog.candidates.push(second);
  for(const source of [...card.current.data.inventory.nodes,...card.current.data.inventory.catalog.candidates].filter(source=>source.node_id===ENTITY_ID||source.monitoring_source===ENTITY_ID)) {
    delete source.owner_id;source.attributes.integration=["lyric","other"];
  }
  const html=detail(card);
  assert.match(heading(html),/href="\/config\/devices\/device\/third-floor"[^>]*>3rd Floor Sensor<\/a>/);
  assert.doesNotMatch(heading(html),/View entity state|\/config\/integrations\/integration\//);
});

test("explicit integration ownership resolves multiple membership hints",()=>{
  const card=sourceDetailsFixture("entity",["72"]);
  const original=card.current.data.inventory.nodes.find(source=>source.kind==="integration");
  const second={...original,node_id:"entry:other",entry_id:"other",name:"Other connection"};
  card.current.data.inventory.nodes.push(second);
  card.current.data.inventory.catalog.candidates.push(second);
  for(const source of [...card.current.data.inventory.nodes,...card.current.data.inventory.catalog.candidates].filter(source=>source.node_id===ENTITY_ID||source.monitoring_source===ENTITY_ID))source.attributes.integration=["lyric","other"];
  assert.match(heading(detail(card)),/lyric#config_entry=lyric/);
});


test("independent issues on one entity retain distinct escaped findings and exact destinations",()=>{
  const card=sourceDetailsFixture("entity",["unavailable"]);
  const availability=card.current.data.inventory.nodes.find(source=>source.monitoring_policy==="entities");
  const temperature={...availability,node_id:"monitoring:temperature:"+ENTITY_ID,kind:"temperature_limit",monitoring_policy:"temperature",check_id:"temperature_limit"};
  card.current.data.inventory.nodes.push(temperature);
  card.current.data.inventory.episodes=[
    {episode_id:"availability-issue",anchor:availability.node_id,recorded:[availability.node_id],reasons:[{node_id:availability.node_id,message:"Reading unavailable <source>",status:"warn",reason:"unavailable"}],opened_at:UPDATED_AT},
    {episode_id:"temperature-issue",anchor:temperature.node_id,recorded:[temperature.node_id],reasons:[{node_id:temperature.node_id,message:"Temperature is low & falling",status:"warn",reason:"temperature_low"}],opened_at:UPDATED_AT},
  ];
  const html=detail(card),rows=[...html.matchAll(/<div class="source-related-issue source-entity-issue">([\s\S]*?)<\/div>/g)].map(match=>match[1]);
  assert.equal(rows.length,2);
  const unavailable=rows.find(row=>row.includes('data-episode="availability-issue"'));
  const cold=rows.find(row=>row.includes('data-episode="temperature-issue"'));
  assert.match(unavailable,/<p>Reading unavailable &lt;source&gt;<\/p>/);
  assert.match(cold,/<p>Temperature is low &amp; falling<\/p>/);
  assert.doesNotMatch(unavailable,/Temperature is low|<source>/);
  assert.doesNotMatch(cold,/Reading unavailable|Temperature is low & falling/);
  assert.equal((html.match(/data-episode="availability-issue"/g)||[]).length,1);
  assert.equal((html.match(/data-episode="temperature-issue"/g)||[]).length,1);
  assert.doesNotMatch(rows.join(""),/data-acknowledge|data-shelf|An issue is open for this entity/);
});

test("entity details omit Open entity when its actual entity id is missing",()=>{
  const card=sourceDetailsFixture("entity");
  for(const source of [...card.current.data.inventory.nodes,...card.current.data.inventory.catalog.candidates])delete source.entity_id;
  assert.doesNotMatch(heading(detail(card)),/data-source-open-entity/);
});
