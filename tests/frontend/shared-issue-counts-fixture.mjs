import {baseSource,monitoringExample} from "./monitoring-fixture.mjs";

/** Synthetic recorded memberships, independent of current evidence or live services. */
export function sharedIssueCountsFixture(variant="shared") {
  const data=monitoringExample(),owner="scope",domain="synthetic_speakers";
  const entry=baseSource(`entry:${owner}`,"Synthetic speakers","integration",{entry_id:owner,watched:true,attributes:{domain:[domain]}});
  const deviceCount=variant==="mixed"?2:["loose","connections"].includes(variant)?0:6;
  const devices=Array.from({length:deviceCount},(_,index)=>baseSource(`device:scope-${index}`,`Speaker ${index+1}`,"device",{watched:true,owner_id:owner,attributes:{device:[`scope-${index}`],integration:[owner]}}));
  const entities=devices.flatMap((device,index)=>Array.from({length:3},(_,member)=>baseSource(`entity:scope-${index}-${member}`,`Speaker ${index+1} reading ${member+1}`,"entity",{entity_id:`sensor.scope_${index}_${member}`,owner_id:owner,attributes:{device:[`scope-${index}`],integration:[owner]}})));
  const checks=entities.map(entity=>({...entity,node_id:`monitoring:availability:${entity.node_id}`,monitoring_source:entity.node_id,monitoring_policy:"availability",watched:true}));
  const loose=Array.from({length:variant==="mixed"?1:variant==="loose"?2:0},(_,index)=>baseSource(`entity:loose-${index}`,`Loose reading ${index+1}`,"entity",{entity_id:`sensor.loose_${index}`,owner_id:owner,attributes:{integration:[owner]},watched:true}));
  const connections=variant==="connections"?[entry,baseSource("entry:second","Second connection","integration",{entry_id:"second",watched:true,attributes:{domain:[domain]}})]:[entry];
  const rows=[...connections,...devices,...entities,...checks,...loose];
  const finding=id=>({node_id:id,check_id:"availability",status:"warn",reason:"unavailable",message:"Synthetic reading is unavailable."});
  const episode=(id,anchor,members)=>({episode_id:id,anchor,recorded:[anchor,...members],reasons:members.map(finding),importance:"normal",opened_at:"2026-10-15T16:00:00Z",impact:[]});
  const episodes=variant==="independent"?devices.map((device,index)=>episode(`independent-${index}`,device.node_id,checks.filter(check=>check.attributes.device[0]===device.attributes.device[0]).map(check=>check.node_id))):[
    episode("shared",entry.node_id,[...devices,...checks,...loose,...connections.slice(1)].map(source=>source.node_id)),
  ];
  if(variant==="aliases") {
    const duplicate={...checks[0],node_id:`monitoring:extra:${entities[0].node_id}`,monitoring_policy:"extra"};
    const impact=baseSource("entity:impact","Impact only","entity",{entity_id:"sensor.impact",owner_id:owner,attributes:{integration:[owner]}});
    rows.push(duplicate,impact);
    episodes[0].recorded.push(...devices.map(source=>source.node_id),...entities.map(source=>source.node_id),checks[0].node_id,duplicate.node_id);
    episodes[0].reasons.push(finding(duplicate.node_id));
    episodes[0].impact=[impact.node_id];
  }
  if(variant==="partial")episodes[0].reasons=episodes[0].reasons.map(item=>item.node_id.includes("scope-0")?{...item,status:"pass",reason:"available",message:"Synthetic reading has recovered."}:item);
  data.devices=devices.map(device=>({id:device.attributes.device[0],name:device.name,config_entry_id:owner}));
  data.inventory.nodes=rows;data.inventory.catalog.candidates=rows;
  data.inventory.episodes=episodes;
  return {data,devices,entities,episodes};
}


/** Four issues touch four devices in three rooms; one issue spans two rooms. */
export function locationIssueFixture() {
  const {data,devices,entities}=sharedIssueCountsFixture();
  const rooms=["front","kitchen","kitchen","mud","living","living"];
  const names=["Front Entry light","Kitchen sensor","Kitchen speaker","Mud Room light","Living Room lamp","Living Room speaker"];
  data.floors=[{id:"main",name:"Main Floor"}];
  data.areas=[{id:"front",name:"Front Entry",floor_id:"main"},{id:"kitchen",name:"Kitchen",floor_id:"main"},{id:"mud",name:"Mud Room",floor_id:"main"},{id:"living",name:"Living Room",floor_id:"main"}];
  devices.forEach((device,index)=>{
    device.name=names[index];
    const id=device.attributes.device[0];
    data.devices.find(item=>item.id===id).name=device.name;
    for(const row of data.inventory.nodes.filter(item=>item.attributes?.device?.includes(id)))row.attributes={...row.attributes,area:[rooms[index]],floor:["main"]};
  });
  const check=index=>`monitoring:availability:${entities[index*3].node_id}`;
  const issue=(id,members)=>({episode_id:id,anchor:members[0],recorded:members,reasons:members.map(node_id=>({node_id,check_id:"availability",status:"warn",reason:"unavailable",message:`${id}: entity unavailable`})),importance:"normal",opened_at:"2026-10-15T16:00:00Z",impact:[]});
  data.inventory.episodes=[issue("shared",[check(0),check(1)]),issue("kitchen-one",[check(1)]),issue("kitchen-two",[check(2)]),issue("mud",[check(3)])];
  return {data,devices,entities,episodes:data.inventory.episodes};
}
