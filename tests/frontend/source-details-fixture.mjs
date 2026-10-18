import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";

export const DEVICE_ID="device:third-floor";
export const ENTITY_ID="entity:third-floor-temperature";
export const UPDATED_AT="2026-10-14T17:45:06Z";

/** Build isolated source details with the same distinct evidence counts as the HA reply. */
export function sourceDetailsFixture(view="device",states=["restored","restored","restored"]) {
  const data=monitoringExample();
  const integration=baseSource("entry:lyric","Lyric","integration",{entry_id:"lyric",attributes:{domain:["lyric"]}});
  const device=baseSource(DEVICE_ID,"3rd Floor Sensor","device",{owner_id:"lyric",attributes:{integration:["lyric"],device:["third-floor"]}});
  const descriptions=["Room temperature","Room humidity","Room average temperature"];
  const ids=[ENTITY_ID,"entity:third-floor-humidity","entity:third-floor-average"];
  const entities=states.map((state,index)=>baseSource(ids[index]||`entity:third-floor-${index}`,`3rd Floor Sensor ${descriptions[index]||"Reading "+index}`,"entity",{
    owner_id:"lyric",entity_id:index===0?"sensor.3rd_floor_sensor_room_temperature":`sensor.3rd_floor_sensor_${index}`,
    attributes:{integration:["lyric"],device:["third-floor"]},
  }));
  const deviceChecks=entities.map(entity=>({...entity,node_id:`monitoring:devices:${entity.node_id}`,monitoring_source:entity.node_id,monitoring_policy:"devices",check_id:"availability",watched:true}));
  const entityCheck={...entities[0],node_id:`monitoring:entities:${ENTITY_ID}`,monitoring_source:ENTITY_ID,monitoring_policy:"entities",watched:true};
  data.inventory.nodes=[integration,device,...entities,...deviceChecks,...(entities.length?[entityCheck]:[])];
  data.inventory.catalog.candidates=[integration,device,...entities];
  data.devices=[{id:"third-floor",name:device.name,config_entry_id:"lyric"}];
  data.inventory.episodes=[];
  data.inventory.integration_evidence={"entry:lyric":{current:{status:"pass",reason:"loaded"}}};
  const members=entities.map((entity,index)=>({
    node_id:entity.node_id,entity_id:entity.entity_id,name:entity.name,
    state:states[index]==="restored"?"unavailable":states[index],restored:states[index]==="restored",
    unit:index===1?"%":"°F",
  }));
  const selected=view==="entity"?ENTITY_ID:DEVICE_ID;
  const selectedMembers=view==="entity"?members.slice(0,1):members;
  const card={current:{status:"current",data},sourcesGrouping:"integration",sourcesQuery:"",sourcesExpanded:new Set(["integration:lyric","source:entry:lyric",`source:${DEVICE_ID}`]),sourcesSelection:`source:${selected}`,
    configuration:{revision:"r1",settings:{monitoring_policies:[{id:"devices",name:"Devices",check:"availability",enabled:true,match:{kind:["entity"]},parameters:{},notifications:[]},{id:"entities",name:"Entities",check:"availability",enabled:true,match:{kind:["entity"]},parameters:{},notifications:[]}]}},
    _hass:{localize:key=>key==="component.lyric.title"?"Honeywell Lyric":null},
    sourceDetail:{nodeId:selected,members:selectedMembers,total:selectedMembers.length,offset:0,next_offset:null,
      unavailable_count:selectedMembers.filter(item=>item.state==="unavailable"&&!item.restored).length,
      unknown_count:selectedMembers.filter(item=>item.restored||item.state==="missing").length,
      updated_at:UPDATED_AT,
}};
  return card;
}
