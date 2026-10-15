import {sourceDetailsFixture,DEVICE_ID,ENTITY_ID} from "./source-details-fixture.mjs";

export function temperatureFixture(view="device") {
  const card=sourceDetailsFixture(view,["68","40","71"]);
  const sensor=card.current.data.inventory.nodes.find(row=>row.node_id===ENTITY_ID);
  const check={...sensor,node_id:"temperature:home",kind:"temperature_limit",check_id:"temperature_limit",name:sensor.name+" · Home Interior Temperature Monitoring",monitoring_policy:"home-temperature",watched:true};
  card.current.data.inventory.nodes.push(check);
  card.configuration.settings.monitoring_policies.push({id:"home-temperature",name:"Home Interior Temperature Monitoring",enabled:true,check:"temperature_limit",match:{kind:["entity"]},parameters:{minimum:80,unit:"°F",duration_seconds:3600},notifications:[]});
  card.sourceDetail.temperature_checks=[{node_id:check.node_id,source_id:ENTITY_ID,entity_id:sensor.entity_id,source_name:sensor.name,policy_id:"home-temperature",policy_name:"Home Interior Temperature Monitoring",observation:{status:"pass",reason:"temperature_qualifying",message:check.name+": Temperature is outside the range; the configured duration has not elapsed.",observed_at:"2026-10-15T16:30:00Z",evidence:{temperature_celsius:20,minimum:80,maximum:null,unit:"°F",duration_seconds:3600,observed_seconds:600}},next_deadline:"2026-10-15T17:20:00Z"}];
  return card;
}
