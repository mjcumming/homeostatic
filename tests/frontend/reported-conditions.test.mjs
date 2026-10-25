import assert from "node:assert/strict";
import test from "node:test";
import {REPORTED_CONDITIONS,reportedConditionProblem} from "../../custom_components/homeostatic/frontend/reported-conditions.mjs";
import {MONITORING_TYPES,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {flatSourceRows,sourceNoun} from "../../custom_components/homeostatic/frontend/source-selection.mjs";
import {retainedProblem} from "../../custom_components/homeostatic/frontend/check-presentation.mjs";
import {issueDeviceId} from "../../custom_components/homeostatic/frontend/device-issue-model.mjs";

const checks=["problem","lawn_mower","tamper","safety","moisture","smoke","gas","carbon_monoxide","alarm_triggered"];
assert.deepEqual(Object.keys(REPORTED_CONDITIONS),checks);

for(const check of checks) {
  test(`${check} uses ordinary disabled policies and its own flat source choices`,()=>{
    const policy=newMonitoringPolicy([],check,{morning:{},immediate:{}});
    assert.equal(MONITORING_TYPES[check],REPORTED_CONDITIONS[check].name);
    assert.equal(policy.enabled,false);assert.deepEqual(policy.parameters,{});
    assert.deepEqual(policy.match,{kind:[check],...(["problem","lawn_mower"].includes(check)?{}:{entity:[]})});
    assert.deepEqual(policy.notifications,[{id:"notification-1",profile:check==="problem"?"morning":"immediate"}]);
    assert.deepEqual(newMonitoringPolicy([],check,{}).notifications,[]);
    assert.equal(sourceNoun(policy),REPORTED_CONDITIONS[check].noun);
    const source={node_id:`${check}:registry:one`,kind:check,name:"Equipment",entity_id:"binary_sensor.one",attributes:{kind:[check],entity:["registry:one"]}};
    const availability={...source,node_id:"entity:registry:one",kind:"entity",attributes:{...source.attributes,kind:["entity"]}};
    const card={editors:{configuration:{}},current:{data:{inventory:{catalog:{candidates:[source,availability]},nodes:[]}}}};
    const rows=flatSourceRows(card,policy);
    assert.equal(rows.length,1);assert.equal(rows[0].id,source.node_id);
    assert.equal(rows[0].selected,["problem","lawn_mower"].includes(check));
  });

  test(`${check} preserves its reported condition during unknown evidence`,()=>{
    const source={node_id:`${check}:registry:one`,kind:check,name:"Equipment",attributes:{device:["device-one"]}};
    const failure={status:"fail",reason:`${check}_reported`,message:"Home Assistant reported this condition."};
    const reported=reportedConditionProblem(source,{current:failure});
    assert.equal(reported.headline,REPORTED_CONDITIONS[check].title);
    assert.equal(reported.tone,"failure");assert.equal(reported.reported,failure.message);
    const status={current:{status:"unknown",message:"Waiting for the integration."},last_failure:failure};
    const retained=retainedProblem(reportedConditionProblem(source,status),status);
    assert.equal(retained.historical,true);assert.equal(retained.summary,failure.message);
    assert.match(retained.headline,/waiting for current information/);
    assert.equal(retained.nextStep,status.current.message);
    assert.equal(reportedConditionProblem(source,{current:{status:"pass"}}).headline,"Condition not reported");
    const data={inventory:{catalog:{candidates:[source]},nodes:[source]}};
    assert.equal(issueDeviceId(data,{anchor:source.node_id}),"device-one");
  });
}

test("ordinary availability stays outside reported condition presentation",()=>{
  assert.equal(reportedConditionProblem({kind:"entity"},{current:{status:"fail"}}),null);
});
