import assert from "node:assert/strict";
import test from "node:test";
import {leftOpenValidation,leftOpenFields,leftOpenSummary,leftOpenProblem} from "../../custom_components/homeostatic/frontend/left-open.mjs";
import {editReusable,newMonitoringPolicy,trackEditorSelectInput} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {flatSourceRows,flatSourceSelection} from "../../custom_components/homeostatic/frontend/source-selection.mjs";
import {historyOutcome} from "../../custom_components/homeostatic/frontend/history-controls.mjs";

const source=(id,domain,device_class)=>({node_id:`entity:registry:${id}`,kind:"entity",name:id,attributes:{kind:["entity"],entity:[`registry:${id}`],domain:[domain],device_class:device_class?[device_class]:[]}});
const card=()=>({editors:{configuration:{settings:{}}},_hass:{config:{time_zone:"America/Chicago"}},current:{data:{inventory:{nodes:[],catalog:{candidates:[source("patio","binary_sensor","door"),source("window","binary_sensor","window"),source("cover","cover"),source("motion","binary_sensor","motion"),source("outside","sensor","temperature"),source("weather","weather")]}}}}});

test("left-open policies require an explicit wait and exact opening choices",()=>{
  const policy=newMonitoringPolicy([],"left_open",{acknowledge:{}});
  assert.equal(policy.enabled,false);assert.equal(policy.parameters.duration_seconds,null);assert.deepEqual(policy.match,{kind:["entity"],entity:[]});
  assert.equal(leftOpenValidation(policy).field,"duration_seconds");
  assert.deepEqual(flatSourceRows(card(),policy).map(row=>row.name),["patio","window"]);
  assert.ok(flatSourceRows(card(),policy).every(row=>!row.selected));
  const html=flatSourceSelection(card(),policy);assert.doesNotMatch(html,/Future sources|source-selected-only|entity-selection-tree/);
  policy.parameters.duration_seconds=0;assert.equal(leftOpenValidation(policy),null);assert.match(leftOpenSummary(policy),/without waiting/);
  policy.parameters.duration_seconds=3600;assert.match(leftOpenSummary(policy),/1 hour\./);
});

test("optional hours and temperature retain explicit source, units and validation",()=>{
  const policy=newMonitoringPolicy([],"left_open",{});policy.parameters.duration_seconds=60;
  const initial=leftOpenFields(card(),policy);
  assert.doesNotMatch(initial,/Outdoor temperature source|data-definition-field="parameters:start"/);
  assert.match(initial,/<fieldset class="left-open-hours"><legend>Monitoring hours<\/legend>/);
  assert.equal((initial.match(/type="radio"/g)||[]).length,2);
  assert.match(initial,/value="always" checked/);assert.doesNotMatch(initial,/<select[^>]+parameters:monitoring_hours/);
  Object.assign(policy.parameters,{start:"22:00",end:"07:00",use_temperature:true});
  assert.equal(leftOpenValidation(policy).field,"temperature_source");
  policy.parameters.temperature_source="registry:outside";assert.equal(leftOpenValidation(policy).field,"minimum");
  policy.parameters.minimum=45;assert.equal(leftOpenValidation(policy),null);
  const html=leftOpenFields(card(),policy);assert.match(html,/America\/Chicago/);assert.match(html,/value="registry:weather"/);assert.match(html,/value="registry:outside"/);assert.doesNotMatch(html,/value="registry:patio"/);
  assert.match(html,/Temperature changes cannot end an open issue/);
  policy.parameters.maximum=40;assert.equal(leftOpenValidation(policy).field,"maximum");
  policy.parameters.maximum=90;policy.parameters.end="22:00";assert.equal(leftOpenValidation(policy).field,"end");
});

test("native selector input waits for commitment and pointer selection does not refocus its replacement",()=>{
  for(const keyboard of [false,true]) {
    const policy=newMonitoringPolicy([],"left_open",{});policy.parameters.duration_seconds=300;
    const state=card(),settings={monitoring_policies:[policy],notification_definitions:{profiles:{},methods:{}},timings:{}};
    state.editors.configuration.settings=structuredClone(settings);state.editors.settingsDraft=settings;
    let renders=0,focus=0,blurs=0;
    const dataset={definitionKind:"policies",definitionId:policy.id,definitionField:"duration-unit:duration_seconds"};
    const target={tagName:"SELECT",dataset,value:"hours",blur:()=>{blurs++;}};
    trackEditorSelectInput({type:keyboard?"keydown":"pointerdown",target});
    state.main={querySelectorAll:()=>[{dataset,focus:()=>{focus++;}}]};state.render=()=>{renders++;};
    assert.equal(editReusable(state,{type:"input",target}),true);assert.equal(renders,0);assert.equal(blurs,0);assert.equal(state.editors.policyDurationUnits,undefined);
    assert.equal(editReusable(state,{type:"change",target}),true);assert.equal(renders,1);assert.equal(blurs,1);assert.equal(focus,keyboard?1:0);
    assert.equal(state.editors.policyDurationUnits[`${policy.id}:duration_seconds`],"hours");assert.equal(policy.parameters.duration_seconds,300);
  }
});

test("issue and history wording distinguish the hours cutoff from closure",()=>{
  assert.match(leftOpenProblem({kind:"left_open"},{current:{reason:"left_open",status:"fail"}}).headline,/left open/);
  assert.equal(historyOutcome({resolution:"removed",episode:{annotations:{homeostatic_end_reason:"monitoring_window_ended"}}}),"Monitoring window ended");
});
