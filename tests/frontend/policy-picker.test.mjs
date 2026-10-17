import test from "node:test";
import assert from "node:assert/strict";
import {editReusable,namedPolicies,newMonitoringPolicy,policySelectionChoices} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

const areas=[{id:"kitchen",name:"Kitchen",floor_id:"ground"},{id:"garage",name:"Garage",floor_id:"ground"},{id:"office",name:"Office",floor_id:"upper"},{id:"empty",name:"Spare room",floor_id:"upper"}];
const floors=[{id:"ground",name:"Ground floor"},{id:"upper",name:"Upstairs"}];
const labels=[{id:"safety",name:"Safety"},{id:"climate",name:"Climate"},{id:"future",name:"Future equipment"}];
function source(kind,id,name,attributes={},extra={}) {
  return {node_id:`${kind}:${id}`,name,kind,attributes:{kind:[kind],...(kind==="device"||kind==="ups"?{device:[id]}:{entity:[`registry:${id}`]}),...attributes},watched:false,attached_by:[],requirements:[],...extra};
}
function fixture(type="battery",mode="selected",values=[]) {
  const rows=[
    source("battery","kitchen-motion","Motion sensor battery",{area:["kitchen"],label:["safety"]},{entity_id:"sensor.kitchen_motion_battery",state:"unavailable"}),
    source("battery","garage-motion","Motion sensor battery",{area:["garage"],label:["safety"]},{entity_id:"sensor.garage_motion_battery",state:"unknown"}),
    source("battery","kitchen-door","Door battery",{area:["kitchen"]},{entity_id:"sensor.kitchen_door_battery"}),
    source("battery","unassigned","Loose battery",{},{entity_id:"sensor.loose_battery"}),
    source("battery","missing-area","Moved battery",{area:["removed"]},{entity_id:"sensor.moved_battery"}),
    source("device","kitchen-device","Motion sensor",{area:["kitchen"]}),
    source("device","garage-device","Motion sensor",{area:["garage"]}),
    source("vacuum","robot","Robot vacuum",{area:["garage"]},{entity_id:"vacuum.robot"}),
    source("ups","backup","Network backup",{area:["office"]}),
    source("entity","temperature","Temperature",{domain:["sensor"],device_class:["temperature"],area:["office"],label:["climate"]},{entity_id:"sensor.office_temperature"}),
    source("entity","thermostat","Heating",{domain:["climate"],area:["garage"],label:["climate"]},{entity_id:"climate.garage"}),
    source("entity","humidity","Humidity",{domain:["sensor"],device_class:["humidity"],area:["kitchen"]},{entity_id:"sensor.kitchen_humidity"}),
  ];
  const policy=newMonitoringPolicy([],type),field=mode==="selected"?type.startsWith("ups_")||type==="device"?"device":"entity":mode;
  policy.match={kind:policy.match.kind,[field]:values};
  const settings=notificationSettings();settings.monitoring_policies=[policy];
  const card={page:"policies",definitionSelection:{kind:"policies",id:policy.id},policyPicker:{id:policy.id,query:"",selectedOnly:false,showAll:false},current:{status:"current",data:{schema_version:3,catalog_loaded:true,available:true,inventory:{nodes:[],catalog:{candidates:rows}}}},configuration:{revision:"one",settings:structuredClone(settings),areas,floors,labels,delivery_targets:[]},settingsDraft:settings,main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){}};
  return {card,policy,rows};
}
const choiceIds=html=>[...html.matchAll(/data-definition-value="([^"]+)"/g)].map(match=>match[1]);
const contextFor=(card,policy,id)=>policySelectionChoices(card,policy,"selected").find(item=>item.id===id)?.context;

