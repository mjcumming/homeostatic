import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions,newMonitoringPolicy,namedPolicies,editReusable} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";
import {saveScopedConfiguration,scopedDirty} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";

function fixture(parameters={}) {
  const policy={...newMonitoringPolicy([],"temperature_limit"),name:"Interior temperature",enabled:true,parameters:{unit:"°F",minimum:60,maximum:null,duration_seconds:3600,...parameters},notifications:[]};
  const settings={monitoring_policies:[policy],notification_definitions:emptyNotificationDefinitions("America/Chicago"),notifications:false};
  const calls=[];
  let confirmed=structuredClone(settings);
  const card={page:"policies",definitionSelection:{kind:"policies",id:policy.id},current:{status:"current",data:monitoringExample()},
    configuration:{revision:"one",settings:structuredClone(settings)},settingsDraft:structuredClone(settings),
    main:{querySelector(){return null;},querySelectorAll(){return [];}},render(){},
    _hass:{async callWS(request){
      calls.push(structuredClone(request));
      if(request.type==="homeostatic/save_settings"){confirmed=structuredClone(request.settings);return {saved:true};}
      return {revision:"two",settings:structuredClone(confirmed)};
    }}};
  namedPolicies(card);
  return {card,calls,policy:card.settingsDraft.monitoring_policies[0],scope:{kind:"policy",id:policy.id}};
}

function change(card,field,value,extra={}) {
  const target={dataset:{definitionKind:"policies",definitionId:"policy-1",definitionField:field,...extra},
    type:typeof value==="boolean"?"checkbox":field.startsWith("parameters:")&&field!=="parameters:unit"?"number":"select-one",value:String(value),checked:value};
  assert.equal(editReusable(card,{type:"change",target}),true);
}

function click(card,action) {
  const target={dataset:{definitionKind:"policies",definitionId:"policy-1",definitionAction:action},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target}),true);
}

function control(html,field) {
  const result=html.match(new RegExp(`<(?:input|select)\\b[^>]*data-definition-field="${field}"[^>]*>`));
  assert.ok(result,`Missing ${field} control`);
  return result[0];
}

for(const [name,parameters] of [
  ["lower-only",{minimum:60,maximum:null}],
  ["upper-only",{minimum:null,maximum:80}],
  ["both bounds",{minimum:-10,maximum:0}],
])test(`temperature editor keeps both optional numeric bounds visible for ${name}`,()=>{
  const {card}=fixture(parameters),before=structuredClone(card.settingsDraft),html=namedPolicies(card);
  const below=control(html,"parameters:minimum"),above=control(html,"parameters:maximum");
  assert.match(below,/type="number"/);assert.match(above,/type="number"/);
  assert.doesNotMatch(below,/\brequired\b/);assert.doesNotMatch(above,/\brequired\b/);
  assert.match(html,/<span>Below(?: \(optional\))?<\/span>/);
  assert.match(html,/<span>Above(?: \(optional\))?<\/span>/);
  assert.equal((html.match(/data-definition-field="parameters:(?:minimum|maximum)"/g)||[]).length,2);
  assert.deepEqual(card.settingsDraft,before);
});

for(const [name,seconds,value,unit] of [
  ["whole minutes",3600,"60","minutes"],
  ["zero duration",0,"0","minutes"],
  ["non-minute duration",61,"61","seconds"],
  ["maximum duration",31536000,"525600","minutes"],
])test(`temperature editor presents ${name} without changing saved seconds`,()=>{
  const {card,scope}=fixture({duration_seconds:seconds}),before=structuredClone(card.settingsDraft),html=namedPolicies(card);
  const duration=control(html,"parameters:duration_seconds");
  assert.match(duration,new RegExp(`value="${value}"`));
  assert.match(duration,new RegExp(`data-duration-unit="${unit}"`));
  assert.match(duration,/\brequired\b/);
  assert.match(html,new RegExp(`<select[^>]*data-definition-field="duration-unit:duration_seconds"[^>]*>[\\s\\S]*?<option value="${unit}" selected>`));
  assert.deepEqual(card.settingsDraft,before);
  assert.equal(scopedDirty(card,scope),false);
});

