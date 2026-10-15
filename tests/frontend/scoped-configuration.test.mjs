import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeScopedConfiguration,rebaseScopedConfiguration,scopedDirty,
  saveScopedConfiguration,discardScopedConfiguration,
} from "../../custom_components/homeostatic/frontend/scoped-configuration.mjs";

const clone=value=>structuredClone(value);
const entry=(id,methodIds=["phone"])=>({id,timing:{mode:"immediate"},methods:methodIds});
const policy=(id)=>({id,name:id,check:"availability",match:{kind:["entity"]},parameters:{},enabled:true,notifications:[entry(`${id}-alert`)]});

function fixture() {
  let version=1;
  const settings={timings:{settle:30},notifications:false,consumer:null,monitoring_policies:[policy("lights"),policy("doors")],notification_definitions:{timezone:"UTC",methods:{phone:{name:"Phone",mode:"fixed",destinations:["phone:one"]},speaker:{name:"Speaker",mode:"fixed",destinations:["tts:one"]}},default:[],repairs:[],broken_automations:[],assignments:{},automation_profiles:{}}};
  const server={value:{revision:"r1",rules:[],settings:clone(settings)}},calls=[];
  const card={configuration:clone(server.value),settingsDraft:clone(settings),configDraft:[],current:{status:"current"},render(){},_hass:{async callWS(request){
    calls.push(clone(request));
    if(request.type==="homeostatic/configuration")return clone(server.value);
    assert.equal(request.type,"homeostatic/save_settings");
    assert.equal(request.revision,server.value.revision);
    server.value={...server.value,revision:`r${++version}`,settings:clone(request.settings)};
    return {saved:true};
  }}};
  initializeScopedConfiguration(card);
  return {card,server,calls};
}

const draftPolicy=(card,id)=>card.settingsDraft.monitoring_policies.find(item=>item.id===id);
const savedPolicy=(server,id)=>server.value.settings.monitoring_policies.find(item=>item.id===id);

test("global sending saves only confirmed sending and preserves all other drafts",async()=>{
  const {card,server,calls}=fixture(),original=clone(server.value.settings);
  draftPolicy(card,"lights").name="Pending lights";
  card.settingsDraft.notification_definitions.methods.speaker.name="Pending speaker";
  card.settingsDraft.timings.settle=90;card.configDraft.push({id:"pending-rule"});
  assert.equal(await saveScopedConfiguration(card,{kind:"notifications"},true),true);
  assert.deepEqual(server.value.settings,{...original,notifications:true});
  assert.equal(draftPolicy(card,"lights").name,"Pending lights");
  assert.equal(card.settingsDraft.notification_definitions.methods.speaker.name,"Pending speaker");
  assert.equal(card.settingsDraft.timings.settle,90);
  assert.deepEqual(card.configDraft,[{id:"pending-rule"}]);
  assert.equal(card.configuration.settings.notifications,true);
  assert.equal(card.scopedNotice,null);
  assert.deepEqual(calls.map(item=>item.type),["homeostatic/save_settings","homeostatic/configuration"]);
  assert.equal("rules" in calls[0].settings,false);
});

test("policy save preserves unrelated policy and method drafts",async()=>{
  const {card,server}=fixture();
  draftPolicy(card,"lights").name="Light coverage";
  draftPolicy(card,"doors").name="Pending doors";
  card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(savedPolicy(server,"lights").name,"Light coverage");
  assert.equal(card.scopedNotice,null);
  assert.equal(savedPolicy(server,"doors").name,"doors");
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Pending phone");
  assert.equal(draftPolicy(card,"doors").name,"Pending doors");
});

test("standalone method save retains policy drafts without applying them",async()=>{
  const {card,server}=fixture();
  draftPolicy(card,"lights").name="Pending policy";
  card.settingsDraft.notification_definitions.methods.phone.name="Saved phone";
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"}),true);
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Saved phone");
  assert.equal(card.scopedNotice,null);
  assert.equal(savedPolicy(server,"lights").name,"lights");
  assert.equal(draftPolicy(card,"lights").name,"Pending policy");
});

test("new policy save does not enroll other draft policies or save a method draft",async()=>{
  const {card,server}=fixture();
  card.settingsDraft.monitoring_policies.push(policy("new-policy"),policy("other-new"));
  card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"new-policy"}),true);
  assert.equal(savedPolicy(server,"new-policy").id,"new-policy");
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(savedPolicy(server,"other-new"),undefined);
  assert.equal(scopedDirty(card,{kind:"policy",id:"other-new"}),true);
});

