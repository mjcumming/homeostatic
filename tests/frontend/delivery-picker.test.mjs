import test from "node:test";
import assert from "node:assert/strict";
import {editReusable,namedNotifications,testDeliveryMethod} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

function fixture() {
  const settings={notifications:false,monitoring_policies:[],notification_definitions:{methods:{home:{name:"Household phones",mode:"fixed",destinations:["phone:one"]}},default:[],repairs:[],broken_automations:[],assignments:{},automation_profiles:{}}};
  const targets=[{channel:"phone:one",type:"app",name:"Michael’s iPhone",available:true},{channel:"notify:one",type:"app",name:"Michael’s iPhone alias",alias_of:"phone:one",available:true},{channel:"tts:a:kitchen",type:"voice",name:"Kitchen speaker",destination_id:"kitchen",provider_name:"Local voice",area:"Kitchen",available:true},{channel:"tts:b:kitchen",type:"voice",name:"Kitchen speaker",destination_id:"kitchen",provider_name:"Cloud voice",area:"Kitchen",available:true},{channel:"tts:a:bedroom",type:"voice",name:"Bedroom speaker",destination_id:"bedroom",provider_name:"Local voice",available:false},{channel:"service:tv",type:"notification",name:"Living room television",available:true},{channel:"sms:twilio_sms:",type:"sms",name:"Twilio",requires_target:true,available:true}];
  const calls=[];
  const card={configuration:{settings:structuredClone(settings),revision:"one",delivery_targets:targets},settingsDraft:settings,definitionSelection:{kind:"methods",id:"home"},render(){},main:{querySelectorAll:()=>[]},_hass:{async callWS(request){calls.push(request);return request.type.includes("preview_")?{preview_token:"token",targets:[targets[0]],skipped:false,presence:{}}:{requested:["phone:one"],failed:[],skipped:false};}}};
  return {card,calls};
}
function click(card,action,extra={}) {
  const element={dataset:{definitionAction:action,definitionKind:"methods",definitionId:"home",destinationField:"destinations",...extra},closest(){return this;}};
  assert.equal(editReusable(card,{type:"click",target:element}),true);
}
function input(card,key,value) {
  assert.equal(editReusable(card,{type:"input",target:{dataset:{[key]:""},value}}),true);
}

test("method editor shows configured destinations only and no test catalog",()=>{
  const {card}=fixture();const html=namedNotifications(card);
  assert.match(html,/Michael’s iPhone/);assert.match(html,/Add destination/);assert.match(html,/>Send test</);
  assert.doesNotMatch(html,/Kitchen speaker|Living room television|Test a destination|Preview delivery|definition-list"/);
  assert.match(html,/<details><summary>Change destinations based on/);
});

test("new method remains solely in editor and cannot be tested before save",()=>{
  const {card}=fixture();click(card,"add");
  const id=card.definitionSelection.id,html=namedNotifications(card);
  assert.match(html,/New delivery method/);assert.match(html,/Save this delivery method before testing/);
  assert.doesNotMatch(html,/>Send test<|definition-list"|data-definition-action="duplicate"/);
  click(card,"cancel-method",{definitionId:id});assert.equal(card.settingsDraft.notification_definitions.methods[id],undefined);
  assert.equal(card.definitionSelection,null);
});

test("type-first picker hides unselected categories and groups speaker providers",()=>{
  const {card}=fixture();click(card,"destination-open");
  let html=namedNotifications(card);assert.match(html,/Choose a delivery type/);assert.doesNotMatch(html,/Kitchen speaker|Living room television/);
  input(card,"definitionDeliveryType","voice");html=namedNotifications(card);
  assert.equal((html.match(/Kitchen speaker/g)||[]).length,1);assert.doesNotMatch(html,/Bedroom speaker|Living room television|Cloud voice/);
  click(card,"destination-speaker",{destinationSpeaker:"kitchen"});html=namedNotifications(card);
  assert.match(html,/Local voice/);assert.match(html,/Cloud voice/);
  click(card,"destination-add",{destinationChannel:"tts:b:kitchen"});
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.home.destinations,["phone:one","tts:b:kitchen"]);
  assert.equal(card.deliveryPicker,null);
});

test("picker filters friendly names and areas without changing configured choices",()=>{
  const {card}=fixture();click(card,"destination-open");input(card,"definitionDeliveryType","voice");input(card,"definitionDeliverySearch","Bedroom");
  assert.doesNotMatch(namedNotifications(card),/Kitchen speaker/);
  assert.match(namedNotifications(card),/No available destinations match/);
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.home.destinations,["phone:one"]);
  input(card,"definitionDeliverySearch","Kitchen");assert.match(namedNotifications(card),/Kitchen speaker/);
});

