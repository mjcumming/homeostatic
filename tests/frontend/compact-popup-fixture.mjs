import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";
import {issueEvidenceFixture,issueEvidenceReply} from "./issue-evidence-fixture.mjs";

export const popupCases=[
  {id:"battery",kind:"battery",name:"Front Hallway battery",reason:"battery_low",headline:"Battery low",entity:"sensor.hallway_battery",check:"battery",device:"hallway"},
  {id:"device",kind:"entity",name:"Front Hallway sensor",reason:"unavailable",headline:"Temperature unavailable",entity:"sensor.hallway_temperature",domain:"sensor",device:"hallway",members:true},
  {id:"entity",kind:"entity",name:"Front Hallway occupancy",reason:"unavailable",headline:"Occupancy sensor unavailable",entity:"binary_sensor.hallway_occupancy",domain:"binary_sensor",deviceClass:"occupancy",device:"hallway"},
  {id:"integration",kind:"integration",name:"Lyric",reason:"setup_error",headline:"Connection couldn't start",entry:"lyric",domain:"lyric"},
  {id:"vacuum",kind:"vacuum",name:"Upstairs vacuum",reason:"vacuum_error",headline:"Vacuum error",entity:"vacuum.upstairs",message:"Brush is blocked.",check:"vacuum",device:"vacuum"},
  {id:"ups",kind:"ups",name:"Office UPS",reason:"ups_reserve_low",headline:"UPS reserve is low",entity:"sensor.office_ups_charge",check:"ups_reserve",device:"ups"},
  {id:"repair",kind:"repair",name:"Bedroom integration Repair",reason:"repair",headline:"Review the bedroom integration configuration.",check:"repair",fix:"/config/repairs"},
  {id:"automation",kind:"broken_automation",name:"Porch lighting automation",reason:"missing_entity",headline:"Porch automation refers to an unavailable entity.",check:"broken_automation",fix:"/config/automation/edit/porch"},
  {id:"situation",kind:"situation",name:"Utility room condition",reason:"condition",check:"condition"},
  {id:"source",kind:"entity",name:"Hallway temperature",reason:"source_missing",headline:"No current state found",entity:"sensor.hallway_temperature",domain:"sensor",noEpisode:true},
  {id:"grouped",kind:"integration",grouped:true,name:"Michael’s iPhone",headline:"10 entities unavailable"},
];

/** Render varied source replies through the production popup without live services. */
export function compactPopupFixture(id="battery") {
  const definition=popupCases.find(item=>item.id===id);
  if(definition.grouped) {
    const group=issueEvidenceFixture({variant:"phone"});
    group.data.inventory.attention_controls_supported=true;
    return {definition,data:group.data,source:group.integration,episode:group.episode,
      result:issueEvidenceReply(group,"homeostatic/node",group.integration.node_id),
      title:definition.name,policyIds:group.policies.map(item=>item.id)};
  }
  const data=monitoringExample(),policy={id:"popup-"+id,name:"Selected "+id+" policy"};
  const canonicalId=definition.kind+":"+id,attributes={
    ...(definition.device?{device:[definition.device]}:{}),
    ...(definition.domain?{domain:[definition.domain]}:{}),
    ...(definition.deviceClass?{device_class:[definition.deviceClass]}:{}),
  };
  const canonical=baseSource(canonicalId,definition.name,definition.kind,{entity_id:definition.entity,entry_id:definition.entry,attributes,fix_url:definition.fix});
  const source=definition.noEpisode?canonical:{...canonical,node_id:"check:"+id,name:definition.name+" · "+policy.name,
    monitoring_source:canonicalId,monitoring_policy:policy.id,check_id:definition.check||"availability",watched:true};
  const current={status:definition.noEpisode?"unknown":"fail",reason:definition.reason,message:definition.message||definition.headline||"The configured condition is reported.",observed_at:"2026-10-15T18:00:00Z"};
  const finding={...current,node_id:source.node_id,check_id:source.check_id||"availability"};
  const episode=definition.noEpisode?null:{episode_id:"issue:"+id,anchor:source.node_id,recorded:[source.node_id],impact:[],importance:"normal",opened_at:"2026-10-15T17:45:00Z",reasons:[finding]};
  const status={current,findings:[finding]};
  if(id==="ups")status.ups={status:"warn",reason:current.reason,message:current.message,evidence:{power_mode:"backup",readings:{charge:14,runtime:8}}};
  const nodes=definition.noEpisode?[source]:[canonical,source];
  Object.assign(data,{schema_version:3,catalog_loaded:true,updated_at:"2026-10-15T18:00:00Z",devices:[],areas:[],floors:[]});
  Object.assign(data.inventory,{nodes,catalog:{candidates:[canonical]},episodes:episode?[episode]:[],attention_controls_supported:true,
    entity_status:{[source.node_id]:status},ups_status:id==="ups"?{[source.node_id]:status}:{},integration_evidence:{},
    resolved_history:{started_at:"2026-10-15T12:00:00Z",retention:{max_age_days:30,max_episodes:100},episodes:[]}});
  if(definition.device&&definition.kind!=="device") {
    const device=baseSource("device:"+definition.device,definition.name,"device",{attributes:{device:[definition.device]}});
    nodes.push(device);data.inventory.catalog.candidates.push(device);
  }
  data.devices=definition.device?[{id:definition.device,name:definition.name}]:[];
  const result={source,readiness:{answer:"unknown",nodes:[]},explanation:{findings:[finding],nodes:[]},entity_status:status,
    monitoring_policies:[policy],device_evidence:null,device_availability:null};
  if(id==="integration") {
    result.integration_evidence={current:{...current,message:"Configuration entry requires review."},last_failure:null};
    data.inventory.integration_evidence[source.node_id]=result.integration_evidence;
  }
  if(definition.members) {
    const member=definition.id==="device"?canonical:baseSource("entity:hallway_temperature","Front Hallway sensor Temperature","entity",{entity_id:"sensor.hallway_temperature",attributes:{device:["hallway"],domain:["sensor"]}});
    if(member!==canonical){nodes.push(member);data.inventory.catalog.candidates.push(member);}
    source.availability_entities=[member.entity_id];
    result.device_evidence={total:1,members:[{node_id:member.node_id,entity_id:member.entity_id,name:member.name,state:"unavailable",restored:false}],unknown_count:0,unavailable_count:1};
    result.device_availability={status:"available",basis:"entities",reason:"available"};
  }
  return {definition,data,source,episode,result,title:id==="integration"?"Honeywell Lyric":definition.name,policyIds:[policy.id]};
}