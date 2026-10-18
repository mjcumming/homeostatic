import assert from "node:assert/strict";
import test from "node:test";
import {issueConfiguration, issuePolicyChoices} from "../../custom_components/homeostatic/frontend/issue-configuration.mjs";

const fixture=()=>({configuration:{settings:{notifications:true,monitoring_policies:[
  {id:"entity",name:"Entities",notifications:[{id:"first",profile:"evening"}]},
  {id:"temperature",name:"Temperature",notifications:[{id:"second",profile:"evening"},{id:"third",profile:"urgent"}]},
],notification_definitions:{profiles:{evening:{name:"Evening summary",methods:["phone"]},urgent:{name:"Urgent",methods:[]}},methods:{phone:{mode:"fixed",destinations:["phone:owner"]}}}}}});
const coverage=[{id:"entity",name:"Old entity name"},{id:"temperature",name:"Temperature"}];

test("issue coverage uses saved names and deduplicates notifications across contributing policies",()=>{
  const card=fixture(),before=structuredClone(card);
  card.settingsDraft={monitoring_policies:[],notification_definitions:{profiles:{evening:{name:"Unsaved name"}}}};
  const html=issueConfiguration(card,[...coverage,coverage[0]]);
  assert.equal((html.match(/data-definition-action="open-notification"/g)||[]).length,2);
  assert.equal((html.match(/data-definition-action="open-policy"/g)||[]).length,2);
  assert.match(html,/Policies:<\/h3>/);assert.match(html,/Notifications:<\/h3>/);
  assert.match(html,/>Evening summary<\/button>/);assert.match(html,/>Entities<\/button>/);
  assert.match(html,/No delivery method selected/);
  assert.doesNotMatch(html,/Old entity name|Unsaved name|Scheduled summary|Edit policy:/);
  assert.deepEqual(card.configuration,before.configuration);
});

test("an empty assignment and globally disabled sending stay distinct",()=>{
  const card=fixture();card.configuration.settings.notifications=false;
  for(const policy of card.configuration.settings.monitoring_policies)policy.notifications=[];
  const html=issueConfiguration(card,coverage);
  assert.match(html,/None assigned/);assert.match(html,/Notifications off/);
  assert.equal((html.match(/data-definition-action="open-policy"/g)||[]).length,2);
});

test("custom and missing notifications open their owning policy instead of a nonexistent profile editor",()=>{
  const card=fixture();card.configuration.settings.monitoring_policies[0].notifications=[{id:"custom",timing:{mode:"immediate"},methods:[]},{id:"lost",profile:"missing"}];
  const html=issueConfiguration(card,[coverage[0]]);
  assert.match(html,/Custom notification · Entities/);assert.match(html,/Unavailable notification · Entities/);
  assert.doesNotMatch(html,/open-notification|data-definition-id="missing"/);
});

test("unavailable coverage cannot claim that no policies or notifications apply",()=>{
  const card=fixture();
  for(const html of [issueConfiguration(card,[],{unavailable:true}),issueConfiguration({},[])]) {
    assert.match(html,/coverage is unavailable/);assert.match(html,/Retry/);
    assert.doesNotMatch(html,/None assigned|None currently apply/);
  }
  const missing=issueConfiguration(card,[{id:"gone",name:"Old policy"}]);
  assert.match(missing,/assignments are unavailable/);assert.doesNotMatch(missing,/None assigned/);
});

test("policy and notification names remain text",()=>{
  const card=fixture();card.configuration.settings.notification_definitions.profiles.evening.name='<img src=x onerror="x">';
  const html=issueConfiguration(card,coverage);
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});

test("coverage includes auxiliary battery and grouped device policies without unrelated checks",()=>{
  const card=fixture(),entity={node_id:"entity:warning",kind:"entity",entity_id:"binary_sensor.low_battery"};
  const device={node_id:"device:hall",kind:"device",attributes:{device:["hall"]}};
  entity.attributes={device:["hall"]};
  const checks=[
    {node_id:"check:battery",kind:"battery",watched:true,monitoring_policy:"battery",battery_warning_entity:entity.entity_id},
    {...entity,node_id:"check:entity",watched:true,monitoring_source:entity.node_id,monitoring_policy:"device"},
    {node_id:"check:other",kind:"entity",watched:true,monitoring_policy:"other",entity_id:"sensor.other"},
  ];
  for(const source of [entity,device,...checks])source.name=source.node_id;
  card.current={data:{inventory:{catalog:{candidates:[entity,device]},nodes:checks}}};
  card.configuration.settings.monitoring_policies.push(...["battery","device","other"].map(id=>({id,name:id,enabled:true,notifications:[]})));
  assert.deepEqual(issuePolicyChoices(card,[entity]).map(item=>item.id).sort(),["battery","device"]);
  assert.deepEqual(issuePolicyChoices(card,[device,entity,checks[1]]).map(item=>item.id).sort(),["battery","device"]);
});

test("a selected fixed delivery method without destinations remains visibly unconfigured",()=>{
  const card=fixture();card.configuration.settings.notification_definitions.methods.phone.destinations=[];
  assert.match(issueConfiguration(card,[coverage[0]]),/Delivery method needs destinations/);
});
