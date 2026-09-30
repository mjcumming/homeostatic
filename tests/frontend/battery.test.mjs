import assert from "node:assert/strict";
import {test} from "node:test";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
import {monitoringScope,monitoringTree,scopeChoice,setScopeChoice} from "../../custom_components/homeostatic/frontend/configuration.mjs";
import {batteryProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {sourceReporting} from "../../custom_components/homeostatic/frontend/reporting.mjs";

test("battery is a reviewable source with an independent check choice",()=>{
  const data=monitoringExample();
  const battery=baseSource("battery:registry:battery","Back Deck battery","battery",{
    entity_id:"sensor.back_deck_battery",owner_id:"frigate",
    attributes:{kind:["battery"],device:["camera-0"],entity:["registry:battery"]}});
  data.inventory.catalog.candidates.push(battery);
  const device=monitoringTree(data).find(group=>group.id==="frigate").devices.find(item=>item.id==="camera-0");
  assert.ok(device.entities.some(source=>source.node_id===battery.node_id));
  const scope=monitoringScope("battery",battery.node_id,battery);
  const rules=[{id:"availability",action:"attach",match:scope.match,checks:["availability"]}];
  assert.equal(scopeChoice(rules,scope),"inherit");
  assert.equal(setScopeChoice(rules,scope,"attach"),true);
  assert.equal(scopeChoice(rules,scope),"attach");
  assert.equal(rules[1].checks[0],"battery");
  assert.equal(rules[0].checks[0],"availability");
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

test("battery reporting offers its own condition exception",()=>{
  const reporting={timezone:"UTC",default:"weekly",people:{},profiles:{},assignments:{}};
  const card={settingsDraft:{reporting,notifications:false},configuration:{settings:{reporting}},current:{data:{inventory:{}}}};
  const html=sourceReporting(card,{source:{kind:"battery",node_id:"battery:registry:battery"}});
  assert.match(html,/data-reporting-check="battery"/);
  assert.match(html,/Battery condition/);
});
