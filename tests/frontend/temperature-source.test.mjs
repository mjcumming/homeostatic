import assert from "node:assert/strict";
import test from "node:test";
import {canonicalSources,sourcesTree,sourcePaths,sourcesBrowser,canonicalSourceSelection} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {sourceCoverage,sourceCoverageIndex} from "../../custom_components/homeostatic/frontend/source-coverage.mjs";
import {DEVICE_ID,ENTITY_ID} from "./source-details-fixture.mjs";
import {temperatureFixture} from "./temperature-source-fixture.mjs";
import {sourceTemperature} from "../../custom_components/homeostatic/frontend/source-temperature.mjs";


for(const grouping of ["integration","location","topomation"])test(grouping+" puts independent temperature checks on the sensor without another row",()=>{
  const card=temperatureFixture(),data=card.current.data,before=structuredClone(data);
  const topology={locations:[{id:"room",name:"Room",entity_ids:[data.inventory.nodes.find(row=>row.node_id===ENTITY_ID).entity_id]}]};
  const tree=sourcesTree(data,grouping,null,topology),paths=sourcePaths(tree);
  assert.equal(paths.get("source:temperature:home").node.key,"source:"+ENTITY_ID);
  assert.equal(canonicalSourceSelection(tree,"source:temperature:home"),"source:"+ENTITY_ID);
  assert.ok(!tree.some(node=>node.key==="other-checks"));
  const sensor=canonicalSources(data).find(row=>row.node_id===ENTITY_ID);
  assert.equal(sensor.kind,"entity");
  assert.equal(sensor.monitoring_checks.filter(check=>check.kind==="temperature_limit").length,1);
  assert.deepEqual(data,before);
});

for(const view of ["device","entity"])test(view+" shows the temperature policy and pending condition above Details",()=>{
  const card=temperatureFixture(view),html=sourcesBrowser(card).split('aria-label="Selected source">')[1];
  const visible=html.split('<summary>Details</summary>')[0];
  assert.match(visible,/Home Interior Temperature Monitoring/);
  assert.match(visible,/Waiting/);
  assert.match(visible,/68 °F/);
  assert.match(visible,/80 °F/);
  assert.match(visible,/1 hour/);
  assert.doesNotMatch(visible,/Current check passed/);
  assert.match(html,/data-definition-id="home-temperature"/);
});

test("temperature-only device coverage does not invent device availability",()=>{
  const card=temperatureFixture(),data=card.current.data;
  data.inventory.nodes=data.inventory.nodes.filter(row=>!['devices','entities'].includes(row.monitoring_policy));
  const device=data.inventory.nodes.find(row=>row.node_id===DEVICE_ID);
  assert.deepEqual(sourceCoverage(device,sourceCoverageIndex(data)).labels,["Temperature"]);
});

test("overlapping temperature policies remain distinct on one sensor",()=>{
  const card=temperatureFixture(),data=card.current.data;
  data.inventory.nodes.push({...data.inventory.nodes.at(-1),node_id:"temperature:second",monitoring_policy:"second"});
  const sensor=canonicalSources(data).find(row=>row.node_id===ENTITY_ID);
  assert.deepEqual(sensor.monitoring_checks.filter(check=>check.kind==="temperature_limit").map(check=>check.node_id),["temperature:home","temperature:second"]);
});

for(const [name,observation,expected] of [
  ["missing observation",null,"Waiting for a temperature reading"],
  ["missing evidence",{status:"unknown",reason:"temperature_evidence_missing",message:"Home Assistant has no usable current temperature evidence.",evidence:{unit:"°F"}},"Waiting for a temperature reading"],
  ["nonfinite reading",{status:"unknown",reason:"temperature_evidence_missing",evidence:{temperature_celsius:NaN,unit:"°F"}},"Waiting for a temperature reading"],
])test(name+" does not invent a healthy verdict or temperature",()=>{
  const card=temperatureFixture();card.sourceDetail.temperature_checks[0].observation=observation;card.sourceDetail.temperature_checks[0].next_deadline=null;
  const html=sourceTemperature(card.current.data.inventory.nodes.find(row=>row.node_id===DEVICE_ID),card.sourceDetail);
  assert.match(html,new RegExp(expected));
  assert.doesNotMatch(html,/Within limits|68 °F|0 °F|NaN|Next evaluation/);
});

test("independent waiting and active temperature policies retain their individual verdicts",()=>{
  const card=temperatureFixture(),first=card.sourceDetail.temperature_checks[0];
  card.sourceDetail.temperature_checks.push({...first,node_id:"temperature:second",policy_id:"second",policy_name:"Second temperature policy",observation:{status:"warn",reason:"temperature_low",message:"Below the lower bound.",evidence:{temperature_celsius:20,minimum:75,unit:"°F"}},next_deadline:null});
  const html=sourceTemperature(card.current.data.inventory.nodes.find(row=>row.node_id===DEVICE_ID),card.sourceDetail);
  assert.equal([...html.matchAll(/data-temperature-check=/g)].length,2);
  assert.match(html,/Home Interior Temperature Monitoring[\s\S]*Waiting/);
  assert.match(html,/Second temperature policy[\s\S]*Temperature needs attention[\s\S]*75 °F/);
});

test("zero Celsius remains a real numeric reading",()=>{
  const card=temperatureFixture();card.sourceDetail.temperature_checks[0].observation.evidence={temperature_celsius:0,minimum:0,unit:"°C"};
  const html=sourceTemperature(card.current.data.inventory.nodes.find(row=>row.node_id===DEVICE_ID),card.sourceDetail);
  assert.match(html,/0 °C · Minimum 0 °C/);
});

test("a temperature check without a discovered base entity remains reachable",()=>{
  const card=temperatureFixture(),data=card.current.data;
  data.inventory.nodes=data.inventory.nodes.filter(row=>row.node_id!==ENTITY_ID&&row.monitoring_policy!=="entities");
  data.inventory.catalog.candidates=data.inventory.catalog.candidates.filter(row=>row.node_id!==ENTITY_ID);
  const paths=sourcePaths(sourcesTree(data));
  assert.equal(paths.get("source:temperature:home").node.source.node_id,"temperature:home");
});

test("temperature aliases retain related issues at the device and sensor",()=>{
  const card=temperatureFixture(),data=card.current.data;
  data.inventory.episodes=[{episode_id:"temperature-issue",anchor:"temperature:home",recorded:["temperature:home"],reasons:[{node_id:"temperature:home",status:"warn",reason:"temperature_low",message:"Temperature is below 80 °F."}],opened_at:"2026-10-15T17:20:00Z",importance:"normal"}];
  const device=sourcesBrowser(card);
  card.sourcesSelection="source:"+ENTITY_ID;card.sourceDetail.nodeId=ENTITY_ID;
  const entity=sourcesBrowser(card);
  assert.match(device,/data-episode="temperature-issue"/);
  assert.match(entity,/data-episode="temperature-issue"/);
  assert.equal(canonicalSourceSelection(sourcesTree(data),"source:temperature:home"),"source:"+ENTITY_ID);
});
