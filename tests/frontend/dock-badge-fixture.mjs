import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";

/** Reproduce the dock's retained failure and restored reading with synthetic identities. */
export function dockBadgeFixture(condition="restored") {
  const data=monitoringExample(),attributes={device:["dock"],integration:["robot"],area:["bedroom"],floor:["upstairs"]};
  const entry=baseSource("entry:robot","Robot integration","integration",{entry_id:"robot",check_id:"availability",attributes:{domain:["robot"]}});
  const device=baseSource("device:dock","Second Floor Dock","device",{check_id:"availability",attributes});
  const entities=["Child lock","Dock error","Dust emptying","Empty mode","Status indicator light"].map((name,index)=>baseSource(`entity:dock-${index}`,`Second Floor Dock ${name}`,"entity",{
    check_id:"availability",entity_id:`${index===2?"switch":"sensor"}.dock_${index}`,owner_id:"robot",attributes:{...attributes,domain:[index===2?"switch":"sensor"]}}));
  const entity=entities[2];
  const deviceCheck={...device,node_id:"monitoring:devices:device:dock",monitoring_source:device.node_id,monitoring_policy:"devices",watched:true,availability_entities:[entity.entity_id]};
  const entityCheck={...entity,node_id:"monitoring:entities:entity:dock-2",monitoring_source:entity.node_id,monitoring_policy:"entities",watched:true};
  const current=condition==="unavailable"?{status:"warn",reason:"unavailable",message:"Entity unavailable"}:condition==="error"?{status:"fail",reason:"setup_error",message:"Setup failed"}:{status:"unknown",reason:"restored_state",message:"Only a restored state is available"};
  const episode=(source,current,id)=>({episode_id:id,anchor:source.node_id,status:current.status,recorded:[],impact:[],importance:"normal",opened_at:"2026-10-18T10:02:23Z",reasons:[{
    node_id:source.node_id,check_id:"availability",status:current.status,reason:current.status==="unknown"?"stale":current.reason,message:current.message,labels:{category:"fault"}}]});
  data.inventory.nodes=[entry,device,...entities,deviceCheck,entityCheck];
  data.inventory.catalog.candidates=data.inventory.nodes;
  const deviceCurrent={status:"unknown",reason:"incomplete_evidence",message:"Incomplete evidence"};
  data.inventory.episodes=[episode(deviceCheck,deviceCurrent,"retained-device-issue"),episode(entityCheck,current,"entity-issue")];
  data.inventory.entity_status={
    [deviceCheck.node_id]:{current:deviceCurrent,last_failure:{status:"warn",reason:"all_unavailable",message:"All unavailable",observed_at:"2026-10-18T13:36:20Z"}},
    [entityCheck.node_id]:{current,last_failure:current.status==="unknown"?null:current},
  };
  if(condition==="error") {
    const errorCurrent={status:"fail",reason:"setup_error",message:"Setup failed"};
    data.inventory.episodes=[episode(entry,errorCurrent,"integration-error")];
    data.inventory.integration_evidence={[entry.node_id]:{current:errorCurrent,last_failure:errorCurrent}};
  }
  if(condition==="unmonitored") {
    data.inventory.nodes=[entry,device,...entities];data.inventory.catalog.candidates=data.inventory.nodes;
    data.inventory.episodes=[];data.inventory.entity_status={};
  }
  data.devices=[{id:"dock",name:device.name}];data.areas=[{id:"bedroom",name:"Bedroom",floor_id:"upstairs"}];data.floors=[{id:"upstairs",name:"Second Floor"}];
  return {data,device,entity,entities,deviceCheck,entityCheck};
}
