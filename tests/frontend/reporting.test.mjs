import test from "node:test";
import assert from "node:assert/strict";
import {sourceReporting,reportingStatus} from "../../custom_components/homeostatic/frontend/reporting.mjs";

test("acknowledgment is awareness and status never claims receipt",()=>{
  const data={policy:{notifications_enabled:true,episodes:[{episode_id:"a",sent_to:["mike"],require_acknowledgment:true}]}};
  assert.match(reportingStatus(data,{episode_id:"a"}),/awaiting acknowledgment/);
  data.policy.episodes[0].acknowledgment={at:"2026-09-28"};
  assert.match(reportingStatus(data,{episode_id:"a"}),/problem remains open/);
});

test("automation reporting retains its authoritative Home Assistant editor",()=>{
  const html=sourceReporting({}, {source:{automation_url:"/config/automation/edit/owner",alert_profile:"dashboard"}});
  assert.match(html,/Dashboard only/);
  assert.match(html,/Edit automation/);
  assert.doesNotMatch(html,/data-reporting|data-row-field|Save changes/);
});
