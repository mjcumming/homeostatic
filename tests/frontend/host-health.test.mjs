import test from "node:test";
import assert from "node:assert/strict";
import {newMonitoringPolicy, namedPolicies, emptyNotificationDefinitions, editReusable} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {flatSourceRows, flatSourceSelection} from "../../custom_components/homeostatic/frontend/source-selection.mjs";
import {hostHealthProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";

test("host policy offers only matching System Monitor sensors and explicit selection",()=>{
  const policy=newMonitoringPolicy([],"host_memory");
  const entity=(id,host_condition,disabled=false)=>({node_id:`entity:registry:${id}`,name:id,kind:"entity",entity_id:`sensor.${id}`,host_condition,disabled,attributes:{kind:["entity"],entity:[`registry:${id}`],domain:["sensor"]}});
  const rows=[entity("memory","memory"),entity("cpu","cpu"),entity("disabled","memory",true),entity("other",null)];
  const settings={monitoring_policies:[policy],notification_definitions:emptyNotificationDefinitions(),notifications:false};
  const card={definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:{schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:rows}}}},editors:{configuration:{revision:"one",settings:structuredClone(settings),areas:[],floors:[],labels:[]},settingsDraft:structuredClone(settings)}};
  assert.deepEqual(flatSourceRows(card,policy).map(row=>row.name),["disabled","memory"]);
  const selection=flatSourceSelection(card,policy);
  assert.match(selection,/Disabled in Home Assistant/);
  assert.doesNotMatch(selection,/Future sources/);
  const editor=namedPolicies(card);
  assert.match(editor,/>Problem wait</);
  assert.match(editor,/>Recovery wait</);
  assert.match(editor,/Clear below \(%\)/);
  assert.match(editor,/five-minute average/i);
  assert.doesNotMatch(selection,/Monitored only|Search System Monitor/);
});

test("issue explains the measured condition and useful next action",()=>{
  const problem=hostHealthProblem({kind:"host_memory"},{current:{status:"warn",reason:"host_problem",message:"Memory pressure is high.",evidence:{value:8,unit:"%",threshold:5}}});
  assert.equal(problem.headline,"Memory pressure is high");
  assert.match(problem.detail,/8 %/);
  assert.match(problem.nextStep,/memory use/i);
  assert.equal(hostHealthProblem({kind:"entity"},{}),null);
});

test("invalid recovery limit stays in the draft and does not submit",()=>{
  const policy=newMonitoringPolicy([],"host_memory");policy.parameters.recovery=8;
  const settings={monitoring_policies:[policy],notification_definitions:emptyNotificationDefinitions(),notifications:false};
  let calls=0;
  const card={definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:{schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:[]}}}},editors:{configuration:{revision:"one",settings:structuredClone(settings),areas:[],floors:[],labels:[]},settingsDraft:structuredClone(settings)},main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){},_hass:{async callWS(){calls++;}}};
  namedPolicies(card);
  const target={dataset:{definitionKind:"policies",definitionId:policy.id,definitionAction:"save-scoped"},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
  assert.match(card.editors.policyValidation.message,/recovery limit must be lower/i);
  assert.equal(card.editors.settingsDraft.monitoring_policies[0].parameters.recovery,8);
  assert.equal(calls,0);
});
