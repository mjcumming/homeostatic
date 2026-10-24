import assert from "node:assert/strict";
import test from "node:test";
import {entitySelection,entitySelectionRows,entitySelected} from "../../custom_components/homeostatic/frontend/entity-selection.mjs";
import {editReusable,namedPolicies,MONITORING_TYPES,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

function fixture() {
  const policy={...newMonitoringPolicy([],"entity"),id:"entities",enabled:true,match:{kind:["entity"]},match_any:[{domain:["lock","camera"]}]};
  const source=(id,name,domain,device="front",extra={})=>({node_id:`entity:registry:${id}`,name,kind:"entity",entity_id:`${domain}.${id}`,attributes:{kind:["entity"],entity:[`registry:${id}`],domain:[domain],integration_domain:["esphome"],...(device?{device:[device]}:{}),area:["hall"]},...extra});
  const rows=[{node_id:"device:front",name:"Front door",kind:"device",attributes:{device:["front"]}},source("lock","Lock","lock"),source("signal","Signal strength","sensor"),source("disabled","Disabled reading","sensor","front",{disabled:true}),source("loose","Loose sensor","sensor",null)];
  const settings=notificationSettings();settings.monitoring_policies=[policy];
  const card={editors:{settingsDraft:settings,configuration:{settings:structuredClone(settings),revision:"one",areas:[{id:"hall",name:"Hall"}],floors:[],labels:[]}},definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:{schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:rows}}}},main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){}};
  return {card,policy,rows};
}
function change(card,field,value,id="") {
  const element={dataset:{definitionKind:"policies",definitionId:"entities",definitionField:field,definitionValue:id},value,checked:value};
  editReusable(card,{type:"change",target:element});
}
function expand(card,key) {
  const element={dataset:{definitionAction:"entity-expand",definitionKind:"policies",definitionId:"entities",definitionField:"entity-expand",definitionValue:key}};
  editReusable(card,{type:"click",target:{closest:()=>element}});
}

test("entity editor starts with collapsed integrations and opens devices then entities without editing",()=>{
  const {card,policy}=fixture(),before=structuredClone(policy),html=namedPolicies(card);
  assert.match(html,/Search entities/);assert.match(html,/Expand Esphome/);assert.match(html,/aria-expanded="false"/);
  assert.doesNotMatch(html,/Front door|Without a device|entity-choice|Hall · lock.lock/);
  assert.doesNotMatch(html,/type="radio"|Change selection|Show 50 more|finish-pick|Ignored entities/);
  assert.equal(MONITORING_TYPES.device,undefined);assert.equal(newMonitoringPolicy([]).match.kind[0],"entity");
  expand(card,"integration:esphome");
  assert.match(entitySelection(card,policy),/Expand Front door/);assert.match(entitySelection(card,policy),/Expand Without a device/);
  assert.doesNotMatch(entitySelection(card,policy),/entity-choice/);
  expand(card,'device:["esphome","front"]');
  assert.match(entitySelection(card,policy),/Hall · lock.lock/);
  expand(card,"integration:esphome");assert.doesNotMatch(entitySelection(card,policy),/entity-choice/);
  expand(card,"integration:esphome");assert.match(entitySelection(card,policy),/Hall · lock.lock/);
  assert.deepEqual(policy,before);
});

test("search reveals matching branches and clearing it restores manual expansion",()=>{
  const {card,policy}=fixture(),before=structuredClone(policy);
  expand(card,"integration:esphome");
  change(card,"entity-search","signal");assert.match(entitySelection(card,policy),/sensor.signal/);
  expand(card,'device:["esphome","front"]');assert.doesNotMatch(entitySelection(card,policy),/sensor.signal/);
  change(card,"entity-search","lock");assert.match(entitySelection(card,policy),/lock.lock/);
  change(card,"entity-search","");
  assert.match(entitySelection(card,policy),/Collapse Esphome/);assert.match(entitySelection(card,policy),/Expand Front door/);
  assert.doesNotMatch(entitySelection(card,policy),/entity-choice/);assert.deepEqual(policy,before);
  assert.match(entitySelection(card,{...policy,id:"another"}),/Expand Esphome/);
});

test("individual overrides preserve a dynamic type scope and survive clear and reselection",()=>{
  const {card,policy,rows}=fixture(),original=structuredClone(policy.match_any);
  change(card,"entity-choice",true,"entity:registry:signal");
  assert.ok(entitySelected(policy,rows[2]));assert.deepEqual(policy.match_any,original);
  change(card,"entity-choice",false,"entity:registry:lock");assert.ok(!entitySelected(policy,rows[1]));
  change(card,"entity-choice",true,"entity:registry:lock");assert.ok(entitySelected(policy,rows[1]));assert.equal(policy.excluded_sources,undefined);
  change(card,"entity-choice",false,"entity:registry:signal");assert.equal(policy.included_sources,undefined);
  assert.ok(entitySelected(policy,{node_id:"entity:registry:future",attributes:{kind:["entity"],domain:["lock"]}}));
});

for(const query of ["signal strength","sensor.signal","front door","esphome","hall"])test(`search finds complete entity membership by ${query}`,()=>{
  const {card,policy}=fixture();change(card,"entity-search",query);
  assert.ok(entitySelectionRows(card,policy).some(row=>row.id==="entity:registry:signal"));
});

