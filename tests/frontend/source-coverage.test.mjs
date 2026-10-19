import assert from "node:assert/strict";
import test from "node:test";
import {sourceCoverageIndex,sourceCoverage,sourceCoveragePolicies} from "../../custom_components/homeostatic/frontend/source-coverage.mjs";

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

test("retired device checks cannot create entity coverage",()=>{
  const selected=entity("selected",{attributes:{device:["room"]}}),sibling=entity("sibling",{attributes:{device:["room"]}});
  const device={node_id:"device:room",kind:"device",check_id:"availability",monitoring_policy:"devices",watched:true,availability_entities:[selected.entity_id]};
  const index=sourceCoverageIndex(data([selected,sibling,device]));
  assert.deepEqual(sourceCoverage(selected,index),none);
  assert.deepEqual(sourceCoverage(sibling,index),none);
  assert.deepEqual(sourceCoverage(device,index),none);
  assert.deepEqual(sourceCoveragePolicies(selected,index),[]);
  assert.deepEqual(sourceCoveragePolicies(sibling,index),[]);
});

for(const [kind,label] of [["temperature_limit","Temperature"],["thermostat","Thermostat"],["vacuum","Vacuum"]]) {
  test(`${kind} coverage follows the real entity ID without requiring an availability alias`,()=>{
    const source=entity(kind),check={...source,node_id:`check:${kind}`,kind,check_id:kind,watched:true};
    assert.deepEqual(coverage(source,[source,check]),{monitored:true,direct:true,device:false,labels:[label]});
  });
}

