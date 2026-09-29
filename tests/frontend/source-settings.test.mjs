import test from "node:test";
import assert from "node:assert/strict";
import {integrationSettings, integrationScopes, sourceSettingsProposal, sourceSettingsReviewed, previewSourceSettings, saveSourceSettings, sourceSettingsAction} from "../../custom_components/homeostatic/frontend/source-settings.mjs";
import {sourcesTree} from "../../custom_components/homeostatic/frontend/sources-workspace.mjs";
import {setScopeChoice} from "../../custom_components/homeostatic/frontend/configuration.mjs";
import {editReporting} from "../../custom_components/homeostatic/frontend/reporting.mjs";
import {monitoringExample} from "./monitoring-fixture.mjs";

function fixture() {
  const data=monitoringExample(),node=sourcesTree(data).find(item=>item.domain==="frigate");
  const reporting={timezone:"UTC",default:"weekly",people:{},profiles:{immediate:{people:[]},acknowledge:{people:[]},morning:{people:[],at:"08:00"},evening:{people:[],at:"18:00"},weekly:{people:[],at:"09:00",weekday:6}},assignments:{"device:camera-1":{default:"weekly",checks:{availability:"immediate"}}}};
  const settings={reporting,notifications:false,consumer:null,simple_notifications:null,timings:{},policy:{timezone:"UTC",recipients:{},rules:[]}};
  const configuration={revision:"one",rules:[],settings};
  const calls=[];
  const card={configuration,configDraft:[],settingsDraft:structuredClone(settings),configScopes:[],current:{status:"current",data},main:{querySelector(){return null;}},render(){},async loadConfiguration(){this.configuration={...this.configuration,revision:"two",rules:structuredClone(this.configDraft),settings:structuredClone(this.settingsDraft)};this.sourceSettingsReview=null;},_hass:{async callWS(request){calls.push(structuredClone(request));return {preview_token:"review",open_problems:0,requests_now:0,monitoring:{watched:1,added:[],removed:[],added_count:0,removed_count:0,functions:[]}};}}};
  return {card,node,calls};
}

test("integration summary shows actual outcomes and keeps settings unchanged on read",()=>{
  const {card,node}=fixture(),before=sourceSettingsProposal(card);
  const html=integrationSettings(card,node);
  assert.match(html,/Currently 1 of 1 connections monitored/);
  assert.match(html,/Currently 26 of 26 devices monitored/);
  assert.match(html,/1 Immediate/);
  assert.match(html,/25 Weekly summary/);
  assert.match(html,/Household notifications are off/);
  assert.match(html,/Back Porch/);
  assert.match(html,/1 check has its own reporting preference/);
  assert.match(html,/New devices use the household reporting default/);
  assert.doesNotMatch(html,/Use saved device policy|Condition exceptions|details[^>]* open/);
  assert.deepEqual(sourceSettingsProposal(card),before);
});

test("pending monitoring choices never replace actual counts before preview",()=>{
  const {card,node}=fixture();
  setScopeChoice(card.configDraft,integrationScopes(node).devices,"exclude");
  const html=integrationSettings(card,node);
  assert.match(html,/Currently 26 of 26 devices monitored/);
  assert.match(html,/Unsaved choice: Only devices I choose/);
});

test("older policy is not misrepresented as saved fixed preferences",()=>{
  const {card,node}=fixture();
  delete card.settingsDraft.reporting;delete card.configuration.settings.reporting;
  card.settingsDraft.notifications=true;card.configuration.settings.notifications=true;
  const html=integrationSettings(card,node);
  assert.match(html,/Using the existing notification policy/);
  assert.match(html,/Household notifications are on/);
  assert.match(html,/replacement reporting setup with notifications off/);
  assert.doesNotMatch(html,/26 Weekly summary/);
  assert.equal(card.settingsDraft.reporting,undefined);
});

test("one exact combined proposal is previewed and saved once",async()=>{
  const {card,node,calls}=fixture();
  setScopeChoice(card.configDraft,integrationScopes(node).devices,"attach");
  card.settingsDraft.reporting.assignments["device:camera-1"].default="morning";
  await previewSourceSettings(card);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].settings.rules,card.configDraft);
  assert.match(integrationSettings(card,node),/Save changes/);
  await saveSourceSettings(card);
  assert.equal(calls.length,2);
  assert.equal(calls[1].type,"homeostatic/save_settings");
  assert.equal(calls[1].preview_token,"review");
  assert.deepEqual(calls[1].settings,calls[0].settings);
  assert.equal(card.settingsDraft.notifications,false);
  assert.equal(card.settingsDraft.reporting.assignments["device:camera-1"].checks.availability,"immediate");
  assert.equal(sourceSettingsReviewed(card),null);
});

for(const [name,mutate] of [
  ["monitoring",card=>card.configDraft.push({id:"later",match:{kind:["device"]},action:"exclude"})],
  ["reporting",card=>card.settingsDraft.reporting.default="morning"],
  ["revision",card=>card.configuration.revision="new"],
])test(`${name} changes cannot reuse a combined review`,async()=>{
  const {card,calls}=fixture();await previewSourceSettings(card);mutate(card);
  assert.equal(sourceSettingsReviewed(card),null);
  await saveSourceSettings(card);
  assert.equal(calls.length,1);
});

test("save failure retains both drafts and requires another review",async()=>{
  const {card}=fixture();card.configDraft.push({id:"choice",match:{kind:["device"]},action:"attach"});
  await previewSourceSettings(card);const before=sourceSettingsProposal(card);
  card._hass.callWS=async()=>{throw Error("Settings changed; reload this page");};
  await saveSourceSettings(card);
  assert.deepEqual(sourceSettingsProposal(card),before);
  assert.equal(card.sourceSettingsReview,null);
  assert.match(card.sourceSettingsError,/Settings changed/);
});

test("discard restores both drafts without a request",async()=>{
  const {card,calls}=fixture();
  card.configDraft.push({id:"choice",match:{kind:["device"]},action:"attach"});
  card.settingsDraft.reporting.default="morning";
  sourceSettingsAction(card,{dataset:{action:"discard-source-settings"}});
  assert.deepEqual(card.configDraft,card.configuration.rules);
  assert.deepEqual(card.settingsDraft,card.configuration.settings);
  assert.equal(calls.length,0);
});

test("selecting the bulk placeholder does not stage a reporting migration",()=>{
  const {card}=fixture();delete card.settingsDraft.reporting;
  const before=structuredClone(card.settingsDraft);
  const target={dataset:{reportingBulk:'["device:camera-1"]'},value:"",closest(){return this;}};
  editReporting(card,{type:"change",target});
  assert.deepEqual(card.settingsDraft,before);
});
