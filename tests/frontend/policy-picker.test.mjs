import test from "node:test";
import assert from "node:assert/strict";
import {newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {SOURCE_CATEGORIES,sourceCategory,futureMode,sourceSelected,flatSourceRows,flatSourceSelection,editSourceSelection} from "../../custom_components/homeostatic/frontend/source-selection.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const areas=[{id:"kitchen",name:"Kitchen",floor_id:"ground"},{id:"garage",name:"Garage",floor_id:"ground"},{id:"office",name:"Office",floor_id:"upper"},{id:"empty",name:"Spare room",floor_id:"upper"}];
const floors=[{id:"ground",name:"Ground floor"},{id:"upper",name:"Upstairs"}];
const labels=[{id:"safety",name:"Safety"},{id:"climate",name:"Climate"},{id:"future",name:"Future equipment"}];
function source(kind,id,name,attributes={},extra={}) {
  const node_id=kind==="integration"?`entry:${id}`:kind==="ups"?`ups:${id}`:`${kind}:registry:${id}`;
  return {node_id,name,kind,attributes:{kind:[kind],...(kind==="ups"?{device:[id]}:kind==="integration"?{integration:[id]}:{entity:[`registry:${id}`]}),...attributes},watched:false,attached_by:[],requirements:[],...extra};
}
function fixture(type="battery",mode="selected",values=[]) {
  const rows=[
    source("battery","kitchen-motion","Motion sensor battery",{area:["kitchen"],label:["safety"]},{entity_id:"sensor.kitchen_motion_battery",state:"unavailable"}),
    source("battery","garage-motion","Motion sensor battery",{area:["garage"],label:["safety"]},{entity_id:"sensor.garage_motion_battery",state:"unknown"}),
    source("battery","kitchen-door","Door battery",{area:["kitchen"]},{entity_id:"sensor.kitchen_door_battery"}),
    source("battery","unassigned","Loose battery",{},{entity_id:"sensor.loose_battery"}),
    source("battery","missing-area","Moved battery",{area:["removed"]},{entity_id:"sensor.moved_battery"}),
    source("vacuum","robot","Robot vacuum",{area:["garage"]},{entity_id:"vacuum.robot"}),
    source("ups","backup","Network backup",{area:["office"]}),
    source("entity","temperature","Temperature",{domain:["sensor"],device_class:["temperature"],area:["office"],label:["climate"]},{entity_id:"sensor.office_temperature"}),
    source("entity","thermostat","Heating",{domain:["climate"],area:["garage"],label:["climate"]},{entity_id:"climate.garage"}),
    source("entity","humidity","Humidity",{domain:["sensor"],device_class:["humidity"],area:["kitchen"]},{entity_id:"sensor.kitchen_humidity"}),
    source("entity","camera","Porch camera",{domain:["camera"],area:["garage"]},{entity_id:"camera.porch"}),
    source("entity","smoke","Smoke detector",{domain:["binary_sensor"],device_class:["smoke"],area:["kitchen"]},{entity_id:"binary_sensor.smoke"}),
  ];
  const policy=newMonitoringPolicy([],type),field=mode==="selected"?type.startsWith("ups_")?"device":"entity":mode;
  policy.match={...policy.match,...(mode==="all"?{}:{[field]:values})};
  const settings=notificationSettings();settings.monitoring_policies=[policy];
  const card={sourceSelection:{id:policy.id,query:"",selectedOnly:false},current:{status:"current",data:{schema_version:3,catalog_loaded:true,available:true,inventory:{nodes:[],catalog:{candidates:rows}}}},configuration:{revision:"one",settings:structuredClone(settings),areas,floors,labels},settingsDraft:settings};
  return {card,policy,rows};
}
function edit(card,policy,field,value,extra={}) {
  const element={dataset:{definitionKind:"policies",definitionId:policy.id,definitionField:field,...extra},type:typeof value==="boolean"?"checkbox":"select-one",value:String(value),checked:value};
  let invalidated=0,rendered=0;
  assert.equal(editSourceSelection(card,{type:field==="source-forget"?"click":field==="source-search"?"input":"change"},element,()=>invalidated++,()=>rendered++),true);
  return {invalidated,rendered};
}
const inputFor=(html,id)=>[...html.matchAll(/<input\b[^>]*data-definition-field="source-choice"[^>]*>/g)].map(match=>match[0]).find(input=>input.includes(`data-definition-value="${id}"`));

for(const category of Object.keys(SOURCE_CATEGORIES).filter(key=>key!=="any"))test(`${category} is saved as an empty focused scope and survives renaming and duplication`,()=>{
  const policy=newMonitoringPolicy([],"entity",null,category);
  assert.equal(sourceCategory(policy),category);
  assert.deepEqual(policy.match.entity,[]);
  assert.equal(policy.enabled,false);
  assert.equal(futureMode(policy),"selected");
  const renamed={...structuredClone(policy),name:"Whatever the owner calls it"};
  const duplicate={...structuredClone(renamed),id:"independent",name:"Other name",enabled:false};
  assert.equal(sourceCategory(renamed),category);assert.equal(sourceCategory(duplicate),category);
  assert.deepEqual(duplicate.match,policy.match);assert.deepEqual(duplicate.parameters,policy.parameters);
});
for(const [category,{match}] of Object.entries(SOURCE_CATEGORIES).filter(([key])=>key!=="any"))test(`saved ${category} metadata expression identifies its category independently of names and ids`,()=>{
  const policy={check:"availability",id:"custom",name:"Renamed",match:{kind:["entity"]},match_any:[structuredClone(match)]};
  if(policy.match_any[0].device_class)policy.match_any[0].device_class.reverse();
  assert.equal(sourceCategory(policy),category);
  assert.equal(sourceCategory({...policy,name:"General",id:"default_entities"}),category);
  assert.equal(sourceCategory({...policy,match_none:[{domain:["light"]}]}),"any");
  assert.equal(sourceCategory({...policy,match_any:[...policy.match_any,{domain:["light"]}]}),"any");
  assert.equal(sourceCategory({...policy,match:{kind:["entity"],domain:["light"]}}),"any");
});
test("a familiar policy name never converts an unrestricted or custom legacy scope to a focused category",()=>{
  const policy={...newMonitoringPolicy([],"entity"),name:"Cameras",id:"default_cameras"};
  assert.equal(sourceCategory(policy),"any");policy.match={kind:["entity"],domain:["camera","lock"]};
  assert.equal(sourceCategory(policy),"any");
});
for(const [type,id,context] of [["battery","battery:registry:kitchen-motion","Kitchen · Ground floor"],["vacuum","vacuum:registry:robot","Garage · Ground floor"],["ups_power","ups:backup","Office · Upstairs"],["thermostat","entity:registry:thermostat","Garage · Ground floor"],["temperature_limit","entity:registry:temperature","Office · Upstairs"]])test(`${type} flat choices retain suitable equipment and location context`,()=>{
  const {card,policy}=fixture(type),row=flatSourceRows(card,policy).find(item=>item.id===id);
  assert.ok(row);assert.equal(row.area,context);
  if(["temperature_limit","thermostat"].includes(type))assert.deepEqual(flatSourceRows(card,policy).map(row=>row.id),[id]);
});
test("missing location assignments remain distinct from unavailable assigned areas",()=>{
  const {card,policy}=fixture(),rows=flatSourceRows(card,policy);
  assert.equal(rows.find(row=>row.id==="battery:registry:unassigned").area,"No area assigned");
  assert.equal(rows.find(row=>row.id==="battery:registry:missing-area").area,"Area unavailable");
});
test("a checked flat source always means monitored while future matching and exclusions remain saved",()=>{
  const {card,policy,rows}=fixture("battery","all");policy.excluded_sources=["battery:registry:kitchen-motion","battery:registry:removed"];
  const html=flatSourceSelection(card,policy);
  assert.doesNotMatch(inputFor(html,rows[0].node_id),/ checked/);assert.match(inputFor(html,rows[1].node_id),/ checked/);
  edit(card,policy,"source-choice",true,{definitionValue:rows[0].node_id});
  assert.equal(sourceSelected(policy,rows[0]),true);assert.deepEqual(policy.excluded_sources,["battery:registry:removed"]);
  edit(card,policy,"source-choice",false,{definitionValue:rows[1].node_id});
  assert.equal(sourceSelected(policy,rows[1]),false);assert.deepEqual(policy.excluded_sources,["battery:registry:removed",rows[1].node_id]);assert.equal(futureMode(policy),"all");
});
test("changing to selected future coverage freezes current effective membership and keeps saved missing choices",()=>{
  const {card,policy,rows}=fixture("battery","all");policy.excluded_sources=[rows[0].node_id,"battery:registry:missing"];
  const before=rows.filter(row=>sourceSelected(policy,row)).map(row=>row.node_id);
  edit(card,policy,"source-future","selected");assert.equal(futureMode(policy),"selected");
  assert.deepEqual(rows.filter(row=>sourceSelected(policy,row)).map(row=>row.node_id),before);assert.deepEqual(policy.excluded_sources,[rows[0].node_id,"battery:registry:missing"]);
  rows.push(source("battery","later","Later battery"));assert.equal(sourceSelected(policy,rows.at(-1)),false);
  edit(card,policy,"source-future","all");assert.equal(sourceSelected(policy,rows.at(-1)),true);assert.deepEqual(policy.excluded_sources,[rows[0].node_id,"battery:registry:missing"]);
});
test("area and label future coverage retain only eligible groups plus saved exceptions",()=>{
  const {card,policy,rows}=fixture("battery","area",["kitchen","empty"]);policy.excluded_sources=[rows[1].node_id];
  const before=structuredClone(policy),html=flatSourceSelection(card,policy);
  assert.match(html,/data-definition-field="source-group" data-definition-value="empty" checked/);assert.match(html,/Spare room/);
  assert.deepEqual(flatSourceRows(card,policy).map(row=>row.id).sort(),[rows[0].node_id,rows[1].node_id,rows[2].node_id].sort());assert.deepEqual(policy,before);
  edit(card,policy,"source-group",false,{definitionValue:"empty"});assert.deepEqual(policy.match.area,["kitchen"]);
  edit(card,policy,"source-future","label");assert.deepEqual(policy.match.label,[]);assert.equal(policy.match.area,undefined);
  edit(card,policy,"source-group",true,{definitionValue:"safety"});assert.deepEqual(policy.match.label,["safety"]);
  assert.equal(sourceSelected(policy,rows[0]),true);assert.equal(sourceSelected(policy,rows[1]),false);
});
test("location groups count eligible unavailable sources and keep empty saved groups without changing scope",()=>{
  const {card,policy}=fixture("battery","area",["empty"]),before=structuredClone(policy);
  const html=flatSourceSelection(card,policy);
  assert.match(html,/Kitchen[\s\S]*?2 eligible batteries/);assert.match(html,/Garage[\s\S]*?1 eligible batteries/);
  assert.match(html,/data-definition-value="empty" checked/);assert.doesNotMatch(html,/data-definition-value="office"/);
  assert.deepEqual(edit(card,policy,"source-show-all",true),{invalidated:0,rendered:1});
  assert.match(flatSourceSelection(card,policy),/data-definition-value="office"/);assert.deepEqual(policy,before);
});
for(const query of ["Kitchen","sensor.kitchen_motion_battery","Ground floor"])test(`flat source search matches ${query} without changing selections`,()=>{
  const {card,policy}=fixture(),before=structuredClone(policy);
  assert.deepEqual(edit(card,policy,"source-search",query),{invalidated:0,rendered:1});
  const html=flatSourceSelection(card,policy);assert.ok(inputFor(html,"battery:registry:kitchen-motion"));assert.equal(inputFor(html,"battery:registry:missing-area"),undefined);assert.deepEqual(policy,before);
});
test("monitored-only filtering uses effective positive selection without rewriting exclusions",()=>{
  const {card,policy,rows}=fixture("battery","all");policy.excluded_sources=[rows[0].node_id];
  const before=structuredClone(policy);edit(card,policy,"source-selected-only",true);const html=flatSourceSelection(card,policy);
  assert.equal(inputFor(html,rows[0].node_id),undefined);assert.ok(inputFor(html,rows[1].node_id));assert.deepEqual(policy,before);
});
test("focused availability retains outside-category inclusions and missing choices without rewriting detection settings",()=>{
  const {card,policy,rows}=fixture("entity");policy.match={kind:["entity"],domain:["camera"],entity:[]};policy.parameters={duration_seconds:300};
  policy.included_sources=["entity:registry:temperature","entity:registry:gone"];policy.excluded_sources=["entity:registry:removed"];
  const before=structuredClone(policy),choices=flatSourceRows(card,policy);
  assert.deepEqual(choices.map(row=>row.id).sort(),["entity:registry:camera","entity:registry:temperature","entity:registry:gone","entity:registry:removed"].sort());
  assert.equal(choices.find(row=>row.id==="entity:registry:temperature").selected,true);assert.equal(choices.find(row=>row.id==="entity:registry:camera").selected,false);assert.deepEqual(policy,before);
  edit(card,policy,"source-choice",true,{definitionValue:"entity:registry:camera"});assert.equal(sourceSelected(policy,rows.find(row=>row.node_id==="entity:registry:camera")),true);
  assert.deepEqual(policy.parameters,{duration_seconds:300});assert.equal(sourceCategory(policy),"cameras");assert.ok(policy.included_sources.includes("entity:registry:temperature"));
});
test("saved unavailable exact choices and exceptions remain identifiable and removable",()=>{
  const {card,policy}=fixture("battery","selected",["registry:gone"]);policy.excluded_sources=["battery:registry:removed"];
  assert.match(flatSourceSelection(card,policy),/battery:registry:gone/);assert.match(flatSourceSelection(card,policy),/battery:registry:removed/);
  edit(card,policy,"source-forget",null,{definitionValue:"battery:registry:gone",sourceRef:"registry:gone"});assert.deepEqual(policy.match.entity,[]);assert.deepEqual(policy.excluded_sources,["battery:registry:removed"]);
  edit(card,policy,"source-forget",null,{definitionValue:"battery:registry:removed"});assert.equal(policy.excluded_sources,undefined);
});
for(const status of ["loading","stale"])test(`${status} catalogs disable membership changes and preserve saved choices`,()=>{
  const {card,policy,rows}=fixture("battery","selected",["registry:kitchen-motion"]);
  if(status==="loading")card.current.data.catalog_loaded=false;else card.current.data.catalog_stale=true;
  card.current.catalogError="Could not read <catalog>";const before=structuredClone(policy),html=flatSourceSelection(card,policy);
  assert.match(html,/Could not (?:load|update) available sources: Could not read &lt;catalog&gt;/);assert.match(html,/data-action="retry-catalog"/);assert.match(html,/data-definition-field="source-future" disabled/);
  edit(card,policy,"source-choice",false,{definitionValue:rows[0].node_id});edit(card,policy,"source-future","all");assert.deepEqual(policy,before);
});
test("a large focused list remains one searchable list without pagination or a Done dialog",()=>{
  const {card,policy,rows}=fixture();for(let number=0;number<65;number++)rows.push(source("battery",`extra-${number}`,`Extra battery ${number}`));
  const before=structuredClone(policy),html=flatSourceSelection(card,policy);
  assert.equal((html.match(/data-definition-field="source-choice"/g)||[]).length,70);assert.doesNotMatch(html,/Show 50 more|>Done<|type="radio"|policy-picker/);assert.deepEqual(policy,before);
});
test("source aliases resolve to one canonical equipment choice",()=>{
  const {card,policy,rows}=fixture();card.current.data.inventory.nodes=[{...rows[0],node_id:"policy:one",monitoring_source:rows[0].node_id},{...rows[0],node_id:"policy:two",monitoring_source:rows[0].node_id}];
  assert.equal(flatSourceRows(card,policy).filter(row=>row.id===rows[0].node_id).length,1);
});

test("focused entity categories use the same complete location context as other flat lists",()=>{
  const {card,policy}=fixture("entity");policy.match={kind:["entity"],domain:["camera"]};
  const [camera]=flatSourceRows(card,policy);
  assert.equal(camera.area,"Garage · Ground floor");
});

test("a missing source saved in both exact scope and exclusions appears once and can be fully removed",()=>{
  const {card,policy}=fixture("battery","selected",["registry:gone"]);policy.excluded_sources=["battery:registry:gone"];
  assert.equal(flatSourceRows(card,policy).filter(row=>row.id==="battery:registry:gone").length,1);
  edit(card,policy,"source-forget",null,{definitionValue:"battery:registry:gone",sourceRef:"registry:gone"});
  assert.deepEqual(policy.match.entity,[]);assert.equal(policy.excluded_sources,undefined);
});

test("a saved device exclusion remains truthful for a flat battery selection until explicitly removed",()=>{
  const {card,policy,rows}=fixture("battery","all");rows[0].attributes.device=["parent"];
  policy.excluded_sources=["device:parent"];
  assert.equal(sourceSelected(policy,rows[0]),false);
  const html=flatSourceSelection(card,policy),input=inputFor(html,rows[0].node_id);
  assert.doesNotMatch(input,/ checked/);assert.match(input,/ disabled/);
  const before=structuredClone(policy);edit(card,policy,"source-choice",true,{definitionValue:rows[0].node_id});
  assert.deepEqual(policy,before);
  edit(card,policy,"source-forget",null,{definitionValue:"device:parent"});
  assert.equal(sourceSelected(policy,rows[0]),true);
});

test("missing exact integration connections retain entry identities and appear once with saved exclusions",()=>{
  const {card,policy}=fixture("integration","all");policy.match.integration=["gone"];policy.excluded_sources=["entry:gone"];
  const missing=flatSourceRows(card,policy);
  assert.equal(missing.length,1);assert.equal(missing[0].id,"entry:gone");
  edit(card,policy,"source-forget",null,{definitionValue:missing[0].id,sourceRef:missing[0].ref});
  assert.deepEqual(policy.match.integration,[]);assert.equal(policy.excluded_sources,undefined);
});

test("forgetting a known exact source outside its saved area removes the exact choice as well as its exclusion",()=>{
  const {card,policy,rows}=fixture("battery","area",["garage"]);
  policy.match.entity=["registry:kitchen-motion"];policy.excluded_sources=[rows[0].node_id];
  assert.equal(flatSourceRows(card,policy).find(row=>row.id===rows[0].node_id).outsideScope,true);
  edit(card,policy,"source-forget",null,{definitionValue:rows[0].node_id});
  assert.deepEqual(policy.match.entity,[]);assert.equal(policy.excluded_sources,undefined);
});

test("a known exact source outside its saved area stays visible and removable without an exclusion",()=>{
  const {card,policy,rows}=fixture("battery","area",["garage"]);policy.match.entity=["registry:kitchen-motion"];
  const before=structuredClone(policy),row=flatSourceRows(card,policy).find(row=>row.id===rows[0].node_id);
  assert.ok(row);assert.equal(row.outsideScope,true);assert.equal(row.selected,false);
  assert.deepEqual(policy,before);
});
