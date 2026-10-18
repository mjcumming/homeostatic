import assert from "node:assert/strict";
import test from "node:test";
import {entitySelection,entitySelectionRows,entitySelected} from "../../custom_components/homeostatic/frontend/entity-selection.mjs";
import {editReusable,namedPolicies,MONITORING_TYPES,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

function fixture() {
  const policy={...newMonitoringPolicy([],"entity"),id:"entities",enabled:true,match_any:[{domain:["lock"]}]};
  const source=(id,name,domain,device="front",extra={})=>({node_id:`entity:registry:${id}`,name,kind:"entity",entity_id:`${domain}.${id}`,attributes:{kind:["entity"],entity:[`registry:${id}`],domain:[domain],integration_domain:["esphome"],...(device?{device:[device]}:{}),area:["hall"]},...extra});
  const rows=[{node_id:"device:front",name:"Front door",kind:"device",attributes:{device:["front"]}},source("lock","Lock","lock"),source("signal","Signal strength","sensor"),source("disabled","Disabled reading","sensor","front",{disabled:true}),source("loose","Loose sensor","sensor",null)];
  const settings=notificationSettings();settings.monitoring_policies=[policy];
  const card={settingsDraft:settings,configuration:{settings:structuredClone(settings),revision:"one",areas:[{id:"hall",name:"Hall"}],floors:[],labels:[]},definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:{schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:rows}}}},main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){}};
  return {card,policy,rows};
}
function change(card,field,value,id="") {
  const element={dataset:{definitionKind:"policies",definitionId:"entities",definitionField:field,definitionValue:id},value,checked:value};
  editReusable(card,{type:"change",target:element});
}

test("entity editor is one grouped list with no retired picker or device policy",()=>{
  const {card,policy}=fixture(),before=structuredClone(policy),html=namedPolicies(card);
  assert.match(html,/Search entities/);assert.match(html,/Esphome/);assert.match(html,/Front door/);assert.match(html,/Without a device/);assert.match(html,/Hall · lock.lock/);
  assert.doesNotMatch(html,/type="radio"|Change selection|Show 50 more|finish-pick|Ignored entities/);
  assert.equal(MONITORING_TYPES.device,undefined);assert.equal(newMonitoringPolicy([]).match.kind[0],"entity");
  assert.deepEqual(policy,before);
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

test("a whole-device exclusion can retain siblings while explicitly selecting one member",()=>{
  const {card,policy,rows}=fixture();policy.excluded_sources=["device:front"];
  change(card,"entity-choice",true,"entity:registry:signal");
  assert.ok(entitySelected(policy,rows[2]));assert.ok(!entitySelected(policy,rows[1]));assert.deepEqual(policy.excluded_sources,["device:front"]);
});

for(const state of ["loading","stale"])test(`${state} catalogs disable membership changes without discarding saved overrides`,()=>{
  const {card,policy}=fixture();policy.included_sources=["entity:registry:missing"];
  if(state==="loading")card.current.data.catalog_loaded=false;else card.current.data.catalog_stale=true;
  const before=structuredClone(policy);change(card,"entity-choice",true,"entity:registry:signal");
  assert.deepEqual(policy,before);assert.match(entitySelection(card,policy),/disabled/);
});

test("missing choices remain visible and removable and selected-only filtering changes no settings",()=>{
  const {card,policy}=fixture();policy.included_sources=["entity:registry:missing"];
  assert.match(entitySelection(card,policy),/Entity no longer in the list/);
  const before=structuredClone(policy);change(card,"entity-selected-only",true);assert.deepEqual(policy,before);
  const element={dataset:{definitionAction:"entity-forget",definitionKind:"policies",definitionId:"entities",definitionField:"entity-forget",definitionValue:"entity:registry:missing"}};
  editReusable(card,{type:"click",target:{closest:()=>element}});assert.equal(policy.included_sources,undefined);
});

test("the list searches beyond the former 50-row page without manual pagination",()=>{
  const {card,policy,rows}=fixture();
  for(let n=0;n<704;n++)rows.push({node_id:`entity:registry:row-${n}`,kind:"entity",name:`Reading ${n}`,entity_id:`sensor.reading_${n}`,attributes:{kind:["entity"],entity:[`registry:row-${n}`],domain:["sensor"],integration_domain:["esphome"]}});
  assert.equal(entitySelectionRows(card,policy).length,708);
  change(card,"entity-search","sensor.reading_703");assert.equal(entitySelectionRows(card,policy)[0].id,"entity:registry:row-703");
});