test("battery coverage includes its warning and charging inputs without borrowing device membership",()=>{
  const level=entity("level"),warning=entity("warning"),charging=entity("charging"),unrelated=entity("other");
  const check={node_id:"check:battery",kind:"battery",check_id:"battery",monitoring_policy:"batteries",watched:true,entity_id:level.entity_id,battery_level_entity:level.entity_id,battery_warning_entity:warning.entity_id,battery_charging_entity:charging.entity_id};
  const index=sourceCoverageIndex(data([level,warning,charging,unrelated,check]));
  assert.deepEqual(sourceCoverage(level,index),{monitored:true,direct:true,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(warning,index),{monitored:true,direct:false,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(charging,index),{monitored:true,direct:false,device:false,labels:["Battery"]});
  assert.deepEqual(sourceCoverage(unrelated,index),none);
  for(const source of [level,warning,charging])assert.deepEqual(sourceCoveragePolicies(source,index),["batteries"]);
  assert.deepEqual(sourceCoveragePolicies(unrelated,index),[]);
});

test("UPS coverage uses explicit enabled inputs",()=>{
  const status=entity("status"),charge=entity("charge"),disabled=entity("runtime"),other=entity("other");
  const check={node_id:"check:ups",kind:"ups",check_id:"ups_reserve",monitoring_policy:"reserve",watched:true,entity_id:status.entity_id,ups_entities:[["status",status.entity_id],["charge",charge.entity_id],["runtime",disabled.entity_id]],ups_disabled_entities:[disabled.entity_id]};
  const index=sourceCoverageIndex(data([status,charge,disabled,other,check]));
  assert.deepEqual(sourceCoverage(status,index),{monitored:true,direct:true,device:false,labels:["UPS"]});
  assert.deepEqual(sourceCoverage(charge,index),{monitored:true,direct:false,device:false,labels:["UPS"]});
  assert.deepEqual(sourceCoverage(disabled,index),none);
  assert.deepEqual(sourceCoverage(other,index),none);
  assert.deepEqual(sourceCoveragePolicies(status,index),["reserve"]);
  assert.deepEqual(sourceCoveragePolicies(charge,index),["reserve"]);
  assert.deepEqual(sourceCoveragePolicies(disabled,index),[]);
  assert.deepEqual(sourceCoveragePolicies(other,index),[]);
});

test("disabled and unwatched checks cannot claim coverage",()=>{
  const source=entity("off"),unchecked={...source,node_id:"check:unchecked",monitoring_source:source.node_id,monitoring_policy:"unchecked"},disabled={...source,node_id:"check:disabled",monitoring_source:source.node_id,monitoring_policy:"disabled",watched:true,disabled:true};
  const index=sourceCoverageIndex(data([source,unchecked,disabled]));
  assert.deepEqual(sourceCoverage(source,index),none);
  assert.deepEqual(sourceCoveragePolicies(source,index),[]);
});

test("disabled entities remain uncovered even when a device still names their evidence",()=>{
  const source=entity("disabled",{disabled:true}),device={node_id:"device:room",kind:"device",watched:true,availability_entities:[source.entity_id]};
  const index=sourceCoverageIndex(data([source,device]));
  assert.deepEqual(sourceCoverage(source,index),none);
  assert.deepEqual(sourceCoveragePolicies(source,index),[]);
  assert.equal(index.byEntity.has(source.entity_id),false);
});

test("current inventory overrides a watched catalog candidate",()=>{
  const source=entity("removed");
  assert.deepEqual(coverage(source,[source],[{...source,watched:true}]),none);
});

test("overlapping and nested checks produce one stable set of coverage labels",()=>{
  const source=entity("mixed");
  const availability={...source,node_id:"check:availability",monitoring_source:source.node_id,monitoring_policy:"entities",watched:true};
  const temperature={...source,node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",monitoring_policy:{id:"temperature"},watched:true};
  const device={node_id:"device:room",kind:"device",monitoring_policy:"devices",watched:true,availability_entities:[source.entity_id]};
  const nested={...source,watched:true,monitoring_checks:[temperature,availability]};
  const index=sourceCoverageIndex(data([nested,device,temperature,availability]));
  assert.deepEqual(sourceCoverage(source,index),{monitored:true,direct:true,device:false,labels:["Availability","Temperature"]});
  assert.deepEqual(sourceCoveragePolicies(source,index),["entities","temperature"]);
  assert.deepEqual(sourceCoveragePolicies({...source,node_id:"alias:mixed",source_aliases:[source.node_id]},index),["entities","temperature"]);
});

test("disabled auxiliary inputs do not acquire battery or UPS policy coverage",()=>{
  const active=entity("active"),disabled=entity("disabled",{disabled:true});
  const battery={node_id:"check:battery",kind:"battery",monitoring_policy:"batteries",watched:true,entity_id:active.entity_id,battery_level_entity:active.entity_id,battery_warning_entity:disabled.entity_id,battery_charging_entity:disabled.entity_id};
  const ups={node_id:"check:ups",kind:"ups",monitoring_policy:"reserve",watched:true,entity_id:active.entity_id,ups_entities:[["status",active.entity_id],["charge",disabled.entity_id]]};
  const index=sourceCoverageIndex(data([active,disabled,battery,ups]));
  assert.deepEqual(sourceCoveragePolicies(active,index),["batteries","reserve"]);
  assert.deepEqual(sourceCoveragePolicies(disabled,index),[]);
  assert.equal(index.byEntity.has(disabled.entity_id),false);
});

test("device condition policies follow the same evidence association as coverage labels",()=>{
  const device={node_id:"device:room",kind:"device",attributes:{device:["room"]}};
  const check={...entity("temperature"),node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",monitoring_policy:"temperature",watched:true,attributes:{device:["room"]}};
  const input=data([device,check]),before=structuredClone(input),index=sourceCoverageIndex(input);
  assert.deepEqual(sourceCoveragePolicies(device,index),["temperature"]);
  assert.deepEqual(sourceCoverage(device,index),{monitored:true,direct:false,device:false,labels:["Temperature"]});
  assert.deepEqual(input,before);
});

test("a canonical record with only a temperature check does not invent availability coverage",()=>{
  const source=entity("temperature"),check={...source,node_id:"check:temperature",kind:"temperature_limit",check_id:"temperature_limit",watched:true};
  assert.deepEqual(coverage(source,[{...source,watched:true,monitoring_checks:[check]}]),{monitored:true,direct:true,device:false,labels:["Temperature"]});
});

test("missing inventory and an unselected source have no coverage",()=>{
  const index=sourceCoverageIndex({});
  assert.deepEqual(sourceCoverage(entity("unknown"),index),none);
  assert.deepEqual(sourceCoverage(null,index),none);
  assert.deepEqual(sourceCoveragePolicies(entity("unknown"),index),[]);
  assert.deepEqual(sourceCoveragePolicies(null,index),[]);
});

test("reported conditions retain their meaning when the source has a default availability check id",()=>{
  const source=entity("reported"),check={node_id:"situation:reported",kind:"situation",check_id:"availability",entity_id:source.entity_id,watched:true};
  assert.deepEqual(coverage(source,[source,check]),{monitored:true,direct:true,device:false,labels:["Reported condition"]});
});