function householdFixture() {
  const {card,policy}=fixture("device","all");
  const rows=[];let kindReads=0;
  for(let device=0;device<600;device++) {
    const id=`household-${String(device).padStart(3,"0")}`,name=`Equipment ${String(device).padStart(3,"0")}`;
    rows.push(source("device",id,name,{area:["kitchen"]}));
    for(let member=0;member<10;member++)rows.push(source("entity",`${id}-${member}`,`Reading ${member}`,{device:[id],area:["kitchen"]},{entity_id:`sensor.${id}_${member}`}));
  }
  for(const row of rows){const kind=row.kind;Object.defineProperty(row,"kind",{enumerable:true,get(){kindReads++;return kind;}});}
  card.current.data.inventory={nodes:[],catalog:{candidates:rows}};card.policyPicker=null;
  return {card,policy,rows,reads:()=>kindReads,resetReads:()=>{kindReads=0;}};
}

test("closed household device editors resolve only selected choices and reuse linear catalog indexing",()=>{
  const {card,policy,rows,reads,resetReads}=householdFixture();
  namedPolicies(card);
  assert.equal(reads(),0,"An editor with no selected or ignored sources needs no choice inventory");
  policy.excluded_sources=["entity:household-599-9"];
  const html=namedPolicies(card);
  assert.match(html,/Equipment 599/);
  assert.match(html,/Reading 9/);
  assert.ok(reads()<rows.length*20,`Cold source indexing must remain linear; read kind ${reads()} times for ${rows.length} rows`);
  resetReads();
  for(let update=0;update<5;update++) {
    card.current.data={...card.current.data,updated_at:String(update)};
    policy.name=`Device policy ${update}`;
    namedPolicies(card);
  }
  assert.ok(reads()<20,"Evidence updates and typing must reuse the source index");
  const replacement=rows.map(row=>({...row,name:row.node_id==="device:household-599"?"Renamed equipment":row.name}));
  card.current.data.inventory={nodes:[],catalog:{candidates:replacement}};
  assert.match(namedPolicies(card),/Renamed equipment/);
  card.configuration.areas=areas.map(area=>({...area,name:area.id==="kitchen"?"New kitchen":area.name}));
  assert.match(namedPolicies(card),/New kitchen/);
});

test("household source pickers bound rows while searching all sources and retaining unavailable selections",()=>{
  const {card,policy}=householdFixture();
  const selected="entity:household-599-9",missing="entity:removed-member";
  policy.excluded_sources=[selected,missing];
  card.policyPicker={id:policy.id,ignored:true,query:"",selectedOnly:false,showAll:false};
  let html=namedPolicies(card);
  assert.equal(choiceIds(html).length,50);
  assert.ok(choiceIds(html).includes(missing),"Unavailable saved selections stay visible for repair");
  assert.match(html,/Showing 50 of 6001/);
  const action={dataset:{definitionAction:"more-choices",definitionKind:"policies",definitionId:policy.id},closest(){return this;}};
  editReusable(card,{type:"click",target:action});
  assert.equal(choiceIds(namedPolicies(card)).length,100);
  const search={dataset:{definitionPickerSearch:""},value:"sensor.household-599_9"};
  editReusable(card,{type:"input",target:search});
  html=namedPolicies(card);
  assert.deepEqual(choiceIds(html).sort(),[missing,selected].sort());
  assert.match(html,/data-definition-value="entity:household-599-9" checked/);
  assert.equal(card.policyPicker.limit,50,"Changing search starts with a bounded result set");
  editReusable(card,{type:"input",target:{...search,value:""}});
  editReusable(card,{type:"change",target:{dataset:{definitionPickerSelected:""},checked:true}});
  assert.deepEqual(choiceIds(namedPolicies(card)).sort(),[missing,selected].sort());
  assert.deepEqual(policy.excluded_sources,[selected,missing],"Searching and paging never change selections");
});

for(const [type,id] of [["battery","registry:kitchen-motion"],["device","kitchen-device"],["vacuum","registry:robot"],["ups_power","backup"],["thermostat","registry:thermostat"],["temperature_limit","registry:temperature"]])test(`${type} choices identify their effective area`,()=>{
  const {card,policy}=fixture(type),choice=policySelectionChoices(card,policy,"selected").find(item=>item.id===id);
  assert.ok(choice);
  assert.match(choice.context,/Kitchen|Garage|Office/);
  assert.match(choice.context,/Ground floor|Upstairs/);
});

