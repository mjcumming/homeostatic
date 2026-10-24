import test from "node:test";
import assert from "node:assert/strict";
import {upsProblem,upsSourceSummary} from "../../custom_components/homeostatic/frontend/ups.mjs";
import {newMonitoringPolicy,namedPolicies,emptyNotificationDefinitions,editReusable} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

function fixture() {
  const sources=["ups_power","ups_reserve","ups_battery_replacement"].map(check=>({node_id:check,name:check,kind:"ups",check_id:check,ups_name:"Office UPS",attributes:{device:["office"]},ups_entities:[["runtime","sensor.runtime"]],watched:true}));
  const episodes=sources.map(source=>({anchor:source.node_id,episode_id:`issue:${source.node_id}`,opened_at:"2026-10-13T00:00:00Z"}));
  const status={ups_power:{reason:"ups_on_battery",message:"Running on backup power",status:"warn",evidence:{power_mode:"backup",readings:{charge:8,runtime:3}}},ups_reserve:{reason:"ups_reserve_critical",message:"Low reserve on backup power",status:"warn",evidence:{power_mode:"backup",readings:{charge:8,runtime:3}}}};
  return {data:{inventory:{nodes:sources,ups_status:status}},episodes,sources,status};
}



test("missing runtime is never rendered as zero and disabled evidence has a next action",()=>{
  const {sources}=fixture();
  const source={...sources[1],ups_disabled_entities:["sensor.runtime"]};
  const html=upsSourceSummary({},source,{reason:"ups_evidence_missing",status:"unknown",evidence:{readings:{runtime:null}}},true);
  assert.match(html,/Enable sensor.runtime/);
  assert.match(html,/Power mode unknown/);
  assert.doesNotMatch(html,/runtime 0|healthy|recovered/i);
});


test("reserve editor exposes both mode assignments and separates numeric raise and clear thresholds",()=>{
  const policy={...newMonitoringPolicy([],"ups_reserve"),notifications:[{id:"mains",when:"mains",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]},{id:"backup",when:"backup",timing:{mode:"acknowledge",remind_every:3600},methods:["phone"]}]};
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Phone",mode:"fixed",destinations:["phone:owner"]};
  const source={node_id:"ups",kind:"ups",name:"UPS",attributes:{kind:["ups"]},ups_entities:[["charge","sensor.charge"],["runtime","sensor.runtime"]]};
  const card={current:{data:{inventory:{nodes:[source],catalog:{candidates:[source]}}}},editors:{settingsDraft:{monitoring_policies:[policy],notification_definitions:definitions},configuration:{settings:{monitoring_policies:structuredClone([policy]),notification_definitions:structuredClone(definitions)},areas:[],floors:[],labels:[]}},definitionSelection:{kind:"policies",id:policy.id},main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){}};
  const html=namedPolicies(card);
  assert.match(html,/Mains power confirmed/);
  assert.match(html,/Backup power confirmed/);
  assert.match(html,/Raise at or below/);
  assert.match(html,/Clear at or above/);
  assert.doesNotMatch(html,/Transfer overlapping battery monitoring/);
});
