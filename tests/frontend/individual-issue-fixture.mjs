import {temperatureFixture} from "./temperature-source-fixture.mjs";
import {ENTITY_ID} from "./source-details-fixture.mjs";

export const ISSUE_ID="temperature-issue";
export const CHECK_ID="temperature:home";
export const conditions={
  low:{status:"warn",reason:"temperature_low",message:"Temperature 68 °F is below the minimum 80 °F.",evidence:{temperature_celsius:20,minimum:80,maximum:null,unit:"°F",duration_seconds:3600,observed_seconds:3600}},
  high:{status:"warn",reason:"temperature_high",message:"Temperature 86 °F is above the maximum 80 °F.",evidence:{temperature_celsius:30,minimum:null,maximum:80,unit:"°F",duration_seconds:3600,observed_seconds:3600}},
  missing:{status:"unknown",reason:"temperature_evidence_missing",message:"Home Assistant has no usable current temperature evidence.",evidence:{unit:"°F"}},
  recovered:{status:"pass",reason:"temperature_in_range",message:"Temperature is within the configured range.",evidence:{temperature_celsius:27,minimum:80,maximum:null,unit:"°F"}},
  stalled:{status:"warn",reason:"thermostat_stalled",message:"Temperature 68 °F has not made the expected progress toward the heating target 72 °F; the permitted margin is 2 °F.",evidence:{temperature_celsius:20,unit:"°F",target_low_celsius:22.222222,margin:2,progress_seconds:3600}},
  worsening:{status:"warn",reason:"thermostat_worsening",message:"Temperature 66 °F is moving away from the heating target 72 °F; the permitted margin is 2 °F.",evidence:{temperature_celsius:18.888889,unit:"°F",target_low_celsius:22.222222,margin:2}},
};

/** Reuse the real-source fixture with one independently identified open issue. */
export function individualIssueFixture(condition="low") {
  const base=temperatureFixture("entity"),data=base.current.data;
  const source=data.inventory.nodes.find(row=>row.node_id===CHECK_ID);
  const entity=data.inventory.nodes.find(row=>row.node_id===ENTITY_ID);
  source.monitoring_source=entity.node_id;
  const observation={...structuredClone(conditions[condition]),observed_at:"2026-10-15T17:25:00Z"};
  source.kind=condition==="stalled"||condition==="worsening"?"thermostat":"temperature_limit";
  source.check_id=source.kind;
  const status={current:structuredClone(observation),findings:[{node_id:source.node_id,check_id:source.check_id,...observation}]};
  const episode={episode_id:ISSUE_ID,anchor:source.node_id,recorded:[source.node_id],impact:[],importance:"normal",opened_at:"2026-10-15T17:20:00Z",reasons:structuredClone(status.findings)};
  Object.assign(data,{catalog_loaded:true,schema_version:3});
  Object.assign(data.inventory,{episodes:[episode],attention_controls_supported:true,entity_status:{[source.node_id]:status},resolved_history:{started_at:"2026-10-15T12:00:00Z",retention:{max_age_days:30,max_episodes:100},episodes:[]}});
  base.configuration.settings.notifications=false;
  base.configuration.settings.notification_definitions={profiles:{},methods:{}};
  base.sourceDetail.monitoring_policies=base.configuration.settings.monitoring_policies.map(({id,name})=>({id,name}));
  base.sourceDetail.temperature_checks[0].observation=observation;
  base.sourceDetail.temperature_checks[0].next_deadline=null;
  const result={source,readiness:{answer:observation.status==="warn"?"degraded":observation.status==="pass"?"ready":"unknown",nodes:[]},explanation:{findings:status.findings,nodes:[]},impact:{nodes:[]},entity_status:status,temperature_status:{observation,next_deadline:null},monitoring_policies:[{id:source.monitoring_policy,name:base.sourceDetail.temperature_checks[0].policy_name}]};
  return {base,source,entity,episode,observation,status,result};
}