test("refresh retains a conflicting policy draft and prevents overwriting saved changes",async()=>{
  const {card,server,calls}=fixture();draftPolicy(card,"lights").name="Local";
  server.value.revision="external";savedPolicy(server,"lights").name="External";
  server.value.settings.notifications=true;
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(draftPolicy(card,"lights").name,"Local");
  assert.equal(card.settingsDraft.notifications,true);
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),false);
  assert.match(card.scopedError,/Saved settings for this editor changed/);
  assert.equal(calls.length,0);
});

test("unrelated refresh advances clean baselines and preserves an editable draft",async()=>{
  const {card,server}=fixture();draftPolicy(card,"lights").name="Local";
  server.value.revision="external";savedPolicy(server,"doors").name="Updated doors";
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(draftPolicy(card,"doors").name,"Updated doors");
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(savedPolicy(server,"doors").name,"Updated doors");
});

test("save preserves newer policy edits made while request is in flight",async()=>{
  const {card,server}=fixture(),original=card._hass.callWS;let release;
  card._hass.callWS=async request=>request.type==="homeostatic/save_settings"?new Promise(resolve=>{release=async()=>resolve(await original(request));}):original(request);
  draftPolicy(card,"lights").name="Submitted";
  const pending=saveScopedConfiguration(card,{kind:"policy",id:"lights"});
  draftPolicy(card,"lights").name="Newer";
  assert.equal(await saveScopedConfiguration(card,{kind:"notifications"},true),false);
  await release();assert.equal(await pending,true);
  assert.equal(savedPolicy(server,"lights").name,"Submitted");
  assert.equal(draftPolicy(card,"lights").name,"Newer");
  assert.equal(card.scopedNotice,"Newer edits are still unsaved.");
  card._hass.callWS=original;
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(savedPolicy(server,"lights").name,"Newer");
  assert.equal(card.scopedNotice,null);
});

test("validation failure retains every draft and the confirmed configuration",async()=>{
  const {card}=fixture(),confirmed=clone(card.configuration);
  draftPolicy(card,"lights").name="Invalid pending";draftPolicy(card,"doors").name="Other pending";
  card.settingsDraft.notification_definitions.methods.phone.destinations=[];
  card._hass.callWS=async()=>{throw {code:"invalid_settings",message:"Choose a destination"};};
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),false);
  assert.deepEqual(card.configuration,confirmed);
  assert.equal(draftPolicy(card,"lights").name,"Invalid pending");
  assert.equal(draftPolicy(card,"doors").name,"Other pending");
  assert.deepEqual(card.settingsDraft.notification_definitions.methods.phone.destinations,[]);
  assert.equal(card.scopedError,"Choose a destination");
  assert.equal(card.scopedBusy,null);assert.equal(card.settingsBusy,false);
});

test("lost save response refreshes before another attempt and does not repeat an applied save",async()=>{
  const {card,server,calls}=fixture(),original=card._hass.callWS;let lose=true;
  card._hass.callWS=async request=>{const result=await original(request);if(request.type==="homeostatic/save_settings"&&lose){lose=false;throw Error("Disconnected");}return result;};
  draftPolicy(card,"lights").name="Saved despite lost reply";
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),false);
  assert.equal(card.configuration.settings.monitoring_policies[0].name,"lights");
  assert.equal(savedPolicy(server,"lights").name,"Saved despite lost reply");
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(calls.filter(call=>call.type==="homeostatic/save_settings").length,1);
  assert.equal(scopedDirty(card,{kind:"policy",id:"lights"}),false);
});

test("a confirmed save with failed refresh retains unrelated drafts and marks refresh required",async()=>{
  const {card}=fixture(),original=card._hass.callWS;
  draftPolicy(card,"lights").name="Saved";draftPolicy(card,"doors").name="Other pending";
  card._hass.callWS=async request=>{if(request.type==="homeostatic/configuration")throw Error("Offline");return original(request);};
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),false);
  assert.match(card.scopedError,/were saved.*could not be reloaded/);
  assert.equal(draftPolicy(card,"doors").name,"Other pending");
  assert.equal(card.scopedConfiguration.needsRefresh,true);
});