test("temperature duration unit changes only presentation and never dirty the policy",()=>{
  const {card,calls,scope}=fixture(),before=structuredClone(card.settingsDraft);
  change(card,"duration-unit:duration_seconds","hours");
  assert.match(control(namedPolicies(card),"parameters:duration_seconds"),/value="1"/);
  assert.match(control(namedPolicies(card),"parameters:duration_seconds"),/data-duration-unit="hours"/);
  change(card,"duration-unit:duration_seconds","seconds");
  assert.match(control(namedPolicies(card),"parameters:duration_seconds"),/value="3600"/);
  change(card,"duration-unit:duration_seconds","minutes");
  assert.match(control(namedPolicies(card),"parameters:duration_seconds"),/value="60"/);
  assert.deepEqual(card.settingsDraft,before);
  assert.deepEqual(card.configuration.settings,before);
  assert.equal(scopedDirty(card,scope),false);
  assert.deepEqual(calls,[]);
});

for(const [unit,value,seconds] of [
  ["minutes",1.5,90],
  ["hours",0.25,900],
  ["seconds",61,61],
  ["minutes",0,0],
  ["hours",8760,31536000],
])test(`temperature duration ${value} ${unit} saves as ${seconds} integer seconds`,async()=>{
  const {card,calls,policy,scope}=fixture();
  change(card,"duration-unit:duration_seconds",unit);
  change(card,"parameters:duration_seconds",value,{durationUnit:unit});
  assert.equal(policy.parameters.duration_seconds,seconds);
  assert.equal(Number.isInteger(policy.parameters.duration_seconds),true);
  assert.equal(card.configuration.settings.monitoring_policies[0].parameters.duration_seconds,3600);
  assert.equal(await saveScopedConfiguration(card,scope),true);
  const submitted=calls.find(request=>request.type==="homeostatic/save_settings").settings;
  assert.equal(submitted.monitoring_policies[0].parameters.duration_seconds,seconds);
  assert.equal(submitted.notifications,false);
  assert.equal(scopedDirty(card,scope),false);
});

for(const [name,parameters,error] of [
  ["both limits absent",{minimum:null,maximum:null,duration_seconds:60},/at least one|below.*above|minimum.*maximum/i],
  ["reversed limits",{minimum:80,maximum:60,duration_seconds:60},/below|minimum|maximum|greater|exceed/i],
  ["missing duration",{minimum:60,maximum:null},/duration|persist|time/i],
  ["negative duration",{minimum:60,maximum:null,duration_seconds:-1},/duration|persist|time|zero|0/i],
  ["excessive duration",{minimum:60,maximum:null,duration_seconds:31536001},/duration|persist|365|31536000/i],
  ["fractional seconds",{minimum:60,maximum:null,duration_seconds:0.5},/duration|second|whole|integer/i],
])test(`temperature save rejects ${name} before making a request and retains the draft`,()=>{
  const {card,calls,policy}=fixture();
  policy.parameters={unit:"°F",...parameters};
  const draft=structuredClone(card.settingsDraft),saved=structuredClone(card.configuration.settings);
  click(card,"save-scoped");
  assert.deepEqual(calls,[]);
  assert.match(card.scopedError,error);
  assert.match(namedPolicies(card),/role="alert"/);
  assert.deepEqual(card.settingsDraft,draft);
  assert.deepEqual(card.configuration.settings,saved);
});

test("clearing the lower limit leaves an independent upper limit of zero",async()=>{
  const {card,calls,policy,scope}=fixture();
  change(card,"parameters:maximum",0);
  change(card,"parameters:minimum","");
  assert.equal(policy.parameters.maximum,0);
  assert.equal(Object.hasOwn(policy.parameters,"minimum"),false);
  assert.equal(await saveScopedConfiguration(card,scope),true);
  assert.equal(calls.find(request=>request.type==="homeostatic/save_settings").settings.monitoring_policies[0].parameters.maximum,0);
});

