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
const pickerHtml=card=>namedNotifications(card).match(/<dialog class="delivery-picker"[\s\S]*?<\/dialog>/)?.[0]||"";

test("method editor shows configured destinations only and no test catalog",()=>{
  const {card}=fixture();const html=namedNotifications(card);
  assert.match(html,/Michael’s iPhone/);assert.match(html,/Add destination/);assert.match(html,/>Send test</);
  assert.doesNotMatch(html,/Kitchen speaker|Living room television|Test a destination|Preview delivery|definition-list"/);
  assert.match(html,/<details[^>]*><summary>Change destinations based on/);
});

test("new method remains solely in editor and cannot be tested before save",()=>{
  const {card}=fixture();click(card,"add");
  const id=card.definitionSelection.id,html=namedNotifications(card);
  assert.match(html,/New delivery method/);
  assert.doesNotMatch(html,/Save this delivery method before testing|>Send test<|definition-list"|data-definition-action="duplicate"/);
  click(card,"discard-scoped",{definitionId:id});assert.equal(card.settingsDraft.notification_definitions.methods[id],undefined);
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

test("speaker choices are compact rows with one accessible close control",()=>{
  const {card}=fixture();click(card,"destination-open");input(card,"definitionDeliveryType","voice");
  const html=pickerHtml(card);
  assert.match(html,/<header class="delivery-picker-header">/);
  assert.match(html,/aria-label="Close destination picker"/);
  assert.equal((html.match(/data-definition-action="destination-close"/g)||[]).length,1);
  assert.match(html,/<button[^>]*class="[^"]*delivery-picker-choice[^>]*data-definition-action="destination-speaker"/);
  assert.match(html,/<span class="delivery-picker-copy"><span class="delivery-picker-name">Kitchen speaker<\/span>/);
  assert.match(html,/aria-hidden="true"/);
  assert.doesNotMatch(html,/<footer|>Done<|Choose provider|<fieldset|data-definition-action="destination-add"/);
});

test("provider view contains only the selected speaker and Back retains the search and draft",()=>{
  const {card,calls}=fixture();
  card.configuration.delivery_targets.push({channel:"tts:a:office",type:"voice",name:"Office speaker",destination_id:"office",provider_name:"Local voice",available:true});
  const before=structuredClone(card.settingsDraft);
  click(card,"destination-open");input(card,"definitionDeliveryType","voice");input(card,"definitionDeliverySearch","Kitchen");
  click(card,"destination-speaker",{destinationSpeaker:"kitchen"});
  let html=pickerHtml(card);
  assert.match(html,/>Speech provider<\/h2>/);assert.match(html,/Kitchen speaker/);
  assert.match(html,/Back to speakers/);assert.match(html,/Local voice/);assert.match(html,/Cloud voice/);
  assert.equal((html.match(/data-definition-action="destination-add"/g)||[]).length,2);
  assert.doesNotMatch(html,/Office speaker|data-definition-delivery-type|data-definition-delivery-search|data-definition-action="destination-speaker"/);
  click(card,"destination-back");html=pickerHtml(card);
  assert.equal(card.deliveryPicker.speaker,null);assert.equal(card.deliveryPicker.query,"Kitchen");assert.equal(card.deliveryPicker.type,"voice");
  assert.match(html,/>Add destination<\/h2>/);assert.match(html,/data-definition-action="destination-speaker"/);
  assert.doesNotMatch(html,/Cloud voice|Office speaker|data-definition-action="destination-back"/);
  assert.deepEqual(card.settingsDraft,before);assert.equal(calls.length,0);
});

test("closing provider selection does not add a speaker or persist any choices",()=>{
  const {card,calls}=fixture(),before=structuredClone(card.settingsDraft);
  click(card,"destination-open");input(card,"definitionDeliveryType","voice");click(card,"destination-speaker",{destinationSpeaker:"kitchen"});
  click(card,"destination-close");
  assert.equal(card.deliveryPicker,null);assert.deepEqual(card.settingsDraft,before);assert.equal(calls.length,0);
});

test("picker filters friendly names and areas without changing configured choices",()=>{
  const {card}=fixture();click(card,"destination-open");input(card,"definitionDeliveryType","voice");input(card,"definitionDeliverySearch","Bedroom");
  assert.doesNotMatch(namedNotifications(card),/Kitchen speaker/);
  assert.match(namedNotifications(card),/No available destinations match/);
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.home.destinations,["phone:one"]);
  input(card,"definitionDeliverySearch","Kitchen");assert.match(namedNotifications(card),/Kitchen speaker/);
});

test("delivery type help explains absent providers without offering unavailable types",()=>{
  const {card,calls}=fixture(),before=structuredClone(card.settingsDraft);
  card.configuration.delivery_targets=[];
  click(card,"destination-open");
  const html=namedNotifications(card);
  assert.match(html,/popovertarget="delivery-type-help" aria-label="Help with delivery types"/);
  assert.match(html,/class="contextual-help-popover" popover/);
  assert.doesNotMatch(html,/<details class="delivery-type-help"/);
  assert.match(html,/Choices come from available destinations configured in Home Assistant/);
  assert.match(html,/https:\/\/www.home-assistant.io\/integrations\/smtp\//);
  assert.match(html,/https:\/\/www.home-assistant.io\/integrations\/twilio_sms\//);
  assert.doesNotMatch(html,/<option value="(?:email|sms)"/);
  assert.deepEqual(card.settingsDraft,before);assert.equal(calls.length,0);
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
  let html=namedNotifications(card);assert.match(html,/<strong>Michael’s iPhone alias<\/strong>/);assert.doesNotMatch(html.split('<dialog class="delivery-picker"')[1],/Michael’s iPhone alias/);assert.match(html,/Bedroom speaker/);assert.match(html,/Unavailable/);assert.match(html,/Saved destination unavailable/);
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


test("returning to the methods list retains edits without opening a discard dialog",()=>{
  const {card,calls}=fixture();
  card.settingsDraft.notification_definitions.methods.home.name="Changed name";
  const before=structuredClone(card.settingsDraft);
  click(card,"close-method");
  assert.equal(card.definitionSelection,null);
  assert.deepEqual(card.settingsDraft,before);
  const html=namedNotifications(card);
  assert.doesNotMatch(html,/Changed name/);assert.match(html,/Household phones/);assert.match(html,/Unsaved changes/);
  assert.doesNotMatch(html,/method-discard-dialog/);
  assert.equal(calls.length,0);
});

test("discard restores only this method in place without confirmation",()=>{
  const {card,calls}=fixture();
  card.settingsDraft.notifications=true;
  card.settingsDraft.notification_definitions.methods.home.name="Changed name";
  assert.match(namedNotifications(card),/Discard changes/);
  assert.doesNotMatch(namedNotifications(card),/method-discard-dialog|>Cancel</);
  click(card,"discard-scoped");
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.home,card.configuration.settings.notification_definitions.methods.home);
  assert.equal(card.settingsDraft.notifications,true);
  assert.deepEqual(card.definitionSelection,{kind:"methods",id:"home"});
  assert.doesNotMatch(namedNotifications(card),/<footer|>Discard changes<|>Save delivery method</);
  assert.equal(calls.length,0);
});

test("closing the destination dialog retains all configured choices",()=>{
  const {card,calls}=fixture(),before=structuredClone(card.settingsDraft);
  click(card,"destination-open");input(card,"definitionDeliveryType","voice");
  assert.match(namedNotifications(card),/<dialog class="delivery-picker"/);
  click(card,"destination-close");
  assert.equal(card.deliveryPicker,null);
  assert.deepEqual(card.settingsDraft,before);
  assert.equal(calls.length,0);
});


test("all failed test services report failures without claiming requests succeeded",async()=>{
  const {card}=fixture();
  card._hass.callWS=async request=>request.type==="homeostatic/preview_delivery_method"?{targets:[{channel:"phone:one",name:"Owner phone",available:true}],preview_token:"target",skipped:false}:{requested:[],failed:[{channel:"phone:one",error:"Service unavailable"}],skipped:false};
  await testDeliveryMethod(card,"home");
  assert.match(card.deliveryMethodNotice,/No test requests succeeded/);
  assert.match(card.deliveryMethodNotice,/Owner phone: Service unavailable/);
  assert.doesNotMatch(card.deliveryMethodNotice,/Test requested for/);
});