test("discard policy restores only its saved value and retains other drafts",()=>{
  const {card}=fixture();draftPolicy(card,"lights").name="Pending";draftPolicy(card,"doors").name="Other";
  card.settingsDraft.notification_definitions.methods.phone.name="Standalone";
  assert.equal(discardScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(draftPolicy(card,"lights").name,"lights");
  assert.equal(draftPolicy(card,"doors").name,"Other");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Standalone");
});

test("saved policy switches reject a competing policy draft and never apply other drafts",async()=>{
  const {card,server}=fixture();draftPolicy(card,"lights").name="Pending";
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"},false),false);
  assert.match(card.scopedError,/Continue editing/);
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"doors"},false),true);
  assert.equal(savedPolicy(server,"doors").enabled,false);
  assert.equal(savedPolicy(server,"lights").name,"lights");
  assert.equal(draftPolicy(card,"lights").name,"Pending");
});

test("settings save owns general settings and leaves policies methods rules and sending untouched",async()=>{
  const {card,server}=fixture();card.settingsDraft.timings.settle=90;card.settingsDraft.notifications=true;
  draftPolicy(card,"lights").name="Pending";card.settingsDraft.notification_definitions.methods.phone.name="Pending phone";
  card.configDraft.push({id:"pending"});
  assert.equal(await saveScopedConfiguration(card,{kind:"settings"}),true);
  assert.equal(server.value.settings.timings.settle,90);
  assert.equal(card.scopedNotice,null);
  assert.equal(server.value.settings.notifications,false);
  assert.equal(savedPolicy(server,"lights").name,"lights");
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(card.settingsDraft.notifications,true);
  assert.deepEqual(card.configDraft,[{id:"pending"}]);
});

test("policy deletion saves one deletion and discard restores a failed deletion",async()=>{
  const {card,server}=fixture();card.settingsDraft.monitoring_policies=card.settingsDraft.monitoring_policies.filter(item=>item.id!=="lights");
  draftPolicy(card,"doors").name="Pending doors";
  assert.equal(await saveScopedConfiguration(card,{kind:"policy",id:"lights"}),true);
  assert.equal(savedPolicy(server,"lights"),undefined);
  assert.equal(savedPolicy(server,"doors").name,"doors");
  assert.equal(draftPolicy(card,"doors").name,"Pending doors");
});

test("method replacement atomically updates saved uses and preserves unrelated drafts",async()=>{
  const {card,server}=fixture();card.settingsDraft.timings.settle=90;
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,replacement:"speaker"}),true);
  assert.equal(server.value.settings.notification_definitions.methods.phone,undefined);
  assert.deepEqual(savedPolicy(server,"lights").notifications[0].methods,["speaker"]);
  assert.deepEqual(savedPolicy(server,"doors").notifications[0].methods,["speaker"]);
  assert.equal(card.settingsDraft.notification_definitions.methods.phone,undefined);
  assert.equal(card.settingsDraft.timings.settle,90);
  assert.equal(server.value.settings.timings.settle,30);
});

test("explicit method removal keeps other methods and removes only empty entries",async()=>{
  const {card,server}=fixture();
  savedPolicy(server,"lights").notifications[0].methods.push("speaker");
  server.value.settings.notification_definitions.assignments.external={default:[entry("legacy")],checks:{}};
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,removeReferences:true}),true);
  assert.deepEqual(savedPolicy(server,"lights").notifications[0].methods,["speaker"]);
  assert.deepEqual(savedPolicy(server,"doors").notifications,[]);
  assert.deepEqual(server.value.settings.notification_definitions.assignments.external.default,[]);
  assert.deepEqual(card.settingsDraft.notification_definitions.assignments.external.default,[]);
});

test("method deletion refuses relevant drafts without dropping their edits",async()=>{
  const {card,server,calls}=fixture();draftPolicy(card,"lights").name="Pending";
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,removeReferences:true}),false);
  assert.match(card.scopedError,/Save or discard policy drafts/);
  assert.equal(calls.length,0);
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(draftPolicy(card,"lights").name,"Pending");
});

test("read-only and unavailable states never submit scoped mutations",async()=>{
  const {card,calls}=fixture();card.current.status="unavailable";
  assert.equal(await saveScopedConfiguration(card,{kind:"notifications"},true),false);
  assert.equal(calls.length,0);
});

function profileFixture() {
  const result=fixture(),{card,server}=result;
  server.value.settings.notification_definitions.profiles={
    morning:{name:"Morning",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:["phone"]},
    evening:{name:"Evening",timing:{mode:"report",at:"18:00",weekdays:[0,1,2,3,4,5,6]},methods:["speaker"]},
  };
  savedPolicy(server,"lights").notifications=[{id:"lights-alert",profile:"morning",when:"mains"}];
  rebaseScopedConfiguration(card,clone(server.value));
  return result;
}

