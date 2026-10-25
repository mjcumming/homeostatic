import assert from "node:assert/strict";
import test from "node:test";
import {lockProblem} from "../../custom_components/homeostatic/frontend/problem.mjs";
import {retainedProblem} from "../../custom_components/homeostatic/frontend/check-presentation.mjs";
import {MONITORING_TYPES,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {flatSourceRows,sourceNoun} from "../../custom_components/homeostatic/frontend/source-selection.mjs";

test("a lock jam stays a reported problem during unknown evidence",()=>{
  const source={kind:"lock",name:"Front door"};
  const failed={reason:"lock_jammed",status:"fail",message:"Home Assistant reports Front door is jammed."};
  const problem=lockProblem(source,{current:failed});
  assert.equal(problem.headline,"Lock jammed");assert.equal(problem.tone,"failure");
  const status={current:{status:"unknown",reason:"lock_restored",message:"Waiting for current state."},last_failure:failed};
  const retained=retainedProblem(lockProblem(source,status),status);
  assert.match(retained.headline,/Lock jam reported/);assert.equal(retained.historical,true);
  assert.equal(retained.summary,failed.message);assert.equal(retained.nextStep,"Waiting for current state.");
  const clear=lockProblem(source,{current:{status:"pass",reason:"lock_not_jammed"}});
  assert.equal(clear.headline,"No jam reported");assert.match(clear.summary,/does not establish/);
  assert.equal(lockProblem({kind:"entity"},status),null);
});

test("the existing policy form supplies a disabled jam policy and flat lock choices",()=>{
  assert.equal(MONITORING_TYPES.lock_jam,"Jammed lock");
  const policy=newMonitoringPolicy([],"lock_jam",{immediate:{}});
  assert.equal(policy.enabled,false);assert.deepEqual(policy.match,{kind:["lock"]});
  assert.deepEqual(policy.parameters,{});assert.deepEqual(policy.notifications,[{id:"notification-1",profile:"immediate"}]);
  assert.deepEqual(newMonitoringPolicy([],"lock_jam",{}).notifications,[]);
  assert.equal(sourceNoun(policy),"locks");
  const sources=[{node_id:"lock:registry:front",kind:"lock",name:"Front door",attributes:{kind:["lock"],entity:["registry:front"]}},
    {node_id:"entity:registry:front",kind:"entity",name:"Front door availability",attributes:{kind:["entity"],entity:["registry:front"]}}];
  const card={editors:{configuration:{}},current:{data:{inventory:{catalog:{candidates:sources},nodes:[]}}}};
  const rows=flatSourceRows(card,policy);
  assert.equal(rows.length,1);assert.equal(rows[0].id,"lock:registry:front");assert.equal(rows[0].selected,true);
});
