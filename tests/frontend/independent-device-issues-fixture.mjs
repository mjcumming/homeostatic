import {baseSource} from "./monitoring-fixture.mjs";
import {notificationSettings} from "./notification-profiles-fixture.mjs";

export const deviceNames={deck:"Back Deck Table Light",hallway:"Front Hallway",mudroom:"Mud Room Motion Sensor",plug:"Smart Plug Mini"};
export const fixtureTime="2026-10-16T18:00:00Z";

/** A healthy Matter connection supplies four independent device failures. */
export function independentDeviceIssuesFixture({integrationFailed=false}={}) {
  const integration=baseSource("entry:matter","Matter","integration",{entry_id:"matter",watched:true,attributes:{domain:["matter"]}});
  const canonical=[integration],checks=[],episodes=[],statuses={};
  const settings=notificationSettings();
  settings.timings={settle:120,unknown_hold:900,retry_hold:120,clear_hold:120,rejoin_grace:60,startup_grace:120,startup_quiet_max:600,coalesce_count:3,coalesce_window:60,batch:30};
  settings.monitoring_policies=[{id:"devices",name:"Device availability",enabled:true,check:"availability",match:{kind:["device"]},parameters:{},notifications:[]},
    {id:"deck-extra",name:"Deck availability",enabled:true,check:"availability",match:{kind:["device"],device:["deck"]},parameters:{},notifications:[]}];
  for(const [id,name] of Object.entries(deviceNames)) {
    const entity=baseSource(`entity:${id}`,name,"entity",{entity_id:`light.${id}`,owner_id:"matter",attributes:{device:[id],integration:["matter"],domain:["light"]}});
    const device=baseSource(`device:${id}`,name,"device",{owner_id:"matter",attributes:{device:[id],integration:["matter"],integration_domain:["matter"]},availability_entities:[entity.entity_id]});
    canonical.push(device,entity);
    for(const policy of settings.monitoring_policies.filter(policy=>policy.id==="devices"||id==="deck")) {
      const source={...device,node_id:`check:${policy.id}:${id}`,name:`${name} · ${policy.name}`,monitoring_source:device.node_id,monitoring_policy:policy.id,check_id:"availability",watched:true};
      const finding={node_id:source.node_id,check_id:"availability",status:"fail",reason:"all_unavailable",message:`${name}: All selected entities are unavailable.`,observed_at:fixtureTime};
      checks.push(source);statuses[source.node_id]={current:finding,findings:[finding],last_failure:finding};
      episodes.push({episode_id:`issue:${policy.id}:${id}`,anchor:source.node_id,recorded:[source.node_id],form:"single",impact:[],importance:"normal",opened_at:"2026-10-16T17:00:00Z",reasons:[finding]});
    }
  }
  const current={status:integrationFailed?"fail":"pass",reason:integrationFailed?"setup_error":"loaded",message:integrationFailed?"Matter could not finish setup.":"Home Assistant reports the connection loaded.",observed_at:fixtureTime};
  const integrationFinding={...current,node_id:integration.node_id,check_id:"availability"};
  const grouped={episode_id:"matter-outage",anchor:integration.node_id,recorded:[integration.node_id,...checks.map(source=>source.node_id)],form:"group",impact:[],importance:"normal",opened_at:"2026-10-16T17:00:00Z",reasons:[integrationFinding,...episodes.flatMap(episode=>episode.reasons)]};
  const split={episode:{...grouped,episode_id:"former-matter-group",reasons:episodes.flatMap(episode=>episode.reasons)},source:{node_id:integration.node_id,name:integration.name,kind:"integration"},resolved_at:fixtureTime,resolution:"split",split_into:episodes.map(episode=>episode.episode_id)};
  const data={schema_version:3,available:true,catalog_loaded:true,updated_at:fixtureTime,entry_id:"isolated",functions:[],areas:[],floors:[],devices:Object.entries(deviceNames).map(([id,name])=>({id,name,config_entry_id:"matter"})),readiness:{answer:"blocked",nodes:[]},evidence_gaps:0,coverage:{no_checks:[],never_observed:[],stale:[]},
    inventory:{nodes:[...canonical,...checks],catalog:{candidates:canonical},episodes:integrationFailed?[grouped]:episodes,entity_status:statuses,integration_evidence:{[integration.node_id]:{current,last_failure:integrationFailed?current:null}},attention_controls_supported:true,operator_controls:[],notification_requests:[],enrollment_changes:[],resolved_history:{started_at:fixtureTime,retention:{max_episodes:100,max_age_days:30},episodes:[split]}},
    policy:{notifications_enabled:false,routes:{},episodes:[]}};
  return {data,settings,episodes,grouped,split};
}

/** Read replies carry only the selected source's findings and entities. */
export function independentDeviceReply(fixture,id) {
  const {data,settings}=fixture,source=data.inventory.nodes.find(item=>item.node_id===id);
  const episode=data.inventory.episodes.find(item=>item.anchor===id);
  const policy=settings.monitoring_policies.find(item=>item.id===source.monitoring_policy);
  const entity=data.inventory.nodes.find(item=>item.kind==="entity"&&item.attributes.device[0]===source.attributes.device?.[0]);
  const members=entity?[{node_id:entity.node_id,entity_id:entity.entity_id,name:entity.name,state:"unavailable",restored:false}]:[];
  return {source,explanation:{findings:episode?.reasons||[],nodes:[]},readiness:{answer:"blocked",nodes:[]},entity_status:data.inventory.entity_status[id],integration_evidence:data.inventory.integration_evidence[id],monitoring_policies:policy?[policy]:[settings.monitoring_policies[0]],
    device_evidence:members.length?{members,total:members.length,offset:0,next_offset:null,unavailable_count:members.length,unknown_count:0}:null,device_availability:null};
}