test("notification save and discard affect only that profile and preserve independent drafts",async()=>{
  const {card,server}=profileFixture(),definitions=card.settingsDraft.notification_definitions;
  definitions.profiles.morning.name="Weekday morning";
  definitions.profiles.evening.name="Pending evening";
  definitions.methods.phone.name="Pending phone";
  draftPolicy(card,"doors").name="Pending doors";
  card.settingsDraft.timings.settle=90;
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"}),true);
  assert.equal(server.value.settings.notification_definitions.profiles.morning.name,"Weekday morning");
  assert.equal(card.scopedNotice,null);
  assert.equal(server.value.settings.notification_definitions.profiles.evening.name,"Evening");
  assert.equal(server.value.settings.notification_definitions.methods.phone.name,"Phone");
  assert.equal(savedPolicy(server,"doors").name,"doors");
  assert.equal(server.value.settings.notifications,false);
  assert.equal(card.settingsDraft.notification_definitions.profiles.evening.name,"Pending evening");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Pending phone");
  assert.equal(draftPolicy(card,"doors").name,"Pending doors");
  assert.equal(card.settingsDraft.timings.settle,90);
  assert.equal(scopedDirty(card,{kind:"profile",id:"morning"}),false);
  discardScopedConfiguration(card,{kind:"profile",id:"evening"});
  assert.equal(card.settingsDraft.notification_definitions.profiles.evening.name,"Evening");
  assert.equal(card.settingsDraft.notification_definitions.methods.phone.name,"Pending phone");
});

test("new unconfigured profile saves without changing inline assignments and new drafts discard independently",async()=>{
  const {card,server}=fixture(),before=clone(server.value.settings.monitoring_policies);
  card.settingsDraft.notification_definitions.profiles={urgent:{name:"Urgent",timing:{mode:"window",start:"08:00",end:"22:00"},methods:[]}};
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"urgent"}),true);
  assert.deepEqual(server.value.settings.notification_definitions.profiles.urgent.methods,[]);
  assert.deepEqual(server.value.settings.monitoring_policies,before);
  card.settingsDraft.notification_definitions.profiles.abandoned={name:"Abandoned",timing:{mode:"immediate"},methods:[]};
  discardScopedConfiguration(card,{kind:"profile",id:"abandoned"});
  assert.equal(card.settingsDraft.notification_definitions.profiles.abandoned,undefined);
  assert.equal(card.settingsDraft.notification_definitions.profiles.urgent.name,"Urgent");
});

test("profile refresh retains conflicting drafts while adopting independent profiles and metadata",async()=>{
  const {card,server,calls}=profileFixture();
  card.settingsDraft.notification_definitions.profiles.morning.name="Local morning";
  server.value.revision="external";
  server.value.settings.notification_definitions.profiles.morning.name="Remote morning";
  server.value.settings.notification_definitions.profiles.evening.name="Remote evening";
  server.value.settings.notification_definitions.timezone="America/Chicago";
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(card.settingsDraft.notification_definitions.profiles.morning.name,"Local morning");
  assert.equal(card.settingsDraft.notification_definitions.profiles.evening.name,"Remote evening");
  assert.equal(card.settingsDraft.notification_definitions.timezone,"America/Chicago");
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"}),false);
  assert.match(card.scopedError,/Saved settings for this editor changed/);
  assert.equal(calls.length,0);
});

test("profile save retains newer edits made while its request is pending",async()=>{
  const {card,server}=profileFixture(),original=card._hass.callWS;let release;
  card._hass.callWS=async request=>{
    if(request.type==="homeostatic/save_settings")await new Promise(resolve=>{release=resolve;});
    return original(request);
  };
  card.settingsDraft.notification_definitions.profiles.morning.name="Submitted";
  const saving=saveScopedConfiguration(card,{kind:"profile",id:"morning"});
  card.settingsDraft.notification_definitions.profiles.morning.name="Newer edit";
  release();assert.equal(await saving,true);
  assert.equal(server.value.settings.notification_definitions.profiles.morning.name,"Submitted");
  assert.equal(card.settingsDraft.notification_definitions.profiles.morning.name,"Newer edit");
  assert.equal(scopedDirty(card,{kind:"profile",id:"morning"}),true);
});

