import test from "node:test";
import assert from "node:assert/strict";
import {emptyNotificationDefinitions,newMonitoringPolicy,namedPolicies} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

for(const [name,parameters,expected] of [
  ["saved lower limit with null upper limit",{minimum:60,maximum:null,duration_seconds:3600},"Below 60°F · for 1 hour"],
  ["saved upper limit with null lower limit",{minimum:null,maximum:80},"Above 80°F"],
  ["omitted upper limit",{minimum:60},"Below 60°F"],
  ["omitted lower limit",{maximum:80},"Above 80°F"],
  ["zero lower limit",{minimum:0,maximum:null},"Below 0°F"],
  ["negative lower and zero upper limit",{minimum:-10,maximum:0},"Below -10°F · Above 0°F"],
  ["both limits",{minimum:60,maximum:80,duration_seconds:3600},"Below 60°F · Above 80°F · for 1 hour"],
  ["unconfigured limits",{minimum:null,maximum:null},"Temperature bounds need configuration"],
])test(`temperature policy list: ${name}`,()=>{
  const policy={...newMonitoringPolicy([],"temperature_limit"),name:"Interior temperature",parameters:{unit:"°F",duration_seconds:0,...parameters},notifications:[]};
  const settings={monitoring_policies:[policy],notification_definitions:emptyNotificationDefinitions("America/Chicago")};
  const card={editors:{configuration:{revision:"one",settings:structuredClone(settings)},settingsDraft:structuredClone(settings)}};
  const html=namedPolicies(card);
  assert.ok(html.includes(`<p class="small">${expected}</p>`),html);
  assert.doesNotMatch(html,/null°F|undefined°F/);
  assert.deepEqual(card.editors.configuration.settings,settings);
});
