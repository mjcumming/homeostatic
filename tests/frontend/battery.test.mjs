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
  const card={current:{data},sourcesGrouping:"integration",sourcesQuery:"",sourcesNeedsReview:false,sourcesExpanded:new Set(),sourcesSelection:`source:${battery.node_id}`,sourcesView:"source",sourceDetail:{nodeId:battery.node_id,battery_condition:null,battery_conditions:[
    {policy_id:"early",policy_name:"Early battery warning",condition:{status:"warn",reason:"battery_low",message:"Battery reads 25% under the 30% policy.",evidence:{battery_pct:25,threshold:30}}},
    {policy_id:"standard",policy_name:"Standard battery warning",condition:{status:"pass",reason:"battery_ok",message:"Battery reads 25% above the 20% policy.",evidence:{battery_pct:25,threshold:20}}},
  ],members:[{name:"Deck battery level",state:"25",restored:false}]}};
  const html=sourcesBrowser(card);
  assert.match(html,/<section class="source-condition needs-attention" data-battery-policy="early"><h3>Early battery warning<\/h3><h4>Battery low<\/h4>/);
  assert.match(html,/<section class="source-condition" data-battery-policy="standard"><h3>Standard battery warning<\/h3><h4>No low battery reported<\/h4>/);
  assert.match(html,/at or below 30%/);assert.match(html,/at or below 20%/);
  assert.match(html,/Battery reads 25% under the 30% policy/);assert.match(html,/Battery reads 25% above the 20% policy/);
  assert.match(html,/Deck battery level<\/td><td>25/);
  assert.doesNotMatch(html,/<h3>No low battery reported|Battery monitoring is off|Battery condition unknown/);
  card.sourceDetail.battery_conditions=[];
  const unwatched=sourcesBrowser(card);assert.match(unwatched,/No enabled battery policy/);assert.match(unwatched,/Deck battery level/);assert.doesNotMatch(unwatched,/No low battery reported/);
});
