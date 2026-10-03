import assert from "node:assert/strict";
import {test} from "node:test";
import {monitoringExample,baseSource} from "./monitoring-fixture.mjs";
import {monitoringScope,monitoringTree,scopeChoice,setScopeChoice} from "../../custom_components/homeostatic/frontend/configuration.mjs";
import {isAllVacuumPolicy, newAllVacuumPolicy} from "../../custom_components/homeostatic/frontend/monitoring-policies.mjs";
import {vacuumProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {sourceReporting} from "../../custom_components/homeostatic/frontend/reporting.mjs";

test("a vacuum is a reviewable source with its own check",()=>{
  const data=monitoringExample();
  const vacuum=baseSource("vacuum:registry:robot","Downstairs robot","vacuum",{
    entity_id:"vacuum.downstairs_robot",owner_id:"frigate",
    attributes:{kind:["vacuum"],device:["camera-0"],entity:["registry:robot"],area:["kitchen"]}});
  data.inventory.catalog.candidates.push(vacuum);
  const device=monitoringTree(data).find(group=>group.id==="frigate").devices.find(item=>item.id==="camera-0");
  assert.ok(device.entities.some(source=>source.node_id===vacuum.node_id));
  const scope=monitoringScope("vacuum",vacuum.node_id,vacuum);
  const rules=[{id:"availability",action:"attach",match:{kind:["entity"],entity:["registry:robot"]},checks:["availability"]}];
  assert.equal(scopeChoice(rules,scope),"inherit");
  assert.equal(setScopeChoice(rules,scope,"attach"),true);
  assert.equal(scopeChoice(rules,scope),"attach");
  assert.equal(rules[1].checks[0],"vacuum");
  assert.deepEqual(rules[1].match,{kind:["vacuum"],entity:["registry:robot"]});
  assert.equal(rules[0].checks[0],"availability");
});

test("monitor all vacuums drafts one broad vacuum check",()=>{
  const rules=[{id:"integration_availability",action:"attach",match:{kind:["integration"]},checks:["availability"]}];
  const drafted=newAllVacuumPolicy(rules);
  assert.equal(isAllVacuumPolicy(drafted),true);
  assert.equal(drafted.enabled,true);
  assert.deepEqual(drafted.checks,["vacuum"]);
  assert.equal(isAllVacuumPolicy({...drafted,checks:["availability"]}),false);
});

test("a vacuum error names the Home Assistant area",()=>{
  const source={kind:"vacuum",name:"Downstairs robot",attributes:{device:["robot"],area:["kitchen"]}};
  const areas=[{id:"kitchen",name:"Kitchen"}];
  const error=vacuumProblem(source,{current:{reason:"vacuum_error",message:"Home Assistant reports Downstairs robot in error in Kitchen."}},areas);
  assert.equal(error.headline,"Vacuum error in Kitchen");
  assert.equal(error.tone,"failure");
  assert.match(error.nextStep,/Check the vacuum in Home Assistant/);
  assert.equal(error.deviceUrl,"/config/devices/device/robot");
  const docked=vacuumProblem(source,{current:{reason:"docked"}},areas,true);
  assert.equal(docked.headline,"Vacuum error clearing");
  const unknown=vacuumProblem(source,{current:{reason:"vacuum_unknown"}},areas,true);
  assert.equal(unknown.headline,"Vacuum activity unknown");
  assert.equal(vacuumProblem({kind:"battery"},{},areas),null);
});

test("vacuum reporting inherits Immediate until a source preference is chosen",()=>{
  const reporting={timezone:"UTC",default:"weekly",people:{},profiles:{},assignments:{}};
  const card={settingsDraft:{reporting,notifications:false},configuration:{settings:{reporting}},current:{data:{inventory:{}}}};
  const html=sourceReporting(card,{source:{kind:"vacuum",node_id:"vacuum:registry:robot"}});
  assert.match(html,/Vacuum default — Immediate/);
  assert.match(html,/data-reporting-check="vacuum"/);
  assert.match(html,/Vacuum error/);
});