test("profile replacement preserves assignment identities and UPS conditions across owners",async()=>{
  const {card,server}=profileFixture();
  server.value.settings.notification_definitions.automation_profiles.custom=[{id:"automation-row",profile:"morning"}];
  rebaseScopedConfiguration(card,clone(server.value));
  draftPolicy(card,"doors").name="Pending doors";
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"},{delete:true,replacement:"evening"}),true);
  assert.equal(server.value.settings.notification_definitions.profiles.morning,undefined);
  assert.deepEqual(savedPolicy(server,"lights").notifications,[{id:"lights-alert",profile:"evening",when:"mains"}]);
  assert.deepEqual(server.value.settings.notification_definitions.automation_profiles.custom,[{id:"automation-row",profile:"evening"}]);
  assert.equal(draftPolicy(card,"lights").notifications[0].profile,"evening");
  assert.equal(draftPolicy(card,"doors").name,"Pending doors");
  assert.equal(savedPolicy(server,"doors").notifications[0].timing.mode,"immediate");
});

test("explicit profile removal removes its assignments without changing other profiles or inline rows",async()=>{
  const {card,server,calls}=profileFixture();
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"},{delete:true}),false);
  assert.match(card.scopedError,/replacement or explicitly remove/);
  assert.equal(calls.length,0);
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"},{delete:true,removeReferences:true}),true);
  assert.deepEqual(savedPolicy(server,"lights").notifications,[]);
  assert.equal(savedPolicy(server,"doors").notifications[0].timing.mode,"immediate");
  assert.equal(server.value.settings.notification_definitions.profiles.evening.name,"Evening");
});

for(const [name,prepare] of [
  ["profile",card=>{card.settingsDraft.notification_definitions.profiles.morning.name="Pending";}],
  ["assigned policy",card=>{draftPolicy(card,"lights").name="Pending";}],
  ["new policy assignment",card=>{draftPolicy(card,"doors").notifications=[{id:"doors-alert",profile:"morning"}];}],
])test(`profile deletion preserves a relevant ${name} draft`,async()=>{
  const {card,server,calls}=profileFixture();prepare(card);const before=clone(card.settingsDraft);
  assert.equal(await saveScopedConfiguration(card,{kind:"profile",id:"morning"},{delete:true,replacement:"evening"}),false);
  assert.match(card.scopedError,/Save or discard/);
  assert.equal(calls.length,0);
  assert.deepEqual(card.settingsDraft,before);
  assert.equal(server.value.settings.notification_definitions.profiles.morning.name,"Morning");
});

test("method removal leaves a reusable notification and its assignments intact when unconfigured",async()=>{
  const {card,server}=profileFixture();
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,removeReferences:true}),true);
  assert.deepEqual(server.value.settings.notification_definitions.profiles.morning.methods,[]);
  assert.deepEqual(savedPolicy(server,"lights").notifications,[{id:"lights-alert",profile:"morning",when:"mains"}]);
  assert.deepEqual(savedPolicy(server,"doors").notifications,[]);
  assert.deepEqual(card.settingsDraft.notification_definitions.profiles.morning.methods,[]);
});

test("method replacement updates profile methods without duplicating an existing destination method",async()=>{
  const {card,server}=profileFixture();
  server.value.settings.notification_definitions.profiles.morning.methods.push("speaker");
  rebaseScopedConfiguration(card,clone(server.value));
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,replacement:"speaker"}),true);
  assert.deepEqual(server.value.settings.notification_definitions.profiles.morning.methods,["speaker"]);
  assert.deepEqual(savedPolicy(server,"lights").notifications,[{id:"lights-alert",profile:"morning",when:"mains"}]);
});

for(const [name,prepare] of [
  ["existing",card=>{card.settingsDraft.notification_definitions.profiles.morning.name="Pending";}],
  ["new",card=>{card.settingsDraft.notification_definitions.profiles.new={name:"New",timing:{mode:"immediate"},methods:["phone"]};}],
])test(`method deletion preserves a relevant ${name} notification draft`,async()=>{
  const {card,calls}=profileFixture();prepare(card);const before=clone(card.settingsDraft);
  assert.equal(await saveScopedConfiguration(card,{kind:"method",id:"phone"},{delete:true,removeReferences:true}),false);
  assert.match(card.scopedError,/Save or discard notification drafts/);
  assert.equal(calls.length,0);
  assert.deepEqual(card.settingsDraft,before);
});