test("filtered group changes affect only matching enabled rows and zero selection is valid",()=>{
  const {card,policy,rows}=fixture();change(card,"entity-search","signal");
  change(card,"entity-group",true,JSON.stringify(["esphome","front"]));
  assert.deepEqual(policy.included_sources,["entity:registry:signal"]);assert.ok(entitySelected(policy,rows[1]));
  change(card,"entity-search","");
  change(card,"entity-group",false,JSON.stringify(["esphome","front"]));
  assert.ok(!entitySelected(policy,rows[1]));assert.ok(!entitySelected(policy,rows[2]));assert.equal(policy.included_sources,undefined);
  assert.doesNotMatch(JSON.stringify(policy),/registry:disabled/);
});

test("collapsed integration checkboxes show mixed membership and select enabled descendants across devices",()=>{
  const {card,policy,rows}=fixture();
  assert.match(entitySelection(card,policy),/data-definition-field="entity-integration"[^>]*data-indeterminate="true"/);
  assert.match(entitySelection(card,policy),/1 of 3 entities selected/);
  change(card,"entity-integration",true,"esphome");
  assert.ok(rows.filter(row=>row.kind==="entity"&&!row.disabled).every(row=>entitySelected(policy,row)));
  assert.doesNotMatch(JSON.stringify(policy),/registry:disabled/);
  assert.match(entitySelection(card,policy),/data-definition-field="entity-integration"[^>]* checked/);
  assert.doesNotMatch(entitySelection(card,policy),/entity-choice/);
  change(card,"entity-integration",false,"esphome");
  assert.ok(rows.filter(row=>row.kind==="entity"&&!row.disabled).every(row=>!entitySelected(policy,row)));
  assert.match(entitySelection(card,policy),/0 of 3 entities selected/);
  assert.ok(entitySelected(policy,{node_id:"entity:future",attributes:{kind:["entity"],domain:["lock"]}}));
});

test("device checkboxes sit on collapsed device rows and reflect individual exceptions",()=>{
  const {card,policy}=fixture();expand(card,"integration:esphome");
  assert.match(entitySelection(card,policy),/data-definition-field="entity-group"[^>]*data-indeterminate="true"/);
  assert.match(entitySelection(card,policy),/1 of 2 entities selected/);
  assert.doesNotMatch(entitySelection(card,policy),/entity-choice|>Monitor entities</);
  change(card,"entity-group",true,JSON.stringify(["esphome","front"]));
  assert.match(entitySelection(card,policy),/2 of 2 entities selected/);
  change(card,"entity-choice",false,"entity:registry:signal");
  assert.match(entitySelection(card,policy),/1 of 2 entities selected/);
});

test("integration selection obeys search and monitored-only filters without changing other integrations",()=>{
  const {card,policy,rows}=fixture();
  rows.push({...rows[2],node_id:"entity:other",attributes:{...rows[2].attributes,integration_domain:["other"]}});
  change(card,"entity-search","signal");change(card,"entity-integration",true,"esphome");
  assert.deepEqual(policy.included_sources,["entity:registry:signal"]);
  assert.match(entitySelection(card,policy),/1 of 1 matching entities selected/);
  change(card,"entity-search","");change(card,"entity-selected-only",true);
  change(card,"entity-integration",false,"esphome");
  assert.ok(!entitySelected(policy,rows[1]));assert.ok(!entitySelected(policy,rows[2]));
  assert.equal(policy.included_sources,undefined);
});

test("a whole-device exclusion can retain siblings while explicitly selecting one member",()=>{
  const {card,policy,rows}=fixture();policy.excluded_sources=["device:front"];
  change(card,"entity-choice",true,"entity:registry:signal");
  assert.ok(entitySelected(policy,rows[2]));assert.ok(!entitySelected(policy,rows[1]));assert.deepEqual(policy.excluded_sources,["device:front"]);
});

for(const state of ["loading","stale"])test(`${state} catalogs disable membership changes without discarding saved overrides`,()=>{
  const {card,policy}=fixture();policy.included_sources=["entity:registry:missing"];
  if(state==="loading")card.current.data.catalog_loaded=false;else card.current.data.catalog_stale=true;
  const before=structuredClone(policy);change(card,"entity-choice",true,"entity:registry:signal");
  change(card,"entity-integration",true,"esphome");
  change(card,"entity-group",true,JSON.stringify(["esphome","front"]));
  change(card,"entity-search","signal");
  assert.deepEqual(policy,before);assert.match(entitySelection(card,policy),/disabled/);
});

test("missing choices remain visible and removable and selected-only filtering changes no settings",()=>{
  const {card,policy}=fixture();policy.included_sources=["entity:registry:missing"];
  change(card,"entity-search","missing");
  assert.match(entitySelection(card,policy),/Entity no longer in the list/);
  const before=structuredClone(policy);change(card,"entity-selected-only",true);assert.deepEqual(policy,before);
  const element={dataset:{definitionAction:"entity-forget",definitionKind:"policies",definitionId:"entities",definitionField:"entity-forget",definitionValue:"entity:registry:missing"}};
  editReusable(card,{type:"click",target:{closest:()=>element}});assert.equal(policy.included_sources,undefined);
});

test("the list searches beyond the former 50-row page without manual pagination",()=>{
  const {card,policy,rows}=fixture();
  for(let n=0;n<704;n++)rows.push({node_id:`entity:registry:row-${n}`,kind:"entity",name:`Reading ${n}`,entity_id:`sensor.reading_${n}`,attributes:{kind:["entity"],entity:[`registry:row-${n}`],domain:["sensor"],integration_domain:["esphome"]}});
  assert.equal(entitySelectionRows(card,policy).length,708);
  assert.doesNotMatch(entitySelection(card,policy),/entity-choice/);
  change(card,"entity-search","sensor.reading_703");assert.equal(entitySelectionRows(card,policy)[0].id,"entity:registry:row-703");
});
