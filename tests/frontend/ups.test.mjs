import test from "node:test";
import assert from "node:assert/strict";
import {groupedUpsIssues,upsProblem,upsSourceSummary} from "../../custom_components/homeostatic/frontend/ups.mjs";
import {newMonitoringPolicy,namedPolicies,emptyNotificationDefinitions,editReusable} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

function fixture() {
  const sources=["ups_power","ups_reserve","ups_battery_replacement"].map(check=>({node_id:check,name:check,kind:"ups",check_id:check,ups_name:"Office UPS",attributes:{device:["office"]},ups_entities:[["runtime","sensor.runtime"]],watched:true}));
  const episodes=sources.map(source=>({anchor:source.node_id,episode_id:`issue:${source.node_id}`,opened_at:"2026-10-13T00:00:00Z"}));
  const status={ups_power:{reason:"ups_on_battery",message:"Running on backup power",status:"warn",evidence:{power_mode:"backup",readings:{charge:8,runtime:3}}},ups_reserve:{reason:"ups_reserve_critical",message:"Low reserve on backup power",status:"warn",evidence:{power_mode:"backup",readings:{charge:8,runtime:3}}}};
  return {data:{inventory:{nodes:sources,ups_status:status}},episodes,sources,status};
}

test("one UPS group keeps urgent reserve ahead of backup operation and independent issue links",()=>{
  const {data,episodes}=fixture();
  const html=groupedUpsIssues(data,episodes,episode=>`<button data-episode="${episode.episode_id}">View condition</button>`);
  assert.equal((html.match(/class="ups-issue-group"/g)||[]).length,1);
  assert.match(html,/3 open issues/);
  assert.match(html,/<strong>Low reserve on backup power<\/strong>/);
  assert.ok(html.indexOf('data-episode="issue:ups_reserve"')<html.indexOf('data-episode="issue:ups_power"'));
  assert.match(html,/estimated runtime 3 minutes/);
  assert.match(html,/data-ui-key="ups-conditions:office"/);
});

test("different UPS devices and unrelated issues remain separate",()=>{
  const {data,episodes}=fixture();
  data.inventory.nodes.push({...data.inventory.nodes[0],node_id:"other",attributes:{device:["network"]},ups_name:"Network UPS"});
  data.inventory.nodes.push({node_id:"vacuum",kind:"vacuum"});
  episodes.push({anchor:"other",episode_id:"other",opened_at:"2026-10-13T00:00:00Z"},{anchor:"vacuum",episode_id:"vacuum"});
  const html=groupedUpsIssues(data,episodes,episode=>`<p>${episode.episode_id}</p>`);
  assert.equal((html.match(/class="ups-issue-group"/g)||[]).length,2);
  assert.match(html,/<p>vacuum<\/p>/);
});

test("missing runtime is never rendered as zero and disabled evidence has a next action",()=>{
  const {sources}=fixture();
  const source={...sources[1],ups_disabled_entities:["sensor.runtime"]};
  const html=upsSourceSummary({},source,{reason:"ups_evidence_missing",status:"unknown",evidence:{readings:{runtime:null}}},true);
  assert.match(html,/Enable sensor.runtime/);
  assert.match(html,/Power mode unknown/);
  assert.doesNotMatch(html,/runtime 0|healthy|recovered/i);
});

test("partial recovery retains reserve and integration names render as text",()=>{
  const {data,episodes,status,sources}=fixture();
  sources[0].ups_name="Office <script>alert(1)</script>";
  status.ups_reserve.message="Mains restored; reserve still low";
  status.ups_reserve.evidence.power_mode="mains";
  const html=groupedUpsIssues(data,episodes,()=>"");
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.equal(upsProblem(sources[1],status.ups_reserve).headline,"Mains restored; reserve still low");
});

test("reserve editor exposes both mode assignments and separates numeric raise and clear thresholds",()=>{
  const policy={...newMonitoringPolicy([],"ups_reserve"),notifications:[{id:"mains",when:"mains",schedule:"morning",methods:["phone"]},{id:"backup",when:"backup",schedule:"acknowledge",methods:["phone"]}]};
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Phone",mode:"fixed",destinations:["phone:owner"]};
  const source={node_id:"ups",kind:"ups",name:"UPS",attributes:{kind:["ups"]},ups_entities:[["charge","sensor.charge"],["runtime","sensor.runtime"]]};
  const card={current:{data:{inventory:{nodes:[source],catalog:{candidates:[source]}}}},settingsDraft:{monitoring_policies:[policy],notification_definitions:definitions},definitionSelection:{kind:"policies",id:policy.id},configuration:{areas:[],floors:[],labels:[]},main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){}};
  const html=namedPolicies(card);
  assert.match(html,/Mains power confirmed/);
  assert.match(html,/Backup power confirmed/);
  assert.match(html,/Raise at or below/);
  assert.match(html,/Clear at or above/);
  assert.match(html,/Transfer overlapping battery monitoring/);
  const target={type:"checkbox",checked:true,value:"on",dataset:{definitionKind:"policies",definitionId:policy.id,definitionField:"parameters:replace_battery_check"},closest(){return this;}};
  assert.equal(editReusable(card,{type:"change",target}),true);
  assert.equal(policy.parameters.replace_battery_check,true);
});
