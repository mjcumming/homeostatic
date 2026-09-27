export const baseSource = (node_id,name,kind,fields = {}) => ({node_id,name,kind,attributes:{},watched:false,attached_by:[],excluded_by:[],requirements:[],...fields});

/** A large synthetic inventory, including missing owners and shared devices. */
export function monitoringExample() {
  const rows = [baseSource("entry:frigate","Frigate","integration",{entry_id:"frigate",watched:true,attached_by:["entries"]})];
  const devices = [];
  for (let device = 0; device < 26; device++) {
    const id = `camera-${device}`;
    const name = device === 0 ? "Back Deck" : device === 1 ? "Back Porch" : `Camera ${String(device).padStart(2,"0")}`;
    devices.push({id,name});
    const members = [];
    for (let entity = 0; entity < (device === 1 ? 105 : 6); entity++) {
      const entity_id = `sensor.camera_${device}_${String(entity).padStart(3,"0")}`;
      if (entity !== 0) members.push(entity_id);
      rows.push(baseSource(`entity:registry:${id}-${entity}`,`${name} signal ${String(entity).padStart(3,"0")}`,"entity",{entity_id,owner_id:"frigate",excluded_by:entity === 0 ? ["optional"] : [],attributes:{domain:["sensor"],device:[id],entity:[`registry:${id}-${entity}`]}}));
    }
    rows.push(baseSource(`device:${id}`,name,"device",{watched:true,attached_by:["devices"],attributes:{device:[id],integration:["frigate"]},availability_entities:members}));
  }
  for (let number = 0; number < 125; number++) rows.push(baseSource(`entity:registry:orphan-${number}`,`Unassigned sensor ${String(number).padStart(3,"0")}`,"entity",{entity_id:`sensor.unassigned_${number}`,owner_id:number < 5 ? `missing-${number}` : null,attributes:{domain:["sensor"],entity:[`registry:orphan-${number}`]}}));
  rows.push(baseSource("entity:registry:standalone","Standalone switch","entity",{entity_id:"switch.standalone",attributes:{device:["standalone"],entity:["registry:standalone"]}}));
  rows.push(baseSource("device:standalone","Standalone device","device",{attributes:{device:["standalone"]}}));
  devices.push({id:"standalone",name:"Standalone device"});
  for (let number = 0; number < 24; number++) rows.push(baseSource(`entry:other-${number}`,`Integration ${String(number).padStart(2,"0")}`,"integration",{entry_id:`other-${number}`,watched:true}));
  return {schema_version:1,available:true,entry_id:"demo",updated_at:"2026-09-27T12:00:00Z",readiness:{answer:"unknown",nodes:[]},functions:[],evidence_gaps:0,
    inventory:{nodes:rows,catalog:{candidates:rows},episodes:[],operator_controls:[],enrollment_changes:[],notification_requests:[],integration_evidence:{},entity_status:{}},
    coverage:{no_checks:[],never_observed:[],stale:[]},policy:{notifications_enabled:false,routes:{},episodes:[]},areas:[],floors:[],devices};
}
