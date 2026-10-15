import assert from "node:assert/strict";
import test from "node:test";
import {sourceCoverageIndex,sourceCoverage} from "../../custom_components/homeostatic/frontend/source-coverage.mjs";

const entity=(id,fields={})=>({node_id:`entity:${id}`,entity_id:`sensor.${id}`,name:id,kind:"entity",watched:false,...fields});
const data=(nodes,candidates=[])=>({inventory:{nodes,catalog:{candidates}}});
const coverage=(source,nodes,candidates=[])=>sourceCoverage(source,sourceCoverageIndex(data(nodes,candidates)));
const none={monitored:false,direct:false,device:false,labels:[]};

test("direct availability checks cover canonical entity identity without changing source records",()=>{
  const source=entity("temperature"),check={...source,node_id:"check:availability",monitoring_source:source.node_id,check_id:"availability",watched:true};
  const input=data([source,check]),before=structuredClone(input);
  assert.deepEqual(sourceCoverage(source,sourceCoverageIndex(input)),{monitored:true,direct:true,device:false,labels:["Availability"]});
  assert.deepEqual(input,before);
});

test("device-only coverage names selected evidence without covering unrelated siblings",()=>{
  const selected=entity("selected",{attributes:{device:["room"]}}),sibling=entity("sibling",{attributes:{device:["room"]}});
  const device={node_id:"device:room",kind:"device",check_id:"availability",watched:true,availability_entities:[selected.entity_id]};
  const index=sourceCoverageIndex(data([selected,sibling,device]));
  assert.deepEqual(sourceCoverage(selected,index),{monitored:true,direct:false,device:true,labels:["Device availability"]});
  assert.deepEqual(sourceCoverage(sibling,index),none);
  assert.deepEqual(sourceCoverage(device,index),{monitored:true,direct:true,device:false,labels:["Device availability"]});
});

for(const [kind,label] of [["temperature_limit","Temperature"],["thermostat","Thermostat"],["vacuum","Vacuum"]]) {
  test(`${kind} coverage follows the real entity ID without requiring an availability alias`,()=>{
    const source=entity(kind),check={...source,node_id:`check:${kind}`,kind,check_id:kind,watched:true};
    assert.deepEqual(coverage(source,[source,check]),{monitored:true,direct:true,device:false,labels:[label]});
  });
}

test("battery coverage includes its warning and charging inputs without borrowing device membership",()=>{
  const level=entity("level"),warning=entity("warning"),charging=entity("charging"),unrelated=entity("other");
  const check={node_id:"check:battery",kind:"battery",check_id:"battery",watched:true,entity_id:level.entity_id,battery_level_entity:level.entity_id,battery_warning_entity:warning.entity_id,battery_charging_entity:charging.entity_id};
  const index=sourceCoverageIndex(data([level,warning,charging,unrelated,check]));
  assert.deepEqual(sourceCoverage(level,index),{monitored:true,direct:true,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(warning,index),{monitored:true,direct:false,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(charging,index),{monitored:true,direct:false,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(unrelated,index),none);
});

test("UPS coverage uses explicit enabled inputs",()=>{
  const status=entity("status"),charge=entity("charge"),disabled=entity("runtime"),other=entity("other");
  const check={node_id:"check:ups",kind:"ups",check_id:"ups_reserve",watched:true,entity_id:status.entity_id,ups_entities:[["status",status.entity_id],["charge",charge.entity_id],["runtime",disabled.entity_id]],ups_disabled_entities:[disabled.entity_id]};
  const index=sourceCoverageIndex(data([status,charge,disabled,other,check]));
  assert.deepEqual(sourceCoverage(status,index),{monitored:true,direct:true,device:false,labels:["UPS"]});
  assert.deepEqual(sourceCoverage(charge,index),{monitored:true,direct:false,device:false,labels:["UPS"]});
  assert.deepEqual(sourceCoverage(disabled,index),none);
  assert.deepEqual(sourceCoverage(other,index),none);
});

test("disabled and unwatched checks cannot claim coverage",()=>{
  const source=entity("off"),unchecked={...source,node_id:"check:unchecked",monitoring_source:source.node_id},disabled={...source,node_id:"check:disabled",monitoring_source:source.node_id,watched:true,disabled:true};
  assert.deepEqual(coverage(source,[source,unchecked,disabled]),none);
});

test("disabled entities remain uncovered even when a device still names their evidence",()=>{
  const source=entity("disabled",{disabled:true}),device={node_id:"device:room",kind:"device",watched:true,availability_entities:[source.entity_id]};
  const index=sourceCoverageIndex(data([source,device]));
  assert.deepEqual(sourceCoverage(source,index),none);
  assert.equal(index.byEntity.has(source.entity_id),false);
});

test("current inventory overrides a watched catalog candidate",()=>{
  const source=entity("removed");
  assert.deepEqual(coverage(source,[source],[{...source,watched:true}]),none);
});

test("overlapping and nested checks produce one stable set of coverage labels",()=>{
  const source=entity("mixed");
  const availability={...source,node_id:"check:availability",monitoring_source:source.node_id,watched:true};
  const temperature={...source,node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",watched:true};
  const device={node_id:"device:room",kind:"device",watched:true,availability_entities:[source.entity_id]};
  const nested={...source,watched:true,monitoring_checks:[temperature,availability]};
  assert.deepEqual(coverage(source,[nested,device,temperature,availability]),{monitored:true,direct:true,device:true,labels:["Availability","Device availability","Temperature"]});
});

test("a canonical record with only a temperature check does not invent availability coverage",()=>{
  const source=entity("temperature"),check={...source,node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",watched:true};
  assert.deepEqual(coverage(source,[{...source,watched:true,monitoring_checks:[check]}]),{monitored:true,direct:true,device:false,labels:["Temperature"]});
});

test("missing inventory and an unselected source have no coverage",()=>{
  const index=sourceCoverageIndex({});
  assert.deepEqual(sourceCoverage(entity("unknown"),index),none);
  assert.deepEqual(sourceCoverage(null,index),none);
});

test("reported conditions retain their meaning when the source has a default availability check id",()=>{
  const source=entity("reported"),check={node_id:"situation:reported",kind:"situation",check_id:"availability",entity_id:source.entity_id,watched:true};
  assert.deepEqual(coverage(source,[source,check]),{monitored:true,direct:true,device:false,labels:["Reported condition"]});
});