test("missing location assignment and unavailable area metadata remain distinct",()=>{
  const {card,policy}=fixture();
  assert.equal(contextFor(card,policy,"registry:unassigned"),"No area assigned");
  assert.equal(contextFor(card,policy,"registry:missing-area"),"Area unavailable");
});

test("same-name sources use area first and show an identifier only for remaining collisions",()=>{
  const {card,policy,rows}=fixture();
  assert.ok(!policySelectionChoices(card,policy,"selected").find(item=>item.id==="registry:kitchen-motion").detail);
  rows.push(source("battery","another-kitchen-motion","Motion sensor battery",{area:["kitchen"]},{entity_id:"sensor.other_kitchen_motion_battery"}));
  card.current.data.inventory.catalog={candidates:rows};
  const choices=policySelectionChoices(card,policy,"selected");
  assert.equal(choices.find(item=>item.id==="registry:kitchen-motion").detail,"sensor.kitchen_motion_battery");
  assert.equal(choices.find(item=>item.id==="registry:another-kitchen-motion").detail,"sensor.other_kitchen_motion_battery");
  assert.ok(!choices.find(item=>item.id==="registry:garage-motion").detail);
});

test("area and label counts use matching sources regardless of current readings",()=>{
  const {card,policy}=fixture();
  assert.deepEqual(Object.fromEntries(policySelectionChoices(card,policy,"area").map(item=>[item.id,item.count])),{kitchen:2,garage:1,office:0,empty:0});
  assert.deepEqual(Object.fromEntries(policySelectionChoices(card,policy,"label").map(item=>[item.id,item.count])),{safety:2,climate:0,future:0});
});

for(const [type,area] of [["vacuum","garage"],["ups_power","office"],["thermostat","garage"],["temperature_limit","office"]])test(`${type} areas only count suitable equipment`,()=>{
  const {card,policy}=fixture(type);
  assert.deepEqual(policySelectionChoices(card,policy,"area").filter(item=>item.count>0).map(item=>item.id),[area]);
});

test("selected empty areas remain repairable and other empty choices require Show all areas",()=>{
  const {card}=fixture("battery","area",["empty"]);
  const before=structuredClone(card.settingsDraft),html=namedPolicies(card);
  assert.deepEqual(choiceIds(html).sort(),["empty","garage","kitchen"]);
  assert.match(html,/No batteries currently found/);
  assert.match(html,/Show all areas/);
  card.policyPicker.showAll=true;
  assert.deepEqual(choiceIds(namedPolicies(card)).sort(),["empty","garage","kitchen","office"]);
  assert.deepEqual(card.settingsDraft,before);
});

test("label filtering preserves selected empty labels and offers other labels explicitly",()=>{
  const {card}=fixture("battery","label",["future"]);
  assert.deepEqual(choiceIds(namedPolicies(card)).sort(),["future","safety"]);
  assert.match(namedPolicies(card),/Show all labels/);
  card.policyPicker.showAll=true;
  assert.deepEqual(choiceIds(namedPolicies(card)).sort(),["climate","future","safety"]);
});

for(const query of ["Kitchen","sensor.kitchen_motion_battery","Motion sensor"])test(`source picker searches ${query}`,()=>{
  const {card}=fixture();card.policyPicker.query=query;
  assert.ok(choiceIds(namedPolicies(card)).includes("registry:kitchen-motion"));
  assert.ok(!choiceIds(namedPolicies(card)).includes("registry:missing-area"));
});

test("source selections retain location in the closed picker summary",()=>{
  const {card}=fixture("battery","selected",["registry:kitchen-motion","registry:garage-motion"]);card.policyPicker=null;
  const html=namedPolicies(card);
  assert.match(html,/Motion sensor battery/);assert.match(html,/Kitchen/);assert.match(html,/Garage/);
});

