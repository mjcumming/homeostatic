import assert from "node:assert/strict";
import test from "node:test";
import {editReusable,emptyNotificationDefinitions,namedPolicies,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {entitySelected,entitySelectionRows} from "../../custom_components/homeostatic/frontend/entity-selection.mjs";
import {saveScopedConfiguration,scopedDirty} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";

const entity=(id,domain="camera")=>({node_id:`entity:registry:${id}`,kind:"entity",name:id,entity_id:`${domain}.${id}`,attributes:{kind:["entity"],entity:[`registry:${id}`],domain:[domain],integration_domain:["example"]}});
function fixture(policy=newMonitoringPolicy([],"entity")) {
  const settings={monitoring_policies:[policy],notification_definitions:emptyNotificationDefinitions(),notifications:false,recovery_seconds:45};
  const calls=[],rows=[entity("door"),entity("hall"),entity("front","lock")];
  let confirmed=structuredClone(settings);
  const card={page:"policies",definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:{schema_version:3,catalog_loaded:true,inventory:{nodes:[],catalog:{candidates:rows}}}},
    editors:{configuration:{revision:"one",settings:structuredClone(settings)},settingsDraft:structuredClone(settings)},
    main:{querySelector:()=>null,querySelectorAll:()=>[]},render(){},_hass:{async callWS(request){
      calls.push(structuredClone(request));
      if(request.type==="homeostatic/save_settings"){confirmed=structuredClone(request.settings);return {saved:true};}
      return {revision:"two",settings:structuredClone(confirmed)};
    }}};
  namedPolicies(card);
  return {card,calls,rows,policy:card.editors.settingsDraft.monitoring_policies[0],scope:{kind:"policy",id:policy.id}};
}
function change(card,field,value,extra={}) {
  const target={dataset:{definitionKind:"policies",definitionId:card.definitionSelection.id,definitionField:field,...extra},value:String(value),checked:value,type:field.startsWith("parameters:")?"number":typeof value==="boolean"?"checkbox":"select-one"};
  assert.equal(editReusable(card,{type:"change",target}),true);
}
function click(card,action,id=card.definitionSelection.id) {
  const target={dataset:{definitionKind:"policies",definitionId:id,definitionAction:action},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}
const durationControl=card=>namedPolicies(card).match(/<input\b[^>]*data-definition-field="parameters:duration_seconds"[^>]*>/)?.[0];

test("new custom entity availability starts disabled and empty without enrolling later entities",async()=>{
  const {card,policy,rows,scope}=fixture();
  assert.equal(policy.enabled,false);assert.deepEqual(policy.match,{kind:["entity"],entity:[]});
  assert.ok(entitySelectionRows(card,policy).every(row=>!row.selected));
  const before=structuredClone(policy);namedPolicies(card);
  assert.deepEqual(policy,before);assert.match(namedPolicies(card),/New entities start unchecked/);
  change(card,"entity-search","door");
  assert.deepEqual(policy,before);
  rows.push(entity("new"));assert.equal(entitySelected(policy,rows.at(-1)),false);
  change(card,"name","Focused cameras");assert.equal(await saveScopedConfiguration(card,scope),true);
  assert.deepEqual(card.editors.configuration.settings.monitoring_policies[0].match.entity,[]);
  assert.ok(entitySelectionRows(card,card.editors.configuration.settings.monitoring_policies[0]).every(row=>!row.selected));
});

test("explicit selection and save retain only chosen entities and leave new entities unchecked",async()=>{
  const {card,policy,rows,scope}=fixture();
  change(card,"entity-choice",true,{definitionValue:"entity:registry:door"});
  assert.equal(entitySelected(policy,rows[0]),true);assert.equal(entitySelected(policy,rows[1]),false);
  assert.equal(await saveScopedConfiguration(card,scope),true);
  assert.deepEqual(card.editors.configuration.settings.monitoring_policies[0].included_sources,["entity:registry:door"]);
  rows.push(entity("future"));assert.equal(entitySelected(card.editors.configuration.settings.monitoring_policies[0],rows.at(-1)),false);
});

test("legacy absent availability wait renders effective zero without changing the saved policy",async()=>{
  const existing={...newMonitoringPolicy([],"entity"),match:{kind:["entity"]},enabled:true};
  const {card,policy,scope,calls}=fixture(existing),before=structuredClone(policy);
  assert.match(durationControl(card),/value="0"/);assert.match(namedPolicies(card),/Report unavailable after/);
  assert.deepEqual(policy,before);assert.equal(scopedDirty(card.editors,scope),false);
  change(card,"duration-unit:duration_seconds","hours");assert.equal(scopedDirty(card.editors,scope),false);
  change(card,"name","Renamed policy");assert.equal(await saveScopedConfiguration(card,scope),true);
  assert.deepEqual(calls[0].settings.monitoring_policies[0].parameters,{});
});

for(const [unit,value,seconds] of [["minutes",1.5,90],["hours",0.25,900],["seconds",61,61],["minutes",0,0],["hours",8760,31536000]])test(`availability wait saves ${value} ${unit} as ${seconds} seconds in its own scope`,async()=>{
  const {card,policy,scope,calls}=fixture();
  change(card,"duration-unit:duration_seconds",unit);change(card,"parameters:duration_seconds",value,{durationUnit:unit});
  assert.equal(policy.parameters.duration_seconds,seconds);assert.equal(await saveScopedConfiguration(card,scope),true);
  const settings=calls[0].settings;
  assert.equal(settings.monitoring_policies[0].parameters.duration_seconds,seconds);
  assert.equal(settings.notifications,false);assert.equal(settings.recovery_seconds,45);assert.equal(scopedDirty(card.editors,scope),false);
});

for(const value of ["",-1,0.5,31536001,NaN])test(`availability wait rejects ${String(value)||"blank"} with a nearby error before saving`,()=>{
  const {card,policy,calls}=fixture();change(card,"parameters:duration_seconds",value,{durationUnit:"seconds"});
  const before=structuredClone(policy);click(card,"save-scoped");
  assert.deepEqual(calls,[]);assert.deepEqual(policy,before);assert.match(card.editors.scopedError,/whole number of seconds/);
  assert.match(namedPolicies(card),/role="alert"/);assert.match(durationControl(card),/aria-invalid="true"/);
});

test("partial-minute availability waits start in seconds and presentation unit changes stay clean",()=>{
  const {card,policy,scope}=fixture({...newMonitoringPolicy([],"entity"),parameters:{duration_seconds:61}});
  assert.match(durationControl(card),/value="61"[^>]*data-duration-unit="seconds"/);
  change(card,"duration-unit:duration_seconds","hours");
  assert.equal(policy.parameters.duration_seconds,61);assert.equal(scopedDirty(card.editors,scope),false);
});

test("editing a wait retains the native number input until Save",()=>{
  const {card,policy}=fixture();let renders=0;card.render=()=>renders++;
  change(card,"parameters:duration_seconds",1.25,{durationUnit:"minutes"});
  assert.equal(renders,0);assert.equal(policy.parameters.duration_seconds,75);
});

test("policy summaries show their saved effective availability wait",()=>{
  const {card,policy}=fixture({...newMonitoringPolicy([],"entity"),parameters:{duration_seconds:300}});
  card.definitionSelection=null;
  assert.match(namedPolicies(card),/Unavailable for at least 5 minutes/);
  policy.parameters.duration_seconds=600;
  assert.match(namedPolicies(card),/Unavailable for at least 5 minutes/);assert.doesNotMatch(namedPolicies(card),/10 minutes/);
});

test("only overlapping enabled availability policies are linked with their independent waits",()=>{
  const {card,policy}=fixture({...newMonitoringPolicy([],"entity"),match:{kind:["entity"],entity:["registry:door"]},parameters:{duration_seconds:300}});
  const other={...newMonitoringPolicy([],"entity"),id:"important",name:"Important equipment",enabled:true,match:{kind:["entity"]}};
  card.editors.configuration.settings.monitoring_policies.push(other,{...other,id:"disabled",name:"Disabled coverage",enabled:false},{...other,id:"locks",name:"Locks",match:{kind:["entity"],domain:["lock"]}});
  assert.match(namedPolicies(card),/Other enabled policies also monitor selected entities/);
  assert.match(namedPolicies(card),/Important equipment: Unavailable without waiting/);assert.doesNotMatch(namedPolicies(card),/Disabled coverage|Locks:/);
  const before=structuredClone(card.editors.settingsDraft);click(card,"open-policy","important");
  assert.equal(card.definitionSelection.id,"important");assert.deepEqual(card.editors.settingsDraft,before);
  card.definitionSelection={kind:"policies",id:policy.id};policy.match.entity=[];
  assert.doesNotMatch(namedPolicies(card),/Other enabled policies/);
});

test("duplicate retains the saved scope and wait in an independent disabled policy",()=>{
  const {card,policy}=fixture({...newMonitoringPolicy([],"entity"),enabled:true,match:{kind:["entity"]},match_any:[{domain:["camera"]}],parameters:{duration_seconds:300},included_sources:["entity:registry:front"]});
  click(card,"duplicate");const copy=card.editors.settingsDraft.monitoring_policies.at(-1);
  assert.notEqual(copy.id,policy.id);assert.equal(copy.enabled,false);assert.deepEqual(copy.match,policy.match);
  assert.deepEqual(copy.match_any,policy.match_any);assert.deepEqual(copy.parameters,{duration_seconds:300});
  copy.match_any[0].domain.push("lock");assert.deepEqual(policy.match_any,[{domain:["camera"]}]);
});

test("integration availability has no entity wait control",()=>{
  const {card}=fixture(newMonitoringPolicy([],"integration"));assert.doesNotMatch(namedPolicies(card),/Report unavailable after/);
});

for(const match of [{},{kind:["entity","integration"]}])test(`legacy availability scope ${JSON.stringify(match)} has no entity wait and a rename preserves its scope and parameters`,async()=>{
  const {card,policy,calls}=fixture({...newMonitoringPolicy([],"entity"),match,enabled:true});
  assert.doesNotMatch(namedPolicies(card),/Report unavailable after|policy-duration/);
  card.definitionSelection=null;assert.doesNotMatch(namedPolicies(card),/Unavailable without waiting|Unavailable for at least/);
  card.definitionSelection={kind:"policies",id:policy.id};change(card,"name","Renamed legacy availability");click(card,"save-scoped");
  await new Promise(resolve=>setImmediate(resolve));
  const submitted=calls.find(request=>request.type==="homeostatic/save_settings");assert.ok(submitted);
  assert.deepEqual(submitted.settings.monitoring_policies[0].match,match);assert.deepEqual(submitted.settings.monitoring_policies[0].parameters,{});
});
