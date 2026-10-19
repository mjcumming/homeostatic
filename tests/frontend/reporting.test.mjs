import test from "node:test";
import assert from "node:assert/strict";
import {sourceReporting,reportingStatus} from "../../custom_components/homeostatic/frontend/reporting.mjs";

test("acknowledgment is awareness and status never claims receipt",()=>{
  const data={policy:{notifications_enabled:true,episodes:[{episode_id:"a",sent_to:["mike"],require_acknowledgment:true}]}};
  assert.match(reportingStatus(data,{episode_id:"a"}),/awaiting acknowledgment/);
  data.policy.episodes[0].acknowledgment={at:"2026-09-28"};
  assert.match(reportingStatus(data,{episode_id:"a"}),/problem remains open/);
});

test("automation reporting stays flat without repeating the source's editor link",()=>{
  const html=sourceReporting({}, {source:{automation_url:"/config/automation/edit/owner",alert_profile:"dashboard"}});
  assert.match(html,/Dashboard only/);
  assert.match(html,/Managed by its automation/);
  assert.doesNotMatch(html,/Edit automation|<details|data-reporting|data-row-field|Save changes/);
});

test("automation reporting names the alert's named notification and what it lacks",()=>{
  const card={configuration:{settings:{notification_definitions:{profiles:{immediate:{name:"Doors now",methods:[]}}}}}};
  const html=sourceReporting(card,{source:{automation_url:"/config/automation/edit/owner",alert_profile:"immediate",alert_reporting_status:"missing_destinations"}});
  assert.match(html,/Doors now · Managed by its automation/);
  assert.match(html,/Doors now has no delivery method\. Add one in Notifications\./);
  const off=sourceReporting(card,{source:{automation_url:"/config/automation/edit/owner",alert_profile:"immediate",alert_reporting_status:"requests_disabled"}});
  assert.match(off,/Notifications are off\./);
  assert.match(sourceReporting({},{source:{automation_url:"/config/automation/edit/owner",alert_profile:"morning"}}),/Morning · Managed/);
});

test("scheduled summaries describe the notification without exposing internal route identifiers",()=>{
  const data={policy:{notifications_enabled:true,episodes:[{episode_id:"a",loudness:"digest",digest:"entry:policy_default_integrations_default"}]}};
  assert.equal(reportingStatus(data,{episode_id:"a"}),"Scheduled summary");
  data.policy.episodes[0].digest="morning";
  assert.equal(reportingStatus(data,{episode_id:"a"}),"Morning");
});