test("temperature enabled switch is in the header and changes only the draft until Save",async()=>{
  const {card,calls,policy,scope}=fixture(),html=namedPolicies(card),header=html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  const enabled=control(header,"enabled");
  assert.match(enabled,/role="switch"/);
  assert.equal((html.match(/data-definition-field="enabled"/g)||[]).length,1);
  change(card,"enabled",false);
  assert.equal(policy.enabled,false);
  assert.equal(card.configuration.settings.monitoring_policies[0].enabled,true);
  assert.deepEqual(calls,[]);
  assert.equal(await saveScopedConfiguration(card,scope),true);
  assert.equal(card.configuration.settings.monitoring_policies[0].enabled,false);
  assert.equal(card.configuration.settings.notifications,false);
});

test("temperature source selection keeps picker scroll and focuses the replacement control",()=>{
  const {card,policy}=fixture();
  policy.match={kind:["entity"],entity:[]};
  card.policyPicker={id:policy.id,query:"",selectedOnly:false,showAll:false};
  const dataset={definitionKind:"policies",definitionId:policy.id,definitionField:"selection",definitionValue:"registry:hall"},focus=[];
  let options={scrollTop:176,scrollLeft:0};
  const picker={querySelector(){return options;}};
  const replacement={dataset,focus(value){focus.push(value);}};
  card.main.querySelector=selector=>selector.includes("policy-picker-options")?options:selector.includes("policy-picker")?picker:null;
  card.main.querySelectorAll=()=>[replacement];
  card.render=()=>{options={scrollTop:0,scrollLeft:0};};
  const target={dataset,type:"checkbox",checked:true,closest:()=>picker};
  assert.equal(editReusable(card,{type:"change",target}),true);
  assert.deepEqual(policy.match.entity,["registry:hall"]);
  assert.equal(options.scrollTop,176);
  assert.deepEqual(focus,[{preventScroll:true}]);
});

for(const [from,to,minimum,maximum,expectedMinimum,expectedMaximum] of [
  ["K","°C",273.15,300,0,26.85],
  ["K","°F",273.15,300,32,80.33],
  ["°C","K",0,26.85,273.15,300],
  ["°F","K",32,80.33,273.15,300],
])test(`temperature unit edits preserve absolute limits from ${from} to ${to}`,()=>{
  const {card,policy}=fixture({unit:from,minimum,maximum});
  assert.match(namedPolicies(card),new RegExp(`<option value="${from}" selected>`));
  change(card,"parameters:unit",to);
  assert.equal(policy.parameters.unit,to);
  assert.ok(Math.abs(policy.parameters.minimum-expectedMinimum)<1e-9);
  assert.ok(Math.abs(policy.parameters.maximum-expectedMaximum)<1e-9);
  assert.equal(policy.parameters.duration_seconds,3600);
});

for(const [seconds,unit] of [[61,"hours"],[7,"minutes"]])test(`editing an unchanged ${seconds}-second duration in ${unit} keeps exact integer seconds`,()=>{
  const {card,policy,scope}=fixture({duration_seconds:seconds});
  change(card,"duration-unit:duration_seconds",unit);
  const displayed=Number(control(namedPolicies(card),"parameters:duration_seconds").match(/value="([^"]+)"/)[1]);
  change(card,"parameters:duration_seconds",displayed,{durationUnit:unit});
  assert.equal(policy.parameters.duration_seconds,seconds);
  assert.equal(scopedDirty(card,scope),false);
});

test("fractional duration input remains editable and fails Save when it is not whole seconds",()=>{
  const {card,calls,policy}=fixture();
  change(card,"parameters:duration_seconds",0.01,{durationUnit:"minutes"});
  assert.equal(policy.parameters.duration_seconds,0.6);
  click(card,"save-scoped");
  assert.deepEqual(calls,[]);
  assert.match(card.scopedError,/duration|second|whole|integer/i);
  assert.equal(policy.parameters.duration_seconds,0.6);
  assert.equal(card.configuration.settings.monitoring_policies[0].parameters.duration_seconds,3600);
});