test("incomplete catalog produces unknown counts and loading rather than false emptiness",()=>{
  const {card,policy}=fixture("battery","area",["empty"]);card.current.data.catalog_loaded=false;
  assert.ok(policySelectionChoices(card,policy,"area").every(item=>item.count===null));
  const html=namedPolicies(card);
  assert.match(html,/Loading available sources/);
  assert.doesNotMatch(html,/No batteries currently found|No matching choices/);
  assert.deepEqual(policy.match.area,["empty"]);
});

test("stale complete catalog keeps useful choices and retry state without changing selections",()=>{
  const {card}=fixture("battery","area",["empty"]);card.current.data.catalog_stale=true;card.current.catalogError="Synthetic refresh failure";
  const html=namedPolicies(card);
  assert.match(html,/Synthetic refresh failure/);assert.match(html,/Retry loading sources/);
  assert.deepEqual(choiceIds(html).sort(),["empty","garage","kitchen"]);
  assert.match(html,/2 batteries \(last known\)|1 battery \(last known\)/);
  assert.match(html,/No batteries in last loaded list/);
  assert.doesNotMatch(html,/No batteries currently found/);
  assert.deepEqual(card.settingsDraft.monitoring_policies[0].match.area,["empty"]);
});

test("Show all is picker state and never changes the policy draft",()=>{
  const {card}=fixture("battery","area"),before=structuredClone(card.settingsDraft);
  const target={dataset:{definitionPickerAll:""},checked:true,type:"checkbox"};
  assert.equal(editReusable(card,{type:"change",target}),true);
  assert.equal(card.policyPicker.showAll,true);
  assert.deepEqual(card.settingsDraft,before);
});

test("availability group counts exclude disabled and diagnostic sources without hiding exact entity options",()=>{
  const {card,policy,rows}=fixture("entity");
  rows.push(source("entity","disabled","Disabled temperature",{area:["empty"],label:["future"]},{disabled:true}));
  rows.push(source("entity","diagnostic","Diagnostic value",{area:["empty"],label:["future"],entity_category:["diagnostic"]}));
  rows.push(source("entity","configuration","Configuration value",{area:["empty"],label:["future"],entity_category:["config"]}));
  card.current.data.inventory.catalog={candidates:rows};
  assert.equal(policySelectionChoices(card,policy,"area").find(item=>item.id==="empty").count,0);
  assert.equal(policySelectionChoices(card,policy,"label").find(item=>item.id==="future").count,0);
  assert.ok(policySelectionChoices(card,policy,"selected").some(item=>item.id==="registry:diagnostic"));
});

test("multiple policy aliases count the same source only once",()=>{
  const {card,policy,rows}=fixture();
  card.current.data.inventory.nodes=[{...rows[0],node_id:"policy:battery:one",monitoring_source:rows[0].node_id},{...rows[0],node_id:"policy:battery:two",monitoring_source:rows[0].node_id}];
  assert.equal(policySelectionChoices(card,policy,"area").find(item=>item.id==="kitchen").count,2);
  assert.equal(policySelectionChoices(card,policy,"label").find(item=>item.id==="safety").count,2);
  assert.equal(policySelectionChoices(card,policy,"selected").filter(item=>item.id==="registry:kitchen-motion").length,1);
});

test("exclusion choices retain area context and exact source identity",()=>{
  const {card,policy}=fixture("device");
  const choices=policySelectionChoices(card,policy,"all_except");
  assert.ok(choices.some(item=>item.id==="device:kitchen-device"&&item.context==="Kitchen · Ground floor"));
  assert.ok(choices.some(item=>item.id==="device:garage-device"&&item.context==="Garage · Ground floor"));
});

test("device area counts require operational members but exact device choices remain available",()=>{
  const {card,policy}=fixture("device");
  card.current.data.inventory.catalog={candidates:[
    source("device","working","Kitchen equipment",{area:["kitchen"],label:["safety"]},{availability_entities:["switch.kitchen"]}),
    source("device","no-members","Empty equipment",{area:["empty"],label:["future"]},{availability_entities:[]}),
    source("device","disabled","Disabled equipment",{area:["office"],label:["climate"]},{disabled:true,availability_entities:["switch.office"]}),
  ]};
  assert.deepEqual(policySelectionChoices(card,policy,"area").filter(item=>item.count>0).map(item=>item.id),["kitchen"]);
  assert.deepEqual(policySelectionChoices(card,policy,"label").filter(item=>item.count>0).map(item=>item.id),["safety"]);
  assert.ok(policySelectionChoices(card,policy,"selected").some(item=>item.id==="no-members"));
});

