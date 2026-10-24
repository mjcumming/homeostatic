import assert from "node:assert/strict";
import {test} from "node:test";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
import {monitoringTree} from "../../custom_components/homeostatic/frontend/configuration.mjs";
import {batteryProblem, brokenAutomationProblem, repairProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {sourcesBrowser} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";

test("battery is a reviewable source with an independent check choice",()=>{
  const data=monitoringExample();
  const battery=baseSource("battery:registry:battery","Back Deck battery","battery",{
    entity_id:"sensor.back_deck_battery",owner_id:"frigate",
    attributes:{kind:["battery"],device:["camera-0"],entity:["registry:battery"]}});
  data.inventory.catalog.candidates.push(battery);
  const device=monitoringTree(data).find(group=>group.id==="frigate").devices.find(item=>item.id==="camera-0");
  assert.ok(device.entities.some(source=>source.node_id===battery.node_id));
});

test("battery copy describes charging clearance without asserting physical recovery",()=>{
  const source={kind:"battery",attributes:{device:["test-device"]}};
  const low=batteryProblem(source,{current:{reason:"battery_low"}});
  assert.match(low.nextStep,/Charge or replace/);
  assert.equal(low.deviceUrl,"/config/devices/device/test-device");
  const charging=batteryProblem(source,{current:{reason:"charging"}},false);
  assert.match(charging.summary,/low condition has cleared/);
  assert.doesNotMatch(charging.summary,/replaced|fully charged/);
});


test("a Home Assistant Repair is described from its recorded finding",()=>{
  assert.equal(repairProblem({kind:"battery"},[]),null);
  const open=repairProblem({kind:"repair"},[{status:"fail",message:"Automation reported this in Home Assistant Repairs (error)."}]);
  assert.equal(open.context,"Home Assistant Repair");
  assert.equal(open.headline,"Automation reported this in Home Assistant Repairs (error).");
  assert.match(open.nextStep,/Fix it in Home Assistant/);
  const ended=repairProblem({kind:"repair"},[{status:"pass",message:"Home Assistant no longer reports this Repair."}]);
  assert.equal(ended.nextStep,"No action needed.");
  assert.equal(repairProblem({kind:"repair"},null).headline,"Home Assistant reports this Repair.");
});

test("a broken automation is described from its recorded finding",()=>{
  assert.equal(brokenAutomationProblem({kind:"repair"},[]),null);
  const open=brokenAutomationProblem({kind:"broken_automation"},[{status:"fail",message:"This automation names light.missing, which no longer exists."}]);
  assert.equal(open.context,"Broken automation");
  assert.equal(open.headline,"This automation names light.missing, which no longer exists.");
  assert.match(open.nextStep,/Open the automation/);
  const ended=brokenAutomationProblem({kind:"broken_automation"},[{status:"pass",message:"This automation no longer names a missing entity."}]);
  assert.equal(ended.nextStep,"No action needed.");
});


test("Sources shows independent battery policy outcomes at 25 percent without a default verdict",()=>{
  const data=monitoringExample();
  const battery=baseSource("battery:registry:battery","Deck battery","battery",{entity_id:"sensor.deck_battery",attributes:{kind:["battery"],entity:["registry:battery"]},watched:false});
  data.inventory.catalog.candidates.push(battery);
  const card={editors:{},current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:`source:${battery.node_id}`,sourcesView:"source",sourceDetail:{nodeId:battery.node_id,battery_condition:null,battery_conditions:[
    {policy_id:"early",policy_name:"Early battery warning",condition:{status:"warn",reason:"battery_low",message:"Battery reads 25% under the 30% policy.",evidence:{battery_pct:25,threshold:30}}},
    {policy_id:"standard",policy_name:"Standard battery warning",condition:{status:"pass",reason:"battery_ok",message:"Battery reads 25% above the 20% policy.",evidence:{battery_pct:25,threshold:20}}},
  ],members:[{name:"Deck battery level",state:"25",restored:false}]}};
  const html=sourcesBrowser(card);
  assert.match(html,/<section class="source-condition needs-attention" data-battery-policy="early"><h3>Early battery warning<\/h3>/);
  assert.match(html,/<section class="source-condition" data-battery-policy="standard"><h3>Standard battery warning<\/h3>/);
  const primary=html.split('<details class="source-section source-monitoring-explanation"')[0];
  assert.match(primary,/Battery reads 25% under the 30% policy/);
  assert.doesNotMatch(primary,/Battery reads 25% above the 20% policy/);
  assert.match(html,/at or below 30%/);assert.match(html,/at or below 20%/);
  assert.match(html,/Battery reads 25% under the 30% policy/);assert.match(html,/Battery reads 25% above the 20% policy/);
  assert.match(html,/<dt>Battery reading<\/dt><dd>25<\/dd>/);
  assert.doesNotMatch(html,/<h3>No low battery reported|Battery monitoring is off|Battery condition unknown/);
  card.sourceDetail.battery_conditions=[];
  const unwatched=sourcesBrowser(card);assert.match(unwatched,/<dt>Monitoring<\/dt><dd><span>Not monitored<\/span>/);assert.match(unwatched,/<dt>Battery reading<\/dt><dd>25<\/dd>/);assert.doesNotMatch(unwatched,/No low battery reported/);
});

function batteryInspectorFixture(members) {
  const data=monitoringExample(),source=baseSource("battery:registry:battery","Deck battery","battery",{entity_id:"sensor.deck_battery",attributes:{kind:["battery"],device:["camera-0"],entity:["registry:battery"]}});
  data.inventory.catalog.candidates.push(source);
  return {current:{status:"current",data},editors:{configuration:{revision:"r1",settings:{monitoring_policies:[]}}},sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(),sourcesSelection:"source:"+source.node_id,sourceDetail:{nodeId:source.node_id,battery_condition:null,battery_conditions:[],members}};
}

const batteryDetail=card=>sourcesBrowser(card).split('<section class="config-detail" aria-label="Selected source">')[1];

for(const [state,expected] of [["25","25%"],["unavailable","Unavailable"],["unknown","No value reported"],["missing","No current state"]]) {
  test("single battery "+state+" is visible without a reading disclosure or repeated source name",()=>{
    const card=batteryInspectorFixture([{name:"Deck battery",state,unit:"%",restored:false}]);
    const html=batteryDetail(card),primary=html.split('<details class="source-section source-monitoring-explanation"')[0];
    const facts=html.match(/<dl class="source-facts">([\s\S]*?)<\/dl>/)?.[1]||"";
    assert.ok(facts.includes('<dt>Battery reading</dt><dd>'+expected+'</dd>'));
    assert.match(facts,/<dt>Monitoring<\/dt>[\s\S]*Not monitored/);
    assert.equal([...primary.matchAll(/Deck battery/g)].length,1);
    assert.doesNotMatch(primary,/Battery readings \(|No enabled battery policy|Charging can clear|<summary>/);
    assert.match(primary,/data-page="policies"[^>]*>Configure monitoring/);
    assert.match(html,/Charging can clear the low-battery condition/);
    assert.match(primary,/<(?:nav|div) class="source-navigation"/);
  });
}

test("paired battery readings stay individually identified and accessible",()=>{
  const card=batteryInspectorFixture([{name:"Battery percentage",state:"25",unit:"%",restored:false},{name:"Low battery signal",state:"off",restored:false}]);
  const primary=batteryDetail(card).split('<details class="source-section source-monitoring-explanation"')[0];
  assert.match(primary,/Battery percentage/);
  assert.match(primary,/Low battery signal/);
  assert.match(primary,/25%/);
  assert.match(primary,/off/);
  assert.doesNotMatch(primary,/<summary>Battery readings/);
});

test("battery navigation and retry remain visible when readings fail",()=>{
  const card=batteryInspectorFixture([]);
  card.sourceDetail.error="Could not read battery evidence";
  const html=batteryDetail(card);
  assert.match(html,/role="alert">Could not read battery evidence/);
  assert.match(html,/data-action="refresh-source"/);
  assert.match(html,/href="\/config\/devices\/device\/camera-0"/);
  assert.match(html,/data-sources-view="history"/);
  assert.match(html,/data-page="policies"[^>]*>Configure monitoring/);
  assert.doesNotMatch(html,/No low battery reported/);
});

test("restored and absent battery readings do not claim a current value",()=>{
  const card=batteryInspectorFixture([{name:"Deck battery",state:"25",unit:"%",restored:true}]);
  const restored=batteryDetail(card);
  assert.match(restored,/<dt>Battery reading<\/dt><dd>Not provided by integration<\/dd>/);
  assert.doesNotMatch(restored,/<dd>25%<\/dd>/);
  card.sourceDetail.members=[];
  const missing=batteryDetail(card);
  assert.match(missing,/<dt>Battery reading<\/dt><dd>No current state<\/dd>/);
  assert.doesNotMatch(missing,/No low battery reported/);
});

test("unknown battery policy evidence remains visible beside an ordinary reading",()=>{
  const card=batteryInspectorFixture([{name:"Deck battery",state:"25",unit:"%",restored:false}]);
  card.sourceDetail.battery_conditions=[{policy_id:"incomplete",policy_name:"Battery warning",condition:{status:"unknown",reason:"missing_evidence",message:"Low battery signal has no current state."}}];
  const primary=batteryDetail(card).split('<details class="source-section source-monitoring-explanation"')[0];
  assert.match(primary,/<dt>Battery reading<\/dt><dd>25%<\/dd>/);
  assert.match(primary,/Low battery signal has no current state/);
  assert.match(primary,/data-battery-policy="incomplete"/);
});