test("equal zero temperature limits pass the Save control",async()=>{
  const {card,calls,policy}=fixture();
  change(card,"parameters:minimum",0);change(card,"parameters:maximum",0);
  click(card,"save-scoped");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(policy.parameters.minimum,0);assert.equal(policy.parameters.maximum,0);
  const submitted=calls.find(request=>request.type==="homeostatic/save_settings");
  assert.ok(submitted);
  assert.deepEqual(submitted.settings.monitoring_policies[0].parameters,{unit:"°F",minimum:0,maximum:0,duration_seconds:3600});
  assert.equal(card.scopedError,null);
});

for(const [initialSeconds,unit,value,seconds] of [
  [3600,"minutes",1.5,90],
  [61,"seconds",120,120],
])test(`editing the default ${unit} field keeps its displayed unit after the duration changes`,()=>{
  const {card,policy}=fixture({duration_seconds:initialSeconds});
  const before=control(namedPolicies(card),"parameters:duration_seconds");
  assert.match(before,new RegExp(`data-duration-unit="${unit}"`));
  change(card,"parameters:duration_seconds",value,{durationUnit:unit});
  const after=control(namedPolicies(card),"parameters:duration_seconds");
  assert.equal(policy.parameters.duration_seconds,seconds);
  assert.match(after,new RegExp(`data-duration-unit="${unit}"`));
  assert.match(after,new RegExp(`value="${value}"`));
});

for(const [name,seconds] of [["small negative",-1e-9],["fractional near-integer",1.0000000000000002]])test(`a ${name} duration in seconds remains invalid without rounding`,()=>{
  const {card,calls,policy}=fixture({duration_seconds:61});
  change(card,"parameters:duration_seconds",seconds,{durationUnit:"seconds"});
  assert.equal(policy.parameters.duration_seconds,seconds);
  click(card,"save-scoped");
  assert.deepEqual(calls,[]);
  assert.match(card.scopedError,/duration|second|whole|integer/i);
});

for(const [name,seconds] of [["not a number",NaN],["infinite",Infinity]])test(`temperature save rejects ${name} duration without mutating it`,()=>{
  const {card,calls,policy}=fixture();
  policy.parameters.duration_seconds=seconds;
  click(card,"save-scoped");
  assert.deepEqual(calls,[]);
  assert.match(card.scopedError,/duration|second|whole|integer/i);
  assert.equal(policy.parameters.duration_seconds,seconds);
});

test("temperature rule summary describes both bounds and the displayed duration",()=>{
  const {card}=fixture({minimum:0,maximum:80,duration_seconds:90}),html=namedPolicies(card);
  assert.match(html,/<p class="policy-rule" role="status">Open an issue when the temperature stays below 0°F or above 80°F for 90 seconds\.<\/p>/);
  assert.match(html,/Notifications are turned off globally\. This policy can still monitor and show issues\./);
});

test("disabled immediate temperature rule keeps its meaning while global sending is on",()=>{
  const {card,policy}=fixture({minimum:null,maximum:0,duration_seconds:0});
  policy.enabled=false;
  card.configuration.settings.notifications=true;
  const html=namedPolicies(card);
  assert.match(html,/<p class="policy-rule" role="status">When enabled, open an issue when the temperature is above 0°F, without waiting\.<\/p>/);
  assert.doesNotMatch(html,/Notifications are turned off globally/);
});

test("clearing a duration retains its default seconds unit while the field is empty",()=>{
  const {card,calls,policy}=fixture({duration_seconds:61});
  change(card,"parameters:duration_seconds","",{durationUnit:"seconds"});
  assert.equal(Object.hasOwn(policy.parameters,"duration_seconds"),false);
  const blank=control(namedPolicies(card),"parameters:duration_seconds");
  assert.match(blank,/value=""/);
  assert.match(blank,/data-duration-unit="seconds"/);
  click(card,"save-scoped");
  assert.deepEqual(calls,[]);
  assert.match(card.scopedError,/duration|second|whole|integer/i);
  change(card,"parameters:duration_seconds",120,{durationUnit:"seconds"});
  assert.equal(policy.parameters.duration_seconds,120);
  assert.match(control(namedPolicies(card),"parameters:duration_seconds"),/data-duration-unit="seconds"/);
});