test("generic notification targets never acquire SMS recipient controls",()=>{
  const {card}=fixture();click(card,"destination-open");input(card,"definitionDeliveryType","notification");
  const html=namedNotifications(card);assert.match(html,/Living room television/);assert.doesNotMatch(html,/type="tel"|Add recipient/);
  click(card,"destination-add",{destinationChannel:"service:tv"});assert.ok(card.settingsDraft.notification_definitions.methods.home.destinations.includes("service:tv"));
});

test("SMS recipient is explicit and only accepted for a verified SMS target",()=>{
  const {card,calls}=fixture();click(card,"destination-open");input(card,"definitionDeliveryType","sms");
  assert.match(namedNotifications(card),/type="tel"/);
  card.deliveryPicker.numbers["sms:twilio_sms:"]="invalid";click(card,"destination-add-sms",{destinationChannel:"sms:twilio_sms:"});assert.match(card.settingsError,/phone number/);
  card.deliveryPicker.numbers["sms:twilio_sms:"]="+15551234567";click(card,"destination-add-sms",{destinationChannel:"sms:twilio_sms:"});
  assert.ok(card.settingsDraft.notification_definitions.methods.home.destinations.includes("sms:twilio_sms:%2B15551234567"));assert.equal(calls.length,0);
});

test("aliases are excluded from new choices while saved unavailable choices remain removable",()=>{
  const {card}=fixture();card.settingsDraft.notification_definitions.methods.home.destinations=["notify:one","tts:a:bedroom","notify:missing"];
  click(card,"destination-open");input(card,"definitionDeliveryType","app");
  let html=namedNotifications(card);assert.equal((html.match(/Michael’s iPhone alias/g)||[]).length,1);assert.match(html,/Bedroom speaker/);assert.match(html,/Unavailable/);assert.match(html,/Saved destination unavailable/);
  click(card,"destination-remove",{destinationChannel:"notify:missing"});assert.ok(!card.settingsDraft.notification_definitions.methods.home.destinations.includes("notify:missing"));
});

test("one Send test action validates saved destinations internally then requests exactly that method",async()=>{
  const {card,calls}=fixture();await testDeliveryMethod(card,"home");
  assert.deepEqual(calls,[{type:"homeostatic/preview_delivery_method",method_id:"home",revision:"one"},{type:"homeostatic/test_delivery_method",method_id:"home",revision:"one",preview_token:"token"}]);
  assert.match(card.deliveryMethodNotice,/Michael’s iPhone/);assert.equal(card.deliveryMethodBusy,false);
});

test("unsaved edits and newly created methods never send test requests",async()=>{
  const {card,calls}=fixture();card.settingsDraft.notification_definitions.methods.home.name="Changed";
  await testDeliveryMethod(card,"home");await testDeliveryMethod(card,"missing");assert.equal(calls.length,0);
});

test("changes during internal test preparation stop dispatch",async()=>{
  const {card,calls}=fixture();card._hass.callWS=async request=>{calls.push(request);card.configuration.revision="two";return {preview_token:"stale",targets:[],skipped:false};};
  await testDeliveryMethod(card,"home");assert.equal(calls.length,1);assert.match(card.deliveryMethodError,/Settings changed/);
});

test("unavailable targets fail without sending and presence skip is reported",async()=>{
  const {card,calls}=fixture();card._hass.callWS=async request=>{calls.push(request);return {targets:[{name:"Phone",available:false}],preview_token:"unavailable"};};
  await testDeliveryMethod(card,"home");assert.equal(calls.length,1);assert.match(card.deliveryMethodError,/unavailable/);
  calls.length=0;card._hass.callWS=async request=>{calls.push(request);return {targets:[],skipped:true,preview_token:"skip",requested:[],failed:[]};};
  await testDeliveryMethod(card,"home");assert.equal(calls.length,2);assert.match(card.deliveryMethodNotice,/no recipient qualified/);
});

test("search and destination labels escape untrusted markup",()=>{
  const {card}=fixture();card.configuration.delivery_targets.push({channel:"notify:x",type:"notification",name:'<img src=x onerror="alert(1)">',available:true});
  click(card,"destination-open");input(card,"definitionDeliveryType","notification");
  assert.doesNotMatch(namedNotifications(card),/<img/);assert.match(namedNotifications(card),/&lt;img/);
});
