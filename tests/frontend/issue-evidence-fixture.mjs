import {baseSource} from "./monitoring-fixture.mjs";

export const LYRIC_ENTRY = "entry:lyric";
export const LYRIC_EPISODE = "lyric-group";
export const THERMOSTAT_ENTITY = "entity:registry:thermostat";
export const UPDATED_AT = "2026-10-14T21:00:00Z";
export const lyricLocalize = key => key === "component.lyric.title" ? "Honeywell Lyric" : null;

/** Recorded issue membership survives while current findings recover independently. */
export function issueEvidenceFixture({state="active",variant="devices"}={}) {
  const integration=baseSource(LYRIC_ENTRY,"Lyric connection","integration",{
    entry_id:"lyric",watched:true,attributes:{domain:["lyric"]},
  });
  const deviceDefinitions=[
    ["third-floor","3rd Floor Sensor",["Temperature","Humidity"]],
    ["second-floor","2nd Floor Sensor",["Temperature","Humidity"]],
    ["thermostat","Main Floor Thermostat",[""]],
  ];
  const devices=[],entities=[];
  for(const [id,name,readings] of deviceDefinitions) {
    devices.push(baseSource(`device:${id}`,name,"device",{owner_id:"lyric",attributes:{device:[id],integration:["lyric"],integration_domain:["lyric"]}}));
    for(const reading of readings) {
      const suffix=reading?`-${reading.toLowerCase()}`:"";
      entities.push(baseSource(`entity:registry:${id}${suffix}`,`${name}${reading?` ${reading}`:""}`,"entity",{
        entity_id:`${reading?"sensor":"climate"}.${id.replaceAll("-","_")}${suffix.replaceAll("-","_")}`,
        owner_id:"lyric",attributes:{device:[id],integration:["lyric"],integration_domain:["lyric"],domain:[reading?"sensor":"climate"]},
      }));
    }
  }
  const policies=[
    {id:"devices",name:"Device availability"},
    {id:"entities",name:"Entity availability"},
    {id:"thermostat-extra",name:"Thermostat availability"},
  ];
  const check=(source,policy)=>({...source,node_id:`monitoring:${policy.id}:${source.node_id}`,
    name:`${source.name} · ${policy.name}`,monitoring_source:source.node_id,
    monitoring_policy:policy.id,watched:true,
    ...(source.kind==="device"?{availability_entities:entities.filter(entity=>entity.attributes.device[0]===source.attributes.device[0]).map(entity=>entity.entity_id)}:{}),
  });
  const checks=[...devices.map(source=>check(source,policies[0])),...entities.map(source=>check(source,policies[1])),
    check(entities.find(source=>source.node_id===THERMOSTAT_ENTITY),policies[2])];
  const canonical=[integration,...devices,...entities];
  if(variant==="standalone") {
    const entity=baseSource("entity:registry:standalone","Outdoor reading","entity",{
      entity_id:"sensor.outdoor_reading",owner_id:"lyric",attributes:{integration:["lyric"],domain:["sensor"]},
    });
    canonical.push(entity);checks.push(check(entity,policies[1]));
  }
  const related=checks.map(source=>({
    node_id:source.node_id,check_id:"availability",status:"fail",
    reason:source.kind==="device"?"all_unavailable":"unavailable",
    message:source.kind==="device"?`${source.name}: All selected entities are unavailable.`:`${source.name}: Home Assistant reports unavailable.`,
  }));
  if(variant==="missing")related.push({
    node_id:"monitoring:removed:entity:missing",check_id:"availability",status:"fail",reason:"unavailable",
    message:"A previously monitored reading is unavailable.",
  });
  if(variant==="mixed") {
    related.at(-1).reason="stale";
    related.at(-1).message="No recent thermostat reading has been reported.";
  }
  const byId=new Map(checks.map(source=>[source.node_id,source]));
  const findings=related.map(finding=>state==="recovered"||
    state==="partial"&&byId.get(finding.node_id)?.attributes.device?.includes("third-floor")
      ? {...finding,status:"pass",reason:"available",message:"Home Assistant reports a current state."}
      : finding);
  const episode={episode_id:LYRIC_EPISODE,anchor:LYRIC_ENTRY,form:"group",importance:"normal",
    opened_at:"2026-10-14T20:45:00Z",recorded:[LYRIC_ENTRY,...checks.map(source=>source.node_id)],
    impact:[],reasons:findings};
  const sources=variant==="aliases"?canonical.filter(source=>source.node_id!==THERMOSTAT_ENTITY):canonical;
  const nodes=[...sources,...checks];
  const current={status:"pass",reason:"loaded",message:"Home Assistant reports the connection loaded.",observed_at:UPDATED_AT};
  const data={
    schema_version:3,available:true,catalog_loaded:true,entry_id:"synthetic",updated_at:UPDATED_AT,
    functions:[],areas:[],floors:[],devices:devices.map(source=>({id:source.attributes.device[0],name:source.name,config_entry_id:"lyric"})),
    readiness:{answer:"unknown",nodes:[]},evidence_gaps:0,coverage:{no_checks:[],never_observed:[],stale:[]},
    inventory:{nodes,catalog:{candidates:sources},episodes:[episode],operator_controls:[],enrollment_changes:[],
      notification_requests:[],integration_evidence:{[LYRIC_ENTRY]:{current,last_failure:null}},entity_status:{},
      resolved_history:{episodes:[],retention:{max_episodes:100,max_age_days:30},started_at:UPDATED_AT}},
    policy:{notifications_enabled:false,routes:{},episodes:[]},
  };
  return {data,episode,integration,nodes:new Map(nodes.map(source=>[source.node_id,source])),policies};
}

/** Supply the read-only websocket replies used by the real card. */
export function issueEvidenceReply(fixture,type,nodeId) {
  const {data,nodes,episode,policies}=fixture;
  const source=nodes.get(nodeId)||[...nodes.values()].find(item=>item.monitoring_source===nodeId);
  if(!source)throw Error("Synthetic source metadata is unavailable.");
  const id=source.monitoring_source||source.node_id;
  const selected=[...nodes.values()].filter(item=>item.kind==="entity"&&!item.monitoring_source&&
    (source.kind==="device"?item.attributes.device?.[0]===source.attributes.device?.[0]:item.node_id===id));
  const members=selected.map(item=>{
    const active=episode.reasons.some(finding=>finding.status!=="pass"&&nodes.get(finding.node_id)?.monitoring_source===item.node_id);
    return {node_id:item.node_id,entity_id:item.entity_id,name:item.name,state:active?"unavailable":"72",restored:false};
  });
  const details={node_id:id,updated_at:UPDATED_AT,members,total:members.length,offset:0,next_offset:null,
    unavailable_count:members.filter(item=>item.state==="unavailable").length,unknown_count:0,
    monitoring_policies:policies,device_availability:null};
  if(type==="homeostatic/source")return details;
  if(type!=="homeostatic/node")throw Error("Unexpected synthetic query: "+type);
  return {source,explanation:{findings:episode.reasons,nodes:[]},readiness:{answer:"unknown",nodes:[]},
    integration_evidence:data.inventory.integration_evidence[nodeId],entity_status:null,
    monitoring_policies:policies,device_evidence:null,device_availability:null};
}