test("duplicate entity IDs fall back to distinct registry identities",()=>{
  const {card,policy,rows}=fixture();
  rows.push(source("battery","replacement","Motion sensor battery",{area:["kitchen"]},{entity_id:"sensor.kitchen_motion_battery"}));
  card.current.data.inventory.catalog={candidates:rows};
  const choices=policySelectionChoices(card,policy,"selected"),original=choices.find(item=>item.id==="registry:kitchen-motion"),replacement=choices.find(item=>item.id==="registry:replacement");
  assert.notEqual(original.detail,replacement.detail);
  assert.ok(original.detail.includes(original.id));
  assert.ok(replacement.detail.includes(replacement.id));
});

test("selected equipment keeps canonical names when several policies decorate its check labels",()=>{
  const {card,policy,rows}=fixture("temperature_limit","selected",["registry:temperature"]);
  const original=rows.find(source=>source.attributes.entity?.includes("registry:temperature"));
  card.current.data.inventory.nodes=[{...original,node_id:"policy:availability:temperature",monitoring_source:original.node_id,name:"Temperature · Entities",watched:true},{...original,node_id:"policy:other:temperature",monitoring_source:original.node_id,name:"Temperature · Another policy",watched:true}];
  card.policyPicker=null;
  const before=structuredClone(policy),choices=policySelectionChoices(card,policy,"selected"),html=namedPolicies(card);
  assert.equal(choices.filter(item=>item.id==="registry:temperature").length,1);
  assert.equal(choices.find(item=>item.id==="registry:temperature").name,"Temperature");
  assert.match(html,/<h3>Temperature sensors<\/h3>/);
  assert.match(html,/<legend>Include<\/legend>/);
  assert.match(html,/policy-selected-sources[^>]*><li><span>Temperature<\/span><span class="small">Office · Upstairs<\/span>/);
  assert.doesNotMatch(html,/Temperature · Entities|Temperature · Another policy|What to watch|<span>Watch<|<h1>Edit policy:/);
  assert.match(html,/aria-label="Choose temperature sensors"[^>]*>Change selection<\/button>/);
  assert.deepEqual(policy,before);
});

test("selected sources remain individually readable beyond two choices and missing selections stay identifiable",()=>{
  const {card,policy}=fixture("battery","selected",["registry:kitchen-motion","registry:garage-motion","registry:kitchen-door","registry:removed"]);
  card.policyPicker=null;
  const before=structuredClone(policy),html=namedPolicies(card),list=html.match(/<ul class="policy-selected-sources"[^>]*>(.*?)<\/ul>/)[1];
  assert.equal((list.match(/<li>/g)||[]).length,4);
  assert.match(list,/Motion sensor battery<\/span><span class="small">Kitchen · Ground floor/);
  assert.match(list,/Motion sensor battery<\/span><span class="small">Garage · Ground floor/);
  assert.match(list,/Door battery/);
  assert.match(list,/Unavailable selection<\/span><span class="small">registry:removed/);
  assert.doesNotMatch(list,/\+\d+ more/);
  assert.deepEqual(policy,before);
});

for(const missing of ["current","data","catalog"])test(`selected sources remain visible while ${missing} is unavailable`,()=>{
  const {card,policy}=fixture("temperature_limit","selected",["registry:temperature"]);
  card.policyPicker=null;
  ({current:()=>{card.current=null;},data:()=>{card.current.data=null;},catalog:()=>{delete card.current.data.inventory.catalog;}})[missing]();
  const before=structuredClone(policy),html=namedPolicies(card);
  assert.match(html,/Loading available sources/);
  assert.match(html,/Saved selection<\/span><span class="small">registry:temperature/);
  assert.deepEqual(policy,before);
});
